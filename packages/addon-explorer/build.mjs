// Bundles the page into dist/: one script and one stylesheet that src/index.ts inlines into index.html.
// The only build step in the repository, and only for browser code; Node runs everything else as it is.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

await build({
  entryPoints: [`${here}src/page/main.tsx`],
  outfile: `${here}dist/page.js`,
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // The licence notices of React, React Flow and ELK stay in the bundle, at its end.
  legalComments: 'eof',
  logLevel: 'warning',
});
