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
  assert.deepEqual(orders.columns[0], { name: 'Id', type: 'int', nullable: false, identity: true, identitySeed: '1', identityIncrement: '1' });
  assert.deepEqual(orders.columns[2], { name: 'Status', type: 'tinyint', nullable: false, default: '((0))', properties: { Values: '0 draft, 1 paid' } });
  assert.deepEqual(orders.columns[3], { name: 'CreatedAt', type: 'datetime2(7)', nullable: false, default: '(sysutcdatetime())' });
  assert.deepEqual(orders.columns[5], { name: 'Total', type: 'decimal(19,2)', nullable: true, computed: '([Net]*(1.2))' });
  const customers = findTable(model, 'dbo.Customers')!.table;
  assert.deepEqual(customers.columns[1], {
    name: 'Email', type: 'nvarchar(320)', nullable: false, description: 'Login address.',
    collation: 'Latin1_General_BIN2', masked: 'email()', sensitivity: { label: 'Confidential', informationType: 'Contact Info', rank: 'medium' },
  });
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
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.indexes.map((i) => [i.name, i.columns, i.unique, i.included]), [['IX_Orders_CustomerId', ['CustomerId'], false, ['Status', 'CreatedAt']]]);
  assert.deepEqual(findTable(model, 'dbo.Customers')!.table.indexes, [{ name: 'UQ_Customers_Email', columns: ['Email'], unique: true, type: 'nonclustered', disabled: true }]);
});

test('check constraints are constraints with their definition', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  const check = findTable(model, 'dbo.Orders')!.table.constraints.find((c) => c.kind === 'check');
  assert.deepEqual(check, { name: 'CK_Orders_Status', kind: 'check', columns: ['Status'], definition: '([Status]<=(9))', disabled: true, untrusted: true });
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

test('toRecordsets insists on the thirteen result sets of query.sql', () => {
  assert.throws(() => toRecordsets([[], []]), /13 result sets, got 2/);
  const r = rows();
  const sets = toRecordsets([r.info, r.tables, r.columns, r.keys, r.foreignKeys, r.indexes, r.checks, r.properties, r.features, r.triggers, r.security, r.columnSecurity, r.sensitivity]);
  assert.equal(sets.checks.length, 2);
  assert.equal(sets.sensitivity.length, 1);
});

test('an indexed view keeps no stats, though its clustered index has rows in sys.partitions', () => {
  const sets = rows();
  Object.assign(sets.tables.find((t) => t.name === 'vOrderTotals')!, { rows: 120, dataBytes: 16384, indexBytes: 0 });
  const model = { ...emptyModel(), databases: [mapRecordsets(sets)] };
  assert.equal(findTable(model, 'dbo.vOrderTotals')!.table.stats, undefined);
});

test('extended properties other than descriptions land on what they describe, an excluded table\'s nowhere', () => {
  const database = mapRecordsets(rows(), { exclude: ['dbo.sysdiagrams*'] });
  const model = { ...emptyModel(), databases: [database] };
  const orders = findTable(model, 'dbo.Orders')!.table;
  assert.deepEqual(database.properties, { Owner: 'Data team' }, 'the database description is read apart');
  assert.deepEqual(database.schemas.find((s) => s.name === 'billing')!.properties, { MS_Description: 'Money in.' }, 'a schema has no description of its own, so it keeps the property');
  assert.deepEqual(orders.properties, { Retention: '7 years' });
  assert.deepEqual(orders.columns.find((c) => c.name === 'Status')!.properties, { Values: '0 draft, 1 paid' }, 'a NULL value is left out');
  assert.deepEqual(orders.indexes[0].properties, { Why: 'checkout lookups' });
  assert.deepEqual(orders.constraints.find((c) => c.name === 'PK_Orders')!.properties, { Note: 'from 2019' });
  assert.deepEqual(orders.constraints.find((c) => c.name === 'FK_Orders_Customers')!.properties, { Note: 'a foreign key keeps its own' });
  assert.equal(findTable(model, 'dbo.Customers')!.table.properties, undefined);
});

test('a table\'s features: temporal both ways, memory-optimised, ledger, partitioning, compression, tracking, dates', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  const orders = findTable(model, 'dbo.Orders')!.table;
  assert.deepEqual(orders.temporal, { history: 'dbo.Shipments', start: 'CreatedAt', end: 'CreatedAt' });
  assert.equal(findTable(model, 'dbo.Shipments')!.table.historyOf, 'dbo.Orders');
  assert.deepEqual(orders.partitioning, { scheme: 'psByYear', function: 'pfByYear', column: 'CreatedAt', partitions: 12 });
  assert.equal(orders.compression, 'page');
  assert.equal(orders.changeTracking, true);
  assert.equal(orders.cdc, true);
  assert.equal(orders.ledger, undefined, 'not a ledger table');
  assert.equal(orders.created, '2024-01-02T09:00:00.123');
  assert.equal(orders.altered, '2026-10-30T17:00:00.456');
  const customers = findTable(model, 'dbo.Customers')!.table;
  assert.equal(customers.memoryOptimised, 'schema only');
  assert.equal(customers.ledger, 'append-only');
  assert.equal(customers.compression, undefined, 'NONE is no compression');
  assert.equal(customers.partitioning, undefined);
  assert.equal(customers.changeTracking, undefined, 'false is left out');
});

