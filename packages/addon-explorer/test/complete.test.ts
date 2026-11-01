// What the SQL editor suggests, held to cases: a query with the caret at |, and what must come first. The
// sources run as the editor runs them, on an EditorState CodeMirror has parsed, and the options are ordered
// as CodeMirror orders them, so a case reads as what the reader sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CompletionContext, type Completion, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { scope, type Model } from 'dbtour/model';
import { sqlSupport } from '../src/page/complete.ts';
import { twoDatabases } from '../../core/test/fixtures/two.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));

interface Listed {
  label: string;
  apply: string;
  detail?: string;
}

/**
 * The list at the caret. Explicit is Ctrl+Space; without it, as when typing. The order is CodeMirror's: how
 * well the label matches what is typed, plus the option's boost, then the label. Only prefix matches are kept:
 * the fuzzy ones CodeMirror also lists come last there, and no case here rests on them.
 */
async function suggest(text: string, { explicit = false, model = shop(), database = 'Shop' } = {}): Promise<Listed[]> {
  const pos = text.indexOf('|');
  assert.ok(pos >= 0, 'a case marks the caret with |');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [sqlSupport(model, database)] });
  ensureSyntaxTree(state, doc.length, 5000);
  const context = new CompletionContext(state, pos, explicit);
  const sources = state.languageDataAt<CompletionSource>('autocomplete', pos);
  const results = (await Promise.all(sources.map((s) => s(context)))).filter((r): r is CompletionResult => Boolean(r));
  const scored: { option: Completion; score: number }[] = [];
  for (const result of results) {
    const typed = doc.slice(result.from, pos);
    for (const option of result.options) {
      const score = matchScore(typed, option.label);
      if (score !== null) scored.push({ option, score: score + (option.boost ?? 0) });
    }
  }
  const sorted = scored.sort((a, b) => b.score - a.score || (a.option.sortText ?? a.option.label).localeCompare(b.option.sortText ?? b.option.label));
  const listed: Listed[] = [];
  for (const { option } of sorted) {
    const apply = typeof option.apply === 'string' ? option.apply : option.label;
    const same = listed.find((l) => l.label === option.label && l.apply === apply && l.detail === option.detail);
    if (!same) listed.push({ label: option.label, apply, detail: option.detail });
  }
  return listed;
}

// CodeMirror's penalties: -100 when the label is longer than what is typed, -200 when only the case differs.
function matchScore(typed: string, label: string): number | null {
  if (!typed) return 0;
  const full = typed.length === label.length ? 0 : -100;
  if (label.startsWith(typed)) return full;
  if (label.toLowerCase().startsWith(typed.toLowerCase())) return full - 200;
  return null;
}

const applies = async (text: string, options?: Parameters<typeof suggest>[1]) => (await suggest(text, options)).map((s) => s.apply);

test('in the select list, the columns of the table the query reads come first, in the table\'s order', async () => {
  const top = (await applies('SELECT | FROM dbo.Orders', { explicit: true })).slice(0, 5);
  assert.deepEqual(top, ['Id', 'CustomerId', 'Status', 'CreatedAt', 'Total']);
  assert.equal((await applies('SELECT Cu| FROM dbo.Orders o'))[0], 'CustomerId', 'a column before CURRENT_USER');
  assert.equal((await applies('select | from DBO.orders', { explicit: true }))[0], 'Id', 'names compare without case, as T-SQL does');
  assert.equal((await applies('SELECT | FROM Orders', { explicit: true }))[0], 'Id', 'a bare table of the default schema');
  assert.equal((await applies('SELECT | FROM [dbo].[Orders]', { explicit: true }))[0], 'Id', 'bracketed names');
  assert.equal((await applies('SELECT | FROM Shop.dbo.Orders', { explicit: true }))[0], 'Id', 'the database named too');
});

test('with two tables in scope, a column is written with its table\'s alias, and a name both have is offered for each', async () => {
  const from = 'SELECT * FROM dbo.Orders o JOIN dbo.Customers AS c ON c.Id = o.CustomerId WHERE ';
  assert.equal((await applies(`${from}Em|`))[0], 'c.Email');
  const ids = (await suggest(`${from}I|`)).filter((s) => s.label === 'Id');
  assert.deepEqual(ids.map((s) => s.apply), ['o.Id', 'c.Id'], 'in the order the query names them');
  assert.match(ids[0].detail ?? '', /^o · int · primary key/, 'the alias says which table it is');
  const bare = await applies('SELECT * FROM dbo.Orders JOIN dbo.Customers ON Customers.Id = Orders.CustomerId WHERE Em|');
  assert.equal(bare[0], 'Customers.Email', 'a table without an alias is named by its own name');
});

test('after an alias and a dot, only that table\'s columns, also inside a subquery', async () => {
  const listed = await applies('SELECT * FROM (SELECT ol.| FROM dbo.OrderLines ol) x', { explicit: true });
  assert.deepEqual(listed, ['OrderId', 'ProductId', 'Quantity']);
  assert.deepEqual(await applies('SELECT o.Cu| FROM dbo.Orders o'), ['CustomerId']);
});

