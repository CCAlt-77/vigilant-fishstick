import { clamp } from './util.js';

// How far up the screen a swipe reaches, as a fraction of its height. These
// zones are drawn on screen while the thumb is down, so the shot you are about
// to play is something you can see and adjust rather than guess at.
export const SWIPE = {
  tap: 0.035,      // below this it is a tap
  short: 0.05,     // bottom of the drive zone: a short ball
  lob: 0.34,       // above this the shot becomes a lob
  flick: 1.6,      // heights per second above which a drive flattens out
  aimWidth: 0.22,  // sideways travel, as a fraction of screen width, for full aim
};

// One thumb does everything:
//   tap                     standard drive into the open court
//   swipe up                drive; how far up you go sets how deep it lands
//   flick up fast           the same drive, hit flat and hard
//   swipe up past the top   lob
//   swipe down              drop shot
//   swipe sideways          angled slice
// The sideways part of any swipe steers the ball across the court.
export function classify(dx, dy, dtMs, w, h) {
  const len = Math.hypot(dx, dy) / h;
  const up = -dy / h;
  const dt = Math.max(0.04, dtMs / 1000);
  const speed = len / dt;
  const aim = clamp(dx / (w * SWIPE.aimWidth), -1, 1);
  const base = { aim, len, up, speed };

  if (len < SWIPE.tap) {
    return { ...base, type: 'drive', aim: 0, tap: true, depth: 0.55, power: 0.7 };
  }

  const ang = Math.atan2(-dy, dx) * 180 / Math.PI; // 90 is straight up

  if (ang > 32 && ang < 148) {
    if (up >= SWIPE.lob) {
      return { ...base, type: 'lob', depth: clamp((up - SWIPE.lob) / 0.14, 0, 1), power: 0.9 };
    }
    const depth = clamp((up - SWIPE.short) / (SWIPE.lob - SWIPE.short), 0, 1);
    const flat = speed > SWIPE.flick && up > 0.10;
    return {
      ...base,
      type: flat ? 'power' : 'drive',
      depth,
      power: clamp(0.6 + depth * 0.5 + (flat ? 0.2 : 0), 0.55, 1.3),
    };
  }

  if (ang < -32 && ang > -148) {
    return { ...base, type: 'drop', depth: clamp((-up - SWIPE.short) / 0.16, 0, 1), power: 0.8 };
  }

  return {
    ...base,
    type: 'slice',
    aim: dx >= 0 ? 1 : -1,
    depth: clamp((Math.abs(dx) / w - 0.06) / 0.26, 0, 1),
    power: 0.9,
  };
}

export class TouchInput {
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    this.active = null;
    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);

    el.addEventListener('pointerdown', this._down, { passive: false });
    el.addEventListener('pointermove', this._move, { passive: false });
    el.addEventListener('pointerup', this._up, { passive: false });
    el.addEventListener('pointercancel', this._up, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Cached: reading it on every pointermove forces a layout mid-drag, which is
  // exactly when the phone can least afford one.
  _rect() {
    if (!this._cachedRect) this._cachedRect = this.el.getBoundingClientRect();
    return this._cachedRect;
  }

  invalidateRect() { this._cachedRect = null; }

  _down(e) {
    e.preventDefault();
    if (this.active) return;
    this.invalidateRect();
    const r = this._rect();
    this.active = {
      id: e.pointerId,
      x0: e.clientX - r.left, y0: e.clientY - r.top,
      x: e.clientX - r.left, y: e.clientY - r.top,
      t0: performance.now(),
    };
    if (this.el.setPointerCapture) {
      try { this.el.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    }
    this.handlers.onStart && this.handlers.onStart(this.active);
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.active.id) return;
    e.preventDefault();
    const r = this._rect();
    this.active.x = e.clientX - r.left;
    this.active.y = e.clientY - r.top;
    const a = this.active;
    const g = classify(a.x - a.x0, a.y - a.y0, performance.now() - a.t0, r.width, r.height);
    this.handlers.onDrag && this.handlers.onDrag(g, a);
  }

  _up(e) {
    if (!this.active || e.pointerId !== this.active.id) return;
    e.preventDefault();
    const r = this._rect();
    const a = this.active;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const g = classify(x - a.x0, y - a.y0, performance.now() - a.t0, r.width, r.height);
    this.active = null;
    this.handlers.onSwipe && this.handlers.onSwipe(g);
  }
}
