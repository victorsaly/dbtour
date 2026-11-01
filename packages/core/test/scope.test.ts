import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { twoDatabases } from './fixtures/two.ts';
import { findTable, findTables, relationsOf, scope, validate, type Model } from '../src/model.ts';
import { applyNotes, parseNotes } from '../src/notes.ts';
import { renderMarkdown, renderTableMarkdown, tableFile } from '../src/render/markdown.ts';
import { callTool } from '../src/mcp.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));
const call = (model: Model, name: string, args: Record<string, unknown>) => {
  const result = callTool(model, name, args);
  return { text: result.content[0].text, isError: result.isError === true };
};

test('one database keeps schema.table: scope leaves its model as it is', () => {
  const model = shop();
  assert.equal(scope(model), model);
});

test('several databases name each table Database:schema.table, in its relations, groups and links too', () => {
  const raw = twoDatabases();
  raw.groups.push({ name: 'Money', tables: ['dbo.Invoices', 'Billing:dbo.Payments', 'dbo.Customers'] });
  raw.links.push({ api: 'Shop', method: 'GET', path: '/payments', tables: ['dbo.Payments'] });
  raw.databases[0].schemas[0].tables[1].temporal = { history: 'dbo.InvoicesHistory', start: 'From', end: 'To' };
  raw.databases[0].schemas[0].tables.push({ name: 'InvoicesHistory', kind: 'table', columns: [], indexes: [], constraints: [], historyOf: 'dbo.Invoices' });
  const model = scope(raw);
  assert.notEqual(model, raw, 'the input is not changed');
  assert.equal(raw.databases[0].schemas[0].name, 'dbo');
  assert.deepEqual(model.databases.map((d) => d.schemas.map((s) => s.name)), [['Sales:dbo'], ['Billing:dbo']]);
  assert.deepEqual(model.databases[0].relations[0].from, { table: 'Sales:dbo.Invoices', columns: ['CustomerId'] });
  assert.deepEqual(model.databases[1].relations[0].to, { table: 'Billing:dbo.Customers', columns: ['Id'] });
  assert.deepEqual(model.groups[0].tables, ['Sales:dbo.Invoices', 'Billing:dbo.Payments', 'dbo.Customers'], 'a name in both databases is left for the notes to report');
  assert.deepEqual(model.links[0].tables, ['Billing:dbo.Payments']);
  assert.equal(model.databases[0].schemas[0].tables[1].temporal?.history, 'Sales:dbo.InvoicesHistory', 'a history table is named in its own database');
  assert.equal(model.databases[0].schemas[0].tables[2].historyOf, 'Sales:dbo.Invoices');
  assert.deepEqual(scope(model), model, 'scoping twice is scoping once');
  assert.equal(validate(model).ok, true, 'a scoped model is still a model');
});

test('validate wants every database named apart, without a dot or a colon, once there are several', () => {
  const same = twoDatabases();
  same.databases[1].name = 'Sales';
  const twice = validate(same);
  assert.equal(twice.ok, false);
  assert.match(!twice.ok ? twice.errors.join('\n') : '', /two databases are named Sales: give each source its own name in dbtour\.yaml/);
  const dotted = twoDatabases();
  dotted.databases[0].name = 'Sales.Prod';
  dotted.databases[1].name = 'Billing:EU';
  dotted.databases.push({ ...dotted.databases[1], name: 'EU/West' });
  const odd = validate(dotted);
  for (const name of ['Sales.Prod', 'Billing:EU', 'EU/West']) assert.match(!odd.ok ? odd.errors.join('\n') : '', new RegExp(`name ${name.replace('.', '\\.')} has a dot, a colon or a slash`));
  const alone = shop();
  alone.databases[0].name = 'Shop.Prod';
  assert.equal(validate(alone).ok, true, 'one database may be named anything, since refs do not carry it');
});

test('findTable takes a ref with or without its database, and finds nothing when the name is in both', () => {
  const model = scope(twoDatabases());
  assert.equal(findTable(model, 'Billing:dbo.Customers')?.database.name, 'Billing');
  assert.equal(findTable(model, 'dbo.Invoices')?.ref, 'Sales:dbo.Invoices', 'a name in one database is that table');
  assert.equal(findTable(model, 'Sales:dbo.Invoices.CustomerId')?.ref, 'Sales:dbo.Invoices');
  assert.equal(findTable(model, 'dbo.Customers'), undefined);
  assert.deepEqual(findTables(model, 'dbo.Customers').map((f) => f.ref), ['Sales:dbo.Customers', 'Billing:dbo.Customers']);
  assert.equal(findTable(model, 'Sales:dbo.Payments'), undefined, 'the database is part of the name');
  assert.equal(findTable(shop(), 'dbo.Orders')?.ref, 'dbo.Orders');
  assert.deepEqual(relationsOf(model, 'Billing:dbo.Customers').in.map((r) => r.from.table), ['Billing:dbo.Payments']);
});

