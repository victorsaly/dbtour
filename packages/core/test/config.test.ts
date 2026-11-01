import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, resolveConnection, defaultConfigText } from '../src/config.ts';

test('parseConfig fills the defaults and keeps the sources', () => {
  const config = parseConfig(`
sources:
  - type: mssql
    name: Shop
    connection: \${DBTOUR_MSSQL}
`);
  assert.equal(config.out, 'docs/dbtour');
  assert.equal(config.notes, 'dbtour.notes.yaml');
  assert.deepEqual(config.sources, [{ type: 'mssql', name: 'Shop', connection: '${DBTOUR_MSSQL}' }]);
});

test('parseConfig says what is missing', () => {
  assert.throws(() => parseConfig(''), /sources/);
  assert.throws(() => parseConfig('sources:\n  - name: x'), /sources\[0\]\.type/);
  assert.throws(() => parseConfig('sources:\n  - type: mssql'), /sources\[0\]\.name/);
});

test('the default config parses and names an environment variable', () => {
  const config = parseConfig(defaultConfigText('mssql'));
  assert.equal(config.sources[0].type, 'mssql');
  assert.match(String(config.sources[0].connection), /^\$\{DBTOUR_MSSQL\}$/);
});

test('resolveConnection reads the named environment variable and refuses a literal', () => {
  assert.equal(resolveConnection('${DBTOUR_MSSQL}', { DBTOUR_MSSQL: 'Server=x' }), 'Server=x');
  assert.throws(() => resolveConnection('${DBTOUR_MSSQL}', {}), /DBTOUR_MSSQL/);
  assert.throws(() => resolveConnection('Server=x;Password=y', { DBTOUR_MSSQL: 'Server=x' }), /environment variable/);
  assert.equal(resolveConnection(undefined, {}), undefined);
});

test('addons are a list of names or maps, default to none, and the default config asks for the explorer', () => {
  assert.deepEqual(parseConfig('sources:\n  - type: mssql\n    name: Shop\n').addons, []);
  const config = parseConfig('sources:\n  - type: mssql\n    name: Shop\naddons:\n  - explorer\n  - type: lint\n    module: ./lint.ts\n');
  assert.deepEqual(config.addons, [{ type: 'explorer' }, { type: 'lint', module: './lint.ts' }]);
  assert.throws(() => parseConfig('sources:\n  - type: mssql\n    name: Shop\naddons: explorer\n'), /addons must be a list/);
  assert.throws(() => parseConfig('sources:\n  - type: mssql\n    name: Shop\naddons:\n  - module: x\n'), /addons\[0\]\.type/);
  assert.deepEqual(parseConfig(defaultConfigText('mssql')).addons, [{ type: 'explorer' }]);
});