test('triggers gather their events; row-level security names its policy and operation', () => {
  const model = { ...emptyModel(), databases: [mapRecordsets(rows())] };
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.triggers, [
    { name: 'trOrdersAudit', timing: 'after', events: ['insert', 'update'], enabled: true, definition: 'CREATE TRIGGER dbo.trOrdersAudit ON dbo.Orders AFTER INSERT, UPDATE AS SET NOCOUNT ON;' },
  ]);
  assert.deepEqual(findTable(model, 'dbo.vOrderTotals')!.table.triggers, [{ name: 'trTotalsInstead', timing: 'instead of', events: ['delete'], enabled: false }]);
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.security, [
    { policy: 'rls.Tenants', kind: 'filter', predicate: '([rls].[fnTenant]([CustomerId]))', enabled: true },
    { policy: 'rls.Tenants', kind: 'block', operation: 'after insert', predicate: '([rls].[fnTenant]([CustomerId]))', enabled: true },
  ]);
});

test('columns: collation only where it differs, identity seed, sparse, masking, encryption, sensitivity', () => {
  const database = mapRecordsets(rows());
  const model = { ...emptyModel(), databases: [database] };
  assert.equal(database.collation, 'Latin1_General_CI_AS');
  const customers = findTable(model, 'dbo.Customers')!.table;
  const email = customers.columns.find((c) => c.name === 'Email')!;
  assert.equal(email.collation, 'Latin1_General_BIN2');
  assert.equal(email.masked, 'email()');
  assert.deepEqual(email.sensitivity, { label: 'Confidential', informationType: 'Contact Info', rank: 'medium' });
  assert.equal(customers.columns.find((c) => c.name === 'Notes')!.collation, undefined, 'the database default is not repeated');
  assert.equal(customers.columns.find((c) => c.name === 'Notes')!.sparse, true);
  assert.deepEqual([customers.columns[0].identitySeed, customers.columns[0].identityIncrement], ['1', '1']);
  assert.deepEqual(findTable(model, 'dbo.Orders')!.table.columns.find((c) => c.name === 'Net')!.encrypted, { type: 'deterministic', key: 'CEK_Auto1' });
  assert.equal(database.unread, undefined, 'the labels were read');
});

test('index kinds and filters, keys and checks not enforced or not trusted', () => {
  const database = mapRecordsets(rows());
  const model = { ...emptyModel(), databases: [database] };
  const orders = findTable(model, 'dbo.Orders')!.table;
  assert.deepEqual(orders.indexes[0], { name: 'IX_Orders_CustomerId', columns: ['CustomerId'], unique: false, included: ['Status', 'CreatedAt'], type: 'nonclustered', filter: '([Status]<(9))', properties: { Why: 'checkout lookups' } });
  assert.equal(findTable(model, 'dbo.Customers')!.table.indexes.find((i) => i.name === 'UQ_Customers_Email')!.disabled, true);
  const check = orders.constraints.find((c) => c.name === 'CK_Orders_Status')!;
  assert.deepEqual([check.disabled, check.untrusted], [true, true]);
  const invoices = database.relations.find((r) => r.name === 'FK_Invoices_Orders')!;
  assert.deepEqual([invoices.disabled, invoices.untrusted], [undefined, true]);
  assert.equal(findTable(model, 'billing.Invoices')!.table.constraints.find((c) => c.name === 'FK_Invoices_Orders')!.untrusted, true);
});

