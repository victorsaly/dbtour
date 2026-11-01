# dbtour: the plan

dbtour documents a project's database and its API in the repository, as Markdown people can read on GitHub
and as one page developers can search, follow relations in and hand to an agent. One rule keeps every
piece simple: **everything is a function of one model file.** Sources write it, add-ons extend it, the
page and the Markdown only read it.

## The model

`docs/dbtour/schema.json`, committed to the project. It holds databases (schemas, tables, views, columns,
keys, relations, indexes, descriptions), APIs (endpoints, parameters, responses) and links between the two.
Its version is the `dbtour` field; `validate()` in `packages/core/src/model.ts` checks what a source emits and names what is wrong. It
never holds data rows or credentials.

Beside it, `dbtour.notes.yaml`, written by people or the agent: table and column descriptions, relations that
were never declared as foreign keys, groups of tables by domain, and which endpoints touch which tables. This
is how a SQL Server shop documents production without altering it. Notes merge into the model at render time
and win over what the database says.

### Beyond the structure

The structure says what a table is; three more things say how it is used, and the database already keeps
all three in its catalogue, so a source reads them without touching a row.

- **Size and shape**: rows, data and index bytes per table, with the moment they were read. Cheap
  (`sys.dm_db_partition_stats` on SQL Server, `pg_class` and `pg_stat_user_tables` on Postgres), and the
  difference between a lookup table and the one everything hangs off. Lives on the table as `stats`.
- **Usage**: which indexes are read and which only cost writes, which indexes the engine wishes it had,
  which tables are hot. From the management views, so it describes the window since the last restart, not
  history, and needs `VIEW DATABASE STATE`. An add-on, since it is a report on the structure rather than
  part of it.
- **Queries that explain the data**: written by the agent from the model, not by sampling rows. The SQL
  add-on gives it the tables to cite and runs what it writes through a read-only login with a row limit.

None of this samples values. A count or a size describes the table; a row would be data, and the model
never holds data. What a source cannot read (no permission, a database that does not keep it) is simply
absent, and the page shows nothing rather than a guess.

## Three kinds of package

| Kind | Contract | Packages |
|---|---|---|
| Core | `dbtour` on npm. Model types and validation, notes merge, Markdown and Mermaid render, plugin loading, the CLI. Only dependency: `yaml`. | `packages/core` |
| Source | `extract(config) → Database` or `→ Api`. One package per origin, owning its driver. Loaded by name: `type: mssql` loads `dbtour-source-mssql`. | `source-mssql` first; then `source-postgres`, `source-mysql`, `source-sqlite`, `source-openapi`, `source-tbls` (imports tbls JSON), `source-paste` (JSON from a query the user ran themselves), later `source-prisma` |
| Add-on | `enrich(model) → model`, optionally writing files. | `addon-explorer` (the page), `addon-search`, `addon-sql`, `addon-usage` (index and table usage from the management views); later `addon-lint`, `addon-diff` |

Add-ons put data into the model and the page shows a panel when that data is present. The search add-on
writes an index, the SQL add-on writes example queries and a per-table prompt. The page is one React app
with no runtime plugin loading, which is what keeps it a single HTML file.

## The command

```
dbtour init                 # writes dbtour.yaml, picks sources
dbtour extract              # sources → schema.json (connection string from an environment variable, never argv)
dbtour render               # schema.json + notes → index.html, README.md, one .md per table
dbtour serve                # the page locally, reloading on change
dbtour check                # CI: fails when the database and schema.json disagree
dbtour find users           # search from the terminal, same index as the page
```

## The page

For developers, read-only, no modes. Search with the table list grouped by schema on the left, the selected
table or the canvas in the centre, relations and notes on the right.

- `/` searches tables, columns and endpoints. Enter opens. Every view has a URL (`#dbo.Users`).
- A table shows columns (type, nullable, default, key, description), relations in and out as links, and
  indexes and constraints collapsed below.
