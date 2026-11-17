import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentText, parseIndex, parseTable, parseTrigger, tokens, unquote } from '../src/parse.ts';

test('a name is read as SQLite reads it, in any of its quotes', () => {
  assert.deepEqual(['"a""b"', '`a``b`', '[a b]', 'plain'].map(unquote), ['a"b', 'a`b', 'a b', 'plain']);
  assert.deepEqual(tokens("x 'it''s' /* c */ -- d\ny").map((t) => t.kind), ['word', 'string', 'comment', 'comment', 'word']);
  assert.equal(tokens('a\nb')[1].newline, true);
  assert.equal(commentText('/*\n * One\n * two\n */'), 'One\ntwo');
});

test('a CREATE TABLE gives its comments as descriptions: the line a definition is on, else the next one', () => {
  const parsed = parseTable(`CREATE TABLE "Orders" ( -- One row per order a customer placed.
  id INTEGER PRIMARY KEY, -- Given by SQLite.
  -- The customer who placed it.
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  total REAL NOT NULL DEFAULT (0) CHECK (total >= 0), /* In pounds, VAT included. */
  email TEXT COLLATE NOCASE,
  twice REAL GENERATED ALWAYS AS (total * 2) STORED,
  note TEXT -- Free text.
  -- Still about note.
)`);
  assert.equal(parsed.description, 'One row per order a customer placed.');
  assert.equal(parsed.columns.get('id')?.description, 'Given by SQLite.');
  assert.equal(parsed.columns.get('customer_id')?.description, 'The customer who placed it.');
  assert.equal(parsed.columns.get('total')?.description, 'In pounds, VAT included.');
  assert.deepEqual(parsed.columns.get('total')?.checks, ['total >= 0']);
  assert.equal(parsed.columns.get('email')?.collation, 'NOCASE');
  assert.equal(parsed.columns.get('email')?.description, undefined);
  assert.equal(parsed.columns.get('twice')?.generated, 'total * 2');
  assert.equal(parsed.columns.get('note')?.description, 'Free text.\nStill about note.');
});

test('a CREATE TABLE gives the names and CHECKs of its own constraints', () => {
  const parsed = parseTable(`CREATE TABLE lines (
  order_id INTEGER, line INTEGER, sku TEXT, qty INTEGER,
  CONSTRAINT pk_lines PRIMARY KEY (order_id, line),
  CONSTRAINT uq_sku UNIQUE (order_id, "sku" COLLATE NOCASE),
  CONSTRAINT qty_positive CHECK (qty > 0 AND qty < (1000)),
  CHECK (line >= 1),
  FOREIGN KEY (order_id) REFERENCES orders (id)
) WITHOUT ROWID`);
  assert.equal(parsed.primaryName, 'pk_lines');
  assert.equal(parsed.uniqueNames.get('order_id,sku'), 'uq_sku');
  assert.deepEqual(parsed.checks, [{ name: 'qty_positive', definition: 'qty > 0 AND qty < (1000)' }, { definition: 'line >= 1' }]);
  assert.deepEqual([...parsed.columns.keys()], ['order_id', 'line', 'sku', 'qty']);
  assert.deepEqual(parseTable('CREATE TABLE copy AS SELECT * FROM lines').columns.size, 0);
});

test('an index gives its expressions and its WHERE, and a trigger when it runs', () => {
  assert.deepEqual(parseIndex('CREATE INDEX ix ON t (lower(email), id DESC) WHERE deleted IS NULL;'), { items: ['lower(email)', 'id DESC'], where: 'deleted IS NULL' });
  assert.deepEqual(parseIndex('CREATE INDEX ix ON t (a)'), { items: ['a'] });
  assert.deepEqual(parseTrigger('CREATE TRIGGER t AFTER UPDATE OF total ON orders BEGIN SELECT 1; END'), { timing: 'after', events: ['update'] });
  assert.deepEqual(parseTrigger('CREATE TRIGGER t INSTEAD OF DELETE ON v BEGIN SELECT 1; END'), { timing: 'instead of', events: ['delete'] });
  assert.deepEqual(parseTrigger('CREATE TRIGGER t INSERT ON orders BEGIN SELECT 1; END'), { timing: 'before', events: ['insert'] }, 'BEFORE, when it says neither');
});
