// The model: what every source writes and everything else reads. Kept to plain JSON so it can be committed,
// diffed and handed to a page or an agent. Refs name tables as `schema.table` and columns as
// `schema.table.column`; read through scope(), a model with several databases names them
// `Database:schema.table`.

export const MODEL_VERSION = 1;

/**
 * Extended properties other than MS_Description (which is `description`), by name: what a team records about
 * an object in the database itself, such as its owner, source or retention.
 */
export type Properties = Record<string, string>;

/** A column's sensitivity classification, as SQL Server's data discovery or a team set it. */
export interface Sensitivity {
  label?: string;
  informationType?: string;
  rank?: string;
}

export interface Column {
  name: string;
  /** As the database spells it, with its size: nvarchar(320), decimal(18,2). */
  type: string;
  nullable: boolean;
  default?: string;
  /** The expression of a computed column. */
  computed?: string;
  identity?: boolean;
  /** An identity's seed and increment, as the database spells them. */
  identitySeed?: string;
  identityIncrement?: string;
  description?: string;
  /** Only where it differs from the database's collation. */
  collation?: string;
  sparse?: boolean;
  /** The dynamic data masking function: default(), email(), partial(2,"XX",0). */
  masked?: string;
  /** Always Encrypted: how, and under which column encryption key. */
  encrypted?: { type: 'deterministic' | 'randomized'; key: string };
  sensitivity?: Sensitivity;
  properties?: Properties;
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
  included?: string[];
  /** As the database names the kind: nonclustered, clustered columnstore, xml, spatial. */
  type?: string;
  /** A filtered index's WHERE. */
  filter?: string;
  disabled?: boolean;
  properties?: Properties;
}

export interface Constraint {
  name: string;
  kind: 'primary' | 'unique' | 'check' | 'foreign';
  columns: string[];
  definition?: string;
  /** A foreign key or check the database no longer enforces. */
  disabled?: boolean;
  /** Enforced, but not checked against the rows already there, so the optimiser cannot rely on it. */
  untrusted?: boolean;
  properties?: Properties;
}

export interface Trigger {
  name: string;
  timing: 'after' | 'instead of';
  /** insert, update, delete. */
  events: string[];
  enabled: boolean;
  definition?: string;
}

/** A row-level security predicate on the table: a filter hides rows, a block refuses writes. */
export interface SecurityPredicate {
  policy: string;
  kind: 'filter' | 'block';
  /** For a block predicate: after insert, before update, and so on. */
  operation?: string;
  predicate: string;
  enabled: boolean;
}

/**
 * How big a table is, as the database keeps it about itself: counted from its catalogue, never by reading
 * rows, so the count is the database's own estimate. Absent when the source could not read it.
 */
export interface TableStats {
  rows: number;
  /** The pages the rows take, the heap or clustered index, in bytes. */
  dataBytes: number;
  /** The pages every other index takes, in bytes. */
  indexBytes: number;
}

export interface Table {
  name: string;
  kind: 'table' | 'view';
  description?: string;
  columns: Column[];
  primaryKey?: string[];
  indexes: Index[];
  constraints: Constraint[];
  /** The SQL of a view. */
  definition?: string;
  stats?: TableStats;
  properties?: Properties;
  /** When the table was created and its definition last altered, as ISO timestamps. */
  created?: string;
  altered?: string;
  /** A system-versioned table: its history table (a ref) and the columns that bound each row's period. */
  temporal?: { history: string; start: string; end: string };
  /** The history table of a system-versioned table, as its ref. */
  historyOf?: string;
  memoryOptimised?: 'schema and data' | 'schema only';
  ledger?: 'updatable' | 'append-only' | 'history';
  partitioning?: { scheme: string; function: string; column: string; partitions: number };
  /** The table's own compression, when it has any: row, page, columnstore, columnstore archive. */
  compression?: string;
  changeTracking?: boolean;
  cdc?: boolean;
  triggers?: Trigger[];
  security?: SecurityPredicate[];
}

export interface Schema {
  name: string;
  tables: Table[];
  properties?: Properties;
}

export interface RelationEnd {
  table: string;
  columns: string[];
}

