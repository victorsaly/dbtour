// scripts/release.mjs against a throwaway repository with a bare origin, and npm and gh replaced by stubs
// that write down how they were called, so nothing reaches GitHub or the registry. The npm stub answers
// `npm view name@version` from a list of what is "on the registry", with E404 for the rest as npm does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../release.mjs', import.meta.url);
const identity = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };

const changelog = `# Changelog

## 0.2.20 (unreleased)

- Not this one.

## 0.2.2 (unreleased)

- This one.

## 0.2.1 (1 November 2026)

- Nor this.
`;

const names = { core: 'dbtour', 'source-mssql': 'dbtour-source-mssql', 'addon-explorer': 'dbtour-addon-explorer' };

/** A repository at 0.2.2 whose main is pushed to a bare origin, with stub npm and gh on the PATH. */
function repository({ published = [] as string[], registryDown = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-release-'));
  const work = join(root, 'work');
  const origin = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const calls = join(root, 'calls.log');
  const registry = join(root, 'registry');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env: { ...process.env, ...identity }, encoding: 'utf8' }).trim();

  mkdirSync(join(work, 'scripts'), { recursive: true });
  copyFileSync(script, join(work, 'scripts/release.mjs'));
  for (const [pkg, name] of Object.entries(names)) {
    mkdirSync(join(work, 'packages', pkg), { recursive: true });
    writeFileSync(join(work, 'packages', pkg, 'package.json'), JSON.stringify({ name, version: '0.2.2' }));
  }
  writeFileSync(join(work, 'CHANGELOG.md'), changelog);
  mkdirSync(bin);
  writeFileSync(registry, published.map((spec) => `${spec}\n`).join(''));
  const view = registryDown
    ? 'echo "npm error code ENOTFOUND" >&2; exit 1'
    : `if grep -qx "$2" "${registry}"; then echo "\${2##*@}"; else echo "npm error code E404" >&2; exit 1; fi`;
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "npm $*" >> "${calls}"\nif [ "$1" = view ]; then ${view}; fi\n`);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "gh $*" >> "${calls}"\n`);
  for (const tool of ['npm', 'gh']) chmodSync(join(bin, tool), 0o755);

  execFileSync('git', ['init', '-q', '--bare', origin]);
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'first');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');

  const release = (...args: string[]) => {
    const env = { ...process.env, ...identity, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: join(root, 'output') };
    const result = spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd: work, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const called = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '');
  return { root, git, release, called };
}

/** The workspaces npm was asked to publish, in order. */
const publishes = (called: string) => [...called.matchAll(/^npm publish --workspace (\S+)/gm)].map((m) => m[1]).join(' ');

/** A repository whose v0.2.2 is tagged on origin, as the workflow leaves it. */
function tagged(options: Parameters<typeof repository>[0] = {}) {
  const repo = repository(options);
  repo.git('tag', '-a', 'v0.2.2', '-m', 'dbtour 0.2.2');
  repo.git('push', '-q', 'origin', 'v0.2.2');
  return repo;
}

test('--check takes the notes from its own version, not one it is a prefix of', () => {
  const repo = repository();
  assert.equal(repo.release('--check').status, 0);
  const output = readFileSync(join(repo.root, 'output'), 'utf8');
  assert.match(output, /^new=true$/m);
  const notes = readFileSync(/^notes=(.*)$/m.exec(output)![1], 'utf8');
  assert.equal(notes, '- This one.\n');
});

test('--publish on a new version tags, releases and publishes, and exits 0', () => {
  const repo = repository();
  const result = repo.release('--publish');
  assert.equal(result.status, 0, result.stderr);
  assert.match(repo.git('ls-remote', '--tags', 'origin'), /refs\/tags\/v0\.2\.2/);
  assert.match(repo.called(), /^gh release create v0\.2\.2/m);
  assert.equal(publishes(repo.called()), 'packages/core packages/source-mssql packages/addon-explorer');
});

test('--publish on a version the workflow already tagged publishes it, without a second release', () => {
  const repo = tagged();
  const result = repo.release('--publish');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(repo.called(), /^gh /m);
  assert.equal(publishes(repo.called()), 'packages/core packages/source-mssql packages/addon-explorer');
});

test('--publish on a tagged version refuses when the checkout is not that tag', () => {
  const repo = tagged();
  repo.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'later');
  const result = repo.release('--publish');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git checkout v0\.2\.2/);
  assert.equal(repo.called(), '');
});

test('a tagged version without --publish is nothing to do: exit 3, and it says how to publish', () => {
  const repo = tagged();
  const result = repo.release();
  assert.equal(result.status, 3);
  assert.match(result.stderr, /never moved/);
  assert.match(result.stderr, /npm run release -- --publish/);
});

test('--publish after a publish that stopped part way publishes only the packages npm does not have', () => {
  const repo = tagged({ published: ['dbtour@0.2.2'] });
  const result = repo.release('--publish');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(publishes(repo.called()), 'packages/source-mssql packages/addon-explorer');
  assert.match(result.stdout, /dbtour@0\.2\.2 is on npm already/);
});

test('--publish when npm has every package is nothing to do: exit 3', () => {
  const repo = tagged({ published: ['dbtour@0.2.2', 'dbtour-source-mssql@0.2.2', 'dbtour-addon-explorer@0.2.2'] });
  const result = repo.release('--publish');
  assert.equal(result.status, 3);
  assert.equal(publishes(repo.called()), '');
});

test('--publish stops before publishing anything when npm cannot be asked', () => {
  const repo = tagged({ registryDown: true });
  const result = repo.release('--publish');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not ask npm whether dbtour@0\.2\.2/);
  assert.equal(publishes(repo.called()), '');
});
