// SQL on the page: a definition in a read-only CodeMirror editor, with line numbers and folding, and a short
// expression in a table cell as coloured text. Both read it with the same MSSQL parser and the same classes
// (sql.ts), so a check reads the same in a cell as in a trigger. The editor is where a SQL generator will
// later let the reader write; for now nothing can be typed into it.
import { useEffect, useRef } from 'react';
import { foldGutter, syntaxHighlighting } from '@codemirror/language';
import { MSSQL, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { CopyButton } from './Copy.tsx';
import { sqlHighlighter, sqlTokens } from './sql.ts';

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
