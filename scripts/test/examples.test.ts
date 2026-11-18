// The examples are what a newcomer renders first and what the live example on the web is made from, so each
// is held to the code: its model is one dbtour accepts, and every note finds the table it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../../packages/core/src/config.ts';
import { scope, validate, type Model } from '../../packages/core/src/model.ts';
import { applyNotes, parseNotes } from '../../packages/core/src/notes.ts';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const model = (example: string): Model => JSON.parse(read(`examples/${example}/docs/schema.json`));

for (const example of ['shop', 'several']) {
  test(`examples/${example}: a model dbtour accepts, a source for each database, and notes that all find their table`, () => {
    const found = model(example);
    const checked = validate(found);
    assert.deepEqual(checked.ok ? [] : checked.errors, []);
    const config = parseConfig(read(`examples/${example}/dbtour.yaml`));
    assert.deepEqual(config.sources.map((s) => s.name), found.databases.map((d) => d.name), 'dbtour.yaml lists the databases in the model, in its order');
    // As render does: with several databases, each table is named with its own before the notes are read.
    const applied = applyNotes(scope(found), parseNotes(read(`examples/${example}/dbtour.notes.yaml`)));
    assert.deepEqual(applied.warnings, [], 'no note names a table or a column the model lacks');
  });
}

test('examples/several: three databases of two kinds, Shop as examples/shop has it, and no path of the machine that read them', () => {
  const several = model('several');
  assert.deepEqual(several.databases.map((d) => `${d.name} ${d.driver}`), ['Shop mssql', 'Chinook sqlite', 'Northwind sqlite']);
  assert.deepEqual(several.databases[0], model('shop').databases[0], 'Shop is the same made-up shop');
  const tables = (name: string) => several.databases.find((d) => d.name === name)?.schemas.flatMap((s) => s.tables).length;
  assert.equal(tables('Chinook'), 11);
  assert.equal(tables('Northwind'), 30);
  assert.doesNotMatch(read('examples/several/docs/schema.json'), /\/Users\/|\/home\/|\/tmp\/|[A-Z]:\\\\/, 'the model says nothing of where the files were');
});
