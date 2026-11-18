// Makes examples/several/docs/schema.json again: one model of three databases. Chinook and Northwind are
// well-known samples kept as SQLite files, downloaded into examples/several/data (ignored by git) and read as
// any file is, catalogue only. Shop is made up and has no server, so its part is examples/shop's model as it is.
// Run by hand (`npm run example:several`) when a source learns to read more; the model is committed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = join(root, 'examples/several');
const cli = join(root, 'packages/core/bin/dbtour.mjs');

// Each file at an address that cannot change (a release, a commit), and the SHA-256 it had when the model was
// made, so a file that is not the one named here is refused rather than read.
const files = [
  {
    name: 'Chinook',
    file: 'chinook.db',
    url: 'https://github.com/lerocha/chinook-database/releases/download/v1.4.5/Chinook_Sqlite.sqlite',
    sha256: 'bdf635be69850bd3be09c9a2dbeef7ddfb80036bd3ef3381383cd03b61e4a61a',
  },
  {
    name: 'Northwind',
    file: 'northwind.db',
    url: 'https://raw.githubusercontent.com/jpwhite3/northwind-SQLite3/4f56e7f5906dfd23b25244c5bfe8fb5da6402efd/dist/northwind.db',
    sha256: '2f4f5c68dfcd33ba27373eae48c7a4869800c68095ee0f9f0da494f83382a877',
  },
];

mkdirSync(join(example, 'data'), { recursive: true });
for (const { name, file, url, sha256 } of files) {
  const path = join(example, 'data', file);
  if (!existsSync(path)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}: download ${name} by hand into examples/several/data/${file}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const found = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (found !== sha256) throw new Error(`examples/several/data/${file} is not the ${name} this script names (SHA-256 ${found}): delete it and run again`);
}

// Extract reads every source in a dbtour.yaml, and Shop has none to read: the two files are read from a
// folder of their own, then Shop's database is put first, as the example's dbtour.yaml lists them.
const work = mkdtempSync(join(tmpdir(), 'dbtour-several-'));
try {
  const sources = files.map(({ name, file }) => `  - type: sqlite\n    name: ${name}\n    file: ${join(example, 'data', file)}\n`).join('');
  writeFileSync(join(work, 'dbtour.yaml'), `out: docs\nsources:\n${sources}`);
  execFileSync(process.execPath, [cli, 'extract'], { cwd: work, stdio: 'inherit' });
  const read = JSON.parse(readFileSync(join(work, 'docs/schema.json'), 'utf8'));
  const shop = JSON.parse(readFileSync(join(root, 'examples/shop/docs/schema.json'), 'utf8'));
  const model = { ...read, databases: [...shop.databases, ...read.databases] };
  writeFileSync(join(example, 'docs/schema.json'), `${JSON.stringify(model, null, 2)}\n`);
  console.log(`examples/several/docs/schema.json: ${model.databases.map((d) => d.name).join(', ')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
