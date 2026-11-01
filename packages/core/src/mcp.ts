// The model over the Model Context Protocol, so an agent such as Claude asks about the database (find a
// table, read it, join two) instead of being handed all of it. JSON-RPC, one message per line; written here
// rather than taken from the SDK, since four methods are all it needs and core keeps its one dependency.
// Read-only and structure only, like the model: there are no rows to give.
import { findTables, localRef, tableRef, type Database, type Model, type Relation } from './model.ts';
import { driverName, formatCount, renderTableMarkdown } from './render/markdown.ts';
import { buildIndex, search, type Hit } from './search.ts';

// The versions this server speaks, newest first. It uses only initialize, ping, tools/list and tools/call,
// which none of them changed, so it agrees to whichever the client asks for and offers the newest otherwise.
export const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// Above this many tables the overview lists the largest and leaves the rest to search: a list of thousands
// would spend the agent's context on tables the question is not about.
export const overviewLimit = 100;

// Enough hits to choose from without reading past the good ones; the agent can ask for up to the maximum.
const searchDefault = 20;
const searchMaximum = 100;

export interface Context {
  /** The model with its notes, read again when the files change; throws when there is none. */
  model: () => Model;
  version: string;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const instructions = `dbtour knows the structure of this project's databases: tables, views, columns, keys, relations, indexes and the descriptions people wrote. It never holds rows. Start with overview for the databases and their largest tables; search finds a table or column by any part of its name or description; table gives one table's columns, keys and relations as Markdown; path gives the joins between two tables. Name tables as overview and search do (schema.table, or Database:schema.table when there are several databases), and read a table before writing SQL against it.`;

const readOnly = { readOnlyHint: true, openWorldHint: false };

export const toolList = [
  {
    name: 'overview',
    title: 'Overview',
    description: `The databases, how many tables and relations each has, and their tables largest first by rows (all of them up to ${overviewLimit}), with the groups people defined. Call it first, to know what there is.`,
    inputSchema: { type: 'object', properties: {} as Record<string, unknown>, required: [] as string[] },
    annotations: readOnly,
  },
  {
    name: 'search',
    title: 'Search',
    description: 'Find tables, views, columns and groups by any part of their name, type or description. Every word must match. Use it to find where something is kept before reading the table.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, like "customer email".' },
        limit: { type: 'integer', minimum: 1, maximum: searchMaximum, default: searchDefault },
      } as Record<string, unknown>,
      required: ['query'],
    },
    annotations: readOnly,
  },
  {
    name: 'table',
    title: 'Table',
    description: 'One table or view as Markdown: its columns with types, keys and descriptions, the relations both ways, indexes, constraints, a view\'s SQL and a diagram of its neighbours. Read it before writing SQL against the table.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'schema.table, like dbo.Orders, or Sales:dbo.Orders with several databases. A shorter name works when only one table has it.' } } as Record<string, unknown>,
      required: ['ref'],
    },
    annotations: readOnly,
  },
  {
    name: 'path',
    title: 'Join path',
    description: 'The shortest chain of relations between two tables, written as the JOINs that follow them, through any tables between. Use it to join tables that are not related directly.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'The table to start from, named as table takes it.' },
        to: { type: 'string', description: 'The table to reach, named as table takes it.' },
      } as Record<string, unknown>,
      required: ['from', 'to'],
    },
    annotations: readOnly,
  },
];

const toolNames = toolList.map((t) => t.name);

type Id = string | number | null;

/** One line in, at most one line out: a notification and a blank line get none. */
export function answerLine(line: string, context: Context): string | undefined {
  if (line.trim() === '') return undefined;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(failure(null, -32700, 'That line is not JSON: send one JSON-RPC message per line.'));
  }
  const response = answer(message, context);
  return response === undefined ? undefined : JSON.stringify(response);
}

