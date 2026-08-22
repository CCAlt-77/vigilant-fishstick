import { COURT, PALETTE, netHeightAt } from './config.js';
import { SWIPE } from './input.js';
import { clamp, lerp, easeOut, mulberry32 } from './util.js';

const LINE = 0.05;

function roundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// How far the camera may pan up, as a fraction of canvas height.
const FOLLOW_MAX = 0.085;
const BASELINE_W = 0.10;

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = camera;
    // Static scenery, pre-rendered once per resize. The camera only ever
    // translates vertically, so these are blitted at an offset rather than
    // re-drawn: it is the difference between ~150 path operations a frame and two.
    this.sceneLayer = document.createElement('canvas');
    this.netLayer = document.createElement('canvas');
    this.layerExtra = 0;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.shake = 0;
    this.follow = 0;
    this.time = 0;
    this.crowdEnergy = 0.35;
    this._gaugeCache = new Map();
    this._chipCache = new Map();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.resize(w, h);
    this.layerExtra = Math.ceil(h * FOLLOW_MAX) + 8;
    this._gaugeCache.clear();
    this._chipCache.clear();
    this._buildLayers();
  }

  // Renders the static scenery into offscreen canvases at follow = 0. The layers
  // run taller than the canvas so that panning up never exposes bare pixels.
  _buildLayers() {
    const keep = this.cam.follow;
    this.cam.setFollow(0);
    const live = this.ctx;
    const tall = this.h + this.layerExtra;
    for (const [canvas, paint] of [
      [this.sceneLayer, (g) => { this._paintBackdrop(g); this.drawCourt(); }],
      [this.netLayer, () => this.drawNet()],
    ]) {
      canvas.width = Math.round(this.w * this.dpr);
      canvas.height = Math.round(tall * this.dpr);
      const g = canvas.getContext('2d');
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, this.w, tall);
      this.ctx = g;
      paint(g);
    }
    this.ctx = live;
    this.cam.setFollow(keep);
  }

  _paintBackdrop(g) {
    const { cam } = this;
    const w = this.w, h = this.h + this.layerExtra;

    const hoardBase = cam.groundY(18);
    const hoardTop = cam.project(0, 18, 1.7).y;
    const standTop = Math.min(0, hoardTop - h * 0.5);

    // Stands.
    const sky = g.createLinearGradient(0, standTop, 0, hoardTop);
    sky.addColorStop(0, PALETTE.standsTop);
    sky.addColorStop(1, PALETTE.standsBottom);
    g.fillStyle = sky;
    g.fillRect(0, 0, w, Math.max(1, hoardTop));

    // Crowd: deterministic speckle, densest near the front rows.
    const rnd = mulberry32(20260822);
    const top = Math.max(0, hoardTop - h * 0.34);
    const rows = 34;
    const colours = ['#caa887', '#b0876a', '#8f6a52', '#d7c3ab', '#7d5c47', '#e0cdb6', '#6f5340'];
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const y = lerp(top, hoardTop - 3, t);
      const size = lerp(0.9, 1.9, t);
      const count = Math.round(lerp(90, 160, t) * (w / 400));
      g.globalAlpha = lerp(0.34, 0.68, t);
      for (let i = 0; i < count; i++) {
        const x = rnd() * w;
        g.fillStyle = colours[(rnd() * colours.length) | 0];
        g.beginPath();
        g.arc(x, y + (rnd() - 0.5) * size * 1.5, size * (0.75 + rnd() * 0.5), 0, Math.PI * 2);
        g.fill();
      }
      if (r % 6 === 5) {
        g.globalAlpha = 0.22;
        g.fillStyle = '#04070d';
        g.fillRect(0, y + size * 1.6, w, 1.5);
      }
    }
    g.globalAlpha = 1;
    // Haze over the far rows so the crowd sits behind the court rather than on it.
    const haze = g.createLinearGradient(0, top - 10, 0, hoardTop);
    haze.addColorStop(0, 'rgba(13,27,42,0.85)');
    haze.addColorStop(0.55, 'rgba(13,27,42,0.18)');
    haze.addColorStop(1, 'rgba(13,27,42,0)');
    g.fillStyle = haze;
    g.fillRect(0, top - 10, w, hoardTop - top + 10);

    // Hoardings along the back of the court.
    const hg = g.createLinearGradient(0, hoardTop, 0, hoardBase);
    hg.addColorStop(0, '#0f2a41');
    hg.addColorStop(1, PALETTE.hoarding);
    g.fillStyle = hg;
    g.fillRect(0, hoardTop, w, Math.max(2, hoardBase - hoardTop));

    const bandH = Math.max(2, hoardBase - hoardTop);
    const panels = Math.max(4, Math.round(w / 92));
    const panelW = w / panels;
    const mid = (hoardTop + hoardBase) / 2;
    const words = ['ACE POINT', 'CENTRE COURT', 'ACE POINT', 'MATCHPOINT', 'ACE POINT'];
    for (let i = 0; i < panels; i++) {
      g.save();
      g.beginPath();
      g.rect(i * panelW + 1, hoardTop, panelW - 2, bandH);
      g.clip();
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      g.fillRect(i * panelW, hoardTop, panelW, bandH);
      const label = words[i % words.length];
      let size = bandH * 0.30;
      g.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
      while (g.measureText(label).width > panelW * 0.80 && size > 5) {
        size -= 0.5;
        g.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`;
      }
      g.fillStyle = i % 2 ? 'rgba(226,240,252,0.42)' : 'rgba(79,209,197,0.62)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, panelW * (i + 0.5), mid);
      g.restore();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, hoardBase);
    g.lineTo(w, hoardBase);
    g.stroke();

    // Ground surround below the hoardings.
    const gg = g.createLinearGradient(0, hoardBase, 0, h);
    gg.addColorStop(0, PALETTE.surroundAlt);
    gg.addColorStop(1, PALETTE.surround);
    g.fillStyle = gg;
    g.fillRect(0, hoardBase - 1, w, h - hoardBase + 2);
  }

  _path(pts) {
    const { ctx, cam } = this;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = cam.project(pts[i][0], pts[i][1], pts[i][2] || 0);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  _fillQuad(pts, style) {
    this._path(pts);
    this.ctx.fillStyle = style;
    this.ctx.fill();
  }

  _courtLine(x1, y1, x2, y2, width) {
    const hw = width / 2;
    const pts = x1 === x2
      ? [[x1 - hw, y1], [x1 + hw, y1], [x2 + hw, y2], [x2 - hw, y2]]
      : [[x1, y1 - hw], [x2, y2 - hw], [x2, y2 + hw], [x1, y1 + hw]];
    this._fillQuad(pts, PALETTE.line);
  }

  drawCourt() {
    const { ctx } = this;
    const HL = COURT.halfLen, HD = COURT.halfDoubles, HS = COURT.halfSingles, SL = COURT.serviceLine;

    // Playing surface, with a lighter inner rectangle for a bit of depth.
    this._fillQuad([[-HD - 2.6, -HL - 9.5], [HD + 2.6, -HL - 9.5], [HD + 2.6, HL + 4.6], [-HD - 2.6, HL + 4.6]], '#15624f');
    this._fillQuad([[-HD - 2.1, -HL - 8.6], [HD + 2.1, -HL - 8.6], [HD + 2.1, HL + 3.8], [-HD - 2.1, HL + 3.8]], PALETTE.court);
    this._fillQuad([[-HD, -HL], [HD, -HL], [HD, HL], [-HD, HL]], PALETTE.courtInner);

    ctx.save();
    ctx.globalAlpha = 0.10;
    this._fillQuad([[-HS, -SL], [HS, -SL], [HS, SL], [-HS, SL]], '#ffffff');
    ctx.restore();

    this._courtLine(-HD, -HL, HD, -HL, BASELINE_W);
    this._courtLine(-HD, HL, HD, HL, BASELINE_W);
    this._courtLine(-HD, -HL, -HD, HL, LINE);
    this._courtLine(HD, -HL, HD, HL, LINE);
    this._courtLine(-HS, -HL, -HS, HL, LINE);
    this._courtLine(HS, -HL, HS, HL, LINE);
    this._courtLine(-HS, -SL, HS, -SL, LINE);
    this._courtLine(-HS, SL, HS, SL, LINE);
    this._courtLine(0, -SL, 0, SL, LINE);
    this._courtLine(0, -HL, 0, -HL + 0.10, BASELINE_W);
    this._courtLine(0, HL - 0.10, 0, HL, BASELINE_W);
  }

  drawNet() {
    const { ctx, cam } = this;
    const HD = COURT.halfDoubles;
    const steps = 30;

    // Mesh.
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = lerp(-HD, HD, i / steps);
      const p = cam.project(x, 0, netHeightAt(x));
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const x = lerp(-HD, HD, i / steps);
      const p = cam.project(x, 0, 0);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(12, 22, 34, 0.42)';
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(226, 236, 245, 0.30)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= steps * 2; i++) {
      const x = lerp(-HD, HD, i / (steps * 2));
      const a = cam.project(x, 0, netHeightAt(x));
      const b = cam.project(x, 0, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let r = 0; r <= 7; r++) {
      const f = r / 7;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = lerp(-HD, HD, i / steps);
        const p = cam.project(x, 0, netHeightAt(x) * f);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Tape along the top.
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = lerp(-HD, HD, i / steps);
      const p = cam.project(x, 0, netHeightAt(x) + 0.055);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    for (let i = steps; i >= 0; i--) {
      const x = lerp(-HD, HD, i / steps);
      const p = cam.project(x, 0, netHeightAt(x) - 0.005);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = PALETTE.net;
    ctx.fill();

    // Posts.
    for (const sx of [-1, 1]) {
      const x = sx * (HD + 0.12);
      const top = netHeightAt(HD) + 0.12;
      this._fillQuad([[x - 0.06, -0.06, 0], [x + 0.06, -0.06, 0], [x + 0.06, -0.06, top], [x - 0.06, -0.06, top]], '#233246');
      this._fillQuad([[x - 0.06, 0.06, 0], [x + 0.06, 0.06, 0], [x + 0.06, 0.06, top], [x - 0.06, 0.06, top]], '#1a2536');
    }
  }

  // While the thumb is down, show the scale the shot is chosen from: how far up
  // you drag picks the shot, so it should be something you can see and correct
  // before you let go, not something you learn by trial and error.
  //
  // The panel and its labels are pre-rendered per variant. Drawing six runs of
  // text every frame of a drag was costing more than the rest of the scene put
  // together.
  _gaugeGeom() {
    const H = this.h;
    const top = H * 0.31, bottom = H * 0.79;
    return { top, bottom, w: 44, span: 0.44, pad: 20, height: bottom - top + 40 };
  }

  _gaugePanel(variant) {
    let c = this._gaugeCache.get(variant);
    if (c) return c;
    const geo = this._gaugeGeom();
    const yFor = (u) => (geo.bottom - geo.top + geo.pad) - (clamp(u, 0, geo.span) / geo.span) * (geo.bottom - geo.top);

    c = document.createElement('canvas');
    c.width = Math.round(geo.w * this.dpr);
    c.height = Math.round(geo.height * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    roundedRect(g, 0.5, 0.5, geo.w - 1, geo.height - 1, 12);
    g.fillStyle = 'rgba(8,16,26,0.58)';
    g.fill();
    g.strokeStyle = 'rgba(148,180,214,0.22)';
    g.lineWidth = 1;
    g.stroke();

    const isUp = variant !== 'other';
    const band = (a, b, fill) => {
      g.fillStyle = fill;
      g.fillRect(5, yFor(b), geo.w - 10, yFor(a) - yFor(b));
    };
    band(SWIPE.short, SWIPE.lob, isUp ? 'rgba(232,255,90,0.13)' : 'rgba(148,180,214,0.07)');
    band(SWIPE.lob, geo.span, variant === 'lob' ? 'rgba(232,255,90,0.34)' : 'rgba(148,180,214,0.10)');

    g.font = '600 8px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = variant === 'lob' ? '#e8ff5a' : 'rgba(200,216,232,0.65)';
    g.fillText('LOB', geo.w / 2, (yFor(SWIPE.lob) + yFor(geo.span)) / 2);
    g.fillStyle = 'rgba(200,216,232,0.55)';
    g.fillText('DEEP', geo.w / 2, yFor(SWIPE.lob) + 12);
    g.fillText('SHORT', geo.w / 2, yFor(SWIPE.short) - 10);
    g.fillStyle = 'rgba(200,216,232,0.4)';
    g.fillText('TAP', geo.w / 2, yFor(0) + 11);

    this._gaugeCache.set(variant, c);
    return c;
  }

  _gaugeChip(label) {
    let c = this._chipCache.get(label);
    if (c) return c;
    const probe = this.ctx;
    probe.save();
    probe.font = '800 11px ui-sans-serif, system-ui, sans-serif';
    const tw = probe.measureText(label).width;
    probe.restore();
    const w = tw + 14, h = 22;
    c = document.createElement('canvas');
    c.width = Math.round(w * this.dpr);
    c.height = Math.round(h * this.dpr);
    const g = c.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    roundedRect(g, 0, 0, w, h, 7);
    g.fillStyle = 'rgba(8,16,26,0.78)';
    g.fill();
    g.font = '800 11px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8ff5a';
    g.fillText(label, w / 2, h / 2 + 0.5);
    c._w = w;
    c._h = h;
    this._chipCache.set(label, c);
    return c;
  }

  drawSwipeGauge(drag) {
    const { ctx } = this;
    const g = drag.g;
    const geo = this._gaugeGeom();
    const onRight = drag.x0 < this.w * 0.5;        // sit opposite the thumb
    const x = onRight ? this.w - geo.w - 12 : 12;
    const panelTop = geo.top - geo.pad;
    const yFor = (u) => geo.bottom - (clamp(u, 0, geo.span) / geo.span) * (geo.bottom - geo.top);

    const isUp = g.type === 'drive' || g.type === 'power' || g.type === 'lob';
    const variant = g.type === 'lob' ? 'lob' : isUp ? 'up' : 'other';
    ctx.drawImage(this._gaugePanel(variant), x, panelTop, geo.w, geo.height);

    const my = yFor(isUp ? (g.up || 0) : 0);
    if (isUp) {
      ctx.strokeStyle = '#e8ff5a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + 3, my);
      ctx.lineTo(x + geo.w - 3, my);
      ctx.stroke();
      ctx.fillStyle = '#e8ff5a';
      ctx.beginPath();
      ctx.arc(x + (onRight ? 3 : geo.w - 3), my, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const label = g.type === 'power' ? 'FLAT DRIVE'
      : g.type === 'drop' ? 'DROP SHOT'
      : g.type === 'slice' ? 'ANGLE'
      : g.type === 'lob' ? 'LOB' : 'DRIVE';
    const chip = this._gaugeChip(label);
    const cy = (isUp ? my : geo.bottom) - chip._h / 2;
    const cx = onRight ? x - 10 - chip._w : x + geo.w + 10;
    ctx.drawImage(chip, cx, cy, chip._w, chip._h);
  }

  drawServeBox(box) {
    const { ctx } = this;
    const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
    const pulse = 0.5 + Math.sin(this.time * 3.4) * 0.5;
    ctx.save();
    this._path(pts);
    ctx.fillStyle = `rgba(232, 255, 90, ${0.07 + pulse * 0.05})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(232, 255, 90, ${0.45 + pulse * 0.35})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -this.time * 26;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawDecals(decals) {
    const { ctx, cam } = this;
    for (const d of decals) {
      const a = clamp(d.life / d.maxLife, 0, 1);
      const p = cam.project(d.x, d.y, 0.005);
      const r = COURT.ballR * p.scale * 2.4;
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = d.out ? 'rgba(255,120,120,0.9)' : 'rgba(240,255,180,0.85)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r * 1.5, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawEffects(effects) {
    const { ctx, cam } = this;
    for (const e of effects) {
      const t = 1 - clamp(e.life / e.maxLife, 0, 1);
      const p = cam.project(e.x, e.y, e.z || 0);
      ctx.save();
      if (e.type === 'ring') {
        const r = lerp(0.05, e.size || 1.1, easeOut(t)) * p.scale;
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = e.colour || '#ffffff';
        ctx.lineWidth = Math.max(1, 2.4 * (1 - t));
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'flash') {
        const r = lerp(0.12, 0.75, t) * p.scale;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(2, r));
        g.addColorStop(0, `rgba(255,255,230,${(1 - t) * 0.85})`);
        g.addColorStop(1, 'rgba(255,255,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, r), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'puff') {
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = '#dff3ff';
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2 + e.seed;
          const rr = lerp(0.02, 0.5, t) * p.scale;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr * 0.4, Math.max(1, 3 * (1 - t)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawBall(ball) {
    const { ctx, cam } = this;

    // Trail.
    const tr = ball.trail;
    if (tr.length >= 9) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 3; i < tr.length; i += 3) {
        const f = i / tr.length;
        const a = cam.project(tr[i - 3], tr[i - 2], tr[i - 1]);
        const b = cam.project(tr[i], tr[i + 1], tr[i + 2]);
        ctx.globalAlpha = f * 0.35;
        ctx.strokeStyle = PALETTE.ball;
        ctx.lineWidth = Math.max(0.6, COURT.ballR * b.scale * 1.8 * f);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const p = cam.project(ball.x, ball.y, ball.z);
    const r = Math.max(2.6, COURT.ballR * p.scale * 2.7);
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.15, p.x, p.y, r);
    g.addColorStop(0, '#f7ffb0');
    g.addColorStop(0.65, PALETTE.ball);
    g.addColorStop(1, PALETTE.ballShade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBallShadow(ball) {
    const { ctx, cam } = this;
    const p = cam.project(ball.x, ball.y, 0.004);
    const spread = 1 + clamp(ball.z, 0, 8) * 0.16;
    const r = Math.max(1.6, COURT.ballR * p.scale * 2.5 * spread);
    ctx.save();
    ctx.globalAlpha = clamp(0.42 - ball.z * 0.035, 0.07, 0.42);
    ctx.fillStyle = '#03130c';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(p, opts = {}) {
    const { ctx, cam } = this;
    const base = cam.project(p.x, p.y, 0);
    const s = base.scale;
    const facingAway = p.side < 0;
    const c = p.colours;

    // Shadow.
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#03130c';
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, 0.46 * s, 0.17 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (opts.reachRing) {
      const glow = opts.reachHot ? 1 : 0.32;
      ctx.save();
      ctx.globalAlpha = glow * (opts.reachHot ? 0.55 + Math.sin(this.time * 14) * 0.18 : 0.30);
      ctx.strokeStyle = opts.reachHot ? '#e8ff5a' : 'rgba(220,240,255,0.8)';
      ctx.lineWidth = opts.reachHot ? 2.6 : 1.4;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, p.reach * s * 0.92, p.reach * s * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const run = Math.min(1, Math.hypot(p.vx, p.vy) / 4.2);
    const stride = Math.sin(p.runPhase) * run;
    const stance = 0.10 * (1 - run);
    const bob = Math.abs(Math.cos(p.runPhase)) * run * 0.05;

    const M = (m) => m * s;
    const px = base.x;
    const groundY = base.y;
    const yAt = (metres) => groundY - M(metres + bob);

    const hip = 0.94, shoulder = 1.42, headY = 1.63, headR = 0.125;

    // Legs.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = M(0.135);
    for (const dir of [-1, 1]) {
      const swingLeg = dir * stride * 0.34;
      const foot = dir * (0.12 + stance);
      ctx.beginPath();
      ctx.moveTo(px + M(dir * 0.11), yAt(hip));
      ctx.lineTo(px + M(dir * 0.13 + swingLeg * 0.6), yAt(0.5));
      ctx.lineTo(px + M(foot + swingLeg), yAt(Math.max(0, Math.abs(swingLeg) * 0.35)));
      ctx.stroke();
    }
    // Shoes.
    ctx.fillStyle = '#f8fafc';
    for (const dir of [-1, 1]) {
      const swingLeg = dir * stride * 0.34;
      const foot = dir * (0.12 + stance);
      ctx.beginPath();
      ctx.ellipse(px + M(foot + swingLeg), yAt(Math.max(0, Math.abs(swingLeg) * 0.35)) + M(0.02), M(0.115), M(0.058), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shorts.
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(px - M(0.22), yAt(1.02));
    ctx.lineTo(px + M(0.22), yAt(1.02));
    ctx.lineTo(px + M(0.20), yAt(0.80));
    ctx.lineTo(px - M(0.20), yAt(0.80));
    ctx.closePath();
    ctx.fill();

    // Torso.
    ctx.fillStyle = c.colour;
    ctx.beginPath();
    ctx.moveTo(px - M(0.21), yAt(1.00));
    ctx.lineTo(px - M(0.245), yAt(shoulder));
    ctx.quadraticCurveTo(px, yAt(shoulder + 0.06), px + M(0.245), yAt(shoulder));
    ctx.lineTo(px + M(0.21), yAt(1.00));
    ctx.closePath();
    ctx.fill();

    if (facingAway && s > 26) {
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.font = `700 ${M(0.30)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(opts.number || 1), px, yAt(1.20));
    }

    // Head.
    ctx.fillStyle = '#e6b48c';
    ctx.beginPath();
    ctx.arc(px, yAt(headY), M(headR), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.arc(px, yAt(headY + 0.02), M(headR * 1.02), Math.PI * (facingAway ? 0.98 : 1.02), Math.PI * 2.02);
    ctx.fill();
    if (!facingAway && s > 30) {
      ctx.fillStyle = 'rgba(30,20,15,0.75)';
      ctx.beginPath(); ctx.arc(px - M(0.045), yAt(headY - 0.01), M(0.018), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(px + M(0.045), yAt(headY - 0.01), M(0.018), 0, Math.PI * 2); ctx.fill();
    }

    // Racket arm.
    const sw = p.swing;
    let ang;
    if (p.serveAnim > 0) {
      const t = 1 - p.serveAnim / 0.55;
      ang = lerp(Math.PI * 0.62, -Math.PI * 0.12, easeOut(clamp(t, 0, 1)));
    } else if (sw.active) {
      const t = easeOut(clamp(sw.t / sw.dur, 0, 1));
      const from = sw.type === 'lob' ? -2.5 : -2.35;
      const to = sw.type === 'drop' ? 0.15 : 0.62;
      ang = lerp(from, to, t);
    } else {
      ang = 0.26 + Math.sin(this.time * 2.1 + p.idx) * 0.07;
    }
    const ready = !sw.active && p.serveAnim <= 0;
    const dir = sw.dir || 1;
    const armLen = ready ? 0.34 : 0.60, gripLen = ready ? 0.22 : 0.30, headRad = 0.175;
    const shx = px + M(dir * 0.20);
    const shy = yAt(shoulder - 0.04);
    const ax = shx + Math.cos(ang) * M(armLen) * dir;
    const ay = shy - Math.sin(ang) * M(armLen);
    const rx = ax + Math.cos(ang) * M(gripLen) * dir;
    const ry = ay - Math.sin(ang) * M(gripLen);
    const tx = rx + Math.cos(ang) * M(headRad) * dir;
    const ty = ry - Math.sin(ang) * M(headRad);

    // Off arm.
    ctx.strokeStyle = '#e6b48c';
    ctx.lineWidth = M(0.085);
    ctx.beginPath();
    ctx.moveTo(px - M(dir * 0.20), shy);
    ctx.lineTo(px - M(dir * 0.42), yAt(1.06));
    ctx.stroke();

    // Racket arm.
    ctx.beginPath();
    ctx.moveTo(shx, shy);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // Racket.
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = M(0.045);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(-ang * dir + (dir < 0 ? Math.PI : 0));
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = M(0.035);
    ctx.beginPath();
    ctx.ellipse(0, 0, M(headRad), M(headRad * 0.78), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(226,242,255,0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,242,255,0.35)';
    ctx.lineWidth = Math.max(0.5, M(0.012));
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(M(headRad) * (i / 2.6), -M(headRad * 0.74));
      ctx.lineTo(M(headRad) * (i / 2.6), M(headRad * 0.74));
      ctx.stroke();
    }
    ctx.restore();

    if (sw.active && sw.t < sw.dur * 0.75) {
      ctx.save();
      ctx.globalAlpha = 0.22 * (1 - sw.t / sw.dur);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = M(0.10);
      ctx.beginPath();
      ctx.arc(shx, shy, M(armLen + gripLen), -ang - 0.9, -ang + 0.2, false);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawAim(aim) {
    if (!aim) return;
    const { ctx, cam } = this;
    ctx.save();
    if (aim.path && aim.path.length > 2) {
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(232,255,90,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < aim.path.length; i++) {
        const q = cam.project(aim.path[i][0], aim.path[i][1], aim.path[i][2]);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const p = cam.project(aim.x, aim.y, 0.01);
    const r = 0.75 * p.scale;
    const pulse = 0.8 + Math.sin(this.time * 8) * 0.12;
    ctx.strokeStyle = aim.risky ? 'rgba(255,120,120,0.95)' : 'rgba(232,255,90,0.95)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * pulse, r * 0.4 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (aim.showLabel) {
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(aim.label, p.x, p.y - r * 0.6 - 8);
    }
    ctx.restore();
  }

  draw(game, dt) {
    const { ctx } = this;
    this.time += dt;
    ctx.save();
    if (this.shake > 0.001) {
      const k = this.shake;
      ctx.translate((Math.random() - 0.5) * k * 14, (Math.random() - 0.5) * k * 10);
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    const p0 = game.players[0];
    const want = clamp((-p0.y - 12.9) / 4.0, 0, 1) * this.h * FOLLOW_MAX;
    this.follow += (want - this.follow) * Math.min(1, dt * 5);
    this.cam.setFollow(this.follow);

    const tall = this.h + this.layerExtra;
    ctx.drawImage(this.sceneLayer, 0, -this.follow, this.w, tall);

    if (game.showServeBox) this.drawServeBox(game.showServeBox);
    this.drawDecals(game.decals);
    if (game.aim) this.drawAim(game.aim);

    const ball = game.ball;
    const far = game.players[1];
    const near = game.players[0];

    // Painter's order back to front.
    const items = [
      { y: far.y, draw: () => this.drawPlayer(far, { number: 7 }) },
      { y: 0, draw: () => this.ctx.drawImage(this.netLayer, 0, -this.follow, this.w, tall) },
      { y: ball.y, draw: () => { this.drawBallShadow(ball); this.drawBall(ball); } },
      { y: near.y, draw: () => this.drawPlayer(near, {
          number: 1,
          reachRing: game.showReach,
          reachHot: game.strikeReady,
        }) },
    ];
    items.sort((a, b) => b.y - a.y);
    for (const it of items) it.draw();

    this.drawEffects(game.effects);
    if (game.dragState) this.drawSwipeGauge(game.dragState);
    ctx.restore();
  }
}