test('a subquery sees its own tables first, then its outer query\'s', async () => {
  const sql = 'SELECT * FROM dbo.Orders o WHERE EXISTS (SELECT 1 FROM dbo.OrderLines ol WHERE ol.OrderId = o.Id AND ';
  assert.equal((await applies(`${sql}Qu|)`))[0], 'ol.Quantity');
  assert.equal((await applies(`${sql}Tot|)`))[0], 'o.Total', 'a correlated column');
  const both = await applies(`${sql}|)`, { explicit: true });
  assert.ok(both.indexOf('ol.OrderId') < both.indexOf('o.Id'), 'its own before the outer query\'s');
});

test('statements are scoped apart, with or without a semicolon', async () => {
  assert.equal((await applies('SELECT * FROM dbo.Products\nSELECT | FROM dbo.Customers', { explicit: true }))[0], 'Id');
  const second = await applies('SELECT * FROM dbo.Products\nSELECT S| FROM dbo.Customers');
  assert.ok(!second.includes('Sku'), 'the first statement\'s table is not in the second\'s scope');
  assert.ok(!(await applies('SELECT * FROM dbo.Products; SELECT S| FROM dbo.Customers')).includes('Sku'));
  assert.equal((await applies('UPDATE dbo.Orders SET Sta|'))[0], 'Status', 'the table an UPDATE writes');
});

test('after ON, the conditions the declared keys give, the joined table first as a join writes it', async () => {
  const on = await applies('SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON |');
  assert.equal(on[0], 'c.Id = o.CustomerId', 'offered as ON is typed, without Ctrl+Space');
  const lines = await applies('SELECT * FROM dbo.OrderLines ol JOIN dbo.Orders o ON ol.OrderId = o.Id JOIN dbo.Products p ON |');
  assert.equal(lines[0], 'p.Id = ol.ProductId', 'to a table joined earlier, not only the one just before');
  assert.deepEqual(await applies('SELECT * FROM dbo.Orders o JOIN dbo.Products p ON |'), [], 'no key, no guess');
});

test('where a table belongs, tables and joins, not columns', async () => {
  const from = await applies('SELECT * FROM |', { explicit: true });
  assert.ok(!from.includes('CustomerId') && from.includes('Orders'));
  const join = await applies('SELECT * FROM dbo.Orders o JOIN |');
  assert.deepEqual(join.slice(0, 2), ['dbo.Customers AS c ON c.Id = o.CustomerId', 'dbo.OrderLines AS ol ON ol.OrderId = o.Id'], 'the joins first, what Orders points at before what points at it');
  assert.deepEqual(await applies('SELECT * FROM billing.|', { explicit: true }), ['Invoices'], 'a schema\'s tables');
});

test('nothing from the model inside a string or a comment, or for a table it does not know', async () => {
  assert.deepEqual(await applies("SELECT 'Cu|' FROM dbo.Orders"), []);
  assert.deepEqual(await applies('SELECT 1 -- Cu|\nFROM dbo.Orders'), []);
  const cte = await suggest('WITH t AS (SELECT 1 a) SELECT | FROM t', { explicit: true });
  assert.ok(!cte.some((s) => s.detail?.includes(' · int')), 'no columns guessed for a table outside the model');
});

test('in one of several databases, its own tables by their local names', async () => {
  const model = scope(twoDatabases());
  const listed = await applies('SELECT | FROM dbo.Invoices', { explicit: true, model, database: 'Sales' });
  const invoices = model.databases.find((d) => d.name === 'Sales')!.schemas[0].tables.find((t) => t.name === 'Invoices')!;
  assert.deepEqual(listed.slice(0, invoices.columns.length), invoices.columns.map((c) => c.name));
});

test('a comment between FROM, a table and its alias changes nothing', async () => {
  assert.equal((await applies('SELECT Cu| FROM /* source */ dbo.Orders o'))[0], 'CustomerId');
  assert.deepEqual(await applies('SELECT o.Cu| FROM dbo.Orders -- the orders\n o'), ['CustomerId']);
});

test('a subquery\'s alias hides the outer query\'s table of the same name', async () => {
  const listed = await applies('SELECT * FROM dbo.Orders x WHERE EXISTS (SELECT 1 FROM dbo.Customers x WHERE Tot|)');
  assert.ok(!listed.some((a) => /Total/.test(a)), 'x is Customers here, which has no Total');
  assert.deepEqual(await applies('SELECT * FROM dbo.Orders x WHERE EXISTS (SELECT 1 FROM dbo.Customers x WHERE x.|)', { explicit: true }), ['Id', 'Email', 'Name']);
});

test('after ON for a table the model does not know, or a derived one, no condition from an earlier join', async () => {
  const joined = 'SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId ';
  assert.deepEqual(await applies(`${joined}JOIN dbo.UnknownTable x ON |`), []);
  assert.deepEqual(await applies(`${joined}JOIN (SELECT 1 AS a) d ON |`), []);
});
