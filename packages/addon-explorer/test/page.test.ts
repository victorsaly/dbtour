import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Model } from 'dbtour/model';
import { pageHtml, render } from '../src/index.ts';
import { parseRoute, routeHash, tableHash, diagramHash, groupHash, type Route } from '../src/page/route.ts';
import { buildIndex, search } from '../src/page/search.ts';
import { neighbours, withNeighbours, expand, subgraph } from '../src/page/graph.ts';
import { layout, nodeHeight, nodeWidth } from '../src/page/layout.ts';
import { prompt } from '../src/page/prompt.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));

test('every route round-trips through the hash, and an odd hash falls back to home', () => {
  const routes: Route[] = [
    { kind: 'home' },
    { kind: 'table', ref: 'dbo.Orders' },
    { kind: 'table', ref: 'dbo.Orders', column: 'Status' },
    { kind: 'diagram', refs: ['dbo.Orders', 'billing.Invoices'] },
    { kind: 'group', name: 'Money in/out, now' },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(tableHash('dbo.Orders'), '#dbo.Orders');
  assert.equal(tableHash('dbo.Orders', 'Status'), '#dbo.Orders.Status');
  assert.equal(diagramHash(['dbo.Orders', 'dbo.Customers']), '#diagram/dbo.Orders,dbo.Customers');
  assert.equal(groupHash('Billing'), '#group/Billing');
  assert.deepEqual(parseRoute(''), { kind: 'home' });
  assert.deepEqual(parseRoute('#/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#diagram/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#group/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#%E0%A4%A'), { kind: 'table', ref: '%E0%A4%A' });
});

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
  assert.ok(hits.some((h) => h.title === 'dbo.vOrderTotals'), 'a name containing the word is found');
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

test('neighbours are the tables one relation away, and expanding a diagram adds them once', () => {
  const model = shop();
  assert.deepEqual(neighbours(model, 'dbo.Orders'), ['dbo.Customers', 'dbo.OrderLines', 'billing.Invoices']);
  assert.deepEqual(neighbours(model, 'dbo.Customers'), ['dbo.Orders']);
  assert.deepEqual(withNeighbours(model, ['dbo.Customers']), ['dbo.Customers', 'dbo.Orders']);
  assert.deepEqual(expand(model, ['dbo.Customers', 'dbo.Orders'], 'dbo.Orders'), ['dbo.Customers', 'dbo.Orders', 'dbo.OrderLines', 'billing.Invoices']);
  assert.deepEqual(expand(model, [], 'dbo.Products'), ['dbo.Products', 'dbo.OrderLines']);
});

test('a subgraph keeps only tables the model has and relations with both ends shown', () => {
  const model = shop();
  const sub = subgraph(model, ['dbo.Orders', 'dbo.Customers', 'dbo.Ghost', 'dbo.Orders']);
  assert.deepEqual(sub.tables, ['dbo.Orders', 'dbo.Customers']);
  assert.deepEqual(sub.relations.map((r) => `${r.from.table}→${r.to.table}`), ['dbo.Orders→dbo.Customers']);
});

test('layout places every table without overlap, from the referencing table towards the referenced one', async () => {
  const model = shop();
  const sub = subgraph(model, withNeighbours(model, ['dbo.Orders']));
  const placed = await layout(model, sub);
  assert.deepEqual([...placed.keys()].sort(), [...sub.tables].sort());
  const boxes = sub.tables.map((ref) => {
    const { x, y } = placed.get(ref)!;
    const columns = model.databases[0].schemas.flatMap((s) => s.tables).find((t) => ref.endsWith(`.${t.name}`))!.columns.length;
    return { ref, x, y, w: nodeWidth, h: nodeHeight(columns) };
  });
  for (const a of boxes) for (const b of boxes) {
    if (a === b) continue;
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, `${a.ref} overlaps ${b.ref}`);
  }
  assert.ok(placed.get('dbo.Orders')!.x < placed.get('dbo.Customers')!.x, 'Orders references Customers, so it is to the left');
  assert.ok(placed.get('dbo.OrderLines')!.x < placed.get('dbo.Orders')!.x);
});

test('the prompt frames the tables and includes each one as Markdown', () => {
  const text = prompt(shop(), ['dbo.Orders', 'dbo.Customers']);
  assert.match(text, /^The schema of the Shop database, from dbtour\./);
  assert.match(text, /\n# dbo\.Orders\n[\s\S]*\n---\n\n# dbo\.Customers\n/);
  assert.match(text, /FK → \[dbo\.Customers\]/);
});

test('pageHtml inlines the model and the bundle so neither can end its script element early', () => {
  const model = shop();
  model.databases[0].description = 'Closes </script><!-- early';
  const html = pageHtml(model, 'var a = "</script>"; // </SCRIPT', 'body{}');
  assert.match(html, /<title>Shop · dbtour<\/title>/);
  assert.match(html, /<style>body\{\}<\/style>/);
  assert.equal(html.match(/<\/script>/g)!.length, 2, 'only the two script elements close');
  const json = /<script id="dbtour-model" type="application\/json">(.*?)<\/script>/s.exec(html)![1];
  assert.equal(JSON.parse(json).databases[0].description, 'Closes </script><!-- early');
  assert.match(html, /var a = "<\\\/script>"; \/\/ <\\\/SCRIPT/);
});

test('render reads the built page and returns index.html', () => {
  const files = render(shop());
  assert.deepEqual(Object.keys(files), ['index.html']);
  assert.match(files['index.html'], /id="dbtour-model"/);
  assert.match(files['index.html'], /dbo\.Orders/);
  assert.ok(files['index.html'].length > 100_000, 'the bundle is inlined');
});
