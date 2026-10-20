# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

### Added
- `throttle` fixture and `throttle()` helper with the presets `slow-3g`, `fast-3g`, `fast-4g`, `offline` and `no-throttling`, plus custom `{ downloadKbps, uploadKbps, latencyMs, offline }`. Uses CDP on Chromium and a route-based approximation with a shared link on Firefox and WebKit. Has `ready()`, `update()` and `stop()`.
- `networkConditions` and `throttleStrategy` options for `playwright.config` `use`.
- `touch` fixture and `touch()` helper: `tap`, `longPress`, `swipe`, `pan`, `pinch`, plus low-level multi-touch `start`/`move`/`end`. Uses CDP on Chromium and synthetic PointerEvent + TouchEvent elsewhere. Has a `touchMode` option.
- `playwright-gaps/persistent`: `context`/`page` backed by `launchPersistentContext`, configured with the `userDataDir` (supports placeholders), `extensionPaths` and `persistentContextOptions` options. Adds the `extensionId` and `extensionServiceWorker` fixtures.
- Cross-browser test suite (Chromium, Firefox, WebKit), with ESM and CJS builds.
