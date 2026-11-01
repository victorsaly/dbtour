import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, findTable, emptyModel } from 'dbtour';
import { mapRecordsets, toRecordsets, formatType, type Recordsets } from '../src/map.ts';

const rows = (): Recordsets => JSON.parse(readFileSync(new URL('./fixtures/rows.json', import.meta.url), 'utf8'));

test('the mapped database is a valid model', () => {
  const database = mapRecordsets(rows());
  const result = validate({ ...emptyModel(), databases: [database] });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('the database takes the server name unless the config names it, and the description from the extended property', () => {
  assert.equal(mapRecordsets(rows()).name, 'Shop');
  assert.equal(mapRecordsets(rows(), { name: 'Web shop' }).name, 'Web shop');
  assert.equal(mapRecordsets(rows()).driver, 'mssql');
  assert.equal(mapRecordsets(rows()).version, '16.0.4135.4');
  assert.equal(mapRecordsets(rows()).description, 'The web shop.');
});

test('tables and views are grouped by schema in the order they came', () => {
  const database = mapRecordsets(rows());
  assert.deepEqual(database.schemas.map((s) => s.name), ['billing', 'dbo']);
  assert.deepEqual(database.schemas[1].tables.map((t) => `${t.name}:${t.kind}`), ['Customers:table', 'OrderLines:table', 'Orders:table', 'Shipments:table', 'sysdiagrams_old:table', 'vOrderTotals:view']);
  const model = { ...emptyModel(), databases: [database] };
  assert.equal(findTable(model, 'dbo.Customers')!.table.description, 'One row per account.');
  assert.match(findTable(model, 'dbo.vOrderTotals')!.table.definition!, /^CREATE VIEW/);
  assert.equal(findTable(model, 'dbo.Orders')!.table.definition, undefined);
});

test('columns keep their order, type, nullability, default, identity, computed expression and description', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  const orders = findTable(model, 'dbo.Orders')!.table;
  assert.deepEqual(orders.columns.map((c) => c.name), ['Id', 'CustomerId', 'Status', 'CreatedAt', 'Net', 'Total']);
  assert.deepEqual(orders.columns[0], { name: 'Id', type: 'int', nullable: false, identity: true });
  assert.deepEqual(orders.columns[2], { name: 'Status', type: 'tinyint', nullable: false, default: '((0))' });
  assert.deepEqual(orders.columns[3], { name: 'CreatedAt', type: 'datetime2(7)', nullable: false, default: '(sysutcdatetime())' });
  assert.deepEqual(orders.columns[5], { name: 'Total', type: 'decimal(19,2)', nullable: true, computed: '([Net]*(1.2))' });
  const customers = findTable(model, 'dbo.Customers')!.table;
  assert.deepEqual(customers.columns[1], { name: 'Email', type: 'nvarchar(320)', nullable: false, description: 'Login address.' });
  assert.equal(customers.columns[2].type, 'varchar(max)');
});

test('each table carries its rows and bytes, bigint strings made numbers, with the moment they were read', () => {
  const database = mapRecordsets(rows());
  const model = { ...emptyModel(), databases: [database] };
  assert.deepEqual(findTable(model, 'dbo.Customers')!.table.stats, { rows: 48213, dataBytes: 7397376, indexBytes: 1654784 });
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.stats, { rows: 312904, dataBytes: 30859264, indexBytes: 9764864 });
  assert.deepEqual(findTable(model, 'dbo.Shipments')!.table.stats, { rows: 0, dataBytes: 0, indexBytes: 0 }, 'an empty table is counted, not absent');
  assert.equal(findTable(model, 'dbo.vOrderTotals')!.table.stats, undefined, 'a view keeps no rows of its own');
  assert.equal(database.statsReadAt, '2026-11-01T09:30:00.1234567Z');
});

test('a server that gave no sizes leaves stats and their moment out', () => {
  const sets = rows();
  for (const table of sets.tables) Object.assign(table, { rows: null, dataBytes: null, indexBytes: null });
  const database = mapRecordsets(sets);
  assert.equal(database.schemas.flatMap((s) => s.tables).some((t) => t.stats), false);
  assert.equal(database.statsReadAt, undefined);
});

