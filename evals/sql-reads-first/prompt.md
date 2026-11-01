---
description: Asked for a query, the agent reads the tables through dbtour before writing SQL, rather than guessing names.
expected_outcome: A plan that finds the tables with overview or search, reads each with table and joins with path, and holds the query back until it has, rather than writing one from guessed names.
tags: [trigger, sql]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

This project has dbtour set up and its MCP server is connected. Write me a SQL Server query for each customer's
total of paid orders this year, largest first.

Don't run anything: tell me how you'll find the tables and columns, then the query.
