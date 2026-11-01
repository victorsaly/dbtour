---
name: dbtour
description: Documents a project's database from its structure and answers questions about it without reading a row - which table holds something, how two tables join, what a column means, how big a table is - and writes SQL against it from the real tables and columns, through dbtour (dbtour.yaml, docs/dbtour/schema.json, the dbtour MCP server). Use when asked to document a database or keep its docs current, to find where data lives, to explain a schema, to write or check a query for the project's database, or to set up dbtour. Load it before writing SQL against a database the project uses, even a short query.
license: MIT
metadata:
  version: 0.10.0
  homepage: https://github.com/victorsaly/dbtour
allowed-tools: Bash(npx dbtour *)
---

# dbtour: tour the database before you touch it

dbtour reads a database's catalogue (tables, columns, keys, relations, indexes, descriptions, sizes, and the
rest the catalogue keeps) into one model file, `docs/dbtour/schema.json`, and renders it as Markdown and a page.
It never reads a row. Use it to know the database before answering about it or writing SQL for it: the model
has the real names, so nothing is guessed.

## 1. Is it set up?

Look for `dbtour.yaml` at the project's root and `docs/dbtour/schema.json` (or the `out` folder the yaml names).

- **Both there**: go to 2.
- **Neither**: set it up, with the person:
  1. `npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer`: the command, the SQL Server
     source and the page. `npx dbtour` alone fetches only the command, which then has nothing to read a
     database with. Then `npx dbtour init` writes `dbtour.yaml` for SQL Server; add `exclude` for tables
     nobody should read about.
  2. The connection string goes in the environment variable `dbtour.yaml` names (`DBTOUR_MSSQL`), set by the
     person in their own shell. **Never write it into `dbtour.yaml`, a file, a command you run, or a reply**;
     if they paste one, say so and ask them to set the variable instead. Never quote a password or key back,
     not even to point at it: say "the password you pasted", and show the variable with the secret left out
     (`export DBTOUR_MSSQL='Server=…;Password=…'`). A login with `VIEW DEFINITION` on the database is enough.
  3. `npx dbtour extract`, then `npx dbtour render`: the Markdown under `docs/dbtour/`, and the page
     (`docs/dbtour/index.html`) when `addons` lists `explorer`.
  4. Show them `docs/dbtour/README.md` or the page before anything is committed. The model describes their
     database, so committing it is their call; a private schema stays out of a public repository.

- **No project, but the person wants to look at their databases** (one or several, on their machine, not in a
  repository): set them up in `~/.dbtour` with `npx dbtour add`, which keeps passwords in the system's keychain.
  `npx dbtour list` shows what is set up already. The rules, every time:
  - Name the database in every command (`--database <name>` on `sql`, `mcp` and `serve`). With several set up,
    dbtour refuses to guess, and so do you.
  - Prefer `--sign-in az`: no password at all. A login's password goes only on stdin (`--password-stdin`),
    typed or piped by the person; **never pass `--password`, never put a password in a command you run**. If
    you do not have it, ask the person to run the command themselves.
  - `npx dbtour reader <name> --create` changes the database: without `--confirm` it only prints the
    statements. Show them to the person and wait for their yes before running it with `--confirm <name>`.
  - Then `npx dbtour read <name>`, and `npx dbtour serve` for the person: a home of every database, each with
    its page.

[reference.md](reference.md) has the yaml, the notes file, the commands for databases set up on a machine, and
the MCP setup for each client.

## 2. Find what you need, a piece at a time

When the `dbtour` MCP server is connected (its tools are `overview`, `search`, `table` and `path`), use it
rather than reading `schema.json` whole:

1. **overview** first: the databases and their tables, largest first by rows. The large tables are usually
   the ones a question is about, and the ones a careless query hurts.
2. **search** for the thing asked about, by any part of a name or description: `customer email`.
3. **table** for each table you will name: its columns, keys, relations both ways, and what else the catalogue
   says (a trigger, row-level security, a masked or labelled column).
4. **path** to join two tables that are not related directly: it gives the JOINs.

Without the server, read the table pages in `docs/dbtour/tables/<schema.table>.md` (in a folder per database,
`tables/Sales/dbo.Orders.md`, when there are several), or search `schema.json` for the name, rather than
loading the whole file. If the person uses Claude Code and asks, connect it:
`claude mcp add dbtour -- npx dbtour mcp`.

## 3. Write SQL from the model, never from memory

- Name only tables and columns you have read with **table**, as `schema.table`. Never invent one; if what is
  asked is not in the model, say so and say what is closest.
- With several databases the tools name a table with its database, `Sales:dbo.Orders`, and two databases may
  both have a `dbo.Orders`: pass that name back to the tools, but the `Sales:` is not SQL. Write `dbo.Orders`
  and say the query runs in Sales.
- **No model to read, no SQL.** When neither the MCP server's tools nor the docs are there to read, do not
  write a query, or a fragment of one, with likely names, even marked as placeholders: say what you will read,
  describe the query in words or with placeholders that are plainly not names (`<the order date>`), and write
  it once you have read the tables. A guessed name looks right and runs wrong, or silently sums the wrong column.
- Join through the relations the model has, or **path**'s JOINs. A relation marked **(notes)** was written by
  a person, not declared by the database; one marked **not trusted** is not enforced on existing rows.
- Write the database's dialect: the model's `driver` (`mssql` is T-SQL: `TOP`, `[brackets]`, `N'text'`).
- Mind the size: a table of millions of rows gets a `TOP` and a filter on an indexed column, and a `SELECT *`
  is never the answer on it.
- A column that is **masked**, **encrypted** or has a **sensitivity label** holds data someone protected: do
  not select it unless the question needs it, and say so when you do.
- Give the query with the tables it reads named beside it, so the person can check it against the docs.

## 4. Run it, when the project allows it

When a source in `dbtour.yaml` has a `reader` (a read-only login of its own), the MCP server also offers
`query`, and `npx dbtour sql "<query>"` does the same from the terminal (`--limit`, `--source`, `--json`). Each
runs one SELECT, or WITH … SELECT, after checking it is one: inside a transaction that is always rolled back,
at most 100 rows unless asked, cancelled after 30 seconds.

- Read the tables with **table** first all the same: running a query is how you check it, not how you guess.
- The rows go to the model provider your agent uses. Select only what the question needs, never a whole large
  table, and leave out masked, encrypted or labelled columns unless the person asks for them.
- A refusal says why: a second statement, a write, `SELECT … INTO`. Fix the query; do not work around it.

Without a reader, hand the query to the person to run in their own tool. Do not ask them for a login or a
password: setting up a reader is theirs, and [reference.md](reference.md) shows how.

## 5. Keep the docs current

After a migration, or when asked: `npx dbtour extract` and `npx dbtour render`, then show what changed
(`git diff docs/dbtour/`). What the database cannot say (what a status code means, a relation nobody
declared, a group of tables) goes in `dbtour.notes.yaml`, which wins over the database at render time:
[reference.md](reference.md) has its shape.
