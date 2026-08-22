import { G, COURT, netHeightAt } from './config.js';

// No air drag: the flight is a clean parabola, which keeps the shot solver, the
// aiming preview and the AI's prediction all in exact agreement.

export function timeToHeight(z0, vz, targetZ) {
  const a = -0.5 * G, b = vz, c = z0 - targetZ;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = (-b + s) / (2 * a);
  const t2 = (-b - s) / (2 * a);
  const t = Math.max(t1, t2);
  return t > 0 ? t : null;
}

export function velocityFor(from, target, T) {
  const tz = target.z || 0;
  return {
    vx: (target.x - from.x) / T,
    vy: (target.y - from.y) / T,
    vz: (tz - from.z) / T + 0.5 * G * T,
  };
}

// How far above the net tape the ball passes. Null if it never reaches the net.
export function netClearance(from, v) {
  if (Math.abs(v.vy) < 1e-4) return null;
  const t = (0 - from.y) / v.vy;
  if (t <= 0) return null;
  const z = from.z + v.vz * t - 0.5 * G * t * t;
  const x = from.x + v.vx * t;
  if (Math.abs(x) > COURT.halfDoubles + 0.4) return null;
  return z - netHeightAt(x);
}

// Find a velocity that reaches the target and clears the net, lifting the arc if needed.
export function solveShot(from, target, spec) {
  const minClear = spec.clear;
  const maxT = spec.T * 2.2;
  let T = spec.T;
  let v = velocityFor(from, target, T);
  for (let i = 0; i < 18; i++) {
    const c = netClearance(from, v);
    if (c === null || c >= minClear) return { ...v, T, netted: false };
    T += Math.max(0.035, spec.T * 0.055);
    if (T > maxT) break;
    v = velocityFor(from, target, T);
  }
  const c = netClearance(from, v);
  return { ...v, T, netted: c !== null && c < 0 };
}

// Where a ball in flight will next touch the ground.
export function predictBounce(ball) {
  const t = timeToHeight(ball.z, ball.vz, 0);
  if (t == null) return null;
  return {
    x: ball.x + ball.vx * t,
    y: ball.y + ball.vy * t,
    t,
    vzAt: ball.vz - G * t,
  };
}

export function inSinglesCourt(x, y, pad = COURT.ballR) {
  return Math.abs(x) <= COURT.halfSingles + pad && Math.abs(y) <= COURT.halfLen + pad;
}

// Service boxes. side is the side of the court the serve must land in (+1 far, -1 near).
// court is 'deuce' or 'ad', from the receiver's point of view.
export function inServiceBox(x, y, side, court) {
  const pad = COURT.ballR;
  if (Math.sign(y) !== side) return false;
  const ay = Math.abs(y);
  if (ay > COURT.serviceLine + pad) return false;
  if (Math.abs(x) > COURT.halfSingles + pad) return false;
  // Deuce court always finishes on the near player's right (x > 0) and the far
  // player's right (x < 0), so the sign depends on which half it lands in.
  const wantPositiveX = side < 0 ? court === 'deuce' : court !== 'deuce';
  return wantPositiveX ? x >= -pad : x <= pad;
}

// Where a player on this side should meet the ball. Walks the trajectory forward
// (including its bounce) and stops at the first place the ball is genuinely
// playable, or at the deepest sensible standing position if it is running away.
export function predictIntercept(ball, side, retreat = 2.2, maxT = 3.2) {
  let x = ball.x, y = ball.y, z = ball.z;
  let vx = ball.vx, vy = ball.vy, vz = ball.vz;
  let bounces = ball.bounces;
  let first = null;
  const dt = 0.008;
  const limit = COURT.halfLen + retreat;
  const hardLimit = COURT.halfLen + 4.8;

  for (let t = 0; t < maxT; t += dt) {
    x += vx * dt;
    y += vy * dt;
    z += vz * dt - 0.5 * G * dt * dt;
    vz -= G * dt;
    if (z <= COURT.ballR) {
      z = COURT.ballR;
      if (vz < 0) {
        bounces++;
        if (!first) first = { x, y, t };
        vz = -vz * ball.rest;
        vx *= ball.fric;
        vy *= ball.fric;
      }
    }
    if (bounces >= 2) break;
    if (Math.sign(y) !== side) continue;
    const ay = Math.abs(y);
    if ((ay > limit && z < 2.55) || ay > hardLimit) {
      return { x, y, z, t, bounce: first, deep: true };
    }
    if (bounces >= 1 && vz < 0 && z > 0.28 && z < 1.55) {
      return { x, y, z, t, bounce: first, deep: false };
    }
  }
  if (first) return { x: first.x, y: first.y, z: 0.5, t: first.t, bounce: first, deep: false };
  return null;
}
