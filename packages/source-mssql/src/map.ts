// Turns the thirteen result sets of query.sql into a Database. Pure, so it is tested on rows kept in a file.
// Every field a newer set or column adds is optional here, so rows from an older query still map.
import type { Column, Constraint, Database, Index, Properties, Relation, Schema, SecurityPredicate, Table, Trigger } from 'dbtour';

/** node-mssql returns a bigint as a string, since it may not fit a JavaScript number. */
type Count = number | string;

/** Whether the sensitivity labels were read: the view is absent before SQL Server 2019, or the login may not. */
type Labels = 'read' | 'denied' | 'absent';

export interface InfoRow {
  name: string; version: string | null; description: string | null; readAt?: string | null; collation?: string | null; labels?: Labels | null;
}
export interface TableRow {
  schema: string; name: string; kind: 'table' | 'view'; description: string | null; definition: string | null;
  rows?: Count | null; dataBytes?: Count | null; indexBytes?: Count | null; created?: string | null; altered?: string | null;
}
export interface ColumnRow {
  schema: string; table: string; name: string; position: number; type: string; maxLength: number; precision: number; scale: number;
  nullable: boolean; identity: boolean; default: string | null; computed: string | null; description: string | null;
  collation?: string | null; sparse?: boolean | null; identitySeed?: string | null; identityIncrement?: string | null;
}
export interface KeyRow { schema: string; table: string; name: string; kind: 'PK' | 'UQ'; column: string; ordinal: number }
export interface ForeignKeyRow {
  name: string; schema: string; table: string; column: string; toSchema: string; toTable: string; toColumn: string; ordinal: number;
  onDelete: string; onUpdate: string; disabled?: boolean | null; untrusted?: boolean | null;
}
export interface IndexRow {
  schema: string; table: string; name: string; unique: boolean; primary: boolean; column: string; ordinal: number; included: boolean;
  type?: string | null; filter?: string | null; disabled?: boolean | null;
}
export interface CheckRow {
  schema: string; table: string; name: string; definition: string; column: string | null; disabled?: boolean | null; untrusted?: boolean | null;
}
/** An extended property and what it is on: `item` is the column, index or constraint. */
export interface PropertyRow {
  on: 'database' | 'schema' | 'table' | 'column' | 'index' | 'constraint'; schema: string | null; table: string | null; item: string | null;
  name: string; value: string | null;
}
export interface FeatureRow {
  schema: string; table: string;
  /** 0 none, 1 a history table, 2 system-versioned. */
  temporalType: number | null; historySchema: string | null; historyTable: string | null; periodStart: string | null; periodEnd: string | null;
  memoryOptimised: boolean | null; durability: string | null; ledger: string | null; cdc: boolean | null; changeTracking: number | boolean | null;
  scheme: string | null; function: string | null; partitionColumn: string | null; partitions: number | null; compression: string | null;
}
/** One row per trigger and event it fires on. */
export interface TriggerRow { schema: string; table: string; name: string; insteadOf: boolean; disabled: boolean; event: string; definition: string | null }
export interface SecurityRow {
  schema: string; table: string; policySchema: string; policy: string; enabled: boolean; kind: string; operation: string | null; predicate: string;
}
export interface ColumnSecurityRow { schema: string; table: string; column: string; masked: string | null; encryption: string | null; key: string | null }
export interface SensitivityRow { schema: string; table: string; column: string; label: string | null; informationType: string | null; rank: string | null }

export interface Recordsets {
  info: InfoRow[];
  tables: TableRow[];
  columns: ColumnRow[];
  keys: KeyRow[];
  foreignKeys: ForeignKeyRow[];
  indexes: IndexRow[];
  checks: CheckRow[];
  properties: PropertyRow[];
  features: FeatureRow[];
  triggers: TriggerRow[];
  security: SecurityRow[];
  columnSecurity: ColumnSecurityRow[];
  sensitivity: SensitivityRow[];
}

