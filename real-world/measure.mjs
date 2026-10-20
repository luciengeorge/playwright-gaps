// Real-world throttle measurements using the published playwright-gaps package.
import { chromium, firefox, webkit } from '@playwright/test';
import { throttle, presets } from 'playwright-gaps';
const BT = { chromium, firefox, webkit }[process.argv[2]];
const only = process.argv[3];
const sites = [
  { name: 'playwright.dev', url: 'https://playwright.dev/', check: async (p) => (await p.locator('h1').first().textContent())?.trim() },
  { name: 'wikipedia-F1', url: 'https://en.wikipedia.org/wiki/Formula_One', check: async (p) => (await p.locator('#firstHeading').textContent())?.trim() },
];
// Chrome DevTools constants (front_end/core/sdk/NetworkManager.ts), sent the way DevTools sends them
const DEVTOOLS = {
  'slow-3g': { latency: 400 * 5, download: (500 * 1000) / 8 * 0.8, upload: (500 * 1000) / 8 * 0.8 },
  'fast-3g': { latency: 150 * 3.75, download: (1.6 * 1000 * 1000) / 8 * 0.9, upload: (750 * 1000) / 8 * 0.9 },
};
const conds = ['none', 'fast-3g', 'slow-3g'];
if (process.argv[2] === 'chromium') conds.push('devtools:fast-3g', 'devtools:slow-3g');
const browser = await BT.launch();
const rows = [];
for (const site of sites) for (const c of conds) {
  if (only && !c.includes(only) && only !== site.name) continue;
  const context = await browser.newContext();
  const page = await context.newPage();
  let failed = 0, bytes = 0, reqs = 0, h;
  page.on('requestfailed', () => failed++);
  page.on('requestfinished', async (r) => { reqs++; try { bytes += (await r.sizes()).responseBodySize; } catch {} });
  if (c.startsWith('devtools:')) {
    const d = DEVTOOLS[c.split(':')[1]];
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditionsByRule', { offline: false, matchedNetworkConditions: [{ urlPattern: '', latency: d.latency, downloadThroughput: d.download, uploadThroughput: d.upload }] });
  } else if (c !== 'none') h = await throttle(page, c);
  const t0 = Date.now();
  let err = '';
  try { await page.goto(site.url, { waitUntil: 'load', timeout: 300_000 }); } catch (e) { err = String(e.message).split('\n')[0]; }
  const wall = Date.now() - t0;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ttfb: Math.round(n.responseStart) } : {}; }).catch(() => ({}));
  const ok = await site.check(page).catch((e) => 'ERR ' + e.message.slice(0, 60));
  const css = await page.evaluate(() => document.styleSheets.length).catch(() => -1);
  const imgsBroken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.loading !== 'lazy').length).catch(() => -1);
  rows.push({ browser: process.argv[2], site: site.name, cond: c, strategy: h?.strategy ?? (c.startsWith('devtools') ? 'raw-cdp' : '-'), wallMs: wall, ttfb: nav.ttfb, dcl: nav.dcl, load: nav.load, reqs, kb: Math.round(bytes / 1024), failed, css, imgsBroken, heading: ok, err });
  console.log(JSON.stringify(rows.at(-1)));
  await h?.stop();
  await context.close();
}
await browser.close();
