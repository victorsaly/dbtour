// The home's setup of a database, shaped like an entry: five numbered sections, each opening when the one
// before is done, done ones folded to a line, the current one's number red. Each step is posted to dbtour
// serve, which does it as dbtour add, reader and read do: nothing is saved until the database answers, a
// password goes to the keychain and never comes back, and the database changes only on the second yes.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { databaseHref, type Served } from './served.ts';
import { azLine, clock, formProblem, setupSteps, startCommand, stepSummary, suggestName, took, type AzState, type SetupForm } from './setup.ts';

interface State {
  kinds: { type: string; name: string; installed: boolean }[];
  keychain: boolean;
  az: AzState;
  names: string[];
}

interface Plan {
  user: string;
  changes: string;
  statements: string[];
  account: string;
}

type ReaderChoice = 'create' | 'own' | 'skip';

/** A line of the log beside the steps: when, what, and its dot (grey doing, green done, red refused). */
interface LogLine {
  at: Date;
  text: string;
  tone: 'idle' | 'ok' | 'failed';
  /** What the server said a step did, set under the step. */
  detail?: boolean;
}

/** One step of the setup posted to dbtour serve: what it answered, or its reason as the error. */
export async function post<T>(served: Served, step: string, input: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/setup/${step}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': served.token }, body: JSON.stringify(input) });
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(answer.error ?? `dbtour serve answered ${response.status}: is it still running?`);
  return answer;
}

