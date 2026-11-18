# Several databases on one page

Three sources in one `dbtour.yaml`, so one model, one page and one set of Markdown for all of them:

| Database | Kind | What it is |
|---|---|---|
| Shop | SQL Server | Made up for dbtour; the same as [`examples/shop`](../shop). |
| Chinook | SQLite | A digital music shop, by Luis Rocha: [lerocha/chinook-database](https://github.com/lerocha/chinook-database) 1.4.5, MIT licence. |
| Northwind | SQLite | Microsoft's trading company sample, as a SQLite file: [jpwhite3/northwind-SQLite3](https://github.com/jpwhite3/northwind-SQLite3), MIT licence. |

Only the model read from them is kept here (`docs/schema.json`): tables, columns, keys and sizes, never a row,
and not the files themselves.

```bash
npm run example            # renders it; open examples/several/docs/index.html
npm run example:several    # downloads the two files into data/ and reads them again
```

With several databases a table is named with its own, `Chinook:main.Track`, in the notes, in links and in
search. Each database keeps its own SQL in the editor: T-SQL for Shop, SQLite's for the other two.
