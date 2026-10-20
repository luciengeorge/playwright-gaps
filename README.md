# playwright-gaps

Playwright Test fixtures for three features the Playwright team has decided not to build:

| Feature | Upstream issue | Status upstream |
| --- | --- | --- |
| Network throttling presets (`slow-3g`, `fast-3g`, …) | [microsoft/playwright#8622](https://github.com/microsoft/playwright/issues/8622) | closed, not planned |
| Touch gestures: `tap`, `swipe`, `longPress`, `pan`, `pinch` | [microsoft/playwright#2903](https://github.com/microsoft/playwright/issues/2903) (the maintainers link to the [touch events guide](https://playwright.dev/docs/touch-events)) | closed, not planned |
| `launchPersistentContext` / Chrome extensions configured in `playwright.config` | [microsoft/playwright#11833](https://github.com/microsoft/playwright/issues/11833) ("implement and maintain your own lightweight fixtures") | closed, not planned |

This package is those "lightweight fixtures", written once and tested on Chromium, Firefox and WebKit. It isn't affiliated with Microsoft or the Playwright project.

```sh
npm i -D playwright-gaps
```

Requires `@playwright/test` >= 1.40 as a peer dependency. CI runs against 1.64. Node >= 18. Ships ESM and CJS with types.

---

## 30-second examples

### Network throttling

```ts
// e2e/slow.spec.ts
import { test, expect } from 'playwright-gaps';

test('shows a skeleton on slow 3G', async ({ page, throttle }) => {
  await throttle('slow-3g'); // or 'fast-3g' | 'fast-4g' | 'offline' | { downloadKbps, uploadKbps, latencyMs }
  await page.goto('/');
  await expect(page.getByTestId('skeleton')).toBeVisible();
});
```

To throttle a whole project or file, set it in `use`:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { GapsOptions } from 'playwright-gaps';

export default defineConfig<GapsOptions>({
  projects: [{ name: 'slow-3g', use: { networkConditions: 'slow-3g' } }],
});
```

Without the fixture (any `Page` or `BrowserContext`):

```ts
import { throttle } from 'playwright-gaps';
const handle = await throttle(page, { downloadKbps: 1600, uploadKbps: 750, latencyMs: 150 });
await handle.update('offline');
await handle.stop();
```

Presets use the Chrome DevTools values:

| preset | down kbps | up kbps | latency ms |
| --- | --- | --- | --- |
| `slow-3g` | 400 | 400 | 2000 |
| `fast-3g` | 1440 | 675 | 563 |
| `fast-4g` | 8100 | 1350 | 165 |
| `offline` | – | – | – (uses `context.setOffline`) |

### Touch gestures

```ts
import { test, expect } from 'playwright-gaps';

test.use({ hasTouch: true }); // recommended (Firefox only exposes TouchEvent with it)

test('carousel + pinch zoom', async ({ page, touch }) => {
  await page.goto('/gallery');
  await touch.swipe(page.locator('.carousel'), { direction: 'left', distance: 200 });
  await touch.pinch(page.locator('img.zoomable'), { scale: 2 });
  await touch.longPress(page.getByText('Hold me'), { durationMs: 800 });
  await touch.tap(page.getByRole('button', { name: 'Close' }));
  await touch.pan({ x: 50, y: 400 }, { x: 50, y: 100 }, { steps: 20 });
});
```

Multi-touch at a lower level: `touch.start([{ id: 0, x, y }, { id: 1, x, y }])`, `touch.move(...)`, `touch.end()`.
Standalone: `import { touch } from 'playwright-gaps'; const t = touch(page);`.

### Persistent context and Chrome extensions from `playwright.config`

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { PersistentContextOptions } from 'playwright-gaps';

export default defineConfig<PersistentContextOptions>({
  projects: [{
    name: 'extension',
    use: {
      extensionPaths: ['./dist/my-extension'],  // unpacked MV3 extension(s), Chromium only
      // userDataDir: '.profiles/{project}-{parallelIndex}',  // optional; default is a fresh temp profile per test
    },
  }],
});
```

```ts
// e2e/extension.spec.ts
import { test, expect } from 'playwright-gaps/persistent';

test('popup renders', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('heading')).toHaveText('Hello');
});
```

`playwright-gaps/persistent` replaces `context` and `page` with a `launchPersistentContext` context. It forwards your normal `use` options (`viewport`, `baseURL`, `locale`, `hasTouch`, `launchOptions`, `contextOptions`, `headless`, `channel`, …). It also exposes `extensionId` and `extensionServiceWorker`, and the `throttle`/`touch` fixtures still work. Pass anything else through `persistentContextOptions`.

You can set `userDataDir` to keep state (cookies, localStorage, extension storage) across tests and runs. It accepts the placeholders `{project}`, `{workerIndex}` and `{parallelIndex}`. Chromium locks a profile, so parallel workers need different directories.

---

## Browser support

What the test suite in this repo checks on each engine (`npm test`):

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| **Throttle: mechanism** | CDP `Network.emulateNetworkConditions` | route-based approximation | route-based approximation |
| Latency | ✅ | ✅ (approx.) | ✅ (approx.) |
| Download bandwidth | ✅ | ✅ (approx., see below) | ✅ (approx.) |
| Upload bandwidth | ✅ | ✅ (approx.) | ✅ (approx.) |
| Offline | ✅ (`setOffline`) | ✅ (`setOffline`) | ✅ (`setOffline`) |
| **Touch: mechanism** | CDP `Input.dispatchTouchEvent`: trusted events | synthetic `PointerEvent` + `TouchEvent` | synthetic `PointerEvent` + `TouchEvent` |
| tap / swipe / longPress / pan / pinch reach page listeners with correct coordinates | ✅ | ✅ | ✅ |
| Native default actions (scroll, browser pinch-zoom, `click` from tap) | ✅ | ❌ (we dispatch `mousedown`/`mouseup`/`click` on tap) | ❌ (same) |
| **Persistent context** | ✅ | ✅ | ✅ |
| Chrome extensions (`extensionPaths`, `extensionId`) | ✅ (MV3, Playwright's Chromium, headed or headless) | n/a | n/a |

## Known limitations, honestly

**Throttling on Firefox/WebKit is an approximation.** These engines have no network-emulation protocol that Playwright exposes. The fallback therefore intercepts every request with `route('**/*')`, waits for the latency, fetches the response, holds it for `bytes × 8 / downloadKbps` and then fulfills it. Concurrent requests share one simulated link. What this means in practice:
- The response arrives all at once at the end. It is not streamed, so progressive rendering and streaming responses look different from a real slow network.
- WebSockets, EventSource streams, service-worker-initiated requests and requests served from the browser cache are not throttled.
- `route.fetch()` follows redirects itself, so the browser sees only the final response.
- **Call `throttle()` before you register your own `page.route` mocks.** Playwright runs the most recently registered route first, so mocks added after `throttle()` respond without any delay. Mocks added before it get bypassed, because the throttle handler fetches from the network.
- You can force this mode on Chromium with `throttleStrategy: 'route'` if you need identical behaviour on every browser.

**Throttling on Chromium**
- It is per page via CDP. Pages opened after a context-level `throttle()` are attached asynchronously. The `page` fixture waits for this, but if you open pages yourself, run `await handle.ready(newPage)` before the first request.
- Service workers and Web Workers that make their own requests are not covered.

**Touch on Firefox/WebKit uses synthetic events.** `isTrusted` is `false`, the browser does no native scrolling or pinch-zoom, and nothing goes through the `touch-action` CSS property. Your app's own touch and pointer handlers *do* run, which covers most gesture code: carousels, drawers, maps and custom zoom. Also:
- Events go to the element at `document.elementFromPoint` when the touch starts and stay "captured" there, like real touch.
- Elements inside iframes and closed shadow roots are not reached.
- WebKit has no public `Touch` constructor, so `touches` / `changedTouches` are attached to the event as array-likes with `.item()`.
- Firefox only exposes `TouchEvent` when `hasTouch: true`. Without it you get pointer events only.

**Touch on Chromium** uses CDP. Real Chromium behaviours apply: a long press can trigger `contextmenu`, and touch can scroll the page unless your CSS sets `touch-action`.

**Persistent context**
- It is test-scoped, so a browser launches per test. That is slower than the default shared browser, so keep it to the projects that need it.
- Video and trace settings may not apply the same way they do for regular contexts.
- `storageState` doesn't apply to persistent contexts. Use `userDataDir` instead.
- Extensions need Playwright's bundled Chromium. If you don't set a channel, we set `channel: 'chromium'`, because branded Chrome stable ignores `--load-extension` and the headless shell can't load extensions. Only MV3 extensions are supported (we find the ID from the service worker).

## API reference (short)

- `test`, `expect`: `@playwright/test` extended with the `throttle` and `touch` fixtures and the options `networkConditions`, `throttleStrategy` and `touchMode`.
- `persistentTest` (also exported as `test` from `playwright-gaps/persistent`): all of the above, plus the options `userDataDir`, `extensionPaths` and `persistentContextOptions`, and the fixtures `extensionId` and `extensionServiceWorker`.
- `throttle(pageOrContext, preset | conditions, { strategy?, browserName? })` returns `{ strategy, conditions, ready(), update(), stop() }`.
- `touch(page, { mode? })` returns `{ mode, tap, longPress, swipe, pan, pinch, start, move, end }`.
- `presets`, `resolveConditions()`.

It also works with `mergeTests`: `mergeTests(myTest, gapsTest)`. Type your config with `defineConfig<GapsOptions & PersistentContextOptions>()` so the custom `use` options type-check.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md). `npm test` builds the package first and then runs the suite against the built ESM output on all three engines. `npm run test:consumer` installs the packed tarball into a CommonJS project and runs specs there too.

## License

MIT
