// The shell: the rail with the search and the index, and the view the hash names.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Model } from 'dbtour/model';
import { catalogue } from './catalogue.ts';
import { parseRoute } from './route.ts';
import { buildIndex } from './search.ts';
import { Sidebar } from './Sidebar.tsx';
import { Home } from './Home.tsx';
import { TableView } from './TableView.tsx';
import { DiagramView } from './Diagram.tsx';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function App({ model }: { model: Model }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const index = useMemo(() => buildIndex(model), [model]);
  const cat = useMemo(() => catalogue(model), [model]);
  const searchInput = useRef<HTMLInputElement>(null);

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
      view = <Home model={model} cat={cat} />;
      break;
    case 'table':
      view = <TableView model={model} cat={cat} tableRef={route.ref} column={route.column} />;
      break;
    case 'diagram':
      view = <DiagramView model={model} cat={cat} refs={route.refs} title={`${route.refs[0]} and around it`} />;
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
      <Sidebar model={model} cat={cat} index={index} route={route} inputRef={searchInput} />
      <main className="main">{view}</main>
    </div>
  );
}
