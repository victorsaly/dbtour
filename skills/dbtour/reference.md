# dbtour reference

## dbtour.yaml

```yaml
out: docs/dbtour
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}             # the name of an environment variable, never the string itself
    exclude: [dbo.sys*, "*.webpages_*"]     # optional: tables to leave out
notes: dbtour.notes.yaml                    # optional
addons:
  - explorer                                # the page; leave out for Markdown only
```

The packages: `dbtour` (the command), `dbtour-source-mssql` (SQL Server), `dbtour-addon-explorer` (the page).
Install all three in the project, `npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer`:
the command finds the source and the page by name in the project, so `npx dbtour` on its own cannot extract
or draw the page. Only `dbtour mcp`, which reads the model alone, runs without them.

A connection string is anything the mssql package takes, such as
`Server=host,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True`. The person sets it in
their own shell: `export DBTOUR_MSSQL='…'`. It never goes in a file.

## The commands

| Command | What it does |
|---|---|
| `npx dbtour init` | Writes `dbtour.yaml` here, for SQL Server. |
| `npx dbtour extract` | Reads each source into `<out>/schema.json`. Says what the login could not read. |
| `npx dbtour render` | Writes `<out>/README.md`, a page per table under `<out>/tables/`, and the add-ons' files. |
| `npx dbtour mcp [project]` | Serves the model over MCP on stdin and stdout, for an agent. |

Exit codes: 1 for what was asked, 2 for what is missing (no `dbtour.yaml`, no `schema.json`, an unset
variable), 3 for nothing to do. Every error says what to do next.

## dbtour.notes.yaml

What the database cannot say. It wins over the database when the docs are rendered.

```yaml
tables:
  dbo.Orders:
    description: One row per checkout. Lines are in dbo.OrderLines.
    columns:
      Status: 0 draft, 1 paid, 2 shipped, 9 cancelled
relations:
  - from: dbo.AuditLog.OrderId     # a relation nobody declared as a foreign key
    to: dbo.Orders.Id
groups:
  - name: Billing
    tables: [dbo.Orders, dbo.OrderLines, dbo.Invoices]
```

## The MCP server

`dbtour mcp` reads `schema.json` and the notes, again when they change, and never connects to the database.
Its four tools are read-only: **overview**, **search**, **table** and **path**.

- **Claude Code**, from the project's folder: `claude mcp add dbtour -- npx dbtour mcp`. Installing the dbtour
  plugin (`/plugin marketplace add victorsaly/dbtour`, then `/plugin install dbtour@dbtour`) adds it for you.
- **Claude Desktop, Cursor and other clients**: a server whose command is `npx` with the arguments
  `dbtour mcp /path/to/project`.

What it answers goes to the model provider the agent uses: a schema that must not leave a network wants a
model that stays inside it.