export interface MapOptions {
  /** The name the docs call the database; the server's own name when not given. */
  name?: string;
  /** Tables to leave out, as schema.table with * for any run of characters: `dbo.sys*`, `*.webpages_*`. */
  exclude?: string[];
}

/** The result sets in the order query.sql returns them. */
export function toRecordsets(sets: unknown[][]): Recordsets {
  if (sets.length !== 13) throw new Error(`query.sql returns 13 result sets, got ${sets.length}: the query and map.ts disagree`);
  const [info, tables, columns, keys, foreignKeys, indexes, checks, properties, features, triggers, security, columnSecurity, sensitivity] = sets as [
    InfoRow[], TableRow[], ColumnRow[], KeyRow[], ForeignKeyRow[], IndexRow[], CheckRow[], PropertyRow[], FeatureRow[], TriggerRow[], SecurityRow[], ColumnSecurityRow[], SensitivityRow[],
  ];
  return { info, tables, columns, keys, foreignKeys, indexes, checks, properties, features, triggers, security, columnSecurity, sensitivity };
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
    if (row.created) table.created = row.created;
    if (row.altered) table.altered = row.altered;
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
    if (row.identitySeed != null) column.identitySeed = row.identitySeed; // eslint-disable-line eqeqeq
    if (row.identityIncrement != null) column.identityIncrement = row.identityIncrement; // eslint-disable-line eqeqeq
    if (row.description) column.description = row.description;
    // The database's collation is said once, on the database; a column says its own only when it differs.
    if (row.collation && row.collation !== info.collation) column.collation = row.collation;
    if (row.sparse) column.sparse = true;
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
    const constraint: Constraint = { name: first.name, kind: 'foreign', columns: relation.from.columns, definition: `${to} (${relation.to.columns.join(', ')})` };
    if (first.disabled) relation.disabled = constraint.disabled = true;
    if (first.untrusted) relation.untrusted = constraint.untrusted = true;
    relations.push(relation);
    tables.get(from)!.constraints.push(constraint);
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
    if (rows[0].type) index.type = rows[0].type.toLowerCase().replace(/_/g, ' ');
    if (rows[0].filter) index.filter = rows[0].filter;
    if (rows[0].disabled) index.disabled = true;
    table.indexes.push(index);
  }

  for (const row of sets.checks) {
    const table = tables.get(`${row.schema}.${row.table}`);
    if (!table) continue;
    const constraint: Constraint = { name: row.name, kind: 'check', columns: row.column ? [row.column] : [], definition: row.definition };
    if (row.disabled) constraint.disabled = true;
    if (row.untrusted) constraint.untrusted = true;
    table.constraints.push(constraint);
  }

  for (const row of sets.features ?? []) {
    const table = tables.get(`${row.schema}.${row.table}`);
    if (table) addFeatures(table, row, tables);
  }
  for (const [key, rows] of groupBy(sets.triggers ?? [], (r) => `${r.schema}.${r.table}|${r.name}`)) {
    const table = tables.get(key.split('|')[0]);
    if (!table) continue;
    const trigger: Trigger = { name: rows[0].name, timing: rows[0].insteadOf ? 'instead of' : 'after', events: rows.map((r) => r.event.toLowerCase()), enabled: !rows[0].disabled };
    if (rows[0].definition) trigger.definition = rows[0].definition;
    (table.triggers ??= []).push(trigger);
  }
  for (const row of sets.security ?? []) {
    const table = tables.get(`${row.schema}.${row.table}`);
    if (!table) continue;
    const predicate: SecurityPredicate = { policy: `${row.policySchema}.${row.policy}`, kind: row.kind === 'BLOCK' ? 'block' : 'filter', predicate: row.predicate, enabled: Boolean(row.enabled) };
    if (row.operation) predicate.operation = row.operation.toLowerCase();
    (table.security ??= []).push(predicate);
  }
  const columnOf = (schema: string, table: string, column: string): Column | undefined => tables.get(`${schema}.${table}`)?.columns.find((c) => c.name === column);
  for (const row of sets.columnSecurity ?? []) {
    const column = columnOf(row.schema, row.table, row.column);
    if (!column) continue;
    if (row.masked) column.masked = row.masked;
    if (row.encryption && row.key) column.encrypted = { type: row.encryption === 'RANDOMIZED' ? 'randomized' : 'deterministic', key: row.key };
  }
  for (const row of sets.sensitivity ?? []) {
    const column = columnOf(row.schema, row.table, row.column);
    if (!column) continue;
    const sensitivity: Column['sensitivity'] = {};
    if (row.label) sensitivity.label = row.label;
    if (row.informationType) sensitivity.informationType = row.informationType;
    if (row.rank && row.rank !== 'NONE') sensitivity.rank = row.rank.toLowerCase();
    if (Object.keys(sensitivity).length > 0) column.sensitivity = sensitivity;
  }

  const database: Database = { name: options.name ?? info.name, driver: 'mssql', schemas, relations };
  if (info.version) database.version = info.version;
  if (info.description) database.description = info.description;
  if (info.collation) database.collation = info.collation;
  addProperties(sets.properties ?? [], database, tables);
  if (info.labels === 'denied') database.unread = ['sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION'];
  if (info.readAt && [...tables.values()].some((t) => t.stats)) database.statsReadAt = info.readAt;
  return database;
}

