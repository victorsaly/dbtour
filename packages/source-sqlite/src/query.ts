// One query, run in a process of its own: node:sqlite answers synchronously, so a query run in dbtour's own
// process would hold up everything else dbtour serve and dbtour mcp do until it ended. A worker thread cannot
// be stopped inside one long SQLite step either; a process can, so run() kills this one at the timeout.
import { RowCollector, type QueryResult } from 'dbtour';
import { DatabaseSync } from './sqlite.ts';

export interface Job {
  file: string;
  sql: string;
  limit: number;
  budget: number;
}

export type Answer = { result: QueryResult } | { error: string };

export function answer(job: Job): Answer {
  try {
    // Opened read-only, and query_only on top: SQLite refuses every write, whatever the statement.
    const db = new DatabaseSync(job.file, { readOnly: true });
    try {
      db.exec('PRAGMA query_only = 1');
      const statement = db.prepare(job.sql);
      statement.setReturnArrays(true);
      const rows = new RowCollector(job.limit, job.budget);
      rows.start(statement.columns().map((c) => ({ name: c.name })));
      for (const row of statement.iterate()) if (!rows.add(row as unknown as unknown[])) break;
      return { result: rows.result() };
    } finally {
      db.close();
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Started by run(): the job comes from the parent, the answer goes back, and the process ends.
if (process.send) {
  process.once('message', (job: Job) => {
    process.send!(answer(job), () => process.disconnect());
  });
}
