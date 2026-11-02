// The commands that set up databases on this machine (add, reader, read, list, remove) and --database on the
// others, with a source, a keychain and an add-on of the test's own: nothing here reaches a server or the
// system's keychain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type Io } from '../src/cli.ts';
import type { Model } from '../src/model.ts';
import type { Source } from '../src/plugins.ts';
import type { SecretStore, Target } from '../src/workspace.ts';

const shopModel: Model = JSON.parse(readFileSync(new URL('./fixtures/shop.json', import.meta.url), 'utf8'));

/** A connection string a test can read back: how, who and where; the password stays a secret's stand-in. */
const describe = (t: Target) => `${t.signIn}:${t.user ?? ''}:${t.password ?? ''}@${t.server}/${t.database}`;

interface Harness {
  io: Io;
  out: string[];
  err: string[];
  calls: string[];
  secrets: Map<string, string>;
  home: string;
}

function harness(options: { roles?: string[]; exists?: boolean; failTest?: boolean; stdin?: string } = {}): Harness {
  const home = join(mkdtempSync(join(tmpdir(), 'dbtour-ws-')), '.dbtour');
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const secrets = new Map<string, string>();
  const store: SecretStore = {
    get: async (a) => secrets.get(a),
    set: async (a, s) => void secrets.set(a, s),
    remove: async (a) => secrets.delete(a),
  };
  const source: Source = {
    extract: async (c) => {
      calls.push(`extract ${c.connection}`);
      return { ...shopModel.databases[0], name: c.name };
    },
    run: async (c, sql) => {
      calls.push(`run ${c.connection} ${sql}`);
      return { columns: ['ok'], rows: [[1]], truncated: false, limit: 1 };
    },
    setup: {
      connectionString: describe,
      readerState: async (admin, user) => {
        calls.push(`state ${admin} ${user}`);
        if (options.failTest) throw new Error('Login failed for user.');
        return { exists: options.exists ?? false, roles: options.roles ?? [] };
      },
      readerStatements: (user, exists) => [`${exists ? 'ALTER' : 'CREATE'} USER [${user}] WITH PASSWORD = '••••••';`, `ALTER ROLE db_datareader ADD MEMBER [${user}];`],
      createReader: async (admin, user, password, reader) => void calls.push(`create ${admin} ${user} ${password === reader.split(':')[2].split('@')[0] ? 'same password' : 'other password'}`),
    },
  };
  const stdin = new PassThrough();
  stdin.end(options.stdin ?? '');
  const io: Io = {
    cwd: mkdtempSync(join(tmpdir(), 'dbtour-elsewhere-')),
    log: (s) => out.push(s),
    error: (s) => err.push(s),
    env: { DBTOUR_HOME: home },
    secrets: store,
    stdin,
    load: async () => source,
    loadAddon: async () => ({ render: (model: Model) => ({ 'index.html': `<title>${model.databases[0]?.name ?? 'home'}</title>` }) }),
    az: async () => ({ state: 'signed in', user: 'ann@example.com' }),
  };
  return { io, out, err, calls, secrets, home };
}

const settings = (h: Harness) => JSON.parse(readFileSync(join(h.home, 'databases.json'), 'utf8'));
const shop = ['add', 'Shop', '--server', 'shop-sql.database.windows.net', '--database', 'Shop'];

test('add saves a database signed in with az, after a connection test, and says what comes next', async () => {
  const h = harness();
  assert.equal(await main(shop, h.io), 0);
  assert.deepEqual(settings(h).databases, [{ name: 'Shop', type: 'mssql', server: 'shop-sql.database.windows.net', database: 'Shop', signIn: 'az' }]);
  assert.deepEqual(h.calls, ['state az::@shop-sql.database.windows.net/Shop dbtour_reader'], 'connected once, to test');
  assert.match(h.out.join('\n'), /Added Shop[\s\S]*dbtour read Shop[\s\S]*dbtour reader Shop --create/);
  assert.equal(await main(shop, h.io), 1, 'a name already set up');
  assert.match(h.err.join('\n'), /Shop is set up already/);
});