- The diagram is on demand: the selected table and its neighbours at distance one, "expand" on any node.
  Never the whole schema. React Flow for the canvas, elkjs for layout. Groups from the notes are named views.
- Endpoints grouped by tag, each with parameters and responses and "touches" links to tables. A table shows
  the endpoints that touch it.
- "Copy for …" copies the selected tables and endpoints as a prompt for whichever agent the reader uses.
- Size, when the model has it: an entry says its rows and bytes beside its columns, the index can be ordered
  by them, the home's lines carry weight by rows so the fat tables stand out, and the map can scale a node
  by size. Usage, when an add-on wrote it, is a panel on the entry: unused and suggested indexes, reads
  against writes.
- Dark mode follows the system. Works opened from a file, with no network.

## Local and deployed

`render` writes a static folder: `index.html` self-contained with the model inlined, the Markdown and
`schema.json`. Locally, open the file or run `serve`. Deployed, it is static files on GitHub Pages, Cloudflare
Pages or a bucket, with a workflow template in the repo. The page holds structure only, never rows, but a
private database still belongs behind the host's access control.

## The agent skill

A thin layer over the command: when to use it, the extract-render-show-commit flow, and how to write
queries from `schema.json`. The SQL generator is the agent reading the model; the add-on gives it the tables
to cite and runs the result through the source with a read-only login and a row limit.

## Showing it

Not before there is enough to show. Once milestones 4 to 7 are released (the skill installs with one
command, a second database works, and a project can deploy its page and check it in CI), dbtour gets a card
on [skills.victorsaly.com](https://skills.victorsaly.com/) and a page of its own at `/dbtour`, built the way
[SideShot's](https://skills.victorsaly.com/sideshot) is:

- The pitch in one line, the install command with a copy button, the agents it works with.
- A film under a minute long, with sound, hosted on the site: an agent asked to document a database runs
  `extract` and `render`, opens the page, searches, follows a relation, grows the diagram and copies a table
  for itself.
- The page itself, live. The rendered example is one HTML file, so the site carries it as it is and the
  reader explores a real catalogue rather than pictures of one.
- A section for each thing it does (notes over a database you cannot alter, the map, copy for any agent,
  deploy and check), each with a still, then what it needs and the other ways to install it.

The page lives in the skills site's repository. This repository keeps what the page is made from:
`examples/shop` and a script that records the film and the stills from it, so they are made again on each
release rather than going stale. dbtour.dev, once registered, points there. Until then the README is the only
shop window, and nothing goes on the page before it is released.

## Order of work

1. **Core, `source-mssql`, Markdown with Mermaid.** Replaces dbschema-markdown, keeping descriptions and
   computed columns, fixing composite keys.
2. **The page**: search, table view, neighbourhood diagram.
3. **Size and shape**: `stats` on each table from the SQL Server source, and the page and the Markdown
   showing it: rows and bytes on the entry, the index ordered by them, lines weighted by rows. ← here
4. The skill and the SQL add-on, with the stats telling the agent where to look first.
5. `source-openapi` and table-to-endpoint links.
6. `source-postgres`, `source-mysql`, `source-sqlite`, `source-tbls`, `source-paste`; each reads the stats
   its database keeps.
7. Deploy workflow, `check`, `addon-lint`.
8. `addon-usage`: index and table usage from the management views, as a panel on the entry.
9. **Showing it**: the page on skills.victorsaly.com with its film and the live example, the script that
   records them, once 4 to 7 are released.

## Borrowed from

- tbls: the idea of a notes file that adds descriptions and virtual relations without altering the database.
- ChartDB: one read-only query per dialect, so no driver is needed when the user runs it themselves.
- Azimutt: the exploring: search everywhere, show a subset, follow a relation, save a layout.
- dbschema-markdown: extended properties for descriptions, computed columns, Markdown tables.
