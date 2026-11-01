// The first view: the database as a stack of plots, one hairline per table, a key as a peak.
import { driverName } from 'dbtour/markdown';
import { findTable, relationsOf, type Model } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { Plot } from './Plot.tsx';
import { peaks, profile } from './plot.ts';
import { groupHash, tableHash } from './route.ts';
import { lastOpened } from './TableView.tsx';

// The stack fills the field: a few tables get tall lines, a long catalogue keeps a tight pitch that still
// shows every table. In pixels, the SVG's height; the label beneath adds its own line.
export function lineHeight(tables: number): number {
  return tables <= 12 ? 40 : tables <= 40 ? 24 : 14;
}

export function Home({ model, cat }: { model: Model; cat: Catalogue }) {
  const height = lineHeight(cat.entries.length);
  const last = lastOpened();
  return (
    <div className="with-panel">
      <article className="page home">
        {model.databases.map((database) => {
          const tables = database.schemas.flatMap((s) => s.tables);
          const views = tables.filter((t) => t.kind === 'view').length;
          return (
            <header key={database.name} className="entry-head">
              <h1>{database.name}</h1>
              <p className="meta">
                {driverName(database.driver)}
                {database.version ? ` ${database.version}` : ''} · {tables.length - views} tables · {views} {views === 1 ? 'view' : 'views'} · {database.relations.length} relations
              </p>
              {database.description && <p className="description">{database.description}</p>}
            </header>
          );
        })}

        <div className="label plots-label">Index · one line per table, a key is a peak</div>
        <ol className="plots">
          {cat.entries.map((entry, i) => {
            const found = findTable(model, entry.ref)!;
            const ticks = profile(found.table, relationsOf(model, entry.ref).out.flatMap((r) => r.from.columns));
            return (
              <li key={entry.ref} className={entry.ref === last ? 'is-last' : ''}>
                <a href={tableHash(entry.ref)}>
                  <span className="plot-label">
                    <span className="block" style={{ background: cat.colours.get(entry.schema) }} />
                    <span className="no">{entry.number}</span>
                    <span className="name">
                      {entry.table}
                      {found.table.kind === 'view' && <span className="tag">view</span>}
                    </span>
                  </span>
                  <Plot ticks={ticks} height={height} index={i} />
                </a>
              </li>
            );
          })}
        </ol>

        <p className="hint">
          Press <kbd>/</kbd> to search. An entry lists its columns and relations; Diagram draws it with its neighbours, and + on any node adds that table's
          neighbours too.
        </p>
      </article>

      <aside className="panel">
        <section>
          <h2>Schemas</h2>
          <ul className="legend">
            {[...cat.colours].map(([name, colour]) => (
              <li key={name}>
                <span className="block" style={{ background: colour }} />
                <span className="name">{name}</span>
                <span className="count">{cat.entries.filter((e) => e.schema === name).length}</span>
              </li>
            ))}
          </ul>
        </section>
        {model.groups.length > 0 && (
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
        )}
        <section>
          <h2>Reading a line</h2>
          <div className="key-sample">
            <Plot
              ticks={[
                { column: 'primary key', height: peaks.primary },
                { column: 'foreign key', height: peaks.foreign },
                { column: 'unique', height: peaks.unique },
                { column: 'column', height: peaks.plain },
              ]}
              height={36}
            />
            <div className="key-labels">
              <span>primary key</span>
              <span>foreign key</span>
              <span>unique</span>
              <span>column</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}
