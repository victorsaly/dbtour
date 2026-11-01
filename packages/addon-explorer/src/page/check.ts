// The SQL editor's check of names against the model: a table after FROM or JOIN the database's model does not
// have, and a column a table it has does not, after the table's alias or name and a dot. Each is a warning, not
// an error, as the model may be older than the database, with the nearest name it has as a fix. Only what the
// model can answer is checked: a CTE, a temporary table, a variable, a function, a subquery, another database
// or a schema it has not read (sys, say) is left alone. Pure, so test/check.test.ts runs it as the editor does.
import type { Diagnostic } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { localRef } from 'dbtour/model';
import { namesInQuery, readAt, setupOf, unquote } from './complete.ts';
import { quoteName } from './query.ts';

const extractAgain = 'If it is new, run dbtour extract again.';

/** The names in the query the model does not have, each marked where it is written. */
export function unknownNames(state: EditorState): Diagnostic[] {
  const found = setupOf(state);
  if (!found) return [];
  const { items, ctes } = namesInQuery(state, found.index);
  const tables = new Map<string, string[]>();
  for (const known of new Set(found.index.values())) {
    const local = localRef(found.model, known.ref);
    const schema = local.slice(0, local.indexOf('.')).toLowerCase();
    tables.set(schema, [...(tables.get(schema) ?? []), local.slice(local.indexOf('.') + 1)]);
  }
  const marks: Diagnostic[] = [];
  for (const item of items) {
    if (item.known || item.call || !item.path.length) continue;
    const parts = item.path;
    // A temporary table or a variable, quoted or not, is the session's, not the model's.
    if (parts.some((p) => p.startsWith('#') || p.startsWith('@'))) continue;
    // The schema it is in, in lower case, when the model has read that schema; else not the model's to know.
    let schema: string | undefined;
    if (parts.length === 1 && !ctes.has(parts[0].toLowerCase())) schema = found.defaultSchema.toLowerCase();
    else if (parts.length === 2) schema = parts[0].toLowerCase();
    else if (parts.length === 3 && parts[0].toLowerCase() === found.databaseName.toLowerCase()) schema = parts[1].toLowerCase();
    if (schema === undefined || !tables.has(schema)) continue;
    const written = parts.join('.');
    const nearest = closest(parts[parts.length - 1], tables.get(schema)!);
    const fix = nearest === undefined ? undefined : [...parts.slice(0, -1), nearest].map(quoteName).join('.');
    marks.push(mark(item.at, item.to, `dbtour knows no table ${written} in ${found.databaseName}`, fix));
  }
  const tableAt = new Set(items.map((item) => item.at));
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name !== 'CompositeIdentifier' || tableAt.has(ref.from) || ref.node.nextSibling?.name === 'Parens') return;
      const parts = [];
      for (let child = ref.node.firstChild; child; child = child.nextSibling) if (child.name === 'Identifier' || child.name === 'QuotedIdentifier') parts.push(child);
      if (parts.length !== 2) return;
      const column = parts[1];
      const known = readAt(state, column.from, found.index).dotted?.known;
      if (!known) return;
      // CodeMirror's parser ends a "quoted name" at its first quote, so "a""b" comes as "a" and "b": joined
      // again, as T-SQL reads a doubled quote.
      let end = column.to;
      for (let next = column.to === ref.to ? ref.node.nextSibling : null; next?.name === 'QuotedIdentifier' && next.from === end && state.sliceDoc(next.from, next.from + 1) === '"'; next = next.nextSibling) end = next.to;
      const name = unquote(state.sliceDoc(column.from, end));
      const columns = known.suggestions.children.map((c) => c.label);
      if (columns.some((c) => c.toLowerCase() === name.toLowerCase())) return;
      const nearest = closest(name, columns);
      marks.push(mark(column.from, end, `${localRef(found.model, known.ref)} has no column ${name} in dbtour`, nearest === undefined ? undefined : quoteName(nearest)));
    },
  });
  return marks.sort((a, b) => a.from - b.from);
}

function mark(from: number, to: number, what: string, fix: string | undefined): Diagnostic {
  return {
    from,
    to,
    severity: 'warning',
    source: 'dbtour',
    message: fix === undefined ? `${what}: ${extractAgain.charAt(0).toLowerCase()}${extractAgain.slice(1)}` : `${what}. Did you mean ${fix}? ${extractAgain}`,
    actions: fix === undefined ? [] : [{ name: fix, apply: (view, at, end) => view.dispatch({ changes: { from: at, to: end, insert: fix } }) }],
  };
}

/** The name nearest `name`, a third of its letters off at most (one for a short one), or none. */
function closest(name: string, names: string[]): string | undefined {
  const most = Math.max(1, Math.floor(name.length / 3));
  let best: { name: string; distance: number } | undefined;
  for (const candidate of names) {
    const distance = edits(name.toLowerCase(), candidate.toLowerCase());
    if (distance <= most && (!best || distance < best.distance)) best = { name: candidate, distance };
  }
  return best?.name;
}

/** How many letters to add, drop or change to turn one word into the other. */
function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

