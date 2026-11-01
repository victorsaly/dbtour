# Changelog

## 0.9.1 (unreleased)

- Autocomplete reads the query as the editor parses it, to offer what belongs at the caret. In the select
  list, WHERE, ON, GROUP BY and SET, the columns of the tables in scope come before keywords, in the table's
  order, written with their table's alias when more than one is in scope; a subquery sees its own tables
  first, then its outer query's, and statements are scoped apart with or without a semicolon. After an alias
  and a dot, that table's columns alone, inside a subquery too, and no keywords. After ON, the condition the
  keys give between the joined table and those before it, as a join writes it. The joins after JOIN keep
  their order (what a table points at first) rather than the alphabet's. `test/complete.test.ts` holds it
  to cases, run as the editor runs them.

## 0.9.0 (1 November 2026)

- The page's SQL editor, the last of the plan's fifth milestone. Every entry has a Query section after its
  columns: an editable CodeMirror editor that starts from the table and a LEFT JOIN to each table it
  references that has a name-like column (Name, Title, Code, Sku…), newest first by the primary key, with
  masked, encrypted and labelled columns left out and named in a comment. "Write SQL" in the rail opens
  `#sql`, an editor for any query, with a database picker when there are several.
- Autocomplete knows the database's schemas, tables and columns by the names SQL uses there (Sales:dbo is
  dbo), case-insensitive as SQL Server is, quoting a name that needs it with [brackets].
- Copy query, Copy query for the remembered agent (the query, what to check in it, and the tables it reads
  as the docs write them), and Reset; the reader's draft is kept in their browser. Opened from a file, the
  page says `dbtour sql` or the MCP `query` tool runs the query.
- `dbtour serve [--port 4321]` serves the rendered folder on 127.0.0.1, and with a source's `reader` the
  editor runs its query there, checked and rolled back as `dbtour sql` does. Only the page it served can
  ask: a token given to the page, and the Host and Origin it must come from, so another site, or a name
  rebound to this address, cannot; such a name gets neither the page nor its files.
- On a served page the editor's bar says whether it is connected and through which source, and its dot is
  the last run: grey before one and while it runs, green answered, red failed. Run, or ⌘/Ctrl+Enter, shows
  the rows under the query with how many, how long and through which reader; the run before stays, dimmed,
  while the next goes or after it fails. Auto-run, off until ticked and remembered in the browser, runs the
  query each time typing pauses, never one the check would refuse (it says why it waits) or the one just
  sent, one at a time.
