// SQL on the page: a definition in a read-only CodeMirror editor, with line numbers and folding, and a short
// expression in a table cell as coloured text. Both read it with the same MSSQL parser and the same classes
// (sql.ts), so a check reads the same in a cell as in a trigger. The editor is where a SQL generator will
// later let the reader write; for now nothing can be typed into it.
import { useEffect, useRef, useState } from 'react';
import { acceptCompletion, autocompletion, completionKeymap, pickedCompletion, startCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { foldGutter, syntaxHighlighting } from '@codemirror/language';
import { MSSQL, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import type { Model } from 'dbtour/model';
import { CopyButton } from './Copy.tsx';
import { expandStar, pickOf, sqlSupport } from './complete.ts';
import { formatQuery } from './format.ts';
import { sqlPrompt } from './query.ts';
import { sqlHighlighter, sqlTokens } from './sql.ts';
import { storedTool } from './tools.ts';
import { autoRunPauseMs, autoRunPlan, caretAt, cellText, connectionFor, parseServed, statusOf, type Served } from './served.ts';

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
 * Where the text is: CodeMirror's own caret is black, which vanishes on the dark field, so it is drawn in ink,
 * two pixels wide; the line the caret is on is lifted with --fill, and a selection takes VS Code's colours, as
 * the SQL itself does.
 */
const look = EditorView.theme({
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--sql-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--fill)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
});

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
 * How often the reader picked each suggestion, in this browser: what they use comes first among equals. Read
 * from storage once, then kept here, as completion asks for every suggestion it lists.
 */
const usedKey = 'dbtour.sql.used';
let usedCounts: Record<string, number> | undefined;

function used(): Record<string, number> {
  if (!usedCounts) {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(usedKey) ?? '{}');
      usedCounts = stored && typeof stored === 'object' ? (stored as Record<string, number>) : {};
    } catch {
      usedCounts = {};
    }
  }
  return usedCounts;
}

function countUse(key: string): void {
  const counts = used();
  counts[key] = (counts[key] ?? 0) + 1;
  try {
    localStorage.setItem(usedKey, JSON.stringify(counts));
  } catch {
    // A browser that refuses storage still completes; it learns only until the page closes.
  }
}

/** The query laid out, in place, undoable; one Format cannot read is left as it is. */
function format(view: EditorView): boolean {
  const doc = view.state.doc.toString();
  const laid = formatQuery(doc);
  if (laid !== null && laid !== doc) view.dispatch({ changes: { from: 0, to: doc.length, insert: laid } });
  return true;
}

/** Whether auto-run is on, in this browser: off until the reader turns it on, as each run reads the database. */
const autoRunKey = 'dbtour.sql.autorun';

function readAutoRun(): boolean {
  try {
    return localStorage.getItem(autoRunKey) === 'on';
  } catch {
    return false;
  }
}

function writeAutoRun(on: boolean): void {
  try {
    if (on) localStorage.setItem(autoRunKey, 'on');
    else localStorage.removeItem(autoRunKey);
  } catch {
    // A browser that refuses storage still auto-runs; it just asks again next time.
  }
}

/**
 * The editor a query is written in: the database's tables and columns autocomplete, the reader's draft is
 * kept in the browser, and Copy, "Copy for …" and Reset sit on its bar. The page cannot reach the database, so
 * it says where the query runs: dbtour sql, or the MCP query tool.
 */
/** What dbtour serve wrote into the page, read once: nothing when the page was opened from a file. */
export function servedPage(): Served | undefined {
  return typeof document === 'undefined' ? undefined : parseServed(document.querySelector('meta[name="dbtour-serve"]')?.getAttribute('content'));
}

/** The rows a run asks for: the first hundred, as dbtour sql gives by default. */
const runRows = 100;

interface Ran {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  reason?: 'limit' | 'size';
  ms: number;
  source: string;
}

