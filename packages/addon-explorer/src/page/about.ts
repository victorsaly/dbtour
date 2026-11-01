// What the catalogue says about a table beyond its columns and keys, in plain sentences for the entry's About
// block, and a column's protection in words for the columns table. The terms are core's own (features()),
// so the page and the Markdown name each thing the same way.
import { features } from 'dbtour/markdown';
import type { Column, Table } from 'dbtour/model';

export interface Term {
  term: string;
  sentence: string;
  /** A table the sentence names, for a link. */
  ref?: string;
}

export interface About {
  terms: Term[];
  /** Created, and altered when that was another day; empty when the source did not say. */
  dates: string;
  properties: [string, string][];
  /** Nothing to say: the block is not drawn. */
  empty: boolean;
}

/** a, a and b, a, b and c. */
function and(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sentence(table: Table, name: string): string {
  switch (name) {
    case 'System-versioned':
      return `Every change is kept in ${table.temporal!.history}; each row is valid from ${table.temporal!.start} to ${table.temporal!.end}.`;
    case 'History':
      return `Keeps the past versions of the rows of ${table.historyOf}.`;
    case 'Memory-optimised':
      return table.memoryOptimised === 'schema only'
        ? 'Held in memory; the schema survives a restart, the rows do not.'
        : 'Held in memory, and both the schema and the rows survive a restart.';
    case 'Ledger':
      return table.ledger === 'append-only'
        ? 'Only takes inserts: no row can be updated or deleted, and each is verifiable.'
        : table.ledger === 'history'
          ? 'The history of a ledger table.'
          : 'Every change is recorded so it can be verified against tampering.';
    case 'Partitioned': {
      const p = table.partitioning!;
      return `Split on ${p.column} into ${p.partitions} partitions, by ${p.scheme} (function ${p.function}).`;
    }
    case 'Compressed':
      return `${table.compression!.charAt(0).toUpperCase()}${table.compression!.slice(1)} compression.`;
    case 'Change tracking':
      return 'The database records which rows changed, for keeping copies in step.';
    case 'Change data capture':
      return 'The database copies each change into a change table.';
    case 'Triggers': {
      const triggers = table.triggers!;
      if (triggers.length > 1) return `${triggers.length} triggers: see Triggers below.`;
      const [t] = triggers;
      return `${t.name} runs ${t.timing} ${and(t.events)}${t.enabled ? '' : ', and is disabled'}: see Triggers below.`;
    }
    default: {
      // Row-level security: what each policy does, filtering reads or blocking writes.
      const policies = [...new Set(table.security!.map((s) => s.policy))];
      const does = policies.map((policy) => {
        const kinds = new Set(table.security!.filter((s) => s.policy === policy).map((s) => s.kind));
        const verbs = [kinds.has('filter') ? 'filters the rows a login sees' : '', kinds.has('block') ? 'blocks writes that break its predicate' : ''];
        return `${policy} ${and(verbs.filter(Boolean))}`;
      });
      return `${and(does)}: see Row-level security below.`;
    }
  }
}

export function aboutOf(table: Table): About {
  const terms = features(table)
    .filter((f) => f.name !== 'Created')
    .map((f) => ({ term: f.name, sentence: sentence(table, f.name), ...(f.ref ? { ref: f.ref } : {}) }));
  const created = table.created?.slice(0, 10);
  const altered = table.altered?.slice(0, 10);
  const dates = created ? `Created ${created}${altered && altered !== created ? ` · altered ${altered}` : ''}` : '';
  const properties = Object.entries(table.properties ?? {});
  return { terms, dates, properties, empty: terms.length === 0 && dates === '' && properties.length === 0 };
}

/** SQL Server's sensitivity ranks, least to most; the page grades each one's dot from grey to red. */
export const ranks = ['low', 'medium', 'high', 'critical'] as const;
export type Rank = (typeof ranks)[number];

export interface ProtectionTag {
  text: string;
  /** A label's rank, when it is one the page knows; its words are in the text either way. */
  rank?: Rank;
}

/** A column's protection as tags in words: its sensitivity label, its mask, how it is encrypted. */
export function protection(column: Column): ProtectionTag[] {
  const tags: ProtectionTag[] = [];
  const s = column.sensitivity;
  if (s && (s.label || s.informationType)) {
    const tag: ProtectionTag = { text: [s.label, s.informationType, s.rank && `rank ${s.rank}`].filter(Boolean).join(' · ') };
    const rank = ranks.find((r) => r === s.rank?.toLowerCase());
    if (rank) tag.rank = rank;
    tags.push(tag);
  }
  if (column.masked) tags.push({ text: `Masked ${column.masked}` });
  if (column.encrypted) tags.push({ text: `Encrypted, ${column.encrypted.type}` });
  return tags;
}

/** Whether any column has protection, so the table needs the column at all. */
export function anyProtected(table: Table): boolean {
  return table.columns.some((c) => protection(c).length > 0);
}
