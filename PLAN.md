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

A table is named `schema.table`. With several databases the name carries its database, `Sales:dbo.Orders`,
since two can have the same table: `scope()` names each schema `Database:schema` when the model is read, so
everything that composes a name from a schema and a table stays as it is, and `schema.json` keeps what the
sources wrote. A name without its database still finds a table only one database has.

Beside it, `dbtour.notes.yaml`, written by people or the agent: table and column descriptions, relations that
were never declared as foreign keys, groups of tables by domain, and which endpoints touch which tables. This
is how a SQL Server shop documents production without altering it. Notes merge into the model at render time
and win over what the database says.

### All the catalogue says

A description is one extended property among many. The source reads everything the database keeps about an
object, as long as it describes the object and not its rows:

- **Every extended property**, under any name, on schemas, tables, columns, indexes and constraints: a
  `properties` map of name to text beside `description`, which stays `MS_Description`. Teams already record
  owners, sources and retention this way; dbtour shows them rather than asking for them again in the notes.
- **The table**: when it was created and last altered, whether it is temporal (with its history table and
  period columns), memory-optimised or a ledger table, how it is partitioned and compressed, its triggers
  (events, enabled, definition), change tracking or change data capture, and the row-level security
  policies that filter it.
- **The column**: collation, identity seed and increment, sparse, the masking function, Always Encrypted,
  and the sensitivity label and information type (`sys.sensitivity_classifications`, which Azure SQL fills
  in from data discovery).
- **Indexes and keys**: clustered, columnstore or filtered (with the filter), disabled; a foreign key that
  is disabled or no longer trusted.

All of it but the labels comes from catalogue views a login with `VIEW DEFINITION` reads; the labels want
`VIEW ANY SENSITIVITY CLASSIFICATION`, and without it they are absent and the source says so. Other engines
bring what they keep (`COMMENT ON` in Postgres, column comments in MySQL). Notes win over properties as they
win over descriptions.

### Beyond the structure

The structure says what a table is; three more things say how it is used. Two of them the database keeps
about itself and a package reads without touching a row; the third is written by the agent.

- **Size and shape**, read by the source with the structure: rows, data and index bytes per table, with
  the moment they were read. Cheap (`sys.partitions` and `sys.allocation_units` on SQL Server, catalogue
  views a login with `VIEW DEFINITION` reads, where `sys.dm_db_partition_stats` would want `VIEW DATABASE
  STATE`; `pg_class` and `pg_stat_user_tables` on Postgres), and the difference between a lookup table and
  the one everything hangs off. Lives on the table as `stats`, its moment on the database as
  `statsReadAt`. The count is the database's own estimate, and the Markdown says so.
- **Usage**, read by an add-on, since it is a report on the structure rather than part of it: which
  indexes are read and which only cost writes, which indexes the engine wishes it had, which tables are
  hot. From the management views, so it describes the window since the last restart, not history. The
  permission depends on the engine: SQL Server itself wants the server-scoped `VIEW SERVER STATE` for
  `sys.dm_db_index_usage_stats` and the missing-index views; Azure SQL Database takes `VIEW DATABASE
  STATE` on most tiers, while Basic, S0, S1 and pooled databases want the server admin or the Entra admin.
  The add-on reports what the login could not read rather than failing.
- **Queries that explain the data**, written by the agent from the model, not read from anywhere and
  never from sampled rows. The SQL add-on gives it the tables to cite and runs what it writes through a
  read-only login with a row limit.

None of this samples values. A count or a size describes the table; a row would be data, and the model
never holds data. What a source cannot read (no permission, a database that does not keep it) is simply
absent, and the page shows nothing rather than a guess. The one exception is the owner's to make, table by
table: the values of a lookup they choose to keep (below), in a file of their own, never in the model.

### Suggestions

Most databases describe little of themselves, and an agent reading the model can say a good deal of the rest:
what a table is for, what a column means, a relation nobody declared, which tables belong together. What it
says is a proposal until a person agrees, so it is staged in a file of its own, `dbtour.suggestions.yaml`,
beside the notes and in the same shape (tables, columns, relations, groups), each entry with why it was
proposed (the names, keys and relations it read) and when. The agent writes it through the MCP server; it
reads the structure, never a row, as everything else in the model does.

- **Three origins, each shown.** What the database says is plain; what the notes say is marked *notes*, as a
  relation is today; what an agent suggested is marked *suggested*, with its reason beside it, on the page
  and in the Markdown, and the page defines the mark where it shows it. The model records each
  description's origin so nothing downstream has to guess. A suggestion fills a gap: where the database or
  the notes already say something, a different suggestion is shown beside it as a proposed change, never
  in its place.
- **The kind of a table**, from the structure alone: a lookup (few rows by the stats, a key and a name or
  code, many relations in and none out), a junction (two foreign keys that are its primary key), or an
  entity. A pure function in core; the agent may suggest a different kind where the rule is wrong. A column
  that references a lookup says so, so the reader knows where its values are defined.
