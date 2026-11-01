// Releases what main holds: the version in packages/core/package.json becomes a tag and a GitHub release
// whose notes are that version's changelog section, then the three packages go to npm.
//
//   node scripts/release.mjs --check     say whether the version is unreleased; in GitHub Actions, write the
//                                        outputs `version`, `new` and `notes` for the release workflow
//   node scripts/release.mjs             tag, push the tag and create the release, from a clean, current main
//   node scripts/release.mjs --publish   the same, then publish the packages (needs npm login with 2FA)
//
// The workflow in .github/workflows/release.yml runs this on every push to main, so by hand is for when
// the workflow could not. A tag that exists is never moved: a new version means a new patch.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const run = (command, cmdArgs, options = {}) => execFileSync(command, cmdArgs, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const version = JSON.parse(readFileSync(join(repo, 'packages/core/package.json'), 'utf8')).version;
const tag = `v${version}`;
for (const pkg of ['source-mssql', 'addon-explorer']) {
  const other = JSON.parse(readFileSync(join(repo, `packages/${pkg}/package.json`), 'utf8')).version;
  if (other !== version) fail(`packages/${pkg} is ${other} but core is ${version}: every package carries the same version. Bump them together, then run it again.`);
}

/** The changelog section for this version, without its heading. */
function notes() {
  const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
  const match = new RegExp(`^## ${version.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog);
  if (!match) fail(`CHANGELOG.md has no "## ${version}" section. Add one, then run it again.`);
  return match[1].trim() + '\n';
}

const remoteTags = run('git', ['ls-remote', '--tags', 'origin', tag]);
const released = remoteTags.includes(`refs/tags/${tag}`);

if (args.has('--check')) {
  const notesPath = join(tmpdir(), `dbtour-notes-${version}.md`);
  if (!released) writeFileSync(notesPath, notes());
  console.log(released ? `${tag} exists on origin: nothing to release.` : `${tag} is new: release it.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnew=${released ? 'false' : 'true'}\nnotes=${notesPath}\n`);
  process.exit(0);
}

if (released) fail(`${tag} is already on origin. A released tag is never moved: bump the version and release that.`, 3);
if (run('git', ['status', '--porcelain'])) fail('The working tree has changes. Commit or stash them, then run it again.');
if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('Release from main: switch to it, pull, then run it again.');
run('git', ['fetch', '-q', 'origin', 'main']);
if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) fail('main is not at origin/main. Pull (or push), then run it again.');

const text = notes();
run('git', ['tag', '-a', tag, '-m', `dbtour ${version}`]);
run('git', ['push', 'origin', tag]);
const notesPath = join(tmpdir(), `dbtour-notes-${version}.md`);
writeFileSync(notesPath, text);
console.log(run('gh', ['release', 'create', tag, '--title', version, '--notes-file', notesPath]));

const publish = ['publish', '--workspace', 'packages/core', '--workspace', 'packages/source-mssql', '--workspace', 'packages/addon-explorer', '--access', 'public'];
if (args.has('--publish')) {
  run('npm', publish, { stdio: 'inherit' });
} else {
  console.log(`Released ${tag}. To publish the packages by hand:\n  npm ${publish.join(' ')}`);
}
