---
type: llm
weight: 2
---

PASS if the plan reads the database from the file itself: a dbtour.yaml source of type sqlite whose `file` is
data/app.db (or the same file by another path from where dbtour.yaml is), or `dbtour add <name> --file
data/app.db`. A SQLite file has no login, so the plan asks for no connection string, environment variable,
password or server. Mentioning that a SQL Server database would need a connection string is fine.
FAIL if it asks the person for a connection string, a password or an environment variable to reach the file,
writes a `connection:` entry for it, or installs or configures the SQL Server source (dbtour-source-mssql) as
the way to read this file.
