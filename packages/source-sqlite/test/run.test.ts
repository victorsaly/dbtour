import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/index.ts';
import { DatabaseSync } from '../src/sqlite.ts';
import { shop } from './extract.test.ts';

const options = { limit: 100, timeoutMs: 10_000 };

test('run answers with columns and rows as arrays, stopping one past the limit', async () => {
  const config = { type: 'sqlite', name: 'Shop', ...shop() };
  const result = await run(config, 'SELECT id, email, id AS id FROM customers ORDER BY id', options);
  assert.deepEqual(result, { columns: ['id', 'email', 'id'], rows: [[1, 'ada@example.com', 1], [2, 'alan@example.com', 2]], truncated: false, limit: 100 }, 'two columns of one name both kept');
  const limited = await run(config, 'SELECT id FROM orders ORDER BY id', { ...options, limit: 2 });
  assert.deepEqual([limited.rows, limited.truncated, limited.reason], [[[1], [2]], true, 'limit']);
});

test('run opens the file read-only: a write is refused by SQLite itself, and the file is as it was', async () => {
  const config = { type: 'sqlite', name: 'Shop', ...shop() };
  const file = join(config.root, config.file);
  const before = readFileSync(file);
  // core's check would refuse these first; the source must refuse them on its own too.
  await assert.rejects(run(config, "INSERT INTO customers (email) VALUES ('eve@example.com')", options), /readonly|read-only/i);
  await assert.rejects(run(config, 'DELETE FROM orders RETURNING id', options), /readonly|read-only/i);
  await assert.rejects(run(config, "ATTACH 'other.db' AS other", options), /unable to open|readonly|read-only/i);
  await assert.rejects(run(config, 'SELECT * FROM nope', options), /no such table: nope/);
  assert.deepEqual(readFileSync(file), before);
  const db = new DatabaseSync(file, { readOnly: true });
  assert.deepEqual({ ...(db.prepare('SELECT count(*) AS n FROM customers').get() as object) }, { n: 2 });
  db.close();
});

test('run cancels a query that runs past the timeout, and says what to do', async () => {
  const config = { type: 'sqlite', name: 'Shop', ...shop() };
  const forever = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n';
  const started = Date.now();
  await assert.rejects(run(config, forever, { limit: 10, timeoutMs: 300 }), /ran past 0\.3 seconds and was cancelled: .*LIMIT/);
  assert.ok(Date.now() - started < 5000, 'answered at the timeout, not when SQLite gave up');
});
