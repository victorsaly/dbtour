import { test } from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { bracket, connectionString, extraRoles, readerStatements } from '../src/setup.ts';

test('a connection string from where and how: az through Azure\'s default credential, a login with its password intact', () => {
  const az = connectionString({ server: 'shop-sql.database.windows.net', database: 'Shop', signIn: 'az' });
  assert.equal(az, 'Server="shop-sql.database.windows.net";Database="Shop";Encrypt=true;Authentication=Active Directory Integrated');
  const login = connectionString({ server: 'localhost,1433', database: 'Shop', signIn: 'login', user: 'ann', password: 'p;w"d' });
  // As the driver reads it: a ; or a quote in a password does not end it or add a setting.
  const parsed = sql.ConnectionPool.parseConnectionString(login) as { server: string; port: number; database: string; user: string; password: string };
  assert.deepEqual([parsed.server, parsed.port, parsed.database, parsed.user, parsed.password], ['localhost', 1433, 'Shop', 'ann', 'p;w"d']);
});

test('the reader\'s statements: a contained user with db_datareader alone, its password hidden when shown', () => {
  assert.deepEqual(readerStatements('dbtour_reader', false), [
    "CREATE USER [dbtour_reader] WITH PASSWORD = '••••••';",
    'ALTER ROLE db_datareader ADD MEMBER [dbtour_reader];',
  ]);
  assert.match(readerStatements('dbtour_reader', true, 'Aa1-x')[0], /^ALTER USER \[dbtour_reader\] WITH PASSWORD = 'Aa1-x';$/);
  assert.equal(bracket('odd]name'), '[odd]]name]');
  // Any role but db_datareader (and public, which every user has) could write.
  assert.deepEqual(extraRoles(['public', 'db_datareader']), []);
  assert.deepEqual(extraRoles(['db_datareader', 'db_owner']), ['db_owner']);
});
