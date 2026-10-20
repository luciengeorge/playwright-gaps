# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - unreleased

### Fixed
- **Throttle (Firefox/WebKit route fallback):** compressed responses were charged at their *decoded* size. On gzip-heavy sites that made pages load 3–4× slower than the same preset on Chromium (Wikipedia on slow-3g took 66–71 s vs 18 s). They are now charged at wire size, using `content-length` or a gzip estimate for chunked responses. The same page now loads in 17–20 s.
- **Touch:** gestures took much longer than `durationMs`, because every step's dispatch time was added on top of the sleep. Headless Chromium needs about 33 ms per CDP touch event, so a "150 ms" swipe took about 300 ms and Swiper.js sometimes read it as a slow drag and stayed on the same slide (21 of 100 swipes on Chromium). Moves now follow an absolute timeline and skip intermediate points when dispatch falls behind.
- `fast-3g` latency is now exactly 562.5 ms, matching Chrome DevTools (it was 563).

### Changed
- Chromium throttling now uses `Network.emulateNetworkConditionsByRule` + `Network.overrideNetworkState`, the same calls DevTools makes. The deprecated `Network.emulateNetworkConditions` is used as a fallback.
- New export `wireBytes()`.
- Added the `real-world/` suite: Swiper, Hammer.js and Leaflet from CDNs, uBlock Origin Lite, login persistence across runs, and public-site throttle timings.

## [0.1.0] - 2026-10-20

### Added
- `throttle` fixture and `throttle()` helper with the presets `slow-3g`, `fast-3g`, `fast-4g`, `offline` and `no-throttling`, plus custom `{ downloadKbps, uploadKbps, latencyMs, offline }`. Uses CDP on Chromium and a route-based approximation with a shared link on Firefox and WebKit. Has `ready()`, `update()` and `stop()`.
- `networkConditions` and `throttleStrategy` options for `playwright.config` `use`.
- `touch` fixture and `touch()` helper: `tap`, `longPress`, `swipe`, `pan`, `pinch`, plus low-level multi-touch `start`/`move`/`end`. Uses CDP on Chromium and synthetic PointerEvent + TouchEvent elsewhere. Has a `touchMode` option.
- `playwright-gaps/persistent`: `context`/`page` backed by `launchPersistentContext`, configured with the `userDataDir` (supports placeholders), `extensionPaths` and `persistentContextOptions` options. Adds the `extensionId` and `extensionServiceWorker` fixtures.
- Cross-browser test suite (Chromium, Firefox, WebKit), with ESM and CJS builds.
