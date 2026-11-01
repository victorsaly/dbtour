#!/usr/bin/env node
// Node 22.18+ is what the published JavaScript targets; an older Node fails on syntax, so say why first.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`dbtour needs Node 22.18 or newer (this is ${process.versions.node}). Upgrade Node, then run it again.`);
  process.exit(2);
}
// dist/ is what `npm run build` emits and what the package ships; in the repository, build first.
const { main } = await import('../dist/cli.js');
process.exitCode = await main(process.argv.slice(2));
