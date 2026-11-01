// dbtour serve: the rendered folder on this machine, and the one door the page has to the database. The page
// runs a query by posting it here, and it runs as dbtour sql does: checked, through the source's reader, in a
// transaction that is rolled back. Only this machine can reach it (127.0.0.1), and only this server's own
// page can ask: the request must carry the session's token, which the page is given when served, and say it
// comes from this server (Host and Origin), so another website, or a name rebound to this address, cannot.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { QueryResult } from './sql.ts';

/** A database set up on this machine, as the home lists it and the rail's switcher names it: no secret. */
export interface ServedDatabase {
  name: string;
  /** The source's type: mssql. */
  driver: string;
  server: string;
  database: string;
  reader: boolean;
  /** Whether its page has been written (dbtour read). */
  read: boolean;
  tables?: number;
  bytes?: number;
  readAt?: string;
}

export interface Served {
  /** The folder render wrote: index.html and the Markdown beside it; with `home`, the folder of databases. */
  root: string;
  /** 0 for any free port. */
  port: number;
  /** The session's secret, given to the page in a meta tag and required on every query. */
  token: string;
  /** The sources, and whether each has a reader: what the page shows, never a connection string. */
  sources: { name: string; reader: boolean }[];
  /** Runs one query through a source's reader (with `home`, the database's); absent when none has one. */
  run?: (sql: string, source: string | undefined, limit: number | undefined, database?: string) => Promise<QueryResult & { source: string }>;
  /**
   * Several databases set up on this machine: `/` is the home that lists them, each database's page is at
   * /db/<name>/ from its folder under `root`, and its queries go to /db/<name>/api/query, so a page can only
   * ask of its own database. Read on every request, so a database read since shows.
   */
  home?: { html: string; databases: () => ServedDatabase[] };
}

/** The address it listens on: this machine alone. */
export const serveHost = '127.0.0.1';

