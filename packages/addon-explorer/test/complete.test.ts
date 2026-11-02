// What the SQL editor suggests, held to cases: a query with the caret at |, and what must come first. The
// sources run as the editor runs them, on an EditorState CodeMirror has parsed, and the options are ordered
// as CodeMirror orders them, so a case reads as what the reader sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Completion } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { scope } from 'dbtour/model';
import { expandStar, pickOf, snippets, sqlSupport } from '../src/page/complete.ts';
import { formatQuery } from '../src/page/format.ts';
import { describe } from '../../core/test/fixtures/described.ts';
import { twoDatabases } from '../../core/test/fixtures/two.ts';
import { applies, shop, suggest } from './suggest.ts';

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
  assert.ok(!from.includes('CustomerId') && from.includes('dbo.Orders AS o'));
  assert.ok(from.indexOf('dbo.Products AS p') < from.indexOf('billing'), 'the tables, then the schemas');
  const join = await applies('SELECT * FROM dbo.Orders o JOIN |');
  assert.deepEqual(join.slice(0, 2), ['dbo.Customers AS c ON c.Id = o.CustomerId', 'dbo.OrderLines AS ol ON ol.OrderId = o.Id'], 'the joins first, what Orders points at before what points at it');
  assert.deepEqual(await applies('SELECT * FROM billing.|', { explicit: true }), ['Invoices AS i'], 'a schema\'s tables');
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

/** The query once Tab has expanded the * before the caret, or null when Tab would leave the editor. */
function tab(text: string, model = describe(shop())): string | null {
  const pos = text.indexOf('|');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [sqlSupport(model, 'Shop')] });
  ensureSyntaxTree(state, doc.length, 5000);
  const spec = expandStar(state);
  return spec ? state.update(spec).state.doc.toString() : null;
}

test('Tab after * in the select list writes the columns, the protected ones left out as a starter leaves them', () => {
  assert.equal(tab('SELECT *| FROM dbo.Customers'), 'SELECT Id, Email, Name FROM dbo.Customers');
  assert.equal(
    tab('SELECT *| FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId'),
    'SELECT o.Id, o.CustomerId, o.Total, c.Id, c.Email, c.Name FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId',
    'Orders\' Status and CreatedAt are masked or encrypted in the described model',
  );
  assert.equal(tab('SELECT c.*| FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId'), 'SELECT c.Id, c.Email, c.Name FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId');
  assert.equal(tab('SELECT TOP (10) *| FROM dbo.Products'), 'SELECT TOP (10) Id, Sku, Price FROM dbo.Products');
  assert.equal(tab('SELECT COUNT(*|) FROM dbo.Products'), null, 'COUNT(*) is not a column list');
  assert.equal(tab('SELECT Price *| 2 FROM dbo.Products'), null, 'a product is not a column list');
  assert.equal(tab('SELECT *| FROM dbo.Nope'), null, 'nothing known to write');
  assert.equal(tab('SELECT Id| FROM dbo.Products'), null, 'Tab leaves the editor anywhere else');
});

test('Ctrl+Space after * offers both: without the protected columns, and every column', async () => {
  const listed = await suggest('SELECT *| FROM dbo.Orders', { explicit: true, model: describe(shop()) });
  assert.deepEqual(listed.slice(0, 2).map((s) => s.apply), ['Id, CustomerId, Total', 'Id, CustomerId, Status, CreatedAt, Total']);
  assert.match(listed[0].detail ?? '', /leaves out Status, CreatedAt/);
  assert.deepEqual(await suggest('SELECT *| FROM dbo.Orders'), [], 'not while typing: Enter after * stays a new line');
});

test('a table after FROM or JOIN is written with an alias, one the query has not taken', async () => {
  assert.equal((await applies('SELECT * FROM Cust|'))[0], 'dbo.Customers AS c');
  assert.equal((await applies('SELECT * FROM dbo.Prod|'))[0], 'Products AS p', 'after the schema, the table alone');
  const join = await applies('SELECT * FROM dbo.Orders o JOIN dbo.OrderL|');
  assert.deepEqual(join.slice(0, 2), ['dbo.OrderLines AS ol ON ol.OrderId = o.Id', 'OrderLines AS ol'], 'the join with its ON first, then the table alone');
  assert.ok((await applies('SELECT * FROM dbo.Orders o JOIN dbo.Products p ON 1 = 1 JOIN Ord|')).includes('dbo.Orders AS o2'), 'o is taken');
  assert.equal((await applies('SELECT * FROM dbo.Products p, Cust|'))[0], 'dbo.Customers AS c', 'after a comma in FROM');
  assert.ok(!(await applies('SELECT * FROM dbo.Orders o|')).some((a) => / AS /.test(a)), 'no table where the alias goes');
  assert.ok(!(await applies('UPDATE Ord|')).includes('dbo.Orders AS o'), 'UPDATE takes no alias');
});

