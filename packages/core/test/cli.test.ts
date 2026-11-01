import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, utimesSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import type { Model } from '../src/model.ts';
import { twoDatabases } from './fixtures/two.ts';

const fixture = new URL('./fixtures/shop.json', import.meta.url);

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbtour-'));
  return dir;
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) } };
}

test('help is printed with no command and with --help, exit 0', async () => {
  const a = io();
  assert.equal(await main([], { cwd: project(), ...a.io }), 0);
  assert.match(a.out.join('\n'), /Usage: dbtour <command>/);
  const b = io();
  assert.equal(await main(['--help'], { cwd: project(), ...b.io }), 0);
});

test('an unknown command exits 1 and says so', async () => {
  const a = io();
  assert.equal(await main(['dance'], { cwd: project(), ...a.io }), 1);
  assert.match(a.err.join('\n'), /dance/);
});

test('init writes dbtour.yaml once and refuses to overwrite it', async () => {
  const cwd = project();
  const a = io();
  assert.equal(await main(['init'], { cwd, ...a.io }), 0);
  assert.match(readFileSync(join(cwd, 'dbtour.yaml'), 'utf8'), /type: mssql/);
  const b = io();
  assert.equal(await main(['init'], { cwd, ...b.io }), 1);
  assert.match(b.err.join('\n'), /already exists/);
});

test('render without a config exits 2 and says to run init', async () => {
  const a = io();
  assert.equal(await main(['render'], { cwd: project(), ...a.io }), 2);
  assert.match(a.err.join('\n'), /dbtour init/);
});

test('render without schema.json exits 2 and says to run extract', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: mssql\n    name: Shop\n');
  const a = io();
  assert.equal(await main(['render'], { cwd, ...a.io }), 2);
  assert.match(a.err.join('\n'), /dbtour extract/);
});

test('render writes the Markdown next to schema.json, merging the notes, and reports what it wrote', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'out: docs/db\nsources:\n  - type: mssql\n    name: Shop\n');
  writeFileSync(join(cwd, 'dbtour.notes.yaml'), 'tables:\n  dbo.Orders:\n    description: From the notes.\n  dbo.Ghost:\n    description: x\n');
  mkdirSync(join(cwd, 'docs/db'), { recursive: true });
  cpSync(fixture, join(cwd, 'docs/db/schema.json'));
  const a = io();
  assert.equal(await main(['render'], { cwd, ...a.io }), 0);
  assert.match(readFileSync(join(cwd, 'docs/db/tables/dbo.Orders.md'), 'utf8'), /From the notes\./);
  assert.equal(existsSync(join(cwd, 'docs/db/README.md')), true);
  assert.match(a.out.join('\n'), /7 files/);
  assert.match(a.err.join('\n'), /dbo\.Ghost/);
});

test('extract runs each source, writes schema.json and exits 1 when a source fails', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Shop\n    connection: ${DBTOUR_FAKE}\n');
  const database = JSON.parse(readFileSync(fixture, 'utf8')).databases[0];
  const seen: unknown[] = [];
  const load = async () => ({ extract: async (config: unknown) => { seen.push(config); return database; } });
  const a = io();
  assert.equal(await main(['extract'], { cwd, env: { DBTOUR_FAKE: 'Server=x' }, load, ...a.io }), 0);
  assert.deepEqual(seen, [{ type: 'fake', name: 'Shop', connection: 'Server=x' }]);
  const written = JSON.parse(readFileSync(join(cwd, 'docs/dbtour/schema.json'), 'utf8'));
  assert.equal(written.dbtour, 1);
  assert.equal(written.databases[0].name, 'Shop');
  assert.match(a.out.join('\n'), /Shop: 6 tables/);

  const b = io();
  const failing = async () => ({ extract: async () => { throw new Error('login failed for reader'); } });
  assert.equal(await main(['extract'], { cwd, env: { DBTOUR_FAKE: 'Server=x' }, load: failing, ...b.io }), 1);
  assert.match(b.err.join('\n'), /Shop.*login failed for reader/);

  const c = io();
  assert.equal(await main(['extract'], { cwd, env: {}, load, ...c.io }), 2);
  assert.match(c.err.join('\n'), /DBTOUR_FAKE/);
});

test('extract says what a source could not read, and why, after its count', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Shop\n    connection: ${DBTOUR_FAKE}\n');
  const database = { ...JSON.parse(readFileSync(fixture, 'utf8')).databases[0], unread: ['sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION'] };
  const load = async () => ({ extract: async () => database });
  const a = io();
  assert.equal(await main(['extract'], { cwd, env: { DBTOUR_FAKE: 'Server=x' }, load, ...a.io }), 0);
  assert.match(a.out.join('\n'), /Shop: 6 tables.*\nShop: not read: sensitivity labels: the login lacks VIEW ANY SENSITIVITY CLASSIFICATION\. Grant it to read them, or leave them out\./);
});

