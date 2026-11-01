// The page opened through dbtour serve: what the server put in it (a token, and which sources have a reader),
// which source the editor's queries run through, and a result cell as text. Pure, so it is tested in Node;
// the fetch itself is the editor's.
import { driverName, formatBytes } from 'dbtour/markdown';
import { checkQuery } from 'dbtour/sql';

/** A database set up on this machine, as dbtour serve lists it on its home: no secret. */
export interface ServedDatabase {
  name: string;
  driver: string;
  server: string;
  database: string;
  reader: boolean;
  read: boolean;
  tables?: number;
  bytes?: number;
  readAt?: string;
}

export interface Served {
  token: string;
  sources: { name: string; reader: boolean }[];
  /** Served from the home of several databases: all of them, and the one this page is. */
  databases?: ServedDatabase[];
  current?: string;
}

/** What dbtour serve wrote into the page's meta tag; nothing when opened from a file or a deployed site. */
export function parseServed(content: string | null | undefined): Served | undefined {
  if (!content) return undefined;
  try {
    const value = JSON.parse(content) as Partial<Served>;
    if (typeof value.token !== 'string' || value.token === '' || !Array.isArray(value.sources)) return undefined;
    const served: Served = { token: value.token, sources: value.sources.filter((s) => typeof s?.name === 'string').map((s) => ({ name: s.name, reader: s.reader === true })) };
    if (Array.isArray(value.databases) && value.databases.every((d) => typeof d?.name === 'string' && typeof d?.server === 'string')) served.databases = value.databases;
    if (typeof value.current === 'string') served.current = value.current;
    return served;
  } catch {
    return undefined;
  }
}

export type Connection = { state: 'not served' } | { state: 'no reader'; source: string } | { state: 'ready'; source: string };

/**
 * Whether the editor can run its query, and through which source: the one named like the database, or, when
 * the docs call the database something else, the only source with a reader.
 */
export function connectionFor(served: Served | undefined, database: string | undefined): Connection {
  if (!served) return { state: 'not served' };
  const named = served.sources.find((s) => s.name === database);
  if (named) return named.reader ? { state: 'ready', source: named.name } : { state: 'no reader', source: named.name };
  const readers = served.sources.filter((s) => s.reader);
  if (readers.length === 1) return { state: 'ready', source: readers[0].name };
  return { state: 'no reader', source: database ?? served.sources[0]?.name ?? '' };
}

export type Tone = 'off' | 'idle' | 'ok' | 'failed' | 'live';

/**
 * The rail's line on a served page: green when a source has a reader, so the database can be reached and a
 * query run; grey when none has, and the page only read. Nothing when opened from a file.
 */
export function railStatus(served: Served | undefined): { tone: Tone; text: string } | undefined {
  if (!served) return undefined;
  return served.sources.some((s) => s.reader)
    ? { tone: 'live', text: 'Connected through dbtour serve' }
    : { tone: 'idle', text: 'Connected through dbtour serve · no reader' };
}

/** Where the caret starts: the end of the text, before a trailing line break, so on the line left to write on. */
export function caretAt(doc: string): number {
  return doc.endsWith('\n') ? doc.length - 1 : doc.length;
}

/**
 * The editor's status: the words, and its dot's tone. Connected, the dot says how the last run went: grey before
 * one and while it runs, green when the database answered, red when it did not. Not connected, it is hollow.
 */
export function statusOf(connection: Connection, ran: { result?: unknown; error?: string; running?: boolean; waiting?: string }): { tone: Tone; text: string } {
  if (connection.state === 'not served') return { tone: 'off', text: 'Not connected' };
  if (connection.state === 'no reader') return { tone: 'off', text: 'Connected · no reader' };
  const text = `Connected · ${connection.source}`;
  if (ran.running) return { tone: 'idle', text: `${text} · running` };
  if (ran.waiting !== undefined) return { tone: 'idle', text: `${text} · waiting` };
  if (ran.error !== undefined) return { tone: 'failed', text: `${text} · failed` };
  if (ran.result !== undefined) return { tone: 'ok', text: `${text} · ran` };
  return { tone: 'idle', text };
}

/**
 * How long typing must pause before auto-run sends the query: long enough that a word half typed is not sent
 * at every key, short enough that the rows follow the query as it is written.
 */
export const autoRunPauseMs = 800;

/**
 * Whether auto-run sends the query now: not when it is the one last sent, and not when the check dbtour serve
 * makes would refuse it (a string left open, a write), which is said instead. Run sends it whatever this says.
 */
export function autoRunPlan(sql: string, lastSent: string | undefined): { send: true } | { send: false; waiting?: string } {
  if (lastSent !== undefined && sql.trim() === lastSent.trim()) return { send: false };
  const checked = checkQuery(sql);
  return checked.ok ? { send: true } : { send: false, waiting: checked.reason };
}

/** Characters a cell shows before it is cut with …: a table of results stays a table. */
const cellShown = 300;

export function cellText(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) return { text: 'NULL', isNull: true };
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const line = raw.replace(/\r?\n/g, '↵');
  return { text: line.length > cellShown ? `${line.slice(0, cellShown)}…` : line, isNull: false };
}

/** A database's page on the home dbtour serve gives several. */
export function databaseHref(name: string): string {
  return `/db/${encodeURIComponent(name)}/`;
}

/**
 * The home's entries: a number, the name, a link when its page is written, its dot (green when it has a reader
 * and can run queries) and its facts; one not read yet says the command that reads it.
 */
export function databaseEntries(databases: ServedDatabase[]): { number: string; name: string; href: string | undefined; tone: Tone; status: string; facts: string[] }[] {
  return databases.map((d, i) => {
    const facts = [driverName(d.driver), `${d.database} on ${d.server}`];
    if (d.read && d.tables !== undefined) facts.push(`${d.tables} ${d.tables === 1 ? 'table' : 'tables'}`);
    if (d.read && d.bytes !== undefined) facts.push(formatBytes(d.bytes));
    if (d.read && d.readAt) facts.push(`read ${new Date(d.readAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
    if (!d.read) facts.push(`not read yet: dbtour read ${d.name}`);
    return { number: String(i + 1).padStart(3, '0'), name: d.name, href: d.read ? databaseHref(d.name) : undefined, tone: d.reader ? 'live' : 'idle', status: d.reader ? 'reader' : 'no reader', facts };
  });
}