export interface Relation {
  name?: string;
  from: RelationEnd;
  to: RelationEnd;
  /** Declared in the notes, not in the database. */
  virtual?: boolean;
  onDelete?: string;
  onUpdate?: string;
  /** As on its constraint: not enforced, or not checked against the rows already there. */
  disabled?: boolean;
  untrusted?: boolean;
}

export interface Database {
  name: string;
  driver: string;
  version?: string;
  description?: string;
  /** When the source read its tables' stats, as an ISO timestamp: they change, so they carry their moment. */
  statsReadAt?: string;
  /** The default collation; a column says its own only where it differs. */
  collation?: string;
  properties?: Properties;
  /** What the source could not read and why, so a reader knows an absence is not a no. */
  unread?: string[];
  schemas: Schema[];
  relations: Relation[];
}

export interface Endpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface Api {
  name: string;
  description?: string;
  endpoints: Endpoint[];
}

/** An endpoint and the tables it touches. */
export interface Link {
  api: string;
  method: string;
  path: string;
  tables: string[];
}

export interface Group {
  name: string;
  description?: string;
  tables: string[];
}

export interface Model {
  dbtour: typeof MODEL_VERSION;
  generatedAt?: string;
  databases: Database[];
  apis: Api[];
  links: Link[];
  groups: Group[];
}

export function emptyModel(): Model {
  return { dbtour: MODEL_VERSION, databases: [], apis: [], links: [], groups: [] };
}

export interface TableRef {
  schema: string;
  table: string;
  column?: string;
}

export function tableRef(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function parseRef(ref: string): TableRef {
  const parts = ref.split('.');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === '')) {
    throw new Error(`"${ref}" is not a ref: write schema.table, or schema.table.column`);
  }
  const [schema, table, column] = parts;
  return column === undefined ? { schema, table } : { schema, table, column };
}

/** Between a database and its schema in a ref: not a dot, which already parts schema, table and column. */
export const databaseSeparator = ':';

/**
 * The model as everything reads it. Refs carry no database, so two databases with a dbo.Customers would
 * share one name; with several databases, each schema is named `Database:schema` and every relation, group
 * and link, and every history table, names its tables that way. Whatever builds a ref from a schema and a table then builds a name
 * that is unique, and one database keeps the names it has always had. A group or link naming a table in
 * both databases is left for the notes to report. Scoping a scoped model changes nothing.
 */
export function scope(model: Model): Model {
  if (model.databases.length < 2) return model;
  const scoped = structuredClone(model);
  for (const database of scoped.databases) {
    const prefix = database.name + databaseSeparator;
    for (const schema of database.schemas) {
      if (!schema.name.startsWith(prefix)) schema.name = prefix + schema.name;
      for (const table of schema.tables) {
        if (table.temporal && !table.temporal.history.startsWith(prefix)) table.temporal.history = prefix + table.temporal.history;
        if (table.historyOf && !table.historyOf.startsWith(prefix)) table.historyOf = prefix + table.historyOf;
      }
    }
    for (const relation of database.relations) {
      for (const end of [relation.from, relation.to]) if (!end.table.startsWith(prefix)) end.table = prefix + end.table;
    }
  }
  const qualify = (ref: string) => findTable(scoped, ref)?.ref ?? ref;
  for (const group of scoped.groups) group.tables = group.tables.map(qualify);
  for (const link of scoped.links) link.tables = link.tables.map(qualify);
  return scoped;
}

export interface Found {
  database: Database;
  schema: Schema;
  table: Table;
  /** The table's name as the model writes it, with its database when the model is scoped. */
  ref: string;
}

/**
 * Every table a ref can mean. One written with its database, or in a model of one database, means at most
 * one; `dbo.Customers` in a scoped model means each database's dbo.Customers.
 */
export function findTables(model: Model, ref: string): Found[] {
  const { schema: schemaName, table: tableName } = parseRef(ref);
  const found: Found[] = [];
  for (const exact of [true, false]) {
    for (const database of model.databases) {
      for (const schema of database.schemas) {
        const named = exact ? schema.name === schemaName : schema.name === database.name + databaseSeparator + schemaName;
        const table = named ? schema.tables.find((t) => t.name === tableName) : undefined;
        if (table) found.push({ database, schema, table, ref: tableRef(schema.name, table.name) });
      }
    }
    if (found.length > 0) break;
  }
  return found;
}

