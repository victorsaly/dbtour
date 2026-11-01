// Markdown GitHub shows: an index with every table, and one page per table with its columns, keys,
// relations both ways, indexes, constraints and the diagram of its neighbourhood.
import { databaseSeparator, findTable, isUniqueColumn, relationsOf, tableRef, type Column, type Constraint, type Database, type Index, type Model, type Properties, type Relation, type Table, type TableStats } from '../model.ts';
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
        files[`tables/${tableFile(ref)}`] = renderTable(model, ref, table, database);
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
    if (database.unread?.length) parts.push(`Not read: ${database.unread.join('; ')}.\n`);
    // Rows and size only when the source read them; a view, which keeps no rows of its own, leaves them blank.
    const sized = database.schemas.some((s) => s.tables.some((t) => t.stats));
    parts.push(sized ? '| Table | Kind | Columns | Rows | Size | Description |\n|---|---|---|---|---|---|' : '| Table | Kind | Columns | Description |\n|---|---|---|---|');
    for (const schema of database.schemas) {
      for (const table of schema.tables) {
        const ref = tableRef(schema.name, table.name);
        const size = !sized ? '' : table.stats ? ` ${formatCount(table.stats.rows)} | ${formatBytes(table.stats.dataBytes + table.stats.indexBytes)} |` : '  |  |';
        parts.push(`| [${ref}](${href(`tables/${tableFile(ref)}`)}) | ${table.kind} | ${table.columns.length} |${size} ${cell(table.description)} |`);
      }
    }
    parts.push('');
  }
  const owned: [string, Properties | undefined][] = model.databases.flatMap((d) => [[d.name, d.properties] as [string, Properties | undefined], ...d.schemas.map((s) => [s.name, s.properties] as [string, Properties | undefined])]);
  const properties = propertiesTable(owned);
  if (properties) parts.push(`## Properties\n\n${properties}`);
  for (const group of model.groups) {
    parts.push(`## ${group.name}\n`);
    if (group.description) parts.push(`${group.description}\n`);
    parts.push(group.tables.map((ref) => `- [${ref}](${href(`tables/${tableFile(ref)}`)})`).join('\n') + '\n');
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
  const collation = database.collation ? `, collation ${database.collation}` : '';
  return `${database.version ? `${name} ${database.version}` : name}${collation}.`;
}

/** A thing the catalogue says about a table beyond its columns and keys: a name, and its particulars. */
export interface Feature {
  name: string;
  detail?: string;
  /** A table the detail names, for a link. */
  ref?: string;
}

/** What the catalogue says about a table beyond its columns and keys, in the order a reader weighs it. */
export function features(table: Table): Feature[] {
  const list: Feature[] = [];
  if (table.temporal) {
    const { history, start, end } = table.temporal;
    list.push({ name: 'System-versioned', detail: `history in ${history}, each row valid from ${start} to ${end}`, ref: history });
  }
  if (table.historyOf) list.push({ name: 'History', detail: `of ${table.historyOf}`, ref: table.historyOf });
  if (table.memoryOptimised) list.push({ name: 'Memory-optimised', detail: table.memoryOptimised });
  if (table.ledger) list.push({ name: 'Ledger', detail: table.ledger });
  if (table.partitioning) {
    const { column, scheme, function: fn, partitions } = table.partitioning;
    list.push({ name: 'Partitioned', detail: `on ${column} by ${scheme} (function ${fn}), ${partitions} partitions` });
  }
  // A list is a table whose partitions are compressed differently.
  if (table.compression) list.push({ name: 'Compressed', detail: table.compression.includes(',') ? `${table.compression}, by partition` : table.compression });
  if (table.changeTracking) list.push({ name: 'Change tracking' });
  if (table.cdc) list.push({ name: 'Change data capture' });
  if (table.triggers?.length) list.push({ name: 'Triggers', detail: String(table.triggers.length) });
  if (table.security?.length) list.push({ name: 'Row-level security', detail: [...new Set(table.security.map((s) => s.policy))].join(', ') });
  if (table.created) {
    const altered = table.altered && table.altered.slice(0, 10) !== table.created.slice(0, 10) ? `, last altered ${table.altered.slice(0, 10)}` : '';
    list.push({ name: 'Created', detail: `${table.created.slice(0, 10)}${altered}` });
  }
  return list;
}

/** A column's type, with its collation where it differs from the database's. */
function columnType(column: Column): string {
  return column.collation ? `${column.type}, collation ${column.collation}` : column.type;
}

