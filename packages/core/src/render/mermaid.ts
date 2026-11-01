// Mermaid erDiagram text: GitHub draws it in the Markdown, no image service needed.
import { findTable, relationsOf, type Model, type Relation, type Table } from '../model.ts';

/** Mermaid takes letters, digits and underscores in an entity name. */
export function entityName(ref: string): string {
  return ref.replace(/[^A-Za-z0-9_]/g, '_');
}

/** The table and every table one relation away, in the order the relations are listed. */
export function neighbourhood(model: Model, ref: string): string[] {
  const refs = [ref];
  for (const relation of model.databases.flatMap((d) => d.relations)) {
    const other = relation.from.table === ref ? relation.to.table : relation.to.table === ref ? relation.from.table : undefined;
    if (other !== undefined && !refs.includes(other)) refs.push(other);
  }
  return refs;
}

export function erDiagram(model: Model, refs: string[]): string {
  const lines = ['erDiagram'];
  const shown = new Set(refs);
  for (const ref of refs) {
    const found = findTable(model, ref);
    if (!found) continue;
    const foreign = new Set(relationsOf(model, ref).out.flatMap((r) => r.from.columns));
    lines.push(`  ${entityName(ref)} {`);
    for (const column of found.table.columns) {
      const keys = keyMarks(found.table, column.name, foreign);
      lines.push(`    ${attributeType(column.type)} ${attributeName(column.name)}${keys ? ' ' + keys : ''}`);
    }
    lines.push('  }');
  }
  for (const relation of model.databases.flatMap((d) => d.relations)) {
    if (!shown.has(relation.from.table) || !shown.has(relation.to.table)) continue;
    lines.push(`  ${entityName(relation.from.table)} ${cardinality(model, relation)} ${entityName(relation.to.table)} : ${label(relation)}`);
  }
  return lines.join('\n') + '\n';
}

function keyMarks(table: Table, column: string, foreign: Set<string>): string {
  const marks: string[] = [];
  if (table.primaryKey?.includes(column)) marks.push('PK');
  if (foreign.has(column)) marks.push('FK');
  if (!marks.includes('PK') && table.constraints.some((c) => c.kind === 'unique' && c.columns.length === 1 && c.columns[0] === column)) marks.push('UK');
  return marks.join(',');
}

// Mermaid 11 reads a type as one word of letters, digits, underscores, hyphens, brackets and the commas
// inside them (decimal(18,2) is fine), and a name as one word; it does not take quotes on either, so anything
// else becomes an underscore.
function attributeType(type: string): string {
  return type.replace(/^[^A-Za-z_]|[^A-Za-z0-9_,()[\]-]/g, '_');
}

function attributeName(name: string): string {
  return name.replace(/^[^A-Za-z_]|[^A-Za-z0-9_-]/g, '_');
}

/** many-to-one unless the referencing columns are themselves a key, then one-to-one. Dotted when virtual. */
function cardinality(model: Model, relation: Relation): string {
  const from = findTable(model, relation.from.table)?.table;
  const columns = relation.from.columns.join(',');
  const isKey =
    from !== undefined &&
    (from.primaryKey?.join(',') === columns ||
      from.constraints.some((c) => c.kind === 'unique' && c.columns.join(',') === columns) ||
      from.indexes.some((i) => i.unique && i.columns.join(',') === columns));
  const line = relation.virtual ? '..' : '--';
  return `${isKey ? '|o' : '}o'}${line}||`;
}

function label(relation: Relation): string {
  const text = relation.from.columns.join(', ') + (relation.virtual ? ' (notes)' : '');
  return /^[A-Za-z0-9_]+$/.test(text) ? text : `"${text.replace(/"/g, "'")}"`;
}
