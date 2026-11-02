// The home dbtour serve gives the databases set up on this machine: each a numbered entry with its facts and
// its dot, green when it has a reader and so can run queries; a database's own page lists them in the rail
// to switch between. Only on a served page: a page opened from a file is one database and knows no other.
import { useState, useSyncExternalStore } from 'react';
import { Mark, Wordmark } from './Logo.tsx';
import { databaseEntries, databaseHref, type Served } from './served.ts';
import { post, SetupPage } from './Setup.tsx';

/** The home's address for adding a database. */
export const addHash = '#add';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

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

/** A database set up but not read yet, as when the setup stopped before its last step: read it from here. */
function ReadNow({ served, name }: { served: Served; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const readIt = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await post(served, 'read', { name });
      window.location.assign(databaseHref(name));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <span className="database-read">
      {busy ? (
        <span className="status is-idle" role="status">
          Reading {name}…
        </span>
      ) : (
        <button type="button" className="sql-copy" onClick={readIt}>
          Read it
        </button>
      )}
      {error && (
        <span className="setup-error" role="alert">
          <span className="status is-failed">Not yet</span> {error}
        </span>
      )}
    </span>
  );
}

/**
 * The whole page at /: the rail with the mark, and the databases as entries, or the setup of one when there
 * are none yet or the person asked to add one.
 */
export function DatabasesHome({ served }: { served: Served }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const entries = databaseEntries(served.databases ?? []);
  // A reader made by the setup on this page counts before the page is next loaded.
  const [made, setMade] = useState(0);
  const readers = (served.databases ?? []).filter((d) => d.reader).length + made;
  const adding = served.setup === true && (entries.length === 0 || hash === addHash);
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
        {entries.length > 0 && (
          <nav aria-label="Databases">
            <a className={`side-map${adding ? '' : ' is-current'}`} href="#" aria-current={adding ? undefined : 'page'}>
              All databases
            </a>
            {served.setup && (
              <a className={`side-map${adding ? ' is-current' : ''}`} href={addHash} aria-current={adding ? 'page' : undefined}>
                Add a database
              </a>
            )}
          </nav>
        )}
      </aside>
      <main className="main">
        {adding ? (
          <SetupPage served={served} first={entries.length === 0} onReader={() => setMade((n) => n + 1)} />
        ) : (
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
                  {!e.href && served.setup && <ReadNow served={served} name={e.name} />}
                </li>
              ))}
            </ol>
            {served.setup && (
              <div className="actions">
                <a className="button setup-go" href={addHash}>
                  Add a database
                </a>
              </div>
            )}
            <p className="sql-hint databases-hint">
              The dot is green when a database has a reader, so its page can run queries. In a terminal, <code>npx dbtour list</code> shows the same.
            </p>
          </article>
        )}
      </main>
    </div>
  );
}