export function answer(message: unknown, context: Context): object | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return failure(null, -32600, 'Send one JSON-RPC request as an object; batches are not accepted.');
  const request = message as Record<string, unknown>;
  // An id that is neither a string nor a number cannot be echoed back, so its error carries null.
  const validId = typeof request.id === 'string' || typeof request.id === 'number';
  const id = validId ? (request.id as Id) : null;
  if (request.jsonrpc !== '2.0') return failure(id, -32600, 'A request must say "jsonrpc": "2.0".');
  if (typeof request.method !== 'string') return failure(id, -32600, 'A request needs a method.');
  // A notification wants no answer, whatever it says.
  if (!('id' in request)) return undefined;
  if (!validId) return failure(null, -32600, 'A request id must be a string or a number.');
  const params = typeof request.params === 'object' && request.params !== null ? (request.params as Record<string, unknown>) : {};
  switch (request.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return success(id, {
        protocolVersion: typeof asked === 'string' && protocolVersions.includes(asked) ? asked : protocolVersions[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'dbtour', version: context.version },
        instructions,
      });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: toolList });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !toolNames.includes(name)) return failure(id, -32602, `There is no tool "${String(name)}": the tools are ${toolNames.join(', ')}.`);
      const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
      let model: Model;
      try {
        model = context.model();
      } catch (error) {
        return success(id, problem(error instanceof Error ? error.message : String(error)));
      }
      return success(id, callTool(model, name, args));
    }
    default:
      return failure(id, -32601, `dbtour does not answer ${request.method}: it offers tools only.`);
  }
}

