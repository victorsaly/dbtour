import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceModuleName, loadSource, addonModuleName, loadAddon } from '../src/plugins.ts';

test('a source type maps to a package name unless a module is given', () => {
  assert.equal(sourceModuleName({ type: 'mssql', name: 'x' }), 'dbtour-source-mssql');
  assert.equal(sourceModuleName({ type: 'mssql', name: 'x', module: './my-source.ts' }), './my-source.ts');
});

test('loadSource returns the extract function, and says what to install when it is missing', async () => {
  const extract = async () => ({ name: 'x', driver: 'fake', schemas: [], relations: [] });
  const source = await loadSource({ type: 'fake', name: 'x' }, async () => ({ extract }));
  assert.equal(source.extract, extract);
  await assert.rejects(
    loadSource({ type: 'mssql', name: 'x' }, async () => { throw Object.assign(new Error('nope'), { code: 'ERR_MODULE_NOT_FOUND' }); }),
    /npm install dbtour-source-mssql/,
  );
  await assert.rejects(loadSource({ type: 'odd', name: 'x' }, async () => ({})), /does not export extract/);
});

test('an add-on type maps to a package name unless a module is given', () => {
  assert.equal(addonModuleName({ type: 'explorer' }), 'dbtour-addon-explorer');
  assert.equal(addonModuleName({ type: 'explorer', module: './page.ts' }), './page.ts');
});

test('loadAddon returns enrich and render when exported, and says what to install when missing', async () => {
  const render = () => ({ 'index.html': '<html>' });
  const addon = await loadAddon({ type: 'explorer' }, async () => ({ render }));
  assert.equal(addon.render, render);
  assert.equal(addon.enrich, undefined);
  await assert.rejects(loadAddon({ type: 'explorer' }, async () => { throw new Error('nope'); }), /npm install dbtour-addon-explorer/);
  await assert.rejects(loadAddon({ type: 'odd' }, async () => ({})), /enrich\(model\) or render\(model\)/);
});

test('a source that can be set up from dbtour offers all four setup functions, or none is used', async () => {
  const extract = async () => ({ name: 'x', driver: 'mssql', schemas: [], relations: [] });
  const fn = () => '';
  const full = await loadSource({ type: 'fake', name: 'x' }, async () => ({ extract, connectionString: fn, readerState: fn, readerStatements: fn, createReader: fn }));
  assert.deepEqual(Object.keys(full.setup ?? {}), ['connectionString', 'readerState', 'readerStatements', 'createReader']);
  const partial = await loadSource({ type: 'fake', name: 'x' }, async () => ({ extract, connectionString: fn }));
  assert.equal(partial.setup, undefined, 'half a setup is none');
});
