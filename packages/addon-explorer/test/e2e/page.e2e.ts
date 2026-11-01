// Opens the rendered page in a browser and uses it: search, a table, its diagram, expanding, a group. Needs
// Google Chrome (Playwright's "chrome" channel, so nothing is downloaded) or DBTOUR_E2E_BROWSER pointing at a
// Chromium binary; without either the test is skipped and says so. `npm run e2e:page` builds the page first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import type { Model } from 'dbtour/model';
import { render } from '../../src/index.ts';

/** Evaluated in the page, where the DOM is; written as text because this file is typed for Node. */
const nodeCount = (n: number): string => `document.querySelectorAll('.react-flow__node').length === ${n}`;

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

    await page.getByRole('button', { name: 'Copy for Claude' }).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();

    await page.getByRole('link', { name: 'Diagram' }).click();
    await page.locator('.react-flow__node').first().waitFor();
    assert.equal(new URL(page.url()).hash, '#diagram/dbo.Customers,dbo.Orders');
    assert.equal(await page.locator('.react-flow__node').count(), 2);
    assert.equal(await page.locator('.react-flow__edge').count(), 1);

    await page.locator('.react-flow__node', { hasText: 'Orders' }).locator('.node-expand').click();
    await page.waitForFunction(nodeCount(4));
    assert.equal(await page.locator('.react-flow__edge').count(), 3);
    assert.equal(await page.locator('.react-flow__node', { hasText: 'Customers' }).locator('.node-expand').count(), 0, 'nothing left to add around Customers');

    await page.goto(`${url}#group/Billing`);
    await page.locator('h1', { hasText: 'Billing' }).waitFor();
    await page.waitForFunction(nodeCount(3));

    await page.goto(`${url}#dbo.Orders.Status`);
    await page.locator('tr.is-highlighted', { hasText: 'Status' }).waitFor();

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
