// Releases what main holds: the version in packages/core/package.json becomes a tag and a GitHub release
// whose notes are that version's changelog section, then the three packages go to npm.
//
//   node scripts/release.mjs --check     say whether the version is untagged, whether npm lacks it and
//                                        whether the checkout is the tag's commit; in GitHub Actions, write
//                                        the outputs `version`, `new`, `unpublished`, `at_tag` and `notes`
//                                        for the release workflow
//   node scripts/release.mjs             tag, push the tag and create the release, from a clean, current main
//   node scripts/release.mjs --publish   the same, then publish the packages (needs npm login with 2FA);
//                                        on a version already tagged, from a checkout of that tag, only
//                                        the publish. `--provenance` goes through to npm, for the workflow
//
// The workflow in .github/workflows/release.yml runs this on every push to main, so by hand is for when
// the workflow could not: it tags before it publishes, and skips the publish until npm trusts it, so a
// tagged version that is not on npm yet is the usual case. A tag that exists is never moved: a new version
// means a new patch. Through npm, pass the flag after `--` (`npm run release -- --publish`), or npm keeps it.
import { execFileSync, spawnSync } from 'node:child_process';
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

// Core first: the others depend on its exact version.
const workspaces = ['packages/core', 'packages/source-mssql', 'packages/addon-explorer'];
const manifests = workspaces.map((workspace) => ({ workspace, ...JSON.parse(readFileSync(join(repo, workspace, 'package.json'), 'utf8')) }));
const version = manifests[0].version;
const tag = `v${version}`;
for (const { workspace, version: other } of manifests) {
  if (other !== version) fail(`${workspace} is ${other} but core is ${version}: every package carries the same version. Bump them together, then run it again.`);
}

/** The changelog section for this version, without its heading. */
function notes() {
  const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
  // The version ends where a space or the line does, so 0.2.2 does not take 0.2.20's section.
  const match = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?![\\w.+-])[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog);
  if (!match) fail(`CHANGELOG.md has no "## ${version}" section. Add one, then run it again.`);
  return match[1].trim() + '\n';
}

// An annotated tag (made by hand) is listed twice, the second time as `^{}` with the commit it points to;
// a lightweight one (made by the workflow's gh release create) once, with the commit itself.
const remoteTags = new Map(run('git', ['ls-remote', '--tags', 'origin', tag, `${tag}^{}`]).split('\n').filter(Boolean).map((line) => line.split('\t').reverse()));
const released = remoteTags.has(`refs/tags/${tag}`);
const tagCommit = remoteTags.get(`refs/tags/${tag}^{}`) ?? remoteTags.get(`refs/tags/${tag}`);

/**
 * The workspaces npm does not have at this version. A publish that stopped part way leaves some on npm,
 * which refuses them a second time, so asking first is what lets it be run again. Anything but npm's E404
 * is not an answer: the error is thrown with the first line of what npm said.
 */
function missingPackages() {
  const missing = [];
  for (const { workspace, name } of manifests) {
    const spec = `${name}@${version}`;
    const view = spawnSync('npm', ['view', spec, 'version'], { cwd: repo, encoding: 'utf8' });
    if (view.status === 0 && view.stdout.trim() === version) console.log(`${spec} is on npm already: skipped.`);
    else if (view.status === 0 || /\bE404\b/.test(view.stderr)) missing.push(workspace);
    else throw new Error(`Could not ask npm whether ${spec} is published (${view.stderr.trim().split('\n')[0] || `exit ${view.status}`}). Check the network and npm login, then run it again.`);
  }
  return missing;
}

if (args.has('--check')) {
  const notesPath = join(tmpdir(), `dbtour-notes-${version}.md`);
  if (!released) writeFileSync(notesPath, notes());
  console.log(released ? `${tag} exists on origin: nothing to tag.` : `${tag} is new: release it.`);
  // Whether npm lacks the version is asked separately from the tag, so a publish that failed after the
  // tag was made is picked up by a rerun. A registry that cannot be asked is "unknown", which the workflow
  // reads as "do not publish", rather than a reason to skip the tag and the release.
  let unpublished = 'unknown';
  try {
    unpublished = missingPackages().length > 0 ? 'true' : 'false';
    console.log(unpublished === 'true' ? `npm lacks ${version}: publish it.` : `npm has every package of ${version}.`);
  } catch (error) {
    console.error(error.message);
  }
  // npm's provenance names the commit and ref the run was started on, not what is checked out, so the
  // workflow publishes only from the tag's commit: the run that makes the tag, or one started on the tag.
  const atTag = released && tagCommit === run('git', ['rev-parse', 'HEAD']);
  if (released && !atTag && unpublished === 'true') {
    console.log(`This checkout is not ${tag}, so it does not publish. Publish from the tag: gh workflow run release.yml --ref ${tag}`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nnew=${released ? 'false' : 'true'}\nunpublished=${unpublished}\nat_tag=${atTag}\nnotes=${notesPath}\n`);
  process.exit(0);
}

/** Publishes each package npm does not have at this version yet and returns how many that was. */
function publishMissing() {
  let missing;
  try {
    missing = missingPackages();
  } catch (error) {
    fail(error.message);
  }
  const flags = args.has('--provenance') ? ['--provenance'] : [];
  for (const workspace of missing) {
    // npm's account of a refusal is kept to name the fix; it is shown as it comes as well. The terminal's
    // input stays npm's, for the one-time password it asks for when published by hand.
    const result = spawnSync('npm', ['publish', '--workspace', workspace, '--access', 'public', ...flags], { cwd: repo, encoding: 'utf8', stdio: ['inherit', 'inherit', 'pipe'] });
    process.stderr.write(result.stderr ?? '');
    if (result.status !== 0) fail(refusal(manifests.find((m) => m.workspace === workspace), result.stderr ?? ''));
  }
  return missing.length;
}

/** What to do about a publish npm refused, in a sentence; the two refusals trusted publishing gives first. */
function refusal({ name, repository }, stderr) {
  const spec = `${name}@${version}`;
  const github = process.env.GITHUB_REPOSITORY ?? /github\.com[/:]([^/]+\/[^/.]+)/.exec(repository?.url ?? '')?.[1] ?? '<owner>/<repo>';
  if (/OIDC permission denied/.test(stderr)) {
    return `npm refused to publish ${spec}: its trusted publisher may only stage, the default for one made after 3 September 2026. Allow publishing (npx npm@latest trust list ${name} gives the id to revoke first): npx npm@latest trust github ${name} --file release.yml --repo ${github} --allow-publish, then run it again.`;
  }
  if (/\bE?404\b/.test(stderr)) {
    return `npm does not trust this workflow to publish ${name}. On npmjs.com, give ${name} a trusted publisher (GitHub Actions, ${github}, release.yml, no environment) or correct the one it has, then run it again.`;
  }
  const said = stderr.trim().split('\n').find((line) => line.trim() !== '') ?? 'no reason given';
  return `npm did not publish ${spec} (${said}). Fix what npm says above, then run it again: what is on npm already is skipped.`;
}

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
  if (!publishMissing()) fail(`Every package of ${tag} is on npm already: nothing to publish.`, 3);
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
  publishMissing();
} else {
  console.log(`Released ${tag}. To publish the packages by hand, from a checkout of it:\n  npm run release -- --publish`);
}
