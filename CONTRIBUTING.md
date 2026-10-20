# Contributing

Thanks for helping fill the gaps.

## Setup

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run typecheck
npm test            # all three browsers
npm test -- --project=firefox tests/touch.spec.ts
npm run build && npm run test:dist
```

The tests run against local HTML in `tests/site/`, served by `tests/server.mjs` with no dependencies. That server also provides `/bytes?kb=N`, `/upload` and `/heavy.html`. The test extension is in `tests/extension/`.

## Ground rules

- **Every behaviour needs a test that measures it.** For throttling that means elapsed time, for touch the events and coordinates the page received, and for persistence the state seen by a new context. A "doesn't throw" test isn't enough.
- **Be honest about engines.** If something is approximate or only works on Chromium, the README support matrix and limitations section must say so in the same PR.
- **Keep timing tolerances generous enough for CI**, but tight enough that a broken implementation fails. Assert a lower bound near the theoretical value and a loose upper bound.
- No runtime dependencies. `@playwright/test` is the only peer dependency.
- Public API changes need a CHANGELOG entry under "Unreleased".

## Scope

This package covers Playwright features that upstream has declined and that can be built on public APIs (CDP, routing, page scripts). Suggestions are welcome as issues. Please link the upstream issue where the feature was declined.

## Releasing (maintainers)

1. Bump the version and move the CHANGELOG entries.
2. Make sure `npm run typecheck && npm test && npm run build && npm run test:dist` passes.
3. Run `npm publish --provenance`. This happens from CI or a maintainer machine, never automatically on push.
