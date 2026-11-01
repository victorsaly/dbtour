// The SQL editor's check of names against the model, and where the description of a suggestion goes. The
// check runs on an EditorState CodeMirror has parsed, as the editor's linter does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Model } from 'dbtour/model';
import { infoPlacement, sqlSupport } from '../src/page/complete.ts';
import { unknownNames } from '../src/page/check.ts';

const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));

/** Each name the check marks: the text it underlines, what it says, and the fixes it offers. */
function check(doc: string, model = shop()) {
  const state = EditorState.create({ doc, extensions: [sqlSupport(model, 'Shop')] });
  ensureSyntaxTree(state, doc.length, 5000);
  return unknownNames(state).map((d) => ({ text: doc.slice(d.from, d.to), message: d.message, severity: d.severity, fixes: (d.actions ?? []).map((a) => a.name), diagnostic: d }));
}

test('a table the model does not have is marked, with the nearest it has', () => {
  const [nope] = check('SELECT * FROM dbo.Nope');
  assert.equal(nope.text, 'dbo.Nope');
  assert.equal(nope.severity, 'warning');
  assert.equal(nope.message, 'dbtour knows no table dbo.Nope in Shop: if it is new, run dbtour extract again.');
  assert.deepEqual(nope.fixes, []);
  const [typo] = check('SELECT * FROM dbo.Ordrs o');
  assert.equal(typo.message, 'dbtour knows no table dbo.Ordrs in Shop. Did you mean dbo.Orders? If it is new, run dbtour extract again.');
  assert.deepEqual(typo.fixes, ['dbo.Orders']);
  assert.equal(check('SELECT * FROM Ordrs')[0].text, 'Ordrs', 'a bare name, in the default schema');
  assert.deepEqual(check('SELECT * FROM Ordrs')[0].fixes, ['Orders'], 'the fix is written as the name was');
});

test('a column its table does not have is marked, the column alone', () => {
  const [totl] = check('SELECT o.Totl FROM dbo.Orders o');
  assert.equal(totl.text, 'Totl');
  assert.equal(totl.message, 'dbo.Orders has no column Totl in dbtour. Did you mean Total? If it is new, run dbtour extract again.');
  assert.deepEqual(totl.fixes, ['Total']);
  assert.equal(check('SELECT Orders.Nothing FROM dbo.Orders')[0].message, 'dbo.Orders has no column Nothing in dbtour: if it is new, run dbtour extract again.');
});

test('a fix writes the name it offers in place of the one marked', () => {
  const [typo] = check('SELECT o.Totl FROM dbo.Orders o');
  let sent: TransactionSpec | undefined;
  const view = { dispatch: (spec: TransactionSpec) => (sent = spec) } as unknown as EditorView;
  typo.diagnostic.actions![0].apply(view, typo.diagnostic.from, typo.diagnostic.to);
  assert.deepEqual(sent, { changes: { from: 9, to: 13, insert: 'Total' } });
});

test('nothing is marked that the model has, or that is not the model\'s to know', () => {
  const clean = [
    'SELECT o.Id, o.[Total], c.Email FROM [dbo].[Orders] o JOIN dbo.Customers AS c ON c.Id = o.CustomerId',
    'select O.TOTAL from DBO.ORDERS o',
    'SELECT o.* FROM dbo.Orders o',
    'WITH t AS (SELECT 1 AS a) SELECT t.a FROM t',
    'SELECT * FROM #t',
    'SELECT * FROM ##g',
    'SELECT * FROM @t',
    'SELECT * FROM sys.tables',
    'SELECT * FROM OtherDb.dbo.Anything',
    'SELECT f.x FROM dbo.fn(1) f',
    'SELECT x.Extra FROM (SELECT 1 AS Extra) x',
    "SELECT 'dbo.Nope' FROM dbo.Orders -- dbo.Nope",
    'SELECT * FROM Shop.dbo.Orders',
    'SELECT * FROM billing.Invoices i WHERE i.OrderId = 1',
    'SELECT * FROM [#t]',
    'SELECT * FROM [##g]',
    'WITH Orders AS (SELECT 1 AS Extra) SELECT o.Extra FROM Orders o',
    'SELECT Orders.Extra FROM (SELECT 1 AS Extra) Orders',
    'SELECT o.Total FROM dbo.Orders (NOLOCK) o',
    'SELECT o.Total FROM dbo.Orders o WITH (NOLOCK)',
  ];
  for (const sql of clean) assert.deepEqual(check(sql).map((c) => c.text), [], sql);
});

test('a subquery\'s alias hides the outer table of the same name when its columns are checked', () => {
  const sql = 'SELECT * FROM dbo.Orders x WHERE EXISTS (SELECT 1 FROM dbo.Customers x WHERE x.Email = 1 AND x.Total = 2)';
  assert.deepEqual(check(sql).map((c) => c.text), ['Total'], 'x is Customers in the subquery');
});

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

test('a suggestion\'s description goes beside the list when there is room, else under or over it, never on it', () => {
  const space = box(0, 0, 1280, 900);
  const list = box(100, 200, 400, 400);
  const option = box(100, 220, 400, 240);
  assert.deepEqual(infoPlacement(list, option, box(0, 0, 300, 60), space), { style: 'top: 20px; max-width: 400px', class: 'cm-completionInfo-right' });
  const phone = box(0, 0, 390, 844);
  const narrow = box(60, 300, 380, 460);
  const under = infoPlacement(narrow, box(60, 320, 380, 340), box(0, 0, 300, 40), phone);
  assert.deepEqual(under, { style: 'top: 160px; max-width: 320px', class: 'cm-completionInfo-under' }, 'under the whole list, as wide as it');
  const low = box(60, 700, 380, 830);
  assert.deepEqual(infoPlacement(low, box(60, 720, 380, 740), box(0, 0, 300, 40), phone), { style: 'bottom: 130px; max-width: 320px', class: 'cm-completionInfo-under' }, 'over it when there is no room below');
});

test('a table hint in parentheses is not a function: the table is still checked', () => {
  assert.deepEqual(check('SELECT * FROM dbo.Ordrs (NOLOCK)').map((c) => c.text), ['dbo.Ordrs']);
  assert.deepEqual(check('SELECT o.Totl FROM dbo.Orders (NOLOCK) o').map((c) => c.text), ['Totl']);
});

test('a fix quotes every part that needs it, and a "quoted" name is read with its doubled quotes as one', () => {
  const model = shop();
  const column = (name: string) => ({ name, type: 'int', nullable: false });
  model.databases[0].schemas.push({ name: 'Order Data', tables: [{ name: 'Invoices', kind: 'table', columns: [column('Id')], primaryKey: ['Id'], indexes: [], constraints: [] }] });
  assert.deepEqual(check('SELECT * FROM [Order Data].[Invoces]', model)[0].fixes, ['[Order Data].Invoices']);
  model.databases[0].schemas[0].tables.find((t) => t.name === 'Orders')!.columns.push(column('a"b'));
  assert.deepEqual(check('SELECT o."a""b" FROM dbo.Orders o', model), []);
});