test('formatType spells sizes as CREATE TABLE would', () => {
  assert.equal(formatType({ type: 'nvarchar', maxLength: -1, precision: 0, scale: 0 }), 'nvarchar(max)');
  assert.equal(formatType({ type: 'char', maxLength: 10, precision: 0, scale: 0 }), 'char(10)');
  assert.equal(formatType({ type: 'varbinary', maxLength: 8000, precision: 0, scale: 0 }), 'varbinary(8000)');
  assert.equal(formatType({ type: 'numeric', maxLength: 9, precision: 10, scale: 4 }), 'numeric(10,4)');
  assert.equal(formatType({ type: 'time', maxLength: 5, precision: 16, scale: 7 }), 'time(7)');
  assert.equal(formatType({ type: 'datetimeoffset', maxLength: 10, precision: 34, scale: 7 }), 'datetimeoffset(7)');
  assert.equal(formatType({ type: 'bigint', maxLength: 8, precision: 19, scale: 0 }), 'bigint');
  assert.equal(formatType({ type: 'uniqueidentifier', maxLength: 16, precision: 0, scale: 0 }), 'uniqueidentifier');
});

test('primary keys keep their column order, including composite ones, and unique constraints are constraints', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  assert.deepEqual(findTable(model, 'dbo.OrderLines')!.table.primaryKey, ['OrderId', 'LineNo']);
  assert.deepEqual(findTable(model, 'dbo.Customers')!.table.constraints, [
    { name: 'PK_Customers', kind: 'primary', columns: ['Id'] },
    { name: 'UQ_Customers_Email', kind: 'unique', columns: ['Email'] },
  ]);
});

test('foreign keys become relations with every column pair in order, with cascade actions when set', () => {
  const database = mapRecordsets(rows());
  const shipments = database.relations.find((r) => r.name === 'FK_Shipments_OrderLines')!;
  assert.deepEqual(shipments.from, { table: 'dbo.Shipments', columns: ['OrderId', 'LineNo'] });
  assert.deepEqual(shipments.to, { table: 'dbo.OrderLines', columns: ['OrderId', 'LineNo'] });
  assert.equal(shipments.onDelete, undefined);
  const lines = database.relations.find((r) => r.name === 'FK_OrderLines_Orders')!;
  assert.equal(lines.onDelete, 'CASCADE');
  assert.equal(lines.onUpdate, undefined);
  const model = { ...emptyModel(), databases: [database] };
  const foreign = findTable(model, 'dbo.Shipments')!.table.constraints.find((c) => c.kind === 'foreign')!;
  assert.deepEqual(foreign, { name: 'FK_Shipments_OrderLines', kind: 'foreign', columns: ['OrderId', 'LineNo'], definition: 'dbo.OrderLines (OrderId, LineNo)' });
});

test('indexes leave out the primary key and keep included columns apart', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.indexes, [{ name: 'IX_Orders_CustomerId', columns: ['CustomerId'], unique: false, included: ['Status', 'CreatedAt'] }]);
  assert.deepEqual(findTable(model, 'dbo.Customers')!.table.indexes, [{ name: 'UQ_Customers_Email', columns: ['Email'], unique: true }]);
});

test('check constraints are constraints with their definition', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  const check = findTable(model, 'dbo.Orders')!.table.constraints.find((c) => c.kind === 'check');
  assert.deepEqual(check, { name: 'CK_Orders_Status', kind: 'check', columns: ['Status'], definition: '([Status]<=(9))' });
});

test('exclude leaves tables out by pattern, along with their relations', () => {
  const database = mapRecordsets(rows(), { exclude: ['dbo.sys*', '*.Invoices'] });
  const names = database.schemas.flatMap((s) => s.tables.map((t) => `${s.name}.${t.name}`));
  assert.ok(!names.includes('dbo.sysdiagrams_old'));
  assert.ok(!names.includes('billing.Invoices'));
  assert.ok(names.includes('dbo.Orders'));
  assert.equal(database.relations.some((r) => r.name === 'FK_Invoices_Orders'), false);
  assert.equal(validate({ ...emptyModel(), databases: [database] }).ok, true);
});

test('toRecordsets insists on the seven result sets of query.sql', () => {
  assert.throws(() => toRecordsets([[], []]), /7 result sets, got 2/);
  const r = rows();
  const sets = toRecordsets([r.info, r.tables, r.columns, r.keys, r.foreignKeys, r.indexes, r.checks]);
  assert.equal(sets.checks.length, 2);
});
