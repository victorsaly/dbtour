// The left column: search, and when nothing is typed, every table grouped by schema and the groups.
import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { tableRef, type Model } from 'dbtour/model';
import { groupHash, tableHash, type Route } from './route.ts';
import { search, type Entry, type Hit } from './search.ts';

interface Props {
  model: Model;
  index: Entry[];
  route: Route;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function Sidebar({ model, index, route, inputRef }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const hits = useMemo(() => search(index, query), [index, query]);
  useEffect(() => setCursor(0), [query]);

  const open = (hit: Hit) => {
    window.location.hash = hit.kind === 'group' ? groupHash(hit.ref) : tableHash(hit.ref, hit.column);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === 'Enter' && hits[cursor]) {
      open(hits[cursor]);
    } else if (event.key === 'Escape') {
      setQuery('');
      event.currentTarget.blur();
    }
  };

  const currentTable = route.kind === 'table' ? route.ref : undefined;
  const currentGroup = route.kind === 'group' ? route.name : undefined;
  const searching = query.trim() !== '';

  return (
    <aside className="side">
      <a className="brand" href="#">
        <strong>dbtour</strong>
        <span>{model.databases.map((d) => d.name).join(', ')}</span>
      </a>
      <div className="search">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search tables and columns"
          aria-label="Search tables and columns"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {!searching && <kbd>/</kbd>}
      </div>
      {searching ? (
        <ul className="hits" role="listbox" aria-label="Results">
          {hits.length === 0 && <li className="empty">Nothing matches “{query.trim()}”.</li>}
          {hits.map((hit, i) => (
            <li key={`${hit.kind}:${hit.title}`} role="option" aria-selected={i === cursor} className={i === cursor ? 'is-cursor' : ''} onMouseEnter={() => setCursor(i)}>
              <a href={hit.kind === 'group' ? groupHash(hit.ref) : tableHash(hit.ref, hit.column)}>
                <span className="hit-title">{hit.title}</span>
                <span className="hit-detail">
                  <span className="hit-kind">{hit.kind}</span>
                  {hit.detail}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <nav className="tree">
          {model.databases.map((database) => (
            <section key={database.name}>
              {model.databases.length > 1 && <h2>{database.name}</h2>}
              {database.schemas.map((schema) => (
                <details key={schema.name} open>
                  <summary>
                    {schema.name}
                    <span className="count">{schema.tables.length}</span>
                  </summary>
                  <ul>
                    {schema.tables.map((table) => {
                      const ref = tableRef(schema.name, table.name);
                      return (
                        <li key={ref}>
                          <a href={tableHash(ref)} className={ref === currentTable ? 'is-current' : ''} aria-current={ref === currentTable ? 'page' : undefined}>
                            {table.name}
                            {table.kind === 'view' && <span className="tag">view</span>}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ))}
            </section>
          ))}
          {model.groups.length > 0 && (
            <section>
              <h2>Groups</h2>
              <ul>
                {model.groups.map((group) => (
                  <li key={group.name}>
                    <a href={groupHash(group.name)} className={group.name === currentGroup ? 'is-current' : ''} aria-current={group.name === currentGroup ? 'page' : undefined}>
                      {group.name}
                      <span className="count">{group.tables.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </nav>
      )}
    </aside>
  );
}
