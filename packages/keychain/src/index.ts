// dbtour's passwords in the system's keychain: macOS Keychain, Windows Credential Manager, the Secret Service
// on Linux, through @napi-rs/keyring's prebuilt binaries. Each is kept under the service "dbtour" and an
// account that names the database and the login's role ("Shop · reader"), so the keychain's own app shows
// which is which. Nothing here writes a file, prints a secret or hands one to anything but dbtour.
import { AsyncEntry } from '@napi-rs/keyring';
import type { SecretStore } from 'dbtour';

/** The keychain's service name for every dbtour entry. */
export const service = 'dbtour';

/** What dbtour needs of a keychain entry; @napi-rs/keyring's AsyncEntry, or a test's own. */
export interface Entry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}

export type MakeEntry = (service: string, account: string) => Entry;

/** A keychain that cannot be read says so, and what to do, never the secret it was after. */
function explain(account: string, doing: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `The system keychain would not ${doing} "${service} · ${account}" (${reason}): unlock it, or allow dbtour when it asks, then run it again`,
    { cause: error },
  );
}

export function keychain(make: MakeEntry = (s, a) => new AsyncEntry(s, a)): SecretStore {
  return {
    async get(account) {
      try {
        return (await make(service, account).getPassword()) ?? undefined;
      } catch (error) {
        throw explain(account, 'read', error);
      }
    },
    async set(account, secret) {
      try {
        await make(service, account).setPassword(secret);
      } catch (error) {
        throw explain(account, 'save', error);
      }
    },
    async remove(account) {
      try {
        return await make(service, account).deleteCredential();
      } catch (error) {
        throw explain(account, 'remove', error);
      }
    },
  };
}

/** The store `dbtour` loads by the package's name. */
export const store: SecretStore = keychain();
