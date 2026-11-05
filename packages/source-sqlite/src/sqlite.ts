// node:sqlite, without the warning it prints on stderr each time a process loads it: that it is experimental.
// Node ships it, which is why dbtour uses it (nothing to install, nothing to build), and a warning a person
// can do nothing about would read as dbtour's own fault. Only that warning is dropped, and only while it loads.
const emit = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const loaded = await import('node:sqlite').finally(() => {
  process.emitWarning = emit;
});

export const DatabaseSync = loaded.DatabaseSync;
export type DatabaseSync = InstanceType<typeof loaded.DatabaseSync>;
