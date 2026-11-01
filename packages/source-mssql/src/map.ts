// Turns the seven result sets of query.sql into a Database. Pure, so it is tested on rows kept in a file.
import type { Column, Constraint, Database, Index, Relation, Schema, Table } from 'dbtour';

/** node-mssql returns a bigint as a string, since it may not fit a JavaScript number. */
type Count = number | string;

export interface InfoRow { name: string; version: string | null; description: string | null; readAt?: string | null }
export interface TableRow {
  schema: string; name: string; kind: 'table' | 'view'; description: string | null; definition: string | null;
  rows?: Count | null; dataBytes?: Count | null; indexBytes?: Count | null;
}
export interface ColumnRow {
  schema: string; table: string; name: string; position: number; type: string; maxLength: number; precision: number; scale: number;
  nullable: boolean; identity: boolean; default: string | null; computed: string | null; description: string | null;
}
export interface KeyRow { schema: string; table: string; name: string; kind: 'PK' | 'UQ'; column: string; ordinal: number }
export interface ForeignKeyRow {
  name: string; schema: string; table: string; column: string; toSchema: string; toTable: string; toColumn: string; ordinal: number;
  onDelete: string; onUpdate: string;
}
export interface IndexRow { schema: string; table: string; name: string; unique: boolean; primary: boolean; column: string; ordinal: number; included: boolean }
export interface CheckRow { schema: string; table: string; name: string; definition: string; column: string | null }

export interface Recordsets {
  info: InfoRow[];
  tables: TableRow[];
  columns: ColumnRow[];
  keys: KeyRow[];
  foreignKeys: ForeignKeyRow[];
  indexes: IndexRow[];
  checks: CheckRow[];
}

export interface MapOptions {
  /** The name the docs call the database; the server's own name when not given. */
  name?: string;
  /** Tables to leave out, as schema.table with * for any run of characters: `dbo.sys*`, `*.webpages_*`. */
  exclude?: string[];
}

/** The result sets in the order query.sql returns them. */
export function toRecordsets(sets: unknown[][]): Recordsets {
  if (sets.length !== 7) throw new Error(`query.sql returns 7 result sets, got ${sets.length}: the query and map.ts disagree`);
  const [info, tables, columns, keys, foreignKeys, indexes, checks] = sets as [InfoRow[], TableRow[], ColumnRow[], KeyRow[], ForeignKeyRow[], IndexRow[], CheckRow[]];
  return { info, tables, columns, keys, foreignKeys, indexes, checks };
}