test('a password is never taken from the command line, and an agent without one is told to ask', async () => {
  const h = harness();
  assert.equal(await main([...shop, '--sign-in', 'login', '--user', 'ann', '--password', 'hunter2'], h.io), 1);
  assert.match(h.err.join('\n'), /never on the command line[\s\S]*--password-stdin/);
  assert.equal(await main([...shop, '--sign-in', 'login', '--user', 'ann'], h.io), 2);
  assert.match(h.err.join('\n'), /--password-stdin[\s\S]*ask the person/);
  assert.equal(existsSync(join(h.home, 'databases.json')), false, 'nothing saved');
  assert.equal(h.calls.length, 0, 'nothing connected');
});

test('a login\'s password comes in on stdin and goes to the keychain, not the settings or the output', async () => {
  const h = harness({ stdin: 'p;w"d\n' });
  assert.equal(await main([...shop, '--sign-in', 'login', '--user', 'ann', '--password-stdin'], h.io), 0);
  assert.deepEqual([...h.secrets], [['Shop · login', 'p;w"d']]);
  assert.equal(settings(h).databases[0].user, 'ann');
  assert.doesNotMatch(readFileSync(join(h.home, 'databases.json'), 'utf8') + h.out.join('\n') + h.err.join('\n'), /p;w"d/);
});

test('a database that will not answer is not saved, and its password is not kept', async () => {
  const h = harness({ failTest: true, stdin: 'pw' });
  assert.equal(await main([...shop, '--sign-in', 'login', '--user', 'ann', '--password-stdin'], h.io), 1);
  assert.match(h.err.join('\n'), /Shop did not answer: Login failed for user\.[\s\S]*nothing was saved/);
  assert.equal(existsSync(join(h.home, 'databases.json')), false);
  assert.equal(h.secrets.size, 0);
});

test('reader --create shows the statements and changes nothing until the database is named again', async () => {
  const h = harness();
  await main(shop, h.io);
  h.out.length = 0;
  assert.equal(await main(['reader', 'Shop', '--create'], h.io), 3);
  const said = h.out.join('\n');
  assert.match(said, /changes Shop on shop-sql\.database\.windows\.net[\s\S]*CREATE USER \[dbtour_reader\] WITH PASSWORD = '••••••';[\s\S]*ALTER ROLE db_datareader ADD MEMBER \[dbtour_reader\];[\s\S]*--confirm Shop/);
  assert.equal(h.calls.filter((c) => c.startsWith('create')).length, 0, 'nothing created');
  assert.equal(await main(['reader', 'Shop', '--create', '--confirm', 'Logs'], h.io), 3, 'the wrong name confirms nothing');

  h.out.length = 0;
  assert.equal(await main(['reader', 'Shop', '--create', '--confirm', 'Shop'], h.io), 0);
  assert.deepEqual(h.calls.filter((c) => c.startsWith('create')), ['create az::@shop-sql.database.windows.net/Shop dbtour_reader same password']);
  const password = h.secrets.get('Shop · reader')!;
  assert.match(password, /^Aa1-[0-9a-f]{48}$/);
  assert.equal(settings(h).databases[0].reader, 'dbtour_reader');
  assert.doesNotMatch(h.out.join('\n') + h.err.join('\n'), new RegExp(password));
  assert.match(h.out.join('\n'), /dbtour_reader can read Shop and nothing else[\s\S]*keychain as "dbtour · Shop · reader"/);
});

test('a reader that could do more than read is refused', async () => {
  const h = harness({ exists: true, roles: ['db_datareader', 'db_owner'] });
  await main(shop, h.io);
  assert.equal(await main(['reader', 'Shop', '--create', '--confirm', 'Shop'], h.io), 1);
  assert.match(h.err.join('\n'), /dbtour_reader already has db_owner/);
  assert.equal(h.secrets.size, 0);
});

test('a reader of your own: its password on stdin, tested before it is kept', async () => {
  const h = harness({ stdin: 'readerpw' });
  await main(shop, h.io);
  assert.equal(await main(['reader', 'Shop', '--user', 'ro_login', '--password-stdin'], h.io), 0);
  assert.equal(h.secrets.get('Shop · reader'), 'readerpw');
  assert.equal(settings(h).databases[0].reader, 'ro_login');
  assert.ok(h.calls.some((c) => c === 'run login:ro_login:readerpw@shop-sql.database.windows.net/Shop SELECT 1 AS signedIn'));
});

test('read writes the model and the page into the database\'s own folder, and when', async () => {
  const h = harness();
  await main(shop, h.io);
  assert.equal(await main(['read', 'Shop'], h.io), 0);
  const folder = join(h.home, 'databases', 'Shop');
  assert.equal(JSON.parse(readFileSync(join(folder, 'schema.json'), 'utf8')).databases[0].name, 'Shop');
  assert.equal(readFileSync(join(folder, 'index.html'), 'utf8'), '<title>Shop</title>');
  assert.match(settings(h).databases[0].readAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('with several databases, sql and read must name one; list shows them and never a secret', async () => {
  const h = harness({ stdin: 'pw' });
  await main(shop, h.io);
  await main(['add', 'Logs', '--server', 'localhost,1433', '--database', 'Logs', '--sign-in', 'login', '--user', 'ann', '--password-stdin'], h.io);
  h.secrets.set('Shop · reader', 'readerpw');
  const saved = settings(h);
  saved.databases[0].reader = 'dbtour_reader';
  (await import('../src/workspace.ts')).writeWorkspace(h.home, saved);

  assert.equal(await main(['sql', 'SELECT 1'], h.io), 1);
  assert.match(h.err.join('\n'), /Several databases are set up: say which with --database Shop or --database Logs/);
  assert.equal(await main(['read'], h.io), 1);
  assert.equal(await main(['sql', 'SELECT TOP (1) Id FROM dbo.Orders', '--database', 'Shop'], h.io), 0);
  assert.ok(h.calls.some((c) => c === 'run login:dbtour_reader:readerpw@shop-sql.database.windows.net/Shop SELECT TOP (1) Id FROM dbo.Orders'));
  assert.equal(await main(['sql', 'SELECT 1', '--database', 'Logs'], h.io), 2, 'Logs has no reader');

  h.out.length = 0;
  assert.equal(await main(['list'], h.io), 0);
  const listed = h.out.join('\n');
  assert.match(listed, /Shop\s+mssql\s+shop-sql\.database\.windows\.net\/Shop\s+az\s+dbtour_reader/);
  assert.match(listed, /Logs\s+mssql\s+localhost,1433\/Logs\s+login ann\s+no reader/);
  assert.doesNotMatch(listed, /readerpw|\bpw\b/);
});

test('remove forgets a database and its passwords, keeps its folder, and says how to drop the reader', async () => {
  const h = harness();
  await main(shop, h.io);
  await main(['reader', 'Shop', '--create', '--confirm', 'Shop'], h.io);
  await main(['read', 'Shop'], h.io);
  assert.equal(await main(['remove', 'Shop'], h.io), 0);
  assert.deepEqual(settings(h).databases, []);
  assert.equal(h.secrets.size, 0);
  assert.ok(existsSync(join(h.home, 'databases', 'Shop', 'schema.json')), 'notes and pages are the user\'s to delete');
  assert.match(h.out.join('\n'), /DROP USER \[dbtour_reader\]/);
});

test('serve with databases set up and no dbtour.yaml here serves the home, and each database at /db/<name>/', async () => {
  const h = harness();
  await main(shop, h.io);
  await main(['read', 'Shop'], h.io);
  let stop!: () => void;
  const stopped = new Promise<void>((done) => (stop = done));
  h.out.length = 0;
  const serving = main(['serve', '--port', '0'], { ...h.io, stop: stopped });
  for (let waited = 0; !h.out.some((l) => l.startsWith('Serving')); waited += 20) {
    if (waited > 5000) assert.fail(`serve did not start: ${[...h.out, ...h.err].join(' / ')}`);
    await new Promise((next) => setTimeout(next, 20));
  }
  const url = /at (http:\/\/\S+)/.exec(h.out[0])![1];
  try {
    assert.match(h.out[0], /^Serving Shop at http:\/\/127\.0\.0\.1:\d+$/);
    const meta = (html: string) => JSON.parse(/<meta name="dbtour-serve" content="([^"]*)">/.exec(html)![1].replace(/&quot;/g, '"'));
    const front = meta(await (await fetch(`${url}/`)).text());
    assert.deepEqual(front.databases.map((d: { name: string; read: boolean; tables: number }) => [d.name, d.read, d.tables]), [['Shop', true, 6]]);
    assert.equal(await (await fetch(`${url}/db/Shop/`)).text().then((t) => t.includes('<title>Shop</title>')), true);
  } finally {
    stop();
    assert.equal(await serving, 0);
  }
});

/** dbtour serve, started for a test: its address, its token, the setup's steps posted as the page posts them, and stop. */
async function served(h: Harness, opened: string[] = []) {
  let stop!: () => void;
  const stopped = new Promise<void>((done) => (stop = done));
  const serving = main(['serve', '--port', '0'], { ...h.io, stop: stopped, open: (url) => void opened.push(url) });
  for (let waited = 0; !h.out.some((l) => l.startsWith('Serving')); waited += 20) {
    if (waited > 5000) assert.fail(`serve did not start: ${[...h.out, ...h.err].join(' / ')}`);
    await new Promise((next) => setTimeout(next, 20));
  }
  const url = /at (http:\/\/\S+)/.exec(h.out.find((l) => l.startsWith('Serving'))!)![1];
  const meta = (html: string) => JSON.parse(/<meta name="dbtour-serve" content="([^"]*)">/.exec(html)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const front = meta(await (await fetch(`${url}/`)).text());
  const step = (name: string, input: Record<string, unknown>) =>
    new Promise<{ status: number; json: Record<string, unknown>; text: string }>((done, fail) => {
      const headers = { host: new URL(url).host, origin: url, 'content-type': 'application/json', 'x-dbtour-token': front.token };
      const req = request(`${url}/api/setup/${name}`, { method: 'POST', headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          done({ status: res.statusCode ?? 0, json: JSON.parse(text), text });
        });
      });
      req.on('error', fail);
      req.end(JSON.stringify(input));
    });
  return {
    url,
    front,
    step,
    meta: async () => meta(await (await fetch(`${url}/`)).text()),
    stop: async () => {
      stop();
      assert.equal(await serving, 0);
    },
  };
}