- Autocomplete says what each name is (a table and its rows, a view, a column's type, key and reference),
  and after JOIN offers the tables related to those already in the query with the ON clause written. The
  caret, selection and current line are drawn in the page's colours, so they show on the dark field.
- Fixed: a query SQL Server refused (a table that is not there) left the SQL Server source waiting for
  ever: the driver reports the error before the request ends, the rollback asked for then was refused and
  the connection stayed held. The error is now given once the request ends, at once.
- `checkQuery` is exported as `dbtour/sql`, so the page checks a query as the server will before auto-run
  sends it.
- The plan's next milestone is a setup wizard on `dbtour serve`: add a database, test it, give it a reader,
  and keep its secrets in the system's keychain. OpenAPI moves to the seventh.

## 0.8.0 (1 November 2026)

- Running a query, the first half of the SQL add-on. A source gets a `reader` in `dbtour.yaml`: the
  environment variable for a login of its own with `db_datareader` alone. `dbtour sql "<query>"` runs one
  SELECT through it (`--limit`, `--source`, `--json`), and `dbtour mcp` offers a `query` tool beside the others
  when a source has one. dbtour refuses a reader that names the extract's variable or holds its connection
  string.
- What runs is checked first, in core (`checkQuery`), reading T-SQL's strings, quoted names and comments as
  SQL Server does: one SELECT or WITH, nothing that writes, runs code, declares or sets, reaches out of the
  database (OPENROWSET and the like) or writes a table with SELECT … INTO. A refusal says why and never
  connects.
- The SQL Server source exports `run()`: inside a transaction that is always rolled back, rows streamed
  into a collector that stops at the limit (100 by default, 5,000 at most) or 10 MB, whichever comes first,
  and cancels the query there, `SET ROWCOUNT` one row past the limit, cancelled after 30 seconds (the driver's
  own timeout set past it), rows as arrays so two columns of one name both come back. The result is a table
  for the terminal and the agent, or JSON.
- The check does not trust semicolons, which T-SQL does not need: a second top-level SELECT not joined by
  UNION, EXCEPT or INTERSECT is refused, as are transaction control, NEXT VALUE FOR (a sequence moves on
  through a rollback) and a `--` comment's carriage return hiding a statement. It cannot see what a name
  points to, so the reader's permissions are the boundary for other databases and linked servers, as
  `reference.md` says. Two sources of one name are refused rather than guessed between, and a query tool call
  that fails is the call's error, never the MCP server's end.
- The skill learns to run what it writes: read the tables first all the same, select only what the question
  needs, leave protected columns out, and without a reader hand the query over rather than ask for a login.
  `reference.md` shows how to make the reader, on SQL Server and Azure SQL.
- `dbtour init` writes the `reader` line, commented out.

## 0.7.1 (1 November 2026)

- The skill, tightened by its evals. It never quotes a password back, not even to point at it, and shows the
  variable as `export DBTOUR_MSSQL='Server=…;Password=…'`. With no model to read (no MCP tools, no docs) it
  writes no SQL, nor a fragment with likely names: it says what it will read and describes the query in words
  or with placeholders that are plainly not names. With the skill, every case now scores 1.00 against
  0.00 to 1.00 without it (`claude plugin eval .`).
- Two graders say what they allow: the person setting the variable with `export` in their own shell, the rest
  of a connection string with the password left out, and a query written wholly in placeholders.

## 0.7.0 (1 November 2026)

- Several databases, each its own namespace. With more than one source, a table is named with its database,
  `Sales:dbo.Customers`, everywhere a name is read or shown: the Markdown writes each database's tables
  in a folder of its own (`tables/Sales/dbo.Customers.md`, links between them unchanged), the page's
  addresses (`#Sales:dbo.Customers`, the colon kept readable), its index, search and colours, and the MCP
  tools. Before, two databases with a `dbo.Customers` overwrote each other's page and the notes and the
  page reached only the first. `schema.json` is unchanged: `scope()` names each schema `Database:schema`
  as the model is read, so one database keeps the names it has always had.
- A name without its database still works wherever only one database has the table: in the notes, an old
  page link (`#dbo.Payments` opens `Billing:dbo.Payments`) and an agent's question. Where both have it, the
  notes warn with the two names to choose from, the page offers both, and the MCP tools ask which. A
  relation in the notes between two databases is refused, since relations stay inside one.
- `validate()` wants each database named apart, without a dot, a colon or a slash, once there are several:
  `extract` stops on two sources with the same `name` and says to rename one.
- The SQL `path` writes keeps the database out of its names, since it runs in that database; with one
  database a colon in a name is part of it and stays.
- The Markdown's links are URLs: a space, a `#` or a colon in a database, schema or table name is encoded,
  so the link reaches its page. The files keep their names.
- The skill says how to read and write a name with its database.

## 0.6.0 (1 November 2026)

- The dbtour agent skill, the first half of the plan's fifth milestone. `npx skills add victorsaly/dbtour`
  installs it in any agent that reads Agent Skills. It tells the agent when to reach for dbtour (documenting a
  database, finding where data lives, explaining a schema, writing SQL against the project's database), how
  to set it up with the connection string in an environment variable the person sets and never in a file or
  the conversation, to ask the MCP server a piece at a time (overview, search, table, path), and to write SQL
  only from names it has read: joins from the model's relations, `TOP` on large tables, protected columns
  left out unless asked for. `reference.md` has the config, the notes and the MCP setup per client.
- The repository is a Claude Code plugin: `/plugin marketplace add victorsaly/dbtour`, then
  `/plugin install dbtour@dbtour`, brings the skill and starts `dbtour mcp` for the project. Its icon is
  `brand/mark.png`, which `npm run brand` now draws.
- Tests hold the skill to the code (every MCP tool and command it names exists, its version is the packages'),
  and `evals/` has four cases for what an agent does with it, run with `claude plugin eval .`.
- The plan records how the SQL add-on will run queries: through a read-only login of its own, never the
  extract's connection.

## 0.5.0 (1 November 2026)

- `dbtour mcp`: the model over the Model Context Protocol, so Claude, or any agent that speaks it, asks
  about the database instead of being handed all of it. `claude mcp add dbtour -- npx dbtour mcp` in the
  project, or `npx dbtour mcp <project>` for a client that starts elsewhere. Four read-only tools:
  `overview` (the databases and their tables, largest first, all of them up to 100), `search`, `table`
  (the table's Markdown, as the docs and "Copy for …" hold it; a bare name or any case finds it, and an
  unknown one gets suggestions) and `path` (the shortest chain of relations between two tables as JOINs,
  within one database, every name quoted as that database quotes it, a relation from the notes marked as
  such). It reads `schema.json` and the notes again when either changes, writes only answers to stdout,
  refuses a request that is not JSON-RPC 2.0, and speaks protocol versions 2024-11-05 to 2025-11-25
  without a dependency: JSON-RPC on stdin and stdout, written in core.
- Search moves from the page into core as `dbtour/search`, so the page and the agent find the same tables
  in the same order.
- The smoke test asks the installed `dbtour mcp` for a table.

## 0.4.0 (1 November 2026)

- All the catalogue says, the plan's fourth milestone. The SQL Server source reads everything the database
  keeps about its objects, still with `VIEW DEFINITION` alone: every extended property under any name on
  the database, schemas, tables, columns, indexes and constraints (`properties`); when a table was created
  and altered, whether it is system-versioned (with its history table and period columns), memory-optimised,
  a ledger table, partitioned or compressed (read from every partition, a mix said as a list), its triggers, change tracking, change data capture and
  row-level security; a column's collation where it differs from the database's, its identity seed and
  increment, sparse, masking function and Always Encrypted; index kinds, filters and disabled indexes; keys
  and checks disabled or no longer trusted. Sensitivity labels are read when the login holds `VIEW ANY
  SENSITIVITY CLASSIFICATION`; without it the model says so in `unread` and `extract` prints it. What an
  older server lacks (temporal before 2016, labels before 2019, ledger before 2022) is read through text the
  batch assembles after asking, so it is absent there rather than failing the query. The query returns
  thirteen result sets.
- The Markdown: a table page gains Features, Properties, Triggers and Row-level security sections, an
  index Kind column, keys "not trusted", and a column's collation, identity seed, masking, encryption and
  label; the index says the collation, the database and schema properties, and what was not read. A model
  without any of it renders as before.
- The page: an entry's About block puts each feature in a plain sentence, with the dates and the table's
  properties; a Protection column shows labels, masks and encryption; triggers and row-level security are
  sections of their own; the home says the collation, what was not read, and the database and schema
  properties.
- SQL is coloured in VS Code's Dark+ and Light+ colours: a view's or a trigger's definition sits in a
  read-only CodeMirror 6 editor (MSSQL dialect, line numbers, folding) with a Copy button, the editor a SQL
  generator will write in later; a check, filter, predicate, default or computed expression in a table cell
  is coloured by the same parser, built-in functions apart from names. Monaco was measured and left for the SQL add-on, since it would
  more than double every page (2.3 MB against CodeMirror's 431 KB).
- Colour where it means something: a sensitivity rank is a round dot from grey to red, its words beside it;
  a disabled or untrusted key, check, index, trigger or policy carries a red warning triangle; each About
  term leads with its schema's block. Square, dot and triangle keep the three kinds of mark apart.
- The entry's plot is interactive: a tick's tooltip, in the page's own style rather than the browser's,
  says the column, its type, what its peak means (a foreign key with its target), its description, null,
  default, identity, protection and properties; ← and → walk the ticks from the keyboard; and the plot and
  the columns table point at the same column, a tick lighting its row and a row lifting its tick.
- The shop example carries some of it: Orders partitioned, compressed, change-tracked, with an audit
  trigger; Customers.Email masked and labelled; Invoices an append-only ledger table.
- The plan moves on to the skill and the SQL add-on, and its page section describes sizes as they are drawn.

## 0.3.0 (1 November 2026)

- Size and shape, the plan's third milestone. The SQL Server source reads each table's rows and its bytes
  of data and of indexes from `sys.partitions` and `sys.allocation_units`, catalogue views, so a login
  with `VIEW DEFINITION` is still all it needs; the model keeps them as `stats` on the table and when they
  were read as `statsReadAt` on the database, and `validate()` checks them. A view has none, an indexed
  view included, and a columnstore's delta stores, which `sys.partitions` does not list, are counted with
  it.
- The Markdown: the index gains Rows and Size columns, and a table's page says "About 48,213 rows · 7.1 MB
  of data · 1.6 MB of indexes, as the database counted them on 2026-11-01", since the count is the
  database's estimate. A model without stats renders as before.
- The page: a size bar beside each line of the home's index, its length the table's bytes against the
  largest table's, data solid and indexes outlined, with the rows and size written over it (a view says it has no rows of its own; a table without stats says
  nothing); the index can
  be read by Rows or Size, largest first, as well as in catalogue order, remembered in the browser; and a
  key under the index and "Reading a bar" in the panel say what the bar and each figure are. The plot line
  keeps one meaning, the columns and keys. An entry opens on a Size block: its rows, its place among the
  tables by rows, a bar of its data and indexes with each figure named, the date they were counted, and
  what rows, data and indexes mean. The database's meta line keeps each item whole at phone width.
- A publish npm refuses ends in a sentence saying what to do, not a Node stack trace: for "OIDC permission
  denied", the `npm trust github … --allow-publish` command that lets the workflow publish; for a 404, the
  trusted publisher to set on npmjs.com. A publish by hand keeps the terminal, so npm can still ask for the
  one-time password.
- The plan moves on to the skill and the SQL add-on.

## 0.2.4 (1 November 2026)

- The release workflow retries a failed publish. It decides the tag and the publish apart: a version
  already tagged is not tagged again, and a version npm lacks is published package by package, even when
  it was tagged earlier. It publishes only from the tag's commit, since npm's provenance names the commit
  the run started on: re-running the failed run does it, and so does `gh workflow run release.yml --ref
  v<version>`; a run on a later commit warns with that command instead. 0.2.3 never reached npm because its
  trusted publisher was not set up in time. `package-lock.json` carries the new version too.

## 0.2.3 (1 November 2026)

- `npm run release -- --publish` publishes a version the workflow has already tagged, from a checkout of
  that tag, which is how a version gets to npm until npm trusts the workflow, or after its publish failed.
  It used to refuse because the tag existed, and after a successful publish it crashed. It asks npm first
  and publishes only the packages npm does not have at that version, so a publish that stopped part way can
  simply be run again; if npm cannot be asked, it stops before publishing anything. A version's release
  notes no longer take the section of a longer version it is the start of (0.2.2 and 0.2.20). The release
  script has tests, run by `npm test`.
- The plan gains its seventh milestone, showing it: a page on skills.victorsaly.com with a film and the live
  example, recorded from `examples/shop`, once milestones 3 to 6 are released.

## 0.2.2 (1 November 2026)

- Releases are automatic. Merging to main with a new version tags it, creates the GitHub release from
  that version's changelog section, and publishes the packages to npm with provenance through trusted
  publishing once the repository variable `NPM_TRUSTED_PUBLISHING` is set (`.github/workflows/release.yml`).
  `npm run release` does the same by hand, and refuses to move a tag that exists.

## 0.2.1 (1 November 2026)

- The packages ship JavaScript. 0.2.0 shipped TypeScript, which Node refuses to run from inside
  node_modules, so `npx dbtour` failed on install. `npm run build` now compiles each package into `dist/`
  (and `prepack` does it on publish); the repository still runs the `.ts` as it is. A smoke test installs
  the packed tarballs into an empty project and runs `dbtour` from there, in CI too.

## 0.2.0 (1 November 2026)

- `dbtour-addon-explorer`: the page. Search over tables, columns and groups; a table view with its columns,
  keys, relations both ways, indexes and constraints; a diagram of a table with its neighbours that grows one
  node at a time, and the groups from the notes as diagrams of their own. One HTML file with the model
  inlined, opened from disk or deployed as it is, dark mode from the system, and "Copy for Claude" to hand a
  table to an agent.
- The map: every entry page carries a small map of its neighbourhood with a link to the full one; `#map`
  draws the whole catalogue; three levels of detail (Names, Keys, Columns) and a Links panel that switches
  relations off, singly or as declared versus from the notes.
- Copy for any agent: the button names the tool you choose (Claude, ChatGPT, Gemini, Copilot, Cursor or
  any agent), remembers it, and offers to open a tool's web chat.
- The mark is a database cylinder with the pulse through it; the wordmark sets "db" in the mono face.
- The page's look: a catalogue on a matte black field (the white sleeve in light mode), every table numbered,
  every schema a colour block, and each table drawn as a hairline plot with a pulse per column and a key as a
  peak. Archivo and Red Hat Mono ride inside the file under the OFL. The dbtour mark, wordmark and social
  image are in `brand/`, and the page carries the mark as its favicon.
- Core: `addons` in `dbtour.yaml`. `render` loads each add-on, lets it enrich the model and writes what it
  renders beside the Markdown. `renderTableMarkdown`, `isUniqueColumn` and `driverName` are exported, and
  `dbtour/model` and `dbtour/markdown` are subpath exports for code that wants no YAML parser.

## 0.1.0 (1 November 2026, in the same release)

- Core: the model and its JSON Schema, notes merge, Markdown with Mermaid diagrams, the `init`, `extract`
  and `render` commands.
- `dbtour-source-mssql`: SQL Server tables, views, columns, keys, foreign keys with composite columns,
  indexes, check constraints, and `MS_Description` on tables, columns and the database.
