// Opens the rendered page in a browser and uses it: search, a table, its diagram, expanding, a group. Needs
// Google Chrome (Playwright's "chrome" channel, so nothing is downloaded) or DBTOUR_E2E_BROWSER pointing at a
// Chromium binary; without either the test is skipped and says so. `npm run e2e:page` builds the page first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Locator } from 'playwright-core';
import { scope, type Model } from 'dbtour/model';
import { render } from '../../src/index.ts';
import { startServer } from '../../../core/src/serve.ts';
import { describe } from '../../../core/test/fixtures/described.ts';
import { twoDatabases } from '../../../core/test/fixtures/two.ts';

/**
 * The text a locator settles on: a pick asked for while CodeMirror refreshes its list is made a moment later,
 * so the editor is read once it says what is expected, or after five seconds, whatever it says then.
 */
async function textOf(locator: Locator, expected: string | RegExp): Promise<string> {
  const until = Date.now() + 5000;
  let text = (await locator.textContent()) ?? '';
  while (!(typeof expected === 'string' ? text === expected : expected.test(text)) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    text = (await locator.textContent()) ?? '';
  }
  return text;
}

/** Evaluated in the page, where the DOM is; written as text because this file is typed for Node. */
const nodeCount = (n: number): string => `document.querySelectorAll('.react-flow__node').length === ${n}`;
/** Edges are drawn a frame after the nodes are measured, so they are waited for, never counted at once. */
const edgeCount = (n: number): string => `document.querySelectorAll('.react-flow__edge').length === ${n}`;

async function launch(): Promise<Browser | undefined> {
  const executablePath = process.env.DBTOUR_E2E_BROWSER;
  try {
    return await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  } catch {
    return undefined;
  }
}

