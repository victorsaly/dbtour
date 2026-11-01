// The entry's Query section and the SQL page: a starter query for a table, what autocomplete knows, which
// tables a query reads, and the prompt "Copy for agent" hands over. Pure, so it is tested in Node; the page
// cannot run a query (it is a static file), so running stays with dbtour sql and the MCP query tool.
import { driverName, formatCount } from 'dbtour/markdown';
import { findTable, localRef, relationsOf, tableRef, type Column, type Database, type Model } from 'dbtour/model';
import { prompt } from './prompt.ts';
import { sqlTokens } from './sql.ts';

/** The first hundred rows, as dbtour sql returns by default: enough to see what a table holds. */
const starterRows = 100;

// The words T-SQL reserves, and GO, which the query check refuses as a statement too: a column or table so
// named is written [bracketed], so a starter never trips the check or the parser.
const reserved = new Set(
  ('ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK ' +
    'CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE ' +
    'CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC ' +
    'DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE ' +
    'EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL ' +
    'FUNCTION GO GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT ' +
    'INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF ' +
    'OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN ' +
    'PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION ' +
    'RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT ' +
    'SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER ' +
    'SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE ' +
    'TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE ' +
    'WHILE WITH WITHIN WRITETEXT').split(' '),
);

/** A name as T-SQL needs it: as it is when plain, [bracketed] (with ] doubled) when not, or when reserved. */
export function quoteName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !reserved.has(name.toUpperCase()) ? name : `[${name.replace(/]/g, ']]')}]`;
}

/** schema.table, each part quoted as needed. */
function quoteRef(ref: string): string {
  const dot = ref.indexOf('.');
  return `${quoteName(ref.slice(0, dot))}.${quoteName(ref.slice(dot + 1))}`;
}

/** Masked, encrypted or labelled: someone protected it, so a starter leaves it out and says so. */
function isProtected(column: Column): boolean {
  return Boolean(column.masked || column.encrypted || column.sensitivity);
}

/**
 * An alias from a table's words: Orders o, OrderLines ol, vOrderTotals vot; t before one that would start with a
 * digit (2026Orders t2o); a number when it is taken. `taken` holds aliases in lower case, as T-SQL compares them.
 */
function aliasFor(table: string, taken: Set<string>): string {
  const words = table.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [table];
  const initials = words.map((w) => w[0].toLowerCase()).join('').replace(/[^a-z0-9]/g, '');
  const base = /^[a-z]/.test(initials) ? initials : `t${initials}`;
  let alias = base;
  for (let n = 2; taken.has(alias) || reserved.has(alias.toUpperCase()); n++) alias = `${base}${n}`;
  taken.add(alias);
  return alias;
}

/** The column that says what a row is, to show beside a key that points at it: Name, then a code or title. */
function nameColumn(columns: Column[], primaryKey: string[] = []): Column | undefined {
  const usable = columns.filter((c) => !isProtected(c) && !primaryKey.includes(c.name));
  return (
    usable.find((c) => /^name$/i.test(c.name)) ??
    usable.find((c) => /^(title|label|displayname|fullname|code|sku)$/i.test(c.name)) ??
    usable.find((c) => /[a-z]Name$/.test(c.name))
  );
}

/** Customers is a customer, Categories a category; enough for an alias, not a dictionary. */
function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/[^s]s$/.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * The table's own columns, and a LEFT JOIN on its declared keys (or the notes' relations) to each table it
 * references that has a column saying what its rows are, the newest rows first by the primary key.
 */
export function starterQuery(model: Model, ref: string): string {
  const found = findTable(model, ref);
  if (!found) return `-- ${ref} is not a table dbtour knows.`;
  const { table } = found;
  const taken = new Set<string>();
  const alias = aliasFor(table.name, taken);
  const kept = table.columns.filter((c) => !isProtected(c));
  const left = table.columns.filter(isProtected);
  const select = kept.map((c) => `${alias}.${quoteName(c.name)}`);
  const joins: string[] = [];
  for (const relation of relationsOf(model, found.ref).out) {
    const target = findTable(model, relation.to.table);
    if (!target) continue;
    const show = nameColumn(target.table.columns, target.table.primaryKey);
    if (!show) continue;
    const other = aliasFor(target.table.name, taken);
    const on = relation.from.columns.map((from, i) => `${other}.${quoteName(relation.to.columns[i])} = ${alias}.${quoteName(from)}`).join(' AND ');
    joins.push(`LEFT JOIN ${quoteRef(localRef(model, target.ref))} AS ${other} ON ${on}`);
    select.push(`${other}.${quoteName(show.name)} AS ${quoteName(singular(target.table.name) + show.name)}`);
  }
  const lines = [`-- ${localRef(model, found.ref)}${joins.length ? ' with what it references' : ''}.`];
  if (left.length) lines.push(`-- Masked, encrypted and labelled columns are left out: ${left.map((c) => c.name).join(', ')}. Add them if the question needs them.`);
  // Every column protected: how many rows, rather than * selecting what the comment says was left out.
  if (!select.length) {
    lines.push('SELECT COUNT(*) AS [Rows]', `FROM ${quoteRef(localRef(model, found.ref))} AS ${alias};`);
    return lines.join('\n');
  }
  lines.push(`SELECT TOP (${starterRows})`, ...select.map((s, i, all) => `    ${s}${i < all.length - 1 ? ',' : ''}`));
  lines.push(`FROM ${quoteRef(localRef(model, found.ref))} AS ${alias}`, ...joins);
  if (table.primaryKey?.length) lines.push(`ORDER BY ${table.primaryKey.map((k) => `${alias}.${quoteName(k)} DESC`).join(', ')}`);
  lines[lines.length - 1] += ';';
  return lines.join('\n');
}

