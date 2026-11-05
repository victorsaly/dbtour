// The SQL each database speaks, as far as the page writes it: what the editor calls it, which keywords it
// offers, how the first rows are asked for, how Format lays it out, and how the source's reader is named in
// dbtour.yaml. SQL Server's T-SQL, SQLite's, and the standard for any other until it has its own. A name that
// needs quotes takes [brackets] in each, as SQLite reads them too. Pure, so it is tested in Node.
import { MSSQL, SQLDialect, SQLite, StandardSQL } from '@codemirror/lang-sql';
import { sql as standard, sqlite, transactsql, type DialectOptions } from 'sql-formatter';

export interface Dialect {
  /** What the editor's bar calls it. */
  label: string;
  /** CodeMirror's: its keywords, and the quotes a name may take. */
  language: SQLDialect;
  /** sql-formatter's, for Format. */
  format: DialectOptions;
  /** How the first rows are asked for: TOP (n) after SELECT, or LIMIT n at the end. */
  rows: 'top' | 'limit';
  /** What dbtour.yaml says for the source's reader, for a page that has none. */
  reader: string;
  /** How the reader keeps a query from writing, in a few words after "Runs through X's reader, ". */
  readOnly: string;
}

/**
 * Names are not case-sensitive in either, so a completed OrderLines needs no quotes, and a name that does need
 * them gets [brackets] rather than "double quotes".
 */
const tsql = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });
const lite = SQLDialect.define({ ...SQLite.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["`' });
const other = SQLDialect.define({ ...StandardSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });

const dialects: Record<string, Dialect> = {
  mssql: { label: 'T-SQL', language: tsql, format: transactsql, rows: 'top', reader: '${DBTOUR_MSSQL_READER}', readOnly: 'a read-only login: checked first, rolled back after' },
  sqlite: { label: 'SQLite', language: lite, format: sqlite, rows: 'limit', reader: 'read-only', readOnly: 'the file opened read-only: checked first' },
};

/** The dialect of a database's driver; standard SQL for one the page does not know yet. One object each, so a component can depend on it. */
export function dialectOf(driver: string | undefined): Dialect {
  const key = driver ?? 'mssql';
  return (dialects[key] ??= {
    label: 'SQL',
    language: other,
    format: standard,
    rows: 'limit',
    reader: `\${DBTOUR_${key.toUpperCase()}_READER}`,
    readOnly: 'a read-only login: checked first',
  });
}

/** A select list of the first `n` rows, and what ends the query: SELECT TOP (n) …, or SELECT … LIMIT n. */
export function firstRows(dialect: Dialect, n: number): { select: string; end?: string } {
  return dialect.rows === 'top' ? { select: `SELECT TOP (${n})` } : { select: 'SELECT', end: `LIMIT ${n}` };
}
