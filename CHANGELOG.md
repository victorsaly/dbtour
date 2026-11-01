# Changelog

## 0.2.0 (unreleased)

- `dbtour-addon-explorer`: the page. Search over tables, columns and groups; a table view with its columns,
  keys, relations both ways, indexes and constraints; a diagram of a table with its neighbours that grows one
  node at a time, and the groups from the notes as diagrams of their own. One HTML file with the model
  inlined, opened from disk or deployed as it is, dark mode from the system, and "Copy for Claude" to hand a
  table to an agent.
- The page's look: a catalogue on a matte black field (the white sleeve in light mode), every table numbered,
  every schema a colour block, and each table drawn as a hairline plot with a pulse per column and a key as a
  peak. Archivo and Red Hat Mono ride inside the file under the OFL. The dbtour mark, wordmark and social
  image are in `brand/`, and the page carries the mark as its favicon.
- Core: `addons` in `dbtour.yaml`. `render` loads each add-on, lets it enrich the model and writes what it
  renders beside the Markdown. `renderTableMarkdown`, `isUniqueColumn` and `driverName` are exported, and
  `dbtour/model` and `dbtour/markdown` are subpath exports for code that wants no YAML parser.

## 0.1.0 (unreleased)

- Core: the model and its JSON Schema, notes merge, Markdown with Mermaid diagrams, the `init`, `extract`
  and `render` commands.
- `dbtour-source-mssql`: SQL Server tables, views, columns, keys, foreign keys with composite columns,
  indexes, check constraints, and `MS_Description` on tables, columns and the database.
