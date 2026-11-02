<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg" alt="dbtour" width="220">

**Schema docs for your database, kept in your repository, for people and agents.**

dbtour reads a database's catalogue (never its rows), writes the structure to one model file in your
repository, and renders it three ways:

- **Markdown** GitHub shows, one page per table, with Mermaid diagrams of the relations.
- **A page**: one HTML file that opens from disk. Search every table and column, follow relations, draw the
  map, and copy a table for an agent.
- **An MCP server** (`dbtour mcp`): an agent finds the table, reads it and writes SQL from the real names.

This is the command and the model. A database is read by a source; SQL Server is the first.

```bash
npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer
npx dbtour init        # writes dbtour.yaml
export DBTOUR_MSSQL='Server=localhost,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True'
npx dbtour extract     # → docs/dbtour/schema.json
npx dbtour render      # → docs/dbtour/README.md, one page per table, index.html
```

The connection string comes from an environment variable named in `dbtour.yaml`, never from the file.

| Package | What it does |
|---|---|
| `dbtour` | The command, the model, the Markdown, the MCP server |
| [`dbtour-source-mssql`](https://www.npmjs.com/package/dbtour-source-mssql) | Reads SQL Server |
| [`dbtour-addon-explorer`](https://www.npmjs.com/package/dbtour-addon-explorer) | Renders the page |

Everything else, the Claude Code plugin, running a query and `dbtour serve`, is in the
[full README](https://github.com/victorsaly/dbtour#readme). Changes are in the [changelog](https://github.com/victorsaly/dbtour/blob/main/CHANGELOG.md). MIT licence.
