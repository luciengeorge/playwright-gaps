import { gzipSync } from 'node:zlib';
import type { BrowserContext, CDPSession, Page, Route } from '@playwright/test';

/** Named network profiles. Values match Chrome DevTools' built-in presets. */
export type ThrottlePreset = 'slow-3g' | 'fast-3g' | 'fast-4g' | 'offline' | 'no-throttling';

/**
 * Custom network conditions. All bandwidth values are kilobits per second (1 kbps = 1000 bit/s).
 * `0`, `undefined` or `Infinity` means "unlimited".
 */
export interface NetworkConditions {
  downloadKbps?: number;
  uploadKbps?: number;
  /** Extra latency added to every request, in milliseconds. */
  latencyMs?: number;
  offline?: boolean;
}

export type ThrottleInput = ThrottlePreset | NetworkConditions;

/**
 * - `auto` (default): CDP on Chromium, route-based approximation elsewhere.
 * - `cdp`: force CDP (throws on Firefox/WebKit).
 * - `route`: force the route-based approximation (any browser).
 */
export type ThrottleStrategy = 'auto' | 'cdp' | 'route';

export interface ThrottleOptions {
  strategy?: ThrottleStrategy;
  /** Skip browser detection (useful for persistent contexts, where `context.browser()` is null). */
  browserName?: 'chromium' | 'firefox' | 'webkit' | string;
}

export interface ThrottleHandle {
  /** Which mechanism is actually in use. */
  readonly strategy: 'cdp' | 'route';
  readonly conditions: Required<NetworkConditions>;
  /**
   * Resolves once throttling is active on every page known so far (or on `page`).
   * On Chromium, pages opened *after* a context-level `throttle()` are attached asynchronously,
   * so `await handle.ready(page)` before the first navigation if the first request matters.
   * The `page` fixture already does this for you. No-op for the route strategy.
   */
  ready(page?: Page): Promise<void>;
  /** Swap to different conditions without re-registering anything. */
  update(conditions: ThrottleInput): Promise<void>;
  /** Remove throttling. Safe to call more than once and after the context is closed. */
  stop(): Promise<void>;
}

export const presets: Record<ThrottlePreset, Required<NetworkConditions>> = {
  // Chrome DevTools "Slow 3G": 500 kbps * 0.8, RTT 400ms * 5
  'slow-3g': { downloadKbps: 400, uploadKbps: 400, latencyMs: 2000, offline: false },
  // Chrome DevTools "Fast 3G" (a.k.a. "Slow 4G" in newer DevTools): 1.6 Mbps * 0.9 down, 750 kbps * 0.9 up, RTT 150ms * 3.75
  'fast-3g': { downloadKbps: 1440, uploadKbps: 675, latencyMs: 562.5, offline: false },
  // Chrome DevTools "Fast 4G": 9 Mbps * 0.9 down, 1.5 Mbps * 0.9 up, RTT 60ms * 2.75
  'fast-4g': { downloadKbps: 8100, uploadKbps: 1350, latencyMs: 165, offline: false },
  offline: { downloadKbps: 0, uploadKbps: 0, latencyMs: 0, offline: true },
  'no-throttling': { downloadKbps: 0, uploadKbps: 0, latencyMs: 0, offline: false },
};

export function resolveConditions(input: ThrottleInput): Required<NetworkConditions> {
  if (typeof input === 'string') {
    const preset = presets[input];
    if (!preset) {
      throw new Error(
        `playwright-gaps: unknown throttle preset "${input}". Use one of ${Object.keys(presets).join(', ')} or {downloadKbps, uploadKbps, latencyMs}.`,
      );
    }
    return { ...preset };
  }
  const norm = (v: number | undefined, name: string) => {
    if (v === undefined || v === Infinity) return 0;
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0) {
      throw new Error(`playwright-gaps: ${name} must be a non-negative number, got ${String(v)}`);
    }
    return v;
  };
  return {
    downloadKbps: norm(input.downloadKbps, 'downloadKbps'),
    uploadKbps: norm(input.uploadKbps, 'uploadKbps'),
    latencyMs: norm(input.latencyMs, 'latencyMs'),
    offline: !!input.offline,
  };
}

const isPage = (t: Page | BrowserContext): t is Page => typeof (t as Page).goto === 'function';
const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());
/** Milliseconds needed to move `bytes` through a `kbps` link. 0 kbps = unlimited. */
export const transferMs = (bytes: number, kbps: number) => (kbps > 0 ? (bytes * 8) / kbps : 0);

