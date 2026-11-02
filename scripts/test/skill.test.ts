// The agent skill and the Claude Code plugin, held to the code they describe: the MCP tools it names are
// the server's, the commands are the command's, and every version is the packages' version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { main } from '../../packages/core/src/cli.ts';
// Never the machine's own ~/.dbtour: a folder of the test's, empty.
process.env.DBTOUR_HOME = mkdtempSync(join(tmpdir(), 'dbtour-home-'));
import { queryTool, toolList } from '../../packages/core/src/mcp.ts';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const version = JSON.parse(read('packages/core/package.json')).version;
const skill = read('skills/dbtour/SKILL.md');
const reference = read('skills/dbtour/reference.md');

/** The YAML between the opening --- lines. */
function frontmatter(text: string): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'SKILL.md opens with frontmatter');
  return parse(match[1]);
}

test('the skill is named dbtour, carries the packages\' version, and its description fits the limit', () => {
  const meta = frontmatter(skill);
  assert.equal(meta.name, 'dbtour');
  assert.equal(meta.metadata.version, version);
  assert.ok(meta.description.length > 100 && meta.description.length <= 1024, `the description is ${meta.description.length} characters; Agent Skills allows 1024`);
  assert.match(meta.description, /SQL/, 'it says it is for writing SQL, so it loads before a query is written');
});

test('the skill names every tool the MCP server has, and no other', () => {
  for (const { name } of toolList) {
    assert.match(skill, new RegExp(`\`${name}\``), `SKILL.md names the ${name} tool`);
    assert.match(reference, new RegExp(`\\*\\*${name}\\*\\*`), `reference.md names the ${name} tool`);
  }
  const named = /tools are ((?:`\w+`(?:, | and )?)+)/.exec(skill)?.[1].match(/`(\w+)`/g)?.map((n) => n.slice(1, -1));
  assert.deepEqual(named, toolList.map((t) => t.name));
});

test('every command the skill and its reference run is one dbtour has', async () => {
  const out: string[] = [];
  await main(['--help'], { cwd: process.cwd(), log: (s: string) => out.push(s), error: () => {} });
  const commands = new Set([...out.join('\n').matchAll(/^ {2}(\w+)/gm)].map((m) => m[1]));
  const used = [...`${skill}\n${reference}`.matchAll(/npx dbtour (\w+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 4);
  for (const command of used) assert.ok(commands.has(command), `dbtour has no ${command} command`);
});

test('what the skill links to is there', () => {
  for (const [, target] of skill.matchAll(/\]\(([^)#]+)\)/g)) {
    if (!/^https?:/.test(target)) assert.ok(existsSync(new URL(`skills/dbtour/${target}`, root)), `${target} is missing`);
  }
});

test('the plugin and its marketplace carry the version and start the MCP server', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'dbtour');
  assert.equal(plugin.version, version);
  assert.deepEqual(plugin.mcpServers, { dbtour: { command: 'npx', args: ['-y', 'dbtour', 'mcp'] } });
  assert.ok(existsSync(new URL(plugin.icon, root)), `the icon ${plugin.icon} is drawn by npm run brand`);
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(market.name, 'dbtour');
  assert.deepEqual(market.plugins.map((p: { name: string; source: string }) => [p.name, p.source]), [['dbtour', './']]);
});

test('the setup installs all three packages before init, since npx alone fetches only the command', () => {
  const install = skill.indexOf('npm install --save-dev dbtour dbtour-source-mssql dbtour-addon-explorer');
  assert.ok(install !== -1, 'SKILL.md installs the source and the page with the command');
  assert.ok(install < skill.indexOf('npx dbtour init'), 'before init');
  assert.doesNotMatch(reference, /or run them with `npx`/);
});

test('every eval\'s frontmatter is YAML a runner can read', () => {
  for (const name of readdirSync(new URL('evals/', root), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'results')) {
    const files = [`evals/${name.name}/prompt.md`, ...readdirSync(new URL(`evals/${name.name}/graders/`, root)).map((g) => `evals/${name.name}/graders/${g}`)];
    for (const file of files) assert.doesNotThrow(() => frontmatter(read(file)), file);
  }
});

test('the skill says how to run a query: the query tool and dbtour sql, through a reader, never asking for a login', () => {
  assert.match(skill, new RegExp(`\`${queryTool.name}\``), 'SKILL.md names the query tool');
  assert.match(skill, /npx dbtour sql/);
  assert.match(skill, /`reader`/);
  assert.match(skill, /model provider/, 'it says where the rows go');
  assert.doesNotMatch(skill, /does not run queries yet/);
  assert.match(reference, /db_datareader/, 'reference.md shows how to make a reader login');
  assert.match(reference, new RegExp(`\\*\\*${queryTool.name}\\*\\*`));
});
