// One entry: its number and name, its plot, its columns ruled beneath; the facts, relations and the sequence
// on the right. Indexes, constraints and a view's definition fold below.
import { useEffect, useState } from 'react';
import { findTable, isUniqueColumn, relationsOf, type Column, type Model, type Relation, type Table } from 'dbtour/model';
import { neighboursOf, type Catalogue } from './catalogue.ts';
import { withNeighbours } from './graph.ts';
import { Plot } from './Plot.tsx';
import { profile } from './plot.ts';
import { prompt } from './prompt.ts';
import { diagramHash, groupHash, tableHash } from './route.ts';

/** How long the button says "Copied" before it offers to copy again. */
const copiedForMs = 1500;

/** The entry opened last, so the home can lift its line; kept for the tab, never beyond it. */
const lastKey = 'dbtour.last';
export function lastOpened(): string | undefined {
  try {
    return sessionStorage.getItem(lastKey) ?? undefined;
  } catch {
    return undefined;
  }
}
function remember(ref: string): void {
  try {
    sessionStorage.setItem(lastKey, ref);
  } catch {
    // A page opened where storage is refused still works; the home just lifts nothing.
  }
}
/** The entry's own plot is this tall, in plot units. */
const plotHeight = 56;

interface Props {
  model: Model;
  cat: Catalogue;
  tableRef: string;
  column?: string;
}

