// The SQL editor's autocomplete. CodeMirror's SQL support completes a name from the schema wherever a name
// can go; this reads the query as CodeMirror parses it, to know what belongs at the caret. In an expression,
// the columns of the tables in scope there, a subquery's own before its outer query's, written with their
// table's alias when more than one is in scope. After an alias and a dot, that table's columns alone. After
// ON, the conditions the keys give; after JOIN, the joins. After FROM and JOIN, a table with an alias. Tab after
// * in the select list writes the columns, and a few snippets write the start of a read. What the reader picks
// is counted, and comes first among equals. Pure, so the cases in test/complete.test.ts run it as the editor does.
import { snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { keywordCompletionSource, MSSQL, schemaCompletionSource, SQLDialect, type SQLNamespace } from '@codemirror/lang-sql';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { findTable, localRef, relationsOf, tableRef, type Model } from 'dbtour/model';
import { aliasFor, completionSchema, isProtected, joinCompletions, quoteName, quoteRef, type TableSuggestions } from './query.ts';

/**
 * T-SQL as SQL Server reads it by default: names are not case-sensitive, so a completed OrderLines needs no
 * quotes, and a name that does need them gets [brackets], as T-SQL is written, rather than "double quotes".
 */
export const tsql = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });

// CodeMirror ranks by how well a label matches what is typed, then by boost; its SQL keywords have -1 and
// schema names 0. A column of the caret's own query at 2, and of an outer query's at 1, comes above both when
// it matches as well, and never above a better match. A join or an ON condition is what its place is for, so
// it comes first whatever else matches.
const ownColumnBoost = 2;
const outerColumnBoost = 1;
const writtenOutBoost = 99;
// After FROM, a schema is a step towards a table: listed after the tables, before the keywords.
const schemaBoost = -0.5;
// A table that has every column the select list names comes a point above one that has none, a part for
// some: the same scale as a pick, so a better typed match still leads.
const tableFitBoost = 1;
// After a table and its alias, the words that can follow it; ON leads after a JOIN, where it is due.
const afterTableWords = new Set([
  'AS', 'WITH', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'APPLY', 'ON', 'AND', 'OR',
  'GROUP', 'ORDER', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR', 'SET', 'OUTPUT', 'PIVOT', 'UNPIVOT',
]);
const onBoost = 1;
// A snippet's name is a made-up word: it leads only once typed whole, below a keyword that matches as well.
const snippetBoost = -2;
// What was picked before: a tenth a pick, at most nine tenths, so it orders equals (and an outer column never
// passes the caret's own, a whole point above) but never a better match, a hundred points apart.
const usedBoostPerPick = 0.1;
const usedBoostMost = 0.9;

/** A suggestion with what it stands for, so a pick is counted the same whichever alias wrote it. */
export interface Keyed extends Completion {
  key?: string;
  /** Write the snippet, then open the list again: a table comes next. */
  reopen?: boolean;
}

/** A snippet: its name, what it writes, and where the caret goes (${} fields, Tab between them). */
export interface Snippet {
  name: string;
  template: string;
}

/**
 * The snippets, each the start of a read, as dbtour sql runs only reads. A hundred rows, as dbtour sql
 * returns by default. One without fields is written as it is and the list opens again for the table.
 */
export const snippets: Snippet[] = [
  { name: 'ssf', template: 'SELECT * FROM ' },
  { name: 'st100', template: 'SELECT TOP (100) * FROM ' },
  { name: 'scf', template: 'SELECT COUNT(*) FROM ' },
  { name: 'cte', template: 'WITH ${name} AS (\n  SELECT ${}\n)\nSELECT * FROM ${name}' },
  { name: 'wex', template: 'WHERE EXISTS (SELECT 1 FROM ${table} WHERE ${condition})' },
];

/** What expandStar and the check need from the editor's state: the model, its database, the tables by name. */
export interface Setup {
  model: Model;
  databaseName: string;
  defaultSchema: string;
  index: Map<string, Known>;
}

const setup = Facet.define<Setup, Setup | undefined>({ combine: (values) => values[0] });

/** The model and database the editor completes from, for the check (check.ts) to hold the query to. */
export function setupOf(state: EditorState): Setup | undefined {
  return state.facet(setup);
}

type Node = ReturnType<typeof syntaxTree>['topNode'];

/** A table of the model, by its ref, its name in this database's SQL, and what autocomplete says of it. */
export interface Known {
  ref: string;
  suggestions: TableSuggestions;
}

/** A table the query reads at some level: how the query names it there (its alias, or its name) and how deep. */
interface InScope {
  name: string;
  known: Known;
  /** 0 for the caret's own query, 1 for the one around it, and so on. */
  depth: number;
}

