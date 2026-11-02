// The SQL editor's autocomplete. CodeMirror's SQL support completes a name from the schema wherever a name
// can go; this reads the query as CodeMirror parses it, to know what belongs at the caret. In an expression,
// the columns of the tables in scope there, a subquery's own before its outer query's, written with their
// table's alias when more than one is in scope; a CTE's and a subquery's are the names its select list gives.
// After an alias and a dot, that table's columns alone. After ON, the conditions the keys give; after JOIN, the
// joins. After FROM and JOIN, a table with an alias. After GROUP BY, what the select list does not aggregate,
// and in GROUP BY and ORDER BY what it names first. Tab after * in the select list writes the columns, and a
// few snippets write the start of a read. What the reader picks is counted, and comes first among equals. Pure,
// so the cases in test/complete.test.ts and the bench in test/ranking.test.ts run it as the editor does.
import { snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { keywordCompletionSource, MSSQL, schemaCompletionSource, SQLDialect, type SQLNamespace } from '@codemirror/lang-sql';
import { ensureSyntaxTree, LanguageSupport, syntaxTree } from '@codemirror/language';
import { Facet, type EditorState, type Extension, type TransactionSpec } from '@codemirror/state';
import { findTable, localRef, relationsOf, tableRef, type Model } from 'dbtour/model';
import { aliasFor, completionSchema, isProtected, joinCompletions, quoteName, quoteRef, type Suggestion, type TableSuggestions } from './query.ts';

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
// In GROUP BY and ORDER BY, a column the select list names comes a point above the query's other columns, in
// the select list's order; in ORDER BY a name the select list gives a column (its alias) a point above that, as
// it names what only the select list computes and ORDER BY is the one clause that can read it.
const selectedBoost = 1;
const selectAliasBoost = 2;
// T-SQL's aggregates: a select list with one groups its rows, and its other items are what GROUP BY lists.
const aggregates = new Set(
  ('AVG CHECKSUM_AGG COUNT COUNT_BIG GROUPING GROUPING_ID MAX MIN STDEV STDEVP STRING_AGG SUM VAR VARP ' +
    'APPROX_COUNT_DISTINCT APPROX_PERCENTILE_CONT APPROX_PERCENTILE_DISC').split(' '),
);
// Where a select list ends: its query's next clause, or a UNION, with FROM or without.
const selectEnds = new Set(['FROM', 'INTO', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'FOR']);
// An ORDER BY alias says what it names, cut to this many characters: the list's descriptions are one line.
const detailLongest = 40;

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
type Tree = ReturnType<typeof syntaxTree>;

// CodeMirror parses a new document only so far, and the rest in the background; asked for the whole, it is
// given this long to finish, a few frames, enough for a long query, and what it has by then is read.
const parseBudgetMs = 50;
const trees = new WeakMap<EditorState, Tree>();

// What one state's query is read into, kept for the next reference in the same state: the check asks about
// every qualified name, and reading the statement again for each made a long query's check quadratic.
const memo = new WeakMap<EditorState, Map<string, unknown>>();

function memoOf(state: EditorState): Map<string, unknown> {
  let known = memo.get(state);
  if (!known) memo.set(state, (known = new Map()));
  return known;
}

function cached<T>(state: EditorState, key: string, make: () => T): T {
  const known = memoOf(state);
  if (!known.has(key)) known.set(key, make());
  return known.get(key) as T;
}

/** The query's syntax tree to its end, parsed once per state: the check and the reader read all of it. */
export function treeOf(state: EditorState): Tree {
  let tree = trees.get(state);
  if (!tree) trees.set(state, (tree = ensureSyntaxTree(state, state.doc.length, parseBudgetMs) ?? syntaxTree(state)));
  return tree;
}

/** A table of the model, by its ref, its name in this database's SQL, and what autocomplete says of it. */
export interface Known {
  ref: string;
  suggestions: TableSuggestions;
  /** A CTE or a subquery, its columns read from its select list: not the model's, so not the check's. */
  derived?: boolean;
  /** A CTE or a subquery whose select list names every column it returns, so * over it can be written out. */
  complete?: boolean;
}

/** A CTE's or a subquery's column: what autocomplete says of it, and whether it passes on a protected column. */
interface DerivedColumn extends Suggestion {
  protected?: boolean;
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
  /**
   * In GROUP BY or ORDER BY: which, whether the caret is where its list starts, the query's select list, and
   * the names the clause has already, in lower case.
   */
  by?: { clause: 'GROUP' | 'ORDER'; start: boolean; items: SelectItem[]; written: string[][] };
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
    // The alias written before the dot: in a self-join two aliases name the same table.
    const written = reading.qualifier?.length === 1 ? reading.qualifier[0].toLowerCase() : undefined;
    const table = reading.scope.find((s) => s.depth === 0 && s.known === known && (written === undefined || s.name.toLowerCase() === written));
    const options = known.suggestions.children.map((c, i) => leading(column(c, i, ownColumnBoost, '', 0, known), reading.by, table, c.label));
    return { from: reading.dotted.from, options, validFor: /^\w*$/ };
  }
  if (reading.afterDot || reading.tableSpot) return null;
  const word = context.matchBefore(/\w*$/)!;
  const options: Completion[] = [];
  if (reading.on) options.push(...conditions(model, reading.on.joined, reading.on.earlier));
  const by = reading.by;
  // Where GROUP BY's list starts, in a query that aggregates: what it does not, as the select list writes it.
  if (by?.clause === 'GROUP' && by.start && by.items.some((i) => i.aggregate)) {
    const grouped = by.items.flatMap((i) => i.groups).filter((g, k, all) => all.findIndex((h) => h.toLowerCase() === g.toLowerCase()) === k);
    const label = grouped.join(', ');
    if (grouped.length) options.push({ label, type: 'keyword', detail: grouped.length === 1 ? 'not aggregated' : `${grouped.length} items not aggregated`, boost: writtenOutBoost });
  }
  // Columns wait for a letter or Ctrl+Space, as keywords do, so a space does not open a list of every column.
  if (word.text || context.explicit) {
    const qualify = reading.scope.length > 1;
    reading.scope.forEach((table, t) => {
      const boost = table.depth === 0 ? ownColumnBoost : outerColumnBoost;
      table.known.suggestions.children.forEach((c, i) => options.push(leading(column(c, i, boost, qualify ? quoteName(table.name) : '', t, table.known), by, table, c.label)));
    });
    // ORDER BY can read the names the select list gives; GROUP BY and WHERE cannot.
    if (by?.clause === 'ORDER') {
      by.items.forEach((item, at) => {
        if (!item.aliased || !item.name || by.written.some((w) => sameColumn(w, [item.name!.toLowerCase()]))) return;
        const detail = item.text.length > detailLongest ? `${item.text.slice(0, detailLongest - 1)}…` : item.text;
        options.push({ label: item.name, apply: quoteName(item.name), type: 'property', detail, boost: ownColumnBoost + selectAliasBoost, sortText: String(at).padStart(4, '0') });
      });
    }
  }
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null;
}