/** A query and its options are a few lines; anything past this is not one, and is refused unread. */
const maxBodyBytes = 100 * 1024;

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export async function startServer(options: Served): Promise<{ url: string; close: () => Promise<void> }> {
  let origins: Set<string> = new Set();
  let hosts: Set<string> = new Set();
  const server = createServer((request, response) => {
    handle(request, response, options, hosts, origins).catch((error: unknown) => send(response, 500, { error: error instanceof Error ? error.message : String(error) }));
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port, serveHost, () => done());
  });
  const port = (server.address() as { port: number }).port;
  hosts = new Set([`${serveHost}:${port}`, `localhost:${port}`]);
  origins = new Set([...hosts].map((h) => `http://${h}`));
  return {
    url: `http://${serveHost}:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, options: Served, hosts: Set<string>, origins: Set<string>): Promise<void> {
  // Every route, not only the query: the page carries the token and the model, and the Markdown and
  // schema.json are the schema, none of it for a site whose name was rebound to this address.
  if (!hosts.has(request.headers.host ?? '')) {
    return send(response, 403, { error: 'Open the page at the address dbtour serve printed: this server answers only to its own name.' });
  }
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
  if (!options.home) {
    if (path === '/api/query') return query(request, response, options, hosts, origins);
    return file(request, response, options.root, path, { token: options.token, sources: options.sources });
  }
  const databases = options.home.databases();
  if (path === '/' || path === '/index.html') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Only the page and its files are here: GET them.' });
    response.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
    return void response.end(request.method === 'HEAD' ? undefined : withServe(options.home.html, { token: options.token, sources: [], databases }));
  }
  const match = /^\/db\/([^/]+)(\/.*)?$/.exec(path);
  const database = match && databases.find((d) => d.name === match[1]);
  if (!match || !database) return send(response, 404, { error: 'Not here: open the home, at /, for the databases set up.' });
  // Without its slash the page's relative links (its query, its files) would leave the database's folder.
  if (match[2] === undefined) {
    response.writeHead(301, { location: `/db/${encodeURIComponent(database.name)}/` });
    return void response.end();
  }
  if (match[2] === '/api/query') return query(request, response, options, hosts, origins, database.name);
  return file(request, response, join(options.root, database.name), match[2], {
    token: options.token,
    sources: [{ name: database.name, reader: database.reader }],
    databases,
    current: database.name,
  });
}

/** What the page is told when it is served: the token, which sources can run a query, and on a home the databases. */
interface Meta {
  token: string;
  sources: { name: string; reader: boolean }[];
  databases?: ServedDatabase[];
  current?: string;
}

/** A file under `root`, never outside it however the path is written; its index.html told it is served. */
function file(request: IncomingMessage, response: ServerResponse, root: string, path: string, meta: Meta): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Only the page and its files are here: GET them.' });
  const found = resolve(root, normalize(`.${path === '/' ? '/index.html' : path}`));
  if (found !== resolve(root) && !found.startsWith(resolve(root) + sep)) return send(response, 404, { error: 'Not here.' });
  if (!existsSync(found) || !statSync(found).isFile()) return send(response, 404, { error: 'Not here.' });
  let body: string | Buffer = readFileSync(found);
  if (found === join(resolve(root), 'index.html')) body = withServe(body.toString('utf8'), meta);
  response.writeHead(200, { 'content-type': types[extname(found)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : body);
}

/** The page, told it is served: the token to send with a query, and which sources can run one. */
function withServe(html: string, told: Meta): string {
  const value = JSON.stringify(told).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const meta = `<meta name="dbtour-serve" content="${value}">`;
  return html.includes('</head>') ? html.replace('</head>', `${meta}</head>`) : meta + html;
}

async function query(request: IncomingMessage, response: ServerResponse, options: Served, hosts: Set<string>, origins: Set<string>, database?: string): Promise<void> {
  if (request.method !== 'POST') return send(response, 405, { error: 'POST a query: {"sql": "SELECT …"}.' });
  // The page's own requests name this server; anything else is another site, or a name rebound to this address.
  const origin = request.headers.origin;
  if (!hosts.has(request.headers.host ?? '') || (origin !== undefined && !origins.has(origin)) || request.headers['x-dbtour-token'] !== options.token) {
    return send(response, 403, { error: 'Only the page dbtour serve gave out can run a query here: open it again from the address dbtour serve printed.' });
  }
  const text = await body(request);
  if (text === undefined) return send(response, 413, { error: 'That is more than a query: send one SELECT.' });
  let asked: unknown;
  try {
    asked = JSON.parse(text);
  } catch {
    asked = undefined;
  }
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked) || typeof (asked as { sql?: unknown }).sql !== 'string') {
    return send(response, 400, { error: 'Send {"sql": "SELECT …"}, with source and limit if you want them.' });
  }
  const { sql, source, limit } = asked as { sql: string; source?: unknown; limit?: unknown };
  if (!options.run) {
    return send(response, 422, { error: 'This page can be read, but no source has a reader, so a query cannot run here: add reader: ${DBTOUR_MSSQL_READER} to a source in dbtour.yaml and start dbtour serve again.' });
  }
  const started = Date.now();
  try {
    const result = await options.run(sql, typeof source === 'string' ? source : undefined, typeof limit === 'number' ? limit : undefined, database);
    send(response, 200, { ...result, ms: Date.now() - started });
  } catch (error) {
    send(response, 422, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * The request's body, or nothing when it is larger than any query. Past the limit the rest is read and
 * dropped, not kept, so the connection stays open for the 413 that says why.
 */
function body(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBodyBytes) chunks.push(chunk);
    });
    request.on('end', () => done(size > maxBodyBytes ? undefined : Buffer.concat(chunks).toString('utf8')));
    request.on('error', fail);
  });
}

/** JSON, with a date as ISO and bytes as hex, as dbtour sql --json writes them. */
function send(response: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && (v as { type?: string }).type === 'Buffer') return `0x${Buffer.from((v as { data: number[] }).data).toString('hex')}`;
    return v;
  });
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}
