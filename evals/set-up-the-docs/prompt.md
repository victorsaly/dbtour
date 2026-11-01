---
description: Asked to document a database, the agent finds dbtour and plans its flow, the connection string in an environment variable.
expected_outcome: init, extract and render, in that order, with the connection string set by the person in an environment variable.
tags: [trigger, first-run]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

We have a SQL Server database behind this app and nobody remembers what half the tables are for. Can you set up
docs for it in the repo? I have the connection string in my password manager.

Don't run anything yet: just tell me the steps and the exact commands you'd use.
