// The command. Reads dbtour.yaml in the working directory, writes under its `out`. Exit 1 for what was
// asked and failed, 2 for what is missing, 0 otherwise.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
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
import { startServer, UnknownStep, type ServedDatabase } from './serve.ts';
import { randomBytes } from 'node:crypto';
import { loadAddon, loadSource, sourceModuleName, type Addon, type Importer, type Setup, type Source } from './plugins.ts';
import {
  folderOf,
  nameProblem,
  newPassword,
  pickDatabase,
  readerLogin,
  readWorkspace,
  secretAccount,
  valueProblem,
  workspaceHome,
  updateWorkspace,
  type SecretStore,
  type WorkspaceDatabase,
} from './workspace.ts';
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
  /** When serve stops; Ctrl+C unless a test hands in its own. */
  stop?: Promise<void>;
  /** Where mcp reads requests and writes answers; process.stdin and process.stdout unless a test hands in its own. */
  stdin?: Readable;
  stdout?: Writable;
  /** Where passwords are kept; the system's keychain (dbtour-keychain) unless a test hands in its own. */
  secrets?: SecretStore;
  /** Opens the page serve started in the person's browser; absent when no one is at a terminal to see it. */
  open?: (url: string) => void;
  /** Who az is signed in as, for the setup's sign-in step; the az command unless a test hands in its own. */
  az?: () => Promise<AzState>;
}

export type AzState = { state: 'signed in'; user: string } | { state: 'signed out' } | { state: 'missing' };

/**
 * dbtour with everything the home's setup uses, from nothing installed: the command, the SQL Server source,
 * the page and the keychain, fetched together so each finds the others.
 */
export const startCommand = 'npx -y -p dbtour -p dbtour-source-mssql -p dbtour-addon-explorer -p dbtour-keychain dbtour serve';

const help = `Usage: dbtour <command>

  init [--source mssql]   write ${configFile} here
  extract                 read every source in ${configFile}, write <out>/${modelFile}
  render                  read <out>/${modelFile} and the notes, write the Markdown and what the
                          add-ons in ${configFile} render (explorer: index.html) under <out>
  mcp [project]           answer an agent's questions about <out>/${modelFile} and the notes over MCP,
                          on stdin and stdout: claude mcp add dbtour -- npx dbtour mcp
  sql "<query>"           run one SELECT through a source's reader, a read-only login of its own,
                          rolled back, at most --limit rows (100); --source <name>, --json
  serve [--port 4321]     the rendered page on this machine, opened in the browser (--no-open to not);
                          its SQL editor runs queries through the readers, as sql does. With no
                          ${configFile} here, the home of your databases, which sets one up step by step

Databases set up on this machine (~/.dbtour), without a ${configFile}:
  add <name> --server <host> [--database <name on the server>] [--sign-in az|login --user <login>
      --password-stdin]   test and save a database; a password only ever on stdin, kept in the keychain
  reader <name> --create  show the statements that give it a read-only login; --confirm <name> runs them
  reader <name> --user <login> --password-stdin   use a read-only login you have
  read <name>             read its catalogue and write its page
  list                    the databases, how dbtour signs in and whether each has a reader; no secret
  remove <name>           forget it and its passwords; its folder stays
  sql, mcp and serve take --database <name>; with several databases set up, they must name one.

Set the connection string in the environment variable ${configFile} names, never in the file.
From nothing installed, the home and its setup in one line: ${startCommand}`;

