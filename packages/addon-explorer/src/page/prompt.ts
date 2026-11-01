// "Copy for Claude": the selected tables as the same Markdown the repository holds, with one line of
// framing, so the agent gets the columns, keys, relations and diagram and nothing it has to guess.
import { renderTableMarkdown } from 'dbtour/markdown';
import type { Model } from 'dbtour/model';

export function prompt(model: Model, refs: string[]): string {
  const names = model.databases.map((d) => d.name).join(', ');
  const pages = refs.map((ref) => renderTableMarkdown(model, ref));
  return `The schema of the ${names} database, from dbtour. Table names are schema.table; relations are listed on both tables.\n\n${pages.join('\n---\n\n')}`;
}
