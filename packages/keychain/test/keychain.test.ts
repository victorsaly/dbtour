import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keychain, service, type Entry } from '../src/index.ts';

/** A keychain in memory, keyed as the real one is, by service and account. */
function memory(fail?: string): { make: (s: string, a: string) => Entry; saved: Map<string, string> } {
  const saved = new Map<string, string>();
  const make = (s: string, a: string): Entry => {
    const key = `${s}/${a}`;
    const refuse = () => {
      if (fail) throw new Error(fail);
    };
    return {
      getPassword: async () => (refuse(), saved.get(key) ?? null),
      setPassword: async (p) => (refuse(), void saved.set(key, p)),
      deleteCredential: async () => (refuse(), saved.delete(key)),
    };
  };
  return { make, saved };
}

test('a secret is kept under the dbtour service and its account, read back, and removed', async () => {
  const { make, saved } = memory();
  const store = keychain(make);
  assert.equal(await store.get('Shop · reader'), undefined, 'nothing yet');
  await store.set('Shop · reader', 'p;w"1');
  assert.deepEqual([...saved.keys()], [`${service}/Shop · reader`]);
  assert.equal(await store.get('Shop · reader'), 'p;w"1');
  assert.equal(await store.remove('Shop · reader'), true);
  assert.equal(await store.remove('Shop · reader'), false, 'nothing left to remove');
});

test('a keychain that refuses says which entry and what to do, and never the secret', async () => {
  const store = keychain(memory('User interaction is not allowed.').make);
  await assert.rejects(store.get('Shop · login'), /would not read "dbtour · Shop · login" \(User interaction is not allowed\.\): unlock it/);
  const saving = await store.set('Shop · login', 'hunter2').catch((error: Error) => error.message);
  assert.match(String(saving), /would not save/);
  assert.doesNotMatch(String(saving), /hunter2/);
  await assert.rejects(store.remove('Shop · login'), /would not remove/);
});
