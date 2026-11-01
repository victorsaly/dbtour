import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe } from './fixtures/described.ts';
import { validate, parseRef, tableRef, findTable, relationsOf, emptyModel, type Model } from '../src/model.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));
const described = (): Model => describe(shop());

test('the fixture is a valid model', () => {
  const result = validate(shop());
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('an empty model is valid and has every top-level list', () => {
  const result = validate(emptyModel());
  assert.equal(result.ok, true);
  assert.deepEqual(emptyModel(), { dbtour: 1, databases: [], apis: [], links: [], groups: [] });
});

test('validate names what is wrong and where', () => {
  const broken = shop();
  broken.databases[0].schemas[0].tables[1].columns[0].nullable = 'no' as unknown as boolean;
  delete (broken.databases[0].schemas[0].tables[2] as Partial<{ name: string }>).name;
  const result = validate(broken);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.join('\n'), /databases\[0\]\.schemas\[0\]\.tables\[1\]\.columns\[0\]\.nullable/);
  assert.match(result.errors.join('\n'), /databases\[0\]\.schemas\[0\]\.tables\[2\]\.name/);
});

test('validate rejects what is not a model at all', () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate({ dbtour: 2, databases: [] }).ok, false);
  assert.equal(validate('{}').ok, false);
});

test('validate rejects a relation to a table that does not exist', () => {
  const broken = shop();
  broken.databases[0].relations.push({ from: { table: 'dbo.Orders', columns: ['Id'] }, to: { table: 'dbo.Nowhere', columns: ['Id'] } });
  const result = validate(broken);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.join('\n'), /dbo\.Nowhere/);
});

test('refs are schema.table and schema.table.column', () => {
  assert.equal(tableRef('dbo', 'Users'), 'dbo.Users');
  assert.deepEqual(parseRef('dbo.Users'), { schema: 'dbo', table: 'Users' });
  assert.deepEqual(parseRef('dbo.Users.Id'), { schema: 'dbo', table: 'Users', column: 'Id' });
  assert.throws(() => parseRef('Users'), /schema\.table/);
});

test('findTable and relationsOf walk the model', () => {
  const model = shop();
  const orders = findTable(model, 'dbo.Orders');
  assert.equal(orders?.table.name, 'Orders');
  assert.equal(orders?.schema.name, 'dbo');
  assert.equal(findTable(model, 'dbo.Nope'), undefined);
  const rel = relationsOf(model, 'dbo.Orders');
  assert.deepEqual(rel.out.map((r) => r.to.table), ['dbo.Customers']);
  assert.deepEqual(rel.in.map((r) => r.from.table).sort(), ['billing.Invoices', 'dbo.OrderLines']);
});

test('stats are optional, and when given are counts and byte sizes that are not negative', () => {
  const model = shop();
  const customers = model.databases[0].schemas[0].tables[0];
  delete customers.stats;
  assert.equal(validate(model).ok, true, 'a table without stats is valid');
  customers.stats = { rows: -1, dataBytes: 8192, indexBytes: 'big' as unknown as number };
  model.databases[0].statsReadAt = 20261101 as unknown as string;
  const result = validate(model);
  assert.equal(result.ok, false);
  if (result.ok) return;
  const errors = result.errors.join('\n');
  assert.match(errors, /databases\[0\]\.schemas\[0\]\.tables\[0\]\.stats\.rows must be a number of 0 or more/);
  assert.match(errors, /tables\[0\]\.stats\.indexBytes must be a number of 0 or more/);
  assert.doesNotMatch(errors, /dataBytes/);
  assert.match(errors, /databases\[0\]\.statsReadAt must be a string/);
  model.databases[0].schemas[0].tables[0].stats = 'none' as unknown as undefined;
  assert.match((validate(model) as { errors: string[] }).errors.join('\n'), /tables\[0\]\.stats must be an object/);
});

test('everything the catalogue says is optional, and a model that has it all is valid', () => {
  const result = validate(described());
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('validate names what the catalogue fields have wrong', () => {
  const model = described();
  const orders = model.databases[0].schemas[0].tables[1];
  (orders as unknown as Record<string, unknown>).properties = { Retention: 7 };
  (orders as unknown as Record<string, unknown>).temporal = { history: 'dbo.OrdersHistory' };
  (orders as unknown as Record<string, unknown>).partitioning = { scheme: 'ps', function: 'pf', column: 'At', partitions: -1 };
  (orders as unknown as Record<string, unknown>).triggers = [{ name: 'tr', timing: 'before', events: 'insert', enabled: 'yes' }];
  (orders as unknown as Record<string, unknown>).changeTracking = 'on';
  (orders.columns[3] as unknown as Record<string, unknown>).encrypted = { type: 'scrambled', key: 'CEK' };
  (orders.indexes[0] as unknown as Record<string, unknown>).disabled = 1;
  (model.databases[0] as unknown as Record<string, unknown>).unread = 'labels';
  const result = validate(model);
  assert.equal(result.ok, false);
  if (result.ok) return;
  const errors = result.errors.join('\n');
  for (const expected of [
    /tables\[1\]\.properties\.Retention must be a string/,
    /tables\[1\]\.temporal\.start must be a non-empty string/,
    /tables\[1\]\.partitioning\.partitions must be a number of 0 or more/,
    /tables\[1\]\.triggers\[0\]\.timing must be "after" or "instead of"/,
    /tables\[1\]\.triggers\[0\]\.events must be a list of strings/,
    /tables\[1\]\.triggers\[0\]\.enabled must be true or false/,
    /tables\[1\]\.changeTracking must be true or false when given/,
    /columns\[3\]\.encrypted\.type must be "deterministic" or "randomized"/,
    /indexes\[0\]\.disabled must be true or false when given/,
    /databases\[0\]\.unread must be a list of strings/,
  ]) assert.match(errors, expected);
});
