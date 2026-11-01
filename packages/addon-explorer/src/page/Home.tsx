// The first view: the database as a stack of plots, one hairline per table, a key as a peak. When the
// source read the tables' sizes, a bar beside each line shows its bytes against the largest table's, its
// rows and size are written above the bar, and the index can be read largest first.
import { useState } from 'react';
import { driverName, formatBytes } from 'dbtour/markdown';
import { findTable, relationsOf, type Model } from 'dbtour/model';
import { ordered, orders, rememberOrder, sized, storedOrder, type Catalogue, type Order } from './catalogue.ts';
import { Plot } from './Plot.tsx';
import { peaks, profile } from './plot.ts';
import { groupHash, tableHash } from './route.ts';
import { sizeCaption, sizeTerms } from './size.ts';
import { SizeBar, Swatch } from './SizeBar.tsx';
import { lastOpened } from './TableView.tsx';

// The stack fills the field: a few tables get tall lines, a long catalogue keeps a tight pitch that still
// shows every table. In pixels, the SVG's height; the label beneath adds its own line.
export function lineHeight(tables: number): number {
  return tables <= 12 ? 40 : tables <= 40 ? 24 : 14;
}

export function Home({ model, cat }: { model: Model; cat: Catalogue }) {
  const height = lineHeight(cat.entries.length);
  const last = lastOpened();
  const weighed = sized(cat);
  const [order, setOrder] = useState<Order>(() => (weighed ? storedOrder() : 'catalogue'));
  const choose = (next: Order) => {
    setOrder(next);
    rememberOrder(next);
  };
  const largest = Math.max(0, ...cat.entries.map((e) => (e.stats ? e.stats.dataBytes + e.stats.indexBytes : 0)));
  const counter = model.databases.find((d) => d.schemas.some((s) => s.tables.some((t) => t.stats)));
  const terms = sizeTerms(driverName(counter?.driver ?? 'the database'));
  return (
    <div className="with-panel">
      <article className="page home">
        {model.databases.map((database) => {
          const tables = database.schemas.flatMap((s) => s.tables);
          const views = tables.filter((t) => t.kind === 'view').length;
          const counted = tables.filter((t) => t.stats);
          const bytes = counted.reduce((sum, t) => sum + t.stats!.dataBytes + t.stats!.indexBytes, 0);
          return (
            <header key={database.name} className="entry-head">
              <h1>{database.name}</h1>
              <p className="meta">
                <span>
                  {driverName(database.driver)}
                  {database.version ? ` ${database.version}` : ''}
                </span>
                {' · '}
                <span>{tables.length - views} tables</span>
                {' · '}
                <span>
                  {views} {views === 1 ? 'view' : 'views'}
                </span>
                {' · '}
                <span>{database.relations.length} relations</span>
                {database.collation && (
                  <>
                    {' · '}
                    <span>
                      collation <span className="ident">{database.collation}</span>
                    </span>
                  </>
                )}
                {counted.length > 0 && (
                  <>
                    {' · '}
                    <span>
                      {formatBytes(bytes)}
                      {database.statsReadAt ? ` as of ${database.statsReadAt.slice(0, 10)}` : ''}
                    </span>
                  </>
                )}
              </p>
              {database.description && <p className="description">{database.description}</p>}
              {database.unread?.map((reason) => (
                <p key={reason} className="unread">
                  Not read: {reason}.
                </p>
              ))}
            </header>
          );
        })}

        <div className="plots-head">
          <div className="plots-key">
            <div className="label">Index · the line is the columns, a key is a peak</div>
            {weighed && (
              <div className="label">
                The bar is the bytes, <Swatch kind="data" /> data and <Swatch kind="indexes" /> indexes, against the largest table
              </div>
            )}
          </div>
          {weighed && (
            <div className="seg" role="group" aria-label="Order">
              {orders.map((o) => (
                <button key={o.id} type="button" className={o.id === order ? 'is-on' : ''} aria-pressed={o.id === order} onClick={() => choose(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <ol className={`plots${weighed ? ' sized' : ''}`}>
          {ordered(cat, order).map((entry, i) => {
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
                  {weighed && (
                    <span className="size">{sizeCaption(entry.stats, found.table.kind)}</span>
                  )}
                  <Plot ticks={ticks} height={height} index={i} />
                  {entry.stats && <SizeBar stats={entry.stats} largest={largest} />}
                </a>
              </li>
            );
          })}
        </ol>

        <p className="hint">
          Press <kbd>/</kbd> to search. An entry lists its columns and relations and carries a map of its neighbourhood; Open the map draws it large, and +
          on any node adds that table's neighbours too.
        </p>
      </article>

      <aside className="panel">
        {model.databases.some((d) => d.properties || d.schemas.some((s) => s.properties)) && (
          <section>
            <h2>Properties</h2>
            <dl className="about-terms panel-props">
              {model.databases.flatMap((d) =>
                [{ on: d.name, properties: d.properties }, ...d.schemas.map((s) => ({ on: s.name, properties: s.properties }))].flatMap(({ on, properties }) =>
                  Object.entries(properties ?? {}).map(([name, value]) => (
                    <div key={`${on}.${name}`}>
                      <dt className="prop-name">
                        {on} · {name}
                      </dt>
                      <dd>{value}</dd>
                    </div>
                  )),
                ),
              )}
            </dl>
          </section>
        )}
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
        {weighed && (
          <section>
            <h2>Reading a bar</h2>
            <dl className="terms">
              <dt>Rows</dt>
              <dd>{terms.rows}</dd>
              <dt>
                <Swatch kind="data" /> Data
              </dt>
              <dd>{terms.data}</dd>
              <dt>
                <Swatch kind="indexes" /> Indexes
              </dt>
              <dd>{terms.indexes}</dd>
            </dl>
            <p className="muted">The longest bar is the largest table; the rest are drawn to the same scale.</p>
          </section>
        )}
      </aside>
    </div>
  );
}
