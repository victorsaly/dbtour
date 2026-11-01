// The model: what every source writes and everything else reads. Kept to plain JSON so it can be committed,
// diffed and handed to a page or an agent. Refs name tables as `schema.table` and columns as
// `schema.table.column`.

export const MODEL_VERSION = 1;

export interface Column {
  name: string;
  /** As the database spells it, with its size: nvarchar(320), decimal(18,2). */
  type: string;
  nullable: boolean;
  default?: string;
  /** The expression of a computed column. */
  computed?: string;
  identity?: boolean;
  description?: string;
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
  included?: string[];
}

export interface Constraint {
  name: string;
  kind: 'primary' | 'unique' | 'check' | 'foreign';
  columns: string[];
  definition?: string;
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
}

export interface Schema {
  name: string;
  tables: Table[];
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
}

export interface Database {
  name: string;
  driver: string;
  version?: string;
  description?: string;
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

export interface Found {
  database: Database;
  schema: Schema;
  table: Table;
}

export function findTable(model: Model, ref: string): Found | undefined {
  const { schema: schemaName, table: tableName } = parseRef(ref);
  for (const database of model.databases) {
    for (const schema of database.schemas) {
      if (schema.name !== schemaName) continue;
      const table = schema.tables.find((t) => t.name === tableName);
      if (table) return { database, schema, table };
    }
  }
  return undefined;
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
  check.list(d.schemas, `${p}.schemas`, (s, sp) => {
    if (!check.object(s, sp)) return;
    check.string(s.name, `${sp}.name`);
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
  });
}

function checkTable(check: Checker, t: unknown, p: string): void {
  if (!check.object(t, p)) return;
  check.string(t.name, `${p}.name`);
  if (t.kind !== 'table' && t.kind !== 'view') check.errors.push(`${p}.kind must be "table" or "view"`);
  check.optionalString(t.description, `${p}.description`);
  check.optionalString(t.definition, `${p}.definition`);
  if (t.primaryKey !== undefined) check.strings(t.primaryKey, `${p}.primaryKey`);
  check.list(t.columns, `${p}.columns`, (c, cp) => {
    if (!check.object(c, cp)) return;
    check.string(c.name, `${cp}.name`);
    check.string(c.type, `${cp}.type`);
    if (typeof c.nullable !== 'boolean') check.errors.push(`${cp}.nullable must be true or false`);
    check.optionalString(c.default, `${cp}.default`);
    check.optionalString(c.computed, `${cp}.computed`);
    check.optionalBoolean(c.identity, `${cp}.identity`);
    check.optionalString(c.description, `${cp}.description`);
  });
  check.list(t.indexes, `${p}.indexes`, (x, xp) => {
    if (!check.object(x, xp)) return;
    check.string(x.name, `${xp}.name`);
    check.strings(x.columns, `${xp}.columns`);
    if (typeof x.unique !== 'boolean') check.errors.push(`${xp}.unique must be true or false`);
  });
  check.list(t.constraints, `${p}.constraints`, (c, cp) => {
    if (!check.object(c, cp)) return;
    check.string(c.name, `${cp}.name`);
    if (!['primary', 'unique', 'check', 'foreign'].includes(String(c.kind))) check.errors.push(`${cp}.kind is not a constraint kind`);
    check.strings(c.columns, `${cp}.columns`);
    check.optionalString(c.definition, `${cp}.definition`);
  });
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
