<div align="center">

# dbtour

**Tour your database and its API.**

[![version](https://img.shields.io/badge/version-0.1.0-blue)](CHANGELOG.md)
[![check](https://github.com/victorsaly/dbtour/actions/workflows/check.yml/badge.svg)](https://github.com/victorsaly/dbtour/actions/workflows/check.yml)

</div>

dbtour reads a database, writes what it finds to one model file in your repository, and renders that file as
Markdown GitHub shows with diagrams, and as a page developers search, follow relations in and hand to an agent.

SQL Server first. Other databases, the page, and the Claude Code skill follow the [plan](PLAN.md).

## Use

```bash
npm install --save-dev dbtour dbtour-source-mssql
npx dbtour init                                  # writes dbtour.yaml
export DBTOUR_MSSQL='Server=localhost,1433;Database=Shop;User Id=reader;Password=…;TrustServerCertificate=True'
npx dbtour extract                               # → docs/dbtour/schema.json
npx dbtour render                                # → docs/dbtour/README.md and one page per table
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
```

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
npm run check      # lint, typecheck, tests with coverage
npm run example    # renders examples/shop into examples/shop/docs
```

## Licence

MIT
