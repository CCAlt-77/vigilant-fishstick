import { CAMERA, COURT } from './config.js';
import { clamp } from './util.js';

// Pinhole camera fixed above and behind the near player, pitched down at the court.
export class Camera {
  constructor() {
    this.pitch = Math.atan2(CAMERA.z - CAMERA.lookZ, CAMERA.lookY - CAMERA.y);
    this.cp = Math.cos(this.pitch);
    this.sp = Math.sin(this.pitch);
    this.focal = 1000;
    this.cx = 0;
    this.cy = 0;
    this.baseCy = 0;
    this.follow = 0;
    this.w = 0;
    this.h = 0;
  }

  // Depth and vertical offset factors for a ground point at world y.
  _ground(y) {
    const dy = y - CAMERA.y;
    const dz = -CAMERA.z;
    return {
      depth: dy * this.cp + dz * -this.sp,
      up: dy * this.sp + dz * this.cp,
    };
  }

  resize(w, h) {
    this.w = w;
    this.h = h;

    const near = this._ground(-COURT.halfLen);
    const far = this._ground(COURT.halfLen);
    const spanFactor = -near.up / near.depth + far.up / far.depth; // baseline-to-baseline, per focal px
    const widthFactor = COURT.halfSingles / near.depth;            // half court width at the near baseline

    // Fit by width and by height, keep whichever is tighter.
    const byWidth = (w * 0.47) / widthFactor;
    const byHeight = (h * 0.615) / spanFactor;
    this.focal = clamp(Math.min(byWidth, byHeight), 200, 6000);

    this.cx = w * 0.5;
    // Anchor the near baseline near the bottom so there is room for the player and the HUD.
    const nearOffset = (-near.up / near.depth) * this.focal;
    const baselineY = h * (h > w ? 0.755 : 0.86);
    this.baseCy = baselineY - nearOffset;
    this.cy = this.baseCy - this.follow;
  }

  // Pans up a little when the near player is driven behind their baseline, so
  // they never disappear off the bottom of the phone.
  setFollow(px) {
    this.follow = px;
    this.cy = this.baseCy - px;
  }

  project(x, y, z) {
    const dy = y - CAMERA.y;
    const dz = z - CAMERA.z;
    const depth = dy * this.cp + dz * -this.sp;
    const d = depth < 0.4 ? 0.4 : depth;
    const up = dy * this.sp + dz * this.cp;
    const s = this.focal / d;
    return { x: this.cx + x * s, y: this.cy - up * s, scale: s, depth: d };
  }

  // Screen y of a ground point on the centre line, handy for backdrop layout.
  groundY(y) {
    return this.project(0, y, 0).y;
  }
}
