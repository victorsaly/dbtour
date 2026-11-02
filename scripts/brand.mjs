// Writes the brand files from the mark's one geometry: brand/mark.svg and mark-light.svg, brand/logo.svg and
// logo-light.svg (mark and outlined wordmark), brand/social.png (1200 by 630, for link previews) and brand/mark.png (256
// square, the plugin's icon) drawn in Google Chrome through Playwright. Run after changing packages/addon-explorer/src/mark.ts; the files are committed.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logoSvg, markSvg } from '../packages/addon-explorer/src/mark.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = `${repo}brand`;
mkdirSync(out, { recursive: true });

const ink = '#0b0b0b';
const paper = '#f5f5f5';
const muted = { dark: '#5c5c5c', light: '#a3a3a3' };
writeFileSync(`${out}/mark.svg`, markSvg(96, ink) + '\n');
writeFileSync(`${out}/mark-light.svg`, markSvg(96, paper) + '\n');
// The logo: the mark and the outlined wordmark, "tour" muted.
writeFileSync(`${out}/logo.svg`, logoSvg(ink, muted.dark) + '\n');
writeFileSync(`${out}/logo-light.svg`, logoSvg(paper, muted.light) + '\n');

// The social image's text is set from the page's own font files, so it needs nothing installed.
const fonts = `${repo}packages/addon-explorer/fonts/`;
const archivo = readFileSync(`${fonts}archivo-latin.woff2`).toString('base64');
const mono = readFileSync(`${fonts}red-hat-mono-latin.woff2`).toString('base64');
const fontFaces =
  `@font-face{font-family:Archivo;font-weight:100 900;src:url(data:font/woff2;base64,${archivo}) format('woff2')}` +
  `@font-face{font-family:'Red Hat Mono';font-weight:300 700;src:url(data:font/woff2;base64,${mono}) format('woff2')}`;

// The social image: the black sleeve, the logo, one line, and the plot of a table.
const social = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces}
html,body{margin:0;background:#0b0b0b;color:#f5f5f5;font-family:Archivo,system-ui,sans-serif}
.sheet{position:relative;width:1200px;height:630px;padding:72px 80px;box-sizing:border-box}
.head{display:flex}
.line{margin-top:28px;font-size:30px;max-width:760px;line-height:1.3;color:#f5f5f5}
.sub{margin-top:14px;font-size:20px;color:#a3a3a3}
.plot{position:absolute;left:80px;right:80px;bottom:92px;height:120px}
.plot path{fill:none;stroke:#f5f5f5;stroke-width:2}
.cat{position:absolute;right:80px;bottom:56px;font-family:'Red Hat Mono',ui-monospace,monospace;font-size:16px;letter-spacing:.14em;color:#a3a3a3}
</style></head><body><div class="sheet">
<div class="head">${logoSvg(paper, muted.light, 76)}</div>
<div class="line">Tour your database. Every table an entry, every relation a line, in one file that opens anywhere.</div>
<div class="sub">Schema docs from the catalogue your database already is. SQL Server first.</div>
<svg class="plot" viewBox="0 0 1040 120" preserveAspectRatio="none"><path vector-effect="non-scaling-stroke" d="M0,118 L40,118 L60,4 L80,118 L130,118 L150,52 L170,118 L220,118 L240,100 L260,118 L310,118 L330,100 L350,118 L400,118 L420,66 L440,118 L490,118 L510,100 L530,118 L580,118 L600,4 L620,118 L670,118 L690,100 L710,118 L760,118 L780,52 L800,118 L850,118 L870,100 L890,118 L940,118 L960,100 L980,118 L1040,118"/></svg>
<div class="cat">github.com/victorsaly/dbtour</div>
</div></body></html>`;
const page = `${out}/social.html`;
writeFileSync(page, social);
const { chromium } = createRequire(`${repo}package.json`)('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' });
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await tab.goto(pathToFileURL(page).href);
await tab.waitForTimeout(300);
await tab.screenshot({ path: `${out}/social.png` });
// The plugin's icon: the mark in paper on the black sleeve, with room around it as a launcher crops it.
const icon = `${out}/mark.html`;
writeFileSync(icon, `<!doctype html><html><body style="margin:0;width:256px;height:256px;display:grid;place-items:center;background:${ink}">${markSvg(168, paper)}</body></html>`);
const square = await browser.newPage({ viewport: { width: 256, height: 256 } });
await square.goto(pathToFileURL(icon).href);
await square.screenshot({ path: `${out}/mark.png` });
await browser.close();
unlinkSync(page);
unlinkSync(icon);
console.log('Wrote brand/mark.svg, mark-light.svg, logo.svg, logo-light.svg, social.png, mark.png');