const where = { name: 'Shop', type: 'mssql', server: 'shop-sql.database.windows.net', database: 'Shop' };

test('serve with nothing set up opens the home in the browser, and its setup takes a database from nothing to its page', async () => {
  const h = harness();
  const opened: string[] = [];
  const s = await served(h, opened);
  try {
    assert.deepEqual([s.front.databases, s.front.setup, opened], [[], true, [s.url + '/']]);
    assert.match(h.out.join('\n'), /Nothing is set up yet: the page at http:\/\/127\.0\.0\.1:\d+\/ walks you through it/);

    const state = await s.step('state', {});
    assert.deepEqual(state.json, { kinds: [{ type: 'mssql', name: 'SQL Server', installed: true }], keychain: true, az: { state: 'signed in', user: 'ann@example.com' }, names: [] });

    // 1, the database: checked here before anything connects.
    assert.equal((await s.step('check', where)).status, 200);
    const bad = await s.step('check', { ...where, name: '1 Shop' });
    assert.equal(bad.status, 422);
    assert.match(String(bad.json.error), /name/);
    assert.equal((await s.step('check', { ...where, server: 'x;Password=y' })).status, 422);
    assert.equal(h.calls.length, 0, 'nothing connected yet');

    // 2 and 3, the sign-in and its test: saved only once the database answers.
    const added = await s.step('add', { ...where, signIn: 'az' });
    const { log: addLog, ...addAnswer } = added.json as { log: string[] };
    assert.deepEqual([added.status, addAnswer], [200, { name: 'Shop', signIn: 'az', reader: { user: 'dbtour_reader', exists: false } }]);
    assert.deepEqual(addLog.slice(0, 2), ['It answered, signed in with az', 'dbtour_reader is not in the database yet']);
    assert.match(addLog[2], /^Saved Shop in .*databases\.json$/);
    assert.equal(settings(h).databases[0].name, 'Shop');
    assert.equal((await s.step('check', where)).status, 422, 'the name is taken now');

    // 4, the reader: shown first, made only when the page names the database again.
    const plan = await s.step('reader-plan', { name: 'Shop' });
    assert.deepEqual(plan.json, {
      log: ['Nothing has changed: the statements wait for your yes'],
      user: 'dbtour_reader',
      changes: 'Shop on shop-sql.database.windows.net, signed in with az',
      statements: ["CREATE USER [dbtour_reader] WITH PASSWORD = '••••••';", 'ALTER ROLE db_datareader ADD MEMBER [dbtour_reader];'],
      account: 'dbtour · Shop · reader',
    });
    const unconfirmed = await s.step('reader-create', { name: 'Shop' });
    assert.equal(unconfirmed.status, 422);
    assert.equal(h.calls.filter((c) => c.startsWith('create')).length, 0);
    const made = await s.step('reader-create', { name: 'Shop', confirm: 'Shop' });
    assert.deepEqual([made.status, made.json], [
      200,
      {
        name: 'Shop',
        reader: 'dbtour_reader',
        log: [
          "Ran CREATE USER [dbtour_reader] WITH PASSWORD = '••••••';",
          'Ran ALTER ROLE db_datareader ADD MEMBER [dbtour_reader];',
          'Signed in as dbtour_reader: it can read',
          'Kept its password in the keychain as "dbtour · Shop · reader"',
        ],
      },
    ]);
    assert.doesNotMatch(made.text, new RegExp(h.secrets.get('Shop · reader')!));

    // 5, the read: the model and its page, and the home lists it.
    const read = await s.step('read', { name: 'Shop' });
    assert.deepEqual([read.status, read.json.name, read.json.tables], [200, 'Shop', 6]);
    assert.match((read.json.log as string[]).join('\n'), /Wrote \d+ files/);
    const now = await s.meta();
    assert.deepEqual(now.databases.map((d: { name: string; read: boolean; reader: boolean }) => [d.name, d.read, d.reader]), [['Shop', true, true]]);
    assert.equal((await s.step('nonsense', {})).status, 404);
  } finally {
    await s.stop();
  }
});

