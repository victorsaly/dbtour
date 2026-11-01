// The home dbtour serve gives the databases set up on this machine: each a numbered entry with its facts and
// its dot, green when it has a reader and so can run queries; a database's own page lists them in the rail
// to switch between. Only on a served page: a page opened from a file is one database and knows no other.
import { Mark, Wordmark } from './Logo.tsx';
import { databaseEntries, databaseHref, type Served } from './served.ts';

/** The rail's list of databases on a database's page: the others one click away, this one marked. */
export function Switcher({ served }: { served: Served }) {
  const databases = served.databases ?? [];
  return (
    <nav className="switcher" aria-label="Databases">
      <a className="label switcher-home" href="/">
        All databases
      </a>
      {databases.length > 1 && (
        <ul>
          {databases.map((d) => {
            const current = d.name === served.current;
            return (
              <li key={d.name}>
                <a href={d.read ? databaseHref(d.name) : '/'} className={current ? 'is-current' : ''} aria-current={current ? 'page' : undefined}>
                  <span className="name">{d.name}</span>
                  <span className={`status is-${d.reader ? 'live' : 'idle'}`}>
                    <span className="hidden-words">{d.reader ? 'has a reader' : 'no reader'}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

/** The whole page at /: the rail with the mark, and the databases as entries. */
export function DatabasesHome({ served }: { served: Served }) {
  const entries = databaseEntries(served.databases ?? []);
  const readers = (served.databases ?? []).filter((d) => d.reader).length;
  return (
    <div className="app">
      <aside className="side">
        <a className="brand" href="/" aria-label="dbtour, home">
          <Mark />
          <Wordmark />
        </a>
        <p className={`side-status status is-${readers ? 'live' : 'idle'}`}>
          Connected through dbtour serve{readers ? '' : ' · no reader'}
        </p>
      </aside>
      <main className="main">
        <article className="page databases">
          <header className="entry-head">
            <h1>Databases</h1>
            <p className="meta">
              <span>
                {entries.length} set up on this machine
              </span>
              {' · '}
              <span>
                {readers} with a reader
              </span>
            </p>
          </header>
          <ol className="database-entries">
            {entries.map((e) => (
              <li key={e.name} className="database-entry">
                <span className="no">{e.number}</span>
                {e.href ? (
                  <a className="name" href={e.href}>
                    {e.name}
                  </a>
                ) : (
                  <span className="name">{e.name}</span>
                )}
                <span className={`status is-${e.tone}`}>{e.status}</span>
                <span className="facts">
                  {e.facts.map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </span>
              </li>
            ))}
          </ol>
          <p className="sql-hint databases-hint">
            The dot is green when a database has a reader, so its page can run queries. To add a database, run <code>npx dbtour add &lt;name&gt; --server &lt;host&gt;</code>;
            the setup on this page comes next.
          </p>
        </article>
      </main>
    </div>
  );
}
