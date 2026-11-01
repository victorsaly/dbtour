import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Model } from '../src/model.ts';
import { buildIndex, search } from '../src/search.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

test('search ranks a table whose name starts with the word first, then groups, then columns', () => {
  const model = shop();
  model.groups.push({ name: 'Ordering', description: 'Money in.', tables: ['dbo.Orders'] });
  const index = buildIndex(model);
  const hits = search(index, 'order');
  assert.deepEqual(hits.slice(0, 3).map((h) => [h.kind, h.title]), [
    ['table', 'dbo.Orders'],
    ['table', 'dbo.OrderLines'],
    ['group', 'Ordering'],
  ]);
  assert.ok(hits.some((h) => h.kind === 'column' && h.title === 'dbo.OrderLines.OrderId'));
  assert.ok(hits.some((h) => h.kind === 'view' && h.title === 'dbo.vOrderTotals'), 'a view containing the word is found, as a view');
  assert.equal(hits.find((h) => h.title === 'dbo.OrderLines')?.detail, '3 columns', 'a table without a description says its size');
});

test('search puts the quality of the match before the kind', () => {
  const model = shop();
  model.groups.push({ name: 'Customer care', tables: ['dbo.Customers'] });
  model.databases[0].schemas[0].tables[1].description = 'Placed by a customer.';
  const index = buildIndex(model);
  const titles = search(index, 'customer').map((h) => `${h.kind} ${h.title}`);
  assert.equal(titles[0], 'table dbo.Customers', 'a table whose name starts with the word');
  assert.equal(titles[1], 'group Customer care', 'then the group whose name starts with it');
  assert.ok(titles.indexOf('column dbo.Orders.CustomerId') < titles.indexOf('table dbo.Orders'), 'a column named for the word beats a table that only mentions it');
});

test('search matches descriptions and types, needs every word, and is empty for no words', () => {
  const index = buildIndex(shop());
  assert.deepEqual(search(index, 'login').map((h) => h.title), ['dbo.Customers.Email']);
  assert.deepEqual(search(index, 'decimal').map((h) => h.kind), ['column', 'column']);
  assert.deepEqual(search(index, 'orders status').map((h) => h.title), ['dbo.Orders.Status']);
  assert.deepEqual(search(index, '  '), []);
  assert.deepEqual(search(index, 'nothing-like-this'), []);
  assert.equal(search(index, 'd', 2).length, 2);
});