/** What else the catalogue says about a column, for the Key cell: identity, sparse, masking, encryption. */
function columnTraits(column: Column): string[] {
  const traits: string[] = [];
  if (column.identity) traits.push(column.identitySeed !== undefined ? `identity(${column.identitySeed},${column.identityIncrement ?? '1'})` : 'identity');
  if (column.computed !== undefined) traits.push(`computed \`${column.computed}\``);
  if (column.sparse) traits.push('sparse');
  if (column.masked) traits.push(`masked \`${column.masked}\``);
  if (column.encrypted) traits.push(`encrypted (${column.encrypted.type}, ${column.encrypted.key})`);
  return traits;
}

/** The description cell: the description, then the sensitivity classification when there is one. */
function columnDescription(column: Column): string {
  const parts = column.description ? [column.description] : [];
  const s = column.sensitivity;
  if (s) parts.push(`Sensitivity: ${[s.label, s.informationType, s.rank && `rank ${s.rank}`].filter(Boolean).join(', ')}.`);
  return parts.join(' ');
}

/** Not enforced, or not checked against the rows already there. */
function enforcement(item: Constraint | Relation): string[] {
  return [item.disabled ? 'disabled' : '', item.untrusted ? 'not trusted' : ''].filter(Boolean);
}

function indexKind(index: Index): string {
  return [index.type ?? '', index.filter ? `filtered \`${index.filter}\`` : '', index.disabled ? 'disabled' : ''].filter(Boolean).join(', ');
}

/** Every extended property of the things listed, one row each; empty when there are none. */
function propertiesTable(owners: [string, Properties | undefined][]): string {
  const rows = owners.flatMap(([on, properties]) => Object.entries(properties ?? {}).map(([name, value]) => `| ${cell(on)} | ${cell(name)} | ${cell(value)} |`));
  return rows.length === 0 ? '' : `| On | Name | Value |\n|---|---|---|\n${rows.join('\n')}\n`;
}

/** 1,204,377: thousands grouped the same way wherever it runs, so the docs do not change with the machine. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 480 KB, 7.1 MB, 102 MB: binary units, as the database counts its pages, with one decimal below ten. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${byteUnits[unit]}`;
}

/** The sentence under a table's title: the count is the database's estimate, so it says about, and when. */
export function statsLine(stats: TableStats, readAt?: string): string {
  const when = readAt ? `, as the database counted them on ${readAt.slice(0, 10)}` : '';
  return `About ${formatCount(stats.rows)} rows · ${formatBytes(stats.dataBytes)} of data · ${formatBytes(stats.indexBytes)} of indexes${when}.`;
}

/** A table's page under tables/: Sales:dbo.Orders is in a folder for its database, dbo.Orders is not. */
export function tableFile(ref: string): string {
  return ref.replace(databaseSeparator, '/') + '.md';
}

/** A link from one table's page to another's: the file beside it, or up and across to another folder. */
function pageLink(from: string, to: string): string {
  const folder = (ref: string) => (ref.includes(databaseSeparator) ? ref.slice(0, ref.indexOf(databaseSeparator)) : '');
  const file = tableFile(to);
  if (folder(from) === folder(to)) return href(file.slice(file.indexOf('/') + 1));
  return href((folder(from) ? '../' : '') + file);
}

/** A path as a link's destination: each part encoded, so a space or a # in a name still reaches its file. */
function href(path: string): string {
  return path.split('/').map((part) => (part === '..' ? part : encodeURIComponent(part))).join('/');
}

/** One table's page on its own: what the page hands to an agent. */
export function renderTableMarkdown(model: Model, ref: string): string {
  const found = findTable(model, ref);
  if (!found) throw new Error(`${ref} is not a table in the model`);
  return renderTable(model, found.ref, found.table, found.database);
}

