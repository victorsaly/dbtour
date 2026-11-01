// Releases what main holds: the version in packages/core/package.json becomes a tag and a GitHub release
// whose notes are that version's changelog section, then the three packages go to npm.
//
//   node scripts/release.mjs --check     say whether the version is unreleased; in GitHub Actions, write the
//                                        outputs `version`, `new` and `notes` for the release workflow
//   node scripts/release.mjs             tag, push the tag and create the release, from a clean, current main
//   node scripts/release.mjs --publish   the same, then publish the packages (needs npm login with 2FA);
//                                        on a version already tagged, from a checkout of that tag, only
//                                        the publish
//
// The workflow in .github/workflows/release.yml runs this on every push to main, so by hand is for when
// the workflow could not: it tags before it publishes, and skips the publish until npm trusts it, so a
// tagged version that is not on npm yet is the usual case. A tag that exists is never moved: a new version
// means a new patch. Through npm, pass the flag after `--` (`npm run release -- --publish`), or npm keeps it.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
// With stdio inherited there is no output to return, and execFileSync gives null.
const run = (command, cmdArgs, options = {}) => (execFileSync(command, cmdArgs, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }) ?? '').trim();
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
  // The version ends where a space or the line does, so 0.2.2 does not take 0.2.20's section.
  const match = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?![\\w.+-])[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog);
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

const publish = ['publish', '--workspace', 'packages/core', '--workspace', 'packages/source-mssql', '--workspace', 'packages/addon-explorer', '--access', 'public'];

if (released && !args.has('--publish')) {
  fail(`${tag} is already on origin. A released tag is never moved: bump the version and release that. To publish ${tag} to npm, run npm run release -- --publish from a checkout of it.`, 3);
}
if (run('git', ['status', '--porcelain'])) fail('The working tree has changes. Commit or stash them, then run it again.');

// Tagged already, most likely by the workflow: publish exactly what the tag holds, and nothing else.
if (released) {
  run('git', ['fetch', '-q', 'origin', 'tag', tag]);
  if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', `${tag}^{commit}`])) {
    fail(`The checkout is not ${tag}. Run git checkout ${tag}, then run it again.`);
  }
  run('npm', publish, { stdio: 'inherit' });
  process.exit(0);
}

if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('Release from main: switch to it, pull, then run it again.');
run('git', ['fetch', '-q', 'origin', 'main']);
if (run('git', ['rev-parse', 'HEAD']) !== run('git', ['rev-parse', 'origin/main'])) fail('main is not at origin/main. Pull (or push), then run it again.');

const text = notes();
run('git', ['tag', '-a', tag, '-m', `dbtour ${version}`]);
run('git', ['push', 'origin', tag]);
const notesPath = join(tmpdir(), `dbtour-notes-${version}.md`);
writeFileSync(notesPath, text);
console.log(run('gh', ['release', 'create', tag, '--title', version, '--notes-file', notesPath]));

if (args.has('--publish')) {
  run('npm', publish, { stdio: 'inherit' });
} else {
  console.log(`Released ${tag}. To publish the packages by hand:\n  npm ${publish.join(' ')}`);
}