function isClosedError(e: unknown) {
  return /closed|Target page|has been closed|disposed|crashed/i.test(String((e as Error)?.message ?? e));
}

/**
 * Throttle a page or a whole browser context.
 *
 * ```ts
 * const handle = await throttle(page, 'slow-3g');
 * await page.goto('/');
 * await handle.stop();
 * ```
 */
export async function throttle(
  target: Page | BrowserContext,
  input: ThrottleInput,
  options: ThrottleOptions = {},
): Promise<ThrottleHandle> {
  const strategy = options.strategy ?? 'auto';
  const context = isPage(target) ? target.context() : target;
  let conditions = resolveConditions(input);

  if (strategy !== 'route') {
    const cdp = await tryCdp(target, context, () => conditions, options.browserName);
    if (cdp) {
      await setOffline(context, conditions.offline);
      return {
        strategy: 'cdp',
        get conditions() {
          return conditions;
        },
        ready: (page) => cdp.ready(page),
        async update(next) {
          conditions = resolveConditions(next);
          await setOffline(context, conditions.offline);
          await cdp.apply();
        },
        async stop() {
          await cdp.dispose();
          await setOffline(context, false);
        },
      };
    }
    if (strategy === 'cdp') {
      throw new Error('playwright-gaps: strategy "cdp" requires Chromium. Use strategy "auto" or "route".');
    }
  }

  return routeThrottle(target, context, () => conditions, (next) => (conditions = next));
}

async function setOffline(context: BrowserContext, offline: boolean) {
  try {
    await context.setOffline(offline);
  } catch (e) {
    if (!isClosedError(e)) throw e;
  }
}

/**
 * Bytes a response would take on the wire. Uses `content-length` when the response was
 * content-encoded (it then describes the compressed body); without one (chunked / HTTP/2),
 * estimates by gzipping the decoded body.
 */
export function wireBytes(headers: Record<string, string>, body: Buffer): number {
  const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
  if (!encoding || encoding === 'identity') return body.length;
  const declared = Number(headers['content-length']);
  if (Number.isFinite(declared) && declared > 0 && declared <= body.length) return declared;
  try {
    return Math.min(body.length, gzipSync(body, { level: 6 }).length);
  } catch {
    return body.length;
  }
}

/* ----------------------------- Chromium / CDP ----------------------------- */

async function tryCdp(
  target: Page | BrowserContext,
  context: BrowserContext,
  getConditions: () => Required<NetworkConditions>,
  knownBrowser?: string,
) {
  const browserName = knownBrowser ?? context.browser()?.browserType().name();
  if (browserName && browserName !== 'chromium') return undefined;

  const sessions = new Map<Page, CDPSession>();
  const pending = new Map<Page, Promise<void>>();
  // Chrome DevTools itself uses emulateNetworkConditionsByRule + overrideNetworkState; the older
  // emulateNetworkConditions is deprecated. Use the new pair and fall back if the browser lacks it.
  let legacy = false;
  const send = async (session: CDPSession, c: Required<NetworkConditions> = getConditions()) => {
    const down = c.downloadKbps > 0 ? (c.downloadKbps * 1000) / 8 : 0; // bytes/s, 0 = unlimited
    const up = c.uploadKbps > 0 ? (c.uploadKbps * 1000) / 8 : 0;
    const active = c.latencyMs > 0 || down > 0 || up > 0;
    if (!legacy) {
      try {
        await session.send('Network.emulateNetworkConditionsByRule', {
          offline: c.offline,
          matchedNetworkConditions: active
            ? [{ urlPattern: '', latency: c.latencyMs, downloadThroughput: down, uploadThroughput: up }]
            : [],
        });
        await session.send('Network.overrideNetworkState', {
          offline: c.offline,
          latency: c.latencyMs,
          downloadThroughput: down || -1,
          uploadThroughput: up || -1,
        });
        return;
      } catch (e) {
        if (isClosedError(e)) throw e;
        legacy = true;
      }
    }
    await session.send('Network.emulateNetworkConditions', {
      offline: c.offline,
      latency: c.latencyMs,
      downloadThroughput: down || -1, // -1 disables the limit
      uploadThroughput: up || -1,
    });
  };
  const attach = (page: Page): Promise<void> => {
    if (page.isClosed()) return Promise.resolve();
    let p = pending.get(page);
    if (!p) {
      p = (async () => {
        const session = await context.newCDPSession(page);
        sessions.set(page, session);
        page.once('close', () => {
          sessions.delete(page);
          pending.delete(page);
        });
        await session.send('Network.enable');
        await send(session);
      })();
      pending.set(page, p);
    }
    return p;
  };

  const pages = isPage(target) ? [target] : context.pages();
  try {
    if (pages.length) {
      for (const p of pages) await attach(p);
    } else {
      // Probe CDP availability on an empty context (e.g. Firefox persistent context with no browser()).
      if (!browserName) {
        const probe = await context.newPage();
        try {
          await context.newCDPSession(probe).then((s) => s.detach());
        } finally {
          await probe.close();
        }
      }
    }
  } catch (e) {
    if (browserName === 'chromium') throw e;
    return undefined; // not Chromium
  }

  const onPage = (p: Page) => {
    attach(p).catch(() => {});
  };
  if (!isPage(target)) context.on('page', onPage);

  return {
    async ready(page?: Page) {
      if (page) {
        if (isPage(target) && page !== target) return;
        await attach(page).catch((e) => !isClosedError(e) && Promise.reject(e));
        return;
      }
      await Promise.all([...pending.values()].map((p) => p.catch(() => {})));
    },
    async apply() {
      for (const s of sessions.values()) await send(s).catch((e) => !isClosedError(e) && Promise.reject(e));
    },
    async dispose() {
      if (!isPage(target)) context.off('page', onPage);
      for (const s of sessions.values()) {
        await send(s, presets['no-throttling']).catch(() => {});
        await s.detach().catch(() => {});
      }
      sessions.clear();
    },
  };
}