/** What is at the caret, read once and shared by the sources the editor asks. */
export interface Reading {
  /** In a string or a comment: nothing is offered. */
  quiet: boolean;
  /** In a [quoted name]: CodeMirror's schema completion quotes what it offers; the columns here do not. */
  quoted: boolean;
  /** After name-and-dot, the table it names, when the query or the model knows it. */
  dotted?: { known: Known; from: number };
  /** After a dot that names no table here: a schema, say, which CodeMirror's schema completion knows. */
  afterDot: boolean;
  /** Where a table belongs (after FROM, JOIN, a comma in FROM), or just after one (its alias, or a keyword). */
  tableSpot: boolean;
  /** Where a table belongs and takes an alias: after FROM, JOIN, APPLY or a comma in FROM, not INTO or UPDATE. */
  aliasable: boolean;
  /** The names before a dot at the caret, as written: a schema, say, or an alias. */
  qualifier?: string[];
  /** A * the select list ends with at the caret, the table it is qualified with, and whether a word touches it. */
  star?: { from: number; qualifier?: string; spaced: boolean };
  /** Every name the query gives a table, at every level, in lower case: a new alias must be none of them. */
  taken: Set<string>;
  /** The table being written at the caret has its alias already, after it: `FROM Cust| AS c`. */
  aliased: boolean;
  /** Just after a table and its alias, where a clause or a join goes: after a JOIN with no ON yet, ON is due. */
  afterTable?: { joining: boolean };
  /** The columns the select list names, in lower case: the tables that have them fit the query. */
  selected: string[];
  /** The caret's own query reads a table the model does not know, or a subquery: * covers columns not known here. */
  unknownOwn: boolean;
  /** Just after ON: the table being joined, and the ones before it it can join to. */
  on?: { joined: InScope; earlier: InScope[] };
  scope: InScope[];
}

// Keywords after which a table is named, those after which it takes an alias, and those that end a FROM list.
const tableStarts = new Set(['FROM', 'JOIN', 'APPLY', 'INTO', 'UPDATE']);
const aliasStarts = new Set(['FROM', 'JOIN', 'APPLY']);
// The clauses a * can be read in: only in SELECT's is it every column.
const clauses = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'ON', 'SET', 'JOIN', 'VALUES']);
// ON is not one: FROM a JOIN b ON …, c goes on with c.
const fromEnds = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'SET', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'VALUES', 'OUTPUT']);
// Keywords that begin a statement, or a branch of a UNION: each has its own FROM, so its own scope.
const queryStarts = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE']);

/**
 * CodeMirror's SQL support for one database of the model, with the completion above in place of its own.
 * `used` says how often the reader picked a suggestion, by its key; the editor keeps the count in the browser.
 */
export function sqlSupport(model: Model, databaseName: string | undefined, used: (key: string) => number = () => 0): Extension {
  const { schema, defaultSchema } = completionSchema(model, databaseName);
  const index = knownTables(model, databaseName);
  const ranked = (options: Keyed[]) =>
    options.map((o) => {
      const picks = o.key ? used(o.key) : 0;
      return picks ? { ...o, boost: (o.boost ?? 0) + Math.min(picks * usedBoostPerPick, usedBoostMost) } : o;
    });
  const readings = new WeakMap<CompletionContext, Reading>();
  const read = (context: CompletionContext) => {
    let reading = readings.get(context);
    if (!reading) readings.set(context, (reading = readAt(context.state, context.pos, index)));
    return reading;
  };
  const keywords = keywordCompletionSource(tsql, true);
  const names = schemaCompletionSource({ dialect: tsql, schema: schema as unknown as SQLNamespace, defaultSchema });
  const sources: CompletionSource[] = [
    (context) => {
      const at = read(context);
      // Where a table goes, no keyword; after one, only what can follow it.
      if (at.afterDot || at.dotted || at.star || (at.tableSpot && at.aliasable && !at.quoted)) return null;
      const result = keywords(context) as CompletionResult | null;
      if (!result || !at.afterTable) return result;
      const joining = at.afterTable.joining;
      const options = result.options.filter((o) => afterTableWords.has(o.label)).map((o) => (joining && o.label === 'ON' ? { ...o, boost: (o.boost ?? 0) + onBoost } : o));
      return { ...result, options };
    },
    // Where a table takes an alias, the tables come from here, written with one; in a [quoted name], from
    // CodeMirror's own, which quotes what it offers.
    (context) => {
      const at = read(context);
      return at.quiet || at.dotted || at.star || at.afterTable || (at.tableSpot && at.aliasable && !at.quoted) ? null : names(context);
    },
    (context) => withRanks(columns(context, read(context), model), ranked),
    (context) => withRanks(tables(context, read(context), model, index), ranked),
    (context) => withRanks(snippetsAt(context, read(context)), ranked),
    (context) => withRanks(joins(context, read(context), model, databaseName), ranked),
  ];
  const databaseNameHere = (model.databases.find((d) => d.name === databaseName) ?? model.databases[0])?.name ?? '';
  return [setup.of({ model, databaseName: databaseNameHere, defaultSchema, index }), new LanguageSupport(tsql.language, sources.map((autocomplete) => tsql.language.data.of({ autocomplete })))];
}

function withRanks(result: CompletionResult | null, ranked: (options: Keyed[]) => Keyed[]): CompletionResult | null {
  return result && { ...result, options: ranked(result.options as Keyed[]) };
}

