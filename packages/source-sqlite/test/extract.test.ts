import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from 'dbtour';
import { DatabaseSync } from '../src/sqlite.ts';
import { extract, fileOf, readCatalogue, readOnly } from '../src/index.ts';

/** The shop as a SQLite file in a folder of its own: where dbtour.yaml would be. */
export function shop(): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-sqlite-'));
  const db = new DatabaseSync(join(root, 'shop.db'));
  db.exec(readFileSync(new URL('./fixtures/shop.sql', import.meta.url), 'utf8'));
  db.close();
  return { root, file: 'shop.db' };
}

test('extract reads the shop: tables and a view, keys, relations, indexes, checks, a trigger, as the model has them', async () => {
  const database = await extract({ type: 'sqlite', name: 'Shop', ...shop() });
  assert.equal(validate({ dbtour: 1, databases: [database], apis: [], links: [], groups: [] }).ok, true);
  assert.equal(database.driver, 'sqlite');
  assert.match(database.version ?? '', /^3\./);
  const [main] = database.schemas;
  assert.equal(main.name, 'main');
  assert.deepEqual(main.tables.map((t) => `${t.kind}:${t.name}`), ['table:customers', 'table:orders', 'table:order_lines', 'view:big_orders'], 'its own tables only, not sqlite_sequence');

  const customers = main.tables[0];
  assert.equal(customers.description, 'Everyone who has bought from the shop.');
  assert.deepEqual(customers.columns[0], { name: 'id', type: 'INTEGER', nullable: false, identity: true, description: 'Given by SQLite.' });
  assert.deepEqual(customers.columns[1], { name: 'email', type: 'TEXT', nullable: false, description: 'Where receipts go.', collation: 'NOCASE' });
  assert.deepEqual(customers.primaryKey, ['id']);
  assert.deepEqual(customers.constraints.map((c) => [c.kind, c.name, c.columns.join()]), [['primary', '(primary key)', 'id'], ['unique', 'sqlite_autoindex_customers_1', 'email']]);
  assert.deepEqual(customers.indexes, [{ name: 'ix_customers_lower', columns: ['lower(name)'], unique: true }], 'an expression as written; the UNIQUE constraint is not an index again');

  const orders = main.tables[1];
  const column = (name: string) => orders.columns.find((c) => c.name === name)!;
  assert.equal(column('placed_at').default, "datetime('now')");
  assert.equal(column('total_pence').computed, 'CAST(round(total * 100) AS INTEGER)');
  assert.deepEqual(orders.constraints.filter((c) => c.kind === 'check'), [{ name: '(check 1)', kind: 'check', columns: ['total'], definition: 'total >= 0' }]);
  assert.deepEqual(orders.indexes, [
    { name: 'ix_orders_customer', columns: ['customer_id', 'placed_at'], unique: false },
    { name: 'ix_orders_open', columns: ['placed_at'], unique: false, filter: 'total = 0' },
  ]);
  assert.deepEqual(orders.triggers, [{ name: 'orders_placed', timing: 'after', events: ['insert'], enabled: true, definition: 'CREATE TRIGGER orders_placed AFTER INSERT ON orders BEGIN SELECT 1; END' }]);

  const lines = main.tables[2];
  assert.deepEqual(lines.primaryKey, ['order_id', 'line']);
  assert.equal(lines.constraints[0].name, 'pk_order_lines');
  assert.equal(lines.columns[0].nullable, false);
  assert.deepEqual(lines.constraints.find((c) => c.kind === 'check'), { name: 'qty_positive', kind: 'check', columns: [], definition: 'qty > 0' });

  assert.deepEqual(database.relations, [
    { from: { table: 'main.orders', columns: ['customer_id'] }, to: { table: 'main.customers', columns: ['id'] }, onDelete: 'CASCADE' },
    { from: { table: 'main.order_lines', columns: ['order_id'] }, to: { table: 'main.orders', columns: ['id'] } },
  ], 'a key that names no column means the primary key of the table it references');

  const view = main.tables[3];
  assert.match(view.definition ?? '', /^CREATE VIEW big_orders AS SELECT id, total/);
  assert.deepEqual(view.columns.map((c) => c.name), ['id', 'total']);
  assert.equal(view.stats, undefined);
});

test('extract counts each table\'s rows and bytes from the file\'s pages, never its rows', async () => {
  const database = await extract({ type: 'sqlite', name: 'Shop', ...shop() });
  const [customers, orders, lines] = database.schemas[0].tables;
  assert.deepEqual([customers.stats?.rows, orders.stats?.rows, lines.stats?.rows], [2, 3, 3], 'a WITHOUT ROWID table counted too');
  assert.ok(customers.stats!.dataBytes >= 4096 && customers.stats!.indexBytes >= 2 * 4096, 'its unique constraint and its index');
  assert.match(database.statsReadAt ?? '', /^\d{4}-/);
  assert.equal(database.unread, undefined);

  const { root, file } = shop();
  const db = new DatabaseSync(join(root, file), { readOnly: true });
  const large = readCatalogue(db, { name: 'Shop', fileBytes: 3 * 1024 ** 3 });
  db.close();
  assert.equal(large.schemas[0].tables[0].stats, undefined);
  assert.deepEqual(large.unread, ['sizes: the file is over 2 GB, and counting them reads all of it']);
});

test('the file is read from the folder dbtour.yaml is in, and what is wrong with it is said', async () => {
  const { root } = shop();
  assert.equal(fileOf({ type: 'sqlite', name: 'Shop', file: 'shop.db', root }), join(root, 'shop.db'));
  await assert.rejects(extract({ type: 'sqlite', name: 'Shop', root }), /add "file: shop\.db" to it in dbtour\.yaml/);
  await assert.rejects(extract({ type: 'sqlite', name: 'Shop', file: 'nope.db', root }), /There is no database at .*nope\.db/);
  writeFileSync(join(root, 'notes.txt'), 'not a database, but long enough to be read as one and refused by SQLite');
  await assert.rejects(extract({ type: 'sqlite', name: 'Shop', file: 'notes.txt', root }), /is not a SQLite database/);
  assert.equal(readOnly, true);
});

test('the review: a key names its table in any case, and an INTEGER PRIMARY KEY DESC is not the rowid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-sqlite-'));
  const db = new DatabaseSync(join(root, 'odd.db'));
  db.exec(`CREATE TABLE Customers (Id INTEGER PRIMARY KEY);
CREATE TABLE orders (customer INTEGER REFERENCES customers (ID));
CREATE TABLE notes (id INTEGER PRIMARY KEY DESC, body TEXT);`);
  db.close();
  const database = await extract({ type: 'sqlite', name: 'Odd', file: 'odd.db', root });
  assert.deepEqual(database.relations, [{ from: { table: 'main.orders', columns: ['customer'] }, to: { table: 'main.Customers', columns: ['Id'] } }], 'SQLite matches the names without case');
  assert.equal(validate({ dbtour: 1, databases: [database], apis: [], links: [], groups: [] }).ok, true);
  const [id] = database.schemas[0].tables.find((t) => t.name === 'notes')!.columns;
  assert.deepEqual(id, { name: 'id', type: 'INTEGER', nullable: true }, 'its own index, NULL allowed, no number given');
});