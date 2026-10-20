#!/usr/bin/env bash
# Installs the packed tarball into a throwaway CommonJS project and runs a few specs against it,
# exercising the CJS build + type declarations exactly as a user would get them from npm.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$ROOT" && npm run build >/dev/null && TARBALL="$(npm pack --silent --pack-destination "$WORK")"
cp -r "$ROOT/scripts/consumer/." "$WORK/"
cp -r "$ROOT/tests/extension" "$WORK/ext"
cd "$WORK"
npm init -y >/dev/null
npm pkg set type=commonjs
PW_VERSION="$(node -p "require('$ROOT/node_modules/@playwright/test/package.json').version")"
npm i -D "./$TARBALL" "@playwright/test@$PW_VERSION" typescript@~5.9.3 >/dev/null
npx tsc --noEmit --module nodenext --moduleResolution nodenext --skipLibCheck --strict e2e/*.ts playwright.config.ts
npx playwright test