export async function main(argv: string[], io: Io = { cwd: process.cwd(), log: console.log, error: console.error, ...(process.stdout.isTTY ? { open: openInBrowser } : {}) }): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h' },
      source: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      database: { type: 'string' },
      server: { type: 'string' },
      type: { type: 'string' },
      'sign-in': { type: 'string' },
      user: { type: 'string' },
      // Only so it can be refused: a password in argv is in shell history, ps and an agent's log.
      password: { type: 'string' },
      'password-stdin': { type: 'boolean' },
      create: { type: 'boolean' },
      confirm: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  const command = positionals[0];
  const text = (name: string) => (typeof values[name] === 'string' ? (values[name] as string) : undefined);
  if (values.help || command === undefined) {
    io.log(help);
    return 0;
  }
  try {
    switch (command) {
      case 'init':
        return init(io, typeof values.source === 'string' ? values.source : 'mssql');
      case 'extract':
        return await extract(here(io));
      case 'render':
        return await render(here(io));
      case 'mcp': {
        const at = positionals[1] === undefined ? io : { ...io, cwd: resolve(io.cwd, positionals[1]) };
        return await mcp(await projectFor(at, text('database'), { reader: true }));
      }
      case 'serve': {
        const port = typeof values.port === 'string' ? Number(values.port) : defaultPort;
        const at = values['no-open'] === true ? { ...io, open: undefined } : io;
        // No project here: the home of the databases set up on this machine, and the setup of the first.
        if (text('database') === undefined && !existsSync(join(io.cwd, configFile))) return await serveHome(at, port);
        return await serve(await projectFor(at, text('database'), { reader: true }), port);
      }
      case 'sql':
        return await sql(await projectFor(io, text('database'), { reader: true }), positionals[1], {
          source: text('source'),
          limit: typeof values.limit === 'string' ? Number(values.limit) : undefined,
          json: values.json === true,
        });
      case 'add':
        return await add(io, positionals[1], {
          server: text('server'),
          database: text('database'),
          type: text('type') ?? 'mssql',
          signIn: text('sign-in') ?? 'az',
          user: text('user'),
          password: text('password'),
          passwordStdin: values['password-stdin'] === true,
        });
      case 'reader':
        return await reader(io, positionals[1], { create: values.create === true, confirm: text('confirm'), user: text('user'), password: text('password'), passwordStdin: values['password-stdin'] === true });
      case 'read':
        return await read(io, positionals[1]);
      case 'list':
        return list(io);
      case 'remove':
        return await remove(io, positionals[1]);
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

/** A project: the config to follow and the io to follow it with, a dbtour.yaml's or a database's here. */
interface Project {
  io: Io;
  config: Config;
}

/** The dbtour.yaml project in the working directory. */
function here(io: Io): Project {
  return { io, config: readConfig(io) };
}

function readConfig(io: Io): Config {
  const path = join(io.cwd, configFile);
  if (!existsSync(path)) throw missing(`No ${configFile} here. Run dbtour init to write one.`);
  return parseConfig(readFileSync(path, 'utf8'));
}

/** `next` is what the last line tells to do: render, unless the caller renders straight after (read). */
async function extract({ io, config }: Project, next = ' Run dbtour render to write the docs.'): Promise<number> {
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
  io.log(`Wrote ${join(config.out, modelFile)}.${next}`);
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

async function render({ io, config }: Project): Promise<number> {
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
async function mcp({ io, config }: Project): Promise<number> {
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

/** dbtour serve's port unless --port says otherwise: one an editor's own dev servers seldom take. */
const defaultPort = 4321;

/**
 * The rendered folder on 127.0.0.1, with a door for its SQL editor: a query posted by the page runs as dbtour
 * sql runs it. A token made fresh each time is handed to the page and required on every query.
 */
async function serve({ io, config }: Project, port: number): Promise<number> {
  const root = join(io.cwd, config.out);
  if (!existsSync(join(root, 'index.html'))) throw missing(`No ${join(config.out, 'index.html')} to serve: add explorer to addons in ${configFile}, run dbtour render, then dbtour serve again`);
  const readers = config.sources.filter((s) => s.reader !== undefined);
  const token = randomBytes(24).toString('base64url');
  let server: { url: string; close: () => Promise<void> };
  try {
    server = await startServer({
      root,
      port,
      token,
      sources: config.sources.map((s) => ({ name: s.name, reader: s.reader !== undefined })),
      run: readers.length
        ? async (text, source, limit) => ({ ...(await runQuery(io, config, text, source, limit)), source: pickSource(config, source).name })
        : undefined,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'EADDRINUSE') throw new Error(`Port ${port} is taken: run dbtour serve --port ${port + 1}`, { cause: error });
    throw error;
  }
  io.log(`Serving ${config.out} at ${server.url}`);
  io.open?.(`${server.url}/`);
  io.log(readers.length ? `Queries run through ${readers.map((s) => `${s.name}'s reader`).join(', ')}. Ctrl+C to stop.` : `No source has a reader, so the page can be read but runs no query: add reader to a source in ${configFile}. Ctrl+C to stop.`);
  await (io.stop ?? new Promise<void>((done) => process.once('SIGINT', () => done())));
  await server.close();
  return 0;
}

async function sql({ io, config }: Project, text: string | undefined, options: { source?: string; limit?: number; json: boolean }): Promise<number> {
  if (text === undefined || text.trim() === '') {
    io.error('Give the query to run: dbtour sql "SELECT TOP (10) * FROM dbo.Orders"');
    return 1;
  }
  const result = await runQuery(io, config, text, options.source, options.limit);
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
    const named = config.sources.filter((s) => s.name === name);
    if (named.length === 0) throw new Error(`There is no source named ${name}: ${config.sources.map((s) => s.name).join(', ')}`);
    // Two of one name would leave which database the query runs in to the order of the file.
    if (named.length > 1) throw new Error(`Two sources are named ${name}: give each its own name in ${configFile}, then run it again`);
    return named[0];
  }
  const readers = config.sources.filter((s) => s.reader !== undefined);
  if (readers.length === 1) return readers[0];
  if (readers.length > 1) throw new Error(`Several sources have a reader: say which with ${readers.map((s) => `--source ${s.name}`).join(' or ')}`);
  return config.sources[0];
}

// Databases set up on this machine: ~/.dbtour's settings, a folder each, passwords in the keychain. Each
// command names its database, and with several set up it must; what changes a database shows itself first
// and waits for the name again; a password never comes from argv and never goes to the output.

/** Environment variables that carry a set-up database's connections into the code a dbtour.yaml uses. */
const catalogueVariable = 'DBTOUR_SETUP_CONNECTION';
const readerVariable = 'DBTOUR_SETUP_READER';

function homeOf(io: Io): string {
  return workspaceHome(io.env ?? process.env, homedir());
}

/** The keychain, loaded only when a password is wanted; a test's store otherwise. */
async function secretsOf(io: Io): Promise<SecretStore> {
  if (io.secrets) return io.secrets;
  try {
    return ((await import('dbtour-keychain' as string)) as { store: SecretStore }).store;
  } catch (error) {
    throw Object.assign(new Error('dbtour-keychain is not installed, and it keeps the passwords: npm install dbtour-keychain, then run it again', { cause: error }), { exitCode: 2 });
  }
}

/** The source of a set-up database, with what setup needs of it. */
async function setupOf(io: Io, entry: Pick<WorkspaceDatabase, 'type' | 'name'>): Promise<{ source: Source; setup: Setup }> {
  const config = { type: entry.type, name: entry.name };
  const source = await (io.load ?? ((s: SourceConfig) => loadSource(s, importer(io.cwd))))(config);
  if (!source.setup) throw missing(`${sourceModuleName(config)} cannot be set up from dbtour: update it to this version of dbtour, or use a ${configFile} project`);
  return { source, setup: source.setup };
}

/** How dbtour signs in to read the catalogue: az, or the login with its password from the keychain. */
async function catalogueConnection(io: Io, entry: WorkspaceDatabase, setup: Setup): Promise<string> {
  const where = { server: entry.server, database: entry.database };
  if (entry.signIn === 'az') return setup.connectionString({ ...where, signIn: 'az' });
  const password = await (await secretsOf(io)).get(secretAccount(entry.name, 'login'));
  if (password === undefined) throw missing(`The keychain has no password for ${entry.name}'s login ${entry.user}: run dbtour remove ${entry.name}, then dbtour add it again`);
  return setup.connectionString({ ...where, signIn: 'login', user: entry.user, password });
}

async function readerConnection(io: Io, entry: WorkspaceDatabase, setup: Setup): Promise<string> {
  const password = await (await secretsOf(io)).get(secretAccount(entry.name, 'reader'));
  if (password === undefined) throw missing(`The keychain has no password for ${entry.name}'s reader ${entry.reader}: run dbtour reader ${entry.name} --create again, or give yours with --user and --password-stdin`);
  return setup.connectionString({ server: entry.server, database: entry.database, signIn: 'login', user: entry.reader, password });
}

/**
 * The project a command runs: the dbtour.yaml here, unless --database names a set-up database or there is
 * none here. A set-up database becomes a config like any other, its folder the out, its connections carried in
 * the environment in memory only, read from the keychain now and only those the command needs.
 */
async function projectFor(io: Io, database: string | undefined, need: { catalogue?: boolean; reader?: boolean; setUpOnly?: boolean }): Promise<Project> {
  if (database === undefined && !need.setUpOnly && existsSync(join(io.cwd, configFile))) return here(io);
  const home = homeOf(io);
  const workspace = readWorkspace(home);
  if (database === undefined && !need.setUpOnly && workspace.databases.length === 0) {
    throw missing(`No ${configFile} here, and no database is set up on this machine: run dbtour init to write one, or dbtour add <name> --server <host> to set one up`);
  }
  const entry = pickDatabase(workspace, database);
  const env: Record<string, string | undefined> = { ...(io.env ?? process.env) };
  const source: SourceConfig = { type: entry.type, name: entry.name };
  if (need.catalogue || (need.reader && entry.reader)) {
    const { setup } = await setupOf(io, entry);
    if (need.catalogue) {
      env[catalogueVariable] = await catalogueConnection(io, entry, setup);
      source.connection = `\${${catalogueVariable}}`;
    }
    if (need.reader && entry.reader) {
      env[readerVariable] = await readerConnection(io, entry, setup);
      source.reader = `\${${readerVariable}}`;
    }
  }
  const out = folderOf(entry.name);
  return { io: { ...io, cwd: home, env }, config: { out, notes: join(out, 'dbtour.notes.yaml'), sources: [source], addons: [{ type: 'explorer' }] } };
}

/** All of stdin, less the line break a shell's echo or printf adds. */
async function readStdin(io: Io): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of io.stdin ?? process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** A password from stdin, or why there is none: never argv, and an agent without one asks the person. */
async function passwordFrom(io: Io, options: { password?: string; passwordStdin: boolean }, command: string): Promise<string> {
  if (options.password !== undefined) {
    throw new Error(`A password goes never on the command line, where shell history, ps and an agent's log keep it: pipe it in with --password-stdin, as in printf '%s' "$PASSWORD" | dbtour ${command} --password-stdin`);
  }
  if (!options.passwordStdin) {
    throw missing(`This login needs its password on stdin: printf '%s' "$PASSWORD" | dbtour ${command} --password-stdin. An agent without the password should ask the person to run it, or use --sign-in az`);
  }
  const password = await readStdin(io);
  if (password === '') throw missing('Nothing came in on stdin: pipe the password in, then run it again');
  return password;
}

interface AddOptions {
  server?: string;
  database?: string;
  type: string;
  signIn: string;
  user?: string;
  password?: string;
  passwordStdin: boolean;
}

async function add(io: Io, name: string | undefined, options: AddOptions): Promise<number> {
  if (name === undefined) throw missing('Name the database: dbtour add Shop --server shop.example.com');
  const command = `add ${name} --server ${options.server} --sign-in login --user ${options.user ?? '<login>'}`;
  const { entry } = await addDatabase(io, name, options, () => passwordFrom(io, options, command));
  io.log(`Added ${name}: ${entry.database} on ${entry.server}, signed in ${entry.signIn === 'az' ? 'with az' : `as ${entry.user}, its password in the keychain`}.`);
  io.log(`Next: dbtour read ${name} writes its page. To run queries from it, dbtour reader ${name} --create shows how it would give ${name} a read-only login.`);
  return 0;
}

/** Why a new database cannot be set up under these names, or nothing: checked before anything connects. */
function newDatabaseProblem(io: Io, name: string, server: string | undefined, database: string | undefined): string | undefined {
  const problem = nameProblem(name) ?? valueProblem('server', server) ?? valueProblem('database', database ?? name);
  if (problem) return problem;
  if (readWorkspace(homeOf(io)).databases.some((d) => d.name === name)) return `${name} is set up already: pick another name, or dbtour remove ${name} first`;
  return undefined;
}

/**
 * Tests a database and saves it, the password (a login's) from `password`, asked only once all else is
 * right. A database that will not answer is not saved, and its password not kept.
 */
async function addDatabase(io: Io, name: string, options: Omit<AddOptions, 'password' | 'passwordStdin'>, password: () => Promise<string>): Promise<{ entry: WorkspaceDatabase; exists: boolean }> {
  const problem = newDatabaseProblem(io, name, options.server, options.database);
  if (problem) throw new Error(`${problem}, then run it again`);
  if (options.signIn !== 'az' && options.signIn !== 'login') throw new Error(`--sign-in is az or login, not ${options.signIn}`);
  const home = homeOf(io);
  const entry: WorkspaceDatabase = { name, type: options.type, server: options.server!, database: options.database ?? name, signIn: options.signIn };
  if (entry.signIn === 'login') {
    const userProblem = valueProblem('login', options.user);
    if (userProblem) throw new Error(`${userProblem} with --user, then run it again`);
    entry.user = options.user;
  }
  const secret = entry.signIn === 'login' ? await password() : undefined;
  const { setup } = await setupOf(io, entry);
  const secrets = entry.signIn === 'login' ? await secretsOf(io) : undefined;
  if (secrets && secret !== undefined) await secrets.set(secretAccount(name, 'login'), secret);
  let state: { exists: boolean };
  try {
    state = await setup.readerState(await catalogueConnection(io, entry, setup), readerLogin);
  } catch (error) {
    if (secrets) await secrets.remove(secretAccount(name, 'login'));
    const az = entry.signIn === 'az' ? ' (with az, run az login in a terminal if it is signed out)' : '';
    throw new Error(`${name} did not answer: ${error instanceof Error ? error.message : String(error)} Check the server, the database and the sign-in${az}; nothing was saved`, { cause: error });
  }
  // Checked again as it is saved: another dbtour may have set up this name while the database was asked.
  updateWorkspace(home, (workspace) => {
    if (workspace.databases.some((d) => d.name === name)) throw new Error(`${name} was set up by another dbtour meanwhile: pick another name, or dbtour remove ${name} first`);
    return { databases: [...workspace.databases, entry] };
  });
  return { entry, exists: state.exists };
}

interface ReaderOptions {
  create: boolean;
  confirm?: string;
  user?: string;
  password?: string;
  passwordStdin: boolean;
}

async function reader(io: Io, name: string | undefined, options: ReaderOptions): Promise<number> {
  if (name === undefined) throw missing('Name the database: dbtour reader Shop --create');
  if (options.user !== undefined) {
    const problem = valueProblem('login', options.user);
    if (problem) throw new Error(problem);
    // The database is found before the password is read, so a wrong name does not take it from stdin.
    pickDatabase(readWorkspace(homeOf(io)), name);
    const password = await passwordFrom(io, options, `reader ${name} --user ${options.user}`);
    await useReader(io, name, options.user, password);
    io.log(`${options.user} signs in to ${name}, and is its reader: its password is in the keychain as "dbtour · ${secretAccount(name, 'reader')}". Make sure it has db_datareader alone.`);
    return 0;
  }
  if (!options.create) throw missing(`Say how: dbtour reader ${name} --create makes one, or --user <login> --password-stdin uses yours`);
  const plan = await planReader(io, name);
  // A change to the database: shown in full and done only when the database is named again.
  if (options.confirm !== name) {
    io.log(`This changes ${plan.changes}. It would run:\n`);
    for (const statement of plan.statements) io.log(`  ${statement}`);
    io.log(`\nThe password is made here, kept in the keychain as "${plan.account}", and never shown. To do it: dbtour reader ${name} --create --confirm ${name}`);
    return 3;
  }
  await createReader(io, plan);
  io.log(`${readerLogin} can read ${name} and nothing else (db_datareader), and signed in. Its password is in the keychain as "${plan.account}".`);
  return 0;
}

/** A read-only login the person has, signed in with once before it and its password are kept. */
async function useReader(io: Io, name: string, user: string, password: string): Promise<void> {
  const problem = valueProblem('login', user);
  if (problem) throw new Error(problem);
  const home = homeOf(io);
  const entry = pickDatabase(readWorkspace(home), name);
  const { source, setup } = await setupOf(io, entry);
  const connection = setup.connectionString({ server: entry.server, database: entry.database, signIn: 'login', user, password });
  if (!source.run) throw missing(`${sourceModuleName({ type: entry.type, name })} cannot run queries: update it to this version of dbtour`);
  // Signed in as it, it says what it can do: a login that works is not yet one that only reads.
  const rights = await setup.readerRights(connection);
  if (rights.length) throw new Error(`${user} can do more than read (${rights.join(', ')}): use a login with db_datareader alone, or --create to have dbtour make one`);
  await (await secretsOf(io)).set(secretAccount(name, 'reader'), password);
  updateWorkspace(home, (w) => ({ databases: w.databases.map((d) => (d.name === name ? { ...d, reader: user } : d)) }));
}

interface ReaderPlan {
  name: string;
  entry: WorkspaceDatabase;
  setup: Setup;
  admin: string;
  /** The database, its server and the sign-in that would change it, in words. */
  changes: string;
  statements: string[];
  /** The keychain's name for the password: "dbtour · <name> · reader". */
  account: string;
}

/**
 * What making dbtour_reader would do to the database, read through the admin's sign-in and changing nothing.
 * A dbtour_reader that has more than db_datareader is refused, as it could do more than read.
 */
async function planReader(io: Io, name: string): Promise<ReaderPlan> {
  const entry = pickDatabase(readWorkspace(homeOf(io)), name);
  const { setup } = await setupOf(io, entry);
  await secretsOf(io);
  const admin = await catalogueConnection(io, entry, setup);
  const state = await setup.readerState(admin, readerLogin);
  const more = state.roles.filter((r) => r !== 'db_datareader' && r !== 'public');
  if (more.length) throw new Error(`${readerLogin} already has ${more.join(', ')}, so it could do more than read: remove those roles from it, or use --user with a login of your own`);
  // A role is one way to write; a grant to the user itself, or a schema it owns, is another, and ALTER USER keeps both.
  if (state.grants.length) throw new Error(`${readerLogin} has ${state.grants.join(', ')}, so it could do more than read: revoke it, or use --user with a login of your own`);
  const changes = `${entry.database} on ${entry.server}, signed in ${entry.signIn === 'az' ? 'with az' : `as ${entry.user}`}`;
  return { name, entry, setup, admin, changes, statements: setup.readerStatements(readerLogin, state.exists), account: `dbtour · ${secretAccount(name, 'reader')}` };
}

/** Runs the plan: a password made here and seen by nobody, the reader signed in with, then both kept. */
async function createReader(io: Io, { name, entry, setup, admin }: ReaderPlan): Promise<void> {
  const password = newPassword();
  const readerConn = setup.connectionString({ server: entry.server, database: entry.database, signIn: 'login', user: readerLogin, password });
  await setup.createReader(admin, readerLogin, password, readerConn);
  await (await secretsOf(io)).set(secretAccount(name, 'reader'), password);
  updateWorkspace(homeOf(io), (w) => ({ databases: w.databases.map((d) => (d.name === name ? { ...d, reader: readerLogin } : d)) }));
}

async function read(io: Io, name: string | undefined): Promise<number> {
  const project = await projectFor(io, name, { catalogue: true, setUpOnly: true });
  const extracted = await extract(project, '');
  if (extracted !== 0) return extracted;
  const rendered = await render(project);
  const at = new Date().toISOString();
  updateWorkspace(homeOf(io), (w) => ({ databases: w.databases.map((d) => (d.name === project.config.sources[0].name ? { ...d, readAt: at } : d)) }));
  return rendered;
}

function list(io: Io): number {
  const { databases } = readWorkspace(homeOf(io));
  if (databases.length === 0) {
    io.log('No database is set up yet: dbtour add <name> --server <host>, or open dbtour serve and add one.');
    return 0;
  }
  const rows = databases.map((d) => [d.name, d.type, `${d.server}/${d.database}`, d.signIn === 'az' ? 'az' : `login ${d.user}`, d.reader ?? 'no reader', d.readAt ? `read ${d.readAt.slice(0, 10)}` : 'not read']);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) io.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
  return 0;
}

async function remove(io: Io, name: string | undefined): Promise<number> {
  if (name === undefined) throw missing('Name the database: dbtour remove Shop');
  const home = homeOf(io);
  const workspace = readWorkspace(home);
  const entry = pickDatabase(workspace, name);
  const secrets = await secretsOf(io);
  await secrets.remove(secretAccount(name, 'login'));
  await secrets.remove(secretAccount(name, 'reader'));
  updateWorkspace(home, (w) => ({ databases: w.databases.filter((d) => d.name !== name) }));
  io.log(`Removed ${name} and its passwords. Its folder, with any notes, stays at ${join(home, folderOf(name))}.`);
  if (entry.reader) io.log(`The reader is still in the database: to drop it, run DROP USER [${entry.reader.replace(/]/g, ']]')}]; in ${entry.database} on ${entry.server}.`);
  return 0;
}

/** What the home says of a database, from its settings and the model its last read wrote: never a secret. */
function servedDatabase(home: string, entry: WorkspaceDatabase): ServedDatabase {
  const folder = join(home, folderOf(entry.name));
  const served: ServedDatabase = { name: entry.name, driver: entry.type, server: entry.server, database: entry.database, reader: entry.reader !== undefined, read: entry.readAt !== undefined && existsSync(join(folder, 'index.html')) };
  if (entry.readAt) served.readAt = entry.readAt;
  try {
    const model = JSON.parse(readFileSync(join(folder, modelFile), 'utf8')) as Model;
    const tables = model.databases.flatMap((d) => d.schemas.flatMap((s) => s.tables));
    served.tables = tables.length;
    const sized = tables.filter((t) => t.stats);
    if (sized.length) served.bytes = sized.reduce((n, t) => n + t.stats!.dataBytes + t.stats!.indexBytes, 0);
  } catch {
    // Not read yet, or a model this version cannot read: the home says it is not read.
  }
  return served;
}

/**
 * Every database set up on this machine: the home at /, each one's page at /db/<name>/, and a query from a page
 * run through that database's reader alone, read from the keychain when it is asked.
 */
async function serveHome(io: Io, port: number): Promise<number> {
  const home = homeOf(io);
  const explorer = await (io.loadAddon ?? ((a: AddonConfig) => loadAddon(a, importer(io.cwd))))({ type: 'explorer' }).catch((error: unknown) => {
    throw missing(`The home is a page, and dbtour-addon-explorer draws it: start dbtour with every package it uses, ${startCommand} (${error instanceof Error ? error.message : String(error)})`);
  });
  if (!explorer.render) throw missing('The explorer add-on writes no page: update dbtour-addon-explorer, then run it again');
  // The home is the page with no model: the served databases are its content.
  const html = (await explorer.render({ ...emptyModel(), generatedAt: new Date().toISOString() }))['index.html'];
  const token = randomBytes(24).toString('base64url');
  let server: { url: string; close: () => Promise<void> };
  try {
    server = await startServer({
      root: join(home, 'databases'),
      port,
      token,
      sources: [],
      home: { html, databases: () => readWorkspace(home).databases.map((d) => servedDatabase(home, d)), setup: (step, input) => setupStep(io, step, input) },
      run: async (text, source, limit, database) => {
        const project = await projectFor(io, database, { reader: true, setUpOnly: true });
        return { ...(await runQuery(project.io, project.config, text, source, limit)), source: project.config.sources[0].name };
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'EADDRINUSE') throw new Error(`Port ${port} is taken: run dbtour serve --port ${port + 1}`, { cause: error });
    throw error;
  }
  const names = readWorkspace(home).databases.map((d) => d.name);
  io.log(`Serving ${names.length === 0 ? 'the setup' : names.length === 1 ? names[0] : `${names.length} databases (${names.join(', ')})`} at ${server.url}`);
  if (names.length === 0) io.log(`Nothing is set up yet: the page at ${server.url}/ walks you through it. Ctrl+C to stop.`);
  else io.log('Each page runs queries through its own database\'s reader, read from the keychain when asked. Add another from the home. Ctrl+C to stop.');
  io.open?.(`${server.url}/`);
  await (io.stop ?? new Promise<void>((done) => process.once('SIGINT', () => done())));
  await server.close();
  return 0;
}

/** The kinds of database the setup offers, each a source package that may or may not be installed. */
const setupKinds = [{ type: 'mssql', name: 'SQL Server' }];

/**
 * How long the setup waits for az to say who is signed in. It reads its own token cache and answers in a
 * second or two; past this it is stuck on a prompt or a proxy, and the page says signed out rather than hang.
 */
const azWaitMs = 15_000;

function azAccount(): Promise<AzState> {
  return new Promise((done) => {
    // On Windows az is a .cmd, which Node runs only through a shell.
    execFile('az', ['account', 'show', '--query', 'user.name', '-o', 'tsv'], { timeout: azWaitMs, shell: process.platform === 'win32' }, (error, stdout) => {
      if ((error as { code?: unknown } | null)?.code === 'ENOENT') return done({ state: 'missing' });
      if (error || stdout.trim() === '') return done({ state: 'signed out' });
      done({ state: 'signed in', user: stdout.trim() });
    });
  });
}

/** The person's browser, at the page serve started: the command each system opens an address with. */
function openInBrowser(url: string): void {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

/** A field the page sent, when it is text. */
function field(input: Record<string, unknown>, name: string): string | undefined {
  return typeof input[name] === 'string' ? (input[name] as string) : undefined;
}

/**
 * One step of the home's setup, as dbtour add, reader and read do it and under the same rules: names checked
 * before anything connects, a database saved only once it answers, a password only ever into the keychain,
 * and the database changed only when the page names it again. What it answers never holds a secret.
 */
async function setupStep(io: Io, step: string, input: Record<string, unknown>): Promise<unknown> {
  const name = field(input, 'name') ?? '';
  switch (step) {
    case 'state': {
      const kinds = [];
      for (const kind of setupKinds) {
        const installed = await setupOf(io, { type: kind.type, name: kind.name }).then(() => true, () => false);
        kinds.push({ ...kind, installed });
      }
      const keychain = await secretsOf(io).then(() => true, () => false);
      return { kinds, keychain, az: await (io.az ?? azAccount)(), names: readWorkspace(homeOf(io)).databases.map((d) => d.name) };
    }
    case 'check': {
      const problem = newDatabaseProblem(io, name, field(input, 'server'), field(input, 'database'));
      if (problem) throw new Error(problem);
      return { ok: true };
    }
    case 'add': {
      const signIn = field(input, 'signIn') ?? 'az';
      const password = field(input, 'password');
      const { entry, exists } = await addDatabase(io, name, { server: field(input, 'server'), database: field(input, 'database'), type: field(input, 'type') ?? 'mssql', signIn, user: field(input, 'user') }, async () => {
        if (!password) throw missing('Type the login\'s password, then test again');
        return password;
      });
      const log = [
        `It answered, signed in ${entry.signIn === 'az' ? 'with az' : `as ${entry.user}`}`,
        `${readerLogin} is ${exists ? 'in the database already' : 'not in the database yet'}`,
        `Saved ${name} in ${join(homeOf(io), 'databases.json')}`,
      ];
      if (entry.signIn === 'login') log.push(`Kept the login's password in the keychain as "dbtour · ${secretAccount(name, 'login')}"`);
      return { name: entry.name, signIn: entry.signIn, reader: { user: readerLogin, exists }, log };
    }
    case 'reader-plan': {
      const plan = await planReader(io, name);
      return { user: readerLogin, changes: plan.changes, statements: plan.statements, account: plan.account, log: ['Nothing has changed: the statements wait for your yes'] };
    }
    case 'reader-create': {
      const plan = await planReader(io, name);
      if (field(input, 'confirm') !== name) throw new Error(`This changes ${plan.changes}: confirm it by naming ${name}`);
      await createReader(io, plan);
      const log = [...plan.statements.map((s) => `Ran ${s}`), `Signed in as ${readerLogin}: it can read`, `Kept its password in the keychain as "${plan.account}"`];
      return { name, reader: readerLogin, log };
    }
    case 'reader-use': {
      const user = field(input, 'user');
      const password = field(input, 'password');
      if (!user || !password) throw missing('Type the reader\'s login and its password, then try again');
      await useReader(io, name, user, password);
      return { name, reader: user, log: [`Signed in as ${user}: it can read`, `Kept its password in the keychain as "dbtour · ${secretAccount(name, 'reader')}"`] };
    }
    case 'read': {
      // What the read says goes back to the page: what the login could not read, how many files it wrote.
      const lines: string[] = [];
      const said = { ...io, log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) };
      if ((await read(said, name)) !== 0) throw new Error(lines.join(' ') || `${name} could not be read`);
      const home = homeOf(io);
      const entry = pickDatabase(readWorkspace(home), name);
      return { name, tables: servedDatabase(home, entry).tables ?? 0, log: lines };
    }
    default:
      throw new UnknownStep(`There is no setup step ${step}: the steps are state, check, add, reader-plan, reader-create, reader-use and read`);
  }
}