test('snippets write the start of a read: whole names lead, a part does not', async () => {
  assert.deepEqual(await applies('ssf|'), ['SELECT * FROM ']);
  assert.equal((await applies('st100|'))[0], 'SELECT TOP (100) * FROM ');
  assert.equal((await applies('scf|'))[0], 'SELECT COUNT(*) FROM ');
  assert.notEqual((await suggest('S|', { explicit: true }))[0]?.label, 'ssf', 'a letter is not a snippet\'s name');
  assert.ok(!(await applies('SELECT * FROM dbo.Orders o WHERE o.ss|')).includes('SELECT * FROM '), 'not after a dot');
  for (const s of snippets) assert.match(s.template, /^(SELECT|WITH|WHERE)\b/, `${s.name} writes a read, as dbtour sql runs only reads`);
  assert.deepEqual(pickOf({ label: 'ssf', key: 'snippet:ssf', reopen: true } as Completion), { key: 'snippet:ssf', reopen: true }, 'the table list opens after it');
  assert.deepEqual(pickOf({ label: 'SELECT' }), { key: undefined, reopen: false }, 'a keyword is not counted');
});

test('what was picked before comes first among equals, never above a better match', async () => {
  const used = { 'column:dbo.Orders.Total': 5 };
  const top = await suggest('SELECT | FROM dbo.Orders', { explicit: true, used });
  assert.equal(top[0].apply, 'Total');
  assert.equal((await applies('SELECT Cu| FROM dbo.Orders', { used }))[0], 'CustomerId', 'Total does not match Cu');
  const tables = await applies('SELECT * FROM |', { explicit: true, used: { 'table:dbo.Products': 3 } });
  assert.equal(tables[0], 'dbo.Products AS p');
});

test('Format lays a query out in T-SQL, upper-case keywords and its comments kept, and leaves one it cannot read', () => {
  assert.equal(formatQuery('select o.Id,c.[Name] from dbo.Orders o join dbo.Customers c on c.Id=o.CustomerId -- who\nwhere o.Total>10'),
    'SELECT\n  o.Id,\n  c.[Name]\nFROM\n  dbo.Orders o\n  JOIN dbo.Customers c ON c.Id = o.CustomerId -- who\nWHERE\n  o.Total > 10');
  assert.equal(formatQuery('SELECT "unclosed'), null);
});

test('a bracketed table name is completed by CodeMirror\'s own schema completion, which quotes', async () => {
  assert.ok((await applies('SELECT * FROM [Ord|')).includes('[Orders]'));
});

test('a table that has its alias already is written without another', async () => {
  assert.equal((await applies('SELECT c.Id FROM Cust| AS c'))[0], 'dbo.Customers');
  assert.equal((await applies('SELECT c.Id FROM dbo.Cust| c'))[0], 'Customers');
});

test('Tab writes no * that would lose or expose columns', () => {
  const derived = 'FROM dbo.Products p CROSS JOIN (SELECT 1 AS Extra) x';
  assert.equal(tab(`SELECT *| ${derived}`), null, 'Extra is not in the model: written out, it would be lost');
  assert.equal(tab(`SELECT p.*| ${derived}`), `SELECT p.Id, p.Sku, p.Price ${derived}`, 'p.* covers Products alone');
  const locked = describe(shop());
  for (const c of locked.databases[0].schemas[0].tables.find((t) => t.name === 'Products')!.columns) c.masked = 'default()';
  assert.equal(tab('SELECT *| FROM dbo.Products', locked), null, 'every column protected: Tab writes none of them');
});

test('Ctrl+Space after * when every column is protected offers every column, said so', async () => {
  const locked = describe(shop());
  for (const c of locked.databases[0].schemas[0].tables.find((t) => t.name === 'Products')!.columns) c.masked = 'default()';
  const listed = await suggest('SELECT *| FROM dbo.Products', { explicit: true, model: locked });
  assert.equal(listed[0].apply, 'Id, Sku, Price');
  assert.match(listed[0].detail ?? '', /every column, masked/);
});

/** Whether a suggestion is one of CodeMirror's SQL keywords or built-ins: upper-case words, as it writes them. */
const isKeyword = (label: string) => /^[A-Z][A-Z0-9_]*$/.test(label);

