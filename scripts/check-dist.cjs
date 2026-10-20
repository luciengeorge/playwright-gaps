// Smoke test: the CJS build loads and exposes the public API.
const gaps = require('playwright-gaps');
const persistent = require('playwright-gaps/persistent');
const need = ['test', 'expect', 'throttle', 'touch', 'presets', 'resolveConditions', 'persistentTest'];
for (const k of need) if (!(k in gaps)) throw new Error(`CJS build missing export: ${k}`);
if (typeof persistent.test !== 'function') throw new Error('CJS persistent.test missing');
console.log('CJS OK:', need.join(', '));
