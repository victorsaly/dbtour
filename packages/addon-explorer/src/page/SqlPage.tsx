// #sql: one editor for a query across the tables, for when it is not about one table. With several databases
// a picker says which one the query runs in, and autocomplete knows that one's names.
import { useState } from 'react';
import { driverName } from 'dbtour/markdown';
import { findTable, type Model } from 'dbtour/model';
import { dialectOf, firstRows } from './dialect.ts';
import { SqlEditor } from './Sql.tsx';
import { joinQuery, starterQuery } from './query.ts';
import { tableHash } from './route.ts';

export function SqlPage({ model, database: opened, table, to }: { model: Model; database?: string; table?: string; to?: string }) {
  // Opened from a table, or from a line of the map: the editor starts from that table's query, or the join of
  // the two, in the table's own database. Among several, it otherwise opens on the database the reader came
  // from; the list beside it changes it, and a database other than the seed's starts bare.
  const seed = table ? findTable(model, table) : undefined;
  const [database, setDatabase] = useState(seed?.database.name ?? opened ?? model.databases[0]?.name);
  const chosen = model.databases.find((d) => d.name === database) ?? model.databases[0];
  const rows = firstRows(dialectOf(chosen?.driver), 100);
  const seeded = seed !== undefined && seed.database.name === chosen?.name;
  const other = seeded && to ? findTable(model, to) : undefined;
  const bare = `-- A query against ${chosen?.name ?? 'the database'}. Autocomplete knows every table and column;\n-- each table's page starts one from that table and what it references.\n${rows.select}\n    \n${rows.end ? `${rows.end}\n` : ''}`;
  const initial = !seeded ? bare : other ? joinQuery(model, seed.ref, other.ref) : starterQuery(model, seed.ref);
  // A table's draft is the one its entry keeps, so what was written there is found here; a join has its own.
  const draft = !seeded ? `page:${chosen?.name}` : other ? `join:${seed.ref}>${other.ref}` : seed.ref;
  return (
    <article className="page sql-page">
      <header className="entry-head">
        <h1>SQL</h1>
        <p className="meta">
          <span>{chosen ? `${driverName(chosen.driver)} · ${chosen.name}` : 'No database'}</span>
        </p>
        <p className="description">Write a query with the model's names; copy it, or hand it to an agent with the tables it reads.</p>
        {seeded && (
          <p className="sql-seed">
            Started from <a href={tableHash(seed.ref)}>{seed.ref}</a>
            {other && (
              <>
                {' '}
                joined to <a href={tableHash(other.ref)}>{other.ref}</a>
              </>
            )}
            . <a href="#sql">Start bare</a>
          </p>
        )}
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
      {chosen ? (
        <SqlEditor key={draft} model={model} database={chosen.name} initial={initial} draft={draft} autoFocus />
      ) : (
        <p className="sql-hint">There is no database in the model to write a query against: extract one with <code>npx dbtour extract</code>.</p>
      )}
    </article>
  );
}