test('where a table goes, only tables, their schemas and the query\'s CTEs, the list open as the space is typed', async () => {
  const listed = await suggest('SELECT Id FROM |');
  assert.ok(listed.length > 0, 'open without Ctrl+Space');
  assert.deepEqual(listed.filter((s) => isKeyword(s.label)).map((s) => s.label), [], 'no keyword or function');
  assert.deepEqual((await applies('SELECT * FROM Cust|')).filter(isKeyword), [], 'nor as a name is typed');
  assert.ok((await applies('WITH recent AS (SELECT 1 AS a) SELECT * FROM rec|')).includes('recent AS r'), 'a CTE the query defines');
});

test('the columns the select list names put the tables that have them first', async () => {
  assert.equal((await applies('SELECT Email FROM |'))[0], 'dbo.Customers AS c');
  assert.equal((await applies('SELECT Sku, Price FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT p.Sku AS code, Price FROM |'))[0], 'dbo.Products AS p', 'a qualified column counts, a column alias does not');
  assert.equal((await applies('SELECT Quantity FROM Ord|'))[0], 'dbo.OrderLines AS ol', 'among the tables a typed name matches');
});

test('after a table and its alias, only what can follow it, ON first after a join', async () => {
  const where = await applies('SELECT * FROM dbo.Orders o W|');
  assert.equal(where[0], 'WHERE');
  assert.ok(!where.includes('WAITFOR') && !where.includes('WHILE'), 'no statement keyword');
  const next = await applies('SELECT * FROM dbo.Orders o |', { explicit: true });
  assert.ok(!next.some((a) => /Orders|Customers/.test(a)), 'no table where the alias or a clause goes');
  assert.ok(next.includes('JOIN') && next.includes('ORDER'));
  assert.equal((await applies('SELECT * FROM dbo.Orders o JOIN dbo.Customers c |', { explicit: true }))[0], 'ON');
});

test('a table hint after a table keeps it known: its columns, its alias, and * expanded', async () => {
  assert.equal((await applies('SELECT | FROM dbo.Orders (NOLOCK)', { explicit: true }))[0], 'Id');
  assert.deepEqual(await applies('SELECT o.Cu| FROM dbo.Orders (NOLOCK) o'), ['CustomerId']);
  assert.equal(tab('SELECT *| FROM dbo.Products (NOLOCK)'), 'SELECT Id, Sku, Price FROM dbo.Products (NOLOCK)');
});

test('a CTE named like a model table is the CTE: none of the table\'s columns', async () => {
  const listed = await applies('WITH Orders AS (SELECT 1 AS Extra) SELECT | FROM Orders', { explicit: true });
  assert.ok(!listed.includes('CustomerId'));
});

test('* expands to what SELECT * returns: no hidden column, every table in FROM, and the SQL still reads', async () => {
  const hidden = describe(shop());
  hidden.databases[0].schemas[0].tables.find((t) => t.name === 'Products')!.columns.find((c) => c.name === 'Price')!.hidden = true;
  assert.equal(tab('SELECT *| FROM dbo.Products', hidden), 'SELECT Id, Sku FROM dbo.Products', 'SQL Server leaves a hidden column out of *');
  const listed = await suggest('SELECT *| FROM dbo.Products', { explicit: true, model: hidden });
  assert.deepEqual(listed.filter((s) => s.label === '*').map((s) => s.apply), ['Id, Sku']);
  const comma = 'FROM dbo.Products p JOIN dbo.OrderLines ol ON ol.ProductId = p.Id, dbo.Customers c';
  assert.equal(tab(`SELECT *| ${comma}`), `SELECT p.Id, p.Sku, p.Price, ol.OrderId, ol.ProductId, ol.Quantity, c.Id, c.Email, c.Name ${comma}`, 'a table after a comma that follows ON');
  assert.equal(tab('SELECT*| FROM dbo.Products'), 'SELECT Id, Sku, Price FROM dbo.Products', 'a space after SELECT when * had none');
  assert.equal(tab('SELECT DISTINCT*| FROM dbo.Products'), 'SELECT DISTINCT Id, Sku, Price FROM dbo.Products');
  assert.equal(tab('WITH Products AS (SELECT 1 AS Extra) SELECT *| FROM Products'), null, 'a CTE named like a table is not that table');
  assert.equal(tab('WITH Products AS (SELECT 1 AS Extra) SELECT p.*| FROM Products p'), null);
});

test('a space after the schema\'s dot is still the schema: the table is written once', async () => {
  assert.equal((await applies('SELECT * FROM dbo. Cust|'))[0], 'Customers AS c');
});

