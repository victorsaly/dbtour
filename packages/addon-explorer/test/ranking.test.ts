// How good the suggestions are, as numbers: half-written queries, each with the caret at | and what a reader
// wants written there, and where that comes in the list CodeMirror would show. The cases in complete.test.ts
// hold each rule; this holds the whole to the reader, so a change that helps one place and hurts another
// shows. It prints every case not first; the floors below are the scores now, raised when a change lifts them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from './suggest.ts';

interface Case {
  /** The query, the caret at |. */
  query: string;
  /** What the reader wants: the text a suggestion writes, or its label (a table's name, a snippet's). */
  want: string;
  /** Asked for with Ctrl+Space, where the list does not open by itself. */
  explicit?: boolean;
}

const two = 'FROM dbo.Orders o JOIN dbo.Customers c ON c.Id = o.CustomerId';

const cases: Case[] = [
  // The select list.
  { query: 'SELECT | FROM dbo.Orders', want: 'Id', explicit: true },
  { query: 'SELECT TOP (10) | FROM dbo.Products', want: 'Id', explicit: true },
  { query: 'SELECT Cu| FROM dbo.Orders o', want: 'CustomerId' },
  { query: 'SELECT DISTINCT St| FROM dbo.Orders', want: 'Status' },
  { query: 'SELECT o.| FROM dbo.Orders o', want: 'Id' },
  { query: 'SELECT o.To| FROM dbo.Orders o', want: 'Total' },
  { query: `SELECT c.Em| ${two}`, want: 'Email' },
  { query: `SELECT Em| ${two}`, want: 'c.Email' },
  { query: 'SELECT Qu| FROM dbo.OrderLines', want: 'Quantity' },
  { query: 'SELECT i.Iss| FROM billing.Invoices i', want: 'IssuedAt' },
  { query: 'SELECT p.Pr| FROM dbo.Products p', want: 'Price' },
  { query: 'SELECT *| FROM dbo.Customers', want: 'Id, Email, Name', explicit: true },
  // After FROM and JOIN: the table the select list fits, the joins the keys give.
  { query: 'SELECT Email FROM |', want: 'Customers' },
  { query: 'SELECT Sku, Price FROM |', want: 'Products' },
  { query: 'SELECT Quantity FROM |', want: 'OrderLines' },
  { query: 'SELECT IssuedAt FROM |', want: 'Invoices' },
  { query: 'SELECT * FROM billing.|', want: 'Invoices' },
  { query: 'SELECT * FROM Ord|', want: 'Orders' },
  { query: 'SELECT * FROM dbo.Orders o JOIN |', want: 'dbo.Customers AS c ON c.Id = o.CustomerId' },
  { query: 'SELECT * FROM dbo.Orders o JOIN dbo.Customers c ON |', want: 'c.Id = o.CustomerId' },
  { query: 'SELECT * FROM dbo.Orders o JOIN dbo.OrderLines l ON |', want: 'l.OrderId = o.Id' },
  { query: 'SELECT o.Id FROM dbo.Orders o JOIN billing.Invoices i ON |', want: 'i.OrderId = o.Id' },
  // After a table: the clause that comes next.
  { query: 'SELECT * FROM dbo.Orders o JOIN dbo.Customers c O|', want: 'ON' },
  { query: 'SELECT * FROM dbo.Orders o W|', want: 'WHERE' },
  // Conditions.
  { query: 'SELECT * FROM dbo.Orders o WHERE o.St|', want: 'Status' },
  { query: 'SELECT * FROM dbo.Orders WHERE Cr|', want: 'CreatedAt' },
  { query: "SELECT * FROM dbo.Orders WHERE Status = 'x' AND To|", want: 'Total' },
  { query: 'SELECT * FROM dbo.Customers WHERE Na|', want: 'Name' },
  { query: `SELECT * ${two} WHERE c.|`, want: 'Id' },
  { query: 'SELECT * FROM dbo.vOrderTotals v WHERE v.|', want: 'OrderId' },
  { query: 'SELECT * FROM dbo.Orders o WHERE EXISTS (SELECT 1 FROM dbo.OrderLines l WHERE l.OrderId = o.Id AND Qu|)', want: 'Quantity' },
  { query: 'SELECT * FROM dbo.Orders o WHERE EXISTS (SELECT 1 FROM dbo.OrderLines l WHERE l.OrderId = o.|)', want: 'Id' },
  { query: 'SELECT * FROM dbo.Orders o WHERE o.CustomerId IN (SELECT c.| FROM dbo.Customers c)', want: 'Id' },
  { query: 'UPDATE dbo.Orders SET St|', want: 'Status' },
  { query: 'DELETE FROM dbo.Orders WHERE Cr|', want: 'CreatedAt' },
  // Snippets.
  { query: 'ssf|', want: 'ssf' },
  { query: 'st100|', want: 'st100' },
  // A CTE's columns and a subquery's, by the names its select list gives them.
  { query: 'WITH r AS (SELECT o.Id, o.Total FROM dbo.Orders o) SELECT r.| FROM r', want: 'Id' },
  { query: 'WITH big AS (SELECT CustomerId, SUM(Total) AS spent FROM dbo.Orders GROUP BY CustomerId) SELECT sp| FROM big', want: 'spent' },
  { query: 'WITH r (a, b) AS (SELECT 1, 2) SELECT r.| FROM r', want: 'a' },
  { query: 'WITH r AS (SELECT * FROM dbo.Customers) SELECT r.Em| FROM r', want: 'Email' },
  { query: 'WITH r AS (SELECT c.Email FROM dbo.Customers c) SELECT | FROM r', want: 'Email', explicit: true },
  { query: 'WITH a AS (SELECT Id FROM dbo.Orders), b AS (SELECT a.Id AS OrderId FROM a) SELECT b.| FROM b', want: 'OrderId' },
  { query: 'WITH r AS (SELECT Id FROM dbo.Orders UNION ALL SELECT r.Id FROM r) SELECT r.| FROM r', want: 'Id' },
  { query: 'WITH r AS (SELECT CustomerId, COUNT(*) AS n FROM dbo.Orders GROUP BY CustomerId) SELECT c.Email, r.| FROM r JOIN dbo.Customers c ON c.Id = r.CustomerId', want: 'CustomerId' },
  { query: 'SELECT x.| FROM (SELECT Id, Email AS mail FROM dbo.Customers) x', want: 'Id' },
  { query: 'SELECT x.ma| FROM (SELECT Id, Email AS mail FROM dbo.Customers) x', want: 'mail' },
  // GROUP BY: what the select list does not aggregate, written out; ORDER BY: what the select list names.
  { query: 'SELECT o.Status, COUNT(*) AS n FROM dbo.Orders o GROUP BY |', want: 'o.Status' },
  { query: `SELECT c.Email, o.Status, SUM(o.Total) ${two} GROUP BY |`, want: 'c.Email, o.Status' },
  { query: 'SELECT Status, CustomerId, MAX(Total) AS top FROM dbo.Orders GROUP BY |', want: 'Status, CustomerId' },
  { query: 'SELECT CustomerId, SUM(Total) AS spent FROM dbo.Orders GROUP BY CustomerId ORDER BY |', want: 'spent', explicit: true },
  { query: 'SELECT Email AS mail FROM dbo.Customers ORDER BY m|', want: 'mail' },
  { query: 'SELECT Name, Email FROM dbo.Customers ORDER BY |', want: 'Name', explicit: true },
  { query: `SELECT o.Total, c.Email ${two} ORDER BY |`, want: 'o.Total', explicit: true },
];

