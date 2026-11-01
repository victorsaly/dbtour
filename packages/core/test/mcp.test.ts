import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scope, type Model } from '../src/model.ts';
import { twoDatabases } from './fixtures/two.ts';
import { renderTableMarkdown } from '../src/render/markdown.ts';
import { answer, answerLine, callTool, overviewLimit, protocolVersions, toolList, type Context } from '../src/mcp.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

function context(model: Model = shop()): Context {
  return { model: () => model, version: '9.9.9' };
}

/** The text of a tool's answer, and whether it is an error. */
function call(model: Model, name: string, args: Record<string, unknown> = {}): { text: string; isError: boolean } {
  const result = callTool(model, name, args);
  return { text: result.content[0].text, isError: result.isError === true };
}

test('initialize agrees to a version it speaks, offers its newest otherwise, and says what it is', () => {
  const known = answer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, context()) as { id: number; result: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(known.id, 1);
  assert.equal(known.result.protocolVersion, '2025-06-18');
  assert.deepEqual(known.result.serverInfo, { name: 'dbtour', version: '9.9.9' });
  assert.ok(known.result.capabilities.tools);
  for (const tool of ['overview', 'search', 'table', 'path']) assert.match(known.result.instructions, new RegExp(tool));
  const future = answer({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, context()) as { result: { protocolVersion: string } };
  assert.equal(future.result.protocolVersion, protocolVersions[0]);
});

test('a notification gets no answer, ping an empty one, and an unknown method or a malformed request an error', () => {
  assert.equal(answer({ jsonrpc: '2.0', method: 'notifications/initialized' }, context()), undefined);
  assert.deepEqual(answer({ jsonrpc: '2.0', id: 'p', method: 'ping' }, context()), { jsonrpc: '2.0', id: 'p', result: {} });
  const unknown = answer({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, context()) as { error: { code: number; message: string } };
  assert.equal(unknown.error.code, -32601);
  assert.match(unknown.error.message, /resources\/list/);
  const malformed = answer({ jsonrpc: '2.0', id: 4 }, context()) as { id: number; error: { code: number } };
  assert.deepEqual([malformed.id, malformed.error.code], [4, -32600]);
  assert.equal((answer([1, 2], context()) as { error: { code: number } }).error.code, -32600, 'a batch is not a request');
});

test('a request must say jsonrpc 2.0 and carry a string or number id, or it is invalid and answered with a null id', () => {
  const unversioned = answer({ id: 1, method: 'ping' }, context()) as { id: unknown; error: { code: number; message: string } };
  assert.deepEqual([unversioned.id, unversioned.error.code], [1, -32600]);
  assert.match(unversioned.error.message, /jsonrpc/);
  assert.equal((answer({ jsonrpc: '1.0', method: 'notifications/initialized' }, context()) as { error: { code: number } }).error.code, -32600, 'not even a notification without 2.0');
  for (const id of [{ nested: true }, null, [1], true]) {
    const invalid = answer({ jsonrpc: '2.0', id, method: 'ping' }, context()) as { id: unknown; error: { code: number } };
    assert.deepEqual([invalid.id, invalid.error.code], [null, -32600], JSON.stringify(id));
  }
});

test('a line that is not JSON is a parse error, a blank line nothing, and a request is answered as a line', async () => {
  assert.equal(JSON.parse((await answerLine('{not json', context())) ?? '').error.code, -32700);
  assert.equal(await answerLine('   ', context()), undefined);
  assert.equal(await answerLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', context()), undefined);
  assert.deepEqual(JSON.parse((await answerLine('{"jsonrpc":"2.0","id":7,"method":"ping"}', context())) ?? ''), { jsonrpc: '2.0', id: 7, result: {} });
});

test('the tools are listed read-only, each with the arguments it needs', () => {
  const listed = answer({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, context()) as { result: { tools: typeof toolList } };
  assert.deepEqual(listed.result.tools.map((t) => t.name), ['overview', 'search', 'table', 'path']);
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.ok(tool.description.length > 40, `${tool.name} says when to use it`);
  }
  assert.deepEqual(toolList.find((t) => t.name === 'path')?.inputSchema.required, ['from', 'to']);
});

test('tools/call answers with text, an unknown tool is an error, and a model that will not load is a failed call', () => {
  const ok = answer({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'sku' } } }, context()) as { result: { content: { type: string; text: string }[] } };
  assert.equal(ok.result.content[0].type, 'text');
  assert.match(ok.result.content[0].text, /dbo\.Products\.Sku/);
  const unknown = answer({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'drop' } }, context()) as { error: { code: number; message: string } };
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /overview, search, table, path/);
  const broken: Context = { version: '1', model: () => { throw new Error('No docs/dbtour/schema.json yet. Run dbtour extract to write it.'); } };
  const failed = answer({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'overview' } }, broken) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /dbtour extract/);
});

