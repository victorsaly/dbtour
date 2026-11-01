// The map: the chosen tables as entries on the black field, their relations as hairlines, laid out by ELK,
// drawn by React Flow. Three levels of detail keep a wide table readable (names, keys, every column), and
// the links panel switches any relation off. "+" on a node adds its neighbours by changing the hash, so
// back undoes it. Embedded, the same map sits on an entry page at names level with a link to the full one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { findTable, relationsOf, type Column, type Model, type Relation, type Table } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { expand, mergeParallel, relationId, subgraph, type Subgraph } from './graph.ts';
import { layout, type Position as Placed } from './layout.ts';
import { diagramHash, tableHash } from './route.ts';

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
  return (
    <div className={`node${data.focus ? ' is-focus' : ''}${data.rows.length === 0 ? ' is-bare' : ''}`}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="node-head">
        <span className="block" style={{ background: data.colour }} />
        <span className="no">{data.number}</span>
        <a className="nodrag node-name" href={tableHash(data.ref)} title={`Open ${data.ref}`}>
          {data.name}
        </a>
        {data.kind === 'view' && <span className="tag">view</span>}
        {data.expandHash && (
          <a className="nodrag node-expand" href={data.expandHash} title="Add its neighbours" aria-label={`Add the neighbours of ${data.ref}`}>
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
  const [placed, setPlaced] = useState<{ key: string; positions: Map<string, Placed> }>();

  const setMode = (next: MapMode) => {
    setModeState(next);
    rememberMode(next);
  };
  useEffect(() => setHidden(new Set()), [key]);

  const foreignOf = useCallback((ref: string) => relationsOf(model, ref).out.flatMap((r) => r.from.columns), [model]);
  const layoutKey = `${key}|${mode}`;
  useEffect(() => {
    let current = true;
    const rows = (ref: string) => rowsShown(mode, findTable(model, ref)!.table, foreignOf(ref)).length;
    layout(model, graph, rows).then((positions) => {
      if (current) setPlaced({ key: layoutKey, positions });
    });
    return () => {
      current = false;
    };
  }, [model, graph, layoutKey, mode, foreignOf]);

  const positions = placed?.key === layoutKey ? placed.positions : undefined;
  const shown = useMemo(() => graph.relations.filter((r) => !hidden.has(relationId(r))), [graph, hidden]);
  const nodes = useMemo(() => (positions ? toNodes(model, cat, graph, positions, mode, foreignOf, embedded) : []), [model, cat, graph, positions, mode, foreignOf, embedded]);
  const edges = useMemo(() => toEdges(shown), [shown]);
  const flowKey = `${layoutKey}|${[...hidden].sort().join('|')}`;

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
    ) : positions ? (
      <ReactFlow
        key={flowKey}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: embedded ? 0.1 : 0.15, maxZoom: 1 }}
        minZoom={0.05}
        colorMode="system"
        nodesConnectable={false}
        elementsSelectable={false}
        nodesDraggable={!embedded}
        zoomOnScroll={!embedded}
        preventScrolling={!embedded}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Lines} gap={32} lineWidth={1} color="var(--grid)" bgColor="var(--bg)" />
        {!embedded && <Controls showInteractive={false} />}
      </ReactFlow>
    ) : (
      <p className="page muted">Laying out…</p>
    );

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
        <div className="canvas">{canvas}</div>
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
          {graph.tables.length} tables · {shown.length} of {graph.relations.length} relations · drag to pan · scroll to zoom · + adds neighbours
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
      </div>
      <div className="map-body">
        <div className="canvas">{canvas}</div>
        {linksOpen && (
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
function toEdges(relations: Relation[]): Edge[] {
  return mergeParallel(relations).map((link) => ({
    id: link.id,
    source: link.from,
    target: link.to,
    label: link.relations.map((r) => r.from.columns.join(', ') + (r.virtual ? ' (notes)' : '')).join(' · '),
    style: link.relations.every((r) => r.virtual) ? { strokeDasharray: '4 4' } : undefined,
    markerEnd: { type: MarkerType.Arrow, width: 14, height: 14, color: 'var(--ink)' },
  }));
}