/** The key a suggestion is counted by when picked, and whether the list opens again after it. */
export function pickOf(completion: Completion): { key?: string; reopen: boolean } {
  const keyed = completion as Keyed;
  return { key: keyed.key, reopen: Boolean(keyed.reopen) };
}

/** After JOIN: the tables related to those already in the query, each with its ON clause written. */
function joins(context: CompletionContext, reading: Reading, model: Model, databaseName: string | undefined): CompletionResult | null {
  if (reading.quiet || !context.matchBefore(/\bJOIN\s+[\w.[\]]*$/i)) return null;
  const word = context.matchBefore(/[\w.[\]]*$/)!;
  // In joinCompletions' order (the query's tables in turn, what each points at first), not by label.
  const options = joinCompletions(model, context.state.doc.toString(), databaseName).map((j, i) => ({
    ...j,
    key: `join:${j.label}`,
    boost: writtenOutBoost,
    sortText: String(i).padStart(4, '0'),
  }));
  return options.length ? { from: word.from, options, validFor: /^[\w.[\]]*$/ } : null;
}

/** Columns where a column belongs, after ON the conditions that join on the keys, and after * the columns. */
function columns(context: CompletionContext, reading: Reading, model: Model): CompletionResult | null {
  if (reading.quiet || reading.quoted) return null;
  if (reading.star) {
    // Only on Ctrl+Space: typed, the list would open after every *, and Enter would take it for a new line.
    if (!context.explicit) return null;
    const options = expansions(reading, model).map((e, i): Keyed => ({
      label: context.state.sliceDoc(reading.star!.from, context.pos),
      displayLabel: `${e.count} columns`,
      detail: e.detail,
      apply: e.text,
      boost: writtenOutBoost - i,
    }));
    return options.length ? { from: reading.star.from, options, filter: false } : null;
  }
  if (reading.dotted) {
    const known = reading.dotted.known;
    const options = known.suggestions.children.map((c, i) => column(c, i, ownColumnBoost, '', 0, known));
    return { from: reading.dotted.from, options, validFor: /^\w*$/ };
  }
  if (reading.afterDot || reading.tableSpot) return null;
  const word = context.matchBefore(/\w*$/)!;
  const options: Completion[] = [];
  if (reading.on) options.push(...conditions(model, reading.on.joined, reading.on.earlier));
  // Columns wait for a letter or Ctrl+Space, as keywords do, so a space does not open a list of every column.
  if (word.text || context.explicit) {
    const qualify = reading.scope.length > 1;
    reading.scope.forEach((table, t) => {
      const boost = table.depth === 0 ? ownColumnBoost : outerColumnBoost;
      table.known.suggestions.children.forEach((c, i) => options.push(column(c, i, boost, qualify ? quoteName(table.name) : '', t, table.known)));
    });
  }
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null;
}

/** A column's suggestion, written after its table's name when `qualifier` is given; listed in table order. */
function column(suggestion: TableSuggestions['children'][number], at: number, boost: number, qualifier: string, table: number, known: Known): Keyed {
  const name = quoteName(suggestion.label);
  return {
    ...suggestion,
    key: `column:${known.ref}.${suggestion.label}`,
    apply: qualifier ? `${qualifier}.${name}` : name,
    detail: qualifier ? `${qualifier} · ${suggestion.detail}` : suggestion.detail,
    boost,
    sortText: `${String(table).padStart(3, '0')}${String(at).padStart(4, '0')}`,
  };
}

/** The ON conditions between the table just joined and those before it: from the keys, never guessed. */
function conditions(model: Model, joined: InScope, earlier: InScope[]): Completion[] {
  const out: Completion[] = [];
  const pair = (ownColumns: string[], other: InScope, otherColumns: string[]) => {
    const text = ownColumns.map((c, i) => `${quoteName(joined.name)}.${quoteName(c)} = ${quoteName(other.name)}.${quoteName(otherColumns[i])}`).join(' AND ');
    const detail = `${localRef(model, joined.known.ref)} ↔ ${localRef(model, other.known.ref)}`;
    if (!out.some((o) => o.label === text)) out.push({ label: text, type: 'keyword', detail, boost: writtenOutBoost, key: `on:${detail}` } as Keyed);
  };
  const { out: points, in: pointed } = relationsOf(model, joined.known.ref);
  // The nearest table first: the one joined just before is the likeliest partner.
  for (const other of [...earlier].reverse()) {
    for (const r of points) if (r.to.table === other.known.ref) pair(r.from.columns, other, r.to.columns);
    for (const r of pointed) if (r.from.table === other.known.ref) pair(r.to.columns, other, r.from.columns);
  }
  return out;
}

/**
 * Where a table takes an alias: every table of the database, or of the schema before the dot, written with
 * an alias the query has not taken, as the joins after JOIN are; and the schemas, to go on with a dot.
 */