/* ---------------------- Firefox / WebKit route fallback ------------------- */

function routeThrottle(
  target: Page | BrowserContext,
  context: BrowserContext,
  getConditions: () => Required<NetworkConditions>,
  setConditions: (c: Required<NetworkConditions>) => void,
): Promise<ThrottleHandle> {
  // Shared "link" so parallel requests split bandwidth instead of each getting the full pipe.
  let downFreeAt = 0;
  let upFreeAt = 0;
  let stopped = false;
  const reserve = (which: 'down' | 'up', ms: number) => {
    if (ms <= 0) return 0;
    const now = Date.now();
    if (which === 'down') {
      downFreeAt = Math.max(now, downFreeAt) + ms;
      return downFreeAt - now;
    }
    upFreeAt = Math.max(now, upFreeAt) + ms;
    return upFreeAt - now;
  };

  const handler = async (route: Route) => {
    try {
      const c = getConditions();
      if (stopped || c.offline) return await route.fallback();
      const req = route.request();
      const upBytes = req.postDataBuffer()?.length ?? 0;
      // Half the latency before the request leaves, half after the response arrives (RTT-ish).
      await sleep(c.latencyMs / 2 + reserve('up', transferMs(upBytes, c.uploadKbps)));
      if (c.downloadKbps <= 0) {
        await sleep(c.latencyMs / 2);
        return await route.fallback();
      }
      const response = await route.fetch();
      const body = await response.body();
      // Charge what would cross the wire, not the decoded body: route.fetch() hands us decompressed
      // bytes, which for gzip/brotli HTML/JS/CSS is typically 3-6x bigger.
      const bytes = wireBytes(response.headers(), body);
      await sleep(c.latencyMs / 2 + reserve('down', transferMs(bytes, c.downloadKbps)));
      await route.fulfill({ response, body });
    } catch (e) {
      if (isClosedError(e)) return;
      // Network failure in route.fetch(): surface it to the page as a failed request.
      await route.abort('failed').catch(() => {});
    }
  };

  const install = isPage(target) ? target.route('**/*', handler) : context.route('**/*', handler);
  return install.then(async () => {
    await setOffline(context, getConditions().offline);
    return {
      strategy: 'route' as const,
      ready: async () => {},
      get conditions() {
        return getConditions();
      },
      async update(next: ThrottleInput) {
        setConditions(resolveConditions(next));
        await setOffline(context, getConditions().offline);
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        try {
          if (isPage(target)) await target.unroute('**/*', handler);
          else await context.unroute('**/*', handler);
        } catch (e) {
          if (!isClosedError(e)) throw e;
        }
        await setOffline(context, false);
      },
    };
  });
}
