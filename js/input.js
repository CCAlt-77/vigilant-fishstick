import { clamp } from './util.js';

// Gesture recogniser. One thumb does everything:
//   tap                -> standard drive
//   fast flick upwards -> flat power drive
//   long slow drag up  -> lob
//   swipe downwards    -> drop shot
//   swipe sideways     -> angled slice
// The horizontal part of any swipe steers the shot left or right.
export function classify(dx, dy, dtMs, w, h) {
  const len = Math.hypot(dx, dy) / h;
  const dt = Math.max(0.04, dtMs / 1000);
  const speed = len / dt;                      // screen heights per second
  const aim = clamp(dx / (w * 0.30), -1, 1);

  if (len < 0.035) return { type: 'drive', aim: 0, power: 0.55, tap: true };

  const ang = Math.atan2(-dy, dx) * 180 / Math.PI; // 90 = straight up

  if (ang > 32 && ang < 148) {
    if (speed > 1.45 && len > 0.10) {
      return { type: 'power', aim, power: clamp(0.7 + len * 1.1, 0.6, 1.25) };
    }
    if (len > 0.20 && speed < 1.15) {
      return { type: 'lob', aim, power: clamp(0.6 + len * 0.7, 0.55, 1.15) };
    }
    return { type: 'drive', aim, power: clamp(0.55 + len * 1.4, 0.5, 1.2) };
  }

  if (ang < -32 && ang > -148) {
    return { type: 'drop', aim, power: clamp(0.5 + len * 0.6, 0.45, 1.0) };
  }

  return { type: 'slice', aim: dx >= 0 ? 1 : -1, power: clamp(0.55 + len * 0.9, 0.5, 1.15) };
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

  _rect() { return this.el.getBoundingClientRect(); }

  _down(e) {
    e.preventDefault();
    if (this.active) return;
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
    this.handlers.onStart && this.handlers.onStart();
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
