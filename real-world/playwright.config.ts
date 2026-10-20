// Real-world checks: third-party touch libraries from CDNs, a real MV3 extension (uBlock Origin Lite),
// login persistence across runs, and public-site throttling (see measure.mjs). Needs internet.
//   bash real-world/fetch-ubol.sh && npx playwright test -c real-world
//   rm -rf real-world/.profiles && PHASE=1 npx playwright test -c real-world --project 'persist-*' && PHASE=2 npx playwright test -c real-world --project 'persist-*'
//   node real-world/measure.mjs chromium|firefox|webkit
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import type { GapsOptions, PersistentContextOptions } from 'playwright-gaps';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig<GapsOptions & PersistentContextOptions>({
  testDir: './e2e',
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5500', hasTouch: true },
  webServer: [
    { command: `npx --yes http-server ${path.join(here, 'site')} -p 5500 -a 127.0.0.1 -c-1 --silent`, url: 'http://127.0.0.1:5500/scroll.html', reuseExistingServer: true },
    { command: `node ${path.join(here, 'login-server.mjs')}`, url: 'http://127.0.0.1:5600/', reuseExistingServer: true },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testMatch: /libs/ },
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: /libs/ },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /libs/ },
    { name: 'ext-ubol', use: { browserName: 'chromium', extensionPaths: [path.join(here, '.ext/ubol')] }, testMatch: /extension/ },
    ...(['chromium', 'firefox', 'webkit'] as const).map((b) => ({
      name: `persist-${b}`,
      use: { browserName: b, userDataDir: path.join(here, '.profiles/{project}') },
      testMatch: /persist/,
    })),
  ],
});