test('the notes reach a table by either name, and say when a name is in both databases or a relation would cross them', () => {
  const notes = parseNotes(`
tables:
  dbo.Invoices:
    description: Sent.
  Billing:dbo.Customers:
    description: Who pays.
  dbo.Customers:
    description: Which?
relations:
  - from: dbo.Payments.InvoiceId
    to: dbo.Invoices.Id
  - from: dbo.Invoices.Id
    to: Sales:dbo.Customers.Id
groups:
  - name: Paying
    tables: [dbo.Payments, Billing:dbo.Customers]
`);
  const { model, warnings } = applyNotes(scope(twoDatabases()), notes);
  assert.equal(findTable(model, 'Sales:dbo.Invoices')?.table.description, 'Sent.');
  assert.equal(findTable(model, 'Billing:dbo.Customers')?.table.description, 'Who pays.');
  assert.equal(findTable(model, 'Sales:dbo.Customers')?.table.description, undefined);
  assert.ok(warnings.some((w) => /dbo\.Customers is in Sales and Billing: write Sales:dbo\.Customers or Billing:dbo\.Customers/.test(w)), warnings.join('\n'));
  assert.ok(warnings.some((w) => /dbo\.Payments\.InvoiceId → dbo\.Invoices\.Id joins Billing to Sales: relations stay inside one database/.test(w)), warnings.join('\n'));
  assert.deepEqual(model.databases[0].relations.at(-1), { from: { table: 'Sales:dbo.Invoices', columns: ['Id'] }, to: { table: 'Sales:dbo.Customers', columns: ['Id'] }, virtual: true });
  assert.deepEqual(model.groups[0].tables, ['Billing:dbo.Payments', 'Billing:dbo.Customers']);
});

test('the Markdown gives each database a folder, and a table page links its neighbours beside it', () => {
  const model = scope(twoDatabases());
  const files = renderMarkdown(model);
  assert.deepEqual(Object.keys(files).sort(), ['README.md', 'tables/Billing/dbo.Customers.md', 'tables/Billing/dbo.Payments.md', 'tables/Sales/dbo.Customers.md', 'tables/Sales/dbo.Invoices.md']);
  assert.match(files['README.md'], /\| \[Sales:dbo\.Invoices\]\(tables\/Sales\/dbo\.Invoices\.md\) \|/);
  const invoices = files['tables/Sales/dbo.Invoices.md'];
  assert.match(invoices, /^# Sales:dbo\.Invoices\n/);
  assert.match(invoices, /FK → \[Sales:dbo\.Customers\]\(dbo\.Customers\.md\)\.Id/);
  assert.match(files['tables/Sales/dbo.Customers.md'], /- \[Sales:dbo\.Invoices\]\(dbo\.Invoices\.md\)\.CustomerId/);
  assert.equal(tableFile('dbo.Orders'), 'dbo.Orders.md');
  assert.equal(tableFile('Sales:dbo.Orders'), 'Sales/dbo.Orders.md');
  assert.equal(renderTableMarkdown(model, 'dbo.Invoices'), invoices, 'a name in one database renders that table');
});

test('the MCP tools name tables with their database, and the SQL they write leaves it out', () => {
  const model = scope(twoDatabases());
  const both = call(model, 'table', { ref: 'dbo.Customers' });
  assert.equal(both.isError, true);
  assert.match(both.text, /Sales:dbo\.Customers and Billing:dbo\.Customers are both called dbo\.Customers/);
  assert.match(call(model, 'table', { ref: 'customers' }).text, /are both called customers/);
  assert.match(call(model, 'table', { ref: 'billing:DBO.customers' }).text, /^# Billing:dbo\.Customers\n/);
  assert.match(call(model, 'table', { ref: 'payments' }).text, /^# Billing:dbo\.Payments\n/);
  const path = call(model, 'path', { from: 'payments', to: 'Billing:dbo.Customers' }).text;
  assert.match(path, /^In Billing, Billing:dbo\.Payments to Billing:dbo\.Customers: 1 join\./);
  assert.ok(path.includes('FROM [dbo].[Payments]\nJOIN [dbo].[Customers] ON [dbo].[Customers].[Id] = [dbo].[Payments].[CustomerId]'), path);
  assert.match(call(model, 'path', { from: 'invoices', to: 'payments' }).text, /Sales:dbo\.Invoices is in Sales and Billing:dbo\.Payments in Billing/);
  assert.match(call(model, 'overview', {}).text, /\| Sales:dbo\.Invoices \|/);
  assert.match(call(model, 'search', { query: 'payments' }).text, /- table Billing:dbo\.Payments/);
});
