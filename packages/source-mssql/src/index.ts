// The SQL Server source. `connection` is anything the mssql package accepts: an ADO string
// (Server=host,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True) or an
// mssql:// URL. It is read from the environment variable dbtour.yaml names, never from the file.
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import { maxResultBytes, type Database, type QueryResult, type RunOptions, type SourceConfig } from 'dbtour';
import { mapRecordsets, RowCollector, toRecordsets } from './map.ts';

export { mapRecordsets, RowCollector, sizeOf, toRecordsets, formatType } from './map.ts';

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
 * Some seconds past dbtour's own timeout for the driver's: the driver's default (15 seconds) would otherwise end
 * a query first, with a message that says nothing of what to do, so dbtour's cancel always comes first.
 */
const driverGraceMs = 5000;

/**
 * Runs one query dbtour has checked, with `connection` already the source's reader, a read-only login. It runs
 * inside a transaction that is always rolled back, so nothing it did is kept even if the login could write. Its
 * rows stream into a collector that stops at the limit or the byte budget, whichever comes first, and the query
 * is cancelled there, so neither the rows nor their size is ever more than a row past what is kept; SET ROWCOUNT
 * stops the server one row past the limit too. A timer cancels it at the timeout.
 */
export async function run(config: SourceConfig, text: string, options: RunOptions): Promise<QueryResult> {
  if (!config.connection) throw new Error(`Source ${config.name} has no reader connection: add "reader: \${DBTOUR_MSSQL_READER}" to it in dbtour.yaml and set that variable`);
  const pool = new sql.ConnectionPool(config.connection);
  await pool.connect();
  // The driver takes a per-transaction timeout, cascaded to its requests; its type definitions predate that.
  const begin = pool.transaction as unknown as (overrides: { requestTimeout: number }) => sql.Transaction;
  const transaction = begin.call(pool, { requestTimeout: options.timeoutMs + driverGraceMs });
  const rows = new RowCollector(options.limit, maxResultBytes);
  let timedOut = false;
  try {
    await transaction.begin();
    const request = transaction.request();
    // Rows as arrays, so two columns with the same name both come back; streamed, so they are counted as they come.
    request.arrayRowMode = true;
    request.stream = true;
    let cancelling = false;
    const cancel = () => {
      if (!cancelling) {
        cancelling = true;
        request.cancel();
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, options.timeoutMs);
    try {
      await new Promise<void>((done, fail) => {
        request.on('recordset', (columns: { name: string }[]) => rows.start(columns));
        request.on('row', (row: unknown[]) => {
          if (!rows.add(row)) cancel();
        });
        // A cancel ends in an error the driver raises; it is only a failure when dbtour did not ask for it.
        request.on('error', (error: Error) => {
          if (!cancelling) fail(error);
        });
        request.on('done', () => done());
        // The semicolon before the query lets it start with WITH, which T-SQL wants after a statement.
        void request.query(`SET ROWCOUNT ${options.limit + 1};\n${text};\nSET ROWCOUNT 0;`);
      });
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) {
      const seconds = options.timeoutMs / 1000;
      throw new Error(`The query ran past ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and was cancelled: narrow it with a filter on an indexed column, or TOP`);
    }
    return rows.result();
  } finally {
    // Always rolled back: a read keeps nothing, and a write that got past every other guard is undone.
    await transaction.rollback().catch(() => undefined);
    await pool.close();
  }
}
