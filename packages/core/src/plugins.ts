// Sources are packages named after their type: `type: mssql` loads dbtour-source-mssql. A `module` in the
// config loads that instead, for a source kept in the project.
import type { SourceConfig } from './config.ts';
import type { Api, Database } from './model.ts';

export type Extract = (config: SourceConfig) => Promise<Database | Api>;

export interface Source {
  extract: Extract;
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
  return { extract: extract as Extract };
}
