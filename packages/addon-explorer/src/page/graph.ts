// What a diagram shows: a set of tables and the relations among them. Never the whole schema; the user
// starts from one table and expands outwards.
import { findTable, type Model, type Relation } from 'dbtour/model';

export interface Subgraph {
  tables: string[];
  relations: Relation[];
}

/** The tables one relation away from ref, in the order the relations are listed, ref itself excluded. */
export function neighbours(model: Model, ref: string): string[] {
  const found: string[] = [];
  for (const relation of model.databases.flatMap((d) => d.relations)) {
    const other = relation.from.table === ref ? relation.to.table : relation.to.table === ref ? relation.from.table : undefined;
    if (other !== undefined && other !== ref && !found.includes(other)) found.push(other);
  }
  return found;
}

/** refs, then the neighbours of each, without repeats. */
export function withNeighbours(model: Model, refs: string[]): string[] {
  const all = [...new Set(refs)];
  for (const ref of refs) for (const other of neighbours(model, ref)) if (!all.includes(other)) all.push(other);
  return all;
}

/** The diagram grown by one table's neighbours; the same list when nothing is new. */
export function expand(model: Model, refs: string[], ref: string): string[] {
  const all = [...new Set(refs)];
  if (!all.includes(ref)) all.push(ref);
  for (const other of neighbours(model, ref)) if (!all.includes(other)) all.push(other);
  return all;
}

/** Every table in the model, in the order it lists them. */
export function allTables(model: Model): string[] {
  return model.databases.flatMap((d) => d.schemas.flatMap((s) => s.tables.map((t) => `${s.name}.${t.name}`)));
}

/** One relation, named for the links panel and the hidden set. */
export function relationId(relation: Relation): string {
  return `${relation.from.table}.${relation.from.columns.join(',')}>${relation.to.table}.${relation.to.columns.join(',')}`;
}

/** One line on the map: every relation between the same two tables in the same direction. */
export interface Link {
  id: string;
  from: string;
  to: string;
  relations: Relation[];
}

/** Parallel relations (CreatedById and UpdatedById both to Users) drawn as one line naming every column. */
export function mergeParallel(relations: Relation[]): Link[] {
  const links = new Map<string, Link>();
  for (const relation of relations) {
    const id = `${relation.from.table}>${relation.to.table}`;
    const link = links.get(id) ?? { id, from: relation.from.table, to: relation.to.table, relations: [] };
    link.relations.push(relation);
    links.set(id, link);
  }
  return [...links.values()];
}

/** Only tables the model has, and only relations with both ends among them. */
export function subgraph(model: Model, refs: string[]): Subgraph {
  const tables = [...new Set(refs)].filter((ref) => findTable(model, ref) !== undefined);
  const shown = new Set(tables);
  const relations = model.databases.flatMap((d) => d.relations).filter((r) => shown.has(r.from.table) && shown.has(r.to.table));
  return { tables, relations };
}
