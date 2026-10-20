import type { CDPSession, Locator, Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}
/** A Locator (its centre is used) or a viewport point in CSS pixels. */
export type TouchTarget = Locator | Point;

export type TouchMode = 'cdp' | 'synthetic';

export interface TouchOptions {
  /**
   * `auto` (default): CDP `Input.dispatchTouchEvent` on Chromium (trusted events, native default actions),
   * synthetic `TouchEvent` + `PointerEvent` dispatch elsewhere.
   */
  mode?: 'auto' | TouchMode;
}

export interface GestureTiming {
  /** Total duration of the movement. */
  durationMs?: number;
  /**
   * Maximum number of touchmove events. Intermediate moves are dropped if dispatching can't keep up
   * with `durationMs` (headless Chromium needs ~16-33ms per CDP touch event), so the gesture keeps its speed.
   */
  steps?: number;
}

export interface SwipeOptions extends GestureTiming {
  direction: 'left' | 'right' | 'up' | 'down';
  /** Distance in CSS pixels. Default 150. */
  distance?: number;
}

export interface PinchOptions extends GestureTiming {
  /** End distance / start distance. `2` = zoom in 2x, `0.5` = zoom out. */
  scale: number;
  /** Initial distance between the two fingers in CSS pixels. Default 100. */
  startDistance?: number;
  /** Angle of the line between the fingers, degrees. 0 = horizontal. */
  angle?: number;
}

export interface TouchPoint extends Point {
  id: number;
}