test('render runs each add-on: enrich changes the model, render adds files, a missing add-on exits 2', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'out: docs\nsources:\n  - type: mssql\n    name: Shop\naddons:\n  - explorer\n');
  mkdirSync(join(cwd, 'docs'), { recursive: true });
  cpSync(fixture, join(cwd, 'docs/schema.json'));
  const loadAddon = async () => ({
    enrich: (model: Model) => ({ ...model, groups: [...model.groups, { name: 'Enriched', tables: ['dbo.Orders'] }] }),
    render: (model: Model) => ({ 'index.html': `<html>${model.groups.map((g) => g.name).join(',')}</html>` }),
  });
  const a = io();
  assert.equal(await main(['render'], { cwd, loadAddon, ...a.io }), 0);
  assert.equal(readFileSync(join(cwd, 'docs/index.html'), 'utf8'), '<html>Enriched</html>');
  assert.match(readFileSync(join(cwd, 'docs/README.md'), 'utf8'), /## Enriched/);
  assert.match(a.out.join('\n'), /8 files/);

  const b = io();
  const missingAddon = async () => { throw new Error('Add-on "explorer" is not installed: npm install dbtour-addon-explorer'); };
  assert.equal(await main(['render'], { cwd, loadAddon: missingAddon, ...b.io }), 2);
  assert.match(b.err.join('\n'), /npm install dbtour-addon-explorer/);
});

/** Runs dbtour mcp with these lines on stdin, and a function between them where something changes. */
async function mcp(args: string[], cwd: string, lines: (string | (() => void))[]) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const answers: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  stdout.on('data', (chunk: Buffer) => answers.push(...chunk.toString().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))));
  const a = io();
  const done = main(['mcp', ...args], { cwd, stdin, stdout, ...a.io });
  for (const line of lines) {
    if (typeof line === 'function') {
      line();
      continue;
    }
    stdin.write(line + '\n');
    await new Promise((resolve) => setImmediate(resolve));
  }
  stdin.end();
  return { code: await done, answers, ...a };
}

test('mcp without a config or a model exits 2 and says what to run', async () => {
  const none = await mcp([], project(), []);
  assert.equal(none.code, 2);
  assert.match(none.err.join('\n'), /dbtour init/);
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: mssql\n    name: Shop\n');
  const empty = await mcp([], cwd, []);
  assert.equal(empty.code, 2);
  assert.match(empty.err.join('\n'), /dbtour extract/);
});

test('mcp answers on stdout, never logs there, reads the notes, and reads the model again when it changes', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'out: docs/db\nsources:\n  - type: mssql\n    name: Shop\n');
  writeFileSync(join(cwd, 'dbtour.notes.yaml'), 'tables:\n  dbo.Orders:\n    description: From the notes.\n');
  mkdirSync(join(cwd, 'docs/db'), { recursive: true });
  const schema = join(cwd, 'docs/db/schema.json');
  cpSync(fixture, schema);
  const read = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'table', arguments: { ref: 'dbo.Orders' } } });
  const run = await mcp(['..'], join(cwd, 'docs'), [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    read,
    () => {
      const model = JSON.parse(readFileSync(fixture, 'utf8'));
      model.databases[0].schemas[0].tables[1].columns[0].description = 'Changed since.';
      writeFileSync(schema, JSON.stringify(model));
      const later = new Date(Date.now() + 60_000);
      utimesSync(schema, later, later);
    },
    read,
  ]);
  assert.equal(run.code, 0);
  assert.deepEqual(run.out, [], 'stdout is the protocol, so nothing is logged to it');
  assert.deepEqual(run.answers.map((a) => a.id), [1, 2, 2]);
  assert.equal(run.answers[0].result.serverInfo.name, 'dbtour');
  assert.match(run.answers[0].result.serverInfo.version, /^\d+\.\d+\.\d+/);
  assert.match(run.answers[1].result.content[0].text, /From the notes\./);
  assert.match(run.answers[2].result.content[0].text, /Changed since\./);
});

