import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Model } from 'dbtour/model';
import { pageHtml, render } from '../src/index.ts';
import { parseRoute, routeHash, tableHash, diagramHash, groupHash, mapHash, type Route } from '../src/page/route.ts';
import { allTables, mergeParallel, relationId } from '../src/page/graph.ts';
import { tools, toolById, storedTool, rememberTool } from '../src/page/tools.ts';
import { buildIndex, search } from '../src/page/search.ts';
import { neighbours, withNeighbours, expand, subgraph } from '../src/page/graph.ts';
import { layout, nodeHeight, nodeWidth } from '../src/page/layout.ts';
import { prompt } from '../src/page/prompt.ts';
import { catalogue, neighboursOf } from '../src/page/catalogue.ts';
import { profile, plotPath, tickWidth, tickCentre } from '../src/page/plot.ts';
import { markSvg, markDataUri, markPulse } from '../src/mark.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));

test('every route round-trips through the hash, and an odd hash falls back to home', () => {
  const routes: Route[] = [
    { kind: 'home' },
    { kind: 'table', ref: 'dbo.Orders' },
    { kind: 'table', ref: 'dbo.Orders', column: 'Status' },
    { kind: 'diagram', refs: ['dbo.Orders', 'billing.Invoices'] },
    { kind: 'group', name: 'Money in/out, now' },
    { kind: 'map' },
  ];
  for (const route of routes) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(mapHash, '#map');
  assert.deepEqual(parseRoute('#map/x'), { kind: 'home' }, 'only the bare word is the map, and map/x is no ref');
  assert.equal(tableHash('dbo.Orders'), '#dbo.Orders');
  assert.equal(tableHash('dbo.Orders', 'Status'), '#dbo.Orders.Status');
  assert.equal(diagramHash(['dbo.Orders', 'dbo.Customers']), '#diagram/dbo.Orders,dbo.Customers');
  assert.equal(groupHash('Billing'), '#group/Billing');
  assert.deepEqual(parseRoute(''), { kind: 'home' });
  assert.deepEqual(parseRoute('#/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#diagram/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#group/'), { kind: 'home' });
  assert.deepEqual(parseRoute('#%E0%A4%A'), { kind: 'home' }, 'undecodable and not schema.table');
  assert.deepEqual(parseRoute('#Orders'), { kind: 'home' }, 'no schema');
  assert.deepEqual(parseRoute('#a.b.c.d'), { kind: 'home' }, 'too many parts');
  assert.deepEqual(parseRoute('#dbo..x'), { kind: 'home' }, 'an empty part');
  assert.deepEqual(parseRoute('#diagram/dbo.Orders,invalid,,x.y.z'), { kind: 'diagram', refs: ['dbo.Orders'] }, 'bad refs are dropped');
  assert.deepEqual(parseRoute('#diagram/invalid'), { kind: 'home' });
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

test('parallel relations between the same tables become one link naming every column', () => {
  const model = shop();
  const users = { table: 'dbo.Customers', columns: ['Id'] };
  const relations = [
    { from: { table: 'dbo.Orders', columns: ['CustomerId'] }, to: users },
    { from: { table: 'dbo.Orders', columns: ['SoldBy'] }, to: users, virtual: true },
    { from: { table: 'billing.Invoices', columns: ['OrderId'] }, to: { table: 'dbo.Orders', columns: ['Id'] } },
  ];
  const links = mergeParallel([...model.databases[0].relations.slice(0, 0), ...relations]);
  assert.deepEqual(links.map((l) => [l.id, l.relations.length]), [['dbo.Orders>dbo.Customers', 2], ['billing.Invoices>dbo.Orders', 1]]);
  assert.deepEqual(links[0].relations.map((r) => r.from.columns[0]), ['CustomerId', 'SoldBy']);
});

test('the whole catalogue is every table in model order, and a relation has one id', () => {
  const model = shop();
  assert.deepEqual(allTables(model), ['dbo.Customers', 'dbo.Orders', 'dbo.OrderLines', 'dbo.Products', 'dbo.vOrderTotals', 'billing.Invoices']);
  assert.equal(relationId(model.databases[0].relations[0]), 'dbo.Orders.CustomerId>dbo.Customers.Id');
  const ids = model.databases[0].relations.map(relationId);
  assert.equal(new Set(ids).size, ids.length, 'ids are distinct');
});

test('a node drawn with fewer rows is shorter, and names alone are just the header', async () => {
  const model = shop();
  assert.equal(nodeHeight(0), 34);
  assert.equal(nodeHeight(2), 34 + 12 + 44);
  const sub = subgraph(model, ['dbo.Orders', 'dbo.Customers']);
  const tall = await layout(model, sub);
  const flat = await layout(model, sub, () => 0);
  const spanOf = (placed: Map<string, { x: number; y: number }>) => Math.max(...[...placed.values()].map((p) => p.y)) - Math.min(...[...placed.values()].map((p) => p.y));
  assert.ok(spanOf(flat) <= spanOf(tall), 'header-only nodes never spread further than full ones');
});

test('the copy tool is remembered, defaults to any agent, and an unknown id falls back', () => {
  assert.equal(tools[0].id, 'agent');
  assert.equal(toolById('claude').url, 'https://claude.ai/new');
  assert.equal(toolById('nope').id, 'agent');
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(storedTool(storage).id, 'agent');
  rememberTool('chatgpt', storage);
  assert.equal(storedTool(storage).name, 'ChatGPT');
  rememberTool('nope', storage);
  assert.equal(storedTool(storage).id, 'agent');
  assert.equal(storedTool(undefined).id, 'agent', 'no storage at all is fine');
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

test('the catalogue numbers every table in model order and gives each schema a colour', () => {
  const cat = catalogue(shop());
  assert.deepEqual(cat.entries.map((e) => `${e.number} ${e.ref}`), [
    '001 dbo.Customers',
    '002 dbo.Orders',
    '003 dbo.OrderLines',
    '004 dbo.Products',
    '005 dbo.vOrderTotals',
    '006 billing.Invoices',
  ]);
  assert.equal(cat.byRef.get('billing.Invoices')?.number, '006');
  assert.deepEqual([...cat.colours], [['dbo', '#e2001a'], ['billing', '#ffd500']]);
  assert.deepEqual(neighboursOf(cat, 'dbo.Customers').previous, undefined);
  assert.equal(neighboursOf(cat, 'dbo.Customers').next?.ref, 'dbo.Orders');
  assert.equal(neighboursOf(cat, 'billing.Invoices').next, undefined);
  assert.deepEqual(neighboursOf(cat, 'dbo.Ghost'), {});
});

test('a profile rises for keys and the plot path has one pulse per column', () => {
  const model = shop();
  const orders = model.databases[0].schemas[0].tables[1];
  const ticks = profile(orders, ['CustomerId']);
  assert.deepEqual(ticks.map((t) => [t.column, t.height]), [
    ['Id', 1],
    ['CustomerId', 0.6],
    ['Status', 0.18],
    ['CreatedAt', 0.18],
    ['Total', 0.18],
  ]);
  const customers = model.databases[0].schemas[0].tables[0];
  assert.equal(profile(customers, [])[1].height, 0.45, 'a unique column rises a little');
  const path = plotPath(ticks, 200, 40);
  assert.equal(path.split('L').length - 1, ticks.length * 3 + 1, 'three points per pulse and the run-out');
  assert.match(path, /^M0,39 L14\.0,39 L20\.0,1\.0 L26\.0,39/);
  assert.match(path, /L200\.0,39$/, 'runs out to the full width on the baseline');
  assert.equal(tickWidth(3, 1000), 72, 'capped');
  assert.equal(tickWidth(300, 600), 6, 'floored');
  assert.equal(tickCentre(1, 5, 200), 60);
});

test('the mark is one geometry at every size and a favicon-safe data URI', () => {
  const small = markSvg(16, '#000');
  const big = markSvg(256, '#fff', 1);
  assert.match(small, /width="16" height="16" viewBox="0 0 24 24"/);
  assert.match(big, /stroke="#fff" stroke-width="1"/);
  assert.ok(small.includes(markPulse) && big.includes(markPulse));
  assert.match(small, /<ellipse /, 'the top of the cylinder');
  assert.match(markDataUri(), /^data:image\/svg\+xml,%3Csvg/);
  assert.doesNotMatch(markDataUri(), /[<>"]/);
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
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
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
