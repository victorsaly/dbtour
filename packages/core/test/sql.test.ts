import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuery, clampLimit, defaultLimit, formatCell, maxLimit, resultText, type QueryResult } from '../src/sql.ts';
import { resolveReader } from '../src/config.ts';

const refused = (sql: string): string => {
  const checked = checkQuery(sql);
  assert.equal(checked.ok, false, `expected "${sql}" to be refused`);
  return checked.ok ? '' : checked.reason;
};

test('a single SELECT or WITH is accepted, its trailing semicolon and comments set aside', () => {
  assert.deepEqual(checkQuery('SELECT TOP (10) Id FROM dbo.Orders;'), { ok: true, sql: 'SELECT TOP (10) Id FROM dbo.Orders' });
  assert.equal(checkQuery('  -- the paid ones\n  select Id from dbo.Orders where Status = 1').ok, true);
  assert.equal(checkQuery('/* a note */ WITH paid AS (SELECT Id FROM dbo.Orders WHERE Status = 1) SELECT COUNT(*) FROM paid').ok, true);
  // Words that write, inside a string, a bracketed name or a comment, are not statements.
  assert.equal(checkQuery("SELECT 'DROP TABLE x; DELETE' AS Said, [Update], \"Insert\" FROM dbo.Log -- delete me").ok, true);
  assert.equal(checkQuery("SELECT N'it''s; fine' AS Quote").ok, true);
});

test('anything but one read is refused, saying why and what to do', () => {
  assert.match(refused(''), /no query/i);
  assert.match(refused('-- only a comment'), /no query/i);
  assert.match(refused('UPDATE dbo.Orders SET Status = 1'), /starts with UPDATE: dbtour runs only a SELECT/);
  assert.match(refused('SELECT 1; SELECT 2'), /one statement/);
  assert.match(refused('SELECT 1; DROP TABLE dbo.Orders'), /one statement/);
  assert.match(refused('SELECT * INTO dbo.Copy FROM dbo.Orders'), /INTO/);
  assert.match(refused('WITH x AS (SELECT 1 AS a) DELETE FROM dbo.Orders'), /DELETE/);
  assert.match(refused("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')"), /OPENROWSET/);
  assert.match(refused('SELECT 1 EXEC sp_who'), /EXEC/);
  assert.match(refused("SELECT 'unclosed"), /string/);
  assert.match(refused('SELECT 1 /* unclosed'), /comment/);
  assert.match(refused('SELECT Delete FROM dbo.Log'), /\[Delete\]/, 'a column named like a statement is told to bracket it');
});

test('the row limit defaults, and is kept between one and the most a reply should carry', () => {
  assert.equal(clampLimit(undefined), defaultLimit);
  assert.equal(clampLimit(5), 5);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(1e9), maxLimit);
  assert.equal(clampLimit(Number.NaN), defaultLimit);
});

test('cells read as text: NULL, dates as ISO, bytes as hex, long text cut, line breaks kept on one line', () => {
  assert.equal(formatCell(null), 'NULL');
  assert.equal(formatCell(undefined), 'NULL');
  assert.equal(formatCell(new Date('2026-11-01T09:30:00Z')), '2026-11-01T09:30:00.000Z');
  assert.equal(formatCell(Uint8Array.from([0, 171, 255])), '0x00abff');
  assert.equal(formatCell(true), 'true');
  assert.equal(formatCell(12.5), '12.5');
  assert.equal(formatCell('a\nb|c'), 'a↵b\\|c');
  assert.equal(formatCell('x'.repeat(300)).length, 201);
});

test('a result reads as a table with a line saying how many rows, and that the limit stopped it', () => {
  const result: QueryResult = { columns: ['Id', 'Name'], rows: [[1, 'Ann'], [2, null]], truncated: false, limit: 100 };
  assert.equal(resultText(result), '| Id | Name |\n|---|---|\n| 1 | Ann |\n| 2 | NULL |\n\n2 rows.');
  assert.match(resultText({ ...result, truncated: true, limit: 2 }), /The first 2 rows: the limit stopped it\. Narrow the query, or raise the limit\.$/);
  assert.equal(resultText({ columns: ['Id'], rows: [], truncated: false, limit: 100 }), '| Id |\n|---|\n\nNo rows.');
  assert.equal(resultText({ columns: ['Id'], rows: [[1]], truncated: false, limit: 100 }).endsWith('1 row.'), true);
});

