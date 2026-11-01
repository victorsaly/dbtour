# Changelog

## 0.2.1 (unreleased)

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
