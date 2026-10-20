import { test as base } from '@playwright/test';
import { throttle, type ThrottleHandle, type ThrottleInput, type ThrottleStrategy } from './throttle.js';
import { touch, type TouchController, type TouchMode } from './touch.js';

export interface GapsOptions {
  /** Throttle every test's context, e.g. `use: { networkConditions: 'slow-3g' }`. */
  networkConditions: ThrottleInput | undefined;
  /** `auto` (CDP on Chromium, route fallback elsewhere), `cdp` or `route`. */
  throttleStrategy: ThrottleStrategy;
  /** `auto` (CDP on Chromium, synthetic elsewhere), `cdp` or `synthetic`. */
  touchMode: 'auto' | TouchMode;
}

export interface GapsFixtures {
  /**
   * Throttle the current test's context. Calling it again replaces the previous conditions.
   * Throttling is removed automatically when the test ends.
   */
  throttle: (conditions: ThrottleInput) => Promise<ThrottleHandle>;
  /** Touch gestures on the current `page`. */
  touch: TouchController;
}

/** Internal: handles created from the `networkConditions` option, keyed by context. */
export const contextThrottles = new WeakMap<import('@playwright/test').BrowserContext, ThrottleHandle>();

/** Internal: lets persistent.ts reuse the throttle wiring. */
export async function applyNetworkConditions(
  context: import('@playwright/test').BrowserContext,
  conditions: ThrottleInput | undefined,
  strategy: ThrottleStrategy,
  browserName: string,
) {
  return conditions ? throttle(context, conditions, { strategy, browserName }) : undefined;
}

export const test = base.extend<GapsFixtures & GapsOptions>({
  networkConditions: [undefined, { option: true }],
  throttleStrategy: ['auto', { option: true }],
  touchMode: ['auto', { option: true }],

  context: async ({ context, networkConditions, throttleStrategy, browserName }, use) => {
    const handle = await applyNetworkConditions(context, networkConditions, throttleStrategy, browserName);
    if (handle) contextThrottles.set(context, handle);
    await use(context);
    await handle?.stop().catch(() => {});
  },

  page: async ({ page }, use) => {
    // Make sure `use: { networkConditions }` is active before the test's first navigation.
    await contextThrottles.get(page.context())?.ready(page);
    await use(page);
  },

  throttle: async ({ context, throttleStrategy, browserName }, use) => {
    let current: ThrottleHandle | undefined;
    await use(async (conditions) => {
      if (current) {
        await current.update(conditions);
        return current;
      }
      current = await throttle(context, conditions, { strategy: throttleStrategy, browserName });
      return current;
    });
    await current?.stop().catch(() => {});
  },

  touch: async ({ page, touchMode, browserName }, use) => {
    await use(touch(page, { mode: touchMode, browserName }));
  },
});

export { expect } from '@playwright/test';