- **From staging to the notes.** `dbtour accept` moves a suggestion into `dbtour.notes.yaml`, where a person
  stands behind it, and `dbtour reject` drops it; the diff shows who took what. Unreviewed suggestions are
  never treated as notes.
- **From the notes to the database.** `dbtour script` writes the T-SQL that puts accepted descriptions where
  the database keeps them (`sp_addextendedproperty`, or `sp_updateextendedproperty` where one exists, on
  `MS_Description`). dbtour never runs it: its logins only read, so the script is handed to a person who
  runs it with their own. Relations from the notes become foreign keys only when asked for separately
  (`WITH NOCHECK`), since a constraint changes what the database accepts and a description does not. After
  the script has run, `extract` reads the descriptions back as the database's, and `check` names the notes
  that now repeat it, to be removed.

### Values the owner chooses to keep

A lookup's rows are what its codes mean (`1 paid`, `2 shipped`), and a reader is often better served by
seeing them than by a description of them. Whether they belong in the docs is the owner's call, not dbtour's:
only they know whether the docs are public and whether the values are sensitive. So keeping them is off
until the owner names a table, and dbtour never chooses one for them.

```yaml
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}
    reader: ${DBTOUR_MSSQL_READER}
    values: [dbo.OrderStatus, dbo.Country]   # the lookups whose rows the owner keeps in the docs
```

- **Read through the reader**, the login with `db_datareader` alone, by `dbtour extract`; never through the
  extract's connection, and not at all without a reader.
- **Refused, with the reason**, for a table with a masked, encrypted or labelled column or a row-level
  security policy (someone protected it, and the owner listing it is not that person agreeing), and for a
  table over the limits: a lookup has a few hundred rows and is narrow, so the limits are in rows and in
  bytes, named and explained where they are defined. The stats' count is an estimate, so the reader counts
  again before reading.
- **Refused when the protection could not be read.** A missing label proves nothing when the login could not
  read labels: the database's `unread` then names what is missing (`VIEW ANY SENSITIVITY CLASSIFICATION`),
  and no table of that database has its values read until the extract's login can see what protects them.
  The refusal says which permission to grant.
- **Kept beside the model, not in it**: `values.json` in the `out` folder, with the moment each table was
  read. `schema.json` still holds no row.
- **Private means rendered without them.** The page is one self-contained file and the Markdown has the
  values too, so leaving `values.json` out after a render would still publish the rows. `dbtour render
  --without-values` writes the page and the Markdown from the model alone, for a commit or a deploy, and
  the values stay on the owner's machine, on the served page and over MCP.
- **Shown as data, with its date**: on the lookup's entry as a table of its rows, marked as read from the
  database on that day, and on each column that references it, where a value is shown with its meaning.
  Search finds a value and leads to its table. The Markdown has them on the lookup's page.
- **For the agent**, the MCP server's `table` includes them, and a suggestion may cite them: a column
  description that says what each code means is then staged for a person like any other. The agent may also
  suggest a table for the list, with its reason; only the owner adds it.

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
dbtour serve                # the page on 127.0.0.1; with a reader, its editor runs queries; later, the setup wizard
dbtour check                # CI: fails when the database and schema.json disagree
dbtour find users           # search from the terminal, same index as the page
dbtour mcp                  # the model to an agent over MCP: overview, search, table, path; later gaps, suggest
dbtour accept dbo.Orders    # a suggestion into the notes; reject drops it
dbtour script               # T-SQL that writes the accepted descriptions into the database, for a person to run
```

## The page

For developers, read-only, no modes. Search with the table list grouped by schema on the left, the selected
table or the canvas in the centre, relations and notes on the right.

- `/` searches tables, columns and endpoints. Enter opens. Every view has a URL (`#dbo.Users`).
- A table shows columns (type, nullable, default, key, description), relations in and out as links, and
  indexes and constraints collapsed below.
- What the catalogue says beyond that, when the model has it: an About block on the entry with each of the
  table's features (temporal, partitioned, triggers) in a plain sentence and its properties as a list, and
  a Protection column for a column's label, masking and encryption.
- The diagram is on demand: the selected table and its neighbours at distance one, "expand" on any node.
  Never the whole schema. React Flow for the canvas, elkjs for layout. Groups from the notes are named views.
- Endpoints grouped by tag, each with parameters and responses and "touches" links to tables. A table shows
  the endpoints that touch it.
- "Copy for …" copies the selected tables and endpoints as a prompt for whichever agent the reader uses.
- Size, when the model has it: a bar of bytes beside each line of the index, the index ordered by rows or
  size, and a Size block on the entry that defines each figure; later the map can scale a node by size. Usage, when an add-on wrote it, is a panel on the entry: unused and suggested indexes, reads
  against writes.
