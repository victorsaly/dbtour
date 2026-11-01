// Writes the brand files from the mark's one geometry: brand/mark.svg, brand/logo.svg (mark and wordmark),
// and brand/social.png (1200 by 630, for link previews) drawn in Google Chrome through Playwright.
// Run after changing packages/addon-explorer/src/mark.ts; the files are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { markFrame, markPulse, markSvg } from '../packages/addon-explorer/src/mark.ts';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = `${repo}brand`;
mkdirSync(out, { recursive: true });

const ink = '#0b0b0b';
writeFileSync(`${out}/mark.svg`, markSvg(96, ink, 1.5) + '\n');

// The wordmark is set in Archivo from the page's own font file, so the logo needs no font installed.
const { readFileSync } = await import('node:fs');
const archivo = readFileSync(`${repo}packages/addon-explorer/fonts/archivo-latin.woff2`).toString('base64');
const fontFace = `@font-face{font-family:Archivo;font-weight:100 900;src:url(data:font/woff2;base64,${archivo}) format('woff2')}`;

function logo(inkColour, width = 220, height = 48) {
  const { x, y, size } = markFrame;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 220 48" fill="none">` +
    `<style>${fontFace}</style>` +
    `<g transform="translate(4 4) scale(1.6667)" stroke="${inkColour}" stroke-width="1.5" stroke-linejoin="miter" stroke-linecap="butt">` +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}"/><polyline points="${markPulse}"/></g>` +
    `<text x="56" y="34" fill="${inkColour}" font-family="Archivo, system-ui, sans-serif" font-weight="600" font-size="30" letter-spacing="-0.6">dbtour</text>` +
    `</svg>`
  );
}
writeFileSync(`${out}/logo.svg`, logo(ink) + '\n');
writeFileSync(`${out}/logo-light.svg`, logo('#f5f5f5') + '\n');

// The social image: the black sleeve, the mark, the wordmark, one line, and the plot of a table.
const social = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFace}
html,body{margin:0;background:#0b0b0b;color:#f5f5f5;font-family:Archivo,system-ui,sans-serif}
.sheet{position:relative;width:1200px;height:630px;padding:72px 80px;box-sizing:border-box}
.head{display:flex;align-items:center;gap:22px}
.word{font-weight:600;font-size:56px;letter-spacing:-1.5px}
.line{margin-top:28px;font-size:30px;max-width:760px;line-height:1.3;color:#f5f5f5}
.sub{margin-top:14px;font-size:20px;color:#a3a3a3}
.plot{position:absolute;left:80px;right:80px;bottom:92px;height:120px}
.plot path{fill:none;stroke:#f5f5f5;stroke-width:2}
.strip{position:absolute;left:80px;bottom:56px;display:flex;gap:10px}
.strip i{display:block;width:28px;height:14px;outline:1px solid rgba(245,245,245,.3)}
.cat{position:absolute;right:80px;bottom:56px;font-family:ui-monospace,Menlo,monospace;font-size:16px;letter-spacing:.14em;color:#a3a3a3}
</style></head><body><div class="sheet">
<div class="head">${markSvg(72, '#f5f5f5', 1.5)}<span class="word">dbtour</span></div>
<div class="line">Tour your database. Every table an entry, every relation a line, in one file that opens anywhere.</div>
<div class="sub">Schema docs from the catalogue your database already is. SQL Server first.</div>
<svg class="plot" viewBox="0 0 1040 120" preserveAspectRatio="none"><path vector-effect="non-scaling-stroke" d="M0,118 L40,118 L60,4 L80,118 L130,118 L150,52 L170,118 L220,118 L240,100 L260,118 L310,118 L330,100 L350,118 L400,118 L420,66 L440,118 L490,118 L510,100 L530,118 L580,118 L600,4 L620,118 L670,118 L690,100 L710,118 L760,118 L780,52 L800,118 L850,118 L870,100 L890,118 L940,118 L960,100 L980,118 L1040,118"/></svg>
<div class="strip"><i style="background:#e2001a"></i><i style="background:#ffd500"></i><i style="background:#0057b8"></i><i style="background:#f5f5f5"></i><i style="background:#8c8c8c"></i></div>
<div class="cat">NO. 001 · github.com/victorsaly/dbtour</div>
</div></body></html>`;
const page = `${out}/social.html`;
writeFileSync(page, social);
const { chromium } = createRequire(`${repo}package.json`)('playwright-core');
const browser = await chromium.launch({ channel: 'chrome' });
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await tab.goto(pathToFileURL(page).href);
await tab.waitForTimeout(300);
await tab.screenshot({ path: `${out}/social.png` });
await browser.close();
const { unlinkSync } = await import('node:fs');
unlinkSync(page);
console.log('Wrote brand/mark.svg, brand/logo.svg, brand/logo-light.svg, brand/social.png');
