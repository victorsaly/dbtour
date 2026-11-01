// The canvas: the chosen tables as nodes, their relations as edges, laid out by ELK, drawn by React Flow.
// "+" on a node adds its neighbours by changing the hash, so the browser's back button undoes it.
import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { findTable, relationsOf, type Column, type Model } from 'dbtour/model';
import { expand, subgraph, type Subgraph } from './graph.ts';
import { layout, type Position as Placed } from './layout.ts';
import { diagramHash, tableHash } from './route.ts';

interface TableNodeData extends Record<string, unknown> {
  ref: string;
  schema: string;
  name: string;
  kind: 'table' | 'view';
  columns: Column[];
  primaryKey: string[];
  foreign: string[];
  focus: boolean;
  /** Where "+" goes; absent when every neighbour is already shown. */
  expandHash?: string;
}

type TableNode = Node<TableNodeData, 'table'>;

function TableNodeView({ data }: NodeProps<TableNode>) {
  return (
    <div className={`node${data.focus ? ' is-focus' : ''}`}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="node-head">
        <a className="nodrag node-name" href={tableHash(data.ref)} title={`Open ${data.ref}`}>
          <span className="node-schema">{data.schema}.</span>
          {data.name}
        </a>
        {data.kind === 'view' && <span className="tag">view</span>}
        {data.expandHash && (
          <a className="nodrag node-expand" href={data.expandHash} title="Add its neighbours" aria-label={`Add the neighbours of ${data.ref}`}>
            +
          </a>
        )}
      </div>
      <ul className="node-rows">
        {data.columns.map((column) => (
          <li key={column.name}>
            <span className="node-key">{data.primaryKey.includes(column.name) ? 'PK' : data.foreign.includes(column.name) ? 'FK' : ''}</span>
            <span className="node-col">{column.name}</span>
            <span className="node-type">{column.type}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  );
}

const nodeTypes = { table: TableNodeView };

interface Props {
  model: Model;
  refs: string[];
  title: string;
  description?: string;
}

export function DiagramView({ model, refs, title, description }: Props) {
  const key = refs.join(',');
  // Keyed on the joined refs: the array is new on every parse of the hash, its content is what matters.
  const graph = useMemo(() => subgraph(model, refs), [model, key]);
  const [placed, setPlaced] = useState<{ key: string; positions: Map<string, Placed> }>();

  useEffect(() => {
    let current = true;
    layout(model, graph).then((positions) => {
      if (current) setPlaced({ key, positions });
    });
    return () => {
      current = false;
    };
  }, [model, graph, key]);

  const positions = placed?.key === key ? placed.positions : undefined;
  const nodes = useMemo(() => (positions ? toNodes(model, graph, positions) : []), [model, graph, positions]);
  const edges = useMemo(() => toEdges(graph), [graph]);

  return (
    <section className="diagram">
      <header className="diagram-head">
        <div>
          <h1>{title}</h1>
          {description && <p className="muted">{description}</p>}
        </div>
        <p className="muted">
          {graph.tables.length} tables · {graph.relations.length} relations · drag to pan, scroll to zoom, + on a node adds its neighbours
        </p>
      </header>
      <div className="canvas">
        {graph.tables.length === 0 ? (
          <p className="page muted">None of these tables is in the model.</p>
        ) : positions ? (
          <ReactFlow
            key={key}
            defaultNodes={nodes}
            defaultEdges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.1}
            colorMode="system"
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <p className="page muted">Laying out…</p>
        )}
      </div>
    </section>
  );
}

function toNodes(model: Model, graph: Subgraph, positions: Map<string, Placed>): TableNode[] {
  return graph.tables.map((ref, i) => {
    const { schema, table } = findTable(model, ref)!;
    const expanded = expand(model, graph.tables, ref);
    return {
      id: ref,
      type: 'table',
      position: positions.get(ref) ?? { x: 0, y: 0 },
      data: {
        ref,
        schema: schema.name,
        name: table.name,
        kind: table.kind,
        columns: table.columns,
        primaryKey: table.primaryKey ?? [],
        foreign: relationsOf(model, ref).out.flatMap((r) => r.from.columns),
        focus: i === 0,
        expandHash: expanded.length > graph.tables.length ? diagramHash(expanded) : undefined,
      },
    };
  });
}

function toEdges(graph: Subgraph): Edge[] {
  return graph.relations.map((relation, i) => ({
    id: `${i}:${relation.from.table}>${relation.to.table}`,
    source: relation.from.table,
    target: relation.to.table,
    label: relation.from.columns.join(', ') + (relation.virtual ? ' (notes)' : ''),
    style: relation.virtual ? { strokeDasharray: '6 4' } : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  }));
}
