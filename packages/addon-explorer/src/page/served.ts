// The page opened through dbtour serve: what the server put in it (a token, and which sources have a reader),
// which source the editor's queries run through, and a result cell as text. Pure, so it is tested in Node;
// the fetch itself is the editor's.
import { checkQuery } from 'dbtour/sql';

export interface Served {
  token: string;
  sources: { name: string; reader: boolean }[];
}

/** What dbtour serve wrote into the page's meta tag; nothing when opened from a file or a deployed site. */
export function parseServed(content: string | null | undefined): Served | undefined {
  if (!content) return undefined;
  try {
    const value = JSON.parse(content) as Partial<Served>;
    if (typeof value.token !== 'string' || value.token === '' || !Array.isArray(value.sources)) return undefined;
    return { token: value.token, sources: value.sources.filter((s) => typeof s?.name === 'string').map((s) => ({ name: s.name, reader: s.reader === true })) };
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

export type Tone = 'off' | 'idle' | 'ok' | 'failed';

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
