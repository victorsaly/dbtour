// The command. Reads dbtour.yaml in the working directory, writes under its `out`. Exit 1 for what was
// asked and failed, 2 for what is missing, 0 otherwise.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { configFile, defaultConfigText, modelFile, parseConfig, resolveConnection, resolveReader, type AddonConfig, type Config, type SourceConfig } from './config.ts';
import { emptyModel, scope, validate, type Api, type Database, type Model } from './model.ts';
import { applyNotes, parseNotes } from './notes.ts';
import { answerLine, type ToolResult } from './mcp.ts';
import { checkQuery, clampLimit, defaultTimeoutMs, resultText, type QueryResult } from './sql.ts';
import { loadAddon, loadSource, type Addon, type Importer, type Source } from './plugins.ts';
import { renderMarkdown } from './render/markdown.ts';

export interface Io {
  cwd: string;
  log: (line: string) => void;
  error: (line: string) => void;
  env?: Record<string, string | undefined>;
  /** How a source is loaded; tests hand in their own. */
  load?: (source: SourceConfig) => Promise<Source>;
  /** How an add-on is loaded; tests hand in their own. */
  loadAddon?: (addon: AddonConfig) => Promise<Addon>;
  /** Where mcp reads requests and writes answers; process.stdin and process.stdout unless a test hands in its own. */
  stdin?: Readable;
  stdout?: Writable;
}

const help = `Usage: dbtour <command>

  init [--source mssql]   write ${configFile} here
  extract                 read every source in ${configFile}, write <out>/${modelFile}
  render                  read <out>/${modelFile} and the notes, write the Markdown and what the
                          add-ons in ${configFile} render (explorer: index.html) under <out>
  mcp [project]           answer an agent's questions about <out>/${modelFile} and the notes over MCP,
                          on stdin and stdout: claude mcp add dbtour -- npx dbtour mcp
  sql "<query>"           run one SELECT through a source's reader, a read-only login of its own,
                          rolled back, at most --limit rows (100); --source <name>, --json

Set the connection string in the environment variable ${configFile} names, never in the file.`;

export async function main(argv: string[], io: Io = { cwd: process.cwd(), log: console.log, error: console.error }): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { help: { type: 'boolean', short: 'h' }, source: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } },
    allowPositionals: true,
    strict: false,
  });
  const command = positionals[0];
  if (values.help || command === undefined) {
    io.log(help);
    return 0;
  }
  try {
    switch (command) {
      case 'init':
        return init(io, typeof values.source === 'string' ? values.source : 'mssql');
      case 'extract':
        return await extract(io);
      case 'render':
        return await render(io);
      case 'mcp':
        return await mcp(positionals[1] === undefined ? io : { ...io, cwd: resolve(io.cwd, positionals[1]) });
      case 'sql':
        return await sql(io, positionals[1], {
          source: typeof values.source === 'string' ? values.source : undefined,
          limit: typeof values.limit === 'string' ? Number(values.limit) : undefined,
          json: values.json === true,
        });
      default:
        io.error(`"${command}" is not a dbtour command.\n\n${help}`);
        return 1;
    }
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return (error as { exitCode?: number }).exitCode ?? 1;
  }
}

function missing(message: string): Error {
  return Object.assign(new Error(message), { exitCode: 2 });
}

function init(io: Io, source: string): number {
  const path = join(io.cwd, configFile);
  if (existsSync(path)) {
    io.error(`${configFile} already exists here. Edit it, or delete it and run dbtour init again.`);
    return 1;
  }
  writeFileSync(path, defaultConfigText(source));
  io.log(`Wrote ${configFile}. Set the connection string in DBTOUR_${source.toUpperCase()}, then run dbtour extract.`);
  return 0;
}

function readConfig(io: Io): Config {
  const path = join(io.cwd, configFile);
  if (!existsSync(path)) throw missing(`No ${configFile} here. Run dbtour init to write one.`);
  return parseConfig(readFileSync(path, 'utf8'));
}

