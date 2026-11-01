import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { features, formatBytes, formatCount, renderMarkdown, renderTableMarkdown } from '../src/render/markdown.ts';
import { describe } from './fixtures/described.ts';
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

test('features names what the catalogue says about a table, one line each, in a fixed order', () => {
  const orders = describe(shop()).databases[0].schemas[0].tables[1];
  assert.deepEqual(features(orders), [
    { name: 'System-versioned', detail: 'history in dbo.OrdersHistory, each row valid from ValidFrom to ValidTo', ref: 'dbo.OrdersHistory' },
    { name: 'Memory-optimised', detail: 'schema and data' },
    { name: 'Ledger', detail: 'updatable' },
    { name: 'Partitioned', detail: 'on CreatedAt by psByYear (function pfByYear), 12 partitions' },
    { name: 'Compressed', detail: 'page' },
    { name: 'Change tracking' },
    { name: 'Change data capture' },
    { name: 'Triggers', detail: '1' },
    { name: 'Row-level security', detail: 'rls.Tenants' },
    { name: 'Created', detail: '2024-01-02, last altered 2026-10-30' },
  ]);
  assert.deepEqual(features(shop().databases[0].schemas[0].tables[0]), [], 'a table the catalogue says nothing more about has none');
  const history = { ...orders, temporal: undefined, historyOf: 'dbo.Orders', triggers: [], security: [], created: undefined, memoryOptimised: undefined, ledger: undefined, partitioning: undefined, compression: undefined, changeTracking: undefined, cdc: undefined };
  assert.deepEqual(features(history), [{ name: 'History', detail: 'of dbo.Orders', ref: 'dbo.Orders' }]);
});

test('a table page says everything the catalogue does: features, column details, index kinds, keys not trusted', () => {
  const page = renderMarkdown(describe(shop()))['tables/dbo.Orders.md'];
  assert.match(page, /## Features\n\n- \*\*System-versioned\*\*: history in dbo\.OrdersHistory, each row valid from ValidFrom to ValidTo\n- \*\*Memory-optimised\*\*: schema and data\n/);
  assert.match(page, /- \*\*Change tracking\*\*\n/);
  assert.match(page, /\| Id \| int \| no \| {2}\| PK, identity\(1,1\) \| {2}\|/);
  assert.match(page, /\| Status \| tinyint, collation Latin1_General_BIN2 \| no \| `\(\(0\)\)` \| sparse, masked `default\(\)` \| {2}\|/);
  assert.match(page, /\| CreatedAt \| datetime2\(7\) \| no \| `\(sysutcdatetime\(\)\)` \| encrypted \(deterministic, CEK_Auto1\) \| Sensitivity: Confidential, Financial, rank medium\. \|/);
  assert.match(page, /FK → \[dbo\.Customers\]\(dbo\.Customers\.md\)\.Id \(not trusted\)/);
  assert.match(page, /## Indexes\n\n\| Name \| Columns \| Unique \| Kind \|\n\|[-| ]+\|\n\| IX_Orders_CustomerId \| CustomerId \| no \| nonclustered, filtered `\(\[Status\]<\(9\)\)`, disabled \|/);
  assert.match(page, /\| CK_Orders_Status \| check, disabled, not trusted \|/);
  assert.match(page, /## Properties\n\n\| On \| Name \| Value \|\n\|[-| ]+\|\n\| dbo\.Orders \| Retention \| 7 years \|\n\| Id \| Source \| checkout \|\n\| IX_Orders_CustomerId \| Why \| checkout lookups \|\n\| PK_Orders \| Note \| from 2019 \|/);
  assert.match(page, /## Triggers\n\n### trOrdersAudit\n\nAfter insert, update\. Enabled\.\n\n```sql\nCREATE TRIGGER trOrdersAudit \.\.\.\n```/);
  assert.match(page, /## Row-level security\n\n\| Policy \| Kind \| Predicate \| Enabled \|\n\|[-| ]+\|\n\| rls\.Tenants \| filter \| `\(\[rls\]\.\[fnTenant\]\(\[TenantId\]\)\)` \| yes \|/);
});

test('the index says the collation, the database and schema properties, and what could not be read', () => {
  const readme = renderMarkdown(describe(shop()))['README.md'];
  assert.match(readme, /SQL Server 16\.0\.1000, collation Latin1_General_CI_AS\.\n/);
  assert.match(readme, /Not read: sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION\.\n/);
  assert.match(readme, /## Properties\n\n\| On \| Name \| Value \|\n\|[-| ]+\|\n\| Shop \| Owner \| Data team \|\n\| dbo \| Purpose \| Trading \|/);
});

test('a model without any of it renders as before: no Features, Properties, Triggers or Kind', () => {
  const page = renderMarkdown(shop())['tables/dbo.Orders.md'];
  for (const heading of ['## Features', '## Properties', '## Triggers', '## Row-level security']) assert.doesNotMatch(page, new RegExp(heading));
  assert.match(page, /\| Name \| Columns \| Unique \|\n/);
  assert.doesNotMatch(renderMarkdown(shop())['README.md'], /## Properties|Not read|collation/);
});

test('a feature that names a table in the model links to its page', () => {
  const model = shop();
  model.databases[0].schemas[0].tables[3].historyOf = 'dbo.Orders';
  assert.match(renderMarkdown(model)['tables/dbo.Products.md'], /- \*\*History\*\*: of \[dbo\.Orders\]\(dbo\.Orders\.md\)\n/);
});