export function mapRecordsets(sets: Recordsets, options: MapOptions = {}): Database {
  const info = sets.info[0];
  const excluded = (options.exclude ?? []).map(pattern);
  const keep = (schema: string, table: string): boolean => !excluded.some((p) => p.test(`${schema}.${table}`));

  const tables = new Map<string, Table>();
  const schemas: Schema[] = [];
  for (const row of sets.tables) {
    if (!keep(row.schema, row.name)) continue;
    let schema = schemas.find((s) => s.name === row.schema);
    if (!schema) schemas.push((schema = { name: row.schema, tables: [] }));
    const table: Table = { name: row.name, kind: row.kind, columns: [], indexes: [], constraints: [] };
    if (row.description) table.description = row.description;
    if (row.kind === 'view' && row.definition) table.definition = row.definition;
    // A byte count past 2^53 loses its last digits as a number, which no reader of a size will miss. Only a
    // table: an indexed view has rows in sys.partitions too, but they are the view's results, not stored data.
    if (row.kind === 'table' && row.rows !== null && row.rows !== undefined) table.stats = { rows: Number(row.rows), dataBytes: Number(row.dataBytes ?? 0), indexBytes: Number(row.indexBytes ?? 0) };
    schema.tables.push(table);
    tables.set(`${row.schema}.${row.name}`, table);
  }

  for (const row of sets.columns) {
    const table = tables.get(`${row.schema}.${row.table}`);
    if (!table) continue;
    const column: Column = { name: row.name, type: formatType(row), nullable: Boolean(row.nullable) };
    if (row.default !== null) column.default = row.default;
    if (row.computed !== null) column.computed = row.computed;
    if (row.identity) column.identity = true;
    if (row.description) column.description = row.description;
    table.columns.push(column);
  }

  for (const [key, rows] of groupBy(sets.keys, (r) => `${r.schema}.${r.table}|${r.name}`)) {
    const table = tables.get(key.split('|')[0]);
    if (!table) continue;
    const columns = rows.sort((a, b) => a.ordinal - b.ordinal).map((r) => r.column);
    if (rows[0].kind === 'PK') table.primaryKey = columns;
    table.constraints.push({ name: rows[0].name, kind: rows[0].kind === 'PK' ? 'primary' : 'unique', columns });
  }

  const relations: Relation[] = [];
  for (const [, rows] of groupBy(sets.foreignKeys, (r) => r.name)) {
    const ordered = rows.sort((a, b) => a.ordinal - b.ordinal);
    const first = ordered[0];
    const from = `${first.schema}.${first.table}`;
    const to = `${first.toSchema}.${first.toTable}`;
    if (!tables.has(from) || !tables.has(to)) continue;
    const relation: Relation = { name: first.name, from: { table: from, columns: ordered.map((r) => r.column) }, to: { table: to, columns: ordered.map((r) => r.toColumn) } };
    if (first.onDelete && first.onDelete !== 'NO_ACTION') relation.onDelete = first.onDelete;
    if (first.onUpdate && first.onUpdate !== 'NO_ACTION') relation.onUpdate = first.onUpdate;
    relations.push(relation);
    tables.get(from)!.constraints.push({ name: first.name, kind: 'foreign', columns: relation.from.columns, definition: `${to} (${relation.to.columns.join(', ')})` });
  }

  for (const [key, rows] of groupBy(sets.indexes, (r) => `${r.schema}.${r.table}|${r.name}`)) {
    const table = tables.get(key.split('|')[0]);
    if (!table || rows[0].primary) continue;
    const index: Index = {
      name: rows[0].name,
      columns: rows.filter((r) => !r.included).sort((a, b) => a.ordinal - b.ordinal).map((r) => r.column),
      unique: Boolean(rows[0].unique),
    };
    const included = rows.filter((r) => r.included).map((r) => r.column);
    if (included.length > 0) index.included = included;
    table.indexes.push(index);
  }

  for (const row of sets.checks) {
    const table = tables.get(`${row.schema}.${row.table}`);
    if (!table) continue;
    const constraint: Constraint = { name: row.name, kind: 'check', columns: row.column ? [row.column] : [], definition: row.definition };
    table.constraints.push(constraint);
  }

  const database: Database = { name: options.name ?? info.name, driver: 'mssql', schemas, relations };
  if (info.version) database.version = info.version;
  if (info.description) database.description = info.description;
  if (info.readAt && [...tables.values()].some((t) => t.stats)) database.statsReadAt = info.readAt;
  return database;
}

/** The type as SQL Server would spell it in a CREATE TABLE: nvarchar(320), varchar(max), decimal(18,2), datetime2(7). */
export function formatType(row: Pick<ColumnRow, 'type' | 'maxLength' | 'precision' | 'scale'>): string {
  const t = row.type.toLowerCase();
  switch (t) {
    case 'char':
    case 'varchar':
    case 'binary':
    case 'varbinary':
      return `${t}(${row.maxLength === -1 ? 'max' : row.maxLength})`;
    case 'nchar':
    case 'nvarchar':
      // max_length counts bytes; these types hold two per character.
      return `${t}(${row.maxLength === -1 ? 'max' : row.maxLength / 2})`;
    case 'decimal':
    case 'numeric':
      return `${t}(${row.precision},${row.scale})`;
    case 'datetime2':
    case 'datetimeoffset':
    case 'time':
      return `${t}(${row.scale})`;
    default:
      return t;
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function pattern(text: string): RegExp {
  return new RegExp('^' + text.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
}