test('a CTE is offered, and stands for its name, only in its own statement', async () => {
  assert.ok((await applies('WITH Orders AS (SELECT 1 AS Extra) SELECT * FROM Orders; SELECT | FROM Orders', { explicit: true })).includes('CustomerId'));
  assert.ok(!(await applies('WITH recent AS (SELECT 1 AS a) SELECT 1; SELECT * FROM rec|')).includes('recent AS r'));
  assert.ok((await applies('WITH recent AS (SELECT 1 AS a) SELECT a FROM recent UNION SELECT a FROM rec|')).includes('recent AS r'));
});

test('a column\'s alias, with AS, without it or as alias = expression, does not rank the tables', async () => {
  assert.equal((await applies('SELECT Price Email FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT Email = Price FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT p.Price Email, Sku FROM |'))[0], 'dbo.Products AS p');
});

test('DISTINCT, ALL and TOP before the first column do not hide it from the ranking', async () => {
  assert.equal((await applies('SELECT DISTINCT Price FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT ALL Price FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT TOP (100) Price FROM |'))[0], 'dbo.Products AS p');
  assert.equal((await applies('SELECT TOP 10 PERCENT WITH TIES Price FROM |'))[0], 'dbo.Products AS p');
});

test('a CTE\'s columns are the names its select list gives, after its name and a dot or bare', async () => {
  assert.deepEqual(await applies('WITH r AS (SELECT o.Id, o.Total AS amount, 1 FROM dbo.Orders o) SELECT r.| FROM r', { explicit: true }), ['Id', 'amount'], 'an unnamed expression gives no column');
  assert.deepEqual(await applies('WITH r (a, b) AS (SELECT Id, Total FROM dbo.Orders) SELECT r.| FROM r', { explicit: true }), ['a', 'b'], 'the names after its own name rename them');
  assert.deepEqual(await applies('WITH r AS (SELECT * FROM dbo.Customers) SELECT r.| FROM r', { explicit: true }), ['Id', 'Email', 'Name'], '* is the table\'s columns');
  assert.deepEqual(await applies('WITH r AS (SELECT c.*, 1 AS one FROM dbo.Customers c) SELECT r.| FROM r', { explicit: true }), ['Id', 'Email', 'Name', 'one']);
  assert.deepEqual(await applies('WITH a AS (SELECT Id FROM dbo.Orders), b AS (SELECT a.Id AS OrderId FROM a) SELECT b.| FROM b', { explicit: true }), ['OrderId'], 'one CTE read from another');
  assert.deepEqual(await applies('WITH r AS (SELECT * FROM r) SELECT r.| FROM r', { explicit: true }), [], 'one that reads only itself has none');
  assert.equal((await applies('WITH r AS (SELECT Email FROM dbo.Customers) SELECT | FROM r', { explicit: true }))[0], 'Email');
});

test('a CTE\'s column says what it is: the column it reads, or what it is called', async () => {
  const [id, amount] = await suggest('WITH r AS (SELECT o.Id, SUM(o.Total) AS amount FROM dbo.Orders o GROUP BY o.Id) SELECT r.| FROM r', { explicit: true });
  assert.equal(id.detail, 'int · primary key');
  assert.equal(amount.detail, 'CTE column');
});

test('a subquery in FROM has the columns its select list gives', async () => {
  assert.deepEqual(await applies('SELECT x.| FROM (SELECT Id, Email AS mail FROM dbo.Customers) x', { explicit: true }), ['Id', 'mail']);
  const both = await applies('SELECT ma| FROM (SELECT Email AS mail FROM dbo.Customers) x JOIN dbo.Orders o ON o.CustomerId = x.Id');
  assert.equal(both[0], 'x.mail', 'written with its alias, as another table is in scope');
});

test('after GROUP BY, what the select list does not aggregate, written out', async () => {
  const two = 'FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId';
  assert.equal((await applies(`SELECT c.Email, o.Status, SUM(o.Total) AS spent, COUNT(*) ${two} GROUP BY |`))[0], 'c.Email, o.Status');
  assert.equal((await applies('SELECT YEAR(CreatedAt), COUNT(*) FROM dbo.Orders GROUP BY |'))[0], 'YEAR(CreatedAt)', 'an expression as written');
  assert.equal((await applies('SELECT Status, ISNULL(SUM(Total), 0) FROM dbo.Orders GROUP BY |'))[0], 'Status', 'an aggregate inside another call');
  assert.equal((await applies('SELECT Status, ROW_NUMBER() OVER (ORDER BY Id) FROM dbo.Orders GROUP BY |'))[0], undefined, 'nothing aggregated: no list to write');
  assert.deepEqual(await applies('SELECT Status, 1, COUNT(*) FROM dbo.Orders GROUP BY |'), ['Status'], 'a constant is not grouped by');
  assert.deepEqual(await applies('SELECT Status, COUNT(*) FROM dbo.Orders GROUP BY Status, |'), [], 'only where the list starts');
  assert.equal((await applies('SELECT Status, COUNT(*) FROM dbo.Orders GROUP BY Cr|'))[0], 'CreatedAt', 'a column typed is still offered');
});

