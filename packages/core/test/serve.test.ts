import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type Served } from '../src/serve.ts';

/** A rendered folder: the page, its Markdown, and a file outside it that must never be served. */
function folder(): string {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-serve-'));
  const out = join(root, 'docs');
  mkdirSync(join(out, 'tables'), { recursive: true });
  writeFileSync(join(out, 'index.html'), '<!doctype html><html><head><title>Shop</title></head><body></body></html>');
  writeFileSync(join(out, 'README.md'), '# Shop\n');
  writeFileSync(join(out, 'tables', 'dbo.Orders.md'), '# dbo.Orders\n');
  writeFileSync(join(root, 'secret.txt'), 'not for the browser');
  return out;
}

async function serve(run?: Served['run']): Promise<{ url: string; close: () => Promise<void>; token: string }> {
  const token = 'tok-123';
  const server = await startServer({ root: folder(), port: 0, token, sources: [{ name: 'Shop', reader: true }, { name: 'Logs', reader: false }], run });
  return { ...server, token };
}

const ask = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => fetch(url, init);

/**
 * A POST with its headers exactly as written: fetch drops Host and Origin, as a browser would, so a request
 * from another site, or to a name rebound to this address, is built by hand.
 */
function raw(url: string, headers: Record<string, string>, body: string, method = 'POST'): Promise<number> {
  return new Promise((done, fail) => {
    const req = request(url, { method, headers }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on('error', fail);
    req.end(body);
  });
}

test('the page is served with the session token and the sources, never a connection string', async () => {
  const { url, close } = await serve();
  try {
    const page = await ask(`${url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    const meta = /<meta name="dbtour-serve" content="([^"]*)">/.exec(html);
    assert.ok(meta, 'the page carries what it needs to run queries');
    assert.deepEqual(JSON.parse(meta[1].replace(/&quot;/g, '"')), { token: 'tok-123', sources: [{ name: 'Shop', reader: true }, { name: 'Logs', reader: false }] });
    assert.match(html, /<meta name="dbtour-serve"[^>]*>\s*<\/head>/, 'in the head');
    assert.equal((await ask(`${url}/README.md`)).status, 200);
    assert.equal(await (await ask(`${url}/tables/dbo.Orders.md`)).text(), '# dbo.Orders\n');
    assert.equal((await ask(`${url}/../secret.txt`)).status, 404, 'nothing outside the folder');
    assert.equal((await ask(`${url}/%2e%2e/secret.txt`)).status, 404);
    assert.equal((await ask(`${url}/nope.md`)).status, 404);
  } finally {
    await close();
  }
});

test('a query runs only with the token, from this server\'s own page, and answers with the rows or why not', async () => {
  const asked: [string, string | undefined, number | undefined][] = [];
  const { url, close, token } = await serve(async (sql, source, limit) => {
    asked.push([sql, source, limit]);
    if (sql.includes('Nope')) throw new Error("Invalid object name 'dbo.Nope'.");
    return { columns: ['Id'], rows: [[1], [2]], truncated: false, limit: limit ?? 100, source: source ?? 'Shop' };
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    ask(`${url}/api/query`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': token, ...headers }, body: JSON.stringify(body) });
  try {
    const ok = await post({ sql: 'SELECT Id FROM dbo.Orders', source: 'Shop', limit: 10 });
    assert.equal(ok.status, 200);
    const result = (await ok.json()) as { columns: string[]; rows: unknown[][]; source: string; ms: number };
    assert.deepEqual([result.columns, result.rows, result.source], [['Id'], [[1], [2]], 'Shop']);
    assert.equal(typeof result.ms, 'number');
    assert.deepEqual(asked, [['SELECT Id FROM dbo.Orders', 'Shop', 10]]);

    const failed = await post({ sql: 'SELECT * FROM dbo.Nope' });
    assert.equal(failed.status, 422);
    assert.match(((await failed.json()) as { error: string }).error, /Invalid object name/);

    // No token, another site's page, or a name that only points here (DNS rebinding): refused, never run.
    assert.equal((await post({ sql: 'SELECT 1' }, { 'x-dbtour-token': 'wrong' })).status, 403);
    const port = new URL(url).port;
    const json = { 'content-type': 'application/json', 'x-dbtour-token': token };
    assert.equal(await raw(`${url}/api/query`, { ...json, host: `127.0.0.1:${port}`, origin: 'https://evil.example' }, '{"sql":"SELECT 1"}'), 403, 'another site');
    assert.equal(await raw(`${url}/api/query`, { ...json, host: `evil.example:${port}` }, '{"sql":"SELECT 1"}'), 403, 'a name rebound here');
    assert.equal(await raw(`${url}/api/query`, { ...json, host: `localhost:${port}`, origin: `http://localhost:${port}` }, '{"sql":"SELECT 2"}'), 200, 'the page opened as localhost');
    assert.equal(asked.length, 3, 'none of the refused requests reached the database');

    assert.equal((await ask(`${url}/api/query`)).status, 405);
    assert.equal((await post('not an object')).status, 400);
  } finally {
    await close();
  }
});

test('without a reader the server still serves the page, and says a query cannot run here', async () => {
  const { url, close, token } = await serve(undefined);
  try {
    const answer = await ask(`${url}/api/query`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': token }, body: '{"sql":"SELECT 1"}' });
    assert.equal(answer.status, 422);
    assert.match(((await answer.json()) as { error: string }).error, /no source has a reader/);
  } finally {
    await close();
  }
});

test('the review: a name rebound to this address gets nothing, not even the page, and a body too large is answered', async () => {
  const { url, close, token } = await serve(async () => ({ columns: [], rows: [], truncated: false, limit: 100, source: 'Shop' }));
  try {
    const port = new URL(url).port;
    // The page carries the token and the model; schema.json and the Markdown are the schema too.
    assert.equal(await raw(`${url}/`, { host: `evil.example:${port}` }, '', 'GET'), 403, 'the page');
    assert.equal(await raw(`${url}/README.md`, { host: `evil.example:${port}` }, '', 'GET'), 403, 'the Markdown');
    assert.equal(await raw(`${url}/`, { host: `localhost:${port}` }, '', 'GET'), 200, 'opened as localhost');
    // Refused with its reason, not a connection reset the page would take for a server that stopped.
    const answer = await fetch(`${url}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dbtour-token': token },
      body: JSON.stringify({ sql: `SELECT '${'x'.repeat(200 * 1024)}'` }),
    });
    assert.equal(answer.status, 413);
    assert.match(((await answer.json()) as { error: string }).error, /more than a query/);
  } finally {
    await close();
  }
});

test('several databases: the home lists them, each page is its own folder and asks only of its own database', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dbtour-home-'));
  writeFileSync(join(home, 'databases.json'), '{"databases":[]}');
  const root = join(home, 'databases');
  for (const name of ['Shop', 'Logs']) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'index.html'), `<html><head><title>${name}</title></head></html>`);
    writeFileSync(join(root, name, 'README.md'), `# ${name}\n`);
  }
  const databases = [
    { name: 'Shop', driver: 'mssql', server: 'shop.example', database: 'Shop', reader: true, read: true, tables: 6 },
    { name: 'Logs', driver: 'mssql', server: 'logs.example', database: 'Logs', reader: false, read: true },
  ];
  const asked: (string | undefined)[] = [];
  const server = await startServer({
    root,
    port: 0,
    token: 'tok',
    sources: [],
    home: { html: '<html><head><title>dbtour</title></head></html>', databases: () => databases },
    run: async (sql, source, limit, database) => {
      asked.push(database);
      return { columns: ['ok'], rows: [[1]], truncated: false, limit: 1, source: database ?? '' };
    },
  });
  const meta = (html: string) => JSON.parse(/<meta name="dbtour-serve" content="([^"]*)">/.exec(html)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  try {
    const front = await fetch(`${server.url}/`);
    assert.deepEqual(meta(await front.text()), { token: 'tok', sources: [], databases });
    const shop = meta(await (await fetch(`${server.url}/db/Shop/`)).text());
    assert.deepEqual([shop.current, shop.sources], ['Shop', [{ name: 'Shop', reader: true }]]);
    assert.equal(await (await fetch(`${server.url}/db/Logs/README.md`)).text(), '# Logs\n');
    // Without the slash its relative links would leave the folder, so it is sent to the one with it.
    const bare = await fetch(`${server.url}/db/Shop`, { redirect: 'manual' });
    assert.deepEqual([bare.status, bare.headers.get('location')], [301, '/db/Shop/']);
    // The settings, another folder, a database not set up: none of it.
    assert.equal((await fetch(`${server.url}/databases.json`)).status, 404);
    // Encoded slashes reach the server as ../../databases.json under Shop's folder: still not out of it.
    assert.equal((await fetch(`${server.url}/db/Shop/..%2f..%2fdatabases.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/db/Billing/`)).status, 404);
    // A query from Shop's page runs in Shop; there is no query door outside a database.
    const post = (path: string) => fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dbtour-token': 'tok' }, body: '{"sql":"SELECT 1"}' });
    assert.equal((await post('/db/Shop/api/query')).status, 200);
    assert.equal((await post('/api/query')).status, 404);
    assert.deepEqual(asked, ['Shop']);
  } finally {
    await server.close();
  }
});

/** A POST as a browser sends it, Origin and all, and what came back. */
function posted(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const req = request(url, { method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

test('the home\'s setup: each step a POST from this server\'s own page, with the token, answered or told why not', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-setup-'));
  const steps: [string, unknown][] = [];
  const server = await startServer({
    root,
    port: 0,
    token: 'tok',
    sources: [],
    home: {
      html: '<html><head></head></html>',
      databases: () => [],
      setup: async (step, input) => {
        steps.push([step, input]);
        if (step === 'add') throw new Error('Shop did not answer: Login failed.');
        return { ok: true };
      },
    },
  });
  const host = new URL(server.url).host;
  const page = { host, origin: server.url, 'content-type': 'application/json', 'x-dbtour-token': 'tok' };
  try {
    const front = await (await fetch(`${server.url}/`)).text();
    assert.match(front, /&quot;setup&quot;:true/, 'the page is told it can set up');
    assert.deepEqual(await posted(`${server.url}/api/setup/check`, page, '{"name":"Shop"}'), { status: 200, json: { ok: true } });
    assert.deepEqual(await posted(`${server.url}/api/setup/add`, page, '{"name":"Shop"}'), { status: 422, json: { error: 'Shop did not answer: Login failed.' } });
    // Without the token, from another site, or with no Origin at all (not a browser's page): refused unread.
    assert.equal((await posted(`${server.url}/api/setup/check`, { ...page, 'x-dbtour-token': 'nope' }, '{}')).status, 403);
    assert.equal((await posted(`${server.url}/api/setup/check`, { ...page, origin: 'https://evil.example' }, '{}')).status, 403);
    const noOrigin: Record<string, string> = { ...page };
    delete noOrigin.origin;
    assert.equal((await posted(`${server.url}/api/setup/check`, noOrigin, '{}')).status, 403);
    assert.equal((await posted(`${server.url}/api/setup/check`, page, '[1]')).status, 400);
    assert.equal((await fetch(`${server.url}/api/setup/check`)).status, 405);
    assert.deepEqual(steps, [['check', { name: 'Shop' }], ['add', { name: 'Shop' }]]);
  } finally {
    await server.close();
  }
});

test('a project\'s page has no setup: it is set up in dbtour.yaml', async () => {
  const { url, close, token } = await serve();
  try {
    const host = new URL(url).host;
    const answer = await posted(`${url}/api/setup/check`, { host, origin: url, 'content-type': 'application/json', 'x-dbtour-token': token }, '{}');
    assert.equal(answer.status, 404);
  } finally {
    await close();
  }
});
