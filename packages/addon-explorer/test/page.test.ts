import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relationsOf, type Model } from 'dbtour/model';
import { pageHtml, render } from '../src/index.ts';
import { parseRoute, routeHash, tableHash, diagramHash, groupHash, mapHash, type Route } from '../src/page/route.ts';
import { allTables, mergeParallel, relationId } from '../src/page/graph.ts';
import { tools, toolById, storedTool, rememberTool } from '../src/page/tools.ts';
import { buildIndex, search } from '../src/page/search.ts';
import { neighbours, withNeighbours, expand, subgraph } from '../src/page/graph.ts';
import { layout, nodeHeight, nodeWidth } from '../src/page/layout.ts';
import { prompt } from '../src/page/prompt.ts';
import { catalogue, neighboursOf, ordered, orders, rememberOrder, sized, storedOrder } from '../src/page/catalogue.ts';
import { profile, plotPath, tickTips, tickWidth, tickCentre } from '../src/page/plot.ts';
import { barShares, ordinal, rankByRows, sizeCaption, sizeTerms } from '../src/page/size.ts';
import { aboutOf, anyProtected, protection } from '../src/page/about.ts';
import { sqlTokens } from '../src/page/sql.ts';
import { describe } from '../../core/test/fixtures/described.ts';
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

test('the index orders by rows or by size, largest first, keeping each number, with views after', () => {
  const cat = catalogue(shop());
  assert.equal(sized(cat), true);
  assert.deepEqual(cat.byRef.get('dbo.Customers')?.stats, { rows: 48213, dataBytes: 7397376, indexBytes: 1654784 });
  assert.deepEqual(orders.map((o) => o.id), ['catalogue', 'rows', 'size']);
  assert.deepEqual(ordered(cat, 'catalogue').map((e) => e.number), ['001', '002', '003', '004', '005', '006']);
  assert.deepEqual(ordered(cat, 'rows').map((e) => `${e.number} ${e.table}`), [
    '003 OrderLines',
    '002 Orders',
    '006 Invoices',
    '001 Customers',
    '004 Products',
    '005 vOrderTotals',
  ]);
  // By bytes, Invoices (40 MB, no index) passes Orders (29 MB of data and 9 MB of indexes).
  assert.deepEqual(ordered(cat, 'size').map((e) => e.table), ['OrderLines', 'Invoices', 'Orders', 'Customers', 'Products', 'vOrderTotals']);
  assert.deepEqual(cat.entries.map((e) => e.number), ['001', '002', '003', '004', '005', '006'], 'ordering copies, never reorders the catalogue');

  const bare = shop();
  for (const schema of bare.databases[0].schemas) for (const table of schema.tables) delete table.stats;
  assert.equal(sized(catalogue(bare)), false, 'without stats there is nothing to order by');
});

test('the order is remembered and an unknown one falls back to the catalogue', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(storedOrder(storage), 'catalogue');
  rememberOrder('size', storage);
  assert.equal(storedOrder(storage), 'size');
  store.set('dbtour.indexOrder', 'colour');
  assert.equal(storedOrder(storage), 'catalogue');
  assert.equal(storedOrder(undefined), 'catalogue', 'no storage at all is fine');
  const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(storedOrder(refusing), 'catalogue');
  assert.doesNotThrow(() => rememberOrder('rows', refusing));
});

test('a size bar is the table\'s bytes against the largest, split into data and indexes', () => {
  const largest = 107085824;
  assert.deepEqual(barShares({ rows: 1, dataBytes: 81920000, indexBytes: 25165824 }, largest), { data: 81920000 / largest, indexes: 25165824 / largest });
  const half = barShares({ rows: 1, dataBytes: largest / 4, indexBytes: largest / 4 }, largest);
  assert.equal(half.data + half.indexes, 0.5, 'linear: half the bytes is half the length');
  assert.deepEqual(barShares({ rows: 0, dataBytes: 0, indexBytes: 0 }, largest), { data: 0, indexes: 0 });
  assert.deepEqual(barShares({ rows: 0, dataBytes: 0, indexBytes: 0 }, 0), { data: 0, indexes: 0 }, 'nothing to measure against');
  assert.deepEqual(barShares({ rows: 3, dataBytes: 8192, indexBytes: 0 }, 8192), { data: 1, indexes: 0 }, 'its own split, against itself');
});

test('a table\'s place by rows reads as words, and only tables with stats are counted', () => {
  const cat = catalogue(shop());
  assert.equal(rankByRows(cat, 'dbo.OrderLines'), 'the largest of 5 tables by rows');
  assert.equal(rankByRows(cat, 'dbo.Orders'), 'the 2nd largest of 5 tables by rows');
  assert.equal(rankByRows(cat, 'dbo.Customers'), 'the 4th largest of 5 tables by rows');
  assert.equal(rankByRows(cat, 'dbo.Products'), 'the smallest of 5 tables by rows');
  assert.equal(rankByRows(cat, 'dbo.vOrderTotals'), undefined, 'a view has no place');
  const one = shop();
  for (const schema of one.databases[0].schemas) for (const table of schema.tables) if (table.name !== 'Orders') delete table.stats;
  assert.equal(rankByRows(catalogue(one), 'dbo.Orders'), undefined, 'one table alone has no place among others');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});

