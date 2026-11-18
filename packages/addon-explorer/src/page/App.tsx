// The shell: the rail with the search and the index, and the view the hash names.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Model } from 'dbtour/model';
import { catalogue, scopedCatalogue } from './catalogue.ts';
import { databaseOf, onlyDatabase, tablesOf } from './databases.ts';
import { AllDatabases } from './Several.tsx';
import { allTables } from './graph.ts';
import { canonicalRoute, parseRoute } from './route.ts';
import { buildIndex } from 'dbtour/search';
import { Sidebar } from './Sidebar.tsx';
import { Home } from './Home.tsx';
import { TableView } from './TableView.tsx';
import { DiagramView } from './Diagram.tsx';
import { SqlPage } from './SqlPage.tsx';
import { servedPage } from './Sql.tsx';
import { DatabasesHome } from './Databases.tsx';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The home of the databases set up on this machine when dbtour serve gives one; a catalogue otherwise. */
export function App({ model }: { model: Model }) {
  const served = servedPage();
  if (model.databases.length === 0 && served?.databases) return <DatabasesHome served={served} />;
  return <CatalogueApp model={model} />;
}

function CatalogueApp({ model }: { model: Model }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const route = useMemo(() => canonicalRoute(parseRoute(hash), model), [hash, model]);
  const index = useMemo(() => buildIndex(model), [model]);
  const cat = useMemo(() => catalogue(model), [model]);
  const searchInput = useRef<HTMLInputElement>(null);
  // With several databases the reader is in one of them or at the home of all. A view that is in none (the
  // editor, the whole map, a group) keeps the one they came from, so the rail does not lose its place; the
  // home lets go of it.
  const several = model.databases.length > 1;
  const stayed = useRef<string | undefined>(undefined);
  const here = databaseOf(model, route);
  if (route.kind === 'home') stayed.current = undefined;
  else if (here) stayed.current = here;
  const database = several ? stayed.current : undefined;

  useEffect(() => {
    // "/" focuses the search from anywhere, unless the user is already typing somewhere.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      event.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let view;
  switch (route.kind) {
    case 'home':
      view = several ? <AllDatabases model={model} /> : <Home model={model} cat={cat} />;
      break;
    case 'database': {
      const one = onlyDatabase(model, route.name);
      if (!one) {
        view = (
          <article className="page">
            <h1>No database named {route.name}</h1>
            <p>
              This page has {model.databases.map((d) => d.name).join(', ') || 'none'}. <a href="#">All databases</a> lists them.
            </p>
          </article>
        );
      } else if (route.map) {
        view = <DiagramView model={model} cat={cat} refs={tablesOf(one.databases[0])} title={`${route.name}, the whole database`} description="Every table of this database and every relation. Names keeps it readable; Keys and Columns add detail." defaultMode="names" />;
      } else {
        // Keyed by its name: the order chosen and the lines drawn are this database's, not the last one's.
        view = <Home key={route.name} model={one} cat={scopedCatalogue(cat, one)} />;
      }
      break;
    }
    case 'table':
      view = <TableView model={model} cat={cat} tableRef={route.ref} column={route.column} />;
      break;
    case 'diagram':
      view = <DiagramView model={model} cat={cat} refs={route.refs} title={`${route.refs[0]} and around it`} />;
      break;
    case 'map':
      view = <DiagramView model={model} cat={cat} refs={allTables(model)} title="The whole catalogue" description="Every table and every relation. Names keeps it readable; Keys and Columns add detail." defaultMode="names" />;
      break;
    case 'sql':
      // Keyed by what it is seeded from: another table is another editor, not this one with a stale choice.
      view = <SqlPage key={`${route.table ?? ''}>${route.to ?? ''}`} model={model} database={database} table={route.table} to={route.to} />;
      break;
    case 'group': {
      const group = model.groups.find((g) => g.name === route.name);
      view = group ? (
        <DiagramView model={model} cat={cat} refs={group.tables} title={group.name} description={group.description} />
      ) : (
        <article className="page">
          <h1>No group named {route.name}</h1>
          <p>The groups come from the notes file. Pick one from the index, or run dbtour render again.</p>
        </article>
      );
      break;
    }
  }

  return (
    <div className="app">
      <Sidebar model={model} cat={cat} index={index} route={route} database={database} inputRef={searchInput} />
      <main className="main">{view}</main>
    </div>
  );
}
