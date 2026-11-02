<div align="center">

<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo-light.svg#gh-dark-mode-only" alt="dbtour" width="220">
<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg#gh-light-mode-only" alt="dbtour" width="220">

**Tour your database and its API.**

[![version](https://img.shields.io/badge/version-0.9.5-blue)](CHANGELOG.md)
[![check](https://github.com/victorsaly/dbtour/actions/workflows/check.yml/badge.svg)](https://github.com/victorsaly/dbtour/actions/workflows/check.yml)

</div>

dbtour reads a database, writes what it finds to one model file in your repository, and renders that file as
Markdown GitHub shows with diagrams, and as a page developers search, follow relations in and hand to an agent.

SQL Server first. Other databases and the Claude Code skill follow the [plan](PLAN.md).

## Use

```bash
npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer
npx dbtour init                                  # writes dbtour.yaml
export DBTOUR_MSSQL='Server=localhost,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True'
npx dbtour extract                               # → docs/dbtour/schema.json
npx dbtour render                                # → docs/dbtour/README.md, one page per table, index.html
```

The SQL Server source reads the catalogue and nothing else: a login with `VIEW DEFINITION` on the database is
enough. Each table's rows and bytes come from the catalogue too, as SQL Server counts them, without reading a
row. So does everything else the database keeps about its objects: every extended property, under any name;
whether a table is temporal, memory-optimised, a ledger, partitioned or compressed, its triggers, change
tracking, change data capture and row-level security; a column's collation, identity seed, masking and
Always Encrypted; index kinds and filters, and keys no longer trusted. Sensitivity labels want `VIEW ANY
SENSITIVITY CLASSIFICATION` as well; without it, `extract` says they were not read. Features an older
SQL Server lacks are simply absent.

`dbtour.yaml`:

```yaml
out: docs/dbtour
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}   # the name of an environment variable, never the string itself
    exclude: [dbo.sys*, "*.webpages_*"]   # optional: tables to leave out
    reader: ${DBTOUR_MSSQL_READER}        # optional: a read-only login of its own, for dbtour sql
notes: dbtour.notes.yaml          # optional
addons:
  - explorer                      # the page; leave out for Markdown only
```

Several sources document several databases. With more than one, each table is named with its database,
`Sales:dbo.Customers`, so two databases that both have a `dbo.Customers` keep them apart: in the Markdown
(`tables/Sales/dbo.Customers.md`), on the page (`#Sales:dbo.Customers`) and to an agent. The notes may
leave the database out wherever only one database has the table, and are told when it is needed. A source's
`name` is how its database is named, so each needs its own, without a dot, a colon or a slash.

## The page

`docs/dbtour/index.html` is one file with the model inlined: open it from disk, or deploy the folder as it is.
It holds the structure and never the rows.

- `/` searches tables, columns and groups; arrows and Enter open a result.
- A table shows its columns with type, nullability, default, keys and description, the relations in and out
  as links, and its indexes and constraints below.
- Every entry carries a small map of the table and its neighbours; **Open the map** draws it large, laid out
  by ELK. **+** on any node adds that table's neighbours, and back takes them away. **Map of the whole
  catalogue** draws everything. Three levels of detail, Names, Keys and Columns, keep wide tables readable,
  and the **Links** panel switches any relation off, by itself or as a group. A group from the notes is a
  map of its tables.
- Every view has a URL: `#dbo.Orders`, `#dbo.Orders.Status`, `#diagram/dbo.Orders,dbo.Customers`,
  `#group/Billing`, `#map`.
- **Copy for …** puts the table's Markdown on the clipboard for whichever agent you use, Claude, ChatGPT,
  Gemini, Copilot, Cursor or any other; the choice is remembered, and tools with a web chat get an Open link.
- Every table has a number and every schema a colour, and each table is drawn as one line: a pulse per
  column, a key as a peak. Dark mode follows the system.
- Sizes, when the source read them: a bar beside each line of the index shows the table's bytes against
  the largest, split into data and indexes, with its rows written over it; the index can be read by
  **Rows** or **Size**, largest first, as well as in catalogue order; and an entry opens on its size, its
  place among the tables, and what each figure means.
- What the catalogue says: an entry's **About** block puts each feature of the table in a plain sentence
  (system-versioned, partitioned, triggers and the rest), with when it was created and its properties; a
  **Protection** column shows a column's sensitivity label, mask and encryption; triggers and row-level
  security are sections of their own, like indexes and constraints.
- A **Query** section on every entry starts a query from the table and what it references, in an editor that
  autocompletes the database's tables and columns; **Write SQL** in the rail opens one for any query. Copy it,
  or copy it for an agent with the tables it reads. Opened through `dbtour serve`, it runs it too (below).

## Ask Claude

The dbtour skill teaches an agent when to reach for dbtour and how: set it up with the connection string kept
in an environment variable, find a table a piece at a time, and write SQL only from the names the model has.

```bash
npx skills add victorsaly/dbtour                 # Claude Code, Codex, Cursor and other agents that read Agent Skills
```

In Claude Code the plugin brings the skill and connects the MCP server below in one go:
`/plugin marketplace add victorsaly/dbtour`, then `/plugin install dbtour@dbtour`.

`dbtour mcp` serves the model to an agent over the [Model Context Protocol](https://modelcontextprotocol.io),
so Claude can find the table it needs, read it and join it, instead of being handed the whole schema:

```bash
claude mcp add dbtour -- npx dbtour mcp          # Claude Code, from the project's folder
```

For Claude Desktop or any other client, run `npx dbtour mcp /path/to/project`. It offers four read-only
tools:

- **overview**: the databases and their tables, largest first, with the groups from the notes.
- **search**: tables, views, columns and groups by any part of their name, type or description, the same
  search as the page.
- **table**: one table as the Markdown in `docs/dbtour/tables/`: columns, keys, relations both ways,
  indexes, constraints.
- **path**: the shortest chain of relations between two tables, written as the JOINs that follow them.

It reads `schema.json` and the notes, and reads them again when they change. Like the page, it holds the
structure and never the rows, and it needs no connection string. What it answers goes to the model provider
your agent uses, so a schema that must not leave your network wants a model that stays inside it.

`dbtour.notes.yaml` adds what the database cannot say, and wins over it:

```yaml
tables:
  dbo.Orders:
    description: One row per checkout. Lines are in dbo.OrderLines.
    columns:
      Status: 0 draft, 1 paid, 2 shipped, 9 cancelled
relations:
  - from: dbo.AuditLog.OrderId     # a relation nobody declared as a foreign key
    to: dbo.Orders.Id
groups:
  - name: Billing
    tables: [dbo.Orders, dbo.OrderLines, dbo.Invoices]
```

## Run a query

With a `reader` on a source (a login with `db_datareader` alone, never the one `extract` uses), dbtour runs a
query too:

```bash
export DBTOUR_MSSQL_READER='Server=…;Database=Shop;User Id=dbtour_reader;Password=…'
npx dbtour sql "SELECT TOP (10) Id, Status FROM dbo.Orders ORDER BY Id DESC"
```

and `dbtour mcp` offers a **query** tool beside the others, so an agent can check what it wrote. Either way it
runs one SELECT, or WITH … SELECT: anything that writes, runs code or reaches out of the database is refused
before a connection is made, and what runs does so inside a transaction that is always rolled back, at most
100 rows (`--limit` up to 5,000), 10 MB and 30 seconds. The rows are shown, never written into the model.
Through the MCP server they go to the model provider your agent uses. What dbtour checks is the query's shape;
what a name can reach (another database, a linked server) is the reader's permissions, so keep the reader to
this database alone.

On the page, `dbtour serve` runs it the same way:

```bash
npx dbtour serve                                 # http://127.0.0.1:4321, on this machine only
```

The editor's bar says it is connected, and Run (or ⌘/Ctrl+Enter) shows the rows under the query, with how
many, how long it took and through which reader. The dot beside it is the last run: grey before one, green
answered, red failed, with why. Auto-run, off until you tick it, runs the query each time you pause typing,
and never a half-written one. The server answers only its own page, which carries a token it is given when
served, and only on this machine.

## Develop

```bash
npm install
npm run check      # lint, typecheck, tests with coverage (builds the page first)
npm run example    # renders examples/shop into examples/shop/docs; open examples/shop/docs/index.html
npm run e2e:page   # drives the page in Google Chrome
npm run brand      # redraws brand/ from the mark in packages/addon-explorer/src/mark.ts
```

## Licence

MIT