function renderTable(model: Model, ref: string, table: Table, database: Database): string {
  const parts: string[] = [`# ${ref}\n`];
  if (table.description) parts.push(`${table.description}\n`);
  if (table.stats) parts.push(`${statsLine(table.stats, database.statsReadAt)}\n`);
  const listed = features(table);
  if (listed.length > 0) {
    parts.push('## Features\n');
    // A table the feature names gets a link when it is in the model, as a relation's would.
    const linked = (f: Feature): string | undefined => (f.ref && f.detail && findTable(model, f.ref) ? f.detail.replace(f.ref, `[${f.ref}](${pageLink(ref, f.ref)})`) : f.detail);
    parts.push(listed.map((f) => `- **${f.name}**${f.detail ? `: ${linked(f)}` : ''}`).join('\n') + '\n');
  }
  const relations = relationsOf(model, ref);

  parts.push('| Column | Type | Nullable | Default | Key | Description |\n|---|---|---|---|---|---|');
  for (const column of table.columns) {
    const keys: string[] = [];
    if (table.primaryKey?.includes(column.name)) keys.push('PK');
    for (const relation of relations.out) {
      const i = relation.from.columns.indexOf(column.name);
      if (i === -1) continue;
      const { table: toTable, columns } = relation.to;
      const state = [relation.virtual ? 'notes' : '', ...enforcement(relation)].filter(Boolean);
      keys.push(`FK → [${toTable}](${pageLink(ref, toTable)}).${columns[i] ?? columns.join(',')}${state.length ? ` (${state.join(', ')})` : ''}`);
    }
    if (isUniqueColumn(table, column.name)) keys.push('unique');
    keys.push(...columnTraits(column));
    const dflt = column.default === undefined ? '' : `\`${column.default}\``;
    parts.push(`| ${cell(column.name)} | ${cell(columnType(column))} | ${column.nullable ? 'yes' : 'no'} | ${cell(dflt)} | ${cell(keys.join(', '))} | ${cell(columnDescription(column))} |`);
  }
  parts.push('');

  if (relations.in.length > 0) {
    parts.push('## Referenced by\n');
    const lines = relations.in
      .map((r) => `- [${r.from.table}](${pageLink(ref, r.from.table)}).${r.from.columns.join(', ')}${r.virtual ? ' (notes)' : ''}`)
      .sort();
    parts.push(lines.join('\n') + '\n');
  }

  if (table.indexes.length > 0) {
    parts.push('## Indexes\n');
    // The Kind column only when the source said what kind; a model without it renders as it always did.
    const kinds = table.indexes.some((i) => indexKind(i) !== '');
    parts.push(kinds ? '| Name | Columns | Unique | Kind |\n|---|---|---|---|' : '| Name | Columns | Unique |\n|---|---|---|');
    for (const index of table.indexes) {
      const columns = index.columns.join(', ') + (index.included?.length ? ` (includes ${index.included.join(', ')})` : '');
      parts.push(`| ${cell(index.name)} | ${cell(columns)} | ${index.unique ? 'yes' : 'no'} |${kinds ? ` ${cell(indexKind(index))} |` : ''}`);
    }
    parts.push('');
  }

  if (table.constraints.length > 0) {
    parts.push('## Constraints\n');
    parts.push('| Name | Kind | Columns | Definition |\n|---|---|---|---|');
    for (const constraint of table.constraints) {
      const definition = constraint.definition === undefined ? '' : `\`${constraint.definition}\``;
      const kind = [constraint.kind, ...enforcement(constraint)].join(', ');
      parts.push(`| ${cell(constraint.name)} | ${kind} | ${cell(constraint.columns.join(', '))} | ${cell(definition)} |`);
    }
    parts.push('');
  }

  const properties = propertiesTable([
    [ref, table.properties],
    ...table.columns.map((c) => [c.name, c.properties] as [string, Properties | undefined]),
    ...table.indexes.map((i) => [i.name, i.properties] as [string, Properties | undefined]),
    ...table.constraints.map((c) => [c.name, c.properties] as [string, Properties | undefined]),
  ]);
  if (properties) parts.push(`## Properties\n\n${properties}`);

  if (table.triggers?.length) {
    parts.push('## Triggers\n');
    for (const trigger of table.triggers) {
      const when = `${trigger.timing === 'after' ? 'After' : 'Instead of'} ${trigger.events.join(', ')}. ${trigger.enabled ? 'Enabled' : 'Disabled'}.`;
      parts.push(`### ${trigger.name}\n\n${when}\n`);
      if (trigger.definition) parts.push('```sql\n' + trigger.definition.trim() + '\n```\n');
    }
  }

  if (table.security?.length) {
    parts.push('## Row-level security\n');
    parts.push('| Policy | Kind | Predicate | Enabled |\n|---|---|---|---|');
    for (const s of table.security) {
      const kind = s.operation ? `${s.kind}, ${s.operation}` : s.kind;
      parts.push(`| ${cell(s.policy)} | ${kind} | ${cell(`\`${s.predicate}\``)} | ${s.enabled ? 'yes' : 'no'} |`);
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
