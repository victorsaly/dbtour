// Markdown GitHub shows: an index with every table, and one page per table with its columns, keys,
// relations both ways, indexes, constraints and the diagram of its neighbourhood.
import { findTable, isUniqueColumn, relationsOf, tableRef, type Database, type Model, type Table } from '../model.ts';
import { erDiagram, neighbourhood } from './mermaid.ts';

// Mermaid lays out a whole database only while it is small; above this many tables the index shows the
// groups and each table page shows its own neighbourhood instead.
export const wholeDiagramLimit = 40;

export function renderMarkdown(model: Model): Record<string, string> {
  const files: Record<string, string> = { 'README.md': renderIndex(model) };
  for (const database of model.databases) {
    for (const schema of database.schemas) {
      for (const table of schema.tables) {
        const ref = tableRef(schema.name, table.name);
        files[`tables/${ref}.md`] = renderTable(model, ref, table);
      }
    }
  }
  return files;
}

function renderIndex(model: Model): string {
  const parts: string[] = [];
  const single = model.databases.length === 1;
  if (!single) parts.push('# Databases\n');
  for (const database of model.databases) {
    parts.push(`${single ? '#' : '##'} ${database.name}\n`);
    if (database.description) parts.push(`${database.description}\n`);
    parts.push(`${driverLine(database)}\n`);
    parts.push('| Table | Kind | Columns | Description |\n|---|---|---|---|');
    for (const schema of database.schemas) {
      for (const table of schema.tables) {
        const ref = tableRef(schema.name, table.name);
        parts.push(`| [${ref}](tables/${ref}.md) | ${table.kind} | ${table.columns.length} | ${cell(table.description)} |`);
      }
    }
    parts.push('');
  }
  for (const group of model.groups) {
    parts.push(`## ${group.name}\n`);
    if (group.description) parts.push(`${group.description}\n`);
    parts.push(group.tables.map((ref) => `- [${ref}](tables/${ref}.md)`).join('\n') + '\n');
    parts.push(mermaid(erDiagram(model, group.tables)));
  }
  const refs = model.databases.flatMap((d) => d.schemas.flatMap((s) => s.tables.map((t) => tableRef(s.name, t.name))));
  if (refs.length <= wholeDiagramLimit) {
    parts.push('## Diagram\n');
    parts.push(mermaid(erDiagram(model, refs)));
  } else {
    parts.push(`## Diagram\n\n${refs.length} tables is too many for one diagram: each table's page draws its own neighbourhood.\n`);
  }
  return parts.join('\n');
}

/** The product's name for a driver: mssql is SQL Server. */
export function driverName(driver: string): string {
  const names: Record<string, string> = { mssql: 'SQL Server', postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite' };
  return names[driver] ?? driver;
}

function driverLine(database: Database): string {
  const name = driverName(database.driver);
  return database.version ? `${name} ${database.version}.` : `${name}.`;
}

/** One table's page on its own: what the page hands to an agent. */
export function renderTableMarkdown(model: Model, ref: string): string {
  const found = findTable(model, ref);
  if (!found) throw new Error(`${ref} is not a table in the model`);
  return renderTable(model, ref, found.table);
}

function renderTable(model: Model, ref: string, table: Table): string {
  const parts: string[] = [`# ${ref}\n`];
  if (table.description) parts.push(`${table.description}\n`);
  const relations = relationsOf(model, ref);

  parts.push('| Column | Type | Nullable | Default | Key | Description |\n|---|---|---|---|---|---|');
  for (const column of table.columns) {
    const keys: string[] = [];
    if (table.primaryKey?.includes(column.name)) keys.push('PK');
    for (const relation of relations.out) {
      const i = relation.from.columns.indexOf(column.name);
      if (i === -1) continue;
      const { table: toTable, columns } = relation.to;
      keys.push(`FK → [${toTable}](${toTable}.md).${columns[i] ?? columns.join(',')}${relation.virtual ? ' (notes)' : ''}`);
    }
    if (isUniqueColumn(table, column.name)) keys.push('unique');
    if (column.identity) keys.push('identity');
    if (column.computed !== undefined) keys.push(`computed \`${column.computed}\``);
    const dflt = column.default === undefined ? '' : `\`${column.default}\``;
    parts.push(`| ${cell(column.name)} | ${cell(column.type)} | ${column.nullable ? 'yes' : 'no'} | ${cell(dflt)} | ${keys.join(', ')} | ${cell(column.description)} |`);
  }
  parts.push('');

  if (relations.in.length > 0) {
    parts.push('## Referenced by\n');
    const lines = relations.in
      .map((r) => `- [${r.from.table}](${r.from.table}.md).${r.from.columns.join(', ')}${r.virtual ? ' (notes)' : ''}`)
      .sort();
    parts.push(lines.join('\n') + '\n');
  }

  if (table.indexes.length > 0) {
    parts.push('## Indexes\n');
    parts.push('| Name | Columns | Unique |\n|---|---|---|');
    for (const index of table.indexes) {
      const columns = index.columns.join(', ') + (index.included?.length ? ` (includes ${index.included.join(', ')})` : '');
      parts.push(`| ${cell(index.name)} | ${cell(columns)} | ${index.unique ? 'yes' : 'no'} |`);
    }
    parts.push('');
  }

  if (table.constraints.length > 0) {
    parts.push('## Constraints\n');
    parts.push('| Name | Kind | Columns | Definition |\n|---|---|---|---|');
    for (const constraint of table.constraints) {
      const definition = constraint.definition === undefined ? '' : `\`${constraint.definition}\``;
      parts.push(`| ${cell(constraint.name)} | ${constraint.kind} | ${cell(constraint.columns.join(', '))} | ${cell(definition)} |`);
    }
    parts.push('');
  }

  if (table.definition !== undefined) {
    parts.push('## Definition\n');
    parts.push('```sql\n' + table.definition.trim() + '\n```\n');
  }

  const around = neighbourhood(model, ref);
  if (around.length > 1) {
    parts.push('## Diagram\n');
    parts.push(mermaid(erDiagram(model, around)));
  }
  return parts.join('\n');
}

function mermaid(diagram: string): string {
  return '```mermaid\n' + diagram + '```\n';
}

/** A table cell: pipes and line breaks would end it. */
function cell(text: string | undefined): string {
  return (text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export { findTable };