function databaseNamed(model: Model, name: string | undefined): Database {
  return model.databases.find((d) => d.name === name) ?? model.databases[0];
}

/** A schema's name as SQL in its own database writes it: Sales:dbo is dbo. */
function localSchema(model: Model, database: Database, schema: string): string {
  return model.databases.length > 1 && schema.startsWith(`${database.name}:`) ? schema.slice(database.name.length + 1) : schema;
}

/** One suggestion, in the shape CodeMirror's autocomplete takes: what it is, beside it, and below it. */
export interface Suggestion {
  label: string;
  type?: string;
  detail?: string;
  info?: string;
}

/** A table's suggestion (`self`) and its columns', as CodeMirror's SQL support nests them. */
export interface TableSuggestions {
  self: Suggestion;
  children: Suggestion[];
}

/**
 * What autocomplete offers in one database: schema, table and column, by the names SQL uses there. Each says
 * what it is: a table its kind and rows, a column its type, its key or the table it points at, and whether it
 * is protected; a description, when there is one, shows below.
 */
export function completionSchema(model: Model, databaseName: string | undefined): { schema: Record<string, Record<string, TableSuggestions>>; defaultSchema: string } {
  const database = databaseNamed(model, databaseName);
  const schema: Record<string, Record<string, TableSuggestions>> = {};
  for (const s of database.schemas) {
    const tables: Record<string, TableSuggestions> = {};
    for (const t of s.tables) {
      const ref = tableRef(s.name, t.name);
      const out = relationsOf(model, ref).out;
      const self: Suggestion = { label: t.name, type: 'type', detail: t.kind === 'view' ? 'view' : t.stats ? `table · ${formatCount(t.stats.rows)} rows` : 'table' };
      if (t.description) self.info = t.description;
      const children = t.columns.map((c): Suggestion => {
        const notes: string[] = [];
        if (t.primaryKey?.includes(c.name)) notes.push('primary key');
        const points = out.find((r) => r.from.columns.includes(c.name));
        if (points) notes.push(`→ ${localRef(model, points.to.table)}`);
        if (c.masked) notes.push('masked');
        if (c.encrypted) notes.push('encrypted');
        if (c.sensitivity) notes.push('labelled');
        const suggestion: Suggestion = { label: c.name, type: 'property', detail: [c.type, ...notes].join(' · ') };
        if (c.description) suggestion.info = c.description;
        return suggestion;
      });
      tables[t.name] = { self, children };
    }
    schema[localSchema(model, database, s.name)] = tables;
  }
  const names = Object.keys(schema);
  return { schema, defaultSchema: names.includes('dbo') ? 'dbo' : (names[0] ?? 'dbo') };
}

/**
 * The tables of one database a query names, as the model refs them, in the order the query first names them:
 * schema.table anywhere outside strings and comments, or a bare table of the default schema after FROM or JOIN.
 */
