// Sources and add-ons are packages named after their type: `type: mssql` loads dbtour-source-mssql, the
// add-on `explorer` loads dbtour-addon-explorer. A `module` in the config loads that instead, for one kept
// in the project.
import type { AddonConfig, SourceConfig } from './config.ts';
import type { Api, Database, Model } from './model.ts';

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