test('in GROUP BY and ORDER BY, what the select list names comes first; in ORDER BY its aliases before those', async () => {
  assert.deepEqual((await applies('SELECT Name, Email FROM dbo.Customers ORDER BY |', { explicit: true })).slice(0, 3), ['Name', 'Email', 'Id']);
  assert.deepEqual((await applies('SELECT CustomerId, SUM(Total) AS spent FROM dbo.Orders GROUP BY CustomerId ORDER BY |', { explicit: true })).slice(0, 2), ['spent', 'CustomerId']);
  assert.equal((await applies('SELECT Email AS mail FROM dbo.Customers ORDER BY m|'))[0], 'mail');
  assert.equal((await applies('SELECT [order total] = SUM(Total) FROM dbo.Orders ORDER BY |', { explicit: true }))[0], '[order total]', 'quoted as it must be');
  assert.ok(!(await applies('SELECT Email AS mail FROM dbo.Customers GROUP BY |', { explicit: true })).includes('mail'), 'GROUP BY cannot read an alias');
  assert.equal((await applies('SELECT Status, CustomerId, COUNT(*) FROM dbo.Orders GROUP BY Status, |', { explicit: true }))[0], 'CustomerId', 'not one grouped by already');
  assert.ok(!(await applies('SELECT Email AS mail FROM dbo.Customers WHERE |', { explicit: true })).includes('mail'), 'nor WHERE');
});

test('a column the clause has, qualified or not, is not offered again first; after an alias and a dot, the select list still leads', async () => {
  assert.equal((await applies('SELECT o.Status, o.CustomerId, COUNT(*) FROM dbo.Orders o GROUP BY Status, |', { explicit: true }))[0], 'CustomerId');
  assert.equal((await applies('SELECT Status, CustomerId, COUNT(*) FROM dbo.Orders o GROUP BY o.Status, |', { explicit: true }))[0], 'CustomerId');
  assert.deepEqual((await applies('SELECT o.Status, o.CustomerId FROM dbo.Orders o ORDER BY o.|', { explicit: true })).slice(0, 3), ['Status', 'CustomerId', 'Id']);
  assert.equal((await applies('SELECT o.Status, o.CustomerId, COUNT(*) FROM dbo.Orders o GROUP BY o.Status, o.|', { explicit: true }))[0], 'CustomerId');
});

test('names given after a CTE or a subquery rename its columns by place, an unnamed one counted', async () => {
  const listed = await suggest('WITH r (a, b) AS (SELECT 1, Id FROM dbo.Orders) SELECT r.| FROM r', { explicit: true });
  assert.deepEqual(listed.map((s) => [s.apply, s.detail]), [['a', 'CTE column'], ['b', 'int · primary key']]);
  assert.deepEqual(await applies('SELECT x.| FROM (SELECT Id, Email FROM dbo.Customers) AS x (customerId, mail)', { explicit: true }), ['customerId', 'mail']);
});

test('an alias written as a string is the name it spells', async () => {
  assert.equal((await applies("SELECT Total AS 'order total' FROM dbo.Orders ORDER BY |", { explicit: true }))[0], '[order total]');
  assert.equal((await applies("SELECT Total 'it''s' FROM dbo.Orders ORDER BY |", { explicit: true }))[0], "[it's]");
  assert.equal((await applies("SELECT 'n' = COUNT(*) FROM dbo.Orders ORDER BY |", { explicit: true }))[0], 'n');
  assert.deepEqual(await applies("WITH r AS (SELECT Id AS 'key' FROM dbo.Orders) SELECT r.| FROM r", { explicit: true }), ['[key]']);
});

test('GROUP BY written out has the columns an aggregating expression reads outside its aggregate', async () => {
  assert.equal((await applies('SELECT Status, SUM(Total) + CustomerId AS adjusted FROM dbo.Orders GROUP BY |'))[0], 'Status, CustomerId');
  assert.equal((await applies('SELECT CASE WHEN COUNT(*) > 1 THEN o.Status END FROM dbo.Orders o GROUP BY |'))[0], 'o.Status');
  assert.equal((await applies('SELECT Status, status, COUNT(*) FROM dbo.Orders GROUP BY |'))[0], 'Status', 'once');
});
