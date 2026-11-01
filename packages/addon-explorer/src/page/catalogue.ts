// The catalogue: every table has a number, in the order the model lists them, and every schema a colour
// block. Numbers and blocks always appear beside the name, never instead of it.
import { tableRef, type Model, type TableStats } from 'dbtour/model';

export interface Entry {
  /** Zero-padded, 001 upwards, three digits at least. */
  number: string;
  ref: string;
  schema: string;
  table: string;
  /** Rows and bytes, when the source read them; a view has none. */
  stats?: TableStats;
}

export interface Catalogue {
  entries: Entry[];
  byRef: Map<string, Entry>;
  /** Schema name to its colour, in the order the schemas are listed. */
  colours: Map<string, string>;
}

// The strip: red, yellow, blue, white, grey, then round again. On black every one reads as a block.
export const schemaColours = ['#e2001a', '#ffd500', '#0057b8', '#f5f5f5', '#8c8c8c'];

export function catalogue(model: Model): Catalogue {
  const entries: Entry[] = [];
  const colours = new Map<string, string>();
  for (const database of model.databases) {
    for (const schema of database.schemas) {
      if (!colours.has(schema.name)) colours.set(schema.name, schemaColours[colours.size % schemaColours.length]);
      for (const table of schema.tables) {
        const entry: Entry = { number: '', ref: tableRef(schema.name, table.name), schema: schema.name, table: table.name };
        if (table.stats) entry.stats = table.stats;
        entries.push(entry);
      }
    }
  }
  const width = Math.max(3, String(entries.length).length);
  entries.forEach((entry, i) => (entry.number = String(i + 1).padStart(width, '0')));
  return { entries, byRef: new Map(entries.map((e) => [e.ref, e])), colours };
}

/** The entries before and after one, in catalogue order; undefined at either end. */
export function neighboursOf(cat: Catalogue, ref: string): { previous?: Entry; next?: Entry } {
  const i = cat.entries.findIndex((e) => e.ref === ref);
  if (i === -1) return {};
  return { previous: cat.entries[i - 1], next: cat.entries[i + 1] };
}

/** Whether any table has stats: without them the index has nothing to order by and no weight to draw. */
export function sized(cat: Catalogue): boolean {
  return cat.entries.some((e) => e.stats);
}

export type Order = 'catalogue' | 'rows' | 'size';

export const orders: { id: Order; label: string }[] = [
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'rows', label: 'Rows' },
  { id: 'size', label: 'Size' },
];

/**
 * The entries in the order chosen, as a copy: catalogue order, or the largest first by rows or by bytes of
 * data and indexes together. A table without stats sorts after the rest; ties keep catalogue order. The
 * numbers stay what they are, so an entry is the same entry whichever way the index is read.
 */
export function ordered(cat: Catalogue, order: Order): Entry[] {
  if (order === 'catalogue') return [...cat.entries];
  const measure = (e: Entry): number => (!e.stats ? -1 : order === 'rows' ? e.stats.rows : e.stats.dataBytes + e.stats.indexBytes);
  return [...cat.entries].sort((a, b) => measure(b) - measure(a));
}

/** The order the reader chose last, kept in this browser. */
const orderKey = 'dbtour.indexOrder';

export function storedOrder(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Order {
  try {
    const value = storage?.getItem(orderKey);
    return orders.find((o) => o.id === value)?.id ?? 'catalogue';
  } catch {
    return 'catalogue';
  }
}

export function rememberOrder(order: Order, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(orderKey, order);
  } catch {
    // A browser that refuses storage still orders; it just forgets the choice.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
