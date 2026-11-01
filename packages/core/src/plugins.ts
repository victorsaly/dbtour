// Sources and add-ons are packages named after their type: `type: mssql` loads dbtour-source-mssql, the
// add-on `explorer` loads dbtour-addon-explorer. A `module` in the config loads that instead, for one kept
// in the project.
import type { AddonConfig, SourceConfig } from './config.ts';
import type { Api, Database, Model } from './model.ts';
import type { QueryResult, RunOptions } from './sql.ts';
import type { Target } from './workspace.ts';

export type Extract = (config: SourceConfig) => Promise<Database | Api>;

/**
 * Runs one query dbtour has already checked, with `config.connection` set to the source's reader: read-only,
 * inside a transaction the source always rolls back, at most `limit` rows, cancelled after `timeoutMs`.
 */
export type Run = (config: SourceConfig, sql: string, options: RunOptions) => Promise<QueryResult>;

/** What a source offers dbtour's setup (dbtour add, the wizard); absent from one that cannot be set up there. */
export interface Setup {
  /** The connection string for where the database is and how dbtour signs in. */
  connectionString: (target: Target) => string;
  /** Whether a user exists in the database, and its roles, through the admin's connection. */
  readerState: (admin: string, user: string) => Promise<{ exists: boolean; roles: string[] }>;
  /** The statements that make a user the reader, as shown before they run (password hidden). */
  readerStatements: (user: string, exists: boolean) => string[];
  /** Runs them with the admin's connection and a password dbtour made, then signs in as the reader. */
  createReader: (admin: string, user: string, password: string, readerConnection: string) => Promise<void>;
}

export interface Source {
  extract: Extract;
  /** Absent from a source that cannot run queries, or from one published before it could. */
  run?: Run;
  setup?: Setup;
}

export type Importer = (specifier: string) => Promise<unknown>;

export function sourceModuleName(source: SourceConfig): string {
  return source.module ?? `dbtour-source-${source.type}`;
}

export async function loadSource(source: SourceConfig, importer: Importer = (s) => import(s)): Promise<Source> {
  const name = sourceModuleName(source);
  let loaded: unknown;
  try {
    loaded = await importer(name);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Source "${source.type}" is not installed: npm install ${name} (${reason})`, { cause: error });
  }
  const extract = (loaded as { extract?: unknown } | null)?.extract;
  if (typeof extract !== 'function') throw new Error(`${name} does not export extract(config), so it is not a dbtour source`);
  const { run, connectionString, readerState, readerStatements, createReader } = loaded as Partial<Record<string, unknown>>;
  const found: Source = { extract: extract as Extract };
  if (typeof run === 'function') found.run = run as Run;
  if ([connectionString, readerState, readerStatements, createReader].every((f) => typeof f === 'function')) {
    found.setup = { connectionString, readerState, readerStatements, createReader } as Setup;
  }
  return found;
}

/** Files to write under `out`, keyed by path, like renderMarkdown returns them. */
export type Files = Record<string, string>;

/** An add-on changes the model, writes files beside the Markdown, or both. */
export interface Addon {
  enrich?: (model: Model) => Model | Promise<Model>;
  render?: (model: Model) => Files | Promise<Files>;
}

export function addonModuleName(addon: AddonConfig): string {
  return addon.module ?? `dbtour-addon-${addon.type}`;
}

export async function loadAddon(addon: AddonConfig, importer: Importer = (s) => import(s)): Promise<Addon> {
  const name = addonModuleName(addon);
  let loaded: unknown;
  try {
    loaded = await importer(name);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Add-on "${addon.type}" is not installed: npm install ${name} (${reason})`, { cause: error });
  }
  const { enrich, render } = (loaded as { enrich?: unknown; render?: unknown } | null) ?? {};
  if (typeof enrich !== 'function' && typeof render !== 'function') {
    throw new Error(`${name} exports neither enrich(model) or render(model), so it is not a dbtour add-on`);
  }
  const result: Addon = {};
  if (typeof enrich === 'function') result.enrich = enrich as Addon['enrich'];
  if (typeof render === 'function') result.render = render as Addon['render'];
  return result;
}
