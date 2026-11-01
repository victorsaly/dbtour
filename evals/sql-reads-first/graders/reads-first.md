---
type: llm
weight: 2
---

PASS if, before the query, the reply says it will look the tables and columns up in the dbtour model (through the
MCP server's overview, search, table or path tools, or the generated docs) rather than assuming their names, and
says it will use only names it has read. Writing a query with names marked as to be confirmed is fine.
FAIL if it writes the query from assumed table and column names without planning to check them.