/** The one table a ref means; nothing when it means none, or several. */
export function findTable(model: Model, ref: string): Found | undefined {
  const found = findTables(model, ref);
  return found.length === 1 ? found[0] : undefined;
}

/** Unique on its own, by a constraint or an index, and not the primary key, which says so already. */
export function isUniqueColumn(table: Table, column: string): boolean {
  if (table.primaryKey?.includes(column)) return false;
  return (
    table.constraints.some((c) => c.kind === 'unique' && c.columns.length === 1 && c.columns[0] === column) ||
    table.indexes.some((i) => i.unique && i.columns.length === 1 && i.columns[0] === column)
  );
}

export function relationsOf(model: Model, ref: string): { out: Relation[]; in: Relation[] } {
  const out: Relation[] = [];
  const inward: Relation[] = [];
  for (const database of model.databases) {
    for (const relation of database.relations) {
      if (relation.from.table === ref) out.push(relation);
      if (relation.to.table === ref) inward.push(relation);
    }
  }
  return { out, in: inward };
}

export type Validation = { ok: true; model: Model } | { ok: false; errors: string[] };

/** Checks the shape, then that every relation points at a table in its database. */
export function validate(value: unknown): Validation {
  const errors: string[] = [];
  const check = new Checker(errors);
  if (!check.object(value, 'model')) return { ok: false, errors };
  const model = value as Record<string, unknown>;
  if (model.dbtour !== MODEL_VERSION) errors.push(`model.dbtour must be ${MODEL_VERSION}, got ${JSON.stringify(model.dbtour)}`);
  check.optionalString(model.generatedAt, 'generatedAt');
  check.list(model.databases, 'databases', (d, p) => checkDatabase(check, d, p));
  check.list(model.apis, 'apis', (a, p) => {
    if (!check.object(a, p)) return;
    check.string(a.name, `${p}.name`);
    check.optionalString(a.description, `${p}.description`);
    check.list(a.endpoints, `${p}.endpoints`, (e, ep) => {
      if (!check.object(e, ep)) return;
      check.string(e.method, `${ep}.method`);
      check.string(e.path, `${ep}.path`);
      check.optionalString(e.summary, `${ep}.summary`);
      check.optionalString(e.description, `${ep}.description`);
      if (e.tags !== undefined) check.strings(e.tags, `${ep}.tags`);
    });
  });
  check.list(model.links, 'links', (l, p) => {
    if (!check.object(l, p)) return;
    check.string(l.api, `${p}.api`);
    check.string(l.method, `${p}.method`);
    check.string(l.path, `${p}.path`);
    check.strings(l.tables, `${p}.tables`);
  });
  check.list(model.groups, 'groups', (g, p) => {
    if (!check.object(g, p)) return;
    check.string(g.name, `${p}.name`);
    check.optionalString(g.description, `${p}.description`);
    check.strings(g.tables, `${p}.tables`);
  });
  if (errors.length > 0) return { ok: false, errors };

  const typed = value as Model;
  // Several databases are told apart by name in their refs (see scope), so each needs one of its own that a
  // ref can carry.
  if (typed.databases.length > 1) {
    const seen = new Set<string>();
    for (const { name } of typed.databases) {
      if (seen.has(name)) errors.push(`two databases are named ${name}: give each source its own name in dbtour.yaml`);
      seen.add(name);
      if (/[.:/\\]/.test(name)) errors.push(`the database name ${name} has a dot, a colon or a slash, which a ref or a file name would read as a separator: give its source another name in dbtour.yaml`);
    }
  }
  typed.databases.forEach((database, i) => {
    const refs = new Set(database.schemas.flatMap((s) => s.tables.map((t) => tableRef(s.name, t.name))));
    database.relations.forEach((relation, j) => {
      for (const end of ['from', 'to'] as const) {
        if (!refs.has(relation[end].table)) {
          errors.push(`databases[${i}].relations[${j}].${end}.table "${relation[end].table}" is not a table of ${database.name}`);
        }
      }
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, model: typed };
}

function checkDatabase(check: Checker, d: unknown, p: string): void {
  if (!check.object(d, p)) return;
  check.string(d.name, `${p}.name`);
  check.string(d.driver, `${p}.driver`);
  check.optionalString(d.version, `${p}.version`);
  check.optionalString(d.description, `${p}.description`);
  check.optionalString(d.statsReadAt, `${p}.statsReadAt`);
  check.optionalString(d.collation, `${p}.collation`);
  check.properties(d.properties, `${p}.properties`);
  if (d.unread !== undefined) check.strings(d.unread, `${p}.unread`);
  check.list(d.schemas, `${p}.schemas`, (s, sp) => {
    if (!check.object(s, sp)) return;
    check.string(s.name, `${sp}.name`);
    check.properties(s.properties, `${sp}.properties`);
    check.list(s.tables, `${sp}.tables`, (t, tp) => checkTable(check, t, tp));
  });
  check.list(d.relations, `${p}.relations`, (r, rp) => {
    if (!check.object(r, rp)) return;
    check.optionalString(r.name, `${rp}.name`);
    for (const end of ['from', 'to']) {
      const e = r[end];
      if (!check.object(e, `${rp}.${end}`)) continue;
      check.string(e.table, `${rp}.${end}.table`);
      check.strings(e.columns, `${rp}.${end}.columns`);
    }
    check.optionalBoolean(r.virtual, `${rp}.virtual`);
    check.optionalBoolean(r.disabled, `${rp}.disabled`);
    check.optionalBoolean(r.untrusted, `${rp}.untrusted`);
  });
}

function checkTable(check: Checker, t: unknown, p: string): void {
  if (!check.object(t, p)) return;
  check.string(t.name, `${p}.name`);
  if (t.kind !== 'table' && t.kind !== 'view') check.errors.push(`${p}.kind must be "table" or "view"`);
  check.optionalString(t.description, `${p}.description`);
  check.optionalString(t.definition, `${p}.definition`);
  if (t.stats !== undefined && check.object(t.stats, `${p}.stats`)) {
    for (const field of ['rows', 'dataBytes', 'indexBytes']) check.count(t.stats[field], `${p}.stats.${field}`);
  }
  if (t.primaryKey !== undefined) check.strings(t.primaryKey, `${p}.primaryKey`);
  checkCatalogue(check, t, p);
  check.list(t.columns, `${p}.columns`, (c, cp) => {
    if (!check.object(c, cp)) return;
    check.string(c.name, `${cp}.name`);
    check.string(c.type, `${cp}.type`);
    if (typeof c.nullable !== 'boolean') check.errors.push(`${cp}.nullable must be true or false`);
    check.optionalString(c.default, `${cp}.default`);
    check.optionalString(c.computed, `${cp}.computed`);
    check.optionalBoolean(c.identity, `${cp}.identity`);
    check.optionalString(c.description, `${cp}.description`);
    for (const field of ['identitySeed', 'identityIncrement', 'collation', 'masked']) check.optionalString(c[field], `${cp}.${field}`);
    check.optionalBoolean(c.sparse, `${cp}.sparse`);
    check.properties(c.properties, `${cp}.properties`);
    if (c.encrypted !== undefined && check.object(c.encrypted, `${cp}.encrypted`)) {
      check.oneOf(c.encrypted.type, ['deterministic', 'randomized'], `${cp}.encrypted.type`);
      check.string(c.encrypted.key, `${cp}.encrypted.key`);
    }
    if (c.sensitivity !== undefined && check.object(c.sensitivity, `${cp}.sensitivity`)) {
      for (const field of ['label', 'informationType', 'rank']) check.optionalString(c.sensitivity[field], `${cp}.sensitivity.${field}`);
    }
  });
  check.list(t.indexes, `${p}.indexes`, (x, xp) => {
    if (!check.object(x, xp)) return;
    check.string(x.name, `${xp}.name`);
    check.strings(x.columns, `${xp}.columns`);
    if (typeof x.unique !== 'boolean') check.errors.push(`${xp}.unique must be true or false`);
    check.optionalString(x.type, `${xp}.type`);
    check.optionalString(x.filter, `${xp}.filter`);
    check.optionalBoolean(x.disabled, `${xp}.disabled`);
    check.properties(x.properties, `${xp}.properties`);
  });
  check.list(t.constraints, `${p}.constraints`, (c, cp) => {
    if (!check.object(c, cp)) return;
    check.string(c.name, `${cp}.name`);
    if (!['primary', 'unique', 'check', 'foreign'].includes(String(c.kind))) check.errors.push(`${cp}.kind is not a constraint kind`);
    check.strings(c.columns, `${cp}.columns`);
    check.optionalString(c.definition, `${cp}.definition`);
    check.optionalBoolean(c.disabled, `${cp}.disabled`);
    check.optionalBoolean(c.untrusted, `${cp}.untrusted`);
    check.properties(c.properties, `${cp}.properties`);
  });
}

/** What the catalogue says about a table beyond its columns, keys and indexes. */
function checkCatalogue(check: Checker, t: Record<string, any>, p: string): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  check.properties(t.properties, `${p}.properties`);
  for (const field of ['created', 'altered', 'historyOf', 'compression']) check.optionalString(t[field], `${p}.${field}`);
  for (const field of ['changeTracking', 'cdc']) check.optionalBoolean(t[field], `${p}.${field}`);
  if (t.memoryOptimised !== undefined) check.oneOf(t.memoryOptimised, ['schema and data', 'schema only'], `${p}.memoryOptimised`);
  if (t.ledger !== undefined) check.oneOf(t.ledger, ['updatable', 'append-only', 'history'], `${p}.ledger`);
  if (t.temporal !== undefined && check.object(t.temporal, `${p}.temporal`)) {
    for (const field of ['history', 'start', 'end']) check.string(t.temporal[field], `${p}.temporal.${field}`);
  }
  if (t.partitioning !== undefined && check.object(t.partitioning, `${p}.partitioning`)) {
    for (const field of ['scheme', 'function', 'column']) check.string(t.partitioning[field], `${p}.partitioning.${field}`);
    check.count(t.partitioning.partitions, `${p}.partitioning.partitions`);
  }
  if (t.triggers !== undefined) {
    check.list(t.triggers, `${p}.triggers`, (g, gp) => {
      if (!check.object(g, gp)) return;
      check.string(g.name, `${gp}.name`);
      check.oneOf(g.timing, ['after', 'instead of'], `${gp}.timing`);
      check.strings(g.events, `${gp}.events`);
      if (typeof g.enabled !== 'boolean') check.errors.push(`${gp}.enabled must be true or false`);
      check.optionalString(g.definition, `${gp}.definition`);
    });
  }
  if (t.security !== undefined) {
    check.list(t.security, `${p}.security`, (r, rp) => {
      if (!check.object(r, rp)) return;
      check.string(r.policy, `${rp}.policy`);
      check.oneOf(r.kind, ['filter', 'block'], `${rp}.kind`);
      check.optionalString(r.operation, `${rp}.operation`);
      check.string(r.predicate, `${rp}.predicate`);
      if (typeof r.enabled !== 'boolean') check.errors.push(`${rp}.enabled must be true or false`);
    });
  }
}

class Checker {
  errors: string[];

  constructor(errors: string[]) {
    this.errors = errors;
  }

  object(value: unknown, path: string): value is Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return true;
    this.errors.push(`${path} must be an object`);
    return false;
  }

  string(value: unknown, path: string): void {
    if (typeof value !== 'string' || value === '') this.errors.push(`${path} must be a non-empty string`);
  }

  optionalString(value: unknown, path: string): void {
    if (value !== undefined && typeof value !== 'string') this.errors.push(`${path} must be a string when given`);
  }

  optionalBoolean(value: unknown, path: string): void {
    if (value !== undefined && typeof value !== 'boolean') this.errors.push(`${path} must be true or false when given`);
  }

  properties(value: unknown, path: string): void {
    if (value === undefined || !this.object(value, path)) return;
    for (const [name, text] of Object.entries(value)) {
      if (typeof text !== 'string') this.errors.push(`${path}.${name} must be a string`);
    }
  }

  oneOf(value: unknown, allowed: string[], path: string): void {
    if (!allowed.includes(value as string)) this.errors.push(`${path} must be ${allowed.map((a) => `"${a}"`).join(' or ')}`);
  }

  count(value: unknown, path: string): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) this.errors.push(`${path} must be a number of 0 or more`);
  }

  strings(value: unknown, path: string): void {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) this.errors.push(`${path} must be a list of strings`);
  }

  list(value: unknown, path: string, each: (item: unknown, path: string) => void): void {
    if (!Array.isArray(value)) {
      this.errors.push(`${path} must be a list`);
      return;
    }
    value.forEach((item, i) => each(item, `${path}[${i}]`));
  }
}
