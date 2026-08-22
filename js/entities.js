import { G, COURT } from './config.js';
import { clamp, approach } from './util.js';

export class Ball {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.rest = 0.74;
    this.fric = 0.80;
    this.live = false;
    this.bounces = 0;
    this.lastHitBy = -1;
    this.hitCount = 0;
    this.isServe = false;
    this.held = true;         // sitting in the server's hand
    this.trail = [];
    this.lastBounceSide = 0;
    this.shot = 'drive';
    this.clippedNet = false;
    this.speedKmh = 0;
  }

  launch(vx, vy, vz, spec, by) {
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.rest = spec.rest;
    this.fric = spec.fric;
    this.live = true;
    this.held = false;
    this.bounces = 0;
    this.lastHitBy = by;
    this.hitCount++;
    this.trail.length = 0;
    this.clippedNet = false;
    this.speedKmh = Math.hypot(vx, vy, vz) * 3.6;
  }

  // Integrates one fixed step and reports the events that happened inside it.
  step(dt, events) {
    if (!this.live) return;
    const py = this.y;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt - 0.5 * G * dt * dt;
    this.vz -= G * dt;

    // Net plane.
    if ((py < 0 && this.y >= 0) || (py > 0 && this.y <= 0)) {
      const frac = Math.abs(py) / Math.max(1e-6, Math.abs(py) + Math.abs(this.y));
      const nx = this.x - this.vx * dt * (1 - frac);
      const nz = this.z - (this.vz + G * dt) * dt * (1 - frac);
      events.push({ type: 'net-plane', x: nx, z: nz, fromY: py });
    }

    if (this.z <= COURT.ballR) {
      this.z = COURT.ballR;
      if (this.vz < 0) {
        this.bounces++;
        this.lastBounceSide = Math.sign(this.y) || 1;
        const impact = Math.abs(this.vz);
        this.vz = impact * this.rest;
        this.vx *= this.fric;
        this.vy *= this.fric;
        events.push({ type: 'bounce', x: this.x, y: this.y, impact });
        if (impact < 0.9 && Math.hypot(this.vx, this.vy) < 1.2) {
          this.vz = 0;
          this.z = COURT.ballR;
        }
      }
    }

    this.trail.push(this.x, this.y, this.z);
    if (this.trail.length > 42) this.trail.splice(0, 3);
  }
}

export class Player {
  constructor(idx, colours) {
    this.idx = idx;
    this.side = idx === 0 ? -1 : 1;
    this.colours = colours;
    this.x = 0;
    this.y = this.side * (COURT.halfLen + 1.0);
    this.vx = 0;
    this.vy = 0;
    this.speed = 7.2;
    this.reach = 1.72;
    this.runPhase = 0;
    this.swing = { active: false, t: 0, dur: 0.34, dir: 1, type: 'drive', power: 1 };
    this.serveAnim = 0;
    this.targetX = 0;
    this.targetY = this.y;
    this.lunge = 0;
    this.recover = 0;
    this.readyBounce = 0;
  }

  homeSpot() {
    return { x: 0, y: this.side * (COURT.halfLen + 0.75) };
  }

  moveTowards(tx, ty, dt, speedScale = 1) {
    const limitX = COURT.halfDoubles + 2.6;
    tx = clamp(tx, -limitX, limitX);
    ty = this.side < 0
      ? clamp(ty, -(COURT.halfLen + 5.2), -0.9)
      : clamp(ty, 0.9, COURT.halfLen + 5.2);

    this.targetX = tx;
    this.targetY = ty;

    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const spd = this.speed * speedScale * (this.recover > 0 ? 0.28 : 1);
    if (dist < 0.03) {
      this.vx = approach(this.vx, 0, spd * 4 * dt);
      this.vy = approach(this.vy, 0, spd * 4 * dt);
      return;
    }
    const step = Math.min(dist, spd * dt);
    const nx = (dx / dist) * step;
    const ny = (dy / dist) * step;
    this.x += nx;
    this.y += ny;
    this.vx = nx / dt;
    this.vy = ny / dt;
    this.runPhase += (step / 0.85) * Math.PI;
  }

  startSwing(type, dir, power) {
    // Follow-through: you cannot sprint out of a shot instantly, which is what
    // makes hitting into the open court worth doing.
    this.recover = type === 'lob' || type === 'drop' ? 0.20 : 0.30;
    this.swing.active = true;
    this.swing.t = 0;
    this.swing.dur = type === 'lob' ? 0.42 : type === 'drop' ? 0.36 : 0.30;
    this.swing.dir = dir;
    this.swing.type = type;
    this.swing.power = power;
  }

  update(dt) {
    if (this.swing.active) {
      this.swing.t += dt;
      if (this.swing.t >= this.swing.dur) this.swing.active = false;
    }
    if (this.serveAnim > 0) this.serveAnim = Math.max(0, this.serveAnim - dt);
    this.lunge = Math.max(0, this.lunge - dt * 2.2);
    this.recover = Math.max(0, this.recover - dt);
  }

  distanceTo(ball) {
    return Math.hypot(ball.x - this.x, ball.y - this.y);
  }
}
