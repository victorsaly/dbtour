<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg" alt="dbtour" width="220">

**The SQLite source for [dbtour](https://www.npmjs.com/package/dbtour).**

It opens the file read-only and reads its catalogue: tables, views, columns, keys, relations, indexes
(partial and on expressions), CHECKs, generated columns, collations and triggers, and each table's rows and
bytes, counted from the file's pages rather than its rows. SQLite keeps no descriptions, but it keeps every
`CREATE TABLE` as it was written, so a comment there is one: on a column's line, or the line before it, it
describes the column; on the line of the opening bracket, the table.

```sql
CREATE TABLE orders ( -- One row per order a customer placed.
  id INTEGER PRIMARY KEY,
  total REAL NOT NULL -- In pounds, VAT included.
);
```

It uses the SQLite that Node ships (`node:sqlite`, Node 22.18 or later), so there is no driver to install
or build.

```bash
npm install --save-dev dbtour dbtour-source-sqlite
```

```yaml
# dbtour.yaml
sources:
  - type: sqlite
    name: Shop
    file: shop.db          # from the folder dbtour.yaml is in; a path is no secret, so it is written here
    reader: read-only      # optional: dbtour sql and the page run queries, each with the file opened read-only
```

Then `npx dbtour extract`. A query runs in a process of its own, killed if it runs past 30 seconds. The page
and the agent tools are in the [full README](https://github.com/victorsaly/dbtour#readme). MIT licence.
