// The map: the chosen tables as entries on the black field, their relations as hairlines, laid out by ELK,
// drawn by React Flow. Three levels of detail keep a wide table readable (names, keys, every column), and
// the links panel switches any relation off. A click selects a table or a line: what it touches stays inked,
// the rest fades, and a card beside the map says what it is and what can be done with it (open it, write
// its query or its join, add its neighbours, hide it). "+" on a node adds its neighbours by changing the
// hash, so back undoes it. Embedded, the same map sits on an entry page at names level with a link to the full
// one: it answers a click with the same card, under it, and is not dragged or added to.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { applyNodeChanges, Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import { findTable, relationsOf, type Column, type Model, type Relation, type Table } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { CopyButton } from './Copy.tsx';
import { drawnLinks, expand, relationId, subgraph, type Subgraph } from './graph.ts';
import { layout, type Position as Placed } from './layout.ts';
import { inked, linkCard, tableCard, without, type Selection } from './mapcard.ts';
import { prompt } from './prompt.ts';
import { diagramHash, sqlFromHash, sqlJoinHash, tableHash } from './route.ts';
import { storedTool } from './tools.ts';

/** Selecting a table from inside its node, for the keyboard: the map's own click is React Flow's. */
const SelectTable = createContext<((ref: string) => void) | undefined>(undefined);

export type MapMode = 'names' | 'keys' | 'columns';
const modes: { id: MapMode; label: string }[] = [
  { id: 'names', label: 'Names' },
  { id: 'keys', label: 'Keys' },
  { id: 'columns', label: 'Columns' },
];
/** The level the reader chose last, kept in this browser. */
const modeKey = 'dbtour.mapMode';

function storedMode(fallback: MapMode): MapMode {
  try {
    const value = localStorage.getItem(modeKey);
    return modes.some((m) => m.id === value) ? (value as MapMode) : fallback;
  } catch {
    return fallback;
  }
}

function rememberMode(mode: MapMode): void {
  try {
    localStorage.setItem(modeKey, mode);
  } catch {
    // Forgetting the level is fine.
  }
}

/** The rows a node shows at a level: all, the keys, or none. */
export function rowsShown(mode: MapMode, table: Table, foreign: string[]): Column[] {
  if (mode === 'columns') return table.columns;
  if (mode === 'keys') return table.columns.filter((c) => table.primaryKey?.includes(c.name) || foreign.includes(c.name));
  return [];
}

interface TableNodeData extends Record<string, unknown> {
  ref: string;
  number: string;
  colour: string;
  name: string;
  kind: 'table' | 'view';
  rows: Column[];
  primaryKey: string[];
  foreign: string[];
  focus: boolean;
  /** Where "+" goes; absent when every neighbour is already shown, or on an embedded map. */
  expandHash?: string;
}

type TableNode = Node<TableNodeData, 'table'>;

