import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  folderOf,
  nameProblem,
  newPassword,
  parseWorkspace,
  pickDatabase,
  readWorkspace,
  updateWorkspace,
  secretAccount,
  valueProblem,
  workspaceFile,
  workspaceHome,
  writeWorkspace,
  type Workspace,
} from '../src/workspace.ts';

const shop = { name: 'Shop', type: 'mssql', server: 'shop-sql.database.windows.net', database: 'Shop', signIn: 'az' } as const;
const logs = { name: 'Logs', type: 'mssql', server: 'localhost,1433', database: 'Logs', signIn: 'login', user: 'sa_reader' } as const;

test('the settings live in ~/.dbtour or DBTOUR_HOME, hold no secret, and are readable by their owner alone', () => {
  assert.equal(workspaceHome({}, '/Users/ann'), '/Users/ann/.dbtour');
  assert.equal(workspaceHome({ DBTOUR_HOME: '/tmp/x' }, '/Users/ann'), '/tmp/x');
  const home = join(mkdtempSync(join(tmpdir(), 'dbtour-home-')), 'nested');
  assert.deepEqual(readWorkspace(home), { databases: [] }, 'nothing set up yet');
  const workspace: Workspace = { databases: [shop, logs] };
  writeWorkspace(home, workspace);
  assert.deepEqual(readWorkspace(home), workspace);
  assert.equal(statSync(join(home, workspaceFile)).mode & 0o777, 0o600);
  assert.doesNotMatch(readFileSync(join(home, workspaceFile), 'utf8'), /password/i);
  assert.equal(folderOf('Shop'), join('databases', 'Shop'));
  assert.equal(secretAccount('Shop', 'reader'), 'Shop · reader');
});

test('a settings file that is not one says what to do, and a value that could break a connection string is refused', () => {
  assert.throws(() => parseWorkspace('{'), /is not JSON/);
  assert.throws(() => parseWorkspace('{}'), /no "databases" list/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{ ...shop, name: '../etc' }] })), /cannot name a database/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{ ...shop, signIn: 'magic' }] })), /not az or login/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{ ...shop, database: 'Shop;Password=x' }] })), /character dbtour does not accept/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{ ...logs, user: undefined }] })), /Give the login/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{ ...shop, reader: "x'" }] })), /reader/);
  assert.throws(() => parseWorkspace(JSON.stringify({ databases: [{}] })), /without a name/);
  const home = mkdtempSync(join(tmpdir(), 'dbtour-home-'));
  writeFileSync(join(home, workspaceFile), 'nope');
  assert.throws(() => readWorkspace(home), new RegExp(`${workspaceFile} is not JSON`));
  assert.equal(nameProblem('Shop_2'), undefined);
  assert.match(nameProblem('2Shop') ?? '', /starting with a letter/);
  assert.equal(valueProblem('server', 'tcp:shop.example.com,1433'), undefined);
  assert.match(valueProblem('server', '') ?? '', /Give the server/);
});

test('with several databases a command must name one; never the first by chance', () => {
  assert.throws(() => pickDatabase({ databases: [] }, undefined), (e: Error & { exitCode?: number }) => /No database is set up yet: run dbtour add/.test(e.message) && e.exitCode === 2);
  assert.equal(pickDatabase({ databases: [shop] }, undefined).name, 'Shop', 'the only one');
  assert.throws(() => pickDatabase({ databases: [shop, logs] }, undefined), /Several databases are set up: say which with --database Shop or --database Logs/);
  assert.equal(pickDatabase({ databases: [shop, logs] }, 'Logs').name, 'Logs');
  assert.throws(() => pickDatabase({ databases: [shop, logs] }, 'Billing'), /There is no database named Billing: Shop, Logs/);
});

test('a password dbtour makes meets SQL Server\'s complexity rule and is never the same twice', () => {
  const a = newPassword();
  assert.match(a, /^Aa1-[0-9a-f]{48}$/);
  assert.notEqual(a, newPassword());
});

test('a change is made to the settings as they are when it is written, never to a copy read before', () => {
  const home = mkdtempSync(join(tmpdir(), 'dbtour-update-'));
  const shop = { name: 'Shop', type: 'mssql', server: 's', database: 'Shop', signIn: 'az' as const };
  writeWorkspace(home, { databases: [shop] });
  const before = readWorkspace(home);
  writeWorkspace(home, { databases: [...before.databases, { ...shop, name: 'Logs' }] });
  updateWorkspace(home, (w) => ({ databases: w.databases.map((d) => (d.name === 'Shop' ? { ...d, reader: 'dbtour_reader' } : d)) }));
  assert.deepEqual(readWorkspace(home).databases.map((d) => [d.name, d.reader]), [['Shop', 'dbtour_reader'], ['Logs', undefined]]);
  assert.equal(existsSync(join(home, 'databases.json.lock')), false, 'the lock is let go');
  assert.throws(() => updateWorkspace(home, () => { throw new Error('Shop is set up already'); }), /set up already/);
  assert.equal(existsSync(join(home, 'databases.json.lock')), false, 'and let go when the change refuses');
  // Another dbtour holding the lock: waited for, then named, so a lock left by one that crashed can be removed.
  writeFileSync(join(home, 'databases.json.lock'), '');
  assert.throws(() => updateWorkspace(home, (w) => w, 30), /databases\.json\.lock[\s\S]*delete it/);
});
