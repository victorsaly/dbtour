// The home's setup of a database, the parts that are not the page: its steps, the checks made before a step
// is sent, and the one line each step folds to once it is done. Pure, so it is tested in Node; dbtour serve
// checks everything again, as the page's checks only spare a round trip.
import type { Tone } from './served.ts';

/** dbtour with every package the setup uses, as core's startCommand: what a missing package is fixed with. */
export const startCommand = 'npx -y -p dbtour -p dbtour-source-mssql -p dbtour-addon-explorer -p dbtour-keychain dbtour serve';

/** The five numbered sections of the setup, in order: each opens when the one before is done. */
export const setupSteps = ['Database', 'Sign in', 'Test', 'Reader', 'Read'] as const;

export interface SetupForm {
  /** The source's type: mssql. */
  type: string;
  server: string;
  /** The database's name on its server. */
  database: string;
  /** What dbtour calls it: its folder, its address on the home, the name every command takes. */
  name: string;
  signIn: 'az' | 'login';
  user: string;
  password: string;
}

/** What az says of who is signed in, as dbtour serve asks it. */
export type AzState = { state: 'signed in'; user: string } | { state: 'signed out' } | { state: 'missing' };

/** The longest name dbtour takes, as core's nameProblem does. */
const nameLength = 64;

/**
 * A name dbtour takes, made from the database's: a letter first, then letters, digits, - and _. The person can
 * change it; most keep the database's own.
 */
export function suggestName(database: string): string {
  const name = database.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (name === '') return '';
  return (/^[A-Za-z]/.test(name) ? name : `db-${name}`).slice(0, nameLength);
}

/** Why a step's fields cannot be sent yet, in a sentence that says what to type; nothing when they can. */
export function formProblem(step: number, form: SetupForm): string | undefined {
  if (step === 1) {
    if (form.server.trim() === '') return 'Type the server\'s address, as your SQL tool connects to it.';
    if (form.database.trim() === '') return 'Type the database\'s name on that server.';
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(form.name) || form.name.length > nameLength) return `Give it a name that starts with a letter, then letters, digits, - or _, at most ${nameLength}.`;
  }
  if (step === 2 && form.signIn === 'login') {
    if (form.user.trim() === '') return 'Type the login dbtour signs in as.';
    if (form.password === '') return 'Type the login\'s password: it goes to this machine\'s keychain, nowhere else.';
  }
  return undefined;
}

/** The one line a done step folds to. */
export function stepSummary(step: number, form: SetupForm, done: { reader?: string; tables?: number }): string {
  switch (step) {
    case 1:
      return `${form.database} on ${form.server}${form.name === form.database ? '' : `, called ${form.name}`}`;
    case 2:
      return form.signIn === 'az' ? 'Microsoft Entra, through az' : `The login ${form.user}, its password in the keychain`;
    case 3:
      return 'It answered, and is saved';
    case 4:
      return done.reader ? `${done.reader}, which can only read` : 'None for now: the page shows the structure, and runs no query';
    default:
      return `${done.tables ?? 0} ${done.tables === 1 ? 'table' : 'tables'} read, and its page written`;
  }
}

/** A log line's time: the clock on this machine, to the second. */
export function clock(at: Date): string {
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** How long a step took: milliseconds under a second, then seconds to a tenth. */
export function took(ms: number): string {
  // A no-break space, so a narrow log never leaves the unit on a line of its own.
  return ms < 1000 ? `${Math.round(ms)}\u00a0ms` : `${(ms / 1000).toFixed(1)}\u00a0s`;
}

/** The sign-in step's line about az, and its dot: green when signed in, red when signed out, hollow without az. */
export function azLine(az: AzState | undefined): { tone: Tone; text: string } {
  if (az === undefined) return { tone: 'idle', text: 'Asking az who is signed in…' };
  if (az.state === 'signed in') return { tone: 'live', text: `Signed in to az as ${az.user}` };
  if (az.state === 'signed out') return { tone: 'failed', text: 'az is signed out: run az login in a terminal, then check again' };
  return { tone: 'off', text: 'az is not installed here: install the Azure CLI and run az login, or sign in with a login' };
}
