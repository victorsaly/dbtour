---
description: Asked for a query, the agent reads the tables through dbtour before writing SQL, rather than guessing names.
expected_outcome: Finds the tables with overview or search, reads each with table and joins with path, then writes the query from the names those returned, never from guessed ones.
tags: [trigger, sql]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

This project has dbtour set up and its MCP server is connected. Write me a SQL Server query for each customer's
total of paid orders this year, largest first.

Don't run the query: find the tables and columns it needs, then give me the query.