test('render names each table with its database when there are several, and the notes may leave it out', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: mssql\n    name: Sales\n  - type: mssql\n    name: Billing\n');
  writeFileSync(join(cwd, 'dbtour.notes.yaml'), 'tables:\n  dbo.Payments:\n    description: From the notes.\n  dbo.Customers:\n    description: Which?\n');
  mkdirSync(join(cwd, 'docs/dbtour'), { recursive: true });
  writeFileSync(join(cwd, 'docs/dbtour/schema.json'), JSON.stringify(twoDatabases()));
  const a = io();
  assert.equal(await main(['render'], { cwd, ...a.io }), 0);
  assert.match(readFileSync(join(cwd, 'docs/dbtour/tables/Billing/dbo.Payments.md'), 'utf8'), /^# Billing:dbo\.Payments\n\nFrom the notes\./);
  assert.equal(existsSync(join(cwd, 'docs/dbtour/tables/Sales/dbo.Customers.md')), true);
  assert.match(a.err.join('\n'), /dbo\.Customers is in Sales and Billing/);
  const schema = JSON.parse(readFileSync(join(cwd, 'docs/dbtour/schema.json'), 'utf8'));
  assert.equal(schema.databases[0].schemas[0].name, 'dbo', 'schema.json keeps the names the sources wrote');
});

test('extract refuses two sources with the same name, since refs could not tell them apart', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Shop\n  - type: fake\n    name: Shop\n');
  const database = JSON.parse(readFileSync(fixture, 'utf8')).databases[0];
  const a = io();
  assert.equal(await main(['extract'], { cwd, load: async () => ({ extract: async () => database }), ...a.io }), 1);
  assert.match(a.err.join('\n'), /two databases are named Shop: give each source its own name in dbtour\.yaml/);
  assert.equal(existsSync(join(cwd, 'docs/dbtour/schema.json')), false);
});

test('sql runs one read through the source\'s reader, refuses before connecting, and prints a table or JSON', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Shop\n    connection: ${DBTOUR_FAKE}\n    reader: ${DBTOUR_FAKE_READER}\n');
  const ran: { connection?: string; sql: string; limit: number; timeoutMs: number }[] = [];
  const load = async () => ({
    extract: async () => { throw new Error('extract is not what sql runs'); },
    run: async (config: { connection?: string }, sql: string, options: { limit: number; timeoutMs: number }) => {
      ran.push({ connection: config.connection, sql, ...options });
      return { columns: ['Id', 'At'], rows: [[1, new Date('2026-11-01T00:00:00Z')]], truncated: false, limit: options.limit };
    },
  });
  const env = { DBTOUR_FAKE: 'Server=x;User Id=owner', DBTOUR_FAKE_READER: 'Server=x;User Id=reader' };

  const a = io();
  assert.equal(await main(['sql', 'SELECT Id, At FROM dbo.Orders;'], { cwd, env, load, ...a.io }), 0);
  assert.deepEqual(ran, [{ connection: 'Server=x;User Id=reader', sql: 'SELECT Id, At FROM dbo.Orders', limit: 100, timeoutMs: 30000 }]);
  assert.equal(a.out.join('\n'), '| Id | At |\n|---|---|\n| 1 | 2026-11-01T00:00:00.000Z |\n\n1 row.');

  const b = io();
  assert.equal(await main(['sql', 'SELECT 1', '--limit', '7', '--json'], { cwd, env, load, ...b.io }), 0);
  assert.equal(ran[1].limit, 7);
  assert.deepEqual(JSON.parse(b.out.join('\n')), { columns: ['Id', 'At'], rows: [[1, '2026-11-01T00:00:00.000Z']], truncated: false, limit: 7 });

  const c = io();
  assert.equal(await main(['sql', 'DELETE FROM dbo.Orders'], { cwd, env, load, ...c.io }), 1);
  assert.match(c.err.join('\n'), /starts with DELETE/);
  assert.equal(ran.length, 2, 'a refused query never reaches the source');

  const d = io();
  assert.equal(await main(['sql'], { cwd, env, load, ...d.io }), 1);
  assert.match(d.err.join('\n'), /dbtour sql "SELECT/);

  const e = io();
  assert.equal(await main(['sql', 'SELECT 1'], { cwd, env: { DBTOUR_FAKE: 'Server=x' }, load, ...e.io }), 2);
  assert.match(e.err.join('\n'), /Set DBTOUR_FAKE_READER/);

  const f = io();
  const failing = async () => ({ extract: async (): Promise<never> => { throw new Error('sql never extracts'); }, run: async () => { throw new Error("Invalid object name 'dbo.Nope'."); } });
  assert.equal(await main(['sql', 'SELECT * FROM dbo.Nope'], { cwd, env, load: failing, ...f.io }), 1);
  assert.match(f.err.join('\n'), /Shop \(fake\): Invalid object name 'dbo\.Nope'\./);

  const g = io();
  const old = async () => ({ extract: async (): Promise<never> => { throw new Error('sql never extracts'); } });
  assert.equal(await main(['sql', 'SELECT 1'], { cwd, env, load: old, ...g.io }), 2);
  assert.match(g.err.join('\n'), /cannot run queries.*update/);
});