test('the size terms say what each figure is, naming the database', () => {
  const terms = sizeTerms('SQL Server');
  assert.equal(terms.rows, "SQL Server's own count of the rows, an estimate: no row is read to make it.");
  assert.match(terms.data, /^The pages the rows sit on/);
  assert.match(terms.indexes, /^The pages every other index takes/);
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

test('only a view says it has no rows of its own; a table without stats says nothing it does not know', () => {
  assert.equal(sizeCaption({ rows: 1204377, dataBytes: 81920000, indexBytes: 25165824 }, 'table'), '1,204,377 rows · 102 MB');
  assert.equal(sizeCaption(undefined, 'view'), 'no rows of its own');
  assert.equal(sizeCaption(undefined, 'table'), '', 'stats missing is not an empty table');
});

test('the About block says each feature in a plain sentence, the dates apart, the properties as they are', () => {
  const model = describe(shop());
  const orders = model.databases[0].schemas[0].tables[1];
  const about = aboutOf(orders);
  assert.deepEqual(about.terms.map((t) => t.term), ['System-versioned', 'Memory-optimised', 'Ledger', 'Partitioned', 'Compressed', 'Change tracking', 'Change data capture', 'Triggers', 'Row-level security']);
  const said = Object.fromEntries(about.terms.map((t) => [t.term, t.sentence]));
  assert.equal(said['System-versioned'], 'Every change is kept in dbo.OrdersHistory; each row is valid from ValidFrom to ValidTo.');
  assert.equal(said['Memory-optimised'], 'Held in memory, and both the schema and the rows survive a restart.');
  assert.equal(said.Ledger, 'Every change is recorded so it can be verified against tampering.');
  assert.equal(said.Partitioned, 'Split on CreatedAt into 12 partitions, by psByYear (function pfByYear).');
  assert.equal(said.Compressed, 'Page compression.');
  assert.equal(said['Change tracking'], 'The database records which rows changed, for keeping copies in step.');
  assert.equal(said['Change data capture'], 'The database copies each change into a change table.');
  assert.equal(said.Triggers, 'trOrdersAudit runs after insert and update: see Triggers below.');
  assert.equal(said['Row-level security'], 'rls.Tenants filters the rows a login sees: see Row-level security below.');
  assert.equal(about.terms[0].ref, 'dbo.OrdersHistory');
  assert.equal(about.dates, 'Created 2024-01-02 · altered 2026-10-30');
  assert.deepEqual(about.properties, [['Retention', '7 years']]);
  assert.equal(aboutOf(shop().databases[0].schemas[0].tables[0]).empty, true, 'nothing to say, no block');
});

test('the About sentences cover the other cases: schema only, append-only, history, several triggers, a block predicate', () => {
  const table = shop().databases[0].schemas[0].tables[0];
  const said = (patch: object) => Object.fromEntries(aboutOf({ ...table, ...patch }).terms.map((t) => [t.term, t.sentence]));
  assert.equal(said({ memoryOptimised: 'schema only' })['Memory-optimised'], 'Held in memory; the schema survives a restart, the rows do not.');
  assert.equal(said({ ledger: 'append-only' }).Ledger, 'Only takes inserts: no row can be updated or deleted, and each is verifiable.');
  assert.equal(said({ ledger: 'history' }).Ledger, 'The history of a ledger table.');
  assert.equal(said({ historyOf: 'dbo.Orders' }).History, 'Keeps the past versions of the rows of dbo.Orders.');
  const trigger = { timing: 'instead of', events: ['delete'], enabled: false };
  assert.equal(said({ triggers: [{ name: 'a', ...trigger }, { name: 'b', ...trigger }] }).Triggers, '2 triggers: see Triggers below.');
  assert.equal(said({ triggers: [{ name: 'a', ...trigger }] }).Triggers, 'a runs instead of delete, and is disabled: see Triggers below.');
  const block = { policy: 'rls.P', kind: 'block', operation: 'after insert', predicate: 'x', enabled: true };
  assert.equal(said({ security: [block] })['Row-level security'], 'rls.P blocks writes that break its predicate: see Row-level security below.');
  assert.equal(aboutOf({ ...table, created: '2024-01-02T00:00:00', altered: '2024-01-02T10:00:00' }).dates, 'Created 2024-01-02', 'altered the day it was made says nothing more');
});

test('a column\'s protection reads as tags in words: label, masking, encryption', () => {
  const orders = describe(shop()).databases[0].schemas[0].tables[1];
  assert.deepEqual(protection(orders.columns[3]), [
    { text: 'Confidential · Financial · rank medium', rank: 'medium' },
    { text: 'Encrypted, deterministic' },
  ]);
  assert.deepEqual(protection(orders.columns[2]), [{ text: 'Masked default()' }]);
  const ranked = (rank: string) => protection({ name: 'x', type: 'int', nullable: false, sensitivity: { label: 'L', rank } })[0].rank;
  assert.deepEqual(['low', 'medium', 'high', 'critical', 'none', 'odd'].map(ranked), ['low', 'medium', 'high', 'critical', undefined, undefined], 'a rank the page does not know has no colour, only its words');
  assert.deepEqual(protection(orders.columns[1]), []);
  assert.equal(anyProtected(orders), true);
  assert.equal(anyProtected(shop().databases[0].schemas[0].tables[1]), false, 'no column has any, so no Protection column');
});

test('SQL splits into classed tokens with CodeMirror\'s MSSQL parser, every character kept', () => {
  const code = "CREATE TRIGGER dbo.trAudit ON dbo.Orders AFTER INSERT AS\nSELECT N'x', 42 FROM inserted -- a note";
  const tokens = sqlTokens(code);
  assert.equal(tokens.map((t) => t.text).join(''), code, 'nothing lost, nothing added');
  const kind = (text: string) => tokens.find((t) => t.text === text)?.kind;
  assert.equal(kind('CREATE'), 'keyword');
  assert.equal(kind('SELECT'), 'keyword');
  assert.equal(kind("N'x'"), 'string');
  assert.equal(kind('42'), 'number');
  assert.equal(kind('-- a note'), 'comment');
  assert.equal(kind('Orders'), 'name');
  const calls = sqlTokens('SELECT CAST(Id AS int), SYSUTCDATETIME()');
  assert.equal(calls.find((t) => t.text === 'SYSUTCDATETIME')?.kind, 'builtin', 'a built-in function is not a name');
  assert.equal(calls.find((t) => t.text === 'CAST')?.kind, 'builtin');
  assert.equal(calls.find((t) => t.text === 'int')?.kind, 'type');
  assert.deepEqual(sqlTokens(''), []);
  assert.equal(sqlTokens('([Status]<=(9))').map((t) => t.text).join(''), '([Status]<=(9))');
});

test('a tick\'s tooltip says the column, its type, what its peak means, and what else it is', () => {
  const model = describe(shop());
  const orders = model.databases[0].schemas[0].tables[1];
  const tips = tickTips(orders, relationsOf(model, 'dbo.Orders').out);
  assert.equal(tips.length, orders.columns.length);
  assert.deepEqual(tips[0], { column: 'Id', type: 'int', peak: 'Primary key', facts: ['not null', 'identity(1,1)'], protection: [], properties: [['Source', 'checkout']] });
  assert.deepEqual(tips[1], { column: 'CustomerId', type: 'int', peak: 'Foreign key', target: 'dbo.Customers', targetColumn: 'Id', facts: ['not null', 'not trusted'], protection: [], properties: [] });
  assert.deepEqual(tips[2], { column: 'Status', type: 'tinyint', peak: 'Column', facts: ['not null', 'default ((0))', 'sparse', 'collation Latin1_General_BIN2'], protection: [{ text: 'Masked default()' }], properties: [] });
  assert.equal(tips[3].protection[0].text, 'Confidential · Financial · rank medium');
  assert.equal(tips[4].description, undefined);
  assert.deepEqual(tips[4].facts, ['nullable', 'computed ([Net]+[Tax])']);
  const customers = model.databases[0].schemas[0].tables[0];
  const email = tickTips(customers, [])[1];
  assert.equal(email.peak, 'Unique');
  assert.equal(email.description, 'Login address.');
});

test('the review: a switched-off policy says so, and a label with only a rank still shows', () => {
  const table = shop().databases[0].schemas[0].tables[0];
  const said = (security: object[]) => Object.fromEntries(aboutOf({ ...table, security } as typeof table).terms.map((t) => [t.term, t.sentence]))['Row-level security'];
  const off = { policy: 'rls.P', kind: 'filter', predicate: 'x', enabled: false };
  assert.equal(said([off]), 'rls.P is switched off: it filters and blocks nothing. See Row-level security below.');
  const on = { policy: 'rls.Q', kind: 'block', operation: 'after insert', predicate: 'y', enabled: true };
  assert.equal(said([off, on]), 'rls.Q blocks writes that break its predicate; rls.P is switched off. See Row-level security below.');
  assert.deepEqual(protection({ name: 'x', type: 'int', nullable: false, sensitivity: { rank: 'high' } }), [{ text: 'rank high', rank: 'high' }]);
  assert.equal(anyProtected({ ...table, columns: [{ name: 'x', type: 'int', nullable: false, sensitivity: { rank: 'high' } }] }), true);
});

test('the review: compression that differs by partition says so', () => {
  const table = shop().databases[0].schemas[0].tables[0];
  const said = Object.fromEntries(aboutOf({ ...table, compression: 'none, page' }).terms.map((t) => [t.term, t.sentence]));
  assert.equal(said.Compressed, 'Compression differs by partition: none, page.');
});
