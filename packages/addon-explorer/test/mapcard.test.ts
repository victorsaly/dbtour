// The map answers a click: what a selected table or line says on its card, what stays inked around it, the
// query a line writes, and the address the editor opens seeded from. All pure, so tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scope, type Model } from 'dbtour/model';
import { catalogue } from '../src/page/catalogue.ts';
import { subgraph } from '../src/page/graph.ts';
import { inked, linkCard, tableCard, without } from '../src/page/mapcard.ts';
import { joinQuery } from '../src/page/query.ts';
import { databaseOf } from '../src/page/databases.ts';
import { parseRoute, routeHash, sqlFromHash, sqlJoinHash } from '../src/page/route.ts';
import { twoDatabases } from '../../core/test/fixtures/two.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
const several = (): Model => scope(JSON.parse(readFileSync(new URL('../../../examples/several/docs/schema.json', import.meta.url), 'utf8')));

test('a selected table keeps itself, its neighbours on the map and the lines between them inked', () => {
  const model = shop();
  const graph = subgraph(model, ['dbo.Orders', 'dbo.Customers', 'dbo.OrderLines', 'dbo.Products']);
  const orders = inked(graph, { kind: 'table', ref: 'dbo.Orders' })!;
  assert.deepEqual([...orders.tables].sort(), ['dbo.Customers', 'dbo.OrderLines', 'dbo.Orders'], 'Products is two steps away');
  assert.deepEqual([...orders.links].sort(), ['dbo.OrderLines>dbo.Orders', 'dbo.Orders>dbo.Customers']);
  const line = inked(graph, { kind: 'link', id: 'dbo.OrderLines>dbo.Products' })!;
  assert.deepEqual([...line.tables].sort(), ['dbo.OrderLines', 'dbo.Products'], 'a line keeps its two ends');
  assert.deepEqual([...line.links], ['dbo.OrderLines>dbo.Products']);
  assert.equal(inked(graph, undefined), undefined, 'nothing selected, nothing faded');
  assert.equal(inked(graph, { kind: 'table', ref: 'dbo.Nowhere' }), undefined, 'a table that left the map is no selection');
});

test('a table\'s card says what it is, how big, its keys, and each link out and in with whether its table is on the map', () => {
  const model = shop();
  const cat = catalogue(model);
  const graph = subgraph(model, ['dbo.Orders', 'dbo.Customers']);
  const card = tableCard(model, cat, graph, 'dbo.Orders')!;
  assert.equal(card.ref, 'dbo.Orders');
  assert.equal(card.number, '002');
  assert.equal(card.name, 'Orders');
  assert.equal(card.kind, 'table');
  assert.equal(card.size, '312,904 rows · 39 MB');
  assert.equal(card.columns, 5);
  assert.deepEqual(card.keys, ['Id']);
  assert.deepEqual(card.references, [{ columns: ['CustomerId'], table: 'dbo.Customers', onMap: true, virtual: false }]);
  assert.deepEqual(card.referencedBy.map((l) => `${l.table}.${l.columns.join(',')} ${l.onMap ? 'on' : 'off'}`), ['dbo.OrderLines.OrderId off', 'billing.Invoices.OrderId off']);
  assert.equal(tableCard(model, cat, graph, 'dbo.vOrderTotals')!.size, 'no rows of its own', 'a view says so');
  assert.equal(tableCard(model, cat, graph, 'dbo.Nowhere'), undefined);
});

test('a line\'s card names the columns each relation joins, every one when two run in parallel', () => {
  const model = shop();
  model.databases[0].relations.push({ from: { table: 'dbo.OrderLines', columns: ['ProductId'] }, to: { table: 'dbo.Orders', columns: ['Id'] }, virtual: true });
  const graph = subgraph(model, ['dbo.Orders', 'dbo.OrderLines']);
  assert.deepEqual(linkCard(graph, 'dbo.OrderLines>dbo.Orders'), {
    id: 'dbo.OrderLines>dbo.Orders',
    from: 'dbo.OrderLines',
    to: 'dbo.Orders',
    joins: [
      { from: ['OrderId'], to: ['Id'], virtual: false },
      { from: ['ProductId'], to: ['Id'], virtual: true },
    ],
  });
  assert.equal(linkCard(graph, 'dbo.Orders>dbo.Customers'), undefined, 'Customers is not on this map');
});

test('hiding a table takes it off the map and keeps the rest in their order', () => {
  assert.deepEqual(without(['a.b', 'c.d', 'e.f'], 'c.d'), ['a.b', 'e.f']);
  assert.deepEqual(without(['a.b'], 'x.y'), ['a.b']);
});

test('a line writes its join: both tables\' columns that are not protected, joined on the relation, in the database\'s SQL', () => {
  const model = shop();
  model.databases[0].schemas[0].tables.find((t) => t.name === 'Customers')!.columns.find((c) => c.name === 'Email')!.masked = 'email()';
  const sql = joinQuery(model, 'dbo.Orders', 'dbo.Customers');
  assert.match(sql, /^-- dbo\.Orders joined to dbo\.Customers on CustomerId\.\n/);
  assert.match(sql, /SELECT TOP \(100\)\n {4}o\.Id,/);
  assert.match(sql, /FROM dbo\.Orders AS o\nJOIN dbo\.Customers AS c ON c\.Id = o\.CustomerId;$/, 'names quoted only where they need it, as the starter writes them');
  assert.doesNotMatch(sql, /c\.Email/, 'a masked column is left out, as the starter leaves it');
  assert.match(sql, /c\.Id AS CustomersId/, 'a name both tables have is told apart by its table');
  const lite = joinQuery(several(), 'Chinook:main.Invoice', 'Chinook:main.Customer');
  assert.match(lite, /FROM main\.Invoice AS i\nJOIN main\.Customer AS c ON c\.CustomerId = i\.CustomerId\nLIMIT 100;$/, 'SQLite: names as the starter writes them, without the database, and LIMIT at the end');
  assert.match(joinQuery(model, 'dbo.Customers', 'dbo.Products'), /^-- dbo\.Customers and dbo\.Products are not related/, 'no relation, no join invented');
});

test('the editor opens seeded from a table, or from the join of two, at an address of its own', () => {
  assert.equal(sqlFromHash('dbo.Orders'), '#sql/dbo.Orders');
  assert.equal(sqlJoinHash('Chinook:main.Invoice', 'Chinook:main.Customer'), '#sql/Chinook:main.Invoice/Chinook:main.Customer');
  assert.deepEqual(parseRoute('#sql/dbo.Orders'), { kind: 'sql', table: 'dbo.Orders' });
  assert.deepEqual(parseRoute('#sql/Chinook:main.Invoice/Chinook:main.Customer'), { kind: 'sql', table: 'Chinook:main.Invoice', to: 'Chinook:main.Customer' });
  assert.deepEqual(parseRoute(sqlFromHash('main.Order Details')), { kind: 'sql', table: 'main.Order Details' }, 'a space in a name survives');
  assert.deepEqual(parseRoute('#sql'), { kind: 'sql' });
  assert.deepEqual(parseRoute('#sql/x'), { kind: 'home' }, 'what follows must be a table');
  assert.deepEqual(parseRoute('#sql/dbo.Orders/x'), { kind: 'home' });
  assert.equal(routeHash({ kind: 'sql' }), '#sql');
  const model = scope(twoDatabases());
  assert.equal(databaseOf(model, { kind: 'sql', table: 'Billing:dbo.Payments' }), 'Billing', 'the editor seeded from a table is in its database');
  assert.equal(databaseOf(model, { kind: 'sql' }), undefined);
});
