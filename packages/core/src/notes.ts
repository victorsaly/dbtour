// The notes file: what people add that the database cannot say. Merged into the model at render time and
// winning over it, so a production database nobody may alter still gets documented.
import { parse } from 'yaml';
import { findTables, parseRef, type Found, type Group, type Model, type Relation } from './model.ts';

export interface TableNotes {
  description?: string;
  columns?: Record<string, string>;
}

export interface RelationNote {
  from: string;
  to: string;
}

export interface Notes {
  tables: Record<string, TableNotes>;
  relations: RelationNote[];
  groups: Group[];
}

export function parseNotes(text: string): Notes {
  const raw: unknown = parse(text) ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('the notes file must be a map with tables, relations and groups');
  const doc = raw as Record<string, unknown>;
  const notes: Notes = { tables: {}, relations: [], groups: [] };

  if (doc.tables !== undefined) {
    if (typeof doc.tables !== 'object' || doc.tables === null || Array.isArray(doc.tables)) throw new Error('tables must be a map of schema.table to its notes');
    for (const [ref, value] of Object.entries(doc.tables as Record<string, unknown>)) {
      parseRef(ref);
      if (typeof value !== 'object' || value === null) throw new Error(`tables.${ref} must be a map with description and columns`);
      const entry = value as Record<string, unknown>;
      const table: TableNotes = {};
      if (entry.description !== undefined) table.description = String(entry.description);
      if (entry.columns !== undefined) {
        if (typeof entry.columns !== 'object' || entry.columns === null || Array.isArray(entry.columns)) throw new Error(`tables.${ref}.columns must be a map of column to description`);
        table.columns = Object.fromEntries(Object.entries(entry.columns as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
      }
      notes.tables[ref] = table;
    }
  }

  if (doc.relations !== undefined) {
    if (!Array.isArray(doc.relations)) throw new Error('relations must be a list of { from, to }');
    doc.relations.forEach((value, i) => {
      if (typeof value !== 'object' || value === null) throw new Error(`relations[${i}] must be { from, to }`);
      const { from, to } = value as Record<string, unknown>;
      for (const [end, ref] of [['from', from], ['to', to]] as const) {
        if (typeof ref !== 'string' || parseRef(ref).column === undefined) throw new Error(`relations[${i}].${end} must be schema.table.column`);
      }
      notes.relations.push({ from: from as string, to: to as string });
    });
  }

  if (doc.groups !== undefined) {
    if (!Array.isArray(doc.groups)) throw new Error('groups must be a list of { name, description, tables }');
    doc.groups.forEach((value, i) => {
      if (typeof value !== 'object' || value === null) throw new Error(`groups[${i}] must be { name, description, tables }`);
      const entry = value as Record<string, unknown>;
      if (typeof entry.name !== 'string' || entry.name === '') throw new Error(`groups[${i}].name is required`);
      if (!Array.isArray(entry.tables) || entry.tables.some((t) => typeof t !== 'string')) throw new Error(`groups[${i}].tables must be a list of schema.table`);
      entry.tables.forEach((t) => parseRef(t));
      const group: Group = { name: entry.name, tables: entry.tables as string[] };
      if (entry.description !== undefined) group.description = String(entry.description);
      notes.groups.push(group);
    });
  }
  return notes;
}

export interface Applied {
  model: Model;
  /** What the notes name that the model does not have; said, then skipped. */
  warnings: string[];
}

export function applyNotes(input: Model, notes: Notes): Applied {
  const model = structuredClone(input);
  const warnings: string[] = [];
  // The one table a name in the notes means, or a warning: a name two databases share wants its database.
  const find = (ref: string, what: string): Found | undefined => {
    const found = findTables(model, ref);
    if (found.length === 1) return found[0];
    if (found.length === 0) warnings.push(`notes: ${what}`);
    else warnings.push(`notes: ${parseRef(ref).schema}.${parseRef(ref).table} is in ${found.map((f) => f.database.name).join(' and ')}: write ${found.map((f) => f.ref).join(' or ')}`);
    return undefined;
  };

  for (const [ref, tableNotes] of Object.entries(notes.tables)) {
    const found = find(ref, `${ref} is not a table in the model`);
    if (!found) continue;
    if (tableNotes.description !== undefined) found.table.description = tableNotes.description;
    for (const [name, description] of Object.entries(tableNotes.columns ?? {})) {
      const column = found.table.columns.find((c) => c.name === name);
      if (!column) {
        warnings.push(`notes: ${ref}.${name} is not a column in the model`);
        continue;
      }
      column.description = description;
    }
  }

  for (const note of notes.relations) {
    const missing = `relation ${note.from} → ${note.to} names a table that is not in the model`;
    const fromTable = find(note.from, missing);
    const toTable = fromTable && find(note.to, missing);
    if (!fromTable || !toTable) continue;
    if (fromTable.database !== toTable.database) {
      warnings.push(`notes: relation ${note.from} → ${note.to} joins ${fromTable.database.name} to ${toTable.database.name}: relations stay inside one database`);
      continue;
    }
    const relation: Relation = {
      from: { table: fromTable.ref, columns: [parseRef(note.from).column!] },
      to: { table: toTable.ref, columns: [parseRef(note.to).column!] },
      virtual: true,
    };
    const exists = fromTable.database.relations.some((r) => sameEnd(r.from, relation.from) && sameEnd(r.to, relation.to));
    if (!exists) fromTable.database.relations.push(relation);
  }

  for (const group of notes.groups) {
    const tables = group.tables.flatMap((ref) => find(ref, `group ${group.name} lists ${ref}, which is not a table in the model`)?.ref ?? []);
    model.groups.push({ ...group, tables });
  }
  return { model, warnings };
}

function sameEnd(a: { table: string; columns: string[] }, b: { table: string; columns: string[] }): boolean {
  return a.table === b.table && a.columns.join(',') === b.columns.join(',');
}
