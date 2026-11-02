<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg" alt="dbtour" width="220">

**The [dbtour](https://www.npmjs.com/package/dbtour) page: your schema as one HTML file that opens without a
server.**

`dbtour render` writes `index.html` with the model inlined. Open it from disk or deploy the folder as it
is. It holds the structure, never the rows.

- `/` searches tables, columns and groups.
- Every table is an entry: columns with types, keys, defaults and descriptions, relations in and out as
  links, indexes and constraints, and a map of its neighbours.
- **Open the map** draws the tables and their relations large; **+** adds a table's neighbours.
- A SQL editor completes and checks names against the model, and copies a query for an agent. Opened
  through `dbtour serve`, it runs the query with a read-only login.

```bash
npm install --save-dev dbtour dbtour-addon-explorer
```

```yaml
# dbtour.yaml
addons:
  - explorer
```

Setup and sources are in the [full README](https://github.com/victorsaly/dbtour#readme). MIT licence; the two inlined fonts are under the OFL.
