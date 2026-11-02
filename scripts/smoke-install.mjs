// What a user gets: packs the three packages, installs the tarballs into an empty project, and runs dbtour
// from there on the shop example. Catches a package that ships something Node will not run, which the
// repository's own tests, importing src/ directly, never see. Run by `npm run smoke` and by CI.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'dbtour-smoke-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

// Pack each package into the scratch folder; prepack builds dist/ on the way.
const tarballs = [];
for (const pkg of ['core', 'keychain', 'source-mssql', 'addon-explorer']) {
  const out = run('npm', ['pack', '--pack-destination', scratch, '--silent'], join(repo, 'packages', pkg)).trim();
  tarballs.push(join(scratch, out.split('\n').pop()));
}

// An empty project that depends on the tarballs, as a user's would on the registry.
const project = join(scratch, 'project');
cpSync(join(repo, 'examples/shop'), project, { recursive: true });
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'smoke', private: true }, null, 2));
run('npm', ['install', '--no-audit', '--no-fund', '--silent', ...tarballs], project);

const help = run('npx', ['dbtour', '--help'], project);
if (!help.includes('Usage: dbtour')) throw new Error(`dbtour --help did not print its usage:\n${help}`);

// render reads the example's schema.json and notes, and the explorer add-on writes the page.
const rendered = run('npx', ['dbtour', 'render'], project);
const page = join(project, 'docs/index.html');
if (!existsSync(page)) throw new Error(`render did not write docs/index.html:\n${rendered}`);
const html = readFileSync(page, 'utf8');
if (!html.includes('dbo.Orders')) throw new Error('the page does not hold the model');
const tables = readdirSync(join(project, 'docs/tables'));
if (tables.length !== 6) throw new Error(`expected 6 table pages, got ${tables.length}`);

// mcp answers an agent on stdin and stdout: ask it for a table, as Claude would.
const request = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const answers = execFileSync('npx', ['dbtour', 'mcp'], {
  cwd: project,
  input: [request(1, 'initialize', { protocolVersion: '2025-11-25' }), request(2, 'tools/call', { name: 'table', arguments: { ref: 'dbo.Orders' } })].join('\n') + '\n',
  stdio: ['pipe', 'pipe', 'inherit'],
}).toString().trim().split('\n').map((line) => JSON.parse(line));
if (!answers[1]?.result?.content?.[0]?.text?.includes('# dbo.Orders')) throw new Error(`dbtour mcp did not answer with the table:\n${JSON.stringify(answers, null, 2)}`);

// The keychain package loads its prebuilt binary for this system; list, with nothing set up, says what to do.
run('node', ['--input-type=module', '-e', "const { store } = await import('dbtour-keychain'); if (typeof store.get !== 'function') process.exit(1);"], project);
const listed = execFileSync('npx', ['dbtour', 'list'], { cwd: project, env: { ...process.env, DBTOUR_HOME: join(scratch, 'home') }, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
if (!listed.includes('No database is set up yet')) throw new Error(`dbtour list did not say none is set up:\n${listed}`);

console.log(`Installed ${tarballs.length} tarballs into ${project}; dbtour --help, render, mcp and list work, and the keychain loads.`);
