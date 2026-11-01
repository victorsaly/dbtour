import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, parseRef, tableRef, findTable, relationsOf, emptyModel, type Model } from '../src/model.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

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
