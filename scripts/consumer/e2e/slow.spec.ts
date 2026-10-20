import { test, expect } from 'playwright-gaps';
import { mergeTests, test as base } from '@playwright/test';
const mine = base.extend<{ greeting: string }>({ greeting: async ({}, use) => use('hi') });
const t = mergeTests(mine, test);
t('merged + throttle + touch', async ({ page, throttle, touch, greeting }) => {
  expect(greeting).toBe('hi');
  await page.setContent('<button onclick="this.textContent=\'tapped\'">x</button>');
  await touch.tap(page.locator('button'));
  await expect(page.locator('button')).toHaveText('tapped');
  const h = await throttle({ latencyMs: 300 });
  const t0 = Date.now(); await page.goto('about:blank');
  expect(h.conditions.latencyMs).toBe(300);
  console.log('strategy', h.strategy, Date.now() - t0);
});
