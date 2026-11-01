<div align="center">

<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo-light.svg#gh-dark-mode-only" alt="dbtour" width="220">
<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg#gh-light-mode-only" alt="dbtour" width="220">

**Tour your database and its API.**

[![version](https://img.shields.io/badge/version-0.2.0-blue)](CHANGELOG.md)
[![check](https://github.com/victorsaly/dbtour/actions/workflows/check.yml/badge.svg)](https://github.com/victorsaly/dbtour/actions/workflows/check.yml)

</div>

dbtour reads a database, writes what it finds to one model file in your repository, and renders that file as
Markdown GitHub shows with diagrams, and as a page developers search, follow relations in and hand to an agent.

SQL Server first. Other databases and the Claude Code skill follow the [plan](PLAN.md).

## Use

```bash
npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer
npx dbtour init                                  # writes dbtour.yaml
export DBTOUR_MSSQL='Server=localhost,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True'
npx dbtour extract                               # → docs/dbtour/schema.json
npx dbtour render                                # → docs/dbtour/README.md, one page per table, index.html
```

`dbtour.yaml`:

```yaml
out: docs/dbtour
sources:
  - type: mssql
    name: Shop
    connection: ${DBTOUR_MSSQL}   # the name of an environment variable, never the string itself
    exclude: [dbo.sys*, "*.webpages_*"]   # optional: tables to leave out
notes: dbtour.notes.yaml          # optional
addons:
  - explorer                      # the page; leave out for Markdown only
```

## The page

`docs/dbtour/index.html` is one file with the model inlined: open it from disk, or deploy the folder as it is.
It holds the structure and never the rows.

- `/` searches tables, columns and groups; arrows and Enter open a result.
- A table shows its columns with type, nullability, default, keys and description, the relations in and out
  as links, and its indexes and constraints below.
- **Diagram** draws the table with its neighbours one relation away, laid out by ELK. **+** on any node adds
  that table's neighbours; the browser's back button takes it away again. A group from the notes is a
  diagram of its tables.
- Every view has a URL: `#dbo.Orders`, `#dbo.Orders.Status`, `#diagram/dbo.Orders,dbo.Customers`,
  `#group/Billing`.
- **Copy for Claude** puts the table's Markdown on the clipboard, ready to paste into an agent.
- Every table has a number and every schema a colour, and each table is drawn as one line: a pulse per
  column, a key as a peak. Dark mode follows the system.

`dbtour.notes.yaml` adds what the database cannot say, and wins over it:

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

## Develop

```bash
npm install
npm run check      # lint, typecheck, tests with coverage (builds the page first)
npm run example    # renders examples/shop into examples/shop/docs; open examples/shop/docs/index.html
npm run e2e:page   # drives the page in Google Chrome
npm run brand      # redraws brand/ from the mark in packages/addon-explorer/src/mark.ts
```

## Licence

MIT
