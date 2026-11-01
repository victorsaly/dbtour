// The catalogue: every table has a number, in the order the model lists them, and every schema a colour
// block. Numbers and blocks always appear beside the name, never instead of it.
import { tableRef, type Model } from 'dbtour/model';

export interface Entry {
  /** Zero-padded, 001 upwards, three digits at least. */
  number: string;
  ref: string;
  schema: string;
  table: string;
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
      for (const table of schema.tables) entries.push({ number: '', ref: tableRef(schema.name, table.name), schema: schema.name, table: table.name });
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