export function TableView({ model, cat, tableRef, column }: Props) {
  const found = findTable(model, tableRef);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    remember(tableRef);
    if (column) document.getElementById(`column-${column}`)?.scrollIntoView({ block: 'center' });
    else document.querySelector('.main')?.scrollTo(0, 0);
  }, [tableRef, column]);

  if (!found) {
    return (
      <article className="page">
        <h1>No table named {tableRef}</h1>
        <p>Pick one from the index, or run dbtour extract and render again if it was added since.</p>
      </article>
    );
  }
  const { schema, table } = found;
  const entry = cat.byRef.get(tableRef);
  const relations = relationsOf(model, tableRef);
  const foreign = relations.out.flatMap((r) => r.from.columns);
  const groups = model.groups.filter((g) => g.tables.includes(tableRef));
  const sequence = neighboursOf(cat, tableRef);
  const keyCount = (table.primaryKey?.length ?? 0) + table.columns.filter((c) => isUniqueColumn(table, c.name)).length;

  const copy = async () => {
    await copyText(prompt(model, [tableRef]));
    setCopied(true);
    setTimeout(() => setCopied(false), copiedForMs);
  };

  return (
    <div className="with-panel">
      <article className="page table">
        <header className="entry-head">
          <h1 className="entry-title">
            <span className="block" style={{ background: cat.colours.get(schema.name) }} />
            <span className="no">{entry?.number}</span>
            <span className="entry-schema">{schema.name}.</span>
            {table.name}
            {table.kind === 'view' && <span className="tag">view</span>}
          </h1>
          <p className="meta">
            <span>
              {table.columns.length} {table.columns.length === 1 ? 'column' : 'columns'}
            </span>
            {' · '}
            <span>
              {keyCount} {keyCount === 1 ? 'key' : 'keys'}
            </span>
            {' · '}
            <span>references {relations.out.length}</span>
            {' · '}
            <span>referenced by {relations.in.length}</span>
          </p>
          {table.description && <p className="description">{table.description}</p>}
          <div className="actions">
            <a className="button is-primary" href={diagramHash(withNeighbours(model, [tableRef]))}>
              Diagram
            </a>
            <button type="button" className="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy for Claude'}
            </button>
          </div>
        </header>

        <div className="entry-plot" key={tableRef}>
          <Plot ticks={profile(table, foreign)} height={plotHeight} tableRef={tableRef} activeColumn={column} />
        </div>

        <div className="scroll-x">
        <table className="columns">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Null</th>
              <th>Default</th>
              <th>Key</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr key={col.name} id={`column-${col.name}`} className={col.name === column ? 'is-highlighted' : ''}>
                <td className="mono">{col.name}</td>
                <td className="mono type">{col.type}</td>
                <td className="muted">{col.nullable ? 'yes' : ''}</td>
                <td className="mono">{col.default}</td>
                <td>
                  <Keys table={table} column={col} out={relations.out} />
                </td>
                <td>{col.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {table.indexes.length > 0 && (
          <details>
            <summary>
              Indexes <span className="count">{table.indexes.length}</span>
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Columns</th>
                  <th>Unique</th>
                </tr>
              </thead>
              <tbody>
                {table.indexes.map((index) => (
                  <tr key={index.name}>
                    <td className="mono">{index.name}</td>
                    <td className="mono">
                      {index.columns.join(', ')}
                      {index.included?.length ? <span className="muted"> includes {index.included.join(', ')}</span> : null}
                    </td>
                    <td className="muted">{index.unique ? 'yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {table.constraints.length > 0 && (
          <details>
            <summary>
              Constraints <span className="count">{table.constraints.length}</span>
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Columns</th>
                  <th>Definition</th>
                </tr>
              </thead>
              <tbody>
                {table.constraints.map((constraint) => (
                  <tr key={constraint.name}>
                    <td className="mono">{constraint.name}</td>
                    <td>{constraint.kind}</td>
                    <td className="mono">{constraint.columns.join(', ')}</td>
                    <td className="mono">{constraint.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {table.definition !== undefined && (
          <details>
            <summary>Definition</summary>
            <pre>{table.definition.trim()}</pre>
          </details>
        )}
      </article>

      <aside className="panel">
        <section>
          <h2>
            References <span className="count">{relations.out.length}</span>
          </h2>
          {relations.out.length === 0 ? (
            <p className="muted">No other table.</p>
          ) : (
            <ul>
              {relations.out.map((r, i) => (
                <li key={i}>
                  <span className="mono">{r.from.columns.join(', ')}</span>
                  <span className="arrow"> → </span>
                  <a href={tableHash(r.to.table)}>{r.to.table}</a>
                  <span className="mono muted">.{r.to.columns.join(', ')}</span>
                  {r.virtual && <span className="tag">notes</span>}
                  <Action relation={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>
            Referenced by <span className="count">{relations.in.length}</span>
          </h2>
          {relations.in.length === 0 ? (
            <p className="muted">No other table.</p>
          ) : (
            <ul>
              {relations.in.map((r, i) => (
                <li key={i}>
                  <a href={tableHash(r.from.table)}>{r.from.table}</a>
                  <span className="mono muted">.{r.from.columns.join(', ')}</span>
                  {r.virtual && <span className="tag">notes</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        {groups.length > 0 && (
          <section>
            <h2>Groups</h2>
            <ul>
              {groups.map((group) => (
                <li key={group.name}>
                  <a href={groupHash(group.name)}>{group.name}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="sequence">
          <h2>Sequence</h2>
          <ul>
            {sequence.previous && (
              <li>
                <a href={tableHash(sequence.previous.ref)}>
                  <span className="no">{sequence.previous.number}</span>
                  {sequence.previous.ref}
                </a>
              </li>
            )}
            {sequence.next && (
              <li>
                <a href={tableHash(sequence.next.ref)}>
                  <span className="no">{sequence.next.number}</span>
                  {sequence.next.ref}
                </a>
              </li>
            )}
          </ul>
        </section>
      </aside>
    </div>
  );
}

function Keys({ table, column, out }: { table: Table; column: Column; out: Relation[] }) {
  const keys = [];
  if (table.primaryKey?.includes(column.name)) keys.push(<span key="pk" className="key">PK</span>);
  for (const relation of out) {
    const i = relation.from.columns.indexOf(column.name);
    if (i === -1) continue;
    const target = relation.to.columns[i] ?? relation.to.columns.join(',');
    keys.push(
      <span key={`fk-${relation.to.table}-${i}`} className="key">
        FK → <a href={tableHash(relation.to.table, target)}>{relation.to.table}</a>
        <span className="muted">.{target}</span>
        {relation.virtual && <span className="tag">notes</span>}
      </span>,
    );
  }
  if (isUniqueColumn(table, column.name)) keys.push(<span key="unique" className="key">unique</span>);
  if (column.identity) keys.push(<span key="identity" className="key">identity</span>);
  if (column.computed !== undefined) {
    keys.push(
      <span key="computed" className="key">
        computed <code>{column.computed}</code>
      </span>,
    );
  }
  return <>{keys}</>;
}

/** "on delete cascade" when the database does something other than refuse. */
function Action({ relation }: { relation: Relation }) {
  const parts: string[] = [];
  for (const [event, action] of [['delete', relation.onDelete], ['update', relation.onUpdate]] as const) {
    if (action && !/^no[_ ]?action$/i.test(action)) parts.push(`on ${event} ${action.toLowerCase().replace(/_/g, ' ')}`);
  }
  return parts.length === 0 ? null : <span className="muted"> {parts.join(', ')}</span>;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard API is refused on some file: pages; the old way still works.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}
