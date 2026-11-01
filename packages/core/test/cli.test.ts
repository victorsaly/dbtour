import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.ts';
import type { Model } from '../src/model.ts';

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
