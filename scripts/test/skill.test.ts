// The agent skill and the Claude Code plugin, held to the code they describe: the MCP tools it names are
// the server's, the commands are the command's, and every version is the packages' version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { main } from '../../packages/core/src/cli.ts';
import { toolList } from '../../packages/core/src/mcp.ts';

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
