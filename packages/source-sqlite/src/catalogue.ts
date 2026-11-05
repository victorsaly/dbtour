// A SQLite file's catalogue as dbtour's model: sqlite_schema and the pragmas for tables, columns, keys and
// indexes, the CREATE text for what the pragmas leave out (parse.ts), and dbstat for each table's size. It
// takes an open database, so the tests hand it one they made; extract opens the file read-only.
import type { DatabaseSync } from 'node:sqlite';
import type { Column, Constraint, Database, Index, Relation, Table, TableStats, Trigger } from 'dbtour';
import { parseIndex, parseTable, parseTrigger } from './parse.ts';

/** SQLite's own tables, which hold the catalogue and the statistics, not the application's rows. */
const internal = /^sqlite_/i;

/**
 * Past this, a file's sizes are not counted: dbstat reads every page of the file to count them, which for a
 * file this large takes longer than reading its catalogue should. Its sizes are then said to be unread.
 */
export const statsFileLimit = 2 * 1024 ** 3;

interface ListRow { name: string; type: string; wr: number; strict: number }
interface SchemaRow { name: string; tbl_name: string; type: string; sql: string | null }
interface ColumnRow { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
interface IndexListRow { name: string; unique: number; origin: 'c' | 'u' | 'pk'; partial: number }
interface IndexColumnRow { seqno: number; cid: number; name: string | null; key: number }
interface ForeignRow { id: number; seq: number; table: string; from: string; to: string | null; on_update: string; on_delete: string }

export interface ReadOptions {
  name: string;
  /** The file's size in bytes, which decides whether its tables' sizes are counted (statsFileLimit). */
  fileBytes: number;
  /** When it was read: the stats carry their moment. */
  readAt?: string;
}

/** Every table and view of the main database, as the model has them; the rows are never read. */
export function readCatalogue(db: DatabaseSync, options: ReadOptions): Database {
  const all = <T>(sql: string, ...params: string[]) => db.prepare(sql).all(...params) as unknown as T[];
  const version = (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v;
  // In the order they were created, as sqlite_schema keeps them; the pragma lists them in no order of its own.
  const schema = all<SchemaRow>('SELECT name, tbl_name, type, sql FROM main.sqlite_schema ORDER BY rowid');
  const created = new Map(schema.map((row, i) => [row.name, i]));
  const listed = all<ListRow>("SELECT name, type, wr, strict FROM pragma_table_list WHERE schema = 'main'").sort((a, b) => (created.get(a.name) ?? 0) - (created.get(b.name) ?? 0));
  const sqlOf = new Map(schema.map((row) => [`${row.type}:${row.name}`, row.sql ?? '']));
  const relations: Relation[] = [];
  const tables: Table[] = [];

  for (const entry of listed) {
    // A virtual table's shadow tables hold its data: the virtual table stands for them.
    if (internal.test(entry.name) || entry.type === 'shadow') continue;
    const view = entry.type === 'view';
    const text = sqlOf.get(`${view ? 'view' : 'table'}:${entry.name}`) ?? '';
    const parsed = parseTable(view ? '' : text);
    const rows = all<ColumnRow>('SELECT cid, name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)', entry.name);
    const keyColumns = rows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk).map((r) => r.name);
    // An INTEGER PRIMARY KEY is the rowid itself: never NULL, and SQLite gives it the next number.
    const rowid = !entry.wr && keyColumns.length === 1 ? rows.find((r) => r.name === keyColumns[0] && /^integer$/i.test(r.type)) : undefined;
    const table: Table = { name: entry.name, kind: view ? 'view' : 'table', columns: [], indexes: [], constraints: [] };
    if (parsed.description) table.description = parsed.description;
    if (view) table.definition = text;

    for (const row of rows) {
      // Hidden 1 is a virtual table's own column (an FTS table's rank), which a SELECT * leaves out.
      const notes = parsed.columns.get(row.name.toLowerCase());
      // An untyped column takes any value, as STRICT's ANY does.
      const column: Column = { name: row.name, type: row.type || 'ANY', nullable: row.notnull === 0 && row !== rowid && !(entry.wr && row.pk > 0) };
      if (row.dflt_value !== null) column.default = row.dflt_value;
      if (row.hidden === 2 || row.hidden === 3) column.computed = notes?.generated ?? '';
      if (row.hidden === 1) column.hidden = true;
      if (row === rowid) column.identity = true;
      if (notes?.description) column.description = notes.description;
      if (notes?.collation && notes.collation.toUpperCase() !== 'BINARY') column.collation = notes.collation;
      for (const check of notes?.checks ?? []) table.constraints.push({ name: unnamed('check', table), kind: 'check', columns: [row.name], definition: check });
      table.columns.push(column);
    }
    if (view) {
      tables.push(table);
      continue;
    }
    if (keyColumns.length) {
      table.primaryKey = keyColumns;
      const own = all<IndexListRow>('SELECT name, origin FROM pragma_index_list(?)', entry.name).find((i) => i.origin === 'pk');
      table.constraints.unshift({ name: parsed.primaryName ?? own?.name ?? '(primary key)', kind: 'primary', columns: keyColumns });
    }
    for (const check of parsed.checks) table.constraints.push({ name: check.name ?? unnamed('check', table), kind: 'check', columns: [], definition: check.definition });

    for (const index of all<IndexListRow>('SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY seq DESC', entry.name)) {
      const keys = all<IndexColumnRow>('SELECT seqno, cid, name, key FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno', index.name);
      const columns = keys.map((k) => k.name ?? '');
      if (index.origin === 'pk') continue;
      if (index.origin === 'u') {
        const name = parsed.uniqueNames.get(columns.map((c) => c.toLowerCase()).join(',')) ?? index.name;
        table.constraints.push({ name, kind: 'unique', columns });
        continue;
      }
      const written = parseIndex(sqlOf.get(`index:${index.name}`) ?? '');
      // An expression in the key has no column name: it is shown as written.
      const named: Index = { name: index.name, columns: keys.map((k, i) => k.name ?? written.items[i] ?? '(expression)'), unique: index.unique === 1 };
      if (index.partial && written.where) named.filter = written.where;
      table.indexes.push(named);
    }

    const foreign = groupBy(all<ForeignRow>('SELECT id, seq, "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(?)', entry.name), (r) => r.id);
    for (const [, keys] of [...foreign].sort(([a], [b]) => b - a)) {
      keys.sort((a, b) => a.seq - b.seq);
      const target = keys[0].table;
      // A key that names no column of the table it references means that table's primary key.
      const targetKey = keys.some((k) => k.to === null) ? all<ColumnRow>('SELECT name, pk FROM pragma_table_info(?)', target).filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk).map((r) => r.name) : [];
      const relation: Relation = {
        from: { table: `main.${entry.name}`, columns: keys.map((k) => k.from) },
        to: { table: `main.${target}`, columns: keys.map((k, i) => k.to ?? targetKey[i] ?? '') },
      };
      if (keys[0].on_delete !== 'NO ACTION') relation.onDelete = keys[0].on_delete;
      if (keys[0].on_update !== 'NO ACTION') relation.onUpdate = keys[0].on_update;
      relations.push(relation);
      const constraint: Constraint = { name: unnamed('foreign key', table), kind: 'foreign', columns: relation.from.columns, definition: `${relation.to.table} (${relation.to.columns.join(', ')})` };
      table.constraints.push(constraint);
    }
    tables.push(table);
  }

