// The SQL Server source. `connection` is anything the mssql package accepts: an ADO string
// (Server=host,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True) or an
// mssql:// URL. It is read from the environment variable dbtour.yaml names, never from the file.
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import type { Database, SourceConfig } from 'dbtour';
import { mapRecordsets, toRecordsets } from './map.ts';

export { mapRecordsets, toRecordsets, formatType } from './map.ts';

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
