// The rail: the mark, the search, and the index, every table numbered under its schema's colour block.
import { useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { tableRef, type Model } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { Mark } from './Logo.tsx';
import { groupHash, tableHash, type Route } from './route.ts';
import { search, type Entry, type Hit } from './search.ts';

interface Props {
  model: Model;
  cat: Catalogue;
  index: Entry[];
  route: Route;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function Sidebar({ model, cat, index, route, inputRef }: Props) {
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
      <a className="brand" href="#" aria-label="dbtour, home">
        <Mark size={22} />
        <span className="wordmark">dbtour</span>
      </a>
      <div className="side-db label">{model.databases.map((d) => d.name).join(' · ')}</div>
      <div className="search">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search the catalogue"
          aria-label="Search tables, columns and groups"
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
                <span className="no">{hit.kind === 'group' ? 'grp' : cat.byRef.get(hit.ref)?.number}</span>
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
        <nav className="tree" aria-label="Index">
          <div className="label">Index</div>
          {model.databases.map((database) => (
            <section key={database.name}>
              {model.databases.length > 1 && <h2>{database.name}</h2>}
              {database.schemas.map((schema) => (
                <div key={schema.name} className="schema">
                  <div className="schema-head">
                    <span className="block" style={{ background: cat.colours.get(schema.name) }} />
                    <span className="schema-name">{schema.name}</span>
                    <span className="count">{schema.tables.length}</span>
                  </div>
                  <ul>
                    {schema.tables.map((table) => {
                      const ref = tableRef(schema.name, table.name);
                      const current = ref === currentTable;
                      return (
                        <li key={ref}>
                          <a href={tableHash(ref)} className={current ? 'is-current' : ''} aria-current={current ? 'page' : undefined}>
                            <span className="no">{cat.byRef.get(ref)?.number}</span>
                            <span className="name">{table.name}</span>
                            {table.kind === 'view' && <span className="tag">view</span>}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {model.groups.length > 0 && (
            <section>
              <div className="label">Groups</div>
              <ul>
                {model.groups.map((group) => {
                  const current = group.name === currentGroup;
                  return (
                    <li key={group.name}>
                      <a href={groupHash(group.name)} className={current ? 'is-current' : ''} aria-current={current ? 'page' : undefined}>
                        <span className="no">{String(group.tables.length).padStart(3, ' ')}</span>
                        <span className="name">{group.name}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </nav>
      )}
    </aside>
  );
}
