import { test, expect } from 'playwright-gaps';
import type { Page } from '@playwright/test';

type Entry = {
  type: string; t: number; trusted: boolean; target: string;
  x?: number; y?: number; pointerType?: string; pointerId?: number;
  touches?: { id: number; x: number; y: number }[]; changed?: { id: number; x: number; y: number }[];
};
const log = (page: Page) => page.evaluate(() => (window as any).__log as Entry[]);
const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;

test.beforeEach(async ({ page }) => {
  await page.goto('/touch.html');
});

test('mode: CDP (trusted events) on Chromium, synthetic elsewhere', async ({ page, touch, browserName }) => {
  expect(touch.mode).toBe(browserName === 'chromium' ? 'cdp' : 'synthetic');
  await touch.tap({ x: 100, y: 100 });
  const events = await log(page);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => e.trusted === (browserName === 'chromium'))).toBe(true);
});

test('tap: touchstart/touchend + pointer events + click at the exact coordinates', async ({ page, touch }) => {
  const box = (await page.locator('#btn').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const clicked = page.evaluate(() => new Promise<boolean>((r) => document.getElementById('btn')!.addEventListener('click', () => r(true), { once: true })));
  await touch.tap(page.locator('#btn'));
  expect(await clicked).toBe(true);
  const events = await log(page);
  const types = events.map((e) => e.type);
  for (const t of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click']) expect(types).toContain(t);
  const start = events.find((e) => e.type === 'touchstart')!;
  expect(start.target).toBe('btn');
  expect(near(start.touches![0].x, cx) && near(start.touches![0].y, cy)).toBe(true);
  const down = events.find((e) => e.type === 'pointerdown')!;
  expect(down.pointerType).toBe('touch');
  expect(near(down.x!, cx) && near(down.y!, cy)).toBe(true);
  expect(events.find((e) => e.type === 'touchend')!.touches).toHaveLength(0);
});

test('swipe left advances a Touch-Events carousel; moves follow a straight path', async ({ page, touch }) => {
  await touch.swipe(page.locator('#carousel'), { direction: 'left', distance: 120, steps: 6 });
  await expect(page.locator('#slide')).toHaveText('1');
  await touch.swipe(page.locator('#carousel'), { direction: 'right', distance: 120 });
  await expect(page.locator('#slide')).toHaveText('0');

  const box = (await page.locator('#carousel').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const events = await log(page);
  const firstSwipeMoves = events.filter((e) => e.type === 'touchmove').slice(0, 6);
  expect(firstSwipeMoves).toHaveLength(6);
  firstSwipeMoves.forEach((m, i) => {
    expect(near(m.touches![0].x, cx - (120 * (i + 1)) / 6)).toBe(true);
    expect(near(m.touches![0].y, cy)).toBe(true);
  });
});

test('longPress holds for the requested duration', async ({ page, touch }) => {
  await touch.longPress(page.locator('#pad'), { durationMs: 700 });
  const events = await log(page);
  const start = events.find((e) => e.type === 'touchstart')!;
  const end = events.find((e) => e.type === 'touchend')!;
  expect(end.t - start.t).toBeGreaterThan(650);
  expect(events.filter((e) => e.type === 'touchmove')).toHaveLength(0);
});

test('pan moves one finger from A to B with the given number of steps', async ({ page, touch }) => {
  await touch.pan({ x: 60, y: 80 }, { x: 400, y: 330 }, { steps: 5, durationMs: 100 });
  const events = await log(page);
  const moves = events.filter((e) => e.type === 'touchmove');
  expect(moves).toHaveLength(5);
  expect(events.find((e) => e.type === 'touchstart')!.touches![0]).toMatchObject({ x: 60, y: 80 });
  const last = moves.at(-1)!.touches![0];
  expect(near(last.x, 400) && near(last.y, 330)).toBe(true);
  // pointer capture semantics: every pointermove targets the element where the touch started
  const touchMoves = events.filter((e) => e.type === 'pointermove' && e.pointerType === 'touch');
  expect(touchMoves).toHaveLength(5);
  expect(touchMoves.every((e) => e.target === 'pad')).toBe(true);
});

test('pinch: two touches, distinct ids, distance scales by the factor; Pointer-Events zoom reads 2x', async ({ page, touch }) => {
  await touch.pinch(page.locator('#zoom'), { scale: 2, startDistance: 80, steps: 8 });
  const scale = Number(await page.locator('#scale').textContent());
  expect(scale).toBeGreaterThan(1.95);
  expect(scale).toBeLessThan(2.05);

  const events = await log(page);
  const moves = events.filter((e) => e.type === 'touchmove');
  expect(moves.length).toBeGreaterThan(0);
  for (const m of moves) expect(m.touches).toHaveLength(2);
  const [a, b] = moves.at(-1)!.touches!;
  expect(a.id).not.toBe(b.id);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(158);
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(162);

  await touch.pinch(page.locator('#zoom'), { scale: 0.5, startDistance: 160 });
  const out = Number(await page.locator('#scale').textContent());
  expect(out).toBeGreaterThan(0.45);
  expect(out).toBeLessThan(0.55);
});

test('low-level multi-touch: start/move/end individual fingers', async ({ page, touch }) => {
  await touch.start([{ id: 0, x: 100, y: 100 }]);
  await touch.start([{ id: 1, x: 200, y: 100 }]);
  await touch.move([{ id: 1, x: 220, y: 120 }]);
  await touch.end([{ id: 0, x: 100, y: 100 }]);
  await touch.end();
  const events = await log(page);
  const starts = events.filter((e) => e.type === 'touchstart');
  expect(starts.at(-1)!.touches).toHaveLength(2);
  const moves = events.filter((e) => e.type === 'touchmove');
  const lastMove = moves.at(-1)!;
  expect(lastMove.touches!.find((t) => t.id === 1)).toMatchObject({ x: 220, y: 120 });
  const ends = events.filter((e) => e.type === 'touchend');
  expect(ends.at(-1)!.touches).toHaveLength(0);
});
