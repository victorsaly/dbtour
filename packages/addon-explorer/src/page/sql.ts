// SQL as classed tokens, by CodeMirror's own MSSQL parser: the same reading the editor gives, without an
// editor, so a check or a filter in a table cell is coloured as a trigger's definition is. Pure, and tested
// in Node; the page maps each kind to a colour token in styles.css.
import { MSSQL } from '@codemirror/lang-sql';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';

export type SqlKind = 'keyword' | 'builtin' | 'type' | 'name' | 'string' | 'number' | 'comment' | 'operator' | '';

export interface SqlToken {
  text: string;
  kind: SqlKind;
}

/** The parser's tags, read as the few kinds the page colours. The most specific listed tag wins. */
/** The classes are sql-<kind>, the same in the editor and in a cell, so one set of colours serves both. */
export const sqlHighlighter = tagHighlighter([
  { tag: tags.keyword, class: 'sql-keyword' },
  { tag: tags.typeName, class: 'sql-type' },
  // A built-in function (CAST, COUNT, SYSUTCDATETIME), which the parser marks as a standard name.
  { tag: tags.standard(tags.name), class: 'sql-builtin' },
  { tag: tags.name, class: 'sql-name' },
  // A quoted identifier, [Status] in T-SQL, is a name, though the parser files it under string.
  { tag: tags.special(tags.string), class: 'sql-name' },
  { tag: tags.string, class: 'sql-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'sql-number' },
  { tag: tags.comment, class: 'sql-comment' },
  { tag: tags.operator, class: 'sql-operator' },
]);

const parser = MSSQL.language.parser;

/** Every character of the code, in order, each run with the kind it was read as ('' for the rest). */
export function sqlTokens(code: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const put = (text: string, classes: string) => {
    if (text === '') return;
    const kind = classes.replace(/^sql-/, '');
    const last = tokens[tokens.length - 1];
    // Runs of the same kind join, so a cell is a few spans rather than one per character class.
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind: kind as SqlKind });
  };
  highlightCode(code, parser.parse(code), sqlHighlighter, put, () => put('\n', ''));
  // T-SQL's Unicode strings, N'x', which the parser reads as a name N and then a string.
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (/^[Nn]$/.test(tokens[i].text) && tokens[i].kind === 'name' && tokens[i + 1].kind === 'string' && tokens[i + 1].text.startsWith("'")) {
      tokens.splice(i, 2, { text: tokens[i].text + tokens[i + 1].text, kind: 'string' });
    }
  }
  return tokens;
}
