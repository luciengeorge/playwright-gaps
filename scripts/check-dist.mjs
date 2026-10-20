// Smoke test: the ESM build loads and exposes the public API.
import * as gaps from 'playwright-gaps';
import * as persistent from 'playwright-gaps/persistent';
const need = ['test', 'expect', 'throttle', 'touch', 'presets', 'resolveConditions', 'wireBytes', 'persistentTest'];
for (const k of need) if (!(k in gaps)) throw new Error(`ESM build missing export: ${k}`);
if (typeof persistent.test !== 'function') throw new Error('ESM persistent.test missing');
console.log('ESM OK:', need.join(', '));
