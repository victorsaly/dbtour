// The SQL Server source. `connection` is anything the mssql package accepts: an ADO string
// (Server=host,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True) or an
// mssql:// URL. It is read from the environment variable dbtour.yaml names, never from the file.
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import type { Database, QueryResult, RunOptions, SourceConfig } from 'dbtour';
import { mapRecordsets, toQueryResult, toRecordsets } from './map.ts';

export { mapRecordsets, toQueryResult, toRecordsets, formatType } from './map.ts';

export const query = readFileSync(new URL('./query.sql', import.meta.url), 'utf8');

export async function extract(config: SourceConfig): Promise<Database> {
  if (!config.connection) {
    throw new Error(`Source ${config.name} has no connection: add "connection: \${DBTOUR_MSSQL}" to it in dbtour.yaml and set that variable`);
  }
  const pool = new sql.ConnectionPool(config.connection);
  await pool.connect();
  try {
    const result = await pool.request().query(query);
    const exclude = Array.isArray(config.exclude) ? config.exclude.map(String) : undefined;
    return mapRecordsets(toRecordsets(result.recordsets as unknown[][]), { name: config.name, exclude });
  } finally {
    await pool.close();
  }
}

/**
 * Runs one query dbtour has checked, with `connection` already the source's reader, a read-only login. It runs
 * inside a transaction that is always rolled back, so nothing it did is kept even if the login could write;
 * SET ROWCOUNT stops the server one row past the limit, so a large table is never read whole; and a timer
 * cancels it at the timeout.
 */
export async function run(config: SourceConfig, text: string, options: RunOptions): Promise<QueryResult> {
  if (!config.connection) throw new Error(`Source ${config.name} has no reader connection: add "reader: \${DBTOUR_MSSQL_READER}" to it in dbtour.yaml and set that variable`);
  const pool = new sql.ConnectionPool(config.connection);
  await pool.connect();
  const transaction = new sql.Transaction(pool);
  let cancelled = false;
  try {
    await transaction.begin();
    const request = new sql.Request(transaction);
    // Rows as arrays, so two columns with the same name both come back.
    request.arrayRowMode = true;
    const timer = setTimeout(() => {
      cancelled = true;
      request.cancel();
    }, options.timeoutMs);
    try {
      // The semicolon before the query lets it start with WITH, which T-SQL wants after a statement.
      const result = await request.query(`SET ROWCOUNT ${options.limit + 1};\n${text};\nSET ROWCOUNT 0;`);
      const columns = (result as unknown as { columns?: { name: string }[][] }).columns ?? [];
      const sets = result.recordsets as unknown as unknown[][][];
      // The query's own result is the last set: the SET statements return none.
      return toQueryResult(columns[columns.length - 1], sets[sets.length - 1], options.limit);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (cancelled) {
      const seconds = options.timeoutMs / 1000;
      throw new Error(`The query ran past ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and was cancelled: narrow it with a filter on an indexed column, or TOP`, { cause: error });
    }
    throw error;
  } finally {
    // Always rolled back: a read keeps nothing, and a write that got past every other guard is undone.
    await transaction.rollback().catch(() => undefined);
    await pool.close();
  }
}
