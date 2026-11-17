import { test } from 'node:test';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { bracket, connectionString, extraRoles, grantsQuery, readerStatements, rightsQuery, writeRights } from '../src/setup.ts';

test('a connection string from where and how: az through Azure\'s default credential, a login with its password intact', () => {
  const az = connectionString({ server: 'shop-sql.database.windows.net', database: 'Shop', signIn: 'az' });
  assert.equal(az, 'Server="shop-sql.database.windows.net";Database="Shop";Encrypt=true;Authentication=Active Directory Integrated');
  const login = connectionString({ server: 'localhost,1433', database: 'Shop', signIn: 'login', user: 'ann', password: 'p;w"d' });
  // As the driver reads it: a ; or a quote in a password does not end it or add a setting.
  const parsed = sql.ConnectionPool.parseConnectionString(login) as { server: string; port: number; database: string; user: string; password: string };
  assert.deepEqual([parsed.server, parsed.port, parsed.database, parsed.user, parsed.password], ['localhost', 1433, 'Shop', 'ann', 'p;w"d']);
});

test('a SQL Server on this machine has its own certificate trusted; one elsewhere has its certificate checked', () => {
  const at = (server: string) => sql.ConnectionPool.parseConnectionString(connectionString({ server, database: 'Shop', signIn: 'login', user: 'ann', password: 'pw' })) as { options: { trustServerCertificate?: boolean; encrypt?: boolean } };
  for (const local of ['localhost', 'localhost,14333', '127.0.0.1', '127.0.0.1,1433', '.', '(local)', '.\\SQLEXPRESS', 'LOCALHOST\\DEV', '::1']) {
    assert.equal(at(local).options.trustServerCertificate, true, `${local} is this machine: its self-signed certificate is trusted`);
    assert.equal(at(local).options.encrypt, true, 'and the connection is still encrypted');
  }
  for (const remote of ['shop-sql.database.windows.net', 'db.internal,1433', 'localhost.example.com', '10.0.0.5', '127.0.0.1.example']) {
    assert.notEqual(at(remote).options.trustServerCertificate, true, `${remote} is not this machine: its certificate is checked`);
  }
});

test('each part of the rights queries names its collation, so a contained database\'s catalogue can be read', () => {
  // A contained database's catalogue has a collation of its own; parts of a UNION in two collations are refused.
  for (const query of [grantsQuery, rightsQuery]) {
    const parts = query.split(/\bUNION(?: ALL)?\b/);
    for (const part of parts) assert.match(part, /^\s*SELECT [^,]*? COLLATE DATABASE_DEFAULT AS name\b|^\s*SELECT [^,]*? COLLATE DATABASE_DEFAULT\s+FROM/m, part);
  }
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

test('what a reader may not hold: any right to write, run code, change the schema or administer, or a schema of its own', () => {
  assert.deepEqual(writeRights(['CONNECT', 'SELECT', 'VIEW DEFINITION', 'SHOWPLAN', 'VIEW DATABASE STATE', 'REFERENCES']), []);
  assert.deepEqual(
    writeRights(['CONNECT', 'SELECT', 'UPDATE', 'INSERT', 'DELETE', 'EXECUTE', 'CONTROL', 'ALTER ANY SCHEMA', 'CREATE TABLE', 'TAKE OWNERSHIP', 'IMPERSONATE', 'OWNERSHIP OF SCHEMA dbo', 'UPDATE']),
    ['UPDATE', 'INSERT', 'DELETE', 'EXECUTE', 'CONTROL', 'ALTER ANY SCHEMA', 'CREATE TABLE', 'TAKE OWNERSHIP', 'IMPERSONATE', 'OWNERSHIP OF SCHEMA dbo'],
  );
});
