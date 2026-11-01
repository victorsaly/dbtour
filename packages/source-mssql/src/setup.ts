// What dbtour's setup asks of SQL Server beyond reading it: a connection string from where it is and how
// dbtour signs in, and the statements that give a database its reader. Pure, so it is tested without a
// server; createReader in index.ts runs them.
import type { Target } from 'dbtour';

/** A value in a connection string, quoted so a ; or a quote in a password stays part of it. */
function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The connection string for a target. Signed in with az, the driver asks Azure's default credential, which
 * finds the az sign-in; with a login, its password, read from the keychain a moment before. Encrypted always.
 */
export function connectionString(target: Target): string {
  const parts = [`Server=${quote(target.server)}`, `Database=${quote(target.database)}`, 'Encrypt=true'];
  if (target.signIn === 'az') parts.push('Authentication=Active Directory Integrated');
  else parts.push(`User Id=${quote(target.user ?? '')}`, `Password=${quote(target.password ?? '')}`);
  return parts.join(';');
}

/** A name as T-SQL brackets it. */
export function bracket(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

/**
 * The statements that make `user` a contained user of this database with db_datareader alone, or reset its
 * password if it is one already. Shown before they run with the password hidden; run with the one dbtour made.
 */
export function readerStatements(user: string, exists: boolean, password = '••••••'): string[] {
  return [
    exists ? `ALTER USER ${bracket(user)} WITH PASSWORD = '${password}';` : `CREATE USER ${bracket(user)} WITH PASSWORD = '${password}';`,
    `ALTER ROLE db_datareader ADD MEMBER ${bracket(user)};`,
  ];
}

/** Roles a reader may have: db_datareader, and public, which every user is in. Any other could write. */
export function extraRoles(roles: string[]): string[] {
  return roles.filter((r) => r !== 'db_datareader' && r !== 'public');
}
