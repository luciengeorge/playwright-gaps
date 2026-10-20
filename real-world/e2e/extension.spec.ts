import { test, expect } from 'playwright-gaps/persistent';
import { chromium } from '@playwright/test';

test('uBlock Origin Lite (real MV3 extension): service worker up, rulesets on, acts on pages', async ({ page, context, extensionId, extensionServiceWorker }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const name = await extensionServiceWorker.evaluate(() => chrome.runtime.getManifest().name + ' ' + chrome.runtime.getManifest().version);
  await expect.poll(() => extensionServiceWorker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()), { timeout: 30_000 }).toContain('easylist');
  console.log('extension', extensionId, name, await extensionServiceWorker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()));

  // 1) Local page embedding Google ad/analytics scripts: uBOL redirects them to its own neutered surrogates.
  const surrogates: string[] = [];
  page.on('request', (r) => { if (r.url().startsWith(`chrome-extension://${extensionId}/web_accessible_resources/`)) surrogates.push(r.url().split('/').pop()!.split('?')[0]); });
  await page.goto('http://127.0.0.1:5600/ads');
  await expect.poll(() => surrogates.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  console.log('surrogates served by uBOL:', surrogates);

  // 2) A real public news site: tracker requests are blocked by the extension.
  const blocked: string[] = [];
  const news = await context.newPage();
  news.on('requestfailed', (r) => { if (r.failure()?.errorText.includes('ERR_BLOCKED_BY_CLIENT')) blocked.push(new URL(r.url()).host); });
  await news.goto('https://www.theverge.com/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => blocked.length, { timeout: 20_000 }).toBeGreaterThan(3);
  console.log('blocked on theverge.com:', blocked.length, [...new Set(blocked)].slice(0, 8));

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator('body')).not.toBeEmpty();
});

test('control: same pages without the extension, nothing blocked or replaced', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const blocked: string[] = [], hosts: string[] = [];
  page.on('requestfailed', (r) => { if (r.failure()?.errorText.includes('BLOCKED_BY_CLIENT')) blocked.push(r.url()); });
  page.on('requestfinished', (r) => hosts.push(new URL(r.url()).protocol + new URL(r.url()).host));
  await page.goto('http://127.0.0.1:5600/ads');
  await page.waitForLoadState('networkidle');
  await page.goto('https://www.theverge.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  expect(hosts).toContain('https:pagead2.googlesyndication.com');
  expect(hosts.some((h) => h.startsWith('chrome-extension'))).toBe(false);
  expect(blocked).toHaveLength(0);
  await browser.close();
});
