// The SQL Server source. `connection` is anything the mssql package accepts: an ADO string
// (Server=host,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True) or an
// mssql:// URL. It is read from the environment variable dbtour.yaml names, never from the file.
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import { maxResultBytes, type Database, type QueryResult, type RunOptions, type SourceConfig } from 'dbtour';
import { mapRecordsets, RowCollector, toRecordsets } from './map.ts';
import { bracket, extraRoles, readerStatements } from './setup.ts';

export { mapRecordsets, RowCollector, sizeOf, toRecordsets, formatType } from './map.ts';
export { connectionString, readerStatements } from './setup.ts';

/**
 * Whether `user` is already a user of the database the admin connection is in, and its roles: what setup
 * shows before it creates the reader, and how it refuses a login that could do more than read.
 */
export async function readerState(admin: string, user: string): Promise<{ exists: boolean; roles: string[] }> {
  const pool = await new sql.ConnectionPool(admin).connect();
  try {
    const roles = await pool.request().input('user', sql.NVarChar, user).query(
      `SELECT r.name FROM sys.database_role_members AS m
       JOIN sys.database_principals AS r ON r.principal_id = m.role_principal_id
       WHERE m.member_principal_id = DATABASE_PRINCIPAL_ID(@user)`,
    );
    const id = await pool.request().input('user', sql.NVarChar, user).query('SELECT DATABASE_PRINCIPAL_ID(@user) AS id');
    return { exists: id.recordset[0].id !== null, roles: roles.recordset.map((r: { name: string }) => r.name) };
  } finally {
    await pool.close();
  }
}

/**
 * Makes `user` this database's reader with the admin's connection: a contained user with db_datareader alone,
 * or, when it is one already, its password reset. A user that holds any other role is refused, as it could
 * write. The password is one dbtour made (letters, digits and -), never one typed, so it can sit in the DDL,
 * which takes no parameters. Then the reader signs in, so a wrong password is found here and not at the first
 * query.
 */
export async function createReader(admin: string, user: string, password: string, readerConnection: string): Promise<void> {
  if (!/^[A-Za-z0-9-]{20,}$/.test(password)) throw new Error('The reader\'s password must be one dbtour made: run it again');
  const state = await readerState(admin, user);
  const more = extraRoles(state.roles);
  if (more.length) throw new Error(`${user} already has ${more.join(', ')}, so it could do more than read: pick another reader name, or remove those roles, then run it again`);
  const pool = await new sql.ConnectionPool(admin).connect();
  try {
    for (const statement of readerStatements(user, state.exists, password)) await pool.request().batch(statement);
  } finally {
    await pool.close();
  }
  const reader = await new sql.ConnectionPool(readerConnection).connect();
  try {
    await reader.request().query(`SELECT 1 AS signedIn /* ${bracket(user)} */`);
  } finally {
    await reader.close();
  }
}

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
        // A cancel ends in an error the driver raises; it is only a failure when dbtour did not ask for it. The
        // error comes before the request has finished, and a rollback asked for then is refused and the connection
        // stays held, so pool.close() would wait for ever: the first error is kept, and given once 'done' follows.
        let failure: Error | undefined;
        request.on('error', (error: Error) => {
          if (!cancelling) failure ??= error;
        });
        request.on('done', () => (failure ? fail(failure) : done()));
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