export function queryTables(model: Model, sql: string, databaseName: string | undefined): string[] {
  const code = codeOf(sql);
  const database = databaseNamed(model, databaseName);
  const { defaultSchema } = completionSchema(model, database.name);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found: { ref: string; at: number }[] = [];
  for (const s of database.schemas) {
    const local = localSchema(model, database, s.name);
    for (const t of s.tables) {
      const dotted = new RegExp(`(?<![\\w.])${escape(local)}\\.${escape(t.name)}(?![\\w])`, 'i').exec(code);
      const bare = local === defaultSchema ? new RegExp(`\\b(?:FROM|JOIN)\\s+${escape(t.name)}(?![\\w.])`, 'i').exec(code) : null;
      const at = Math.min(dotted?.index ?? Infinity, bare?.index ?? Infinity);
      if (at !== Infinity) found.push({ ref: tableRef(s.name, t.name), at });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.ref);
}

/** "Copy for agent": the query, what to check in it, and the tables it reads as the docs write them. */
export function sqlPrompt(model: Model, sql: string, databaseName: string | undefined): string {
  const database = databaseNamed(model, databaseName);
  const refs = queryTables(model, sql, database.name);
  const head =
    `The query below runs on the ${database.name} database (${driverName(database.driver)}). Check it against the tables it reads, from dbtour, and improve it: ` +
    'the names as the tables have them, joins on their keys, a TOP or a filter on an indexed column for a large table, and masked or labelled columns only if the question needs them.';
  const tables = refs.length ? prompt(model, refs) : 'It names no table dbtour knows: say which tables it should read.';
  return `${head}\n\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n\n${tables}`;
}


/** The query without its strings and comments, and with [brackets] taken off names, to look for names in. */
function codeOf(sql: string): string {
  return sqlTokens(sql)
    .filter((t) => t.kind !== 'string' && t.kind !== 'comment')
    .map((t) => t.text.replace(/^\[(.*)\]$/, '$1'))
    .join('');
}

// Words that can follow a table in FROM or JOIN without being its alias.
const notAliases = new Set(['ON', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'ORDER', 'GROUP', 'HAVING', 'UNION', 'WITH', 'AS', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR']);

/**
 * The alias the query gives each table it names after FROM or JOIN, by the model's ref: named schema.table, or
 * by the table alone when it is in the default schema, as queryTables finds it.
 */
export function queryAliases(model: Model, sql: string, databaseName: string | undefined): Record<string, string> {
  const code = codeOf(sql);
  const { defaultSchema } = completionSchema(model, databaseName);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliases: Record<string, string> = {};
  for (const ref of queryTables(model, sql, databaseName)) {
    const local = localRef(model, ref);
    const dot = local.indexOf('.');
    const [schema, table] = [local.slice(0, dot), local.slice(dot + 1)];
    const name = schema === defaultSchema ? `(?:${escape(schema)}\\.)?${escape(table)}` : `${escape(schema)}\\.${escape(table)}`;
    const match = new RegExp(`\\b(?:FROM|JOIN)\\s+${name}\\s+(?:AS\\s+)?([A-Za-z_][\\w]*)`, 'i').exec(code);
    if (match && !notAliases.has(match[1].toUpperCase())) aliases[ref] = match[1];
  }
  return aliases;
}

/** A suggestion that writes a whole join. */
export interface JoinSuggestion extends Suggestion {
  apply: string;
}

/**
 * What can be joined next: every table related to one the query already has, but not yet in it, offered after
 * JOIN with its alias and the ON clause written from the declared keys (or the notes' relations), so a join
 * is never guessed. Tables in the query's order; for each, the tables it points at first, then those that
 * point at it.
 */
export function joinCompletions(model: Model, sql: string, databaseName: string | undefined): JoinSuggestion[] {
  const present = queryTables(model, sql, databaseName);
  const aliases = queryAliases(model, sql, databaseName);
  const taken = new Set(Object.values(aliases).map((a) => a.toLowerCase()));
  const offered = new Set<string>();
  const suggestions: JoinSuggestion[] = [];
  const nameOf = (ref: string) => aliases[ref] ?? quoteRef(localRef(model, ref));
  for (const ref of present) {
    const { out, in: inward } = relationsOf(model, ref);
    const pairs = [
      ...out.map((r) => ({ other: r.to.table, otherColumns: r.to.columns, ownColumns: r.from.columns, detail: `referenced by ${localRef(model, ref)}` })),
      ...inward.map((r) => ({ other: r.from.table, otherColumns: r.from.columns, ownColumns: r.to.columns, detail: `references ${localRef(model, ref)}` })),
    ];
    for (const pair of pairs) {
      if (present.includes(pair.other) || offered.has(pair.other)) continue;
      const target = findTable(model, pair.other);
      if (!target) continue;
      offered.add(pair.other);
      const alias = aliasFor(target.table.name, taken);
      const on = pair.otherColumns.map((c, i) => `${alias}.${quoteName(c)} = ${nameOf(ref)}.${quoteName(pair.ownColumns[i])}`).join(' AND ');
      const local = quoteRef(localRef(model, pair.other));
      suggestions.push({ label: localRef(model, pair.other), type: 'type', detail: pair.detail, apply: `${local} AS ${alias} ON ${on}` });
    }
  }
  return suggestions;
}