test('the reader is a login of its own: required to run, never the extract\'s connection', () => {
  const source = { type: 'mssql', name: 'Shop', connection: '${DBTOUR_MSSQL}', reader: '${DBTOUR_MSSQL_READER}' };
  assert.equal(resolveReader(source, { DBTOUR_MSSQL: 'Server=x;User Id=owner', DBTOUR_MSSQL_READER: 'Server=x;User Id=reader' }), 'Server=x;User Id=reader');
  const missing = (() => {
    try {
      resolveReader({ ...source, reader: undefined }, {});
    } catch (error) {
      return error as Error & { exitCode?: number };
    }
  })();
  assert.match(missing!.message, /no reader.*reader: \$\{DBTOUR_MSSQL_READER\}.*db_datareader/);
  assert.equal(missing!.exitCode, 2);
  assert.throws(() => resolveReader({ ...source, reader: '${DBTOUR_MSSQL}' }, { DBTOUR_MSSQL: 'Server=x' }), /same variable as connection/);
  assert.throws(() => resolveReader(source, { DBTOUR_MSSQL: 'Server=x', DBTOUR_MSSQL_READER: 'Server=x' }), /same connection string as connection/);
  assert.throws(() => resolveReader({ ...source, reader: 'Server=x;Password=y' }, {}), /environment variable/);
  assert.throws(() => resolveReader(source, { DBTOUR_MSSQL: 'Server=x' }), /Set DBTOUR_MSSQL_READER/);
});

test('the review: statements without semicolons, a comment ended by a carriage return, transactions, sequences, no words', () => {
  // T-SQL needs no semicolon between statements: a second top-level SELECT, or COMMIT, starts another.
  assert.match(refused('SELECT 1 COMMIT TRANSACTION SELECT 2'), /COMMIT/);
  assert.match(refused('SELECT 1 SELECT 2'), /second SELECT/);
  assert.match(refused('SELECT Id FROM dbo.Orders BEGIN TRAN'), /BEGIN/);
  // A carriage return ends a -- comment as a line feed does.
  assert.match(refused('SELECT 1 -- note\rDELETE FROM dbo.Orders\rCOMMIT TRANSACTION'), /DELETE/);
  // A sequence moves on even when the transaction is rolled back; FETCH NEXT, for paging, is a read.
  assert.match(refused('SELECT NEXT VALUE FOR dbo.OrderSequence'), /NEXT VALUE FOR.*sequence/);
  assert.equal(checkQuery('SELECT Id FROM dbo.Orders ORDER BY Id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY').ok, true);
  // What reads as one query still passes: unions, subqueries, CTEs.
  assert.equal(checkQuery('SELECT 1 UNION ALL SELECT 2 EXCEPT SELECT 3 INTERSECT SELECT 4').ok, true);
  assert.equal(checkQuery('(SELECT 1) UNION (SELECT 2)').ok, true);
  assert.equal(checkQuery('WITH a AS (SELECT 1 AS n), b AS (SELECT n FROM a) SELECT n, (SELECT COUNT(*) FROM a) FROM b').ok, true);
  // Something that is not a query at all is refused, not thrown.
  assert.match(refused(';'), /no query/i);
  assert.match(refused('123'), /starts with 123|no query/i);
});

test('the review: a result the byte budget stopped says so, and how to fix it', () => {
  const text = resultText({ columns: ['Doc'], rows: [['x']], truncated: true, limit: 100, reason: 'size' });
  assert.match(text, /The first 1 row: they came to more than 10 MB\. Select fewer or narrower columns\.$/);
});