test('the page searches, opens a table, draws its neighbourhood, expands it and shows a group', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const model: Model = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
    model.groups.push({ name: 'Billing', description: 'Money in.', tables: ['dbo.Orders', 'dbo.OrderLines', 'billing.Invoices'] });
    const file = join(mkdtempSync(join(tmpdir(), 'dbtour-page-')), 'index.html');
    writeFileSync(file, render(model)['index.html']);
    const url = pathToFileURL(file).href;

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);

    await page.getByRole('heading', { name: 'Shop' }).waitFor();
    assert.equal(await page.locator('.tree li a').count(), 7, 'six tables and one group are listed');

    await page.keyboard.press('/');
    await page.keyboard.type('cust');
    assert.match((await page.locator('.hits a').first().textContent()) ?? '', /dbo\.Customers/);
    await page.keyboard.press('Enter');
    await page.locator('h1', { hasText: 'Customers' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#dbo.Customers');
    assert.match((await page.locator('.columns').textContent()) ?? '', /Email.*nvarchar\(320\).*Login address\./);
    assert.match((await page.locator('.panel').textContent()) ?? '', /Referenced by.*dbo\.Orders/);

    await page.getByRole('button', { name: 'Copy for any agent' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();
    await page.getByLabel('Which tool the copy is for').selectOption('claude');
    await page.getByRole('button', { name: 'Copy for Claude' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open Claude ↗' }).getAttribute('href'), 'https://claude.ai/new');

    // The entry carries a small map of its neighbourhood, at names level.
    await page.locator('.diagram.embedded .react-flow__node').first().waitFor();
    await page.waitForFunction(`document.querySelectorAll('.diagram.embedded .react-flow__node').length === 2`);
    assert.equal(await page.locator('.diagram.embedded .node-rows').count(), 0, 'names only');

    await page.locator('.actions a', { hasText: 'Open the map' }).click();
    await page.locator('.diagram:not(.embedded) h1', { hasText: 'and around it' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#diagram/dbo.Customers,dbo.Orders');
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.waitForFunction(nodeCount(2));
    await page.waitForFunction(edgeCount(1));

    await page.locator('.react-flow__node', { hasText: 'Orders' }).locator('.node-expand').click();
    await page.waitForFunction(nodeCount(4));
    await page.waitForFunction(edgeCount(3));
    assert.equal(await page.locator('.react-flow__node', { hasText: 'Customers' }).locator('.node-expand').count(), 0, 'nothing left to add around Customers');

    await page.goto(`${url}#group/Billing`);
    await page.locator('h1', { hasText: 'Billing' }).waitFor();
    await page.waitForFunction(nodeCount(3));

    // The whole catalogue, at names level, and the links panel switching a relation off.
    await page.goto(`${url}#map`);
    await page.locator('h1', { hasText: 'The whole catalogue' }).waitFor();
    await page.getByRole('button', { name: 'Names' }).click();
    await page.waitForFunction(nodeCount(6));
    await page.waitForFunction(edgeCount(4));
    assert.equal(await page.locator('.node-rows').count(), 0, 'names only');
    assert.equal(await page.locator('.node-expand').count(), 0, 'nothing left to add on the whole catalogue');
    await page.getByRole('button', { name: /^Links/ }).click();
    // The first box is the "Declared" group; the fixture has no relation from the notes.
    await page.locator('.map-links input').nth(2).uncheck();
    await page.waitForFunction(edgeCount(3));
    await page.locator('.map-links label.group').first().locator('input').uncheck();
    await page.waitForFunction(edgeCount(0));
    await page.locator('.map-links label.group').first().locator('input').check();
    await page.waitForFunction(edgeCount(4));
    await page.getByRole('button', { name: 'Keys' }).click();
    await page.waitForFunction(`document.querySelectorAll('.node-rows li').length === 8`);

    await page.goto(`${url}#dbo.Orders.Status`);
    await page.locator('tr.is-highlighted', { hasText: 'Status' }).waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('with sizes, a bar beside each line shows the bytes, the index orders and remembers it, and an entry opens on its size', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const model: Model = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
    const dir = mkdtempSync(join(tmpdir(), 'dbtour-page-'));
    writeFileSync(join(dir, 'index.html'), render(model)['index.html']);
    const url = pathToFileURL(join(dir, 'index.html')).href;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);

    await page.getByRole('heading', { name: 'Shop' }).waitFor();
    assert.match((await page.locator('.entry-head .meta').textContent()) ?? '', /as of 2026-11-01/);
    const names = () => page.locator('.plots .name').allTextContents();
    assert.equal((await names())[0], 'Customers', 'catalogue order first');
    assert.match((await page.locator('.plots li').first().locator('.size').textContent()) ?? '', /48,213 rows · 8\.6 MB/);

    await page.getByRole('group', { name: 'Order' }).getByRole('button', { name: 'Rows' }).click();
    assert.deepEqual((await names()).slice(0, 2), ['OrderLines', 'Orders']);
    // The bar is the bytes against the largest table: OrderLines fills it, the view has none and says so.
    const bar = (n: number) => page.locator('.plots li').nth(n).locator('.size-bar');
    assert.equal(await bar(0).getAttribute('aria-label'), '78 MB of data, 24 MB of indexes');
    // The browser rounds the widths it keeps, so they are compared to a tenth of a per cent.
    const widths = async (n: number) =>
      (await bar(n).locator('span').evaluateAll((parts) => parts.map((p) => (p as unknown as { style: { width: string } }).style.width))).map((w) => parseFloat(w).toFixed(1));
    assert.deepEqual(await widths(0), ['76.5', '23.5'], 'OrderLines fills the bar: 78 MB of data, 24 MB of indexes');
    assert.deepEqual(await widths(1), ['28.8', '9.1'], 'Orders, 39 MB, is drawn to the same scale');
    assert.equal(await bar(5).count(), 0);
    assert.equal((await page.locator('.plots li').nth(5).locator('.size').textContent())?.trim(), 'no rows of its own');

    await page.reload();
    await page.getByRole('heading', { name: 'Shop' }).waitFor();
    assert.equal((await names())[0], 'OrderLines', 'the order is remembered');
    assert.equal(await page.getByRole('button', { name: 'Rows' }).getAttribute('aria-pressed'), 'true');

    await page.goto(`${url}#dbo.Customers`);
    await page.locator('h1', { hasText: 'Customers' }).waitFor();
    const size = page.getByRole('region', { name: 'Size' });
    assert.match((await size.textContent()) ?? '', /As of 2026-11-01.*48,213 rows.*the 4th largest of 5 tables by rows.*7\.1 MB data.*1\.6 MB indexes.*8\.6 MB in all/);
    assert.match((await size.textContent()) ?? '', /SQL Server's own count of the rows, an estimate/);
    assert.doesNotMatch((await page.locator('.entry-head .meta').textContent()) ?? '', /rows/, 'the size lives in its block, not the meta line');

    // A model without sizes keeps the plain index: no order to choose, no bars, no size block.
    for (const schema of model.databases[0].schemas) for (const table of schema.tables) delete table.stats;
    writeFileSync(join(dir, 'bare.html'), render(model)['index.html']);
    await page.goto(pathToFileURL(join(dir, 'bare.html')).href);
    await page.getByRole('heading', { name: 'Shop' }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Order' }).count(), 0);
    assert.equal(await page.locator('.plots .size, .plots .size-bar').count(), 0);
    await page.goto(`${pathToFileURL(join(dir, 'bare.html')).href}#dbo.Customers`);
    await page.locator('h1', { hasText: 'Customers' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Size' }).count(), 0);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('what the catalogue says: an About block in sentences, a Protection column, triggers, and what was not read', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const model = describe(JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8')));
    const dir = mkdtempSync(join(tmpdir(), 'dbtour-page-'));
    writeFileSync(join(dir, 'index.html'), render(model)['index.html']);
    const url = pathToFileURL(join(dir, 'index.html')).href;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(url);
    await page.getByRole('heading', { name: 'Shop' }).waitFor();
    assert.match((await page.locator('.entry-head').textContent()) ?? '', /collation Latin1_General_CI_AS/);
    assert.match((await page.locator('.unread').textContent()) ?? '', /Not read: sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION\./);
    assert.match((await page.locator('.panel').textContent()) ?? '', /Shop · Owner\s*Data team/);

    await page.goto(`${url}#dbo.Orders`);
    const about = page.getByRole('region', { name: 'About' });
    await about.waitFor();
    const text = (await about.textContent()) ?? '';
    assert.match(text, /Created 2024-01-02 · altered 2026-10-30/);
    assert.match(text, /System-versioned\s*Every change is kept in dbo\.OrdersHistory/);
    assert.match(text, /Triggers\s*trOrdersAudit runs after insert and update/);
    assert.match(text, /Retention\s*7 years/);
    assert.equal(await about.getByRole('link', { name: 'dbo.OrdersHistory' }).count(), 0, 'a history table not in the model is named, not linked');

    assert.equal(await page.locator('table.columns th', { hasText: 'Protection' }).count(), 1);
    const createdAt = page.locator('tr', { hasText: 'CreatedAt' });
    assert.match((await createdAt.locator('.tag.protect').allTextContents()).join(' | '), /Confidential · Financial · rank medium \| Encrypted, deterministic/);
    assert.equal(await createdAt.locator('.rank-dot.rank-medium').count(), 1, 'the rank has its dot, its words beside it');
    assert.match((await page.locator('tr', { hasText: 'Status' }).first().textContent()) ?? '', /sparse · collation Latin1_General_BIN2/);

    await page.locator('summary', { hasText: 'Triggers' }).click();
    assert.match((await page.locator('.trigger').textContent()) ?? '', /trOrdersAudit runs after insert, update/);
    // The definition is in a read-only CodeMirror editor, coloured by the MSSQL parser.
    const editor = page.locator('.trigger .sql-block .cm-editor');
    await editor.waitFor();
    assert.equal(await editor.locator('.cm-content').getAttribute('contenteditable'), 'false');
    assert.ok((await editor.locator('.sql-keyword').count()) > 0, 'keywords are coloured');
    await page.locator('.trigger .sql-copy').click();
    await page.locator('.trigger .sql-copy', { hasText: 'Copied' }).waitFor();
    await page.locator('summary', { hasText: 'Constraints' }).click();
    assert.match((await page.locator('tr', { hasText: 'CK_Orders_Status' }).textContent()) ?? '', /disabled.*not trusted/);
    assert.equal(await page.locator('tr', { hasText: 'CK_Orders_Status' }).locator('.tag.warn').count(), 2);
    assert.ok((await page.locator('tr', { hasText: 'CK_Orders_Status' }).locator('code.sql .sql-name').count()) > 0, 'the check is SQL, coloured');

    // The plot and the columns table point at the same column: a tick's tooltip and its row, a row's tick.
    await page.goto(`${url}#dbo.Orders`);
    await page.locator('.entry-plot a.plot-tick').first().waitFor();
    await page.locator('.entry-plot a.plot-tick').nth(1).hover();
    const tip = page.getByRole('tooltip');
    await tip.waitFor();
    assert.match((await tip.textContent()) ?? '', /CustomerId\s*int.*Foreign key → dbo\.Customers\.Id.*not null · not trusted/);
    assert.match((await page.locator('table.columns tr.is-pointed').textContent()) ?? '', /^CustomerId/, 'the tick lights its row');
    await page.locator('.entry-plot a.plot-tick').nth(1).focus();
    await page.keyboard.press('ArrowRight');
    assert.match((await tip.textContent()) ?? '', /^Status\s*tinyint/, '→ moves to the next column');
    assert.match((await tip.textContent()) ?? '', /Masked default\(\)/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.match((await tip.textContent()) ?? '', /^Id\s*int.*Primary key.*identity\(1,1\).*Source: checkout/);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('tooltip').count(), 0, 'Escape hides the tooltip');
    assert.equal(await page.evaluate('document.activeElement?.getAttribute("aria-label")'), 'Id, int, primary key', 'and leaves focus on the tick');
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tooltip').waitFor();
    await page.locator('table.columns tr', { hasText: 'CreatedAt' }).hover();
    assert.equal(await page.locator('.entry-plot a.plot-tick.is-hover').count(), 1, 'a row lifts its tick');
    assert.equal(await page.getByRole('tooltip').count(), 0, 'without a tooltip over the map');
    assert.match((await page.locator('table.columns tr.is-pointed').textContent()) ?? '', /CreatedAt/);

    // A table the catalogue says nothing more about has no About block and no Protection column.
    await page.goto(`${url}#dbo.Products`);
    await page.locator('h1', { hasText: 'Products' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'About' }).count(), 0);
    assert.equal(await page.locator('table.columns th', { hasText: 'Protection' }).count(), 0);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('two databases with a table of the same name: each is its own entry, an old link finds the one it can', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const file = join(mkdtempSync(join(tmpdir(), 'dbtour-page-')), 'index.html');
    writeFileSync(file, render(scope(twoDatabases()))['index.html']);
    const url = pathToFileURL(file).href;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(url);
    await page.locator('.tree').waitFor();
    assert.equal(await page.locator('.tree li a').count(), 4, 'both databases\' tables are listed, the two Customers apart');
    await page.keyboard.press('/');
    await page.keyboard.type('customers');
    const hits = (await page.locator('.hits a').allTextContents()).slice(0, 2).join(' | ');
    assert.match(hits, /Sales:dbo\.Customers.*Billing:dbo\.Customers/, 'the two tables come first, each with its database');

    await page.goto(`${url}#dbo.Payments`);
    await page.locator('h1', { hasText: 'Payments' }).waitFor();
    assert.match((await page.locator('.panel').textContent()) ?? '', /Billing:dbo\.Customers/, 'the relation names the table in its own database');

    await page.goto(`${url}#dbo.Customers`);
    await page.locator('h1', { hasText: 'is in 2 databases' }).waitFor();
    await page.locator('article.page').getByRole('link', { name: 'Billing:dbo.Customers' }).click();
    await page.locator('h1', { hasText: 'Customers' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#Billing:dbo.Customers');
    assert.match((await page.locator('.panel').textContent()) ?? '', /Referenced by.*Billing:dbo\.Payments/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('the Query section: a starter from the model, autocomplete of its tables, a draft kept, Copy for agent, and the SQL page', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const model: Model = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
    const dir = mkdtempSync(join(tmpdir(), 'dbtour-page-'));
    writeFileSync(join(dir, 'index.html'), render(model)['index.html']);
    const url = pathToFileURL(join(dir, 'index.html')).href;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}#dbo.Orders`);

    const editor = page.locator('.query-section .cm-content');
    await editor.waitFor();
    assert.match((await editor.textContent()) ?? '', /LEFT JOIN dbo\.Customers AS c ON c\.Id = o\.CustomerId/);
    assert.equal(await editor.getAttribute('contenteditable'), 'true', 'it can be written in');

    // Autocomplete offers the model's tables as a name is typed, and Enter takes one, with an alias.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nSELECT * FROM dbo.OrderL');
    const options = page.locator('.cm-tooltip-autocomplete li');
    await options.first().waitFor();
    assert.match((await options.allTextContents()).join(' '), /OrderLines/);
    await page.keyboard.press('Enter');
    assert.match(await textOf(editor, /FROM dbo\.OrderLines AS ol$/), /FROM dbo\.OrderLines AS ol$/);

    // In WHERE, the columns of the table the query reads come first, before keywords like QUOTENAME.
    await page.keyboard.type(' WHERE Qu');
    await options.first().waitFor();
    assert.match((await options.first().textContent()) ?? '', /^Quantity/);
    await page.keyboard.press('Enter');
    assert.match(await textOf(editor, /FROM dbo\.OrderLines AS ol WHERE Quantity$/), /FROM dbo\.OrderLines AS ol WHERE Quantity$/);

    // The draft is kept in the browser, and Reset goes back to the starter.
    await page.reload();
    await editor.waitFor();
    assert.match((await editor.textContent()) ?? '', /dbo\.OrderLines AS ol WHERE Quantity$/, 'kept across a reload');
    await page.locator('.query-section button', { hasText: 'Copy query for' }).click();
    const copied = await page.evaluate('navigator.clipboard.readText()') as string;
    assert.match(copied, /^The query below runs on the Shop database \(SQL Server\)\./);
    assert.match(copied, /# dbo\.Orders\n[\s\S]*# dbo\.Customers\n[\s\S]*# dbo\.OrderLines\n/, 'the tables it reads, as the docs write them');
    await page.locator('.query-section button', { hasText: 'Reset' }).click();
    assert.doesNotMatch((await editor.textContent()) ?? '', /OrderLines/);

    // The SQL page, from the rail.
    await page.locator('a', { hasText: 'Write SQL' }).click();
    await page.locator('h1', { hasText: 'SQL' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#sql');
    const sqlEditor = page.locator('.sql-page .cm-content');
    assert.match((await sqlEditor.textContent()) ?? '', /A query against Shop/);

    // A snippet writes the start of a read and opens the tables, and Tab takes one; Tab after * writes the
    // columns; Format lays it out.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('ssf');
    await options.first().waitFor();
    assert.match((await options.first().textContent()) ?? '', /^ssf/);
    await page.keyboard.press('Enter');
    assert.equal(await textOf(sqlEditor, 'SELECT * FROM '), 'SELECT * FROM ');
    await options.first().waitFor();
    await page.keyboard.type('Cust');
    await options.filter({ hasText: /^Customers/ }).first().waitFor();
    // At once, while CodeMirror may still be refreshing the list for the last letter: the pick waits for it.
    await page.keyboard.press('Tab');
    assert.equal(await textOf(sqlEditor, 'SELECT * FROM dbo.Customers AS c'), 'SELECT * FROM dbo.Customers AS c', 'Tab takes the suggestion, as Enter does');
    await page.keyboard.press('Home');
    for (let i = 0; i < 'SELECT *'.length; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    assert.equal(await sqlEditor.textContent(), 'SELECT Id, Email, Name FROM dbo.Customers AS c');
    assert.ok(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), 'Tab stayed in the editor to write them');
    await page.locator('.sql-page button', { hasText: 'Format' }).click();
    assert.deepEqual(await page.locator('.sql-page .cm-line').allTextContents(), ['SELECT', '  Id,', '  Email,', '  Name', 'FROM', '  dbo.Customers AS c']);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('on a phone, a suggestion\'s description sits clear of the list, and a name the model lacks is underlined', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  try {
    const model: Model = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
    const file = join(mkdtempSync(join(tmpdir(), 'dbtour-page-')), 'index.html');
    writeFileSync(file, render(model)['index.html']);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${pathToFileURL(file).href}#sql`);
    const editor = page.locator('.sql-page .cm-content');
    await editor.waitFor();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    // The whole table list, wide with each table's schema and rows, leaves no room beside it on a phone.
    await page.keyboard.type('SELECT * FROM ');
    await page.keyboard.press('Control+Space');
    const info = page.locator('.cm-completionInfo', { hasText: 'One row per account.' });
    await info.waitFor();
    const list = (await page.locator('.cm-tooltip-autocomplete > ul').boundingBox())!;
    const box = (await info.boundingBox())!;
    const overlaps = box.x < list.x + list.width && list.x < box.x + box.width && box.y < list.y + list.height && list.y < box.y + box.height;
    assert.ok(!overlaps, `the description (${JSON.stringify(box)}) covers no suggestion (${JSON.stringify(list)})`);

    // A table the model does not have: a red wavy line, and on it what dbtour knows and what to do.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('SELECT * FROM dbo.Ordrs');
    const marked = page.locator('.sql-page .cm-lintRange-warning');
    await marked.waitFor();
    assert.equal(await marked.textContent(), 'dbo.Ordrs');
    await marked.hover();
    await page.locator('.cm-tooltip-lint', { hasText: 'Did you mean dbo.Orders?' }).waitFor();
    await page.locator('.cm-tooltip-lint button', { hasText: 'dbo.Orders' }).click();
    assert.equal(await editor.textContent(), 'SELECT * FROM dbo.Orders');
    await page.waitForFunction("!document.querySelector('.sql-page .cm-lintRange-warning')");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('served by dbtour serve: Run shows the rows, the dot says how the last run went, and Auto-run follows the typing', async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip('no browser: install Google Chrome, or set DBTOUR_E2E_BROWSER to a Chromium binary');
    return;
  }
  const model: Model = JSON.parse(readFileSync(new URL('../../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'dbtour-page-'));
  writeFileSync(join(dir, 'index.html'), render(model)['index.html']);
  // A database that answers after a moment, as a real one does, and refuses a table it does not have.
  const asked: string[] = [];
  const server = await startServer({
    root: dir,
    port: 0,
    token: 'e2e',
    sources: [{ name: 'Shop', reader: true }],
    run: async (sql, source) => {
      asked.push(sql);
      await new Promise((done) => setTimeout(done, 150));
      if (/\bNope\b/.test(sql)) throw new Error("Shop (mssql): Invalid object name 'dbo.Nope'.");
      return { columns: ['Id', 'Name'], rows: [[1, 'Ann'], [2, null]], truncated: false, limit: 100, source: source ?? 'Shop' };
    },
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${server.url}/#dbo.Orders`);
    const editor = page.locator('.query-section .cm-content');
    const status = page.locator('.query-section .sql-bar .status');
    await editor.waitFor();
    assert.equal(await status.textContent(), 'Connected · Shop');
    assert.match((await status.getAttribute('class')) ?? '', /is-idle/, 'grey before a run');

    await page.locator('.query-section button', { hasText: 'Run' }).click();
    await page.locator('.query-section .sql-result td', { hasText: 'Ann' }).waitFor();
    assert.match((await page.locator('.query-section .sql-result-head').textContent()) ?? '', /2 rows · \d+ ms · Shop's reader/);
    assert.match((await status.getAttribute('class')) ?? '', /is-ok/, 'green: it answered');

    // One query at a time, whichever way it is asked: a second ⌘/Ctrl+Enter while the first runs sends nothing.
    const once = asked.length;
    await editor.click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForFunction(`!document.querySelector('.query-section .sql-result').classList.contains('is-stale')`);
    assert.equal(asked.length, once + 1, 'the second press, while the first ran, sent nothing');

    // A table that is not there: why, in red, and the rows before kept, dimmed.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('SELECT * FROM dbo.Nope');
    // Ctrl+Enter runs it on every system, as SQL Server's tools do, ⌘+Enter too on a Mac.
    await page.keyboard.press('Control+Enter');
    await page.locator('.query-section .sql-error', { hasText: "Invalid object name 'dbo.Nope'" }).waitFor();
    assert.match((await status.getAttribute('class')) ?? '', /is-failed/, 'red: it failed');
    assert.equal(await status.textContent(), 'Connected · Shop · failed');
    assert.match((await page.locator('.query-section .sql-result-head').textContent()) ?? '', /the run before/);

    // Auto-run: once each pause in typing, never per key, and neither the query just sent nor a half-written one.
    const before = asked.length;
    await page.locator('.query-section .sql-auto input').check();
    await new Promise((next) => setTimeout(next, 400));
    assert.equal(asked.length, before, 'the query just sent is not sent again');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('SELECT Id, Name FROM dbo.Customers');
    await page.locator('.query-section .sql-result td', { hasText: 'Ann' }).waitFor();
    await page.waitForFunction(`!document.querySelector('.query-section .sql-result').classList.contains('is-stale')`);
    assert.equal(asked.at(-1), 'SELECT Id, Name FROM dbo.Customers');
    assert.ok(asked.length - before <= 3, `one run per pause, not per key: ${asked.length - before} runs`);
    const sent = asked.length;
    await page.keyboard.type(" WHERE Name = 'An");
    await page.locator('.query-section .sql-waiting', { hasText: 'string open' }).waitFor();
    assert.equal(asked.length, sent, 'a string left open is not sent');
    assert.equal(await status.textContent(), 'Connected · Shop · waiting');
    await page.keyboard.type("n'");
    await page.waitForFunction(`document.querySelector('.query-section .sql-waiting') === null`);
    await page.waitForFunction(`!document.querySelector('.query-section .sql-result').classList.contains('is-stale')`);
    assert.equal(asked.at(-1), "SELECT Id, Name FROM dbo.Customers WHERE Name = 'Ann'");

    // The rail says the page is served, green as a source has a reader.
    assert.match((await page.locator('.side-status').getAttribute('class')) ?? '', /is-live/);
    // The SQL page puts the caret in its editor, on the line under SELECT: typing goes straight in.
    await page.locator('a', { hasText: 'Write SQL' }).click();
    await page.locator('.sql-page .cm-content').waitFor();
    await page.waitForFunction(`document.activeElement?.closest('.sql-page .cm-editor') !== null`);
    await page.keyboard.type('Id FROM dbo.Orders');
    assert.match((await page.locator('.sql-page .cm-content').textContent()) ?? '', /SELECT TOP \(100\) {4}Id FROM dbo\.Orders/);
    await page.goBack();

    // Remembered in this browser.
    await page.reload();
    await editor.waitFor();
    assert.equal(await page.locator('.query-section .sql-auto input').isChecked(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});
