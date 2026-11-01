// Search over tables, columns and groups: built once from the model, queried on every keystroke of the page
// and by an agent through the MCP server.
import { tableRef, type Model } from './model.ts';

export interface Hit {
  kind: 'table' | 'view' | 'column' | 'group';
  /** schema.table for a table or column, the group's name for a group. */
  ref: string;
  column?: string;
  title: string;
  detail: string;
  score: number;
}

export interface Entry extends Omit<Hit, 'score'> {
  /** Lower-cased name, where a prefix match counts most. */
  name: string;
  /** Lower-cased ref and description, where any match counts. */
  text: string;
}

export function buildIndex(model: Model): Entry[] {
  const entries: Entry[] = [];
  for (const database of model.databases) {
    for (const schema of database.schemas) {
      for (const table of schema.tables) {
        const ref = tableRef(schema.name, table.name);
        entries.push({
          kind: table.kind,
          ref,
          title: ref,
          detail: table.description ?? `${table.columns.length} ${table.columns.length === 1 ? 'column' : 'columns'}`,
          name: table.name.toLowerCase(),
          text: `${ref} ${table.description ?? ''}`.toLowerCase(),
        });
        for (const column of table.columns) {
          entries.push({
            kind: 'column',
            ref,
            column: column.name,
            title: `${ref}.${column.name}`,
            detail: column.description ?? column.type,
            name: column.name.toLowerCase(),
            text: `${ref}.${column.name} ${column.type} ${column.description ?? ''}`.toLowerCase(),
          });
        }
      }
    }
  }
  for (const group of model.groups) {
    entries.push({ kind: 'group', ref: group.name, title: group.name, detail: group.description ?? `${group.tables.length} tables`, name: group.name.toLowerCase(), text: `${group.name} ${group.description ?? ''}`.toLowerCase() });
  }
  return entries;
}

// How well the words match comes first: a name that starts with the word beats one that contains it,
// which beats a match in the description. Among equal matches a table comes before a group, then a column,
// so typing a table's name finds the table and typing a column's name finds the column.
const kindWeight: Record<Hit['kind'], number> = { table: 3, view: 3, group: 2, column: 1 };
const prefixScore = 3;
const nameScore = 2;
const textScore = 1;

export function search(index: Entry[], query: string, limit = 50): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return [];
  const hits: Hit[] = [];
  for (const entry of index) {
    let score = 0;
    for (const word of words) {
      const wordScore = entry.name.startsWith(word) ? prefixScore : entry.name.includes(word) ? nameScore : entry.text.includes(word) ? textScore : 0;
      if (wordScore === 0) {
        score = 0;
        break;
      }
      score += wordScore;
    }
    if (score > 0) hits.push({ kind: entry.kind, ref: entry.ref, column: entry.column, title: entry.title, detail: entry.detail, score });
  }
  hits.sort((a, b) => b.score - a.score || kindWeight[b.kind] - kindWeight[a.kind] || a.title.length - b.title.length || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}
