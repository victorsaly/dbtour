// dbtour.yaml: where the model goes, where it comes from, where the notes are.
import { parse } from 'yaml';

export interface SourceConfig {
  type: string;
  name: string;
  /** `${NAME}`: the environment variable holding the connection string. Never the string itself. */
  connection?: string;
  /** A module to import instead of dbtour-source-<type>. */
  module?: string;
  [option: string]: unknown;
}

export interface Config {
  out: string;
  notes: string;
  sources: SourceConfig[];
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
  };
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
# Descriptions, relations and groups the database cannot say. Optional.
notes: dbtour.notes.yaml
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
