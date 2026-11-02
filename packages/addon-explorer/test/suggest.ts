// The SQL editor's suggestions as the reader sees them, for the cases in complete.test.ts and the ranking
// bench in ranking.test.ts: a query with the caret at |, and the list CodeMirror would show there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CompletionContext, type Completion, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { Model } from 'dbtour/model';
import { sqlSupport } from '../src/page/complete.ts';

export const shop = (): Model => JSON.parse(readFileSync(new URL('../../core/test/fixtures/shop.json', import.meta.url), 'utf8'));

export interface Listed {
  label: string;
  apply: string;
  detail?: string;
}

/**
 * The list at the caret. Explicit is Ctrl+Space; without it, as when typing. The order is CodeMirror's: how
 * well the label matches what is typed, plus the option's boost, then the label. Only prefix matches are kept:
 * the fuzzy ones CodeMirror also lists come last there, and no case here rests on them.
 */
export async function suggest(
  text: string,
  { explicit = false, model = shop(), database = 'Shop', used = {} as Record<string, number> } = {},
): Promise<Listed[]> {
  const pos = text.indexOf('|');
  assert.ok(pos >= 0, 'a case marks the caret with |');
  const doc = text.slice(0, pos) + text.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [sqlSupport(model, database, (key) => used[key] ?? 0)] });
  ensureSyntaxTree(state, doc.length, 5000);
  const context = new CompletionContext(state, pos, explicit);
  const sources = state.languageDataAt<CompletionSource>('autocomplete', pos);
  const results = (await Promise.all(sources.map((s) => s(context)))).filter((r): r is CompletionResult => Boolean(r));
  const scored: { option: Completion; score: number }[] = [];
  for (const result of results) {
    const typed = doc.slice(result.from, pos);
    for (const option of result.options) {
      const score = matchScore(typed, option.label);
      if (score !== null) scored.push({ option, score: score + (option.boost ?? 0) });
    }
  }
  const sorted = scored.sort((a, b) => b.score - a.score || (a.option.sortText ?? a.option.label).localeCompare(b.option.sortText ?? b.option.label));
  const listed: Listed[] = [];
  for (const { option } of sorted) {
    const apply = typeof option.apply === 'string' ? option.apply : option.label;
    const same = listed.find((l) => l.label === option.label && l.apply === apply && l.detail === option.detail);
    if (!same) listed.push({ label: option.label, apply, detail: option.detail });
  }
  return listed;
}

// CodeMirror's penalties: -100 when the label is longer than what is typed, -200 when only the case differs.
function matchScore(typed: string, label: string): number | null {
  if (!typed) return 0;
  const full = typed.length === label.length ? 0 : -100;
  if (label.startsWith(typed)) return full;
  if (label.toLowerCase().startsWith(typed.toLowerCase())) return full - 200;
  return null;
}

export const applies = async (text: string, options?: Parameters<typeof suggest>[1]) => (await suggest(text, options)).map((s) => s.apply);