// The share of cases whose suggestion comes first, and in the first three. Raise these when a change lifts the
// score; a change that lowers them is a worse autocomplete, whatever its own case says.
const firstFloor = 0.98;
const topThreeFloor = 1;
const topThree = 3;

test('the suggestion a reader wants comes first, or near it', async (t) => {
  const ranks: { query: string; want: string; rank: number; first?: string }[] = [];
  for (const c of cases) {
    const listed = await suggest(c.query, { explicit: c.explicit });
    const at = listed.findIndex((l) => l.apply === c.want || l.label === c.want);
    ranks.push({ query: c.query, want: c.want, rank: at < 0 ? Infinity : at + 1, first: listed[0]?.apply });
  }
  const first = ranks.filter((r) => r.rank === 1).length / ranks.length;
  const three = ranks.filter((r) => r.rank <= topThree).length / ranks.length;
  t.diagnostic(`first ${(first * 100).toFixed(0)}%, in the first ${topThree} ${(three * 100).toFixed(0)}%, of ${ranks.length} cases`);
  for (const r of ranks.filter((r) => r.rank > 1)) t.diagnostic(`${r.rank === Infinity ? 'missing' : `#${r.rank}`}: ${r.want} in ${r.query} (first: ${r.first ?? 'nothing'})`);
  assert.ok(first >= firstFloor, `first ${first.toFixed(2)}, below ${firstFloor}`);
  assert.ok(three >= topThreeFloor, `in the first ${topThree} ${three.toFixed(2)}, below ${topThreeFloor}`);
});
