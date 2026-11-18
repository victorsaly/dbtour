---
description: Asked to document a SQLite file in the project, the agent plans dbtour's flow with the SQLite source, the file named in dbtour.yaml and no connection string.
expected_outcome: dbtour-source-sqlite installed, a source of type sqlite whose file is data/app.db, then extract and render; no connection string, environment variable or password.
tags: [trigger, first-run, sqlite]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

The app keeps everything in a SQLite file, data/app.db, and I'd like docs for its tables in the repo so the
next person knows what's in there. Can you set that up?

Don't run anything yet: just tell me the steps and the exact commands you'd use.
