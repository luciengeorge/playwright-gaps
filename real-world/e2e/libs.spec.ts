import { test, expect } from 'playwright-gaps';

test('Swiper: swipe left/right changes slides', async ({ page, touch }) => {
  await page.goto('/swiper.html');
  await page.waitForFunction(() => (window as any).swiper?.initialized);
  const idx = () => page.evaluate(() => (window as any).swiper.activeIndex);
  expect(await idx()).toBe(0);
  await touch.swipe(page.locator('.swiper'), { direction: 'left', distance: 200 });
  await expect.poll(idx, { timeout: 3000 }).toBe(1);
  await touch.swipe(page.locator('.swiper'), { direction: 'left', distance: 200 });
  await expect.poll(idx, { timeout: 3000 }).toBe(2);
  await touch.swipe(page.locator('.swiper'), { direction: 'right', distance: 200 });
  await expect.poll(idx, { timeout: 3000 }).toBe(1);
});

test('Hammer.js: tap, press, swipe, pan and pinch recognisers fire', async ({ page, touch }) => {
  await page.goto('/hammer.html');
  await page.waitForFunction(() => (window as any).Hammer);
  const el = page.locator('#h');
  const ev = () => page.evaluate(() => (window as any).events as any[]);
  await touch.tap(el);
  await expect.poll(async () => (await ev()).map((e) => e.type)).toContain('tap');
  await touch.longPress(el, { durationMs: 600 });
  await expect.poll(async () => (await ev()).map((e) => e.type)).toContain('press');
  await touch.swipe(el, { direction: 'left', distance: 200, durationMs: 150 });
  await expect.poll(async () => (await ev()).map((e) => e.type)).toContain('swipeleft');
  await touch.pan({ x: 150, y: 150 }, { x: 300, y: 250 }, { steps: 10, durationMs: 400 });
  await expect.poll(async () => (await ev()).filter((e) => e.type === 'panend').length).toBeGreaterThan(0);
  await touch.pinch(el, { scale: 2, startDistance: 100, steps: 10, durationMs: 300 });
  await expect.poll(async () => (await ev()).filter((e) => e.type === 'pinchend').length).toBe(1);
  const pinchEnd = (await ev()).find((e) => e.type === 'pinchend');
  console.log(test.info().project.name, 'hammer input', await page.evaluate(() => (window as any).hammerInput), 'pinchend', JSON.stringify(pinchEnd));
  expect(pinchEnd.scale).toBeGreaterThan(1.8);
  expect(pinchEnd.pointers).toBe(2);
});

test('Leaflet: pinch zooms in, two-finger pinch-out zooms out, pan moves the map', async ({ page, touch }) => {
  await page.goto('/leaflet.html');
  await page.waitForFunction(() => (window as any).map);
  console.log(test.info().project.name, 'leaflet', JSON.stringify(await page.evaluate(() => (window as any).leafletInfo)));
  const zoom = () => page.evaluate(() => (window as any).map.getZoom());
  const center = () => page.evaluate(() => (window as any).map.getCenter());
  expect(await zoom()).toBe(10);
  await touch.pinch(page.locator('#map'), { scale: 2, startDistance: 120, steps: 12, durationMs: 400 });
  await expect.poll(zoom, { timeout: 3000 }).toBe(11);
  await touch.pinch(page.locator('#map'), { scale: 0.5, startDistance: 240, steps: 12, durationMs: 400 });
  await expect.poll(zoom, { timeout: 3000 }).toBe(10);
  const c0 = await center();
  await touch.pan({ x: 300, y: 250 }, { x: 450, y: 350 }, { steps: 10, durationMs: 300 });
  await expect.poll(async () => (await center()).lng).toBeLessThan(c0.lng - 0.05);
});

test('native touch scrolling (expected: Chromium only)', async ({ page, touch, browserName }) => {
  await page.goto('/scroll.html');
  await touch.swipe(page.locator('#top'), { direction: 'up', distance: 250, durationMs: 300, steps: 15 });
  await page.waitForTimeout(500);
  const y = await page.evaluate(() => scrollY);
  console.log(browserName, 'scrollY after swipe up', y);
  if (browserName === 'chromium') expect(y).toBeGreaterThan(100);
  else expect(y).toBe(0); // documented limitation: synthetic events don't scroll
});
