// scripts/release.mjs against a throwaway repository with a bare origin, and npm and gh replaced by stubs
// that write down how they were called, so nothing reaches GitHub or the registry.
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

/** A repository at 0.2.2 whose main is pushed to a bare origin, with stub npm and gh on the PATH. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'dbtour-release-'));
  const work = join(root, 'work');
  const origin = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const calls = join(root, 'calls.log');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env: { ...process.env, ...identity }, encoding: 'utf8' }).trim();

  mkdirSync(join(work, 'scripts'), { recursive: true });
  copyFileSync(script, join(work, 'scripts/release.mjs'));
  for (const pkg of ['core', 'source-mssql', 'addon-explorer']) {
    mkdirSync(join(work, 'packages', pkg), { recursive: true });
    writeFileSync(join(work, 'packages', pkg, 'package.json'), JSON.stringify({ version: '0.2.2' }));
  }
  writeFileSync(join(work, 'CHANGELOG.md'), changelog);
  mkdirSync(bin);
  for (const tool of ['npm', 'gh']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${calls}"\n`);
    chmodSync(join(bin, tool), 0o755);
  }

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
  assert.match(repo.called(), /^npm publish --workspace packages\/core/m);
});

test('--publish on a version the workflow already tagged publishes it, without a second release', () => {
  const repo = repository();
  repo.git('tag', '-a', 'v0.2.2', '-m', 'dbtour 0.2.2');
  repo.git('push', '-q', 'origin', 'v0.2.2');
  const result = repo.release('--publish');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(repo.called(), /^gh /m);
  assert.match(repo.called(), /^npm publish --workspace packages\/core/m);
});

test('--publish on a tagged version refuses when the checkout is not that tag', () => {
  const repo = repository();
  repo.git('tag', '-a', 'v0.2.2', '-m', 'dbtour 0.2.2');
  repo.git('push', '-q', 'origin', 'v0.2.2');
  repo.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'later');
  const result = repo.release('--publish');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /git checkout v0\.2\.2/);
  assert.equal(repo.called(), '');
});

test('a tagged version without --publish is nothing to do: exit 3, and it says how to publish', () => {
  const repo = repository();
  repo.git('tag', '-a', 'v0.2.2', '-m', 'dbtour 0.2.2');
  repo.git('push', '-q', 'origin', 'v0.2.2');
  const result = repo.release();
  assert.equal(result.status, 3);
  assert.match(result.stderr, /never moved/);
  assert.match(result.stderr, /npm run release -- --publish/);
});