test('sql picks the one source with a reader, wants --source when several have one, and says so when none has', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Sales\n    connection: ${A}\n    reader: ${A_READER}\n  - type: fake\n    name: Stock\n    connection: ${B}\n    reader: ${B_READER}\n  - type: fake\n    name: Logs\n    connection: ${C}\n');
  const names: string[] = [];
  const load = async (source: { name: string }) => ({ extract: async (): Promise<never> => { throw new Error('sql never extracts'); }, run: async () => (names.push(source.name), { columns: ['n'], rows: [[1]], truncated: false, limit: 100 }) });
  const env = { A: 'a', A_READER: 'ar', B: 'b', B_READER: 'br', C: 'c' };
  const a = io();
  assert.equal(await main(['sql', 'SELECT 1'], { cwd, env, load, ...a.io }), 1);
  assert.match(a.err.join('\n'), /--source Sales or --source Stock/);
  const b = io();
  assert.equal(await main(['sql', 'SELECT 1', '--source', 'Stock'], { cwd, env, load, ...b.io }), 0);
  assert.deepEqual(names, ['Stock']);
  const c = io();
  assert.equal(await main(['sql', 'SELECT 1', '--source', 'Logs'], { cwd, env, load, ...c.io }), 2);
  assert.match(c.err.join('\n'), /Logs has no reader/);
  const d = io();
  assert.equal(await main(['sql', 'SELECT 1', '--source', 'Nope'], { cwd, env, load, ...d.io }), 1);
  assert.match(d.err.join('\n'), /no source named Nope: Sales, Stock, Logs/);
});

test('the review: two sources of one name are ambiguous, and sql refuses to guess which', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'sources:\n  - type: fake\n    name: Sales\n    connection: ${A}\n    reader: ${A_READER}\n  - type: fake\n    name: Sales\n    connection: ${B}\n    reader: ${B_READER}\n');
  let ran = false;
  const load = async () => ({ extract: async (): Promise<never> => { throw new Error('no'); }, run: async () => ((ran = true), { columns: [], rows: [], truncated: false, limit: 1 }) });
  const a = io();
  assert.equal(await main(['sql', 'SELECT 1', '--source', 'Sales'], { cwd, env: { A: 'a', A_READER: 'ar', B: 'b', B_READER: 'br' }, load, ...a.io }), 1);
  assert.match(a.err.join('\n'), /Two sources are named Sales: give each its own name in dbtour\.yaml/);
  assert.equal(ran, false);
});

test('serve serves the rendered folder, runs a query from its page through the reader, and wants a render first', async () => {
  const cwd = project();
  writeFileSync(join(cwd, 'dbtour.yaml'), 'out: docs\nsources:\n  - type: fake\n    name: Shop\n    connection: ${DBTOUR_FAKE}\n    reader: ${DBTOUR_FAKE_READER}\n');
  const env = { DBTOUR_FAKE: 'owner', DBTOUR_FAKE_READER: 'reader' };
  const none = io();
  assert.equal(await main(['serve', '--port', '0'], { cwd, env, ...none.io }), 2);
  assert.match(none.err.join('\n'), /No docs\/index\.html.*dbtour render/);

  mkdirSync(join(cwd, 'docs'), { recursive: true });
  writeFileSync(join(cwd, 'docs', 'index.html'), '<html><head></head><body></body></html>');
  const load = async () => ({ extract: async (): Promise<never> => { throw new Error('no'); }, run: async (config: { connection?: string }) => ({ columns: ['who'], rows: [[config.connection]], truncated: false, limit: 100 }) });
  let stop!: () => void;
  const a = io();
  const serving = main(['serve', '--port', '0'], { cwd, env, load, stop: new Promise<void>((done) => (stop = done)), ...a.io });
  for (let i = 0; i < 50 && !a.out.join('\n').includes('http://'); i++) await new Promise((r) => setTimeout(r, 20));
  const url = /http:\/\/127\.0\.0\.1:\d+/.exec(a.out.join('\n'))![0];
  assert.match(a.out.join('\n'), /Queries run through Shop's reader/);
  const html = await (await fetch(url)).text();
  const token = JSON.parse(/content="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"')).token as string;
  assert.ok(token.length >= 32, 'a fresh, long token each time');
  const answer = await fetch(`${url}/api/query`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': token }, body: JSON.stringify({ sql: 'SELECT 1', source: 'Shop' }) });
  assert.deepEqual(((await answer.json()) as { rows: unknown[][] }).rows, [['reader']], 'through the reader, not the extract\'s login');
  const refused = await fetch(`${url}/api/query`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': token }, body: JSON.stringify({ sql: 'DROP TABLE dbo.Orders' }) });
  assert.equal(refused.status, 422);
  stop();
  assert.equal(await serving, 0);
});
