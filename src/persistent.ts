import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BrowserContext, TestInfo, Worker } from '@playwright/test';
import { applyNetworkConditions, contextThrottles, test as gapsTest } from './fixtures.js';

type LaunchPersistentOptions = NonNullable<Parameters<import('@playwright/test').BrowserType['launchPersistentContext']>[1]>;

export interface PersistentContextOptions {
  /**
   * Profile directory. Relative paths resolve against the current working directory.
   * - `undefined` (default): a fresh temp profile per test, deleted afterwards.
   * - a string: reused across tests and runs (state persists). Placeholders `{project}`,
   *   `{workerIndex}` and `{parallelIndex}` are substituted, e.g. `.profiles/{project}-{parallelIndex}`
   *   (Chromium locks a profile, so parallel workers need distinct directories).
   */
  userDataDir: string | undefined;
  /** Unpacked Chrome extension directories to load (Chromium only). */
  extensionPaths: string[];
  /** Extra options passed straight to `launchPersistentContext` (win over everything else). */
  persistentContextOptions: LaunchPersistentOptions;
}

export interface PersistentFixtures {
  /** ID of the first loaded MV3 extension (from its service worker URL). */
  extensionId: string;
  /** Service worker of the first loaded MV3 extension. */
  extensionServiceWorker: Worker;
}

export function expandPlaceholders(template: string, info: Pick<TestInfo, 'project' | 'workerIndex' | 'parallelIndex'>) {
  return template
    .replaceAll('{project}', info.project.name || 'default')
    .replaceAll('{workerIndex}', String(info.workerIndex))
    .replaceAll('{parallelIndex}', String(info.parallelIndex));
}

/** Context options Playwright exposes as individual `use` options that we forward. */
const FORWARDED = [
  'acceptDownloads', 'bypassCSP', 'colorScheme', 'deviceScaleFactor', 'extraHTTPHeaders', 'geolocation',
  'hasTouch', 'httpCredentials', 'ignoreHTTPSErrors', 'isMobile', 'javaScriptEnabled', 'locale', 'offline',
  'permissions', 'proxy', 'timezoneId', 'userAgent', 'viewport', 'baseURL', 'serviceWorkers',
] as const;

/**
 * `test` whose `context` and `page` come from `launchPersistentContext`, configured from
 * `playwright.config` `use` options. Includes all `playwright-gaps` fixtures (throttle, touch).
 */
export const test = gapsTest.extend<PersistentFixtures & PersistentContextOptions>({
  userDataDir: [undefined, { option: true }],
  extensionPaths: [[], { option: true }],
  persistentContextOptions: [{}, { option: true }],

  context: async (
    {
      playwright, browserName, headless, channel, launchOptions, contextOptions,
      userDataDir, extensionPaths, persistentContextOptions, networkConditions, throttleStrategy,
      // forwarded context options:
      acceptDownloads, bypassCSP, colorScheme, deviceScaleFactor, extraHTTPHeaders, geolocation, hasTouch,
      httpCredentials, ignoreHTTPSErrors, isMobile, javaScriptEnabled, locale, offline, permissions, proxy,
      timezoneId, userAgent, viewport, baseURL, serviceWorkers,
    },
    use,
    testInfo,
  ) => {
    const forwarded: Record<string, unknown> = {
      acceptDownloads, bypassCSP, colorScheme, deviceScaleFactor, extraHTTPHeaders, geolocation, hasTouch,
      httpCredentials, ignoreHTTPSErrors, isMobile, javaScriptEnabled, locale, offline, permissions, proxy,
      timezoneId, userAgent, viewport, baseURL, serviceWorkers,
    };
    for (const k of FORWARDED) if (forwarded[k] === undefined) delete forwarded[k];

    const extensions = extensionPaths.map((p) => path.resolve(p));
    if (extensions.length && browserName !== 'chromium') {
      throw new Error(
        `playwright-gaps: extensionPaths is Chromium-only (current browser: ${browserName}). ` +
          `Put extension tests in a chromium project or skip them with test.skip(({ browserName }) => browserName !== 'chromium').`,
      );
    }

    let dir: string;
    let temp = false;
    if (typeof userDataDir === 'string') dir = path.resolve(expandPlaceholders(userDataDir, testInfo));
    else {
      dir = await mkdtemp(path.join(tmpdir(), 'pw-gaps-profile-'));
      temp = true;
    }

    const args = [...(launchOptions?.args ?? []), ...(persistentContextOptions.args ?? [])];
    if (extensions.length) {
      args.push(`--disable-extensions-except=${extensions.join(',')}`, `--load-extension=${extensions.join(',')}`);
    }

    const options: LaunchPersistentOptions = {
      ...launchOptions,
      ...contextOptions,
      headless,
      ...forwarded,
      ...persistentContextOptions,
      args,
    } as LaunchPersistentOptions;
    // Branded Chrome ignores --load-extension and the headless shell has no extension support;
    // Playwright's full Chromium (`channel: 'chromium'`) supports both headed and headless.
    const ch = persistentContextOptions.channel ?? channel ?? launchOptions?.channel;
    if (ch) options.channel = ch;
    else if (extensions.length) options.channel = 'chromium';

    const context: BrowserContext = await playwright[browserName].launchPersistentContext(dir, options);
    const handle = await applyNetworkConditions(context, networkConditions, throttleStrategy, browserName);
    if (handle) contextThrottles.set(context, handle);
    try {
      await use(context);
    } finally {
      await handle?.stop().catch(() => {});
      await context.close().catch(() => {});
      if (temp) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },

  page: async ({ context }, use) => {
    // A persistent context opens with one blank tab; reuse it instead of leaving it dangling.
    const page = context.pages()[0] ?? (await context.newPage());
    await contextThrottles.get(context)?.ready(page);
    await use(page);
  },

  extensionServiceWorker: async ({ context, extensionPaths }, use) => {
    if (!extensionPaths.length) throw new Error('playwright-gaps: extensionServiceWorker needs `extensionPaths`.');
    const isExt = (w: Worker) => w.url().startsWith('chrome-extension://');
    const worker = context.serviceWorkers().find(isExt) ?? (await context.waitForEvent('serviceworker', { predicate: isExt }));
    await use(worker);
  },

  extensionId: async ({ extensionServiceWorker }, use) => {
    await use(new URL(extensionServiceWorker.url()).host);
  },
});

export { expect } from '@playwright/test';
export type { PersistentContextOptions as PersistentOptions };
