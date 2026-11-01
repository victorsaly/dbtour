import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatBytes, formatCount, renderMarkdown, renderTableMarkdown } from '../src/render/markdown.ts';
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
  assert.match(readme, /\| Table \| Kind \| Columns \| Rows \| Size \| Description \|/);
  assert.match(readme, /\| \[dbo\.Customers\]\(tables\/dbo\.Customers\.md\) \| table \| 3 \| 48,213 \| 8\.6 MB \| One row per account\. \|/);
  assert.match(readme, /\| \[dbo\.OrderLines\]\(tables\/dbo\.OrderLines\.md\) \| table \| \d+ \| 1,204,377 \| 102 MB \|/);
  assert.match(readme, /\| \[dbo\.vOrderTotals\]\(tables\/dbo\.vOrderTotals\.md\) \| view \| 2 \| {2}\| {2}\| {2}\|/);
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

test('a database without stats has no Rows or Size columns in the index, and its pages say nothing of size', () => {
  const model = shop();
  for (const schema of model.databases[0].schemas) for (const table of schema.tables) delete table.stats;
  delete model.databases[0].statsReadAt;
  const files = renderMarkdown(model);
  assert.match(files['README.md'], /\| Table \| Kind \| Columns \| Description \|/);
  assert.match(files['README.md'], /\| \[dbo\.Customers\]\(tables\/dbo\.Customers\.md\) \| table \| 3 \| One row per account\. \|/);
  assert.doesNotMatch(files['tables/dbo.Customers.md'], /rows/);
});

test('a table page says its rows and bytes under the title, approximate as the database counts them, and when', () => {
  const files = renderMarkdown(shop());
  assert.match(files['tables/dbo.Customers.md'], /^# dbo\.Customers\n\nOne row per account\.\n\nAbout 48,213 rows · 7\.1 MB of data · 1\.6 MB of indexes, as the database counted them on 2026-11-01\.\n/);
  assert.match(files['tables/billing.Invoices.md'], /^# billing\.Invoices\n\nAbout 298,551 rows · 40 MB of data · 0 B of indexes, as the database counted them on 2026-11-01\.\n/);
  assert.doesNotMatch(files['tables/dbo.vOrderTotals.md'], /rows/, 'a view has no stats');
  const undated = shop();
  delete undated.databases[0].statsReadAt;
  assert.match(renderMarkdown(undated)['tables/dbo.Products.md'], /About 1,874 rows · 480 KB of data · 64 KB of indexes\.\n/);
});

test('formatCount groups thousands and formatBytes uses binary units, one decimal below ten', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1204377), '1,204,377');
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(8192), '8 KB');
  assert.equal(formatBytes(1536 * 1024), '1.5 MB');
  assert.equal(formatBytes(107085824), '102 MB');
  assert.equal(formatBytes(3 * 1024 ** 4), '3 TB');
  assert.equal(formatBytes(5000 * 1024 ** 4), '5000 TB');
});
