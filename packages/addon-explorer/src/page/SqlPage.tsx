// #sql: one editor for a query across the tables, for when it is not about one table. With several databases
// a picker says which one the query runs in, and autocomplete knows that one's names.
import { useState } from 'react';
import { driverName } from 'dbtour/markdown';
import type { Model } from 'dbtour/model';
import { SqlEditor } from './Sql.tsx';

export function SqlPage({ model }: { model: Model }) {
  const [database, setDatabase] = useState(model.databases[0]?.name);
  const chosen = model.databases.find((d) => d.name === database) ?? model.databases[0];
  const initial = `-- A query against ${chosen?.name ?? 'the database'}. Autocomplete knows every table and column;\n-- each table's page starts one from that table and what it references.\nSELECT TOP (100)\n    \n`;
  return (
    <article className="page sql-page">
      <header className="entry-head">
        <h1>SQL</h1>
        <p className="meta">
          <span>{chosen ? `${driverName(chosen.driver)} · ${chosen.name}` : 'No database'}</span>
        </p>
        <p className="description">Write a query with the model's names; copy it, or hand it to an agent with the tables it reads.</p>
        {model.databases.length > 1 && (
          <label className="sql-database">
            <span className="label">Database</span>
            <span className="select">
              <select value={chosen?.name} onChange={(event) => setDatabase(event.target.value)}>
                {model.databases.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}
      </header>
      <SqlEditor key={chosen?.name} model={model} database={chosen?.name} initial={initial} draft={`page:${chosen?.name ?? ''}`} />
    </article>
  );
}