function tables(context: CompletionContext, reading: Reading, model: Model, index: Map<string, Known>): CompletionResult | null {
  if (reading.quiet || reading.quoted || reading.dotted || !reading.tableSpot || !reading.aliasable) return null;
  // Open as soon as the space after FROM or JOIN is typed: a table is all that can come there.
  const word = context.matchBefore(/\w*$/)!;
  const schema = reading.qualifier?.[reading.qualifier.length - 1]?.toLowerCase();
  const options: Keyed[] = [];
  const fit = (columns: string[]) => {
    if (!reading.selected.length) return 0;
    const have = new Set(columns.map((c) => c.toLowerCase()));
    return (reading.selected.filter((c) => have.has(c)).length / reading.selected.length) * tableFitBoost;
  };
  const schemas = new Set<string>();
  for (const known of new Set(index.values())) {
    const local = localRef(model, known.ref);
    const schemaName = local.slice(0, local.indexOf('.'));
    schemas.add(schemaName);
    if (schema !== undefined && schemaName.toLowerCase() !== schema) continue;
    const table = known.suggestions.self;
    const name = schema === undefined ? quoteRef(local) : quoteName(table.label);
    options.push({
      ...table,
      key: `table:${known.ref}`,
      detail: `${schemaName} · ${table.detail}`,
      apply: reading.aliased ? name : `${name} AS ${aliasFor(table.label, new Set(reading.taken))}`,
      boost: fit(known.suggestions.children.map((c) => c.label)),
    });
  }
  // The query's own CTEs, where it can read them as tables.
  if (schema === undefined) {
    for (const cte of ctesAt(cteScopes(context.state), context.pos).values()) {
      options.push({ label: cte, type: 'type', detail: 'CTE', apply: reading.aliased ? quoteName(cte) : `${quoteName(cte)} AS ${aliasFor(cte, new Set(reading.taken))}` });
    }
  }
  // The schemas, to go on with a dot, after the tables and before the keywords.
  if (schema === undefined) for (const name of schemas) options.push({ label: name, type: 'type', detail: 'schema', boost: schemaBoost });
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null;
}

/** The snippets, once a word is typed where a query or a clause can start: not after a dot, nor where a table goes. */
function snippetsAt(context: CompletionContext, reading: Reading): CompletionResult | null {
  if (reading.quiet || reading.quoted || reading.afterDot || reading.dotted || reading.tableSpot || reading.star) return null;
  const word = context.matchBefore(/\w+$/);
  if (!word) return null;
  const options = snippets.map((s): Keyed => {
    const fields = s.template.includes('${');
    return {
      label: s.name,
      type: 'text',
      detail: s.template.split('\n')[0].replace(/\$\{(\w*)\}/g, '$1').trim() + (fields ? ' …' : ''),
      apply: fields ? snippet(s.template) : s.template,
      boost: snippetBoost,
      key: `snippet:${s.name}`,
      reopen: !fields,
    };
  });
  return { from: word.from, options, validFor: /^\w*$/ };
}

/** A * expanded: the columns written out, how many, what it left out, and whether it has protected ones. */
interface Expansion {
  text: string;
  count: number;
  detail: string;
  /** Masked, encrypted or labelled columns are in it: offered on Ctrl+Space, never written by Tab. */
  exposes: boolean;
}

/**
 * What * at the caret can be written as: the columns of the tables it covers (its own query's, or the one it
 * is qualified with), with their alias when more than one; first without the masked, encrypted and labelled
 * ones, as a starter leaves them out, then every column.
 */
function expansions(reading: Reading, model: Model): Expansion[] {
  const star = reading.star;
  // A bare * over a subquery or a table the model does not know covers columns that cannot be written here.
  if (!star || (!star.qualifier && reading.unknownOwn)) return [];
  const own = reading.scope.filter((s) => s.depth === 0);
  const covered = star.qualifier ? reading.scope.filter((s) => s.name.toLowerCase() === star.qualifier!.toLowerCase()).slice(0, 1) : own;
  const qualify = Boolean(star.qualifier) || covered.length > 1;
  // What SELECT * returns: a column the database hides from it is not written either.
  const columns = covered.flatMap((s) => (findTable(model, s.known.ref)?.table.columns ?? []).filter((c) => !c.hidden).map((c) => ({ column: c, table: s })));
  if (!columns.length) return [];
  const write = (list: typeof columns) => (star.spaced ? '' : ' ') + list.map(({ column, table }) => (qualify ? `${quoteName(table.name)}.` : '') + quoteName(column.name)).join(', ');
  const open = columns.filter(({ column }) => !isProtected(column));
  const left = columns.filter(({ column }) => isProtected(column)).map(({ column }) => column.name);
  const all = { text: write(columns), count: columns.length, detail: 'every column', exposes: left.length > 0 };
  if (!left.length) return [all];
  if (!open.length) return [{ ...all, detail: 'every column, masked, encrypted or labelled' }];
  return [{ text: write(open), count: open.length, detail: `leaves out ${left.join(', ')}: masked, encrypted or labelled`, exposes: false }, all];
}

/**
 * Tab after * in the select list: the change that writes its columns, without the protected ones. Null
 * anywhere else, and where that would lose or expose a column, so Tab does what it does elsewhere.
 */
