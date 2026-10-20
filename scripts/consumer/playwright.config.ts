import { defineConfig } from '@playwright/test';
import type { GapsOptions, PersistentContextOptions } from 'playwright-gaps';
export default defineConfig<GapsOptions & PersistentContextOptions>({
  testDir: 'e2e',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', hasTouch: true }, testIgnore: /extension/ },
    { name: 'firefox', use: { browserName: 'firefox', hasTouch: true }, testIgnore: /extension/ },
    { name: 'slow-3g', use: { browserName: 'webkit', networkConditions: 'fast-3g' }, testMatch: /slow/ },
    { name: 'extension', use: { browserName: 'chromium', extensionPaths: ['./ext'] }, testMatch: /extension/ },
  ],
});
