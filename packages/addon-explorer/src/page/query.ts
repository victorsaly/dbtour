// The entry's Query section and the SQL page: a starter query for a table, what autocomplete knows, which
// tables a query reads, and the prompt "Copy for agent" hands over. Pure, so it is tested in Node; the page
// cannot run a query (it is a static file), so running stays with dbtour sql and the MCP query tool.
import { driverName } from 'dbtour/markdown';
import { findTable, localRef, relationsOf, tableRef, type Column, type Database, type Model } from 'dbtour/model';
import { prompt } from './prompt.ts';
import { sqlTokens } from './sql.ts';

/** The first hundred rows, as dbtour sql returns by default: enough to see what a table holds. */
const starterRows = 100;

// Words T-SQL reserves that a column or table is still sometimes named; such a name is written [bracketed].
const reserved = new Set(
  ('ADD ALL ALTER AND ANY AS ASC BACKUP BEGIN BETWEEN BY CASE CHECK CLOSE COLUMN COMMIT CREATE CROSS CURRENT DATABASE ' +
    'DEFAULT DELETE DESC DISTINCT DROP ELSE END EXEC EXISTS FILE FOR FOREIGN FROM FULL FUNCTION GRANT GROUP HAVING ' +
    'IDENTITY IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE NOT NULL OF ON OPEN OR ORDER OUTER PERCENT PLAN ' +
    'PRIMARY PROCEDURE PUBLIC REFERENCES RIGHT RULE SCHEMA SELECT SET TABLE THEN TO TOP TRIGGER UNION UNIQUE UPDATE ' +
    'USER VALUES VIEW WHEN WHERE WITH').split(' '),
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

/** An alias from a table's words: Orders o, OrderLines ol, vOrderTotals vot; a number when it is taken. */
function aliasFor(table: string, taken: Set<string>): string {
  const words = table.match(/[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])/g) ?? [table];
  const base = words.map((w) => w[0].toLowerCase()).join('') || 't';
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
  lines.push(`SELECT TOP (${starterRows})`, ...(select.length ? select : [`${alias}.*`]).map((s, i, all) => `    ${s}${i < all.length - 1 ? ',' : ''}`));
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

/** What autocomplete offers in one database: schema, table and column, by the names SQL uses there. */
export function completionSchema(model: Model, databaseName: string | undefined): { schema: Record<string, Record<string, string[]>>; defaultSchema: string } {
  const database = databaseNamed(model, databaseName);
  const schema: Record<string, Record<string, string[]>> = {};
  for (const s of database.schemas) {
    const tables: Record<string, string[]> = {};
    for (const t of s.tables) tables[t.name] = t.columns.map((c) => c.name);
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
  const code = sqlTokens(sql)
    .filter((t) => t.kind !== 'string' && t.kind !== 'comment')
    .map((t) => t.text.replace(/^\[(.*)\]$/, '$1'))
    .join('');
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