export function expandStar(state: EditorState): TransactionSpec | null {
  const found = state.facet(setup);
  const pos = state.selection.main.head;
  if (!found || !state.selection.main.empty) return null;
  const reading = readAt(state, pos, found.index);
  const first = expansions(reading, found.model).find((e) => !e.exposes);
  if (!first || !reading.star) return null;
  return { changes: { from: reading.star.from, to: pos, insert: first.text }, selection: { anchor: reading.star.from + first.text.length } };
}

/** Every table of one database, by each way SQL there can name it, in lower case: table, schema.table, db.schema.table. */
function knownTables(model: Model, databaseName: string | undefined): Map<string, Known> {
  const { schema, defaultSchema } = completionSchema(model, databaseName);
  const database = model.databases.find((d) => d.name === databaseName) ?? model.databases[0];
  const index = new Map<string, Known>();
  for (const s of database?.schemas ?? []) {
    for (const t of s.tables) {
      const ref = tableRef(s.name, t.name);
      const local = localRef(model, ref);
      const schemaName = local.slice(0, local.indexOf('.'));
      const known = { ref, suggestions: schema[schemaName][t.name] };
      const key = (...parts: string[]) => parts.join('.').toLowerCase();
      index.set(key(schemaName, t.name), known);
      index.set(key(database.name, schemaName, t.name), known);
      if (schemaName === defaultSchema && !index.has(key(t.name))) index.set(key(t.name), known);
    }
  }
  return index;
}

/** What is at `pos`: the place, the tables in scope there, and the table a name-and-dot before it names. */
export function readAt(state: EditorState, pos: number, index: Map<string, Known>): Reading {
  const reading: Reading = {
    quiet: false,
    quoted: false,
    afterDot: false,
    tableSpot: false,
    aliasable: false,
    taken: new Set(),
    aliased: false,
    selected: [],
    unknownOwn: false,
    scope: [],
  };
  const tree = syntaxTree(state);
  const here = tree.resolveInner(pos, -1);
  if (/^(String|LineComment|BlockComment)$/.test(here.name) && here.from < pos) return { ...reading, quiet: true };
  reading.quoted = here.name === 'QuotedIdentifier' && here.from < pos;

  // The statement and the parentheses around the caret, innermost first.
  const levels: Node[] = [];
  for (let node: Node | null = tree.topNode; node; ) {
    let inner: Node | null = null;
    for (let child: Node | null = node.firstChild; child && child.from < pos; child = child.nextSibling) {
      if ((child.name === 'Statement' || child.name === 'Parens') && (pos < child.to || isOpen(child))) inner = child;
    }
    if (inner) levels.unshift(inner);
    node = inner;
  }

  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const word = /\w*$/.exec(state.sliceDoc(Math.max(0, pos - 250), pos))![0];
  const wordFrom = pos - word.length;
  // After name-and-dot, the place is read from before the name: FROM billing.| is still where a table goes.
  // T-SQL allows space around the dot: dbo. Customers is still dbo's.
  const qualified = /((?:(?:\[(?:[^\]]|\]\])*\]|"[^"]*"|\w+)\s*\.\s*)+)\w*$/.exec(state.sliceDoc(Math.max(0, pos - 250), pos));
  const nameFrom = qualified ? wordFrom - qualified[1].length : wordFrom;
  let anchor = wordFrom;
  // Names a query nearer the caret binds: an outer table of the same name is hidden by it, as in SQL.
  const bound = new Set<string>();
  // Names bound to a CTE, a subquery or a table the model does not know: a dot after one names no model table.
  const boundElsewhere = new Set<string>();
  const scopes = cteScopes(state);
  const isCte = (name: string, at: number) => ctesAt(scopes, at).has(name);
  levels.forEach((level, depth) => {
    const tokens = tokensOf(level);
    const segment = segmentAround(tokens, anchor, text);
    const items = fromItems(segment, text, index, isCte);
    for (const item of items) {
      const name = item.name.toLowerCase();
      if (bound.has(name)) continue;
      if (item.known) reading.scope.push({ name: item.name, known: item.known, depth });
      else boundElsewhere.add(name);
    }
    for (const item of items) bound.add(item.name.toLowerCase());
    for (const item of items) if (item.name) reading.taken.add(item.name.toLowerCase());
    if (depth === 0) {
      const before = segment.filter((t) => t.to <= nameFrom);
      const prev = before[before.length - 1];
      const prevWord = prev?.name === 'Keyword' ? text(prev).toUpperCase() : '';
      const inFrom = fromListAt(before, text);
      const named = tableStarts.has(prevWord) || (isComma(prev, text) && inFrom);
      reading.tableSpot = named || items.some((item) => item.ends.includes(prev?.to ?? -1));
      reading.aliasable = named && (aliasStarts.has(prevWord) || isComma(prev, text));
      if (reading.tableSpot && !named) {
        const start = [...before].reverse().find((t) => t.name === 'Keyword' && (tableStarts.has(text(t).toUpperCase()) || text(t).toUpperCase() === 'ON'));
        reading.afterTable = { joining: start !== undefined && text(start).toUpperCase() === 'JOIN' };
      }
      reading.selected = selectedColumns(segment, text);
      reading.star = starAt(state, pos, segment, text);
      reading.aliased = (items.find((item) => item.at === nameFrom)?.ends.length ?? 0) > 1;
      reading.unknownOwn = items.some((item) => !item.known);
      if (prevWord === 'ON') {
        // The table this ON is for is the last one named; when the model does not know it, or it is a
        // subquery, there is no key to offer, and an earlier join's condition would leave it unconstrained.
        const named = items.filter((item) => item.at < wordFrom);
        const joined = named[named.length - 1];
        const earlier = named.slice(0, -1).flatMap((item) => (item.known ? [{ name: item.name, known: item.known, depth }] : []));
        if (joined?.known && earlier.length) reading.on = { joined: { name: joined.name, known: joined.known, depth }, earlier };
      }
    }
    anchor = level.from;
  });

  // After name-and-dot: the name as the query uses it here, else as the model knows it.
  if (qualified) {
    reading.afterDot = true;
    const parts = (qualified[1].match(/\[(?:[^\]]|\]\])*\]|"[^"]*"|\w+/g) ?? []).map(unquote);
    reading.qualifier = parts;
    const named = parts.length === 1 ? reading.scope.find((s) => s.name.toLowerCase() === parts[0].toLowerCase())?.known : undefined;
    const elsewhere = parts.length === 1 && boundElsewhere.has(parts[0].toLowerCase());
    const known = named ?? (elsewhere ? undefined : index.get(parts.join('.').toLowerCase()));
    if (known) reading.dotted = { known, from: wordFrom };
  }
  return reading;
}

