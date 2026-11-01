// The explorer add-on: render(model) returns index.html with the page and the model inlined, so the file
// opens from disk with no server and no network. The page itself is built from src/page into dist/.
import { readFileSync } from 'node:fs';
import type { Model } from 'dbtour/model';

export function render(model: Model): Record<string, string> {
  return { 'index.html': pageHtml(model, builtFile('page.js'), builtFile('page.css')) };
}

function builtFile(name: string): string {
  try {
    return readFileSync(new URL(`../dist/${name}`, import.meta.url), 'utf8');
  } catch (error) {
    throw new Error(`dbtour-addon-explorer has no dist/${name}: in the dbtour repository run npm run build, otherwise reinstall the package`, { cause: error });
  }
}

/** The HTML around the bundle and the model. Pure, so it is tested without the build. */
export function pageHtml(model: Model, js: string, css: string): string {
  const title = `${model.databases.map((d) => d.name).join(', ') || 'dbtour'} · dbtour`;
  // Inside a JSON string "<" is "<", so no "</script" or "<!--" can end the element early. The bundle
  // gets the same treatment where "</script" could appear inside one of its strings or patterns.
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const script = js.replace(/<\/(script)/gi, '<\\/$1');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script id="dbtour-model" type="application/json">${json}</script>
<script>${script}</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
