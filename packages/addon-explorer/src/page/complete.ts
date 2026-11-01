// The SQL editor's autocomplete. CodeMirror's SQL support completes a name from the schema wherever a name
// can go; this reads the query as CodeMirror parses it, to know what belongs at the caret. In an expression,
// the columns of the tables in scope there, a subquery's own before its outer query's, written with their
// table's alias when more than one is in scope. After an alias and a dot, that table's columns alone. After
// ON, the conditions the keys give; after JOIN, the joins. Pure, so the cases in test/complete.test.ts run it
// as the editor does.
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { keywordCompletionSource, MSSQL, schemaCompletionSource, SQLDialect, type SQLNamespace } from '@codemirror/lang-sql';
import { LanguageSupport, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { localRef, relationsOf, tableRef, type Model } from 'dbtour/model';
import { completionSchema, joinCompletions, quoteName, type TableSuggestions } from './query.ts';

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

type Node = ReturnType<typeof syntaxTree>['topNode'];

/** A table of the model, by its ref, its name in this database's SQL, and what autocomplete says of it. */
interface Known {
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
interface Reading {
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
  /** Just after ON: the table being joined, and the ones before it it can join to. */
  on?: { joined: InScope; earlier: InScope[] };
  scope: InScope[];
}

// Keywords after which a table is named, and those that end a FROM list.
const tableStarts = new Set(['FROM', 'JOIN', 'APPLY', 'INTO', 'UPDATE']);
const fromEnds = new Set(['WHERE', 'GROUP', 'ORDER', 'HAVING', 'ON', 'SET', 'UNION', 'EXCEPT', 'INTERSECT', 'OPTION', 'VALUES', 'OUTPUT']);
// Keywords that begin a statement, or a branch of a UNION: each has its own FROM, so its own scope.
const queryStarts = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE']);

/** CodeMirror's SQL support for one database of the model, with the completion above in place of its own. */
export function sqlSupport(model: Model, databaseName: string | undefined): LanguageSupport {
  const { schema, defaultSchema } = completionSchema(model, databaseName);
  const index = knownTables(model, databaseName);
  const readings = new WeakMap<CompletionContext, Reading>();
  const read = (context: CompletionContext) => {
    let reading = readings.get(context);
    if (!reading) readings.set(context, (reading = readAt(context.state, context.pos, index)));
    return reading;
  };
  const keywords = keywordCompletionSource(tsql, true);
  const names = schemaCompletionSource({ dialect: tsql, schema: schema as unknown as SQLNamespace, defaultSchema });
  const sources: CompletionSource[] = [
    (context) => (read(context).afterDot || read(context).dotted ? null : keywords(context)),
    (context) => (read(context).quiet || read(context).dotted ? null : names(context)),
    (context) => columns(context, read(context), model),
    (context) => joins(context, read(context), model, databaseName),
  ];
  return new LanguageSupport(tsql.language, sources.map((autocomplete) => tsql.language.data.of({ autocomplete })));
}

/** After JOIN: the tables related to those already in the query, each with its ON clause written. */
function joins(context: CompletionContext, reading: Reading, model: Model, databaseName: string | undefined): CompletionResult | null {
  if (reading.quiet || !context.matchBefore(/\bJOIN\s+[\w.[\]]*$/i)) return null;
  const word = context.matchBefore(/[\w.[\]]*$/)!;
  // In joinCompletions' order (the query's tables in turn, what each points at first), not by label.
  const options = joinCompletions(model, context.state.doc.toString(), databaseName).map((j, i) => ({ ...j, boost: writtenOutBoost, sortText: String(i).padStart(4, '0') }));
  return options.length ? { from: word.from, options, validFor: /^[\w.[\]]*$/ } : null;
}

/** Columns where a column belongs, and after ON the conditions that join on the keys. */
function columns(context: CompletionContext, reading: Reading, model: Model): CompletionResult | null {
  if (reading.quiet || reading.quoted) return null;
  if (reading.dotted) {
    const options = reading.dotted.known.suggestions.children.map((c, i) => column(c, i, ownColumnBoost, '', 0));
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
      table.known.suggestions.children.forEach((c, i) => options.push(column(c, i, boost, qualify ? quoteName(table.name) : '', t)));
    });
  }
  return options.length ? { from: word.from, options, validFor: /^\w*$/ } : null;
}

