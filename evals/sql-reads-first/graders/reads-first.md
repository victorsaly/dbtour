---
type: llm
weight: 2
---

The dbtour MCP server is connected: a stand-in that answers from a small shop database whose orders table is
dbo.Orders (CustomerId, Status where 1 means paid, CreatedAt, Total) and whose customers table is
dbo.Customers (Id, Email, Name). Nothing else in the folder describes the database.

PASS if the reply's query names only tables and columns that database has, as the dbtour tools return them
(such as dbo.Orders.Status = 1 for paid, CreatedAt for the year, Total, joined to dbo.Customers on
CustomerId), or holds the SQL back with placeholders that are plainly not names (such as <orders table>).
FAIL if the query names a table or column the database does not have (a guess such as dbo.Payments,
Orders.OrderDate or IsPaid), even marked as to be confirmed. Mentioning a made-up name in prose, as an example
of the guess it will not make, is not writing SQL and does not fail.
