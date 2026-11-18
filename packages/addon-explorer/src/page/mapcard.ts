// What the map says when it is clicked: a table's card, a line's card, and what stays inked around either.
// Pure, so it is tested in Node; Diagram.tsx draws it.
import { findTable, relationsOf, type Model, type Table } from 'dbtour/model';
import type { Catalogue } from './catalogue.ts';
import { mergeParallel, type Subgraph } from './graph.ts';
import { sizeCaption } from './size.ts';

/** What the reader clicked on the map: a table, or the line between two. */
export type Selection = { kind: 'table'; ref: string } | { kind: 'link'; id: string };

/**
 * What stays inked while something is selected, the rest fading: a table with its neighbours on the map and
 * the lines between them, or a line with its two ends. Undefined when nothing is selected, or when what was
 * selected has left the map.
 */
export function inked(graph: Subgraph, selection: Selection | undefined): { tables: Set<string>; links: Set<string> } | undefined {
  if (!selection) return undefined;
  const links = mergeParallel(graph.relations);
  if (selection.kind === 'link') {
    const link = links.find((l) => l.id === selection.id);
    return link ? { tables: new Set([link.from, link.to]), links: new Set([link.id]) } : undefined;
  }
  if (!graph.tables.includes(selection.ref)) return undefined;
  const touching = links.filter((l) => l.from === selection.ref || l.to === selection.ref);
  return { tables: new Set([selection.ref, ...touching.flatMap((l) => [l.from, l.to])]), links: new Set(touching.map((l) => l.id)) };
}

/** One relation on a table's card: its columns on this table's side of it, and the table at the other end. */
export interface CardLink {
  columns: string[];
  table: string;
  /** Whether that table is drawn on this map: a click goes to it, or adds it. */
  onMap: boolean;
  /** From the notes, not declared by the database. */
  virtual: boolean;
}

export interface TableCard {
  ref: string;
  number: string;
  name: string;
  kind: Table['kind'];
  description?: string;
  /** Rows and bytes as the index writes them; empty when the source read none. */
  size: string;
  columns: number;
  keys: string[];
  references: CardLink[];
  referencedBy: CardLink[];
}

/** A table's card: what it is, how big, its keys, and every relation out and in, on the map or not. */
export function tableCard(model: Model, cat: Catalogue, graph: Subgraph, ref: string): TableCard | undefined {
  const found = findTable(model, ref);
  if (!found) return undefined;
  const { table } = found;
  const shown = new Set(graph.tables);
  const relations = relationsOf(model, found.ref);
  const card: TableCard = {
    ref: found.ref,
    number: cat.byRef.get(found.ref)?.number ?? '',
    name: table.name,
    kind: table.kind,
    size: sizeCaption(table.stats, table.kind),
    columns: table.columns.length,
    keys: table.primaryKey ?? [],
    references: relations.out.map((r) => ({ columns: r.from.columns, table: r.to.table, onMap: shown.has(r.to.table), virtual: r.virtual === true })),
    referencedBy: relations.in.map((r) => ({ columns: r.from.columns, table: r.from.table, onMap: shown.has(r.from.table), virtual: r.virtual === true })),
  };
  if (table.description) card.description = table.description;
  return card;
}

export interface LinkCard {
  id: string;
  from: string;
  to: string;
  /** Each relation the line draws: the columns at either end. */
  joins: { from: string[]; to: string[]; virtual: boolean }[];
}

/** A line's card: the two tables and the columns each of its relations joins. */
export function linkCard(graph: Subgraph, id: string): LinkCard | undefined {
  const link = mergeParallel(graph.relations).find((l) => l.id === id);
  if (!link) return undefined;
  return { id: link.id, from: link.from, to: link.to, joins: link.relations.map((r) => ({ from: r.from.columns, to: r.to.columns, virtual: r.virtual === true })) };
}

/** The map without one table, the rest in their order. */
export function without(refs: string[], ref: string): string[] {
  return refs.filter((r) => r !== ref);
}