test('the setup page sends a login\'s password once, to the keychain, and never gets it back', async () => {
  const h = harness();
  const s = await served(h);
  try {
    const none = await s.step('add', { ...where, signIn: 'login', user: 'ann' });
    assert.equal(none.status, 422);
    assert.match(String(none.json.error), /password/);
    const added = await s.step('add', { ...where, signIn: 'login', user: 'ann', password: 'p;w"d' });
    assert.equal(added.status, 200);
    assert.deepEqual([...h.secrets], [['Shop · login', 'p;w"d']]);
    const own = await s.step('reader-use', { name: 'Shop', user: 'ro_login', password: 'readerpw' });
    assert.deepEqual([own.status, own.json.reader], [200, 'ro_login']);
    assert.match((added.json.log as string[]).join('\n'), /Kept the login's password in the keychain as "dbtour · Shop · login"/);
    assert.ok(h.calls.includes('run login:ro_login:readerpw@shop-sql.database.windows.net/Shop SELECT 1 AS signedIn'));
    const everything = readFileSync(join(h.home, 'databases.json'), 'utf8') + added.text + own.text + JSON.stringify(await s.meta()) + h.out.join('\n');
    assert.doesNotMatch(everything, /p;w"d|readerpw/);
  } finally {
    await s.stop();
  }
});