/**
 * A * the caret is just after, when it stands for every column: in SELECT's list, after SELECT, DISTINCT,
 * TOP (n) or a comma, alone or after an alias and a dot. Not COUNT(*), nor a product.
 */
function starAt(state: EditorState, pos: number, segment: Node[], text: (n: Node) => string): Reading['star'] {
  const found = /(?:(\[(?:[^\]]|\]\])*\]|"[^"]*"|\w+)\.)?\*$/.exec(state.sliceDoc(Math.max(0, pos - 250), pos));
  if (!found) return undefined;
  const from = pos - found[0].length;
  const before = segment.filter((t) => t.to <= from);
  const clause = [...before].reverse().find((t) => t.name === 'Keyword' && clauses.has(text(t).toUpperCase()));
  if (!clause || text(clause).toUpperCase() !== 'SELECT') return undefined;
  const prev = before[before.length - 1];
  const prevWord = prev?.name === 'Keyword' ? text(prev).toUpperCase() : '';
  const afterTop = (prev?.name === 'Parens' || prev?.name === 'Number') && text(before[before.length - 2] ?? prev).toUpperCase() === 'TOP';
  if (!(prevWord === 'SELECT' || prevWord === 'DISTINCT' || prevWord === 'ALL' || isComma(prev, text) || afterTop)) return undefined;
  // SELECT* is valid; written out, the columns need the space the * did not.
  const spaced = !/\w$/.test(state.sliceDoc(Math.max(0, from - 1), from));
  return { from, qualifier: found[1] === undefined ? undefined : unquote(found[1]), spaced };
}

/** A statement's or a parenthesis' own tokens. Comments are not the query: a table and its alias read the same with one between them. */
function tokensOf(level: Node): Node[] {
  return children(level).filter((t) => !/^(\(|\)|LineComment|BlockComment)$/.test(t.name));
}

/** Every table the query names, at every level, as written: what the check holds to the model. */
export function namesInQuery(state: EditorState, index: Map<string, Known>): FromItem[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const items: FromItem[] = [];
  const scopes = cteScopes(state);
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Statement' || ref.name === 'Parens') items.push(...fromItems(tokensOf(ref.node), text, index, (name, at) => ctesAt(scopes, at).has(name)));
    },
  });
  return items;
}

/** A name the query's WITH gives, in lower case and as written, and the stretch of the query it stands in. */
interface Cte {
  name: string;
  written: string;
  from: number;
  to: number;
}

// Keywords before a SELECT that joins the query before it, rather than starting one of its own.
const branchJoins = new Set(['UNION', 'ALL', 'EXCEPT', 'INTERSECT']);

/**
 * The names each WITH gives: WITH name AS (…), name (a, b) AS (…). Each stands in its own query, from the WITH
 * to the next query that is not one of its UNION branches; a table so named there is the CTE, not the model's.
 */
