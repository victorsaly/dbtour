#!/usr/bin/env node
// Node 22.18+ runs the TypeScript as it is; an older Node fails here with a syntax error, so say why first.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`dbtour needs Node 22.18 or newer (this is ${process.versions.node}). Upgrade Node, then run it again.`);
  process.exit(2);
}
const { main } = await import('../src/cli.ts');
process.exitCode = await main(process.argv.slice(2));
