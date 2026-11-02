# dbtour reference

## dbtour.yaml

```yaml
out: docs/dbtour
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}             # the name of an environment variable, never the string itself
    exclude: [dbo.sys*, "*.webpages_*"]     # optional: tables to leave out
    reader: ${DBTOUR_MSSQL_READER}          # optional: a read-only login of its own, for dbtour sql and query
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
| `npx dbtour render` | Writes `<out>/README.md`, a page per table under `<out>/tables/` (a folder per database when there are several), and the add-ons' files. |
| `npx dbtour mcp [project]` | Serves the model over MCP on stdin and stdout, for an agent. |
| `npx dbtour serve [--port 4321]` | Serves the rendered page on 127.0.0.1; with a `reader`, its SQL editor runs queries the same way as `dbtour sql`. For a person, not an agent: it runs until stopped. |
| `npx dbtour sql "<query>"` | Runs one SELECT through the source's `reader`, rolled back, at most `--limit` rows (100); `--source <name>` when several have a reader, `--json` for the rows as JSON. |

Exit codes: 1 for what was asked, 2 for what is missing (no `dbtour.yaml`, no `schema.json`, an unset
variable), 3 for nothing to do. Every error says what to do next.

### Databases set up on this machine

Without a `dbtour.yaml`, dbtour keeps databases in `~/.dbtour` (`DBTOUR_HOME` elsewhere): `databases.json`
with no secret in it, a folder per database for its model, notes and page, and every password in the system's
keychain under "dbtour · <name> · login" or "· reader". `dbtour-keychain` must be installed beside `dbtour`.

A person starts with one line, `npx -y -p dbtour -p dbtour-source-mssql -p dbtour-addon-explorer -p
dbtour-keychain dbtour serve`: it opens the home, whose setup does what the commands below do in five steps
(database, sign-in, test, reader, read), the reader's statements shown before a button runs them.

| Command | What it does |
|---|---|
| `npx dbtour add <name> --server <host> [--database <on the server>]` | Tests the connection, then saves it. Signs in with `az` unless `--sign-in login --user <login> --password-stdin`; the password comes only on stdin. `--password` is refused. |
| `npx dbtour reader <name> --create` | Prints the statements that make `dbtour_reader` (db_datareader alone) and exits 3. With `--confirm <name>` it runs them with the admin's sign-in, makes the password, keeps it in the keychain and signs in once to check. A login with any other role is refused. |
| `npx dbtour reader <name> --user <login> --password-stdin` | Uses a read-only login the person has, after signing in with it. |
| `npx dbtour read <name>` | Extracts and renders into the database's folder. |
| `npx dbtour list` | Each database: type, server and database, how dbtour signs in, the reader, when it was read. Never a secret. |
| `npx dbtour remove <name>` | Forgets it and its passwords. Keeps its folder, and says how to drop the reader. |

`sql`, `mcp` and `serve` take `--database <name>`; with several set up and none named, they stop and list the
names. `serve` with none named and no `dbtour.yaml` here serves the home: every database at `/db/<name>/`,
each page's queries through its own reader.

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
Its four tools are read-only: **overview**, **search**, **table** and **path**. When a source has a `reader`, a
fifth, **query**, runs one SELECT through it, as `dbtour sql` does; that one reads rows, not only the structure.

- **Claude Code**, from the project's folder: `claude mcp add dbtour -- npx dbtour mcp`. Installing the dbtour
  plugin (`/plugin marketplace add victorsaly/dbtour`, then `/plugin install dbtour@dbtour`) adds it for you.
- **Claude Desktop, Cursor and other clients**: a server whose command is `npx` with the arguments
  `dbtour mcp /path/to/project`.

What it answers goes to the model provider the agent uses: a schema that must not leave a network wants a
model that stays inside it.

## A reader login

`dbtour sql` and the **query** tool run only through a source's `reader`: a login of its own that can read and
nothing more. dbtour refuses the extract's connection for it. The person makes it, as the database's owner:

```sql
-- SQL Server: a login, and a user for it in the database.
CREATE LOGIN dbtour_reader WITH PASSWORD = '<a new password>';
USE Shop;
CREATE USER dbtour_reader FOR LOGIN dbtour_reader;
ALTER ROLE db_datareader ADD MEMBER dbtour_reader;

-- Azure SQL Database: a user contained in the database (or an Entra identity: CREATE USER [name] FROM EXTERNAL PROVIDER).
CREATE USER dbtour_reader WITH PASSWORD = '<a new password>';
ALTER ROLE db_datareader ADD MEMBER dbtour_reader;
```

Then `export DBTOUR_MSSQL_READER='Server=…;Database=Shop;User Id=dbtour_reader;Password=…'` in their own shell.
Even so, every query runs inside a transaction that is rolled back, with a row limit, a byte budget and a timeout.

What dbtour checks before a query runs is its shape: one read, nothing that writes, runs code or ends the
transaction. It cannot see what a name points to: a synonym, another database's table (`OtherDb.dbo.T`) or a
linked server. The reader's permissions are that boundary, so keep it to this database alone: a contained user
on Azure SQL, or on SQL Server a login with a user in this database and none in the others, no linked-server
login, and the `guest` user disabled where it need not be on.