export function SqlEditor({ model, database, initial, draft, autoFocus = false }: { model: Model; database: string | undefined; initial: string; draft: string; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const tool = storedTool();
  const served = servedPage();
  const connection = connectionFor(served, database);
  // The last result stays while the next run goes and after one fails, dimmed, so the rows do not flash away.
  const [ran, setRan] = useState<{ result?: Ran; error?: string; running?: boolean; waiting?: string }>({});
  const status = statusOf(connection, ran);
  const [autoRun, setAutoRun] = useState(readAutoRun);
  const auto = useRef(autoRun);
  auto.current = autoRun;
  // One query at a time: what was last sent, the latest run's number (an older answer is dropped), whether one
  // is out, and whether the query changed while it was, so auto-run goes again when it comes back.
  const lastSent = useRef<string | undefined>(undefined);
  const latest = useRef(0);
  const out = useRef(false);
  const again = useRef(false);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const send = useRef<(sql: string) => void>(() => undefined);
  send.current = (sql) => {
    // One at a time whichever way it is asked, Run, ⌘/Ctrl+Enter or auto-run: an answer must not clear out
    // while a later query is still running.
    if (connection.state !== 'ready' || !served || out.current) return;
    const mine = ++latest.current;
    lastSent.current = sql;
    out.current = true;
    setRan((r) => ({ result: r.result, running: true }));
    const answered = (next: { result?: Ran; error?: string }) => {
      out.current = false;
      if (mine === latest.current) setRan((r) => (next.result ? next : { result: r.result, error: next.error }));
      if (again.current) {
        again.current = false;
        tick.current();
      }
    };
    fetch('api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dbtour-token': served.token },
      body: JSON.stringify({ sql, source: connection.source, limit: runRows }),
    })
      .then(async (response) => {
        const answer = await response.json();
        answered(response.ok ? { result: answer as Ran } : { error: (answer as { error?: string }).error ?? `dbtour serve answered ${response.status}` });
      })
      .catch(() => answered({ error: 'dbtour serve did not answer: is it still running? Start it again, then reload this page.' }));
  };
  // Run, and ⌘/Ctrl+Enter, bound once in the editor: always the current query, sent whatever auto-run would say.
  const run = useRef<() => void>(() => undefined);
  run.current = () => {
    if (view.current) send.current(view.current.state.doc.toString());
  };
  // Auto-run, once typing pauses: a whole, allowed query that is not the one last sent.
  const tick = useRef<() => void>(() => undefined);
  tick.current = () => {
    if (!auto.current || connection.state !== 'ready' || !view.current) return;
    if (out.current) {
      again.current = true;
      return;
    }
    const sql = view.current.state.doc.toString();
    const plan = autoRunPlan(sql, lastSent.current);
    if (plan.send) send.current(sql);
    else if (plan.waiting) setRan((r) => ({ result: r.result, waiting: plan.waiting }));
    else setRan((r) => ({ ...r, waiting: undefined }));
  };
  const toggleAutoRun = (on: boolean) => {
    setAutoRun(on);
    writeAutoRun(on);
    auto.current = on;
    if (on) tick.current();
    else setRan((r) => ({ ...r, waiting: undefined }));
  };
  useEffect(() => {
    if (!host.current) return;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: readDraft(draft) ?? initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          look,
          history(),
          // Tab is the editor's only while the suggestions are open, where it takes one as Enter does, after * in
          // the select list, where it writes the columns, and in a snippet's fields; anywhere else it leaves the
          // editor, so the keyboard is never trapped in it (Escape closes the list first).
          // Ctrl+Enter runs the query, as in SQL Server's tools, and ⌘+Enter too on a Mac, ahead of the default
          // keymap's own use of them. Shift+Alt+F formats, as in VS Code, and so does ⌘/Ctrl+K ⌘/Ctrl+Y, as in
          // SQL Server Management Studio's add-ins.
          keymap.of([
            { key: 'Mod-Enter', run: () => (run.current(), true) },
            { key: 'Ctrl-Enter', run: () => (run.current(), true) },
            {
              key: 'Tab',
              run: (v) => {
                if (acceptCompletion(v)) return true;
                const spec = expandStar(v.state);
                if (spec) v.dispatch(spec);
                return Boolean(spec);
              },
            },
            { key: 'Shift-Alt-f', run: format },
            { key: 'Mod-k Mod-y', run: format },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          // What belongs at the caret: columns in scope, conditions after ON, joins after JOIN (complete.ts).
          sqlSupport(model, database, (key) => used()[key] ?? 0),
          // Words only, no icons: the catalogue draws no glyph it does not explain.
          autocompletion({ icons: false }),
          syntaxHighlighting(sqlHighlighter),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'SQL query' }),
          EditorView.updateListener.of((update) => {
            for (const tr of update.transactions) {
              const picked = tr.annotation(pickedCompletion);
              if (!picked) continue;
              const { key, reopen } = pickOf(picked);
              if (key) countUse(key);
              // A snippet that ends where a table goes opens the list again, once this update is done.
              if (reopen) setTimeout(() => startCompletion(update.view));
            }
            if (!update.docChanged) return;
            writeDraft(draft, update.state.doc.toString() === initial ? undefined : update.state.doc.toString());
            if (auto.current) {
              // The latest pause decides: a retry queued during an earlier run must not send it mid-word.
              again.current = false;
              clearTimeout(pause.current);
              pause.current = setTimeout(() => tick.current(), autoRunPauseMs);
            }
          }),
        ],
      }),
    });
    // On the SQL page the editor is the page: the caret waits on the line left to write on. An entry's Query
    // section never takes focus, so opening a table still reads from the top.
    if (autoFocus) {
      const at = caretAt(view.current.state.doc.toString());
      view.current.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      view.current.focus();
    }
    return () => {
      // Gone from the page: an answer still on its way finds no editor, so it cannot send the draft again.
      clearTimeout(pause.current);
      again.current = false;
      view.current?.destroy();
      view.current = null;
    };
  }, [model, database, initial, draft, autoFocus]);
  const text = () => view.current?.state.doc.toString() ?? initial;
  const reset = () => {
    writeDraft(draft, undefined);
    view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: initial } });
  };
  return (
    <div className="sql-frame sql-editor">
      <div className="sql-bar">
        <span className="sql-state">
          <span className="label">T-SQL</span>
          <span className={`status is-${status.tone}`} role="status">
            {status.text}
          </span>
        </span>
        <span className="sql-actions">
          {connection.state === 'ready' && (
            <>
              <label className="sql-auto">
                <input type="checkbox" checked={autoRun} onChange={(event) => toggleAutoRun(event.target.checked)} />
                Auto-run
              </label>
              <button type="button" className="sql-copy sql-run" onClick={() => run.current()} disabled={ran.running}>
                {ran.running ? 'Running…' : 'Run'}
              </button>
            </>
          )}
          <CopyButton text={text} className="sql-copy" label="Copy query" />
          <CopyButton text={() => sqlPrompt(model, text(), database)} className="sql-copy" label={`Copy query for ${tool.name}`} />
          <button type="button" className="sql-copy" onClick={() => view.current && format(view.current)}>
            Format
          </button>
          <button type="button" className="sql-copy" onClick={reset}>
            Reset
          </button>
        </span>
      </div>
      <div className="sql-block" ref={host} />
      {ran.error && (
        <p className="sql-error" role="alert">
          <span className="tag warn">not run</span> {ran.error}
        </p>
      )}
      {ran.waiting && (
        <p className="sql-waiting">
          <span className="tag">waiting</span> {ran.waiting}
        </p>
      )}
      {ran.result && <Result result={ran.result} stale={Boolean(ran.running || ran.error)} />}
      <p className="sql-hint">
        Ctrl+Space suggests what fits where the caret is, and Tab or Enter takes it. Tab after * writes the columns; ssf, st100,
        scf, cte and wex write the start of a query; Shift+Alt+F or ⌘/Ctrl+K ⌘/Ctrl+Y formats it.
      </p>
      <p className="sql-hint">
        {connection.state === 'ready' && (
          <>
            Runs through {connection.source}'s reader, a read-only login: checked first, rolled back after, at most {runRows} rows. Ctrl+Enter (or ⌘+Enter) runs it;
            with Auto-run, it runs each time you pause typing. The dot is the last run: grey none yet, green answered, red failed.
          </>
        )}
        {connection.state === 'no reader' && (
          <>
            Connected, but {connection.source} has no reader: add <code>reader: ${'{'}DBTOUR_MSSQL_READER{'}'}</code> to it in dbtour.yaml, then start dbtour serve again.
          </>
        )}
        {connection.state === 'not served' && (
          <>
            Not connected: opened from a file, the page cannot reach the database. Run <code>npx dbtour serve</code> and open the address it prints to run
            queries here, or run this one with <code>npx dbtour sql</code> or an agent's MCP <code>query</code> tool.
          </>
        )}
      </p>
    </div>
  );
}

/** The rows a run returned, how many and how fast, through which reader, and whether the limit cut them. */
function Result({ result, stale }: { result: Ran; stale: boolean }) {
  const n = result.rows.length;
  const cut = result.truncated ? (result.reason === 'size' ? ' · cut at 10 MB' : ' · the limit') : '';
  return (
    <div className={stale ? 'sql-result is-stale' : 'sql-result'} aria-live="polite">
      <div className="sql-result-head">
        <span className="label">{stale ? 'Result · the run before' : 'Result'}</span>
        <span className="label">
          {n} {n === 1 ? 'row' : 'rows'}
          {cut} · {result.ms} ms · {result.source}'s reader
        </span>
      </div>
      <div className="scroll-x sql-result-rows">
        <table>
          <thead>
            <tr>
              {result.columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, r) => (
              <tr key={r}>
                {row.map((value, c) => {
                  const cell = cellText(value);
                  return (
                    <td key={c} className={cell.isNull ? 'mono muted' : 'mono'}>
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