/** A column's suggestion, written after its table's name when `qualifier` is given; listed in table order. */
function column(suggestion: TableSuggestions['children'][number], at: number, boost: number, qualifier: string, table: number): Completion {
  const name = quoteName(suggestion.label);
  return {
    ...suggestion,
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
    if (!out.some((o) => o.label === text)) out.push({ label: text, type: 'keyword', detail: `${localRef(model, joined.known.ref)} ↔ ${localRef(model, other.known.ref)}`, boost: writtenOutBoost });
  };
  const { out: points, in: pointed } = relationsOf(model, joined.known.ref);
  // The nearest table first: the one joined just before is the likeliest partner.
  for (const other of [...earlier].reverse()) {
    for (const r of points) if (r.to.table === other.known.ref) pair(r.from.columns, other, r.to.columns);
    for (const r of pointed) if (r.from.table === other.known.ref) pair(r.to.columns, other, r.from.columns);
  }
  return out;
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

function readAt(state: EditorState, pos: number, index: Map<string, Known>): Reading {
  const reading: Reading = { quiet: false, quoted: false, afterDot: false, tableSpot: false, scope: [] };
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
  let anchor = wordFrom;
  // Names a query nearer the caret binds: an outer table of the same name is hidden by it, as in SQL.
  const bound = new Set<string>();
  levels.forEach((level, depth) => {
    // Comments are not the query: a table and its alias read the same with one between them.
    const tokens = children(level).filter((t) => !/^(\(|\)|LineComment|BlockComment)$/.test(t.name));
    const segment = segmentAround(tokens, anchor, text);
    const items = fromItems(segment, text, index);
    for (const item of items) if (item.known && !bound.has(item.name.toLowerCase())) reading.scope.push({ name: item.name, known: item.known, depth });
    for (const item of items) bound.add(item.name.toLowerCase());
    if (depth === 0) {
      const before = segment.filter((t) => t.to <= wordFrom);
      const prev = before[before.length - 1];
      const prevWord = prev?.name === 'Keyword' ? text(prev).toUpperCase() : '';
      const inFrom = fromListAt(before, text);
      reading.tableSpot =
        tableStarts.has(prevWord) || (isComma(prev, text) && inFrom) || items.some((item) => item.ends.includes(prev?.to ?? -1));
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
  const qualified = /((?:(?:\[(?:[^\]]|\]\])*\]|"[^"]*"|\w+)\.)+)\w*$/.exec(state.sliceDoc(Math.max(0, pos - 250), pos));
  if (qualified) {
    reading.afterDot = true;
    const parts = (qualified[1].match(/\[(?:[^\]]|\]\])*\]|"[^"]*"|\w+/g) ?? []).map(unquote);
    const named = parts.length === 1 ? reading.scope.find((s) => s.name.toLowerCase() === parts[0].toLowerCase())?.known : undefined;
    const known = named ?? index.get(parts.join('.').toLowerCase());
    if (known) reading.dotted = { known, from: wordFrom };
  }
  return reading;
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
interface FromItem {
  name: string;
  known?: Known;
  at: number;
  /** Where its name and its alias end: the caret just after either is still in the FROM list. */
  ends: number[];
}

function fromItems(tokens: Node[], text: (n: Node) => string, index: Map<string, Known>): FromItem[] {
  const items: FromItem[] = [];
  let expect = false;
  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const word = t.name === 'Keyword' ? text(t).toUpperCase() : '';
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
    const item: FromItem = { name: parts[parts.length - 1], known: t.name === 'Parens' ? undefined : index.get(parts.join('.').toLowerCase()), at: t.from, ends: [t.to] };
    let j = i + 1;
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
function unquote(name: string): string {
  if (/^\[.*\]$/s.test(name)) return name.slice(1, -1).replace(/]]/g, ']');
  if (/^".*"$/s.test(name)) return name.slice(1, -1).replace(/""/g, '"');
  return name;
}
