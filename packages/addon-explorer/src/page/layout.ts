// Where the diagram's nodes go: ELK's layered layout, left to right along the relations. Runs in the browser
// and in Node, so it is tested without one.
import ElkBundle from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { findTable, type Model } from 'dbtour/model';
import type { Subgraph } from './graph.ts';

// The bundle is CommonJS: the constructor is module.exports and also its .default, which is the one both
// TypeScript and the bundler agree on.
const Elk = ElkBundle.default;

// The node's CSS draws these sizes, so the layout knows them before anything is rendered.
/** Wide enough for schema.table and a column beside its type without wrapping, in pixels. */
export const nodeWidth = 240;
/** The header with the table name. */
export const headerHeight = 34;
/** One column row. */
export const rowHeight = 22;
/** Above the first row and below the last. */
export const nodePadding = 6;

export function nodeHeight(columns: number): number {
  return headerHeight + nodePadding * 2 + rowHeight * columns;
}

export interface Position {
  x: number;
  y: number;
}

const elk = new Elk();

export async function layout(model: Model, graph: Subgraph): Promise<Map<string, Position>> {
  const root: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      // Room for an edge label between layers, and a clear gap between nodes in one layer.
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '36',
    },
    children: graph.tables.map((ref) => ({ id: ref, width: nodeWidth, height: nodeHeight(findTable(model, ref)?.table.columns.length ?? 0) })),
    edges: graph.relations.map((relation, i) => ({ id: `e${i}`, sources: [relation.from.table], targets: [relation.to.table] })),
  };
  const laid = await elk.layout(root);
  return new Map((laid.children ?? []).map((node): [string, Position] => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
}
