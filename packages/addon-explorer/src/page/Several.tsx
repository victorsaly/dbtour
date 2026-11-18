// A page of several databases: the home lists them, each an entry with its facts, and the rail switches
// between them, as the home dbtour serve gives the databases of a machine does. One file holds them all, so
// choosing one is a view of this page, not another page.
import type { Model } from 'dbtour/model';
import { databaseFacts } from './databases.ts';
import { databaseHash, groupHash } from './route.ts';

/** The rail's list of the databases on this page: all of them one click away, the one being read marked. */
export function DatabaseSwitcher({ model, database, home }: { model: Model; database: string | undefined; home: boolean }) {
  return (
    <nav className="switcher" aria-label="Databases">
      <a className={`label switcher-home${home ? ' is-current' : ''}`} href="#" aria-current={home ? 'page' : undefined}>
        All databases
      </a>
      <ul>
        {model.databases.map((d) => {
          const current = d.name === database;
          return (
            <li key={d.name}>
              <a href={databaseHash(d.name)} className={current ? 'is-current' : ''} aria-current={current ? 'page' : undefined}>
                <span className="name">{d.name}</span>
                <span className="count">{d.schemas.reduce((n, s) => n + s.tables.length, 0)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The home when the model has several databases: choose one to read its catalogue. */
export function AllDatabases({ model }: { model: Model }) {
  const tables = model.databases.reduce((n, d) => n + d.schemas.reduce((m, s) => m + s.tables.length, 0), 0);
  return (
    <div className="with-panel">
      <article className="page databases">
        <header className="entry-head">
          <h1>Databases</h1>
          <p className="meta">
            <span>{model.databases.length} on this page</span>
            {' · '}
            <span>{tables} tables and views in all</span>
          </p>
        </header>
        <ol className="database-entries">
          {model.databases.map((d, i) => (
            <li key={d.name} className="database-entry">
              <span className="no">{String(i + 1).padStart(3, '0')}</span>
              <a className="name" href={databaseHash(d.name)}>
                {d.name}
              </a>
              <span className="facts">
                {databaseFacts(d).map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </span>
              {d.description && <span className="about">{d.description}</span>}
            </li>
          ))}
        </ol>
        <p className="hint">
          Choose a database to read its catalogue; the rail switches to another, and All databases comes back here. Press <kbd>/</kbd> to search every one
          of them at once.
        </p>
      </article>
      {model.groups.length > 0 && (
        <aside className="panel">
          <section>
            <h2>Groups</h2>
            <ul className="legend">
              {model.groups.map((group) => (
                <li key={group.name}>
                  <a href={groupHash(group.name)} className="name">
                    {group.name}
                  </a>
                  <span className="count">{group.tables.length}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      )}
    </div>
  );
}
