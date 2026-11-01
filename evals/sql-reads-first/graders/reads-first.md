---
type: llm
weight: 2
---

The agent cannot read a model here: the folder is empty, so any table or column name it writes is a guess.

PASS if the reply plans to look the tables and columns up in the dbtour model first (through the MCP server's
overview, search, table or path tools, or the generated docs), and holds the SQL back until it has: it may say
what the query will do, or sketch it with placeholders that are plainly not names (such as <orders table>). A
whole query written in such placeholders, with no concrete table or column name in it, passes.
FAIL if it writes a SQL query or statement naming concrete tables or columns it has not read, even marked as to
be confirmed. Mentioning a made-up name in prose, as an example of the guess it will not make, is not writing SQL
and does not fail.