function success(id: Id, result: object): object {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: Id, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/** A failed call goes back to the agent as text it can act on, not as a protocol error. */
function problem(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

export function callTool(model: Model, name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case 'overview':
      return text(overview(model));
    case 'search': {
      if (typeof args.query !== 'string' || args.query.trim() === '') return problem('search needs a query: the words to look for, like "customer email".');
      const limit = typeof args.limit === 'number' ? Math.min(Math.max(1, Math.floor(args.limit)), searchMaximum) : searchDefault;
      return text(searchText(model, args.query, limit));
    }
    case 'table': {
      if (typeof args.ref !== 'string') return problem('table needs a ref: schema.table, like dbo.Orders.');
      const found = resolve(model, args.ref);
      return 'problem' in found ? problem(found.problem) : text(renderTableMarkdown(model, found.ref));
    }
    case 'path': {
      if (typeof args.from !== 'string' || typeof args.to !== 'string') return problem('path needs from and to: two tables as schema.table.');
      const from = resolve(model, args.from);
      if ('problem' in from) return problem(from.problem);
      const to = resolve(model, args.to);
      if ('problem' in to) return problem(to.problem);
      return text(pathText(model, from.ref, to.ref));
    }
    default:
      return problem(`There is no tool "${name}": the tools are ${toolNames.join(', ')}.`);
  }
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

function overview(model: Model): string {
  const parts: string[] = [];
  for (const database of model.databases) parts.push(overviewOf(database));
  for (const group of model.groups) {
    parts.push(`## ${group.name}\n`);
    if (group.description) parts.push(`${group.description}\n`);
    parts.push(`${group.tables.join(', ')}\n`);
  }
  parts.push('Read a table with table, find one with search, join two with path.');
  return parts.join('\n');
}

function overviewOf(database: Database): string {
  const entries = database.schemas.flatMap((s) => s.tables.map((table) => ({ ref: tableRef(s.name, table.name), table })));
  const sized = entries.some((e) => e.table.stats);
  // Largest first, so the tables everything hangs off come before the lookups; a view or a table the source
  // could not count keeps its catalogue place after them. Array.sort is stable, which keeps that order.
  const ordered = sized ? [...entries].sort((a, b) => (b.table.stats?.rows ?? -1) - (a.table.stats?.rows ?? -1)) : entries;
  const parts = [`# ${database.name}\n`];
  if (database.description) parts.push(`${database.description}\n`);
  const driver = database.version ? `${driverName(database.driver)} ${database.version}` : driverName(database.driver);
  parts.push(`${driver}. ${plural(entries.length, 'table or view', 'tables and views')} in ${plural(database.schemas.length, 'schema', 'schemas')}, ${plural(database.relations.length, 'relation', 'relations')}.\n`);
  if (sized) parts.push(`Largest first, by the rows the database counted${database.statsReadAt ? ` on ${database.statsReadAt.slice(0, 10)}` : ''}; its own estimate.\n`);
  parts.push(sized ? '| Table | Kind | Columns | Rows | Description |\n|---|---|---|---|---|' : '| Table | Kind | Columns | Description |\n|---|---|---|---|');
  for (const { ref, table } of ordered.slice(0, overviewLimit)) {
    const rows = !sized ? '' : ` ${table.stats ? formatCount(table.stats.rows) : ''} |`;
    parts.push(`| ${ref} | ${table.kind} | ${table.columns.length} |${rows} ${(table.description ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`);
  }
  if (entries.length > overviewLimit) parts.push(`\n${formatCount(entries.length - overviewLimit)} more: search finds them.`);
  parts.push('');
  return parts.join('\n');
}

const indexes = new WeakMap<Model, ReturnType<typeof buildIndex>>();

function hitsFor(model: Model, query: string, limit: number): Hit[] {
  let index = indexes.get(model);
  if (!index) {
    index = buildIndex(model);
    indexes.set(model, index);
  }
  return search(index, query, limit);
}

function searchText(model: Model, query: string, limit: number): string {
  const hits = hitsFor(model, query, limit);
  if (hits.length === 0) return `Nothing matches "${query}". Every word must match: try fewer words, or part of a name.`;
  return hits.map((h) => `- ${h.kind} ${h.title}: ${h.detail}`).join('\n');
}

/**
 * What an agent wrote, as the table it means: exact, then ignoring case, as the whole name, the name without
 * its database, or a bare table name. A name several tables answer to is a problem that lists them.
 */
function resolve(model: Model, written: string): { ref: string } | { problem: string } {
  const parts = written.trim().split('.');
  // schema.table.column is the table; a bare name is looked up by name alone.
  const wanted = parts.length === 3 ? parts.slice(0, 2).join('.') : parts.join('.');
  const several = (refs: string[]) => ({ problem: `${refs.slice(0, -1).join(', ')} and ${refs.at(-1)} are ${refs.length === 2 ? 'both' : 'all'} called ${wanted}: ask for one by the name given here.` });
  if (parts.length >= 2 && parts.length <= 3 && !parts.includes('')) {
    const exact = findTables(model, wanted).map((f) => f.ref);
    if (exact.length === 1) return { ref: exact[0] };
    if (exact.length > 1) return several(exact);
  }
  const all = [...new Set(model.databases.flatMap((d) => d.schemas.flatMap((s) => s.tables.map((t) => tableRef(s.name, t.name)))))];
  const lower = wanted.toLowerCase();
  // The whole name, the name an agent writes when it does not know there are several databases, the table's.
  const forms = (ref: string) => {
    const local = localRef(model, ref);
    return [ref, local, local.slice(local.indexOf('.') + 1)];
  };
  const matches = all.filter((ref) => forms(ref).some((form) => form.toLowerCase() === lower));
  if (matches.length === 1) return { ref: matches[0] };
  if (matches.length > 1) return several(matches);
  const name = wanted.slice(wanted.lastIndexOf('.') + 1);
  const near = [...new Set(hitsFor(model, name, searchDefault).filter((h) => h.kind === 'table' || h.kind === 'view').map((h) => h.ref))].slice(0, 5);
  return { problem: `"${written}" is not a table. ${near.length > 0 ? `Did you mean ${near.join(', ')}?` : 'overview lists them, and search finds one by any part of its name.'}` };
}

interface Step {
  relation: Relation;
  /** The table this step reaches. */
  table: string;
  /** Whether it follows the relation from its foreign key to the key it references. */
  forward: boolean;
}

/** The databases that have a table of this name: refs carry no database, so two can share one. */
function databasesWith(model: Model, ref: string): Database[] {
  return model.databases.filter((d) => d.schemas.some((s) => s.tables.some((t) => tableRef(s.name, t.name) === ref)));
}

// Each database quotes names its own way: brackets in SQL Server, backticks in MySQL, the standard double
// quotes elsewhere. Every name is quoted, since a reserved word (User, Order) or a space breaks a bare one,
// and the closing quote inside a name is doubled.
function quote(driver: string, name: string): string {
  if (driver === 'mssql') return `[${name.replace(/]/g, ']]')}]`;
  if (driver === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** schema.table as its database names it, quoted: the SQL runs in the database the path was found in. */
function quoteRef(model: Model, driver: string, ref: string, column?: string): string {
  const local = localRef(model, ref);
  const dot = local.indexOf('.');
  const names = [local.slice(0, dot), local.slice(dot + 1), ...(column === undefined ? [] : [column])];
  return names.map((name) => quote(driver, name)).join('.');
}

function pathText(model: Model, from: string, to: string): string {
  if (from === to) return `${from} is the same table at both ends: no join is needed.`;
  // Relations stay inside their database, so the search runs in each database that has both tables.
  const toDatabases = databasesWith(model, to);
  const shared = databasesWith(model, from).filter((d) => toDatabases.includes(d));
  if (shared.length === 0) {
    const names = (ref: string) => databasesWith(model, ref).map((d) => d.name).join(' and ');
    return `${from} is in ${names(from)} and ${to} in ${names(to)}: relations do not cross databases, so no join connects them.`;
  }
  let best: { database: Database; steps: Step[] } | undefined;
  for (const database of shared) {
    const steps = shortestPath(database.relations, from, to);
    if (steps && (!best || steps.length < best.steps.length)) best = { database, steps };
  }
  if (!best) {
    return `No relation connects ${from} and ${to}, declared or in the notes. If they are related all the same, add the relation to dbtour.notes.yaml so the docs and this path know it.`;
  }
  const { driver } = best.database;
  const lines = [`FROM ${quoteRef(model, driver, from)}`];
  let at = from;
  for (const step of best.steps) {
    const mine = step.forward ? step.relation.to.columns : step.relation.from.columns;
    const theirs = step.forward ? step.relation.from.columns : step.relation.to.columns;
    const on = mine.map((column, i) => `${quoteRef(model, driver, step.table, column)} = ${quoteRef(model, driver, at, theirs[i] ?? theirs[0])}`).join(' AND ');
    lines.push(`JOIN ${quoteRef(model, driver, step.table)} ON ${on}${step.relation.virtual ? ' -- from the notes, not a declared key' : ''}`);
    at = step.table;
  }
  const where = model.databases.length > 1 ? `In ${best.database.name}, ` : '';
  return `${where}${from} to ${to}: ${plural(best.steps.length, 'join', 'joins')}.\n\n\`\`\`sql\n${lines.join('\n')}\n\`\`\`\n\nEach JOIN follows a relation as the docs record it; read the tables to choose the columns and whether a LEFT JOIN suits.`;
}

/** Breadth first over one database's relations both ways, so the first path found is a shortest one. */
function shortestPath(relations: Relation[], from: string, to: string): Step[] | undefined {
  const reached = new Map<string, Step[]>([[from, []]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift() as string;
    const path = reached.get(at) as Step[];
    for (const relation of relations) {
      // A table that references itself leads nowhere new.
      if (relation.from.table === relation.to.table) continue;
      const step: Step | undefined =
        relation.from.table === at ? { relation, table: relation.to.table, forward: true } : relation.to.table === at ? { relation, table: relation.from.table, forward: false } : undefined;
      if (!step || reached.has(step.table)) continue;
      const next = [...path, step];
      if (step.table === to) return next;
      reached.set(step.table, next);
      queue.push(step.table);
    }
  }
  return undefined;
}