function cteScopes(state: EditorState): Cte[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const scopes: Cte[] = [];
  const word = (t: Node | undefined) => (t?.name === 'Keyword' ? text(t).toUpperCase() : '');
  for (let statement = syntaxTree(state).topNode.firstChild; statement; statement = statement.nextSibling) {
    if (statement.name !== 'Statement') continue;
    const tokens = tokensOf(statement);
    tokens.forEach((t, w) => {
      if (word(t) !== 'WITH' || !(tokens[w + 1]?.name === 'Identifier' || tokens[w + 1]?.name === 'QuotedIdentifier')) return;
      const names: string[] = [];
      let i = w + 1;
      for (;;) {
        const name = tokens[i];
        if (!(name?.name === 'Identifier' || name?.name === 'QuotedIdentifier')) break;
        const as = tokens[i + 1]?.name === 'Parens' ? i + 2 : i + 1;
        if (word(tokens[as]) !== 'AS' || tokens[as + 1]?.name !== 'Parens') break;
        names.push(unquote(text(name)));
        i = as + 2;
        if (!isComma(tokens[i], text)) break;
        i++;
      }
      // The query the WITH belongs to starts at i; the next one that is not its UNION branch ends it.
      const next = tokens.findIndex((u, k) => k > i && queryStarts.has(word(u)) && !branchJoins.has(word(tokens[k - 1])));
      const to = next < 0 ? statement!.to : tokens[next].from;
      for (const name of names) scopes.push({ name: name.toLowerCase(), written: name, from: t.from, to });
    });
  }
  return scopes;
}

/** The CTEs that stand at `pos`, by name in lower case, each to its name as written. */
function ctesAt(scopes: Cte[], pos: number): Map<string, string> {
  return new Map(scopes.filter((c) => c.from <= pos && pos <= c.to).map((c) => [c.name, c.written]));
}

/** A box on the screen, as CodeMirror measures the list, the option, its description and the room there is. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// CodeMirror's own widest description, and the margin it keeps from the edge.
const infoWidest = 400;

/**
 * Where a suggestion's description goes: beside the list, level with the option, when there is room; on a
 * narrow screen under the whole list, or over it when there is no room below. CodeMirror's own puts it just
 * under the option, over the suggestions after it.
 */
export function infoPlacement(list: Box, option: Box, info: Box, space: Box): { style: string; class: string } {
  const width = info.right - info.left;
  const height = info.bottom - info.top;
  const right = space.right - list.right;
  const left = list.left - space.left;
  if (width <= right || width <= left) {
    const top = Math.max(space.top, Math.min(option.top, space.bottom - height)) - list.top;
    return { style: `top: ${top}px; max-width: ${Math.min(infoWidest, width <= right ? right : left)}px`, class: width <= right ? 'cm-completionInfo-right' : 'cm-completionInfo-left' };
  }
  const tall = list.bottom - list.top;
  const below = space.bottom - list.bottom >= height || space.bottom - list.bottom > list.top - space.top;
  return { style: `${below ? 'top' : 'bottom'}: ${tall}px; max-width: ${Math.min(infoWidest, list.right - list.left)}px`, class: 'cm-completionInfo-under' };
}

function isOpen(node: Node): boolean {
  const last = node.lastChild?.name;
  return node.name === 'Parens' ? last !== ')' : last !== ';';
}

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let child: Node | null = node.firstChild; child; child = child.nextSibling) out.push(child);
  return out;
}

function isComma(node: Node | undefined, text: (n: Node) => string): boolean {
  return Boolean(node && text(node) === ',');
}

/** The tokens of the one query around `at`: from the SELECT, UPDATE and so on before it to the next. */
function segmentAround(tokens: Node[], at: number, text: (n: Node) => string): Node[] {
  let start = 0;
  let end = tokens.length;
  tokens.forEach((t, i) => {
    if (t.name !== 'Keyword' || !queryStarts.has(text(t).toUpperCase())) return;
    if (t.from <= at) start = i;
    else if (i < end && t.from > at) end = Math.min(end, i);
  });
  return tokens.slice(start, end);
}

/**
 * The columns a query's select list names, in lower case: a bare name, or the last part of a qualified one.
 * Not a column's alias, written `x AS a`, `x a` or `a = x`, nor a keyword or a function.
 */
function selectedColumns(segment: Node[], text: (n: Node) => string): string[] {
  const out: string[] = [];
  const start = segment.findIndex((t) => t.name === 'Keyword' && text(t).toUpperCase() === 'SELECT');
  if (start < 0) return out;
  const end = segment.findIndex((t, i) => i > start && t.name === 'Keyword' && text(t).toUpperCase() === 'FROM');
  // The select list's items, split at its commas (a function's are inside its parentheses).
  const items: Node[][] = [[]];
  for (const t of segment.slice(start + 1, end < 0 ? undefined : end)) {
    if (isComma(t, text)) items.push([]);
    else items[items.length - 1].push(t);
  }
  const isName = (t: Node | undefined) => t?.name === 'Identifier' || t?.name === 'QuotedIdentifier';
  for (let item of items) {
    const as = item.findIndex((t) => t.name === 'Keyword' && text(t).toUpperCase() === 'AS');
    if (as >= 0) item = item.slice(0, as);
    else if (isName(item[0]) && item[1]?.name === 'Operator' && text(item[1]) === '=') item = item.slice(2);
    else if (item.length > 1 && isName(item[item.length - 1]) && item[item.length - 2]?.name !== 'Operator') item = item.slice(0, -1);
    item.forEach((t, i) => {
      if (item[i + 1]?.name === 'Parens') return;
      if (isName(t)) out.push(unquote(text(t)).toLowerCase());
      else if (t.name === 'CompositeIdentifier') {
        const parts = pathOf(t, text);
        if (parts.length > 1 && parts[parts.length - 1]) out.push(parts[parts.length - 1].toLowerCase());
      }
    });
  }
  return out;
}