/** What sys.tables says beyond the structure; a feature the server lacks arrives as NULL and is left out. */
function addFeatures(table: Table, row: FeatureRow, tables: Map<string, Table>): void {
  if (row.temporalType === 2 && row.historySchema && row.historyTable && row.periodStart && row.periodEnd) {
    const history = `${row.historySchema}.${row.historyTable}`;
    table.temporal = { history, start: row.periodStart, end: row.periodEnd };
    const kept = tables.get(history);
    if (kept) kept.historyOf = `${row.schema}.${row.table}`;
  }
  if (row.memoryOptimised) table.memoryOptimised = row.durability === 'SCHEMA_ONLY' ? 'schema only' : 'schema and data';
  const ledgers: Record<string, Table['ledger']> = { UPDATABLE_LEDGER_TABLE: 'updatable', APPEND_ONLY_LEDGER_TABLE: 'append-only', HISTORY_TABLE: 'history' };
  if (row.ledger && ledgers[row.ledger]) table.ledger = ledgers[row.ledger];
  if (row.scheme && row.function && row.partitionColumn) {
    table.partitioning = { scheme: row.scheme, function: row.function, column: row.partitionColumn, partitions: Number(row.partitions ?? 0) };
  }
  if (row.compression && row.compression !== 'NONE') table.compression = row.compression.toLowerCase().replace(/_/g, ' ');
  if (row.changeTracking) table.changeTracking = true;
  if (row.cdc) table.cdc = true;
}

/**
 * Extended properties onto what they describe. MS_Description is the description of a database, table or
 * column, read apart; on a schema, index or constraint, which have no description, it stays a property.
 */
function addProperties(rows: PropertyRow[], database: Database, tables: Map<string, Table>): void {
  for (const row of rows) {
    if (row.value === null || row.value === undefined) continue;
    if (row.name === 'MS_Description' && (row.on === 'database' || row.on === 'table' || row.on === 'column')) continue;
    const table = row.table ? tables.get(`${row.schema}.${row.table}`) : undefined;
    let owner: { properties?: Properties } | undefined;
    if (row.on === 'database') owner = database;
    else if (row.on === 'schema') owner = database.schemas.find((s) => s.name === row.schema);
    else if (row.on === 'table') owner = table;
    else if (row.on === 'column') owner = table?.columns.find((c) => c.name === row.item);
    else if (row.on === 'index') owner = table?.indexes.find((i) => i.name === row.item);
    else owner = table?.constraints.find((c) => c.name === row.item);
    if (owner) (owner.properties ??= {})[row.name] = row.value;
  }
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
