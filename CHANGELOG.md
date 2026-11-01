# Changelog

## 0.3.0 (unreleased)

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