test('labels the login may not read are said to be unread; a server too old to keep them says nothing', () => {
  const denied = rows();
  denied.info[0].labels = 'denied';
  denied.sensitivity = [];
  assert.deepEqual(mapRecordsets(denied).unread, ['sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION']);
  const old = rows();
  old.info[0].labels = 'absent';
  old.sensitivity = [];
  assert.equal(mapRecordsets(old).unread, undefined);
});

test('rows from before the catalogue sets, as a 0.3 query returned them, still map', () => {
  const r = rows();
  const sets = toRecordsets([r.info, r.tables, r.columns, r.keys, r.foreignKeys, r.indexes, r.checks, [], [], [], [], [], []]);
  const database = mapRecordsets(sets);
  assert.equal(validate({ ...emptyModel(), databases: [database] }).ok, true);
});

test('the review: a primary key index\'s properties land on its constraint, and __proto__ is a name like any', () => {
  const sets = rows();
  sets.properties.push(
    { on: 'index', schema: 'dbo', table: 'Orders', item: 'PK_Orders', name: 'Fill', value: '90' },
    { on: 'index', schema: 'dbo', table: 'Orders', item: 'PK_Orders', name: 'Note', value: 'the index says otherwise' },
    { on: 'table', schema: 'dbo', table: 'Orders', item: null, name: '__proto__', value: 'kept' },
  );
  const model = { ...emptyModel(), databases: [mapRecordsets(sets)] };
  const orders = findTable(model, 'dbo.Orders')!.table;
  assert.deepEqual(orders.constraints.find((c) => c.name === 'PK_Orders')!.properties, { Note: 'from 2019', Fill: '90', 'Note (index)': 'the index says otherwise' });
  assert.deepEqual(Object.entries(orders.properties!), [['Retention', '7 years'], ['__proto__', 'kept']]);
  assert.match(JSON.stringify(orders.properties), /"__proto__":"kept"/);
});

test('the review: compression read from every partition, a mix kept as a list', () => {
  const sets = rows();
  sets.features[0].compression = 'NONE,PAGE';
  sets.features[1].compression = 'ROW';
  const model = { ...emptyModel(), databases: [mapRecordsets(sets)] };
  assert.equal(findTable(model, 'dbo.Orders')!.table.compression, 'none, page');
  assert.equal(findTable(model, 'dbo.Customers')!.table.compression, 'row');
});

/**
 * Reads T-SQL as SQL Server does for quoting: '' inside a string is a quote, -- and block comments only
 * count outside one. Returns each string's text, or throws when the batch ends inside a string, which is
 * what a stray apostrophe does (in a comment written inside text the batch assembles, say).
 */
function literals(sql: string, where: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) i = sql.indexOf('\n', i) === -1 ? sql.length : sql.indexOf('\n', i);
    else if (sql.startsWith('/*', i)) i = sql.indexOf('*/', i) + 2;
    else if (sql[i] === "'") {
      let text = '';
      i++;
      for (;;) {
        if (i >= sql.length) throw new Error(`${where} ends inside a string that starts: ${text.slice(0, 80)}`);
        if (sql[i] === "'" && sql[i + 1] === "'") {
          text += "'";
          i += 2;
        } else if (sql[i] === "'") break;
        else text += sql[i++];
      }
      found.push(text);
      i++;
      // A string never runs straight into a word: 'abc'def is what an apostrophe in prose leaves behind.
      if (/\w/.test(sql[i] ?? '')) throw new Error(`${where} has a string that runs into "${sql.slice(i, i + 20)}": a stray apostrophe before it`);
    } else i++;
  }
  return found;
}

test('query.sql quotes balance, and so does every query it assembles as text', () => {
  const sql = readFileSync(new URL('../src/query.sql', import.meta.url), 'utf8');
  const assembled = literals(sql, 'query.sql').filter((text) => /\bSELECT\b/.test(text));
  assert.ok(assembled.length >= 4, 'the version-guarded sets are text the batch runs');
  for (const text of assembled) assert.doesNotThrow(() => literals(text, 'an assembled query'));
  // A stray apostrophe in a comment inside the text is the mistake this guards against.
  assert.throws(() => literals("SELECT N'\n-- a partition's note\nSELECT 1';", 'the example'), /stray apostrophe|ends inside a string/);
});
