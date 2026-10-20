import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistentTest as test } from 'playwright-gaps';
import { expect } from '@playwright/test';

const profileRoot = mkdtempSync(path.join(tmpdir(), 'pw-gaps-test-profiles-'));

test.describe('persistentContext: state survives across contexts', () => {
  test.describe.configure({ mode: 'serial' });
  // One profile per browser so the projects can run in parallel.
  test.use({ userDataDir: path.join(profileRoot, '{project}') });
  test.afterAll(() => rmSync(profileRoot, { recursive: true, force: true }));

  test('1: write localStorage + a persistent cookie', async ({ page, context }) => {
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.setItem('pw-gaps', 'remembered'));
    await context.addCookies([{ name: 'session', value: 'abc', url: 'http://127.0.0.1:4173', expires: Math.floor(Date.now() / 1000) + 3600 }]);
  });

  test('2: a brand-new persistent context sees the same state', async ({ page, context }) => {
    await page.goto('/index.html');
    expect(await page.evaluate(() => localStorage.getItem('pw-gaps'))).toBe('remembered');
    expect((await context.cookies()).find((c) => c.name === 'session')?.value).toBe('abc');
  });
});

test.describe('persistentContext: default temp profile is fresh per test', () => {
  test('starts empty', async ({ page }) => {
    await page.goto('/index.html');
    expect(await page.evaluate(() => localStorage.getItem('pw-gaps'))).toBeNull();
    await page.evaluate(() => localStorage.setItem('pw-gaps', 'x'));
  });
  test('page fixture reuses the initial tab and respects use options', async ({ context, page, baseURL }) => {
    expect(context.pages()).toEqual([page]);
    await page.goto('/index.html');
    expect(page.url()).toBe(`${baseURL}/index.html`);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 720 });
  });
});

test.describe('persistentContext + networkConditions', () => {
  test.use({ networkConditions: { latencyMs: 700 } });
  test('throttles the first navigation of the persistent page', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/index.html');
    expect(Date.now() - t0).toBeGreaterThan(650);
  });
});

test.describe('Chrome extension E2E', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'extensions are Chromium-only');
  test.use({ extensionPaths: [path.join(import.meta.dirname ?? __dirname, 'extension')] });

  test('extension is loaded: service worker, content script and popup', async ({ page, context, extensionId, extensionServiceWorker }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    expect(await extensionServiceWorker.evaluate(() => (self as any).__pwGapsBackground)).toBe('alive');

    await page.goto('/index.html');
    await expect(page.locator('html')).toHaveAttribute('data-pw-gaps-extension', 'injected');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#popup')).toHaveText('hello from the extension popup');
  });
});

test.describe('extensionPaths outside Chromium', () => {
  test.skip(({ browserName }) => browserName === 'chromium');
  test.use({ extensionPaths: ['tests/extension'] });
  test.fail();
  test('fails (context fixture throws a clear error)', async ({ page }) => {
    void page; // never reached
  });
});
