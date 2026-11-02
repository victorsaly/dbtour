// Builds what the packages publish: each package's TypeScript compiled into its dist/ (Node refuses to
// strip types under node_modules, so a published package must ship JavaScript), query.sql beside the
// SQL Server source's output, the page bundled by esbuild, and the licence in each package. The repository
// itself runs the .ts as it is; this is only for the tarballs, the example, and anything that imports a
// package by its name.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const tsc = `${repo}node_modules/.bin/tsc`;

// Core first: the others import it by name, which resolves to its dist/.
for (const pkg of ['core', 'source-mssql', 'addon-explorer']) {
  execFileSync(tsc, ['-p', `${repo}packages/${pkg}/tsconfig.build.json`], { stdio: 'inherit' });
}
mkdirSync(`${repo}packages/source-mssql/dist`, { recursive: true });
copyFileSync(`${repo}packages/source-mssql/src/query.sql`, `${repo}packages/source-mssql/dist/query.sql`);
execFileSync(process.execPath, [`${repo}packages/addon-explorer/build.mjs`], { stdio: 'inherit' });
// npm packs a licence only from the package's own folder, so each gets the repository's.
for (const pkg of ['core', 'source-mssql', 'addon-explorer']) copyFileSync(`${repo}LICENSE`, `${repo}packages/${pkg}/LICENSE`);
