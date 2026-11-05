// What SQLite keeps of a table only in its CREATE statement: sqlite_schema holds each one as it was written,
// comments and all, and its pragmas leave out a generated column's expression, a CHECK, a COLLATE and the
// name a constraint was given. Read here from the text, so nothing but the catalogue is read. Pure, so it is
// tested in Node.

export interface Token {
  kind: 'word' | 'quoted' | 'string' | 'punct' | 'comment';
  /** The source text: a word as written, a name with its quotes, a comment with its markers. */
  text: string;
  start: number;
  end: number;
  /** Whether a line ends between the token before and this one, so a comment can tell whose line it is on. */
  newline: boolean;
}

/** SQLite's tokens, with comments kept. Spaces are dropped; a name keeps its quotes, as SQLite takes "", ``, []. */
export function tokens(sql: string): Token[] {
  const found: Token[] = [];
  let i = 0;
  let newline = false;
  const push = (kind: Token['kind'], end: number) => {
    found.push({ kind, text: sql.slice(i, end), start: i, end, newline });
    newline = false;
    i = end;
  };
  while (i < sql.length) {
    const c = sql[i];
    if (c === '\n') {
      newline = true;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (sql.startsWith('--', i)) {
      const stop = sql.indexOf('\n', i);
      push('comment', stop === -1 ? sql.length : stop);
    } else if (sql.startsWith('/*', i)) {
      // SQLite ends a block comment at its first */, and at the end of the text when there is none.
      const stop = sql.indexOf('*/', i + 2);
      push('comment', stop === -1 ? sql.length : stop + 2);
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close && close !== ']' && sql[j + 1] === close) j += 2;
        else if (sql[j] === close) break;
        else j++;
      }
      push(c === "'" ? 'string' : 'quoted', Math.min(j + 1, sql.length));
    } else if (/[A-Za-z0-9_$\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      push('word', j);
    } else push('punct', i + 1);
  }
  return found;
}

/** A name as SQLite reads it: unquoted, a doubled quote made one. */
export function unquote(text: string): string {
  const open = text[0];
  if (open === '[') return text.slice(1, -1);
  if (open === '"' || open === '`') return text.slice(1, -1).split(open + open).join(open);
  return text;
}

/** The words of a comment, without its markers; empty for one that says nothing. */
export function commentText(text: string): string {
  const inner = text.startsWith('--') ? text.slice(2) : text.slice(2, text.endsWith('*/') ? -2 : undefined);
  return inner
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

export interface ColumnText {
  description?: string;
  /** A generated column's expression. */
  generated?: string;
  collation?: string;
  checks: string[];
}

export interface TableText {
  description?: string;
  /** By the column's name in lower case, as SQLite matches them. */
  columns: Map<string, ColumnText>;
  /** The table's own CHECKs, with the name each was given. */
  checks: { name?: string; definition: string }[];
  primaryName?: string;
  /** A UNIQUE's given name, by its columns in lower case, joined by commas. */
  uniqueNames: Map<string, string>;
}

const tableConstraint = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN']);

/** The text between the bracket at `open` and its match, and the index of the closing one. */
function bracketed(list: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < list.length; i++) {
    if (list[i].text === '(') depth++;
    else if (list[i].text === ')' && --depth === 0) return i;
  }
  return list.length - 1;
}

/**
 * A CREATE TABLE read for what the pragmas leave out. A comment belongs to the definition it follows on the
 * same line (after its comma too), else to the one after it; a comment on the line of the opening bracket
 * describes the table. Nothing is guessed: what it cannot read is left out, and the pragmas say the rest.
 */
