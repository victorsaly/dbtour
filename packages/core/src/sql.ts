// Running a query someone (or an agent) wrote, safely enough to hand to an agent. The safety is the source's:
// a read-only login of its own and a transaction that is always rolled back. This is the second line, read
// before anything reaches the database: one SELECT or WITH, nothing that writes, runs code or reaches out of
// the database, and a row limit. It reads T-SQL as SQL Server does for strings, names and comments, so a word
// inside 'text', [a name] or a comment is not taken for a statement. Pure, so it is tested in Node.

/** What a query returned: its columns in order, its rows as arrays, and whether the limit stopped it. */
export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** More rows were there than `limit`; only the first `limit` came back. */
  truncated: boolean;
  limit: number;
}

export interface RunOptions {
  limit: number;
  timeoutMs: number;
}

/** Enough rows to see what a query returns without spending an agent's context on them. */
export const defaultLimit = 100;
/** The most one answer carries, however the limit is set: past it, a query wants narrowing, not paging. */
export const maxLimit = 5000;
/** How long a query may run before it is cancelled: a read that takes longer wants an index or a filter. */
export const defaultTimeoutMs = 30_000;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return defaultLimit;
  return Math.min(maxLimit, Math.max(1, Math.floor(limit)));
}

export type Checked = { ok: true; sql: string } | { ok: false; reason: string };

// Words that write, run code, change the schema or permissions, or reach out of the database. SELECT … INTO
// writes a table, so INTO is among them. A column with one of these names is written [bracketed].
const refusedWords = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'DENY',
  'EXEC', 'EXECUTE', 'INTO', 'OPENROWSET', 'OPENDATASOURCE', 'OPENQUERY', 'BULK', 'BACKUP', 'RESTORE',
  'SHUTDOWN', 'KILL', 'DBCC', 'WAITFOR', 'USE', 'GO', 'RECONFIGURE', 'DECLARE', 'SET',
]);

/**
 * The code with every string, quoted name and comment blanked to spaces, so what is left is keywords and plain
 * names; or what is left open. Positions are kept, so a semicolon found here is one in the query.
 */
function blank(sql: string): { code: string } | { open: string } {
  let code = '';
  let i = 0;
  const closing = (end: string, what: string): string | undefined => {
    // A quote is escaped by doubling it: 'it''s', [a]]b], "a""b".
    for (let j = i + 1; j < sql.length; j++) {
      if (sql[j] === end) {
        if (sql[j + 1] === end) {
          j++;
          continue;
        }
        code += ' '.repeat(j + 1 - i);
        i = j + 1;
        return undefined;
      }
    }
    return what;
  };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '[') {
      const open = closing(c === '[' ? ']' : c, c === "'" ? 'a string' : 'a quoted name');
      if (open) return { open };
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      code += ' '.repeat(stop - i);
      i = stop;
    } else if (sql.startsWith('/*', i)) {
      // Block comments nest in T-SQL.
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      if (depth > 0) return { open: 'a comment' };
      code += ' '.repeat(j - i);
      i = j;
    } else {
      code += c;
      i++;
    }
  }
  return { code };
}

export function checkQuery(sql: string): Checked {
  const blanked = blank(sql);
  if ('open' in blanked) return { ok: false, reason: `The query leaves ${blanked.open} open: close it, then run it again.` };
  const { code } = blanked;
  if (code.trim() === '') return { ok: false, reason: 'There is no query to run: write one SELECT, or a WITH followed by a SELECT.' };
  // One trailing semicolon ends the statement; any other starts a second one.
  const semicolons = [...code.matchAll(/;/g)].map((m) => m.index!);
  const last = semicolons[semicolons.length - 1];
  if (semicolons.length > 1 || (last !== undefined && code.slice(last + 1).trim() !== '')) {
    return { ok: false, reason: 'dbtour runs one statement at a time: send a single SELECT, without a second statement after a semicolon.' };
  }
  const words = [...code.matchAll(/[A-Za-z_@#][\w@#$]*/g)].map((m) => m[0]);
  const first = words[0].toUpperCase();
  if (first !== 'SELECT' && first !== 'WITH') {
    return { ok: false, reason: `The query starts with ${words[0]}: dbtour runs only a SELECT, or a WITH followed by a SELECT.` };
  }
  const word = words.find((w) => refusedWords.has(w.toUpperCase()));
  if (word) {
    const why = word.toUpperCase() === 'INTO' ? 'SELECT … INTO writes a table' : `${word.toUpperCase()} writes, runs code or reaches outside the database`;
    return { ok: false, reason: `The query uses ${word}, and ${why}: dbtour runs reads only. If ${word} is a column or a table, write it as [${word}].` };
  }
  return { ok: true, sql: (last === undefined ? sql : sql.slice(0, last)).trim() };
}

/** Bytes shown before a binary value is cut short: enough to tell two apart. */
const bytesShown = 32;
/** Characters of text shown in a cell: a long value is cut, with … after it. */
const textShown = 200;

/** One cell as text for a table: NULL, dates as ISO, bytes as hex, one line, no stray column separator. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value.subarray(0, bytesShown)).toString('hex');
    return `0x${hex}${value.length > bytesShown ? '…' : ''}`;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const line = text.replace(/\r?\n/g, '↵').replace(/\|/g, '\\|');
  return line.length > textShown ? `${line.slice(0, textShown)}…` : line;
}

/** The rows as a Markdown table, readable in a terminal and by an agent, and how many came back. */
export function resultText(result: QueryResult): string {
  const header = `| ${result.columns.map(formatCell).join(' | ')} |\n|${result.columns.map(() => '---').join('|')}|`;
  const rows = result.rows.map((row) => `| ${row.map(formatCell).join(' | ')} |`);
  const n = result.rows.length;
  const said = result.truncated
    ? `The first ${n} rows: the limit stopped it. Narrow the query, or raise the limit.`
    : n === 0
      ? 'No rows.'
      : `${n} ${n === 1 ? 'row' : 'rows'}.`;
  return `${[header, ...rows].join('\n')}\n\n${said}`;
}