- Dark mode follows the system. Works opened from a file, with no network.

## Local and deployed

`render` writes a static folder: `index.html` self-contained with the model inlined, the Markdown and
`schema.json`. Locally, open the file or run `serve`. Deployed, it is static files on GitHub Pages, Cloudflare
Pages or a bucket, with a workflow template in the repo. The page holds structure only, never rows, unless
the owner listed lookups to keep (their `values.json`), and a private database still belongs behind the
host's access control.

## The agent skill

A thin layer over the command, in `skills/dbtour` (0.6.0): when to use it, the extract-render-show-commit
flow, the MCP server a piece at a time, and how to write queries from the model's real names. The SQL
generator is the agent reading the model; the add-on gives it the tables to cite and runs the result.

How the SQL add-on runs a query, as decided with the owner: only through a connection of its own, from its
own environment variable, meant for a login with `db_datareader` alone; it refuses the extract's connection.
A single `SELECT` or `WITH`, inside a transaction that is always rolled back, with a row limit (100 by
default) and a timeout. Rows are shown, never written into the model. The page's SQL editor writes,
autocompletes the model's tables and columns, and copies, with "Copy for agent"; running stays in the
terminal and over MCP, since the page is a static file.

## The MCP server

`dbtour mcp` hands the model to an agent a piece at a time: an overview, search (the page's), one table's
Markdown, and the joins between two tables. It is in core, with no dependency, because it only reads the
model; it never connects to the database. Running queries is the SQL add-on's, behind its read-only login.

Two tools stage suggestions: `gaps` lists the tables and columns nothing describes, largest and most
related first, since those are the ones people ask about; `suggest` writes one proposal, with its reason, to
`dbtour.suggestions.yaml`. Neither touches the notes or the database: accepting and scripting stay with a
person.

## Showing it

Not before there is enough to show. Once milestones 5 to 9 are released (the skill installs with one
command, a database is set up from the page, a second database works, and a project can deploy its page and check it in CI), dbtour gets a card
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
   showing it: rows and bytes on the entry, the index ordered by them, lines weighted by rows.
4. **All the catalogue says**: every extended property, the table's features, column labels and masking,
   index kinds and untrusted keys from the SQL Server source, and the page and the Markdown showing
   them.
5. The skill and the SQL add-on, with the stats telling the agent where to look first. `dbtour mcp` came
   first (0.5.0), then the skill (0.6.0), then tables named with their database when there are
   several (0.7.0), running a query through a reader (0.8.0), and the page's SQL editor with `dbtour serve`
   running it (0.9.0).
6. **Setup on the page**: `dbtour serve` with nothing to serve opens a wizard, and a served page has a
   home that lists every database. Adding one: its kind and server, how it signs in (Entra through `az`, or
   a login), a test, and an offer to create its reader (`db_datareader` alone) with the admin's sign-in;
   then extract and render, and it is on the home. Settings without secrets are a file in `~/.dbtour`;
   passwords and connection strings go to the system's keychain (macOS Keychain, Windows Credential Manager,
   the Secret Service), named from the settings, never written to a file or shown again. `dbtour.yaml`
   and environment variables keep working as they do, for CI and agents. The keychain is a dependency, so it
   lives in a package of its own, not core. The design is drawn and agreed before it is built. ← here
7. `source-openapi` and table-to-endpoint links.
8. `source-postgres`, `source-mysql`, `source-sqlite`, `source-tbls`, `source-paste`; each reads the stats
   and the comments its database keeps.
9. Deploy workflow, `check`, `addon-lint`.
10. `addon-usage`: index and table usage from the management views, as a panel on the entry.
11. **Showing it**: the page on skills.victorsaly.com with its film and the live example, the script that
    records them, once 5 to 9 are released.
12. **Suggestions**: the origin of each description in the model, `dbtour.suggestions.yaml`, the MCP tools
    `gaps` and `suggest`, the *suggested* mark on the page and in the Markdown, `accept` and `reject`; then
    the kind of a table; then `dbtour script` for SQL Server's extended properties, and `check` naming notes
    the database now repeats. The skill learns to fill the gaps and stage what it finds.
13. **Values the owner chooses to keep**: `values` on a source, read through its reader into `values.json`,
    refused for protected or oversized tables and wherever the protection could not be read; the rows on
    the lookup's entry and beside each column that references it, with the day they were read; search over
    them; `table` over MCP including them; `render --without-values` for what is committed or deployed.

## Borrowed from

- tbls: the idea of a notes file that adds descriptions and virtual relations without altering the database.
- ChartDB: one read-only query per dialect, so no driver is needed when the user runs it themselves.
- Azimutt: the exploring: search everywhere, show a subset, follow a relation, save a layout.
- dbschema-markdown: extended properties for descriptions, computed columns, Markdown tables.