test('overview names the database and lists its tables largest first, a view after them', () => {
  const { text, isError } = call(shop(), 'overview');
  assert.equal(isError, false);
  assert.match(text, /^# Shop\n\nThe web shop\.\n/);
  assert.match(text, /SQL Server 16\.0\.1000\. 6 tables and views in 2 schemas, 4 relations\./);
  assert.match(text, /counted on 2026-11-01/);
  const order = [...text.matchAll(/^\| (\S+) \|/gm)].map((m) => m[1]).filter((ref) => ref.includes('.'));
  assert.deepEqual(order, ['dbo.OrderLines', 'dbo.Orders', 'billing.Invoices', 'dbo.Customers', 'dbo.Products', 'dbo.vOrderTotals']);
  assert.match(text, /\| dbo\.OrderLines \| table \| 3 \| 1,204,377 \|/);
  assert.match(text, /\| dbo\.Customers \| table \| 3 \| 48,213 \| One row per account\. \|/);
});

test('overview without stats keeps the catalogue order, shows the groups, and lists only so many tables', () => {
  const model = shop();
  for (const schema of model.databases[0].schemas) for (const table of schema.tables) delete table.stats;
  model.groups.push({ name: 'Ordering', description: 'Money in.', tables: ['dbo.Orders', 'dbo.OrderLines'] });
  const { text } = call(model, 'overview');
  assert.doesNotMatch(text, /Rows/);
  assert.match(text, /\| dbo\.Customers \| table \| 3 \| One row per account\. \|/);
  assert.match(text, /## Ordering\n\nMoney in\.\n\ndbo\.Orders, dbo\.OrderLines/);

  const big = shop();
  big.databases[0].schemas[0].tables = Array.from({ length: overviewLimit + 5 }, (_, i) => ({ name: `T${i}`, kind: 'table' as const, columns: [], indexes: [], constraints: [], stats: { rows: i, dataBytes: 0, indexBytes: 0 } }));
  big.databases[0].schemas[1].tables = [];
  big.databases[0].relations = [];
  const listed = call(big, 'overview').text;
  assert.equal([...listed.matchAll(/^\| dbo\.T/gm)].length, overviewLimit);
  assert.match(listed, /\| dbo\.T104 \|/, 'the largest is listed');
  assert.doesNotMatch(listed, /\| dbo\.T0 \|/, 'the smallest is left to search');
  assert.match(listed, /5 more: search finds them/);
});

test('search lists what matches, says when nothing does, and wants a query', () => {
  const found = call(shop(), 'search', { query: 'order', limit: 2 }).text;
  assert.equal(found, '- table dbo.Orders: 5 columns\n- table dbo.OrderLines: 3 columns');
  assert.match(call(shop(), 'search', { query: 'login' }).text, /^- column dbo\.Customers\.Email: /);
  const none = call(shop(), 'search', { query: 'unicorn' });
  assert.equal(none.isError, false);
  assert.match(none.text, /Nothing matches "unicorn"/);
  const missing = call(shop(), 'search', {});
  assert.equal(missing.isError, true);
  assert.match(missing.text, /query/);
});

test('table gives the same Markdown as the docs, and finds a table by its bare name or a column ref', () => {
  const model = shop();
  assert.equal(call(model, 'table', { ref: 'dbo.Orders' }).text, renderTableMarkdown(model, 'dbo.Orders'));
  assert.equal(call(model, 'table', { ref: 'invoices' }).text, renderTableMarkdown(model, 'billing.Invoices'));
  assert.equal(call(model, 'table', { ref: 'DBO.ORDERS' }).text, renderTableMarkdown(model, 'dbo.Orders'));
  assert.equal(call(model, 'table', { ref: 'dbo.Orders.Status' }).text, renderTableMarkdown(model, 'dbo.Orders'));
});

test('table says which tables share a bare name, and suggests some for one it cannot find', () => {
  const model = shop();
  model.databases[0].schemas[1].tables.push({ name: 'Orders', kind: 'table', columns: [], indexes: [], constraints: [] });
  const both = call(model, 'table', { ref: 'Orders' });
  assert.equal(both.isError, true);
  assert.match(both.text, /dbo\.Orders and billing\.Orders/);
  const unknown = call(model, 'table', { ref: 'dbo.Order' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.text, /"dbo\.Order" is not a table.*dbo\.Orders/s);
  const nothingLike = call(model, 'table', { ref: 'zz' });
  assert.match(nothingLike.text, /overview lists them/);
  assert.equal(call(model, 'table', {}).isError, true);
});

test('path writes the joins between two tables, through the tables between them', () => {
  const { text, isError } = call(shop(), 'path', { from: 'dbo.OrderLines', to: 'customers' });
  assert.equal(isError, false);
  assert.match(text, /^dbo\.OrderLines to dbo\.Customers: 2 joins\./);
  assert.ok(text.includes('FROM [dbo].[OrderLines]\nJOIN [dbo].[Orders] ON [dbo].[Orders].[Id] = [dbo].[OrderLines].[OrderId]\nJOIN [dbo].[Customers] ON [dbo].[Customers].[Id] = [dbo].[Orders].[CustomerId]\n'), text);
  const across = call(shop(), 'path', { from: 'billing.Invoices', to: 'dbo.Products' }).text;
  assert.match(across, /3 joins/);
  assert.ok(across.includes('JOIN [dbo].[Orders] ON [dbo].[Orders].[Id] = [billing].[Invoices].[OrderId]\nJOIN [dbo].[OrderLines] ON [dbo].[OrderLines].[OrderId] = [dbo].[Orders].[Id]\nJOIN [dbo].[Products] ON [dbo].[Products].[Id] = [dbo].[OrderLines].[ProductId]'), across);
});

test('path says when tables are the same or unconnected, marks a join from the notes, and joins every column of a key', () => {
  const model = shop();
  assert.match(call(model, 'path', { from: 'dbo.Orders', to: 'Orders' }).text, /the same table/);
  model.databases[0].schemas[0].tables.push({ name: 'Audit', kind: 'table', columns: [], indexes: [], constraints: [] });
  const alone = call(model, 'path', { from: 'dbo.Audit', to: 'dbo.Orders' });
  assert.equal(alone.isError, false);
  assert.match(alone.text, /No relation connects dbo\.Audit and dbo\.Orders.*dbtour\.notes\.yaml/s);
  model.databases[0].relations.push({ from: { table: 'dbo.Audit', columns: ['OrderId', 'Line'] }, to: { table: 'dbo.OrderLines', columns: ['OrderId', 'Line'] }, virtual: true });
  model.databases[0].relations.push({ from: { table: 'dbo.Audit', columns: ['ParentId'] }, to: { table: 'dbo.Audit', columns: ['Id'] } });
  const noted = call(model, 'path', { from: 'dbo.Audit', to: 'dbo.OrderLines' }).text;
  assert.ok(noted.includes('JOIN [dbo].[OrderLines] ON [dbo].[OrderLines].[OrderId] = [dbo].[Audit].[OrderId] AND [dbo].[OrderLines].[Line] = [dbo].[Audit].[Line] -- from the notes, not a declared key'), noted);
  assert.equal(call(model, 'path', { from: 'dbo.Nope', to: 'dbo.Orders' }).isError, true);
  assert.equal(call(model, 'path', { from: 'dbo.Orders' }).isError, true);
});

test('path quotes every name as its database does, so a space, a bracket or a reserved word still joins', () => {
  const model = shop();
  const [dbo] = model.databases[0].schemas;
  dbo.tables.push({ name: 'Order Notes', kind: 'table', columns: [], indexes: [], constraints: [] });
  dbo.tables.push({ name: 'User', kind: 'table', columns: [], indexes: [], constraints: [] });
  model.databases[0].relations.push({ from: { table: 'dbo.Order Notes', columns: ['Order Id'] }, to: { table: 'dbo.Orders', columns: ['Id'] } });
  model.databases[0].relations.push({ from: { table: 'dbo.User', columns: ['a]b'] }, to: { table: 'dbo.Order Notes', columns: ['Id'] } });
  const text = call(model, 'path', { from: 'dbo.User', to: 'dbo.Orders' }).text;
  assert.ok(text.includes('FROM [dbo].[User]\nJOIN [dbo].[Order Notes] ON [dbo].[Order Notes].[Id] = [dbo].[User].[a]]b]\nJOIN [dbo].[Orders] ON [dbo].[Orders].[Id] = [dbo].[Order Notes].[Order Id]'), text);

  const quoted = (driver: string) => {
    const other = shop();
    other.databases[0].driver = driver;
    other.databases[0].schemas[0].tables[1].name = 'Or"de`rs';
    for (const r of other.databases[0].relations) for (const end of [r.from, r.to]) if (end.table === 'dbo.Orders') end.table = 'dbo.Or"de`rs';
    return call(other, 'path', { from: 'dbo.Customers', to: 'dbo.Or"de`rs' }).text;
  };
  assert.ok(quoted('postgres').includes('JOIN "dbo"."Or""de`rs" ON "dbo"."Or""de`rs"."CustomerId" = "dbo"."Customers"."Id"'), quoted('postgres'));
  assert.ok(quoted('mysql').includes('JOIN `dbo`.`Or"de``rs` ON'), quoted('mysql'));
  assert.ok(quoted('sqlite').includes('JOIN "dbo"."Or""de`rs" ON'), 'SQLite and any other database take the standard double quotes');
});

test('path keeps each database to itself: a table of the same name in two does not join them', () => {
  const model = scope(twoDatabases());
  const apart = call(model, 'path', { from: 'dbo.Invoices', to: 'dbo.Payments' });
  assert.equal(apart.isError, false);
  assert.match(apart.text, /Sales:dbo\.Invoices is in Sales and Billing:dbo\.Payments in Billing: relations do not cross databases/);
  const billing = call(model, 'path', { from: 'dbo.Payments', to: 'Billing:dbo.Customers' }).text;
  assert.match(billing, /^In Billing, Billing:dbo\.Payments to Billing:dbo\.Customers: 1 join\./);
  const shared = call(model, 'path', { from: 'dbo.Customers', to: 'dbo.Invoices' });
  assert.equal(shared.isError, true, 'a name two databases share wants its database');
  assert.match(shared.text, /Sales:dbo\.Customers and Billing:dbo\.Customers are both called dbo\.Customers/);
});

test('query is offered only when a source has a reader, refuses before it runs, and answers with the rows', async () => {
  const listed = (ctx: Context) => (answer({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx) as { result: { tools: { name: string; annotations: Record<string, boolean> }[] } }).result.tools;
  assert.deepEqual(listed(context()).map((t) => t.name), ['overview', 'search', 'table', 'path']);
  const asked: [string, string | undefined, number | undefined][] = [];
  const withRun: Context = {
    ...context(),
    run: async (sql, source, limit) => {
      asked.push([sql, source, limit]);
      return { content: [{ type: 'text', text: '| n |\n|---|\n| 1 |\n\n1 row.' }] };
    },
  };
  const tools = listed(withRun);
  assert.deepEqual(tools.map((t) => t.name), ['overview', 'search', 'table', 'path', 'query']);
  const query = tools.find((t) => t.name === 'query')!;
  assert.equal(query.annotations.readOnlyHint, true);
  assert.match(JSON.stringify(query), /model provider/, 'it says the rows leave the machine');

  const call = (args: Record<string, unknown>, ctx: Context = withRun) => answer({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query', arguments: args } }, ctx);
  const ok = (await call({ sql: 'SELECT 1 AS n', source: 'Shop', limit: 5 })) as { result: { content: { text: string }[] } };
  assert.match(ok.result.content[0].text, /1 row\./);
  assert.deepEqual(asked, [['SELECT 1 AS n', 'Shop', 5]]);
  const refused = (await call({ sql: 'DROP TABLE dbo.Orders' })) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /starts with DROP/);
  const empty = (await call({})) as { result: { isError: boolean; content: { text: string }[] } };
  assert.match(empty.result.content[0].text, /query needs sql/);
  assert.equal(asked.length, 1, 'neither a refused nor an empty query reaches the source');
  const unoffered = (await call({ sql: 'SELECT 1' }, context())) as { error: { message: string } };
  assert.match(unoffered.error.message, /no tool "query"/);
});

test('the review: a query whose run throws is a failed call, and the server answers the next request', async () => {
  const throwing: Context = { ...context(), run: async () => { throw new Error('connection reset'); } };
  const reply = (await answer({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'query', arguments: { sql: 'SELECT 1' } } }, throwing)) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /connection reset/);
  const noWords = (await answer({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'query', arguments: { sql: ';' } } }, throwing)) as { result: { isError: boolean } };
  assert.equal(noWords.result.isError, true);
});