export interface TouchController {
  readonly mode: TouchMode;
  tap(target: TouchTarget, options?: { holdMs?: number }): Promise<void>;
  longPress(target: TouchTarget, options?: { durationMs?: number }): Promise<void>;
  swipe(target: TouchTarget, options: SwipeOptions): Promise<void>;
  pan(from: TouchTarget, to: TouchTarget, options?: GestureTiming): Promise<void>;
  pinch(target: TouchTarget, options: PinchOptions): Promise<void>;
  /** Low-level: start/move/end arbitrary touch points (multi-touch supported). */
  start(points: TouchPoint[]): Promise<void>;
  move(points: TouchPoint[]): Promise<void>;
  end(points?: TouchPoint[]): Promise<void>;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function resolvePoint(target: TouchTarget): Promise<Point> {
  if (typeof (target as Locator).boundingBox !== 'function') return target as Point;
  const locator = target as Locator;
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`playwright-gaps: touch target is not visible: ${String(locator)}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

type Phase = 'start' | 'move' | 'end' | 'cancel';

interface Driver {
  mode: TouchMode;
  /** active = all fingers currently down after this event; changed = fingers that changed. */
  send(phase: Phase, active: TouchPoint[], changed: TouchPoint[], opts?: { click?: boolean }): Promise<void>;
}

function cdpDriver(page: Page): Driver {
  let session: Promise<CDPSession> | undefined;
  const get = () => (session ??= page.context().newCDPSession(page));
  page.once('close', () => (session = undefined));
  const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' } as const;
  return {
    mode: 'cdp',
    async send(phase, active) {
      const s = await get();
      // CDP semantics: touchStart/touchMove carry every finger currently down; a finger missing
      // from a touchMove is released. touchEnd/touchCancel carry no points and release everything.
      if (phase === 'end' && active.length > 0) {
        await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: active.map(toCdp) });
        return;
      }
      await s.send('Input.dispatchTouchEvent', {
        type: type[phase],
        touchPoints: phase === 'end' || phase === 'cancel' ? [] : active.map(toCdp),
      });
    },
  };
}
const toCdp = (p: TouchPoint) => ({ x: p.x, y: p.y, id: p.id, radiusX: 1, radiusY: 1, force: 1 });

/**
 * Runs in the page. Kept as a plain JavaScript string on purpose: a bundler (e.g. tsup's CJS output)
 * would otherwise rewrite `??`/`?.` into helper calls that don't exist inside the page.
 */
const SYNTHETIC_DISPATCH = String.raw`(arg) => {
  const w = window;
  const st = w.__pwGapsTouch || (w.__pwGapsTouch = { targets: new Map(), primary: undefined });
  const phase = arg.phase;
  if (phase === 'start') {
    for (const p of arg.changed) {
      st.targets.set(p.id, document.elementFromPoint(p.x, p.y) || document.body);
      if (st.primary === undefined) st.primary = p.id;
    }
  }
  const targetOf = (id) => st.targets.get(id) || document.body;

  const makeTouch = (p) => {
    const target = targetOf(p.id);
    const init = {
      identifier: p.id, target, clientX: p.x, clientY: p.y,
      pageX: p.x + window.scrollX, pageY: p.y + window.scrollY,
      screenX: p.x + window.screenX, screenY: p.y + window.screenY,
      radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
    };
    try {
      return new Touch(init);
    } catch (e) {
      if (typeof document.createTouch === 'function') {
        try {
          return document.createTouch(window, target, p.id, init.pageX, init.pageY, init.screenX, init.screenY);
        } catch (e2) { /* fall through */ }
      }
      return init; // plain object with the shape listeners read
    }
  };
  const list = (touches) => {
    const l = touches.slice();
    l.item = (i) => (i < l.length ? l[i] : null);
    return l;
  };

  const pointerType = { start: 'pointerdown', move: 'pointermove', end: 'pointerup', cancel: 'pointercancel' }[phase];
  const touchType = { start: 'touchstart', move: 'touchmove', end: 'touchend', cancel: 'touchcancel' }[phase];
  let touchPrevented = false;

  // 1) Pointer events fire before touch events, as in real browsers.
  for (const p of arg.changed) {
    const down = phase === 'start' || phase === 'move';
    targetOf(p.id).dispatchEvent(new PointerEvent(pointerType, {
      bubbles: true, cancelable: phase !== 'cancel', composed: true,
      pointerId: p.id + 2, pointerType: 'touch', isPrimary: p.id === st.primary,
      clientX: p.x, clientY: p.y, screenX: p.x + window.screenX, screenY: p.y + window.screenY,
      width: 1, height: 1, pressure: down ? 0.5 : 0, button: phase === 'move' ? -1 : 0, buttons: down ? 1 : 0,
    }));
  }

  // 2) Touch events, one per distinct target of the changed touches.
  if (typeof TouchEvent === 'function') {
    const all = arg.active.map(makeTouch);
    const changedTouches = arg.changed.map(makeTouch);
    const byTarget = new Map();
    for (const t of changedTouches) {
      const el = targetOf(t.identifier);
      byTarget.set(el, (byTarget.get(el) || []).concat([t]));
    }
    for (const [el, changedForEl] of byTarget) {
      const lists = {
        touches: all,
        targetTouches: all.filter((t) => targetOf(t.identifier) === el),
        changedTouches: changedForEl,
      };
      const base = { bubbles: true, cancelable: phase !== 'cancel', composed: true };
      let ev;
      try {
        ev = new TouchEvent(touchType, Object.assign({}, base, lists));
        if (ev.changedTouches.length !== changedForEl.length) throw new Error('lists dropped');
      } catch (e) {
        // WebKit: Touch has no public constructor, so attach the lists to a bare TouchEvent.
        ev = new TouchEvent(touchType, base);
        for (const k of Object.keys(lists)) Object.defineProperty(ev, k, { value: list(lists[k]), enumerable: true });
      }
      el.dispatchEvent(ev);
      if (ev.defaultPrevented) touchPrevented = true;
    }
  }

  if (phase === 'end' || phase === 'cancel') {
    const ended = arg.changed[0];
    if (phase === 'end' && arg.click && ended && !touchPrevented) {
      const el = targetOf(ended.id);
      const init = { bubbles: true, cancelable: true, composed: true, clientX: ended.x, clientY: ended.y, button: 0, detail: 1 };
      el.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, init)));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.dispatchEvent(new MouseEvent('click', init));
    }
    for (const p of arg.changed) st.targets.delete(p.id);
    if (arg.active.length === 0) st.primary = undefined;
  }
}`;

function syntheticDriver(page: Page): Driver {
  return {
    mode: 'synthetic',
    async send(phase, active, changed, opts) {
      const arg = JSON.stringify({ phase, active, changed, click: !!opts?.click });
      await page.evaluate(`(${SYNTHETIC_DISPATCH})(${arg})`);
    },
  };
}

function isChromium(page: Page) {
  return page.context().browser()?.browserType().name() === 'chromium';
}

/**
 * Create a touch controller for a page.
 *
 * ```ts
 * const t = touch(page);
 * await t.swipe(page.locator('.carousel'), { direction: 'left' });
 * await t.pinch(page.locator('img'), { scale: 2 });
 * ```
 */
export function touch(page: Page, options: TouchOptions & { browserName?: string } = {}): TouchController {
  const want = options.mode ?? 'auto';
  const chromium = options.browserName ? options.browserName === 'chromium' : isChromium(page);
  if (want === 'cdp' && !chromium) throw new Error('playwright-gaps: touch mode "cdp" requires Chromium.');
  const driver = want === 'synthetic' || !chromium ? syntheticDriver(page) : cdpDriver(page);

  let active: TouchPoint[] = [];
  const upsert = (pts: TouchPoint[]) => {
    for (const p of pts) {
      const i = active.findIndex((a) => a.id === p.id);
      if (i >= 0) active[i] = { ...p };
      else active.push({ ...p });
    }
  };

  const endImpl = async (points: TouchPoint[] | undefined, click: boolean) => {
    const ending = points ?? [...active];
    const ids = new Set(ending.map((p) => p.id));
    const last = ending.map((p) => active.find((a) => a.id === p.id) ?? p);
    active = active.filter((a) => !ids.has(a.id));
    await driver.send('end', [...active], last, { click });
  };

  const ctl: TouchController = {
    mode: driver.mode,
    async start(points) {
      upsert(points);
      await driver.send('start', [...active], points);
    },
    async move(points) {
      upsert(points);
      await driver.send('move', [...active], points);
    },
    end: (points) => endImpl(points, false),
    async tap(target, opts = {}) {
      const p = await resolvePoint(target);
      await ctl.start([{ id: 0, ...p }]);
      await sleep(opts.holdMs ?? 0);
      // CDP: Chromium synthesises the click natively. Synthetic: we dispatch mousedown/mouseup/click.
      await endImpl(undefined, true);
    },
    async longPress(target, opts = {}) {
      const p = await resolvePoint(target);
      await ctl.start([{ id: 0, ...p }]);
      await sleep(opts.durationMs ?? 800);
      await ctl.end();
    },
    async pan(from, to, opts = {}) {
      const a = await resolvePoint(from);
      const b = await resolvePoint(to);
      await path(ctl, [{ id: 0, from: a, to: b }], opts);
    },
    async swipe(target, opts) {
      const a = await resolvePoint(target);
      const d = opts.distance ?? 150;
      const dx = opts.direction === 'left' ? -d : opts.direction === 'right' ? d : 0;
      const dy = opts.direction === 'up' ? -d : opts.direction === 'down' ? d : 0;
      await path(ctl, [{ id: 0, from: a, to: { x: a.x + dx, y: a.y + dy } }], { durationMs: 150, steps: 8, ...opts });
    },
    async pinch(target, opts) {
      if (!(opts.scale > 0)) throw new Error('playwright-gaps: pinch scale must be > 0');
      const c = await resolvePoint(target);
      const r0 = (opts.startDistance ?? 100) / 2;
      const r1 = r0 * opts.scale;
      const rad = ((opts.angle ?? 0) * Math.PI) / 180;
      const ux = Math.cos(rad);
      const uy = Math.sin(rad);
      await path(
        ctl,
        [
          { id: 0, from: { x: c.x - ux * r0, y: c.y - uy * r0 }, to: { x: c.x - ux * r1, y: c.y - uy * r1 } },
          { id: 1, from: { x: c.x + ux * r0, y: c.y + uy * r0 }, to: { x: c.x + ux * r1, y: c.y + uy * r1 } },
        ],
        { durationMs: 300, steps: 10, ...opts },
      );
    },
  };
  return ctl;
}

async function path(
  ctl: TouchController,
  fingers: { id: number; from: Point; to: Point }[],
  opts: GestureTiming,
) {
  const steps = Math.max(1, Math.round(opts.steps ?? 10));
  const duration = Math.max(0, opts.durationMs ?? 250);
  const at = (i: number) =>
    fingers.map((f) => ({
      id: f.id,
      x: f.from.x + ((f.to.x - f.from.x) * i) / steps,
      y: f.from.y + ((f.to.y - f.from.y) * i) / steps,
    }));
  await ctl.start(fingers.map((f) => ({ id: f.id, ...f.from })));
  // Moves are scheduled against an absolute timeline so the gesture takes `durationMs`
  // (velocity-sensitive libraries such as Swiper and Hammer care). Each dispatch has a cost
  // (headless Chromium acknowledges a CDP touch event after ~1-2 frames), so when we fall behind
  // we skip intermediate points rather than stretching the gesture. The final point is always sent.
  const t0 = Date.now();
  let i = 0;
  while (i < steps) {
    if (duration > 0) {
      await sleep(t0 + ((i + 1) * duration) / steps - Date.now());
      const due = Math.floor(((Date.now() - t0) / duration) * steps);
      i = Math.min(steps, Math.max(i + 1, due));
    } else {
      i++;
    }
    await ctl.move(at(i));
  }
  await ctl.end();
}