  for (const row of schema.filter((r) => r.type === 'trigger')) {
    const table = tables.find((t) => t.name === row.tbl_name);
    if (!table) continue;
    const { timing, events } = parseTrigger(row.sql ?? '');
    const trigger: Trigger = { name: row.name, timing, events, enabled: true, definition: row.sql ?? '' };
    (table.triggers ??= []).push(trigger);
  }

  // A relation to a table that is not there (SQLite lets one be declared) would not be a relation of this database.
  const names = new Set(tables.map((t) => `main.${t.name}`));
  const database: Database = {
    name: options.name,
    driver: 'sqlite',
    version,
    schemas: [{ name: 'main', tables }],
    relations: relations.filter((r) => names.has(r.to.table)),
  };
  const unread: string[] = [];
  const sizes = options.fileBytes > statsFileLimit ? 'large' : sizesOf(db, schema);
  if (sizes === 'large') unread.push(`sizes: the file is over ${statsFileLimit / 1024 ** 3} GB, and counting them reads all of it`);
  else if (sizes === 'missing') unread.push('sizes: this SQLite was built without dbstat, which counts them');
  else {
    for (const table of tables) {
      const stats = sizes.get(table.name);
      if (stats && table.kind === 'table') table.stats = stats;
    }
    if (tables.some((t) => t.stats)) database.statsReadAt = options.readAt ?? new Date().toISOString();
  }
  if (unread.length) database.unread = unread;
  return database;
}

/** A name for a constraint SQLite keeps unnamed, in brackets so it is not taken for one it was given. */
function unnamed(kind: string, table: Table): string {
  const n = table.constraints.filter((c) => c.name.startsWith(`(${kind}`)).length + 1;
  return `(${kind} ${n})`;
}

/**
 * Each table's rows and bytes, from dbstat: the pages of its b-tree and of its indexes, counted from the file's
 * own structure, not by reading a row. A rowid table's rows are the cells of its leaf pages; a WITHOUT ROWID
 * table is a b-tree whose inner pages hold rows too.
 */
function sizesOf(db: DatabaseSync, schema: SchemaRow[]): Map<string, TableStats> | 'missing' {
  let pages: { name: string; pagetype: string | null; cells: number; bytes: number }[];
  try {
    pages = db.prepare("SELECT name, pagetype, sum(ncell) AS cells, sum(pgsize) AS bytes FROM dbstat('main') GROUP BY name, pagetype").all() as unknown as typeof pages;
  } catch {
    return 'missing';
  }
  const withoutRowid = new Set(
    (db.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND wr = 1").all() as unknown as { name: string }[]).map((r) => r.name),
  );
  // A WITHOUT ROWID table is its primary key's b-tree, which dbstat may name after that index: its rows.
  const tableOf = new Map<string, string>();
  for (const table of withoutRowid) {
    for (const index of db.prepare("SELECT name FROM pragma_index_list(?) WHERE origin = 'pk'").all(table) as unknown as { name: string }[]) tableOf.set(index.name, table);
  }
  const ownerOf = new Map(schema.filter((r) => r.type === 'index' && !tableOf.has(r.name)).map((r) => [r.name, r.tbl_name]));
  const sizes = new Map<string, TableStats>();
  const of = (name: string) => {
    let stats = sizes.get(name);
    if (!stats) sizes.set(name, (stats = { rows: 0, dataBytes: 0, indexBytes: 0 }));
    return stats;
  };
  for (const page of pages) {
    const owner = ownerOf.get(page.name);
    if (owner !== undefined) {
      of(owner).indexBytes += page.bytes;
      continue;
    }
    const table = tableOf.get(page.name) ?? page.name;
    const stats = of(table);
    stats.dataBytes += page.bytes;
    if (page.pagetype === 'leaf' || (page.pagetype === 'internal' && withoutRowid.has(table))) stats.rows += page.cells;
  }
  return sizes;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
