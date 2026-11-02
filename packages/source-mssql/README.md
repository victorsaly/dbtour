<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg" alt="dbtour" width="220">

**The SQL Server source for [dbtour](https://www.npmjs.com/package/dbtour).**

It reads the catalogue and nothing else, so a login with `VIEW DEFINITION` on the database is enough. It
reads tables, views, columns, keys, relations, indexes and constraints; every extended property, under any
name; each table's rows and bytes as SQL Server counts them; temporal, memory-optimised, ledger,
partitioned and compressed tables, triggers, change tracking, change data capture and row-level security; a
column's collation, identity, masking and Always Encrypted. Sensitivity labels want `VIEW ANY SENSITIVITY
CLASSIFICATION` as well. It owns its driver (`mssql`), so nothing else in dbtour depends on it.

```bash
npm install --save-dev dbtour dbtour-source-mssql
```

```yaml
# dbtour.yaml
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}              # the name of an environment variable, never the string itself
    reader: ${DBTOUR_MSSQL_READER}           # optional: a read-only login of its own, for dbtour sql
```

Then `npx dbtour extract`. Setup, the page and the agent tools are in the [full README](https://github.com/victorsaly/dbtour#readme).
MIT licence.
