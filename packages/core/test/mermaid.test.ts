import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { erDiagram, neighbourhood, entityName } from '../src/render/mermaid.ts';
import type { Model } from '../src/model.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

test('neighbourhood is the table and what it touches at distance one', () => {
  assert.deepEqual(neighbourhood(shop(), 'dbo.Orders'), ['dbo.Orders', 'dbo.Customers', 'dbo.OrderLines', 'billing.Invoices']);
  assert.deepEqual(neighbourhood(shop(), 'dbo.Products'), ['dbo.Products', 'dbo.OrderLines']);
  assert.deepEqual(neighbourhood(shop(), 'dbo.vOrderTotals'), ['dbo.vOrderTotals']);
});

test('entity names are what Mermaid accepts', () => {
  assert.equal(entityName('dbo.Order Lines'), 'dbo_Order_Lines');
  assert.equal(entityName('billing.Invoices'), 'billing_Invoices');
});

test('erDiagram draws the given tables, their keys and the relations among them only', () => {
  const text = erDiagram(shop(), ['dbo.Orders', 'dbo.Customers']);
  assert.match(text, /^erDiagram\n/);
  assert.match(text, /dbo_Orders \{\n/);
  assert.match(text, /int Id PK/);
  assert.match(text, /int CustomerId FK/);
  assert.match(text, /decimal\(18,2\) Total/);
  assert.match(text, /dbo_Orders \}o--\|\| dbo_Customers : CustomerId/);
  assert.doesNotMatch(text, /OrderLines/);
});

test('a column whose name or type Mermaid cannot take is spelt with underscores, never quoted', () => {
  const model = shop();
  model.databases[0].schemas[0].tables[0].columns.push({ name: 'Order Date', type: 'geography::point', nullable: true });
  const text = erDiagram(model, ['dbo.Customers']);
  assert.match(text, /geography__point Order_Date/);
  assert.doesNotMatch(text, /"/);
});

test('erDiagram marks a virtual relation and a composite key', () => {
  const model = shop();
  model.databases[0].relations.push({ from: { table: 'dbo.Products', columns: ['Sku'] }, to: { table: 'dbo.Customers', columns: ['Email'] }, virtual: true });
  const text = erDiagram(model, ['dbo.Products', 'dbo.Customers', 'dbo.OrderLines', 'dbo.Orders']);
  assert.match(text, /dbo_Products \}o\.\.\|\| dbo_Customers : "Sku \(notes\)"/);
  assert.match(text, /int OrderId PK,FK/);
});
