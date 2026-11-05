// Format, in the SQL editor: the query laid out by sql-formatter in its database's dialect (dialect.ts),
// keywords and functions in upper case as the starter and autocomplete write them. Only the dialects the page
// knows are imported, so the page carries no other.
import { formatDialect } from 'sql-formatter';
import { dialectOf, type Dialect } from './dialect.ts';

/** The query laid out, or null when the formatter cannot read it (a quote left open, say), so it is left as typed. */
export function formatQuery(sql: string, dialect: Dialect = dialectOf('mssql')): string | null {
  try {
    return formatDialect(sql, { dialect: dialect.format, keywordCase: 'upper', functionCase: 'upper', tabWidth: 2 });
  } catch {
    return null;
  }
}
