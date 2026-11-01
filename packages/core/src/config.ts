// dbtour.yaml: where the model goes, where it comes from, where the notes are.
import { parse } from 'yaml';

export interface SourceConfig {
  type: string;
  name: string;
  /** `${NAME}`: the environment variable holding the connection string. Never the string itself. */
  connection?: string;
  /**
   * `${NAME}`: the variable holding the connection string queries run with, for a login of its own with
   * db_datareader alone. Never the extract's connection.
   */
  reader?: string;
  /** A module to import instead of dbtour-source-<type>. */
  module?: string;
  [option: string]: unknown;
}

export interface AddonConfig {
  type: string;
  /** A module to import instead of dbtour-addon-<type>. */
  module?: string;
  [option: string]: unknown;
}

export interface Config {
  out: string;
  notes: string;
  sources: SourceConfig[];
  addons: AddonConfig[];
}

export const configFile = 'dbtour.yaml';
export const modelFile = 'schema.json';

export function parseConfig(text: string): Config {
  const raw: unknown = parse(text) ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${configFile} must be a map with out, notes and sources`);
  const doc = raw as Record<string, unknown>;
  if (!Array.isArray(doc.sources) || doc.sources.length === 0) throw new Error(`${configFile} needs a sources list with at least one source`);
  const sources = doc.sources.map((value, i): SourceConfig => {
    if (typeof value !== 'object' || value === null) throw new Error(`sources[${i}] must be a map with type and name`);
    const entry = value as Record<string, unknown>;
    if (typeof entry.type !== 'string' || entry.type === '') throw new Error(`sources[${i}].type is required: mssql, for instance`);
    if (typeof entry.name !== 'string' || entry.name === '') throw new Error(`sources[${i}].name is required: the name the docs call this database`);
    return { ...entry, type: entry.type, name: entry.name };
  });
  return {
    out: typeof doc.out === 'string' ? doc.out : 'docs/dbtour',
    notes: typeof doc.notes === 'string' ? doc.notes : 'dbtour.notes.yaml',
    sources,
    addons: parseAddons(doc.addons),
  };
}

/** `addons: [explorer]` or `addons: [{ type: explorer, module: ./page.ts }]`; none when absent. */
function parseAddons(value: unknown): AddonConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('addons must be a list of add-on names, like [explorer]');
  return value.map((entry, i): AddonConfig => {
    if (typeof entry === 'string' && entry !== '') return { type: entry };
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`addons[${i}] must be a name or a map with type`);
    const map = entry as Record<string, unknown>;
    if (typeof map.type !== 'string' || map.type === '') throw new Error(`addons[${i}].type is required: explorer, for instance`);
    return { ...map, type: map.type };
  });
}

export function defaultConfigText(type: string): string {
  const variable = `DBTOUR_${type.toUpperCase()}`;
  return `# dbtour: see https://github.com/victorsaly/dbtour
out: docs/dbtour
sources:
  - type: ${type}
    name: ${type === 'mssql' ? 'MyDatabase' : 'my-database'}
    # The name of the environment variable holding the connection string. Never the string itself.
    connection: \${${variable}}
    # Optional: a read-only login of its own (db_datareader), for dbtour sql and the MCP query tool.
    # reader: \${${variable}_READER}
# Descriptions, relations and groups the database cannot say. Optional.
notes: dbtour.notes.yaml
# What else render writes. explorer is the page: npm install --save-dev dbtour-addon-explorer
addons:
  - explorer
`;
}

const variablePattern = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function resolveConnection(value: string | undefined, env: Record<string, string | undefined>): string | undefined {
  if (value === undefined) return undefined;
  const match = variablePattern.exec(value);
  if (!match) throw new Error(`connection must name an environment variable, like \${DBTOUR_MSSQL}: never write the connection string into ${configFile}`);
  const resolved = env[match[1]];
  if (resolved === undefined || resolved === '') {
    // Exit 2: what is missing, not what failed.
    throw Object.assign(new Error(`Set ${match[1]} to the connection string, then run it again`), { exitCode: 2 });
  }
  return resolved;
}

/**
 * The connection queries run with: the source's reader, a login of its own. Refused when it is missing (exit
 * 2, with what to add), when it names the same variable as the extract's connection, or when the two
 * variables hold the same string, since then a query would run with a login that may write.
 */
export function resolveReader(source: SourceConfig, env: Record<string, string | undefined>): string {
  const example = `\${DBTOUR_${source.type.toUpperCase()}_READER}`;
  if (typeof source.reader !== 'string' || source.reader === '') {
    throw Object.assign(
      new Error(`Source ${source.name} has no reader, the login dbtour runs queries with: add "reader: ${example}" to it in ${configFile}, naming a login with db_datareader alone, and set that variable`),
      { exitCode: 2 },
    );
  }
  const readerVariable = variablePattern.exec(source.reader)?.[1];
  const connectionVariable = typeof source.connection === 'string' ? variablePattern.exec(source.connection)?.[1] : undefined;
  if (readerVariable !== undefined && readerVariable === connectionVariable) {
    throw new Error(`reader names the same variable as connection (${readerVariable}): a reader is a login of its own, with db_datareader alone, so a query can never write`);
  }
  const reader = resolveConnection(source.reader, env)!;
  const connection = connectionVariable === undefined ? undefined : env[connectionVariable];
  if (connection !== undefined && connection === reader) {
    throw new Error(`reader resolves to the same connection string as connection: give ${readerVariable} a login of its own, with db_datareader alone`);
  }
  return reader;
}
