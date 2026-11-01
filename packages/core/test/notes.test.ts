import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNotes, applyNotes } from '../src/notes.ts';
import { findTable, type Model } from '../src/model.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

const text = `
tables:
  dbo.Orders:
    description: One row per checkout.
    columns:
      Status: 0 draft, 1 paid, 2 shipped, 9 cancelled
  dbo.Customers:
    description: Overrides what the database says.
relations:
  - from: billing.Invoices.OrderId
    to: dbo.Orders.Id
  - from: dbo.Products.Sku
    to: dbo.Customers.Email
groups:
  - name: Billing
    description: Money in.
    tables: [dbo.Orders, billing.Invoices]
`;

test('parseNotes reads tables, relations and groups', () => {
  const notes = parseNotes(text);
  assert.equal(notes.tables['dbo.Orders'].description, 'One row per checkout.');
  assert.equal(notes.tables['dbo.Orders'].columns?.Status, '0 draft, 1 paid, 2 shipped, 9 cancelled');
  assert.equal(notes.relations.length, 2);
  assert.deepEqual(notes.groups[0].tables, ['dbo.Orders', 'billing.Invoices']);
});

test('parseNotes of an empty file is empty notes, and bad shapes are named', () => {
  assert.deepEqual(parseNotes(''), { tables: {}, relations: [], groups: [] });
  assert.throws(() => parseNotes('tables: [1, 2]'), /tables/);
  assert.throws(() => parseNotes('relations:\n  - from: dbo.Orders\n    to: dbo.Customers.Id'), /schema\.table\.column/);
  assert.throws(() => parseNotes('groups:\n  - tables: [dbo.Orders]'), /name/);
});

test('applyNotes merges descriptions, adds virtual relations and groups, and leaves the input alone', () => {
  const model = shop();
  const before = JSON.stringify(model);
  const { model: merged, warnings } = applyNotes(model, parseNotes(text));
  assert.equal(JSON.stringify(model), before);
  assert.deepEqual(warnings, []);
  const orders = findTable(merged, 'dbo.Orders')!.table;
  assert.equal(orders.description, 'One row per checkout.');
  assert.equal(orders.columns.find((c) => c.name === 'Status')!.description, '0 draft, 1 paid, 2 shipped, 9 cancelled');
  assert.equal(findTable(merged, 'dbo.Customers')!.table.description, 'Overrides what the database says.');
  const virtual = merged.databases[0].relations.filter((r) => r.virtual);
  // The Invoices → Orders relation already exists as a foreign key, so only the other is added.
  assert.equal(virtual.length, 1);
  assert.deepEqual(virtual[0].from, { table: 'dbo.Products', columns: ['Sku'] });
  assert.deepEqual(merged.groups, [{ name: 'Billing', description: 'Money in.', tables: ['dbo.Orders', 'billing.Invoices'] }]);
});

test('applyNotes warns about tables and columns it cannot find, and skips them', () => {
  const notes = parseNotes(`
tables:
  dbo.Ghost:
    description: gone
  dbo.Orders:
    columns:
      Nope: nothing
relations:
  - from: dbo.Ghost.Id
    to: dbo.Orders.Id
groups:
  - name: G
    tables: [dbo.Orders, dbo.Ghost]
`);
  const { model: merged, warnings } = applyNotes(shop(), notes);
  assert.equal(warnings.length, 4, warnings.join('\n'));
  assert.match(warnings[0], /dbo\.Ghost/);
  assert.match(warnings[1], /dbo\.Orders\.Nope/);
  assert.equal(merged.databases[0].relations.filter((r) => r.virtual).length, 0);
  assert.deepEqual(merged.groups[0].tables, ['dbo.Orders']);
});
