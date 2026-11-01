// SQL on the page: a definition in a read-only CodeMirror editor, with line numbers and folding, and a short
// expression in a table cell as coloured text. Both read it with the same MSSQL parser and the same classes
// (sql.ts), so a check reads the same in a cell as in a trigger. The editor is where a SQL generator will
// later let the reader write; for now nothing can be typed into it.
import { useEffect, useRef } from 'react';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, syntaxHighlighting } from '@codemirror/language';
import { MSSQL, SQLDialect, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { Model } from 'dbtour/model';
import { CopyButton } from './Copy.tsx';
import { completionSchema, sqlPrompt } from './query.ts';
import { sqlHighlighter, sqlTokens } from './sql.ts';
import { storedTool } from './tools.ts';

export function SqlBlock({ code, label = 'SQL definition' }: { code: string; label?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code.trim(),
        extensions: [
          lineNumbers(),
          foldGutter(),
          sql({ dialect: MSSQL }),
          syntaxHighlighting(sqlHighlighter),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
        ],
      }),
    });
    return () => view.destroy();
  }, [code, label]);
  return (
    <div className="sql-frame">
      <div className="sql-bar">
        <span className="label">T-SQL</span>
        <CopyButton text={code.trim()} className="sql-copy" />
      </div>
      <div className="sql-block" ref={host} />
    </div>
  );
}

export function SqlInline({ code }: { code: string }) {
  return (
    <code className="sql">
      {sqlTokens(code).map((t, i) => (t.kind ? <span key={i} className={`sql-${t.kind}`}>{t.text}</span> : t.text))}
    </code>
  );
}

/**
 * T-SQL as SQL Server reads it by default: names are not case-sensitive, so a completed OrderLines needs no
 * quotes, and a name that does need them gets [brackets], as T-SQL is written, rather than "double quotes".
 */
const tsql = SQLDialect.define({ ...MSSQL.spec, caseInsensitiveIdentifiers: true, identifierQuotes: '["' });

/** Where a reader's draft is kept, in this browser only: a convenience, gone with the browser's data. */
const draftKey = (key: string) => `dbtour.sql.${key}`;

function readDraft(key: string): string | undefined {
  try {
    return localStorage.getItem(draftKey(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeDraft(key: string, text: string | undefined): void {
  try {
    if (text === undefined) localStorage.removeItem(draftKey(key));
    else localStorage.setItem(draftKey(key), text);
  } catch {
    // A browser that refuses storage still edits; it just forgets the draft.
  }
}

/**
 * The editor a query is written in: the database's tables and columns autocomplete, the reader's draft is
 * kept in the browser, and Copy, "Copy for …" and Reset sit on its bar. The page cannot reach the database, so
 * it says where the query runs: dbtour sql, or the MCP query tool.
 */
export function SqlEditor({ model, database, initial, draft }: { model: Model; database: string | undefined; initial: string; draft: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const tool = storedTool();
  useEffect(() => {
    if (!host.current) return;
    const { schema, defaultSchema } = completionSchema(model, database);
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: readDraft(draft) ?? initial,
        extensions: [
          lineNumbers(),
          history(),
          // No Tab binding: Tab leaves the editor, so the keyboard is never trapped in it.
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          sql({ dialect: tsql, schema, defaultSchema, upperCaseKeywords: true }),
          // Words only, no icons: the catalogue draws no glyph it does not explain.
          autocompletion({ icons: false }),
          syntaxHighlighting(sqlHighlighter),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'SQL query' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) writeDraft(draft, update.state.doc.toString() === initial ? undefined : update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
  }, [model, database, initial, draft]);
  const text = () => view.current?.state.doc.toString() ?? initial;
  const reset = () => {
    writeDraft(draft, undefined);
    view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: initial } });
  };
  return (
    <div className="sql-frame sql-editor">
      <div className="sql-bar">
        <span className="label">T-SQL</span>
        <span className="sql-actions">
          <CopyButton text={text} className="sql-copy" label="Copy query" />
          <CopyButton text={() => sqlPrompt(model, text(), database)} className="sql-copy" label={`Copy query for ${tool.name}`} />
          <button type="button" className="sql-copy" onClick={reset}>
            Reset
          </button>
        </span>
      </div>
      <div className="sql-block" ref={host} />
      <p className="sql-hint">
        The page cannot reach the database. Run the query with <code>npx dbtour sql</code>, or ask an agent to through the MCP <code>query</code> tool.
      </p>
    </div>
  );
}