/** Whether the last of these tokens is inside a FROM list, where a comma brings another table. */
function fromListAt(tokens: Node[], text: (n: Node) => string): boolean {
  let inFrom = false;
  for (const t of tokens) {
    if (t.name !== 'Keyword') continue;
    const word = text(t).toUpperCase();
    if (word === 'FROM') inFrom = true;
    else if (fromEnds.has(word)) inFrom = false;
  }
  return inFrom;
}

/**
 * A table the query names after FROM, JOIN and the like, with the alias it gives it: known to the model, or
 * not (a CTE, a table it has not read, or a subquery, which has only its alias).
 */
export interface FromItem {
  name: string;
  known?: Known;
  at: number;
  /** Its name as written, part by part, without quotes; empty for a subquery. */
  path: string[];
  /** Where its name ends. */
  to: number;
  /** A table-valued function, called: dbo.fn(1). */
  call: boolean;
  /** A name the query's own WITH gives, where it stands. */
  cte: boolean;
  /** Where its name and its alias end: the caret just after either is still in the FROM list. */
  ends: number[];
}

// SQL Server's table hints: in parentheses after a table, they are not a function's arguments.
const tableHints = new Set(
  ('NOLOCK READUNCOMMITTED UPDLOCK HOLDLOCK ROWLOCK TABLOCK TABLOCKX PAGLOCK NOWAIT READPAST XLOCK SERIALIZABLE ' +
    'REPEATABLEREAD READCOMMITTED READCOMMITTEDLOCK SNAPSHOT INDEX FORCESEEK FORCESCAN NOEXPAND KEEPIDENTITY ' +
    'KEEPDEFAULTS IGNORE_CONSTRAINTS IGNORE_TRIGGERS SPATIAL_WINDOW_MAX_CELLS').split(' '),
);

/** Parentheses that hold table hints: (NOLOCK), (INDEX(ix), UPDLOCK). */
function isHint(parens: Node, text: (n: Node) => string): boolean {
  const first = children(parens).find((t) => t.name !== '(');
  return Boolean(first && tableHints.has(text(first).toUpperCase()));
}

function fromItems(tokens: Node[], text: (n: Node) => string, index: Map<string, Known>, isCte: (name: string, at: number) => boolean = () => false): FromItem[] {
  const items: FromItem[] = [];
  let expect = false;
  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const word = t.name === 'Keyword' ? text(t).toUpperCase() : '';
    // A new query, with or without a semicolon before it: its FROM list is its own.
    if (queryStarts.has(word)) {
      inFrom = false;
      expect = false;
    }
    if (tableStarts.has(word)) {
      expect = true;
      inFrom = word === 'FROM' || inFrom;
      continue;
    }
    if (fromEnds.has(word)) inFrom = false;
    if (isComma(t, text) && inFrom) {
      expect = true;
      continue;
    }
    if (!expect || !(isName(t) || t.name === 'Parens')) {
      expect = false;
      continue;
    }
    expect = false;
    const parts = t.name === 'Parens' ? [''] : pathOf(t, text);
    const next = tokens[i + 1];
    const hint = t.name !== 'Parens' && next?.name === 'Parens' && isHint(next, text);
    const call = t.name !== 'Parens' && next?.name === 'Parens' && !hint;
    // A CTE's name is the CTE's, even when the model has a table of that name.
    const cte = t.name !== 'Parens' && parts.length === 1 && isCte(parts[0].toLowerCase(), t.from);
    const item: FromItem = {
      name: parts[parts.length - 1],
      known: t.name === 'Parens' || call || cte ? undefined : index.get(parts.join('.').toLowerCase()),
      at: t.from,
      to: t.to,
      path: t.name === 'Parens' ? [] : parts,
      call,
      cte,
      ends: [t.to],
    };
    let j = call || hint ? i + 2 : i + 1;
    if (tokens[j]?.name === 'Keyword' && text(tokens[j]).toUpperCase() === 'AS') j++;
    if (tokens[j] && (tokens[j].name === 'Identifier' || tokens[j].name === 'QuotedIdentifier')) {
      item.name = unquote(text(tokens[j]));
      item.ends.push(tokens[j].to);
      i = j;
    }
    items.push(item);
  }
  return items;
}

function isName(node: Node): boolean {
  return node.name === 'Identifier' || node.name === 'QuotedIdentifier' || node.name === 'CompositeIdentifier';
}

function pathOf(node: Node, text: (n: Node) => string): string[] {
  if (node.name !== 'CompositeIdentifier') return [unquote(text(node))];
  return children(node).filter(isName).map((n) => unquote(text(n)));
}

/** A name as written, without its [brackets] or "quotes". */
export function unquote(name: string): string {
  if (/^\[.*\]$/s.test(name)) return name.slice(1, -1).replace(/]]/g, ']');
  if (/^".*"$/s.test(name)) return name.slice(1, -1).replace(/""/g, '"');
  return name;
}
