import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderMarkdown, renderTableMarkdown } from '../src/render/markdown.ts';
import type { Model } from '../src/model.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

test('renderMarkdown writes an index and one page per table, under tables/', () => {
  const files = renderMarkdown(shop());
  assert.deepEqual(Object.keys(files).sort(), [
    'README.md',
    'tables/billing.Invoices.md',
    'tables/dbo.Customers.md',
    'tables/dbo.OrderLines.md',
    'tables/dbo.Orders.md',
    'tables/dbo.Products.md',
    'tables/dbo.vOrderTotals.md',
  ]);
});

test('the index lists every table with its description and links to its page', () => {
  const readme = renderMarkdown(shop())['README.md'];
  assert.match(readme, /^# Shop\n/);
  assert.match(readme, /The web shop\./);
  assert.match(readme, /\| \[dbo\.Customers\]\(tables\/dbo\.Customers\.md\) \| table \| 3 \| One row per account\. \|/);
  assert.match(readme, /\| \[dbo\.vOrderTotals\]\(tables\/dbo\.vOrderTotals\.md\) \| view \| 2 \| {2}\|/);
  assert.match(readme, /```mermaid\nerDiagram\n[\s\S]*dbo_Orders \}o--\|\| dbo_Customers/);
});

test('a table page has the columns, keys, relations both ways, indexes and its diagram', () => {
  const page = renderMarkdown(shop())['tables/dbo.Orders.md'];
  assert.match(page, /^# dbo\.Orders\n/);
  assert.match(page, /\| Column \| Type \| Nullable \| Default \| Key \| Description \|/);
  assert.match(page, /\| Id \| int \| no \| {2}\| PK, identity \| {2}\|/);
  assert.match(page, /\| CustomerId \| int \| no \| {2}\| FK → \[dbo\.Customers\]\(dbo\.Customers\.md\)\.Id \| {2}\|/);
  assert.match(page, /\| Status \| tinyint \| no \| `\(\(0\)\)` \| {2}\| {2}\|/);
  assert.match(page, /\| Total \| decimal\(18,2\) \| yes \| {2}\| computed `\(\[Net\]\+\[Tax\]\)` \| {2}\|/);
  assert.match(page, /## Referenced by\n\n- \[billing\.Invoices\]\(billing\.Invoices\.md\)\.OrderId\n- \[dbo\.OrderLines\]\(dbo\.OrderLines\.md\)\.OrderId/);
  assert.match(page, /## Indexes\n\n\| Name \| Columns \| Unique \|\n\|[-| ]+\|\n\| IX_Orders_CustomerId \| CustomerId \| no \|/);
  assert.match(page, /## Constraints\n\n[\s\S]*CK_Orders_Status[\s\S]*`\(\[Status\]<=\(9\)\)`/);
  assert.match(page, /```mermaid\nerDiagram\n[\s\S]*dbo_OrderLines \}o--\|\| dbo_Orders/);
  assert.doesNotMatch(page, /dbo_Products/);
});

test('a view page shows its definition and a table with a description shows it under the title', () => {
  const files = renderMarkdown(shop());
  assert.match(files['tables/dbo.vOrderTotals.md'], /## Definition\n\n```sql\nCREATE VIEW dbo\.vOrderTotals/);
  assert.match(files['tables/dbo.Customers.md'], /^# dbo\.Customers\n\nOne row per account\.\n/);
  assert.match(files['tables/dbo.Customers.md'], /\| Email \| nvarchar\(320\) \| no \| {2}\| unique \| Login address\. \|/);
});

test('groups from the notes become sections of the index with their own diagram', () => {
  const model = shop();
  model.groups.push({ name: 'Billing', description: 'Money in.', tables: ['dbo.Orders', 'billing.Invoices'] });
  const readme = renderMarkdown(model)['README.md'];
  assert.match(readme, /## Billing\n\nMoney in\.\n\n- \[dbo\.Orders\]\(tables\/dbo\.Orders\.md\)\n- \[billing\.Invoices\]\(tables\/billing\.Invoices\.md\)\n\n```mermaid/);
});

test('pipes in descriptions do not break the tables', () => {
  const model = shop();
  model.databases[0].schemas[0].tables[0].columns[1].description = 'a | b';
  assert.match(renderMarkdown(model)['tables/dbo.Customers.md'], /a \\\| b/);
});

test('renderTableMarkdown renders one table page, and says when the table is not there', () => {
  assert.equal(renderTableMarkdown(shop(), 'dbo.Orders'), renderMarkdown(shop())['tables/dbo.Orders.md']);
  assert.throws(() => renderTableMarkdown(shop(), 'dbo.Ghost'), /dbo\.Ghost is not a table/);
});
