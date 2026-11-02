// What npm shows of each package, held to one standard: the page someone lands on says what it is, links
// back to the repository and its issues, carries the licence, and names the core it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const folders = ['core', 'source-mssql', 'addon-explorer'];
const manifest = (folder: string) => JSON.parse(read(`packages/${folder}/package.json`));
const version = manifest('core').version;

test('every package page says what it is and links back to the repository and its issues', () => {
  for (const folder of folders) {
    const pkg = manifest(folder);
    assert.ok(pkg.description.length >= 80 && pkg.description.length <= 250, `${pkg.name}: a description npm search shows whole`);
    assert.ok(pkg.keywords.length >= 4, `${pkg.name}: keywords a search would use`);
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.homepage, 'https://github.com/victorsaly/dbtour#readme');
    assert.deepEqual(pkg.bugs, { url: 'https://github.com/victorsaly/dbtour/issues' });
    assert.deepEqual(pkg.author, { name: 'Victor Saly', url: 'https://github.com/victorsaly' });
    assert.equal(pkg.repository.directory, `packages/${folder}`, `${pkg.name}: npm links to its own folder`);
    assert.ok(pkg.engines.node, `${pkg.name}: the Node it needs`);
    assert.ok(existsSync(new URL(`packages/${folder}/README.md`, root)), `${pkg.name}: a README, or the npm page is blank`);
  }
});

test('every package carries the same version and asks for the core of that version', () => {
  for (const folder of folders.slice(1)) {
    const pkg = manifest(folder);
    assert.equal(pkg.version, version, `${pkg.name} is released with core`);
    assert.equal(pkg.peerDependencies?.dbtour, version, `${pkg.name}: a peer of the core it was built with, so npm installs it or says the versions differ`);
    assert.equal(pkg.devDependencies?.dbtour, version);
  }
});

test('the build puts the licence in every package, as npm packs it only from the package\'s own folder', () => {
  const licence = read('LICENSE');
  assert.match(read('scripts/build.mjs'), /LICENSE/);
  for (const folder of folders) {
    // npm test builds first, so the copy is there to compare.
    assert.ok(readdirSync(new URL(`packages/${folder}/`, root)).includes('LICENSE'), `packages/${folder} has no LICENSE after the build`);
    assert.equal(read(`packages/${folder}/LICENSE`), licence);
  }
});