/** `onReader` is told when the database has a reader, so the rail's dot can turn green without a reload. */
export function SetupPage({ served, first, onReader }: { served: Served; first: boolean; onReader?: () => void }) {
  const [at, setAt] = useState(1);
  const [form, setForm] = useState<SetupForm>({ type: 'mssql', server: '', database: '', name: '', signIn: 'az', user: '', password: '' });
  const [named, setNamed] = useState(false);
  const [state, setState] = useState<State>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<ReaderChoice>('create');
  const [plan, setPlan] = useState<Plan>();
  const [own, setOwn] = useState({ user: '', password: '' });
  const [reader, setReader] = useState<string>();
  const [read, setRead] = useState<{ tables: number; log: string[] }>();
  const [log, setLog] = useState<LogLine[]>([]);
  const top = useRef<HTMLElement>(null);
  const logEnd = useRef<HTMLLIElement>(null);

  const note = (text: string, tone: LogLine['tone'] = 'ok') => setLog((lines) => [...lines, { at: new Date(), text, tone }]);
  /**
   * A step posted to dbtour serve, logged: what it is doing, grey until it ends, then green or red with how long
   * it took, and under it what the server did or why not.
   */
  const call = async <T,>(step: string, input: Record<string, unknown>, doing: string): Promise<T> => {
    const line: LogLine = { at: new Date(), text: doing, tone: 'idle' };
    setLog((lines) => [...lines, line]);
    const started = performance.now();
    const end = (tone: LogLine['tone'], after: string[]) =>
      setLog((lines) => [...lines.map((l) => (l === line ? { ...l, tone, text: `${doing} · ${took(performance.now() - started)}` } : l)), ...after.map((text) => ({ at: new Date(), text, tone, detail: true }))]);
    try {
      const answer = await post<T & { log?: string[] }>(served, step, input);
      end('ok', answer.log ?? []);
      return answer;
    } catch (e) {
      end('failed', [(e as Error).message]);
      throw e;
    }
  };
  // In braces: an effect returns its cleanup, and Chrome's scrollIntoView now returns a promise, not nothing.
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  const ask = () =>
    call<State>('state', {}, 'Asking dbtour serve what is installed, and az who is signed in').then(
      (s) => {
        setState(s);
        note(azLine(s.az).text, s.az.state === 'signed in' ? 'ok' : 'failed');
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => void ask(), []);
  useEffect(() => {
    top.current?.querySelector<HTMLElement>('.setup-step.is-current input, .setup-step.is-current button')?.focus();
  }, [at]);
  // The reader's statements are read once the database is saved, so the person sees them before choosing.
  useEffect(() => {
    if (at !== 4 || choice !== 'create' || plan) return;
    setBusy('Reading what it would change…');
    call<Plan>('reader-plan', { name: form.name }, `Reading what making dbtour_reader would change in ${form.name}`)
      .then(setPlan, (e: Error) => setError(e.message))
      .finally(() => setBusy(undefined));
  }, [at, choice]);

  const set = (change: Partial<SetupForm>) => {
    setError(undefined);
    setForm((f) => ({ ...f, ...change, ...(change.database !== undefined && !named ? { name: suggestName(change.database) } : {}) }));
  };
  /** Runs a step: its fields checked here first, then dbtour serve's answer, then the next step. */
  const go = async (doing: string, work: () => Promise<void>, next = at + 1) => {
    const problem = formProblem(at, form);
    if (problem) return setError(problem);
    setError(undefined);
    setBusy(doing);
    try {
      await work();
      setAt(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const pick = (next: ReaderChoice) => {
    setChoice(next);
    setError(undefined);
  };
  const where = { name: form.name, type: form.type, server: form.server.trim(), database: form.database.trim() };
  const kind = state?.kinds.find((k) => k.type === form.type);
  const az = azLine(state?.az);

  const bodies: Record<number, ReactNode> = {
    1: (
      <>
        <p className="setup-lead">Where the database is. dbtour reads its catalogue (tables, columns, keys, relations) and never a row.</p>
        <div className="setup-fields">
          <div className="setup-field">
            <span className="label">Kind</span>
            <span className="setup-value">{kind?.name ?? 'SQL Server'}</span>
            {kind && !kind.installed && (
              <span className="setup-help is-problem">
                Its source, dbtour-source-{kind.type}, is not installed: stop dbtour serve and start it with every package, <code>{startCommand}</code>
              </span>
            )}
          </div>
          <Field label="Server" value={form.server} onChange={(server) => set({ server })} placeholder="e.g. shop-sql.database.windows.net" help="As your SQL tool connects to it; a port after a comma: localhost,1433." />
          <Field label="Database" value={form.database} onChange={(database) => set({ database })} placeholder="e.g. Shop" help="Its name on that server." />
          <Field
            label="Name in dbtour"
            value={form.name}
            onChange={(name) => {
              setNamed(true);
              set({ name });
            }}
            placeholder="e.g. Shop"
            help="What dbtour calls it: its folder and its address here. Letters, digits, - and _."
          />
        </div>
        <Actions busy={busy}>
          <button type="button" className="button setup-go" onClick={() => go('Checking…', () => call('check', where, `Checking the names for ${where.name}`).then(() => undefined))}>
            Next
          </button>
        </Actions>
      </>
    ),
    2: (
      <>
        <p className="setup-lead">How dbtour signs in to read the catalogue. It needs no more than VIEW DEFINITION.</p>
        <div className="setup-choices" role="radiogroup" aria-label="Sign in">
          <Choice checked={form.signIn === 'az'} onChange={() => set({ signIn: 'az' })} title="Microsoft Entra, through az" detail="No password: dbtour signs in as you, through the Azure CLI. For Azure SQL.">
            <span className="setup-az">
              <span className={`status is-${az.tone}`}>{az.text}</span>
              {state?.az.state !== 'signed in' && (
                <button type="button" className="sql-copy" onClick={() => ask()}>
                  Check again
                </button>
              )}
            </span>
          </Choice>
          <Choice checked={form.signIn === 'login'} onChange={() => set({ signIn: 'login' })} title="A SQL login" detail="A login and its password, kept in this machine's keychain and never written to a file.">
            {form.signIn === 'login' && (
              <div className="setup-fields">
                <Field label="Login" value={form.user} onChange={(user) => set({ user })} placeholder="e.g. dbtour_catalogue" />
                <Field label="Password" type="password" value={form.password} onChange={(password) => set({ password })} help={`Sent once to dbtour serve on this machine, kept as "dbtour · ${form.name} · login".`} />
                {state && !state.keychain && <span className="setup-help is-problem">dbtour-keychain, which keeps the password, is not installed: sign in with az, or start dbtour with every package, <code>{startCommand}</code></span>}
              </div>
            )}
          </Choice>
        </div>
        <Actions busy={busy}>
          <button type="button" className="button setup-go" onClick={() => go('', async () => undefined)}>
            Next
          </button>
        </Actions>
      </>
    ),
    3: (
      <>
        <p className="setup-lead">
          dbtour signs in to {form.database} on {form.server} {form.signIn === 'az' ? 'with az' : `as ${form.user}`}, asks whether it answers, and saves it only if it does.
          Nothing in the database changes.
        </p>
        <Actions busy={busy}>
          <button
            type="button"
            className="button setup-go"
            onClick={() =>
              go('Signing in…', async () => {
                await call('add', { ...where, signIn: form.signIn, user: form.user, password: form.signIn === 'login' ? form.password : undefined }, `Signing in to ${where.database} on ${where.server}`);
                // Kept by the keychain now: the page forgets it.
                set({ password: '' });
              })
            }
          >
            Test and save
          </button>
        </Actions>
      </>
    ),
    4: (
      <>
        <p className="setup-lead">A reader is a login that can only read (db_datareader alone). With one, this database's page runs your queries; without, it shows the structure.</p>
        <div className="setup-choices" role="radiogroup" aria-label="Reader">
          <Choice checked={choice === 'create'} onChange={() => pick('create')} title="Make dbtour_reader for me" detail="dbtour runs two statements with your sign-in, after you have read them.">
            {choice === 'create' && plan && (
              <div className="setup-plan">
                <p>This changes {plan.changes}. It runs:</p>
                <pre className="setup-sql">{plan.statements.join('\n')}</pre>
                <p className="setup-help">The password is made on this machine, kept in the keychain as "{plan.account}", and shown to nobody.</p>
              </div>
            )}
          </Choice>
          <Choice checked={choice === 'own'} onChange={() => pick('own')} title="Use a read-only login I have" detail="dbtour signs in with it once, then keeps its password in the keychain.">
            {choice === 'own' && (
              <div className="setup-fields">
                <Field label="Reader's login" value={own.user} onChange={(user) => setOwn((o) => ({ ...o, user }))} />
                <Field label="Reader's password" type="password" value={own.password} onChange={(password) => setOwn((o) => ({ ...o, password }))} />
              </div>
            )}
          </Choice>
          <Choice checked={choice === 'skip'} onChange={() => pick('skip')} title="Not now" detail={`The page shows the structure and runs no query. dbtour reader ${form.name} --create makes one later.`} />
        </div>
        <Actions busy={busy}>
          {choice === 'create' && (
            <button
              type="button"
              className="button setup-go"
              disabled={!plan}
              onClick={() =>
                go('Making the reader…', async () => {
                  setReader((await call<{ reader: string }>('reader-create', { name: form.name, confirm: form.name }, `Making dbtour_reader in ${form.name}`)).reader);
                  onReader?.();
                })
              }
            >
              Run these on {form.name}
            </button>
          )}
          {choice === 'own' && (
            <button
              type="button"
              className="button setup-go"
              onClick={() =>
                go('Signing in as the reader…', async () => {
                  setReader((await call<{ reader: string }>('reader-use', { name: form.name, ...own }, `Signing in as ${own.user}`)).reader);
                  onReader?.();
                  setOwn((o) => ({ ...o, password: '' }));
                })
              }
            >
              Sign in and use it
            </button>
          )}
          {choice === 'skip' && (
            <button type="button" className="button setup-go" onClick={() =>
                go('', async () => {
                  setReader(undefined);
                  note('No reader for now: the page will show the structure');
                })
              }
            >
              Next
            </button>
          )}
        </Actions>
      </>
    ),
    5: (
      <>
        <p className="setup-lead">dbtour reads the catalogue and writes the database's page. A large one takes a minute.</p>
        <Actions busy={busy}>
          <button type="button" className="button setup-go" onClick={() => go('Reading the catalogue…', async () => setRead(await call('read', { name: form.name }, `Reading ${form.name}'s catalogue and writing its page`)))}>
            Read {form.name}
          </button>
        </Actions>
      </>
    ),
  };

  return (
    <div className="with-panel">
      <article className="page setup" ref={top}>
        <header className="entry-head">
          <h1>Add a database</h1>
          <p className="meta">
            <span>5 steps</span> · <span>nothing saved until it answers</span>
          </p>
          {first && !read && <p className="description">Nothing is set up on this machine yet. Tell dbtour where your database is, and it gives it a page you can search, follow and query.</p>}
        </header>
        <ol className="setup-steps">
          {setupSteps.map((title, i) => {
            const step = i + 1;
            const status = step < at ? 'is-done' : step === at ? 'is-current' : 'is-later';
            return (
              <li key={title} className={`setup-step ${status}`} aria-current={step === at ? 'step' : undefined}>
                <div className="setup-head">
                  <span className="no">{String(step).padStart(2, '0')}</span>
                  <h2 className="setup-title">{title}</h2>
                  {step < at && <span className="setup-summary">{stepSummary(step, form, { reader, tables: read?.tables })}</span>}
                  {/* Before the test saves it, the database and the sign-in can still change. */}
                  {step < at && at <= 3 && (
                    <button type="button" className="sql-copy setup-change" onClick={() => {
                        setAt(step);
                        setError(undefined);
                      }}>
                      Change
                    </button>
                  )}
                </div>
                {step === at && (
                  <div className="setup-body">
                    {bodies[step]}
                    {error && (
                      <p className="setup-error" role="alert">
                        <span className="status is-failed">Not yet</span> {error}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {read && (
          <section className="setup-done" aria-label="Done">
            <p>
              {form.name} is set up{reader ? ', with a reader that runs your queries' : ''}.
            </p>
            <div className="actions">
              <a className="button setup-go" href={databaseHref(form.name)}>
                Open {form.name}
              </a>
              <a className="button" href="/">
                All databases
              </a>
            </div>
          </section>
        )}
        <p className="sql-hint databases-hint">
          An agent can do the same in a terminal: <code>npx dbtour add {form.name || '<name>'} --server {form.server || '<host>'}</code>, then <code>dbtour reader</code> and <code>dbtour read</code>. Passwords never go on its command line.
        </p>
      </article>
      <aside className="panel setup-log" aria-label="Log">
        <h2>Log</h2>
        {log.length === 0 ? (
          <p className="setup-help">What each step does shows here as it runs.</p>
        ) : (
          <ol aria-live="polite">
            {log.map((line, i) => (
              <li key={i} className={`is-${line.tone}${line.detail ? ' is-detail' : ''}`} ref={i === log.length - 1 ? logEnd : undefined}>
                <time className="no">{clock(line.at)}</time>
                <span className={`status is-${line.tone}`}>
                  <span className="hidden-words">{line.tone === 'failed' ? 'refused' : line.tone === 'ok' ? 'done' : ''}</span>
                </span>
                <span className="setup-log-text">{line.text}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, help, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; help?: string; type?: 'text' | 'password' }) {
  const id = useId();
  return (
    <div className="setup-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        spellCheck={false}
        aria-describedby={help ? `${id}-help` : undefined}
      />
      {help && (
        <span className="setup-help" id={`${id}-help`}>
          {help}
        </span>
      )}
    </div>
  );
}

function Choice({ checked, onChange, title, detail, children }: { checked: boolean; onChange: () => void; title: string; detail: string; children?: ReactNode }) {
  return (
    <div className={`setup-choice${checked ? ' is-on' : ''}`}>
      <label>
        <input type="radio" checked={checked} onChange={onChange} />
        <span className="setup-choice-title">{title}</span>
        <span className="setup-help">{detail}</span>
      </label>
      {checked && children}
    </div>
  );
}

function Actions({ busy, children }: { busy: string | undefined; children: ReactNode }) {
  return (
    <div className="actions setup-actions">
      {busy ? (
        <span className="status is-idle" role="status">
          {busy}
        </span>
      ) : (
        children
      )}
    </div>
  );
}
