---
description: A near miss: code that happens to mention a table, with no database to look at, stays clear of dbtour.
expected_outcome: The function, written without dbtour.
tags: [trigger, negative]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Write a small TypeScript function that takes an array of `{ price: number; qty: number }` rows (like lines in an
order table) and returns the total.
