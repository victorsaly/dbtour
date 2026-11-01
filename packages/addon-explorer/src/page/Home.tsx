// The first view: the database as a stack of plots, one hairline per table, a key as a peak.
import { driverName } from 'dbtour/markdown';
import { findTable, relationsOf, type Model } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { Plot } from './Plot.tsx';
import { profile } from './plot.ts';
import { groupHash, tableHash } from './route.ts';

/** The height of one line in the stack, in plot units. */
const lineHeight = 22;

export function Home({ model, cat }: { model: Model; cat: Catalogue }) {
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
              <li key={entry.ref}>
                <a href={tableHash(entry.ref)}>
                  <span className="block" style={{ background: cat.colours.get(entry.schema) }} />
                  <span className="no">{entry.number}</span>
                  <span className="name">
                    {entry.table}
                    {found.table.kind === 'view' && <span className="tag">view</span>}
                  </span>
                  <Plot ticks={ticks} height={lineHeight} index={i} />
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
          <ul className="legend keys">
            <li>
              <Plot ticks={[{ column: 'key', height: 1 }]} height={14} className="key-sample" />
              <span className="name">primary key</span>
            </li>
            <li>
              <Plot ticks={[{ column: 'fk', height: 0.6 }]} height={14} className="key-sample" />
              <span className="name">foreign key</span>
            </li>
            <li>
              <Plot ticks={[{ column: 'unique', height: 0.45 }]} height={14} className="key-sample" />
              <span className="name">unique</span>
            </li>
            <li>
              <Plot ticks={[{ column: 'column', height: 0.18 }]} height={14} className="key-sample" />
              <span className="name">column</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