function TableNodeView({ data }: NodeProps<TableNode>) {
  const select = useContext(SelectTable);
  // The whole node is the button: a click or Enter selects it, and its card opens the entry.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!select || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    select(data.ref);
  };
  return (
    <div
      className={`node${data.focus ? ' is-focus' : ''}${data.rows.length === 0 ? ' is-bare' : ''}`}
      {...(select ? { role: 'button', tabIndex: 0, 'aria-label': `${data.ref}: select it`, onKeyDown } : {})}
    >
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="node-head">
        <span className="block" style={{ background: data.colour }} />
        <span className="no">{data.number}</span>
        <span className="node-name">{data.name}</span>
        {data.kind === 'view' && <span className="tag">view</span>}
        {data.expandHash && (
          <a className="nodrag node-expand" href={data.expandHash} title="Add its neighbours" aria-label={`Add the neighbours of ${data.ref}`} onClick={(event) => event.stopPropagation()}>
            +
          </a>
        )}
      </div>
      {data.rows.length > 0 && (
        <ul className="node-rows">
          {data.rows.map((column) => (
            <li key={column.name}>
              <span className="node-key">{data.primaryKey.includes(column.name) ? 'PK' : data.foreign.includes(column.name) ? 'FK' : ''}</span>
              <span className="node-col">{column.name}</span>
              <span className="node-type">{column.type}</span>
            </li>
          ))}
        </ul>
      )}
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

const nodeTypes = { table: TableNodeView };

/** A group's box: on when every relation shows, mixed when some do; a click turns the whole group off, or on. */
function GroupBox({ label, relations, hidden, onChange }: { label: string; relations: Relation[]; hidden: Set<string>; onChange: (on: boolean) => void }) {
  const box = useRef<HTMLInputElement>(null);
  const shown = relations.filter((r) => !hidden.has(relationId(r))).length;
  const all = shown === relations.length;
  const some = shown > 0;
  useEffect(() => {
    if (box.current) box.current.indeterminate = some && !all;
  }, [some, all]);
  return (
    <label className="group">
      <input ref={box} type="checkbox" checked={some} onChange={() => onChange(!some)} />
      <span>
        {label} <span className="count">{relations.length}</span>
      </span>
    </label>
  );
}

interface Props {
  model: Model;
  cat: Catalogue;
  refs: string[];
  title?: string;
  description?: string;
  /** The level a fresh browser starts at; the reader's last choice wins otherwise. */
  defaultMode?: MapMode;
  /** On an entry page: names only, no controls, a link to the full map instead. */
  embedded?: boolean;
  openHash?: string;
}

export function DiagramView({ model, cat, refs, title, description, defaultMode = 'columns', embedded = false, openHash }: Props) {
  const key = refs.join(',');
  // Keyed on the joined refs: the array is new on every parse of the hash, its content is what matters.
  const graph = useMemo(() => subgraph(model, refs), [model, key]);
  const [mode, setModeState] = useState<MapMode>(() => (embedded ? 'names' : storedMode(defaultMode)));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [linksOpen, setLinksOpen] = useState(false);
  // The nodes as React Flow draws them, with the layout they were made for: a map is shown only once its own
  // nodes are placed, never the last one's for a frame.
  const [drawn, setDrawn] = useState<{ key: string; nodes: TableNode[] }>();
  const [selection, setSelection] = useState<Selection>();
  // Where the reader dragged a table to: kept through a change of detail or of links, until the tables change
  // or the layout is reset.
  const moved = useRef(new Map<string, Placed>());
  const [movedCount, setMovedCount] = useState(0);
  const [resets, setResets] = useState(0);
  const flow = useRef<ReactFlowInstance<TableNode, Edge>>(null);
  // Whether the reader has panned or zoomed this map themselves: until they do, the map is kept whole in view.
  const touched = useRef(false);

  const setMode = (next: MapMode) => {
    setModeState(next);
    rememberMode(next);
  };
  useEffect(() => {
    setHidden(new Set());
    setSelection(undefined);
    moved.current = new Map();
    setMovedCount(0);
    touched.current = false;
  }, [key]);

  const foreignOf = useCallback((ref: string) => relationsOf(model, ref).out.flatMap((r) => r.from.columns), [model]);
  const layoutKey = `${key}|${mode}|${resets}`;
  useEffect(() => {
    let current = true;
    const rows = (ref: string) => rowsShown(mode, findTable(model, ref)!.table, foreignOf(ref)).length;
    layout(model, graph, rows).then((positions) => {
      if (!current) return;
      const placed = new Map([...positions, ...moved.current]);
      setDrawn({ key: layoutKey, nodes: toNodes(model, cat, graph, placed, mode, foreignOf, embedded) });
    });
    return () => {
      current = false;
    };
  }, [model, cat, graph, layoutKey, mode, foreignOf, embedded]);

  const ready = drawn?.key === layoutKey ? drawn.nodes : undefined;
  const shown = useMemo(() => graph.relations.filter((r) => !hidden.has(relationId(r))), [graph, hidden]);
  // A selection that has left the map (its table hidden, its line switched off) is no selection.
  const lit = useMemo(() => inked({ tables: graph.tables, relations: shown }, selection), [graph, shown, selection]);
  const picked = lit ? selection : undefined;
  const nodes = useMemo(
    () => (ready ?? []).map((node) => ({ ...node, className: !lit ? '' : picked?.kind === 'table' && picked.ref === node.id ? 'is-picked' : lit.tables.has(node.id) ? 'is-lit' : 'is-faded' })),
    [ready, lit, picked],
  );
  const edges = useMemo(() => toEdges(shown, lit?.links), [shown, lit]);
  const onNodesChange = useCallback((changes: NodeChange<TableNode>[]) => setDrawn((d) => (d ? { ...d, nodes: applyNodeChanges(changes, d.nodes) } : d)), []);
  const selectTable = useCallback((ref: string) => {
    setSelection({ kind: 'table', ref });
    // Brought to the middle when it is elsewhere on a large map, at the zoom the reader chose.
    const node = embedded ? undefined : flow.current?.getNode(ref);
    if (node) flow.current?.setCenter(node.position.x + (node.measured?.width ?? 240) / 2, node.position.y + (node.measured?.height ?? 34) / 2, { zoom: flow.current.getZoom(), duration: 250 });
  }, [embedded]);
  // The card takes its width from the map. A map the reader has not moved is fitted again to what is left,
  // so no table ends up under the card; one they have moved is theirs and stays as they left it.
  const cardOpen = lit !== undefined && !embedded;
  useEffect(() => {
    if (touched.current) return;
    const frame = requestAnimationFrame(() => flow.current?.fitView({ padding: 0.15, maxZoom: 1, duration: 200 }));
    return () => cancelAnimationFrame(frame);
  }, [cardOpen]);
  const resetLayout = () => {
    moved.current = new Map();
    setMovedCount(0);
    setResets((n) => n + 1);
  };

  const toggle = (id: string) =>
    setHidden((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (relations: Relation[], on: boolean) =>
    setHidden((set) => {
      const next = new Set(set);
      for (const r of relations) if (on) next.delete(relationId(r));
      else next.add(relationId(r));
      return next;
    });
  const declared = graph.relations.filter((r) => !r.virtual);
  const fromNotes = graph.relations.filter((r) => r.virtual);

  const canvas =
    graph.tables.length === 0 ? (
      <p className="page muted">None of these tables is in the model.</p>
    ) : ready ? (
      <ReactFlow<TableNode, Edge>
        key={layoutKey}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          flow.current = instance;
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: embedded ? 0.1 : 0.15, maxZoom: 1 }}
        minZoom={0.05}
        colorMode="system"
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        nodesDraggable={!embedded}
        zoomOnScroll={!embedded}
        preventScrolling={!embedded}
        onNodeClick={(_event, node) => setSelection({ kind: 'table', ref: node.id })}
        onEdgeClick={(_event, edge) => setSelection({ kind: 'link', id: edge.id })}
        onPaneClick={() => setSelection(undefined)}
        {...(embedded
          ? {}
          : {
              // A move the reader made carries its event; one the map made for itself has none.
              onMoveEnd: (event) => {
                if (event) touched.current = true;
              },
              onNodeDragStop: (_event, node) => {
                moved.current.set(node.id, node.position);
                setMovedCount(moved.current.size);
              },
            })}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Lines} gap={32} lineWidth={1} color="var(--grid)" bgColor="var(--bg)" />
        {!embedded && <Controls showInteractive={false} />}
      </ReactFlow>
    ) : (
      <p className="page muted">Laying out…</p>
    );

  // The card of what is selected, in the links panel's place while there is a selection.
  let card;
  if (picked?.kind === 'table') {
    const about = tableCard(model, cat, graph, picked.ref);
    const grown = expand(model, graph.tables, picked.ref);
    const linkRow = (link: { columns: string[]; table: string; onMap: boolean; virtual: boolean }, out: boolean) => (
      <li key={`${link.table}.${link.columns.join(',')}`}>
        <span className="card-cols">
          {out ? `${link.columns.join(', ')} →` : '←'}
        </span>
        {link.onMap ? (
          <button type="button" className="card-go" onClick={() => selectTable(link.table)}>
            {link.table}
          </button>
        ) : (
          // The full map takes the table in; the entry's small map is its neighbourhood and opens the table instead.
          <a className="card-go is-off" href={embedded ? tableHash(link.table) : diagramHash([...graph.tables, link.table])} title={embedded ? `Open ${link.table}` : 'Not on this map: add it'}>
            {link.table}
            {embedded ? '' : ' +'}
          </a>
        )}
        {!out && <span className="card-cols">.{link.columns.join(', ')}</span>}
        {link.virtual && <span className="tag">notes</span>}
      </li>
    );
    card = about && (
      <aside className="map-card" aria-label={`Selected: ${about.ref}`}>
        <header>
          <span className="block" style={{ background: cat.colours.get(findTable(model, about.ref)!.schema.name) }} />
          <span className="no">{about.number}</span>
          <h2>{about.ref}</h2>
          {about.kind === 'view' && <span className="tag">view</span>}
          <button type="button" className="card-close" aria-label="Close" onClick={() => setSelection(undefined)}>
            ×
          </button>
        </header>
        {about.description && <p className="card-about">{about.description}</p>}
        <p className="label">
          {[about.size, `${about.columns} ${about.columns === 1 ? 'column' : 'columns'}`, about.keys.length ? `key ${about.keys.join(', ')}` : 'no key'].filter(Boolean).join(' · ')}
        </p>
        <div className="card-actions">
          {!(embedded && about.ref === graph.tables[0]) && (
            <a className="button" href={tableHash(about.ref)}>
              Open the entry
            </a>
          )}
          <a className="button" href={sqlFromHash(about.ref)}>
            Write SQL
          </a>
          {!embedded && grown.length > graph.tables.length && (
            <a className="button" href={diagramHash(grown)}>
              Add its neighbours
            </a>
          )}
          <CopyButton className="button" label={`Copy for ${storedTool().name}`} text={() => prompt(model, [about.ref])} />
          {!embedded && graph.tables.length > 1 && (
            <a className="button" href={diagramHash(without(graph.tables, about.ref))}>
              Hide from the map
            </a>
          )}
        </div>
        <h3>
          References <span className="count">{about.references.length}</span>
        </h3>
        {about.references.length > 0 ? <ul className="card-links">{about.references.map((l) => linkRow(l, true))}</ul> : <p className="muted">No other table.</p>}
        <h3>
          Referenced by <span className="count">{about.referencedBy.length}</span>
        </h3>
        {about.referencedBy.length > 0 ? <ul className="card-links">{about.referencedBy.map((l) => linkRow(l, false))}</ul> : <p className="muted">No other table.</p>}
      </aside>
    );
  } else if (picked?.kind === 'link') {
    const about = linkCard({ tables: graph.tables, relations: shown }, picked.id);
    card = about && (
      <aside className="map-card" aria-label={`Selected: the relation from ${about.from} to ${about.to}`}>
        <header>
          <h2>
            {about.from} → {about.to}
          </h2>
          <button type="button" className="card-close" aria-label="Close" onClick={() => setSelection(undefined)}>
            ×
          </button>
        </header>
        <p className="label">{about.joins.length === 1 ? 'One relation' : `${about.joins.length} relations on one line`}</p>
        <ul className="card-links">
          {about.joins.map((j) => (
            <li key={j.from.join(',')}>
              <span className="card-join">
                {j.from.join(', ')} = {about.to}.{j.to.join(', ')}
              </span>
              {j.virtual && <span className="tag">notes</span>}
            </li>
          ))}
        </ul>
        <div className="card-actions">
          <a className="button" href={sqlJoinHash(about.from, about.to)}>
            Write this join
          </a>
          <button type="button" className="button" onClick={() => selectTable(about.from)}>
            Select {findTable(model, about.from)?.table.name}
          </button>
          <button type="button" className="button" onClick={() => selectTable(about.to)}>
            Select {findTable(model, about.to)?.table.name}
          </button>
{!embedded && (
          <button
            type="button"
            className="button"
            onClick={() => {
              setAll(graph.relations.filter((r) => r.from.table === about.from && r.to.table === about.to), false);
              setSelection(undefined);
            }}
          >
            Hide this line
          </button>
          )}
        </div>
      </aside>
    );
  }

  if (embedded) {
    return (
      <section className="diagram embedded" aria-label="Around it">
        <header className="diagram-head">
          <h2>Around it</h2>
          <span className="label">
            {graph.tables.length} tables · {graph.relations.length} relations
          </span>
          {openHash && (
            <a className="open-map" href={openHash}>
              Open the map
            </a>
          )}
        </header>
        <div className={`canvas${lit ? ' has-selection' : ''}`}>
          <SelectTable.Provider value={selectTable}>{canvas}</SelectTable.Provider>
        </div>
        {card}
      </section>
    );
  }

  return (
    <section className="diagram">
      <header className="diagram-head">
        <div>
          <h1>{title}</h1>
          {description && <p className="muted">{description}</p>}
        </div>
        <p className="label">
          {graph.tables.length} tables · {shown.length} of {graph.relations.length} relations · click a table or a line · drag to move · scroll to zoom
        </p>
      </header>
      <div className="map-controls">
        <span className="label">Detail</span>
        <div className="seg" role="group" aria-label="Detail">
          {modes.map((m) => (
            <button key={m.id} type="button" className={m.id === mode ? 'is-on' : ''} aria-pressed={m.id === mode} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className={`button${linksOpen ? ' is-on' : ''}`} aria-pressed={linksOpen} onClick={() => setLinksOpen((o) => !o)}>
          Links {shown.length}/{graph.relations.length}
        </button>
        {movedCount > 0 && (
          <button type="button" className="button" onClick={resetLayout}>
            Reset layout
          </button>
        )}
      </div>
      <div className="map-body">
        <div className={`canvas${lit ? ' has-selection' : ''}`}>
          <SelectTable.Provider value={selectTable}>{canvas}</SelectTable.Provider>
        </div>
        {card}
        {!card && linksOpen && (
          <aside className="map-links" aria-label="Links">
            <h2>Links</h2>
            {declared.length > 0 && <GroupBox label="Declared" relations={declared} hidden={hidden} onChange={(on) => setAll(declared, on)} />}
            {fromNotes.length > 0 && <GroupBox label="From the notes" relations={fromNotes} hidden={hidden} onChange={(on) => setAll(fromNotes, on)} />}
            <ul>
              {graph.relations.map((r) => {
                const id = relationId(r);
                return (
                  <li key={id}>
                    <label>
                      <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} />
                      <span>
                        {r.from.table}
                        <span className="muted">.{r.from.columns.join(', ')}</span> → {r.to.table}
                        {r.virtual && <span className="tag">notes</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}

function toNodes(model: Model, cat: Catalogue, graph: Subgraph, positions: Map<string, Placed>, mode: MapMode, foreignOf: (ref: string) => string[], embedded: boolean): TableNode[] {
  return graph.tables.map((ref, i) => {
    const { schema, table } = findTable(model, ref)!;
    const foreign = foreignOf(ref);
    const expanded = embedded ? graph.tables : expand(model, graph.tables, ref);
    return {
      id: ref,
      type: 'table',
      position: positions.get(ref) ?? { x: 0, y: 0 },
      data: {
        ref,
        number: cat.byRef.get(ref)?.number ?? '',
        colour: cat.colours.get(schema.name) ?? '#8c8c8c',
        name: table.name,
        kind: table.kind,
        rows: rowsShown(mode, table, foreign),
        primaryKey: table.primaryKey ?? [],
        foreign,
        focus: i === 0,
        expandHash: expanded.length > graph.tables.length ? diagramHash(expanded) : undefined,
      },
    };
  });
}

/** Parallel relations share one line, so neither hides the other; the label names each one's columns. */
function toEdges(relations: Relation[], lit: Set<string> | undefined): Edge[] {
  return drawnLinks(relations).map((link) => ({
    id: link.id,
    source: link.from,
    target: link.to,
    label: link.relations.map((r) => r.from.columns.join(', ') + (r.virtual ? ' (notes)' : '')).join(' · '),
    className: !lit ? '' : lit.has(link.id) ? 'is-lit' : 'is-faded',
    // A hairline is hard to hit: the line answers a click this many pixels to either side of it.
    interactionWidth: edgeReach,
    style: link.relations.every((r) => r.virtual) ? { strokeDasharray: '4 4' } : undefined,
    markerEnd: { type: MarkerType.Arrow, width: 14, height: 14, color: 'var(--ink)' },
  }));
}

/** How wide a line is to a click, in pixels: wide enough for a finger, narrow enough that two lines stay apart. */
const edgeReach = 24;
