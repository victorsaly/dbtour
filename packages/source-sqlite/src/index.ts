// The SQLite source. A database is a file, named in dbtour.yaml by `file`, a path from the folder dbtour.yaml
// is in: a path is no secret, so it is written there, not in an environment variable. There are no logins:
// the file is opened read-only to read its catalogue and to run each query, so its reader is `read-only`.
// Node ships SQLite (node:sqlite), so there is no driver to install.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { maxResultBytes, type Database, type QueryResult, type RunOptions, type SourceConfig } from 'dbtour';
import { readCatalogue } from './catalogue.ts';
import { DatabaseSync } from './sqlite.ts';
import type { Answer, Job } from './query.ts';

export { readCatalogue, statsFileLimit } from './catalogue.ts';
export { parseIndex, parseTable, parseTrigger } from './parse.ts';

/** It opens the file read-only for every query, so a write is refused by SQLite, not by a login's rights. */
export const readOnly = true;

/** The database's file: `file` from the folder dbtour.yaml is in, checked to be there. */
export function fileOf(config: SourceConfig): string {
  if (typeof config.file !== 'string' || config.file === '') {
    throw new Error(`Source ${config.name} has no file: add "file: shop.db" to it in dbtour.yaml, the database's path from the folder dbtour.yaml is in`);
  }
  const file = resolve(config.root ?? process.cwd(), config.file);
  if (!existsSync(file)) throw new Error(`There is no database at ${file}: check file in dbtour.yaml, which is read from the folder dbtour.yaml is in`);
  return file;
}

export async function extract(config: SourceConfig): Promise<Database> {
  const file = fileOf(config);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    try {
      db.prepare('SELECT count(*) FROM sqlite_schema').get();
    } catch (error) {
      throw new Error(`${file} is not a SQLite database SQLite can read (${error instanceof Error ? error.message : String(error)}): check file in dbtour.yaml`, { cause: error });
    }
    return readCatalogue(db, { name: config.name, fileBytes: statSync(file).size });
  } finally {
    db.close();
  }
}

/**
 * The rows with each BLOB a Buffer again: the process sends one as a Uint8Array, which dbtour's answers would
 * write as a list of numbers, and a Buffer as hex.
 */
function withBuffers(result: QueryResult): QueryResult {
  return { ...result, rows: result.rows.map((row) => row.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v))) };
}

// The query's process runs the .ts beside this file in the repository, and the .js the build makes of it in the package.
const queryFile = new URL(import.meta.url.endsWith('.ts') ? './query.ts' : './query.js', import.meta.url);

/**
 * Runs one query dbtour has checked, in a process of its own that opens the file read-only. Its rows stop at
 * the limit or the byte budget, whichever comes first. At the timeout the process is killed, and the query
 * with it, however long the step SQLite is in.
 */
export async function run(config: SourceConfig, sql: string, options: RunOptions): Promise<QueryResult> {
  const job: Job = { file: fileOf(config), sql, limit: options.limit, budget: maxResultBytes };
  // Advanced serialisation, so a BLOB comes back as bytes, not as JSON's idea of them.
  const child = fork(queryFile, { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<QueryResult>((done, fail) => {
      timer = setTimeout(() => {
        const seconds = options.timeoutMs / 1000;
        fail(new Error(`The query ran past ${seconds} ${seconds === 1 ? 'second' : 'seconds'} and was cancelled: narrow it with a filter on an indexed column, or LIMIT`));
      }, options.timeoutMs);
      child.once('message', (message: Answer) => ('error' in message ? fail(new Error(message.error)) : done(withBuffers(message.result))));
      child.once('error', fail);
      child.once('exit', (code, signal) => fail(new Error(`The query's process stopped (${signal ?? `exit ${code}`}) before it answered: run it again`)));
      child.send(job);
    });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
