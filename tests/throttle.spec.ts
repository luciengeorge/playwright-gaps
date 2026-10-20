import { test, expect, throttle, presets, resolveConditions } from 'playwright-gaps';

/** Fetch a resource from inside the page and return how long it took (ms). */
async function timedFetch(page: import('@playwright/test').Page, url: string, init?: { method: string; bytes: number }) {
  return page.evaluate(
    async ({ url, init }) => {
      const t0 = performance.now();
      const res = await fetch(url, init ? { method: init.method, body: new Uint8Array(init.bytes) } : undefined);
      const body = await res.arrayBuffer();
      return { ms: performance.now() - t0, bytes: body.byteLength, text: init ? new TextDecoder().decode(body) : '' };
    },
    { url, init },
  );
}

const expectedStrategy = (browserName: string) => (browserName === 'chromium' ? 'cdp' : 'route');

test.describe('throttle()', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  test('baseline: 200 KiB download is fast without throttling', async ({ page }) => {
    const r = await timedFetch(page, '/bytes?kb=200');
    expect(r.bytes).toBe(200 * 1024);
    expect(r.ms).toBeLessThan(500);
  });

  test('download bandwidth + latency slow a 200 KiB fetch to the expected time', async ({ page, throttle, browserName }) => {
    const h = await throttle({ downloadKbps: 1600, latencyMs: 200 });
    expect(h.strategy).toBe(expectedStrategy(browserName));
    // 200 KiB * 8 bits / 1600 kbps = 1024 ms transfer, + 200 ms latency
    const expected = 1024 + 200;
    const r = await timedFetch(page, '/bytes?kb=200');
    test.info().annotations.push({ type: 'measured', description: `${browserName}: ${Math.round(r.ms)}ms (expected ~${expected}ms)` });
    expect(r.bytes).toBe(200 * 1024);
    expect(r.ms).toBeGreaterThan(expected * 0.8);
    expect(r.ms).toBeLessThan(expected * 3);
  });

  test('latency-only conditions add the latency to each request', async ({ page, throttle, browserName }) => {
    await throttle({ latencyMs: 600 });
    const r = await timedFetch(page, '/bytes?kb=1');
    test.info().annotations.push({ type: 'measured', description: `${browserName}: ${Math.round(r.ms)}ms (expected >=600ms)` });
    expect(r.ms).toBeGreaterThan(550);
    expect(r.ms).toBeLessThan(2500);
  });

  test('upload bandwidth slows a 100 KiB POST', async ({ page, throttle, browserName }) => {
    await throttle({ uploadKbps: 800 });
    // 100 KiB * 8 / 800 kbps = 1024 ms
    const r = await timedFetch(page, '/upload', { method: 'POST', bytes: 100 * 1024 });
    test.info().annotations.push({ type: 'measured', description: `${browserName}: ${Math.round(r.ms)}ms (expected ~1024ms)` });
    expect(JSON.parse(r.text).received).toBe(100 * 1024);
    expect(r.ms).toBeGreaterThan(1024 * 0.8);
  });

  test('parallel requests share the bandwidth', async ({ page, throttle, browserName }) => {
    await throttle({ downloadKbps: 3200 });
    // 4 x 100 KiB = 400 KiB * 8 / 3200 kbps = 1024 ms if bandwidth is shared (256ms if it were not)
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      await Promise.all([1, 2, 3, 4].map((i) => fetch(`/bytes?kb=100&i=${i}`).then((r) => r.arrayBuffer())));
      return performance.now() - t0;
    });
    test.info().annotations.push({ type: 'measured', description: `${browserName}: ${Math.round(ms)}ms (expected ~1024ms)` });
    expect(ms).toBeGreaterThan(1024 * 0.8);
  });

  test("'slow-3g' preset: a page with a 100 KiB script takes seconds to load", async ({ page, throttle, browserName }) => {
    await throttle('slow-3g');
    const t0 = Date.now();
    await page.goto('/heavy.html?kb=100', { timeout: 30_000 });
    const ms = Date.now() - t0;
    // document + script: >= 2 x 2000ms latency (CDP applies it per request) + 100 KiB at 400 kbps (~2s)
    test.info().annotations.push({ type: 'measured', description: `${browserName}: page load ${ms}ms` });
    expect(await page.evaluate(() => (window as any).__blobLoaded)).toBe(true);
    expect(ms).toBeGreaterThan(4000);
  });

  test("'offline' preset makes requests fail, stop() restores the network", async ({ page, throttle }) => {
    const h = await throttle('offline');
    const failed = await page.evaluate(() => fetch('/bytes?kb=1').then(() => false, () => true));
    expect(failed).toBe(true);
    await h.stop();
    const r = await timedFetch(page, '/bytes?kb=1');
    expect(r.bytes).toBe(1024);
  });

  test('update() swaps conditions and stop() removes throttling', async ({ page, browserName }) => {
    const h = await throttle(page, { latencyMs: 800 });
    expect((await timedFetch(page, '/bytes?kb=1')).ms).toBeGreaterThan(750);
    await h.update({ latencyMs: 0 });
    expect((await timedFetch(page, '/bytes?kb=1')).ms).toBeLessThan(400);
    await h.stop();
    await h.stop(); // idempotent
    expect((await timedFetch(page, '/bytes?kb=1')).ms).toBeLessThan(400);
    expect(h.strategy).toBe(expectedStrategy(browserName));
  });

  test('context-level throttling applies to pages opened later', async ({ context, page }) => {
    const h = await throttle(context, { latencyMs: 700 });
    const second = await context.newPage();
    await h.ready(second);
    await second.goto('/index.html');
    const r = await timedFetch(second, '/bytes?kb=1');
    expect(r.ms).toBeGreaterThan(650);
    await h.stop();
    void page;
  });
});

test.describe('networkConditions use option', () => {
  test.use({ networkConditions: { latencyMs: 700 } });
  test('throttles navigation without any code in the test', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/index.html');
    expect(Date.now() - t0).toBeGreaterThan(650);
  });
});

test.describe("strategy: 'route' works on every browser (incl. Chromium)", () => {
  test.use({ throttleStrategy: 'route' });
  test('route strategy approximates bandwidth', async ({ page, throttle }) => {
    await page.goto('/index.html');
    const h = await throttle({ downloadKbps: 1600 });
    expect(h.strategy).toBe('route');
    const r = await timedFetch(page, '/bytes?kb=200');
    expect(r.bytes).toBe(200 * 1024);
    expect(r.ms).toBeGreaterThan(1024 * 0.8);
  });
});

test.describe('conditions', () => {
  test('presets resolve to DevTools values; invalid input throws', () => {
    expect(resolveConditions('slow-3g')).toEqual(presets['slow-3g']);
    expect(resolveConditions({ latencyMs: 5 })).toEqual({ downloadKbps: 0, uploadKbps: 0, latencyMs: 5, offline: false });
    expect(() => resolveConditions('5g' as never)).toThrow(/unknown throttle preset/);
    expect(() => resolveConditions({ downloadKbps: -1 })).toThrow(/non-negative/);
  });

  test("strategy 'cdp' throws outside Chromium", async ({ page, browserName }) => {
    test.skip(browserName === 'chromium');
    await expect(throttle(page, 'fast-3g', { strategy: 'cdp' })).rejects.toThrow(/requires Chromium/);
  });
});
