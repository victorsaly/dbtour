// The databases set up on this machine, for `dbtour serve`'s home and the commands that name one with
// --database: a settings file in ~/.dbtour (DBTOUR_HOME elsewhere) that holds no secret, and a folder per
// database for its model and its page. A password lives in the system's keychain (dbtour-keychain), under
// an account named for the database and the login's role, and is read only when a connection is made. A
// dbtour.yaml project keeps working as it does; this is for a person at their own machine and the agent they
// work with. Pure but for the file it reads and writes, so it is tested in Node.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where passwords are kept: the system's keychain in use, a map in tests. Nothing in it is ever printed. */
export interface SecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  /** Whether there was one to remove. */
  remove(account: string): Promise<boolean>;
}

/** How dbtour signs in to read the catalogue: the person's own az (Entra) sign-in, or a login and password. */
export type SignIn = 'az' | 'login';

export interface WorkspaceDatabase {
  /** What dbtour calls it: the folder's name, the page's title, what --database names. */
  name: string;
  /** The source: mssql loads dbtour-source-mssql. */
  type: string;
  server: string;
  /** The database's own name on the server. */
  database: string;
  signIn: SignIn;
  /** The login, when signIn is login; its password is in the keychain. */
  user?: string;
  /** The read-only login queries run as; its password is in the keychain. */
  reader?: string;
  /** When its catalogue was last read, ISO. */
  readAt?: string;
}

export interface Workspace {
  databases: WorkspaceDatabase[];
}

export const workspaceFile = 'databases.json';

/** ~/.dbtour, or DBTOUR_HOME: a test's folder, or a team's shared settings without secrets. */
export function workspaceHome(env: Record<string, string | undefined>, home: string): string {
  return env.DBTOUR_HOME || join(home, '.dbtour');
}

/** A database's folder, relative to the home: its schema.json, notes and page. */
export function folderOf(name: string): string {
  return join('databases', name);
}

/** The keychain account for a database's login or reader: "Shop · reader". */
export function secretAccount(name: string, role: 'login' | 'reader'): string {
  return `${name} · ${role}`;
}

/** A name dbtour can use as a folder, in a URL and on the command line without quoting. */
export function nameProblem(name: string): string | undefined {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    return `"${name}" cannot name a database here: use letters, digits, - and _, starting with a letter, at most 64 characters`;
  }
  return undefined;
}

/**
 * A server, database or login name that cannot break out of the connection string it goes into, nor be a
 * second setting hidden in the first: no ; = quotes, braces or line breaks.
 */
export function valueProblem(what: string, value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return `Give the ${what}`;
  if (value.length > 256 || /[;="'{}\r\n]/.test(value)) return `The ${what} "${value}" has a character dbtour does not accept there (; = quotes braces or a line break)`;
  return undefined;
}

export function readWorkspace(home: string): Workspace {
  const path = join(home, workspaceFile);
  if (!existsSync(path)) return { databases: [] };
  return parseWorkspace(readFileSync(path, 'utf8'), path);
}

export function parseWorkspace(text: string, path = workspaceFile): Workspace {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not JSON: fix it, or move it aside and add the databases again`);
  }
  const databases = (value as { databases?: unknown } | null)?.databases;
  if (!Array.isArray(databases)) throw new Error(`${path} has no "databases" list: fix it, or move it aside and add the databases again`);
  for (const d of databases as WorkspaceDatabase[]) {
    const problem =
      (typeof d?.name === 'string' ? nameProblem(d.name) : 'a database without a name') ??
      (d.signIn === 'az' || d.signIn === 'login' ? undefined : `${d.name}'s signIn is not az or login`) ??
      valueProblem('server', d.server) ??
      valueProblem('database', d.database) ??
      (d.signIn === 'login' ? valueProblem('login', d.user) : undefined) ??
      (d.reader !== undefined ? valueProblem('reader', d.reader) : undefined);
    if (problem) throw new Error(`${path}: ${problem}`);
  }
  return { databases: databases as WorkspaceDatabase[] };
}

export function writeWorkspace(home: string, workspace: Workspace): void {
  mkdirSync(home, { recursive: true });
  // Written beside it, then put in its place, so a dbtour reading it at that moment reads the old or the new.
  const file = join(home, workspaceFile);
  writeFileSync(`${file}.next`, JSON.stringify(workspace, null, 2) + '\n', { mode: 0o600 });
  renameSync(`${file}.next`, file);
}

/**
 * How long a change waits for another dbtour's. A change takes a millisecond, made with nothing awaited between
 * reading the settings and writing them; a lock held for two seconds was left by a dbtour that stopped mid-change.
 */
const lockWaitMs = 2000;

/**
 * Changes the settings as they are now: read, changed and written under a lock that every dbtour takes, so a
 * database added or a reader saved by another command, or another step of the page, while this one waited on a
 * database is kept. `change` may throw to refuse, and nothing is written.
 */
export function updateWorkspace(home: string, change: (workspace: Workspace) => Workspace, waitMs = lockWaitMs): Workspace {
  mkdirSync(home, { recursive: true });
  const lock = join(home, `${workspaceFile}.lock`);
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
      if (Date.now() > until) throw new Error(`Another dbtour is changing the settings, or one stopped while it did and left ${lock}: if no other dbtour is running, delete it, then run it again`, { cause: error });
      // A short sleep without a promise: the change must stay one synchronous step.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    const next = change(readWorkspace(home));
    writeWorkspace(home, next);
    return next;
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * The database a command means: the one named, or the only one. With several, it is never guessed, so a query
 * or a change cannot land in the wrong database: the command must name it.
 */
export function pickDatabase(workspace: Workspace, name: string | undefined): WorkspaceDatabase {
  const all = workspace.databases;
  if (all.length === 0) throw Object.assign(new Error('No database is set up yet: run dbtour add <name> --server <server> --database <database>, or open dbtour serve and add one'), { exitCode: 2 });
  if (name !== undefined) {
    const found = all.find((d) => d.name === name);
    if (!found) throw Object.assign(new Error(`There is no database named ${name}: ${all.map((d) => d.name).join(', ')}`), { exitCode: 2 });
    return found;
  }
  if (all.length === 1) return all[0];
  throw new Error(`Several databases are set up: say which with ${all.map((d) => `--database ${d.name}`).join(' or ')}`);
}

/** What a source turns into its connection string: where, and how dbtour signs in. */
export interface Target {
  server: string;
  database: string;
  signIn: SignIn;
  user?: string;
  password?: string;
}

/** The login dbtour creates to run queries, with db_datareader alone. */
export const readerLogin = 'dbtour_reader';

/**
 * A password for a login dbtour creates, never shown: 48 random hex digits after a prefix that meets SQL
 * Server's complexity rule (upper, lower, digit and symbol), so the server never refuses it.
 */
export function newPassword(): string {
  return `Aa1-${randomBytes(24).toString('hex')}`;
}