/**
 * In GROUP BY and ORDER BY, a column of the caret's own query that the select list names and the clause has
 * not yet: a point up, in the select list's order. Any other is as it was.
 */
function leading(option: Keyed, by: Reading['by'], table: InScope | undefined, name: string): Keyed {
  if (!by || !table || table.depth > 0) return option;
  const here = [table.name.toLowerCase(), name.toLowerCase()];
  const at = by.items.findIndex((item) => {
    const path = item.path?.map((p) => p.toLowerCase());
    return path !== undefined && sameColumn(path, here) && !by.written.some((w) => sameColumn(w, path));
  });
  return at < 0 ? option : { ...option, boost: (option.boost ?? 0) + selectedBoost, sortText: String(at).padStart(4, '0') };
}

/** Whether two names written for a column, in lower case, are the same one: its table too when both say it. */
function sameColumn(a: string[], b: string[]): boolean {
  return a[a.length - 1] === b[b.length - 1] && (a.length === 1 || b.length === 1 || a[a.length - 2] === b[b.length - 2]);
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
      const written = cte.written;
      const columns = cteColumns(context.state, cte, index).map((c) => c.label);
      options.push({ label: written, type: 'type', detail: 'CTE', apply: reading.aliased ? quoteName(written) : `${quoteName(written)} AS ${aliasFor(written, new Set(reading.taken))}`, boost: fit(columns) });
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
  // A bare * over a table the model does not know, or a subquery whose columns it cannot all name, covers
  // columns that cannot be written here.
  if (!star || (!star.qualifier && reading.unknownOwn)) return [];
  const own = reading.scope.filter((s) => s.depth === 0);
  const covered = star.qualifier ? reading.scope.filter((s) => s.name.toLowerCase() === star.qualifier!.toLowerCase()).slice(0, 1) : own;
  if (covered.some((s) => s.known.derived && !s.known.complete)) return [];
  const qualify = Boolean(star.qualifier) || covered.length > 1;
  // What SELECT * returns: a column the database hides from it is not written either.
  const columns = covered.flatMap((s) =>
    s.known.derived
      ? s.known.suggestions.children.map((c) => ({ name: c.label, protected: Boolean((c as DerivedColumn).protected), table: s }))
      : (findTable(model, s.known.ref)?.table.columns ?? []).filter((c) => !c.hidden).map((c) => ({ name: c.name, protected: isProtected(c), table: s })),
  );
  if (!columns.length) return [];
  const write = (list: typeof columns) => (star.spaced ? '' : ' ') + list.map(({ name, table }) => (qualify ? `${quoteName(table.name)}.` : '') + quoteName(name)).join(', ');
  const open = columns.filter((c) => !c.protected);
  const left = columns.filter((c) => c.protected).map((c) => c.name);
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

/**
 * What is at `pos`: the place, the tables in scope there, and the table a name-and-dot before it names. The
 * check, which needs only the last, says `place: false`, and the place (what fits there) is not worked out.
 */
export function readAt(state: EditorState, pos: number, index: Map<string, Known>, { place = true }: { place?: boolean } = {}): Reading {
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
  const tree = treeOf(state);
  const here = tree.resolveInner(pos, -1);
  if (/^(String|LineComment|BlockComment)$/.test(here.name) && here.from < pos) return { ...reading, quiet: true };
  reading.quoted = here.name === 'QuotedIdentifier' && here.from < pos;

  // The statement and the parentheses around the caret, innermost first: up from the token at it, or, in
  // the space after an open statement or parenthesis, which no token holds, down from the top.
  const levels: Node[] = [];
  const around = (n: Node) => (n.name === 'Statement' || n.name === 'Parens') && n.from < pos && (pos < n.to || isOpen(n));
  for (let n: Node | null = here; n; n = n.parent) if (around(n)) levels.push(n);
  if (levels[levels.length - 1]?.name !== 'Statement') {
    levels.length = 0;
    for (let node: Node | null = tree.topNode; node; ) {
      let inner: Node | null = null;
      for (let child: Node | null = node.firstChild; child && child.from < pos; child = child.nextSibling) if (around(child)) inner = child;
      if (inner) levels.unshift(inner);
      node = inner;
    }
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
  levels.forEach((level, depth) => {
    const { segment, items } = queryAround(state, level, anchor, index);
    for (const item of items) {
      const name = item.name.toLowerCase();
      if (bound.has(name)) continue;
      const known = item.known ?? derivedOf(state, item, index);
      if (known) reading.scope.push({ name: item.name, known, depth });
      else boundElsewhere.add(name);
    }
    for (const item of items) bound.add(item.name.toLowerCase());
    for (const item of items) if (item.name) reading.taken.add(item.name.toLowerCase());
    if (depth === 0 && place) {
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
      reading.selected = cached(state, `selected:${segment[0]?.from}`, () => selectedColumns(state, selectItemsOf(state, segment)));
      const clause = [...before].reverse().find((t) => t.name === 'Keyword' && clauses.has(text(t).toUpperCase()));
      const clauseWord = clause ? text(clause).toUpperCase() : '';
      if (clause && (clauseWord === 'GROUP' || clauseWord === 'ORDER')) {
        const list = before.slice(before.indexOf(clause) + 2);
        reading.by = {
          clause: clauseWord,
          start: prevWord === 'BY',
          items: selectItemsOf(state, segment),
          written: list.filter(isName).map((t) => pathOf(t, text).map((p) => p.toLowerCase())),
        };
      }
      reading.star = starAt(state, pos, segment, text);
      reading.aliased = (items.find((item) => item.at === nameFrom)?.ends.length ?? 0) > 1;
      reading.unknownOwn = items.some((item) => !item.known && !derivedOf(state, item, index)?.complete);
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
  treeOf(state).iterate({
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
  /** Its query, in parentheses. */
  body: Node;
  /** The names after its own, when it gives them: WITH r (a, b) AS (…). */
  columns?: string[];
}

// Keywords before a SELECT that joins the query before it, rather than starting one of its own.
const branchJoins = new Set(['UNION', 'ALL', 'EXCEPT', 'INTERSECT']);

/**
 * The names each WITH gives: WITH name AS (…), name (a, b) AS (…). Each stands in its own query, from the WITH
 * to the next query that is not one of its UNION branches; a table so named there is the CTE, not the model's.
 */
function cteScopes(state: EditorState): Cte[] {
  return cached(state, 'ctes', () => readCteScopes(state));
}

function readCteScopes(state: EditorState): Cte[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const scopes: Cte[] = [];
  const word = (t: Node | undefined) => (t?.name === 'Keyword' ? text(t).toUpperCase() : '');
  for (let statement = treeOf(state).topNode.firstChild; statement; statement = statement.nextSibling) {
    if (statement.name !== 'Statement') continue;
    const tokens = tokensOf(statement);
    tokens.forEach((t, w) => {
      if (word(t) !== 'WITH' || !(tokens[w + 1]?.name === 'Identifier' || tokens[w + 1]?.name === 'QuotedIdentifier')) return;
      const names: { name: string; body: Node; columns?: string[] }[] = [];
      let i = w + 1;
      for (;;) {
        const name = tokens[i];
        if (!(name?.name === 'Identifier' || name?.name === 'QuotedIdentifier')) break;
        const list = tokens[i + 1]?.name === 'Parens' ? tokens[i + 1] : undefined;
        const as = list ? i + 2 : i + 1;
        if (word(tokens[as]) !== 'AS' || tokens[as + 1]?.name !== 'Parens') break;
        const columns = list && children(list).filter((n) => n.name === 'Identifier' || n.name === 'QuotedIdentifier').map((n) => unquote(text(n)));
        names.push({ name: unquote(text(name)), body: tokens[as + 1], columns });
        i = as + 2;
        if (!isComma(tokens[i], text)) break;
        i++;
      }
      // The query the WITH belongs to starts at i; the next one that is not its UNION branch ends it.
      const next = tokens.findIndex((u, k) => k > i && queryStarts.has(word(u)) && !branchJoins.has(word(tokens[k - 1])));
      const to = next < 0 ? statement!.to : tokens[next].from;
      for (const { name, body, columns } of names) scopes.push({ name: name.toLowerCase(), written: name, from: t.from, to, body, columns });
    });
  }
  return scopes;
}

/** The CTEs that stand at `pos`, by name in lower case; of two of a name, the nearer. */
function ctesAt(scopes: Cte[], pos: number): Map<string, Cte> {
  return new Map(scopes.filter((c) => c.from <= pos && pos <= c.to).map((c) => [c.name, c]));
}

/** A CTE's columns: the names its select list gives, or those after its own name, which rename them in turn. */
function cteColumns(state: EditorState, cte: Cte, index: Map<string, Known>): DerivedColumn[] {
  return renamed(outputsOf(state, cte.body, index, 'CTE').columns, cte.columns, 'CTE');
}

/** A query's columns by place, as the names given after a CTE's name or a subquery's alias rename them, or by their own. */
function renamed(read: (DerivedColumn | undefined)[], names: string[] | undefined, kind: 'CTE' | 'subquery'): DerivedColumn[] {
  if (!names) return read.filter((c) => c !== undefined);
  return names.map((label, i) => ({ ...(read[i] ?? { type: 'property', detail: `${kind} column` }), label }));
}

/**
 * A CTE or a subquery the query reads, as a table: its columns read from its select list. Not for one without
 * a name to put before a dot (a subquery without an alias is not T-SQL), nor for anything else.
 */
function derivedOf(state: EditorState, item: FromItem, index: Map<string, Known>): Known | undefined {
  if (!item.name) return undefined;
  const cte = item.cte ? ctesAt(cteScopes(state), item.at).get(item.path[0].toLowerCase()) : undefined;
  // Names given after it say every column there is; else its select list must name each.
  if (cte) {
    const complete = Boolean(cte.columns) || outputsOf(state, cte.body, index, 'CTE').complete;
    return { ref: `cte:${cte.name}`, suggestions: { self: { label: cte.written, type: 'type', detail: 'CTE' }, children: cteColumns(state, cte, index) }, derived: true, complete };
  }
  if (item.body) {
    const read = outputsOf(state, item.body, index, 'subquery');
    const children = renamed(read.columns, item.columns, 'subquery');
    return { ref: `subquery:${item.name.toLowerCase()}`, suggestions: { self: { label: item.name, type: 'type', detail: 'subquery' }, children }, derived: true, complete: Boolean(item.columns) || read.complete };
  }
  return undefined;
}

/**
 * The columns a query in parentheses returns, in order: each item of its select list by the name it gives, or
 * none when it gives none, its place kept for names given after; for * and alias.*, the columns of what it
 * covers. A column read as it is says what its source says (its type, its key); an expression says what it is
 * a column of, and one passed on as it is is protected when its source is. Its first query only: a UNION's
 * branches take its names. Complete when every column it returns is named: no unnamed item, and every * over
 * a table the model knows or a CTE or subquery that is complete itself.
 */
function outputsOf(state: EditorState, body: Node, index: Map<string, Known>, kind: 'CTE' | 'subquery'): { columns: (DerivedColumn | undefined)[]; complete: boolean } {
  type Outputs = { columns: (DerivedColumn | undefined)[]; complete: boolean };
  const key = `outputs:${body.from}`;
  const known = memoOf(state);
  if (known.has(key)) return known.get(key) as Outputs;
  // While it is read, a query that reads itself (a CTE's own name in its FROM) finds no columns there.
  known.set(key, { columns: [], complete: false });
  const { segment, items } = queryAround(state, body, body.from, index);
  const model = setupOf(state)?.model;
  const tableOf = (item: FromItem) => (item.known && model ? findTable(model, item.known.ref)?.table : undefined);
  const columnsOf = (item: FromItem): DerivedColumn[] => {
    if (!item.known) return derivedOf(state, item, index)?.suggestions.children ?? [];
    const table = tableOf(item);
    return item.known.suggestions.children.map((c) => {
      const column = table?.columns.find((t) => t.name === c.label);
      return column && isProtected(column) ? { ...c, protected: true } : c;
    });
  };
  // What SELECT * returns: a column the database hides from it is not one.
  const starOf = (item: FromItem): DerivedColumn[] => {
    const hidden = new Set(tableOf(item)?.columns.filter((c) => c.hidden).map((c) => c.name));
    return columnsOf(item).filter((c) => !hidden.has(c.label));
  };
  const named = (name: string) => items.find((item) => item.name.toLowerCase() === name.toLowerCase());
  const sourceOf = (path: string[]): DerivedColumn | undefined => {
    const last = path[path.length - 1].toLowerCase();
    const from = path.length > 1 ? [named(path[path.length - 2])].filter((i) => i !== undefined) : items;
    for (const item of from) {
      const found = columnsOf(item).find((c) => c.label.toLowerCase() === last);
      if (found) return found;
    }
    return undefined;
  };
  const out: (DerivedColumn | undefined)[] = [];
  let complete = true;
  for (const item of selectItemsOf(state, segment)) {
    if (item.star) {
      const covered = item.star.qualifier === undefined ? items : [named(item.star.qualifier)].filter((i) => i !== undefined);
      if (!covered.length || covered.some((from) => !from.known && !derivedOf(state, from, index)?.complete)) complete = false;
      for (const from of covered) out.push(...starOf(from));
      continue;
    }
    if (!item.name) {
      complete = false;
      out.push(undefined);
      continue;
    }
    const source = item.path ? sourceOf(item.path) : undefined;
    // A column read as it is, renamed or not, is its source's: what it is, and protected when that is. One
    // computed from it is a new column.
    out.push({ ...(source ?? { type: 'property', detail: `${kind} column` }), label: item.name });
  }
  const outputs: Outputs = { columns: out, complete };
  known.set(key, outputs);
  return outputs;
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

/**
 * The one query of a statement or parenthesis that `at` is in, from the SELECT, UPDATE and so on before it to
 * the next, and the tables it names. Each level is split, and each query read, once per state.
 */
function queryAround(state: EditorState, level: Node, at: number, index: Map<string, Known>): { segment: Node[]; items: FromItem[] } {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const segments = cached(state, `segments:${level.from}:${level.name}`, () => {
    const tokens = tokensOf(level);
    const starts = tokens.flatMap((t, i) => (i > 0 && t.name === 'Keyword' && queryStarts.has(text(t).toUpperCase()) ? [i] : []));
    return [0, ...starts].map((start, k, all) => tokens.slice(start, all[k + 1] ?? tokens.length));
  });
  let i = 0;
  while (i + 1 < segments.length && (segments[i + 1][0]?.from ?? Infinity) <= at) i++;
  const segment = segments[i];
  const items = cached(state, `items:${level.from}:${level.name}:${i}`, () => {
    const scopes = cteScopes(state);
    return fromItems(segment, text, index, (name, from) => ctesAt(scopes, from).has(name));
  });
  return { segment, items };
}

/** An item of a select list: its expression as written, the name it gives its column, and what it is. */
export interface SelectItem {
  text: string;
  /** The column it is, part by part, when it is only that: o.Total. */
  path?: string[];
  /** The name its column takes: its alias, else the column's own. */
  name?: string;
  /** It has an alias: written `x AS a`, `x a` or `a = x`. */
  aliased: boolean;
  /** It aggregates (COUNT(*), SUM(x)): its query groups. */
  aggregate: boolean;
  /**
   * What GROUP BY must list for it, as written: all of it when it reads a column and aggregates nothing; the
   * columns it reads outside its aggregates when it aggregates; nothing for a constant, a * or a window's.
   */
  groups: string[];
  /** * or alias.*: every column of what it covers. */
  star?: { qualifier?: string };
  tokens: Node[];
}

/** A query's select list, read once per state. */
function selectItemsOf(state: EditorState, segment: Node[]): SelectItem[] {
  return cached(state, `select:${segment[0]?.from}`, () => selectItems(state, segment));
}

function selectItems(state: EditorState, segment: Node[]): SelectItem[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const start = segment.findIndex((t) => t.name === 'Keyword' && text(t).toUpperCase() === 'SELECT');
  if (start < 0) return [];
  const word = (t: Node | undefined) => (t?.name === 'Keyword' ? text(t).toUpperCase() : '');
  const upper = (t: Node | null | undefined) => (t ? text(t).toUpperCase() : '');
  // GROUP after WITHIN is an ordered aggregate's (STRING_AGG(…) WITHIN GROUP (ORDER BY …)), not the clause.
  const end = segment.findIndex((t, i) => i > start && selectEnds.has(word(t)) && upper(segment[i - 1]) !== 'WITHIN');
  // The tables the query names, for a subquery in the select list that reads them.
  const outer = new Set(fromItems(segment, text, new Map()).map((item) => item.name.toLowerCase()));
  // The select list's items, split at its commas (a function's are inside its parentheses).
  // DISTINCT, ALL and TOP (n) [PERCENT] [WITH TIES] come before the first item, not in it.
  let first = start + 1;
  if (word(segment[first]) === 'DISTINCT' || word(segment[first]) === 'ALL') first++;
  if (word(segment[first]) === 'TOP') {
    first += 2;
    if (word(segment[first]) === 'PERCENT') first++;
    // CodeMirror's T-SQL does not know TIES as a keyword: it comes as a name.
    if (word(segment[first]) === 'WITH' && segment[first + 1] && text(segment[first + 1]).toUpperCase() === 'TIES') first += 2;
  }
  const groups: Node[][] = [[]];
  for (const t of segment.slice(first, end < 0 ? undefined : end)) {
    if (isComma(t, text)) groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  const isSimpleName = (t: Node | undefined) => t?.name === 'Identifier' || t?.name === 'QuotedIdentifier';
  return groups.filter((g) => g.length).map((group) => {
    // T-SQL takes a string for an alias too: x AS 'order total'. CodeMirror ends a string at its first quote,
    // so 'it''s' comes as 'it' and 's': strings that touch are one. The alias's first and last token here.
    const touching = (k: number, step: number) => group[k]?.name === 'String' && group[k + step]?.name === 'String' && (step > 0 ? group[k].to === group[k + 1].from : group[k - 1].to === group[k].from);
    const runFrom = (k: number, step: number) => {
      while (touching(k, step)) k += step;
      return k;
    };
    let tokens = group;
    let alias: [number, number] | undefined;
    const as = group.findIndex((t) => t.name === 'Keyword' && text(t).toUpperCase() === 'AS');
    const lead = group[0]?.name === 'String' ? runFrom(0, 1) : 0;
    const last = group.length - 1;
    const tail = group[last]?.name === 'String' ? runFrom(last, -1) : last;
    if (as >= 0) [tokens, alias] = [group.slice(0, as), [as + 1, last]];
    else if ((isSimpleName(group[0]) || group[0]?.name === 'String') && group[lead + 1]?.name === 'Operator' && text(group[lead + 1]) === '=') [tokens, alias] = [group.slice(lead + 2), [0, lead]];
    else if (tail > 0 && (isSimpleName(group[last]) || group[last]?.name === 'String') && group[tail - 1]?.name !== 'Operator') [tokens, alias] = [group.slice(0, tail), [tail, last]];
    const only = tokens.length === 1 ? tokens[0] : undefined;
    const path = only && isName(only) ? pathOf(only, text) : undefined;
    const column = path && path[path.length - 1] ? path : undefined;
    // CodeMirror reads alias.* as a name ending in a dot, then *.
    const star = only && text(only) === '*' ? {} : tokens.length === 2 && tokens[0].name === 'CompositeIdentifier' && text(tokens[0]).trimEnd().endsWith('.') && text(tokens[1]) === '*' ? { qualifier: pathOf(tokens[0], text).pop() } : undefined;
    // The columns it reads outside an aggregate (a function's name is not one), and whether it aggregates, is
    // a window's or holds a subquery: GROUP BY can list none of those whole, only the columns it reads outside.
    // A window function reads its inputs after the rows are grouped, so they are grouped by; an aggregate's
    // own, and those after its WITHIN GROUP, are not. A subquery's aggregates and tables are its own; a column
    // of the outer query it reads is grouped by.
    const outside: string[] = [];
    const within: Node[] = [];
    let aggregate = false;
    let window = false;
    let subquery = false;
    const from = tokens[0]?.from ?? 0;
    const to = tokens[tokens.length - 1]?.to ?? 0;
    treeOf(state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.from < from || n.to > to) return;
        const node = n.node;
        const next = node.nextSibling;
        if (n.name === 'Parens' && upper(children(node).find((c) => c.name !== '(')) === 'SELECT') {
          subquery = true;
          outside.push(...outerColumns(state, node, outer));
          return false;
        }
        if (n.name === 'Keyword' && upper(node) === 'OVER') window = true;
        else if (next?.name === 'Parens' && upper(next.nextSibling) === 'OVER') return;
        else if (aggregates.has(upper(node)) && next?.name === 'Parens') {
          aggregate = true;
          within.push(next);
          const ordered = next.nextSibling?.nextSibling?.nextSibling;
          if (upper(next.nextSibling) === 'WITHIN' && upper(next.nextSibling?.nextSibling) === 'GROUP' && ordered?.name === 'Parens') within.push(ordered);
        } else if (isName(node)) {
          if (next?.name !== 'Parens' && !within.some((p) => p.from <= n.from && n.to <= p.to)) outside.push(state.sliceDoc(n.from, n.to));
          // A dotted name's parts are not names of their own.
          return false;
        }
      },
    });
    const whole = tokens.length ? state.sliceDoc(from, to) : '';
    return {
      text: whole,
      path: column,
      name: alias && group[alias[0]] ? aliasName(state.sliceDoc(group[alias[0]].from, group[alias[1]].to)) : column?.[column.length - 1],
      aliased: alias !== undefined,
      aggregate,
      groups: star ? [] : aggregate || window || subquery ? outside : outside.length ? [whole] : [],
      star,
      tokens,
    };
  });
}

/**
 * The outer query's columns a subquery reads, as written there: `o.CustomerId` in `(SELECT … WHERE c.Id =
 * o.CustomerId)`, where o is a table of the outer query and not one of the subquery's own.
 */
function outerColumns(state: EditorState, subquery: Node, outer: Set<string>): string[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const own = new Set(fromItems(tokensOf(subquery), text, new Map()).map((item) => item.name.toLowerCase()));
  const out: string[] = [];
  treeOf(state).iterate({
    from: subquery.from,
    to: subquery.to,
    enter: (n) => {
      if (n.from < subquery.from || n.to > subquery.to || n.name !== 'CompositeIdentifier') return;
      const parts = pathOf(n.node, text);
      const table = parts[0]?.toLowerCase();
      if (parts.length === 2 && outer.has(table) && !own.has(table) && n.node.nextSibling?.name !== 'Parens') out.push(text(n.node));
      return false;
    },
  });
  return out;
}

/**
 * The columns a query's select list names, in lower case: a bare name, or the last part of a qualified one.
 * Not a column's alias, nor a keyword or a function.
 */
function selectedColumns(state: EditorState, items: SelectItem[]): string[] {
  const text = (n: Node) => state.sliceDoc(n.from, n.to);
  const out: string[] = [];
  for (const { tokens } of items) {
    tokens.forEach((t, i) => {
      if (tokens[i + 1]?.name === 'Parens') return;
      if (t.name === 'Identifier' || t.name === 'QuotedIdentifier') out.push(unquote(text(t)).toLowerCase());
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
  /** A subquery's parentheses. */
  body?: Node;
  /** The names given after a subquery's alias, which rename its columns: (…) AS x (a, b). */
  columns?: string[];
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
      body: t.name === 'Parens' ? t : undefined,
      ends: [t.to],
    };
    let j = call || hint ? i + 2 : i + 1;
    if (tokens[j]?.name === 'Keyword' && text(tokens[j]).toUpperCase() === 'AS') j++;
    if (tokens[j] && (tokens[j].name === 'Identifier' || tokens[j].name === 'QuotedIdentifier')) {
      item.name = unquote(text(tokens[j]));
      item.ends.push(tokens[j].to);
      i = j;
      const list = tokens[j + 1];
      if (item.body && list?.name === 'Parens') {
        item.columns = children(list).filter((n) => n.name === 'Identifier' || n.name === 'QuotedIdentifier').map((n) => unquote(text(n)));
        i = j + 1;
      }
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

/** A column's alias as written: a name, quoted or not, or a string ('order total', a quote in it doubled). */
function aliasName(written: string): string {
  const string = /^N?'(.*)'$/s.exec(written);
  return string ? string[1].replace(/''/g, "'") : unquote(written);
}

/** A name as written, without its [brackets] or "quotes". */
export function unquote(name: string): string {
  if (/^\[.*\]$/s.test(name)) return name.slice(1, -1).replace(/]]/g, ']');
  if (/^".*"$/s.test(name)) return name.slice(1, -1).replace(/""/g, '"');
  return name;
}
