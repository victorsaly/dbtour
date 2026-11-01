// The command. Reads dbtour.yaml in the working directory, writes under its `out`. Exit 1 for what was
// asked and failed, 2 for what is missing, 0 otherwise.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { configFile, defaultConfigText, modelFile, parseConfig, resolveConnection, type AddonConfig, type Config, type SourceConfig } from './config.ts';
import { emptyModel, validate, type Api, type Database, type Model } from './model.ts';
import { applyNotes, parseNotes } from './notes.ts';
import { answerLine } from './mcp.ts';
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

Set the connection string in the environment variable ${configFile} names, never in the file.`;

export async function main(argv: string[], io: Io = { cwd: process.cwd(), log: console.log, error: console.error }): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h' }, source: { type: 'string' } }, allowPositionals: true, strict: false });
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

/** <out>/schema.json with the notes merged in, as render and mcp read it. */
function readModel(io: Io, config: Config): Model {
  const modelPath = join(io.cwd, config.out, modelFile);
  if (!existsSync(modelPath)) throw missing(`No ${join(config.out, modelFile)} yet. Run dbtour extract to write it.`);
  const checked = validate(JSON.parse(readFileSync(modelPath, 'utf8')));
  if (!checked.ok) throw new Error(`${join(config.out, modelFile)} is not a model:\n  ${checked.errors.join('\n  ')}`);
  const notesPath = join(io.cwd, config.notes);
  if (!existsSync(notesPath)) return checked.model;
  const applied = applyNotes(checked.model, parseNotes(readFileSync(notesPath, 'utf8')));
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
  for await (const line of createInterface({ input: io.stdin ?? process.stdin, crlfDelay: Infinity })) {
    const reply = answerLine(line, { model: current, version });
    if (reply !== undefined) output.write(reply + '\n');
  }
  return 0;
}
