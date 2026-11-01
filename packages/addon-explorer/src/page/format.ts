// Format, in the SQL editor: the query laid out by sql-formatter's T-SQL dialect, keywords and functions in
// upper case as the starter and autocomplete write them. Only that dialect is imported, so the page carries no other.
import { formatDialect, transactsql } from 'sql-formatter';

/** The query laid out, or null when the formatter cannot read it (a quote left open, say), so it is left as typed. */
export function formatQuery(sql: string): string | null {
  try {
    return formatDialect(sql, { dialect: transactsql, keywordCase: 'upper', functionCase: 'upper', tabWidth: 2 });
  } catch {
    return null;
  }
}