export function parseTable(sql: string): TableText {
  const result: TableText = { columns: new Map(), checks: [], uniqueNames: new Map() };
  const list = tokens(sql);
  const open = list.findIndex((t) => t.text === '(');
  // CREATE TABLE … AS SELECT has no definitions to read.
  if (open === -1) return result;
  const close = bracketed(list, open);
  // The definitions between the brackets, split at the commas outside any inner bracket, comments set aside.
  const items: { tokens: Token[]; comments: string[] }[] = [];
  let current: { tokens: Token[]; comments: string[] } = { tokens: [], comments: [] };
  let pending: string[] = [];
  const table: string[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const t = list[i];
    if (t.kind === 'comment') {
      const words = commentText(t.text);
      if (!words) continue;
      const previous = list[i - 1];
      if (!t.newline && i - 1 === open) table.push(words);
      else if (!t.newline && previous.text === ',' && items.length > 0) items[items.length - 1].comments.push(words);
      else if (!t.newline && current.tokens.length > 0) current.comments.push(words);
      else pending.push(words);
      continue;
    }
    if (t.text === '(') depth++;
    if (t.text === ')') depth--;
    if (t.text === ',' && depth === 0) {
      items.push(current);
      current = { tokens: [], comments: [] };
      continue;
    }
    if (current.tokens.length === 0 && pending.length) {
      current.comments.push(...pending);
      pending = [];
    }
    current.tokens.push(t);
  }
  if (current.tokens.length) items.push(current);
  // A comment after the last definition, before the closing bracket, is that definition's.
  if (pending.length && items.length) items[items.length - 1].comments.push(...pending);
  if (table.length) result.description = table.join('\n');

  const textOf = (from: Token, to: Token) => sql.slice(from.end, to.start).trim();
  for (const item of items) {
    const words = item.tokens;
    if (words.length === 0) continue;
    const first = words[0].text.toUpperCase();
    if (words[0].kind === 'word' && tableConstraint.has(first)) {
      let at = 0;
      let name: string | undefined;
      if (first === 'CONSTRAINT' && words[1]) {
        name = unquote(words[1].text);
        at = 2;
      }
      const kind = words[at]?.text.toUpperCase();
      const paren = words.findIndex((t, i) => i > at && t.text === '(');
      if (paren === -1) continue;
      const end = bracketed(words, paren);
      if (kind === 'CHECK') result.checks.push({ ...(name ? { name } : {}), definition: textOf(words[paren], words[end]) });
      else if (kind === 'PRIMARY' && name) result.primaryName = name;
      else if (kind === 'UNIQUE' && name) {
        // Each item's first word is its column; a COLLATE or an order after it is not.
        const columns: string[] = [];
        let first = true;
        for (const t of words.slice(paren + 1, end)) {
          if (t.text === ',') first = true;
          else if (first) {
            columns.push(unquote(t.text).toLowerCase());
            first = false;
          }
        }
        result.uniqueNames.set(columns.join(','), name);
      }
      continue;
    }
    const column: ColumnText = { checks: [] };
    if (item.comments.length) column.description = item.comments.join('\n');
    for (let i = 1; i < words.length; i++) {
      const word = words[i].kind === 'word' ? words[i].text.toUpperCase() : '';
      if (word === 'COLLATE' && words[i + 1]) column.collation = unquote(words[i + 1].text);
      else if ((word === 'CHECK' || word === 'AS') && words[i + 1]?.text === '(') {
        const end = bracketed(words, i + 1);
        const expression = textOf(words[i + 1], words[end]);
        if (word === 'CHECK') column.checks.push(expression);
        else column.generated = expression;
        i = end;
      } else if (words[i].text === '(') i = bracketed(words, i);
    }
    result.columns.set(unquote(words[0].text).toLowerCase(), column);
  }
  return result;
}

/** A CREATE INDEX's key items as written, for the ones that are expressions, and its WHERE. */
export function parseIndex(sql: string): { items: string[]; where?: string } {
  const list = tokens(sql).filter((t) => t.kind !== 'comment');
  const open = list.findIndex((t) => t.text === '(');
  if (open === -1) return { items: [] };
  const close = bracketed(list, open);
  const items: string[] = [];
  let start = open;
  let depth = 0;
  for (let i = open + 1; i <= close; i++) {
    if (list[i].text === '(') depth++;
    else if (list[i].text === ')' && i !== close) depth--;
    if ((list[i].text === ',' && depth === 0) || i === close) {
      items.push(sql.slice(list[start].end, list[i].start).trim());
      start = i;
    }
  }
  const where = list.findIndex((t, i) => i > close && t.kind === 'word' && t.text.toUpperCase() === 'WHERE');
  return where === -1 ? { items } : { items, where: sql.slice(list[where].end).trim().replace(/;$/, '').trim() };
}

/** When a trigger runs and on what: BEFORE when the statement does not say, as SQLite reads it. */
export function parseTrigger(sql: string): { timing: 'before' | 'after' | 'instead of'; events: string[] } {
  const words = tokens(sql).filter((t) => t.kind !== 'comment').map((t) => t.text.toUpperCase());
  const on = words.indexOf('ON');
  const head = on === -1 ? words : words.slice(0, on);
  const timing = head.includes('INSTEAD') ? 'instead of' : head.includes('AFTER') ? 'after' : 'before';
  const events = ['INSERT', 'UPDATE', 'DELETE'].filter((e) => head.includes(e)).map((e) => e.toLowerCase());
  return { timing, events };
}