async function extract(io: Io): Promise<number> {
  const config = readConfig(io);
  const env = io.env ?? process.env;
  const load = io.load ?? ((source: SourceConfig) => loadSource(source, importer(io.cwd)));
  const model: Model = { ...emptyModel(), generatedAt: new Date().toISOString() };
  for (const source of config.sources) {
    const connection = resolveConnection(source.connection, env);
    const { extract } = await load(source);
    let result: Database | Api;
    try {
      result = await extract({ ...source, connection });
    } catch (error) {
      io.error(`${source.name} (${source.type}): ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    if ('schemas' in result) {
      model.databases.push(result);
      const tables = result.schemas.reduce((n, s) => n + s.tables.length, 0);
      io.log(`${result.name}: ${tables} tables, ${result.relations.length} relations`);
      // Not a failure: the rest was read, and an absence the model records is not taken for a no.
      for (const reason of result.unread ?? []) io.log(`${result.name}: not read: ${reason}. Grant it to read them, or leave them out.`);
    } else {
      model.apis.push(result);
      io.log(`${result.name}: ${result.endpoints.length} endpoints`);
    }
  }
  const checked = validate(model);
  if (!checked.ok) {
    io.error(`A source returned something that is not a model:\n  ${checked.errors.join('\n  ')}`);
    return 1;
  }
  const path = join(io.cwd, config.out, modelFile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model, null, 2) + '\n');
  io.log(`Wrote ${join(config.out, modelFile)}. Run dbtour render to write the docs.`);
  return 0;
}

/** A module given as a path is relative to the project, not to dbtour. */
function importer(cwd: string): Importer {
  return (specifier) => import(specifier.startsWith('.') || specifier.startsWith('/') ? pathToFileURL(resolve(cwd, specifier)).href : specifier);
}

/**
 * <out>/schema.json with the notes merged in, as render and mcp read it: scoped first, so with several
 * databases the notes may name a table with its database or, where only one has it, without.
 */
function readModel(io: Io, config: Config): Model {
  const modelPath = join(io.cwd, config.out, modelFile);
  if (!existsSync(modelPath)) throw missing(`No ${join(config.out, modelFile)} yet. Run dbtour extract to write it.`);
  const checked = validate(JSON.parse(readFileSync(modelPath, 'utf8')));
  if (!checked.ok) throw new Error(`${join(config.out, modelFile)} is not a model:\n  ${checked.errors.join('\n  ')}`);
  const model = scope(checked.model);
  const notesPath = join(io.cwd, config.notes);
  if (!existsSync(notesPath)) return model;
  const applied = applyNotes(model, parseNotes(readFileSync(notesPath, 'utf8')));
  for (const warning of applied.warnings) io.error(warning);
  return applied.model;
}

async function render(io: Io): Promise<number> {
  const config = readConfig(io);
  let model = readModel(io, config);
  // Every add-on is loaded before anything is written, so a missing one stops the run with nothing half done.
  const load = io.loadAddon ?? ((addon: AddonConfig) => loadAddon(addon, importer(io.cwd)));
  const addons: Addon[] = [];
  for (const addon of config.addons) {
    try {
      addons.push(await load(addon));
    } catch (error) {
      throw missing(error instanceof Error ? error.message : String(error));
    }
  }
  for (const addon of addons) if (addon.enrich) model = await addon.enrich(model);
  const files = renderMarkdown(model);
  for (const addon of addons) if (addon.render) Object.assign(files, await addon.render(model));
  for (const [name, text] of Object.entries(files)) {
    const path = join(io.cwd, config.out, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  io.log(`Wrote ${Object.keys(files).length} files to ${config.out}.`);
  return 0;
}

/**
 * Serves the model to an agent until stdin closes. Read once now, so a missing model stops it with the
 * command to run, then again whenever schema.json or the notes change, so a render while the agent is
 * connected is seen at its next question. Everything but answers goes to stderr: stdout is the protocol.
 */
async function mcp(io: Io): Promise<number> {
  const config = readConfig(io);
  const files = [join(io.cwd, config.out, modelFile), join(io.cwd, config.notes)];
  const stamp = () => files.map((f) => (existsSync(f) ? statSync(f).mtimeMs : 0)).join();
  let model = readModel(io, config);
  let read = stamp();
  const current = (): Model => {
    const now = stamp();
    if (now !== read) {
      model = readModel(io, config);
      read = now;
    }
    return model;
  };
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  const output = io.stdout ?? process.stdout;
  // The query tool is offered only when a source has a reader; its errors go back to the agent as text.
  const run = config.sources.some((s) => s.reader !== undefined)
    ? async (text: string, source: string | undefined, limit: number | undefined): Promise<ToolResult> => {
        try {
          return { content: [{ type: 'text', text: resultText(await runQuery(io, config, text, source, limit)) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
      }
    : undefined;
  // One request at a time, in order: a query is awaited before the next line is read.
  for await (const line of createInterface({ input: io.stdin ?? process.stdin, crlfDelay: Infinity })) {
    const reply = await answerLine(line, { model: current, version, run });
    if (reply !== undefined) output.write(reply + '\n');
  }
  return 0;
}

async function sql(io: Io, text: string | undefined, options: { source?: string; limit?: number; json: boolean }): Promise<number> {
  if (text === undefined || text.trim() === '') {
    io.error('Give the query to run: dbtour sql "SELECT TOP (10) * FROM dbo.Orders"');
    return 1;
  }
  const result = await runQuery(io, readConfig(io), text, options.source, options.limit);
  io.log(options.json ? JSON.stringify(result, cellJson, 2) : resultText(result));
  return 0;
}

/** JSON for a cell: a date as ISO, bytes as hex. */
function cellJson(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer') return `0x${Buffer.from((value as { data: number[] }).data).toString('hex')}`;
  return value;
}

/**
 * The query checked, then run through the chosen source's reader. Refusals throw before any connection is
 * made: a query that is not one read, no reader or the extract's own login, a source that cannot run.
 */
async function runQuery(io: Io, config: Config, text: string, sourceName: string | undefined, limit: number | undefined): Promise<QueryResult> {
  const checked = checkQuery(text);
  if (!checked.ok) throw new Error(checked.reason);
  const source = pickSource(config, sourceName);
  const reader = resolveReader(source, io.env ?? process.env);
  const load = io.load ?? ((s: SourceConfig) => loadSource(s, importer(io.cwd)));
  const { run } = await load(source);
  if (run === undefined) throw missing(`Source ${source.name} (${source.type}) cannot run queries: update ${source.module ?? `dbtour-source-${source.type}`} to the version of dbtour you have, then run it again`);
  try {
    return await run({ ...source, connection: reader }, checked.sql, { limit: clampLimit(limit), timeoutMs: defaultTimeoutMs });
  } catch (error) {
    throw new Error(`${source.name} (${source.type}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** The source named, or the only one with a reader; several want a name, and none says what to add. */
function pickSource(config: Config, name: string | undefined): SourceConfig {
  if (name !== undefined) {
    const named = config.sources.find((s) => s.name === name);
    if (!named) throw new Error(`There is no source named ${name}: ${config.sources.map((s) => s.name).join(', ')}`);
    return named;
  }
  const readers = config.sources.filter((s) => s.reader !== undefined);
  if (readers.length === 1) return readers[0];
  if (readers.length > 1) throw new Error(`Several sources have a reader: say which with ${readers.map((s) => `--source ${s.name}`).join(' or ')}`);
  return config.sources[0];
}
