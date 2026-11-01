// The rail: the mark, the search, and the index, every table numbered under its schema's colour block. On a
// phone the index folds behind the search so the view keeps the first screen.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { tableRef, type Model } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { Mark, Wordmark } from './Logo.tsx';
import { groupHash, mapHash, tableHash, type Route } from './route.ts';
import { search, type Entry, type Hit } from 'dbtour/search';

/** Below this width the index folds; the same breakpoint as the stylesheet's. */
const phoneQuery = '(max-width: 800px)';

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(phoneQuery).matches);
  useEffect(() => {
    const media = matchMedia(phoneQuery);
    const onChange = () => setPhone(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return phone;
}

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
  const phone = usePhone();
  // The arrows move the cursor while focus stays in the input, so the cursor's row is kept in view.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, hits]);

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
  const current = currentTable ? cat.byRef.get(currentTable) : undefined;
  const searching = query.trim() !== '';

  const tree = (
    <nav className="tree" aria-label="Index">
      {!phone && <div className="label">Index</div>}
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
                  const isCurrent = ref === currentTable;
                  return (
                    <li key={ref}>
                      <a href={tableHash(ref)} className={isCurrent ? 'is-current' : ''} aria-current={isCurrent ? 'page' : undefined}>
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
              const isCurrent = group.name === currentGroup;
              return (
                <li key={group.name}>
                  <a href={groupHash(group.name)} className={isCurrent ? 'is-current' : ''} aria-current={isCurrent ? 'page' : undefined}>
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
  );

  return (
    <aside className="side">
      <a className="brand" href="#" aria-label="dbtour, home">
        <Mark size={22} />
        <Wordmark />
      </a>
      <div className="side-db label">{model.databases.map((d) => d.name).join(' · ')}</div>
      <div className="search">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search the catalogue"
          aria-label="Search tables, columns and groups"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls="search-hits"
          aria-activedescendant={searching && hits[cursor] ? `hit-${cursor}` : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {!searching && <kbd>/</kbd>}
      </div>
      <a className={`side-map${route.kind === 'map' ? ' is-current' : ''}`} href={mapHash} aria-current={route.kind === 'map' ? 'page' : undefined}>
        Map of the whole catalogue
      </a>
      {searching ? (
        <ul className="hits" id="search-hits" ref={list} role="listbox" aria-label="Results">
          {hits.length === 0 && <li className="empty">Nothing matches “{query.trim()}”.</li>}
          {hits.map((hit, i) => (
            <li key={`${hit.kind}:${hit.title}`} id={`hit-${i}`} role="option" aria-selected={i === cursor} className={i === cursor ? 'is-cursor' : ''} onMouseEnter={() => setCursor(i)}>
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
      ) : phone ? (
        <details className="fold">
          <summary>
            <span className="label">Index</span>
            {current && (
              <span className="fold-current">
                <span className="no">{current.number}</span> {current.ref}
              </span>
            )}
          </summary>
          {tree}
        </details>
      ) : (
        tree
      )}
    </aside>
  );
}
