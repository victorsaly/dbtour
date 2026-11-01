import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceModuleName, loadSource } from '../src/plugins.ts';

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
