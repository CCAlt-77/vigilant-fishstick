import { COURT, SHOTS, PALETTE, netHeightAt, G } from './config.js';
import { Camera } from './camera.js';
import { Renderer } from './render.js';
import { Ball, Player } from './entities.js';
import { AI } from './ai.js';
import { Match } from './scoring.js';
import { TouchInput, SWIPE } from './input.js';
import { sfx } from './audio.js';
import { solveShot, predictIntercept, predictBounce, inSinglesCourt, inServiceBox } from './physics.js';
import { clamp, lerp, rand, chance } from './util.js';

const SERVE_MOTION = 0.62;
// A beat to read the opponent's shot before setting off after it.
const HUMAN_READ = 0.15;

// Practice walks through the shots one at a time, so the gestures are taught
// rather than left to be discovered.
const COACH = [
  { type: 'drive', hint: 'Swipe up for a drive — the higher you drag, the deeper it lands' },
  { type: 'power', hint: 'Now flick up fast for a flat drive' },
  { type: 'lob',   hint: 'Now drag up past the LOB band at the top of the gauge' },
  { type: 'drop',  hint: 'Now swipe down for a drop shot' },
  { type: 'slice', hint: 'Now swipe sideways for an angle into the tramlines' },
];

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.cam = new Camera();
    this.renderer = new Renderer(canvas, this.cam);
    this.ball = new Ball();
    this.players = [
      new Player(0, { colour: PALETTE.home, trim: PALETTE.homeAlt }),
      new Player(1, { colour: PALETTE.awayDefault, trim: '#7f1d1d' }),
    ];
    this.ai = new AI({});
    this.effects = [];
    this.decals = [];
    this.state = 'idle';
    this.running = false;
    this.paused = false;
    this.aim = null;
    this.showReach = false;
    this.strikeReady = false;
    this.pendingSwipe = null;
    this.timer = 0;
    this.rallyShots = 0;
    this.serveNumber = 1;
    this.match = null;
    this.config = null;
    this.lastTs = 0;
    this.decided = null;
    this.practiceScore = { rally: 0, best: 0 };

    this.input = new TouchInput(canvas, {
      onStart: (a) => { this.dragState = { g: { type: 'drive', up: 0, aim: 0 }, x0: a.x0, y0: a.y0 }; },
      onDrag: (g, a) => this.onDrag(g, a),
      onSwipe: (g) => this.onSwipe(g),
    });
    this.dragState = null;

    this._loop = this._loop.bind(this);
  }

  resize() {
    this.renderer.resize();
    this.input.invalidateRect();
  }

  // ---------------------------------------------------------------- lifecycle

  start(config) {
    this.config = config;
    this.ai.setParams(config.difficulty);
    this.ai.reset();
    this.players[1].colours = { colour: config.opponent.colour, trim: config.opponent.trim };
    this.players[1].speed = config.difficulty.speed;
    this.players[1].reach = config.difficulty.reach;
    this.players[0].speed = 4.9;
    this.players[0].reach = 1.78;
    this.effects.length = 0;
    this.decals.length = 0;
    this.rallyShots = 0;
    this.decided = null;
    this.pendingSwipe = null;
    this.practiceScore = { rally: 0, best: this.practiceScore.best };
    this.practicePoints = 0;
    this.coach = 0;
    this.serveNumber = 1;

    if (config.mode === 'practice') {
      this.match = null;
    } else {
      this.match = new Match(config.format, 0);
    }
    this.paused = false;
    this.running = true;
    this.lastTs = 0;
    this.beginPoint(true);
    this.emitScore();
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    this.state = 'idle';
  }

  setPaused(p) {
    this.paused = p;
    if (!p) { this.lastTs = 0; requestAnimationFrame(this._loop); }
  }

  _loop(ts) {
    if (!this.running) return;
    if (this.paused) return;
    const t = ts / 1000;
    let dt = this.lastTs ? t - this.lastTs : 1 / 60;
    this.lastTs = t;
    dt = clamp(dt, 0, 0.05);
    this.update(dt);
    this.renderer.draw(this, dt);
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------------ helpers

  announce(text, sub = '', tone = 'neutral') {
    this.hooks.onAnnounce && this.hooks.onAnnounce(text, sub, tone);
  }

  emitScore() {
    this.hooks.onScore && this.hooks.onScore(this.match, this);
  }

  prompt(text) {
    this.hooks.onPrompt && this.hooks.onPrompt(text);
  }

  addEffect(type, x, y, z, maxLife, extra = {}) {
    this.effects.push({ type, x, y, z, life: maxLife, maxLife, seed: Math.random() * 6.28, ...extra });
  }

  serverIdx() { return this.match ? this.match.server : 0; }

  // The court in play for the current point. Fixed when the point begins: a
  // second serve is delivered from the same court as the first.
  serveCourt() { return this.pointCourt; }

  nextServeCourt() {
    if (this.match) return this.match.serveCourt;
    return this.practicePoints % 2 === 0 ? 'deuce' : 'ad';
  }

  // The half of the court a serve from this side has to land in.
  serviceBox(server = this.serverIdx(), court = this.pointCourt) {
    const side = -this.players[server].side;
    const wantPositiveX = side < 0 ? court === 'deuce' : court !== 'deuce';
    return {
      side,
      court,
      x0: 0,
      x1: wantPositiveX ? COURT.halfSingles : -COURT.halfSingles,
      y0: 0,
      y1: side * COURT.serviceLine,
      wantPositiveX,
    };
  }

  // ------------------------------------------------------------------- points

  beginPoint(firstOfMatch = false) {
    const server = this.serverIdx();
    this.pointCourt = this.nextServeCourt();
    const court = this.pointCourt;
    const b = this.ball;
    b.reset();
    b.held = true;

    const sSign = server === 0 ? 1 : -1;
    const side = this.players[server].side;
    const sx = sSign * (court === 'deuce' ? 1.4 : -1.4);
    const sy = side * (COURT.halfLen + 0.55);
    this.players[server].x = sx;
    this.players[server].y = sy;

    const rIdx = 1 - server;
    const rSide = this.players[rIdx].side;
    const wantPos = rSide < 0 ? court === 'deuce' : court !== 'deuce';
    this.players[rIdx].x = wantPos ? 2.7 : -2.7;
    this.players[rIdx].y = rSide * (COURT.halfLen + 1.1);

    b.x = sx + 0.34 * sSign;
    b.y = sy;
    b.z = 1.15;

    this.decided = null;
    this.readTimer = 0;
    this.lastStrikeY = [null, null];
    this.rallyShots = 0;
    this.serveTimer = server === 0 ? 0 : rand(0.7, 1.1);
    this.state = 'serve-ready';
    this.timer = 0;
    this.ai.reset();
    this.emitScore();

    if (this.config.mode === 'practice') {
      const where = court === 'deuce' ? 'Deuce court' : 'Ad court';
      this.prompt(`${where} — serve, then: ${COACH[this.coach % COACH.length].hint}`);
    } else if (server === 0) {
      const where = court === 'deuce' ? 'Deuce court' : 'Ad court';
      this.prompt(this.serveNumber === 2
        ? `Second serve · ${where} — swipe up into the marked box`
        : `${where} — swipe up to serve into the marked box`);
    } else {
      this.prompt('');
    }
    if (firstOfMatch) this.serveNumber = 1;
  }

  startServeMotion(idx, plan) {
    this.state = 'serve-toss';
    this.servePlan = plan;
    this.serveMover = idx;
    this.timer = SERVE_MOTION;
    this.players[idx].serveAnim = 0.55;
    this.players[idx].swing.dir = idx === 0 ? 1 : -1;
    this.prompt('');
  }

  serveContact(idx) {
    const p = this.players[idx];
    const sSign = idx === 0 ? 1 : -1;
    return { x: p.x + 0.28 * sSign, y: p.y + p.side * 0.28, z: 2.48 };
  }

  releaseServe() {
    const idx = this.serveMover;
    const plan = this.servePlan;
    const from = this.serveContact(idx);
    const b = this.ball;
    b.x = from.x; b.y = from.y; b.z = from.z;

    const spec = { ...SHOTS.power, clear: 0.10, T: plan.T };
    let v = solveShot(from, { x: plan.target.x, y: plan.target.y, z: 0 }, spec);
    if (plan.forceNet) v.vz *= 0.55;
    b.launch(v.vx, v.vy, v.vz, { rest: 0.76, fric: 0.70 }, idx);
    b.isServe = true;
    b.shot = 'serve';
    this.rallyShots = 1;
    if (idx === 1) this.readTimer = HUMAN_READ * 0.7;
    this.state = 'rally';
    this.players[idx].startSwing('power', idx === 0 ? 1 : -1, 1.2);
    this.addEffect('flash', from.x, from.y, from.z, 0.22);
    sfx.serve(clamp(1.0 / plan.T * 0.7, 0.6, 1.2));
    if (idx === 0) this.ai.onOpponentHit();
    this.hooks.onShotLabel && this.hooks.onShotLabel(this.serveNumber === 2 ? 'SECOND SERVE' : 'SERVE');
  }

  // The serve target can go anywhere in the box. Sideways drag moves it across,
  // upward drag moves it deeper, and how hard you flick sets the pace — so
  // placement and power are separate choices rather than the same one.
  humanServePlan(g) {
    const box = this.serviceBox(0, this.pointCourt);
    const wantPos = box.wantPositiveX;
    const second = this.serveNumber === 2;

    // Across the box, moving the way your thumb moves: 0 is down the T, 1 is wide.
    const lateral = clamp(g.aim || 0, -1, 1);
    const across = wantPos ? (lateral + 1) / 2 : (1 - lateral) / 2;
    const tx = (wantPos ? 1 : -1) * lerp(0.30, second ? 3.35 : 3.90, across);

    // Up the box: a longer drag lands the serve deeper.
    const reach = clamp((g.up || 0) / SWIPE.lob, 0, 1);
    const ty = -this.players[0].side * lerp(2.1, second ? 5.85 : 6.25, reach);

    // Pace from the flick, so aiming carefully does not cost you a big serve.
    const flick = clamp((g.speed || 0) / 2.2, 0, 1);
    const drive = 0.4 * reach + 0.6 * flick;
    const T = second ? lerp(1.02, 0.88, drive) : lerp(0.94, 0.70, drive);
    return { target: { x: tx, y: ty }, T };
  }

  servePath(plan) {
    const from = this.serveContact(0);
    const v = solveShot(from, { x: plan.target.x, y: plan.target.y, z: 0 }, { ...SHOTS.power, clear: 0.10, T: plan.T });
    const path = [];
    for (let i = 0; i <= 14; i++) {
      const t = (v.T * i) / 14;
      path.push([from.x + v.vx * t, from.y + v.vy * t, Math.max(0, from.z + v.vz * t - 0.5 * G * t * t)]);
    }
    return path;
  }

  // ------------------------------------------------------------------ striking

  canStrike(idx) {
    const p = this.players[idx];
    const b = this.ball;
    if (!b.live || b.held) return false;
    if (b.lastHitBy === idx) return false;
    if (b.isServe && b.bounces === 0) return false;
    if (b.bounces >= 2) return false;
    if (this.decided) return false;
    if (b.z > 3.0) return false;
    if (Math.sign(b.y) !== p.side && Math.abs(b.y) > 0.35) return false;
    return Math.hypot(b.x - p.x, b.y - p.y) <= p.reach;
  }

  // How cleanly a player meets the ball. Being set and balanced matters far more
  // than the exact millisecond of the swipe, which keeps one-thumb play fair.
  strikeQuality(idx) {
    const p = this.players[idx];
    const b = this.ball;
    let q = 1;
    const running = clamp(Math.hypot(p.vx, p.vy) / p.speed, 0, 1);
    q -= running * running * 0.75;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    q -= clamp(Math.abs(d - 0.80), 0, 1.2) * 0.34;
    if (b.z > 1.9) q -= (b.z - 1.9) * 0.28;
    if (b.z < 0.25) q -= (0.25 - b.z) * 0.9;
    return clamp(q, 0.10, 1);
  }

  humanPlan(g) {
    const spec = SHOTS[g.type];
    const opp = this.players[1];
    const depthT = clamp(g.depth != null ? g.depth : 0.55, 0, 1);
    let depth = lerp(spec.depth[0], spec.depth[1], depthT);
    let tx = g.aim * spec.spread;
    if (g.tap) {
      tx = clamp(-opp.x * 0.8, -3.4, 3.4);
      depth = lerp(spec.depth[0], spec.depth[1], 0.62);
    }
    return { type: g.type, target: { x: tx, y: depth }, power: g.power };
  }

  executeShot(idx, plan) {
    const b = this.ball;
    const p = this.players[idx];
    const spec = SHOTS[plan.type] || SHOTS.drive;
    const quality = plan.quality != null ? plan.quality : this.strikeQuality(idx);

    const from = { x: b.x, y: b.y, z: clamp(b.z, 0.22, 2.9) };
    this.lastStrikeY[idx] = b.y;
    const target = { x: plan.target.x, y: plan.target.y, z: 0 };

    // Mis-timed contact scatters the ball.
    const scatter = (1 - quality) * 3.0;
    target.x += rand(-scatter, scatter);
    target.y += rand(-scatter * 0.85, scatter * 0.85) * (idx === 0 ? 1 : -1) * -1;

    const power = clamp(plan.power != null ? plan.power : 1, 0.55, 1.3);
    // Struck from behind your own baseline the ball lands shorter, which is how
    // a player gets pushed back and then attacked.
    const pushed = clamp((Math.abs(from.y) - COURT.halfLen) / 4.5, 0, 1);
    target.y *= lerp(1, 0.74, pushed);
    const pace = idx === 1 ? (this.config.difficulty.pace || 1) : 1;
    const T = clamp(spec.T * pace / lerp(0.85, 1.15, power - 0.5), spec.T * 0.55, spec.T * 1.7);
    const v = solveShot(from, target, { ...spec, T });

    if (plan.forceError === 'net') { v.vz *= 0.60; v.vy *= 0.96; }

    b.launch(v.vx, v.vy, v.vz, spec, idx);
    b.isServe = false;
    b.shot = plan.type;
    this.rallyShots++;

    const dir = idx === 0 ? (b.x >= p.x - 0.15 ? 1 : -1) : (b.x <= p.x + 0.15 ? -1 : 1);
    p.startSwing(plan.type, dir, power);
    p.lunge = 1;

    this.addEffect('flash', from.x, from.y, from.z, 0.20);
    sfx.hit(power * (0.6 + quality * 0.6), plan.type);
    if (plan.type === 'power' && idx === 0) this.renderer.shake = 0.55 * quality;

    if (idx === 1) this.readTimer = HUMAN_READ * rand(0.8, 1.25);
    if (idx === 0) {
      this.ai.onOpponentHit();
      const perfect = quality > 0.9;
      this.hooks.onShotLabel && this.hooks.onShotLabel(
        (perfect ? '★ ' : '') + spec.label + (perfect ? ' — SWEET SPOT' : '')
      );
      if (perfect) this.addEffect('ring', from.x, from.y, from.z, 0.42, { size: 1.4, colour: '#e8ff5a' });
    }
    if (this.config.mode === 'practice') {
      const want = COACH[this.coach % COACH.length];
      if (plan.type === want.type) {
        this.coach++;
        this.announce('NICE', spec.label, 'good');
        this.prompt(`Try: ${COACH[this.coach % COACH.length].hint}`);
      }
      this.practiceScore.rally++;
      this.practiceScore.best = Math.max(this.practiceScore.best, this.practiceScore.rally);
      this.hooks.onPractice && this.hooks.onPractice(this.practiceScore);
    }
  }

  // -------------------------------------------------------------------- input

  onDrag(g, a) {
    if (a) this.dragState = { g, x0: a.x0, y0: a.y0 };
    if (this.state === 'rally' && this.ball.lastHitBy !== 0) {
      this.aim = this.previewAim(g);
    } else if (this.state === 'serve-ready' && this.serverIdx() === 0) {
      const plan = this.humanServePlan(g);
      this.aim = {
        x: plan.target.x, y: plan.target.y, label: this.serveNumber === 2 ? 'SECOND SERVE' : 'SERVE',
        risky: false, path: this.servePath(plan), showLabel: true,
      };
    } else {
      this.aim = null;
    }
  }

  previewAim(g) {
    const b = this.ball;
    const plan = this.humanPlan(g);
    const spec = SHOTS[g.type];
    let from;
    if (this.canStrike(0)) {
      from = { x: b.x, y: b.y, z: clamp(b.z, 0.22, 2.4) };
    } else {
      const s = predictIntercept(b, -1, 2.2, this.players[0].y);
      if (!s) return null;
      from = { x: s.x, y: s.y, z: clamp(s.z, 0.3, 1.6) };
    }
    const power = clamp(plan.power, 0.55, 1.3);
    const pushed = clamp((Math.abs(from.y) - COURT.halfLen) / 4.5, 0, 1);
    const ty = plan.target.y * lerp(1, 0.74, pushed);
    const T = clamp(spec.T / lerp(0.85, 1.15, power - 0.5), spec.T * 0.55, spec.T * 1.7);
    const v = solveShot(from, { x: plan.target.x, y: ty, z: 0 }, { ...spec, T });
    const path = [];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = (v.T * i) / steps;
      path.push([from.x + v.vx * t, from.y + v.vy * t, Math.max(0, from.z + v.vz * t - 0.5 * G * t * t)]);
    }
    const risky = !inSinglesCourt(plan.target.x, ty, -0.15);
    return { x: plan.target.x, y: ty, label: spec.label, risky, path, showLabel: false };
  }

  onSwipe(g) {
    this.aim = null;
    this.dragState = null;
    if (!this.running || this.paused) return;
    sfx.ensure();

    if (this.state === 'serve-ready' && this.serverIdx() === 0) {
      this.startServeMotion(0, this.humanServePlan(g));
      return;
    }
    if (this.state === 'rally' || this.state === 'serve-toss') {
      this.pendingSwipe = { g, t: performance.now() / 1000 };
      this.hooks.onShotLabel && this.hooks.onShotLabel(SHOTS[g.type].label);
    }
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].life -= dt;
      if (this.effects[i].life <= 0) this.effects.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= dt;
      if (this.decals[i].life <= 0) this.decals.splice(i, 1);
    }

    switch (this.state) {
      case 'serve-ready': this.updateServeReady(dt); break;
      case 'serve-toss': this.updateServeToss(dt); break;
      case 'rally': this.updateRally(dt); break;
      case 'point-over': this.updatePointOver(dt); break;
      default: break;
    }

    this.players[0].update(dt);
    this.players[1].update(dt);
    this.showReach = this.state === 'rally' && this.ball.lastHitBy === 1 && !this.decided;
    this.showServeBox = (this.state === 'serve-ready' || this.state === 'serve-toss')
      ? this.serviceBox()
      : null;
    this.strikeReady = this.canStrike(0);
  }

  updateServeReady(dt) {
    const server = this.serverIdx();
    const b = this.ball;
    const p = this.players[server];
    const sSign = server === 0 ? 1 : -1;
    b.x = p.x + 0.34 * sSign;
    b.y = p.y;
    b.z = 1.15 + Math.sin(this.renderer.time * 4) * 0.06;

    const receiver = this.players[1 - server];
    receiver.moveTowards(receiver.x, receiver.y, dt, 0.2);

    if (server === 1) {
      this.serveTimer -= dt;
      if (this.serveTimer <= 0) {
        const plan = this.ai.chooseServe(this);
        this.startServeMotion(1, { target: plan.target, T: plan.T, forceNet: plan.fault && chance(0.4) });
      }
    }
  }

  updateServeToss(dt) {
    this.timer -= dt;
    const idx = this.serveMover;
    const p = this.players[idx];
    const sSign = idx === 0 ? 1 : -1;
    const t = clamp(1 - this.timer / SERVE_MOTION, 0, 1);
    const contact = this.serveContact(idx);
    const b = this.ball;
    // Toss up, hang, then meet the racket.
    const arc = Math.sin(t * Math.PI * 0.9);
    b.x = lerp(p.x + 0.34 * sSign, contact.x, t);
    b.y = lerp(p.y, contact.y, t);
    b.z = 1.15 + arc * 1.9 + t * 0.25;
    if (this.timer <= 0) this.releaseServe();
  }

  updateRally(dt) {
    const b = this.ball;
    const steps = Math.max(1, Math.ceil(dt / (1 / 180)));
    const sub = dt / steps;
    const events = [];
    for (let i = 0; i < steps; i++) b.step(sub, events);
    for (const e of events) this.handleBallEvent(e);

    this.updateHuman(dt);
    this.ai.update(dt, this);

    // Buffered swipe: connect as soon as the ball is genuinely reachable.
    if (this.pendingSwipe) {
      const age = performance.now() / 1000 - this.pendingSwipe.t;
      if (this.canStrike(0)) {
        this.executeShot(0, this.humanPlan(this.pendingSwipe.g));
        this.pendingSwipe = null;
      } else if (age > 0.42) {
        if (this.ball.lastHitBy === 1 && !this.decided) {
          this.players[0].startSwing(this.pendingSwipe.g.type, 1, 0.8);
          sfx.whiff();
        }
        this.pendingSwipe = null;
      }
    }

    if (this.decided) {
      this.decided.delay -= dt;
      if (this.decided.delay <= 0) this.finishPoint();
    } else if (b.live && (Math.abs(b.y) > 22 || Math.abs(b.x) > 18)) {
      this.decide(b.bounces >= 1 ? b.lastHitBy : 1 - b.lastHitBy, b.bounces >= 1 ? 'winner' : 'out');
    }
  }

  handleBallEvent(e) {
    const b = this.ball;
    if (e.type === 'net-plane') {
      const netH = netHeightAt(e.x);
      if (e.z < netH - 0.01) {
        // Stopped by the net.
        b.y = e.fromY > 0 ? 0.10 : -0.10;
        b.vy = -b.vy * 0.10;
        b.vx *= 0.20;
        b.vz = Math.abs(b.vz) * 0.10;
        this.renderer.shake = 0.25;
        sfx.netHit();
        this.addEffect('puff', e.x, 0, e.z, 0.4);
        if (b.isServe && b.bounces === 0) this.serveFault('into the net');
        else if (!this.decided) this.decide(1 - b.lastHitBy, 'net');
      } else if (e.z < netH + 0.09) {
        // Clipped the tape and dribbled over.
        b.vy *= 0.52;
        b.vx *= 0.6;
        b.vz = Math.abs(b.vz) * 0.25 + 0.7;
        b.clippedNet = true;
        sfx.netHit();
        this.addEffect('puff', e.x, 0, e.z, 0.35);
      }
      return;
    }

    if (e.type === 'bounce') {
      sfx.bounce(e.impact);
      this.decals.push({ x: e.x, y: e.y, life: 2.6, maxLife: 2.6, out: false });
      this.addEffect('ring', e.x, e.y, 0.01, 0.42, { size: 0.7, colour: 'rgba(255,255,255,0.8)' });
      if (this.decided) return;

      if (b.bounces === 1) {
        if (b.isServe) {
          const receiverSide = -this.players[b.lastHitBy].side;
          const ok = inServiceBox(e.x, e.y, receiverSide, this.serveCourt());
          const decal = this.decals[this.decals.length - 1];
          if (!ok) {
            decal.out = true;
            this.serveFault('out');
          } else if (b.clippedNet) {
            this.announce('LET', 'Serve again', 'neutral');
            this.decided = { winner: -1, reason: 'let', delay: 1.0 };
          }
          return;
        }
        const own = Math.sign(e.y) === this.players[b.lastHitBy].side;
        if (own || !inSinglesCourt(e.x, e.y)) {
          this.decals[this.decals.length - 1].out = true;
          this.addEffect('ring', e.x, e.y, 0.01, 0.7, { size: 1.5, colour: '#ff8080' });
          this.decide(1 - b.lastHitBy, 'out');
        }
        return;
      }

      if (b.bounces >= 2) {
        const ace = b.isServe && this.rallyShots <= 1;
        this.decide(b.lastHitBy, ace ? 'ace' : 'winner');
      }
    }
  }

  serveFault(why) {
    const b = this.ball;
    b.live = true;
    if (this.serveNumber === 1) {
      this.serveNumber = 2;
      this.announce('FAULT', why === 'out' ? 'Long or wide' : 'Into the net', 'bad');
      this.decided = { winner: -1, reason: 'fault', delay: 1.15 };
    } else {
      this.announce('DOUBLE FAULT', '', 'bad');
      if (this.match) this.match.stats[b.lastHitBy].doubles++;
      this.decide(1 - b.lastHitBy, 'double');
    }
  }

  decide(winner, reason) {
    if (this.decided) return;
    this.decided = { winner, reason, delay: reason === 'double' ? 1.0 : 1.25 };
    this.pendingSwipe = null;
    this.aim = null;

    if (this.match) {
      const loser = 1 - winner;
      if (reason === 'ace') this.match.stats[winner].aces++;
      else if (reason === 'out' || reason === 'net') this.match.stats[loser].errors++;
      else if (reason === 'winner') this.match.stats[winner].winners++;
      this.match.longestRally = Math.max(this.match.longestRally, this.rallyShots);
    }

    const you = winner === 0;
    const titles = {
      ace: you ? 'ACE!' : 'ACE',
      winner: you ? 'WINNER!' : 'POINT LOST',
      out: you ? 'OUT — YOUR POINT' : 'OUT',
      net: you ? 'NET — YOUR POINT' : 'INTO THE NET',
      double: you ? 'DOUBLE FAULT' : 'DOUBLE FAULT',
    };
    if (reason !== 'double') this.announce(titles[reason] || (you ? 'POINT' : 'POINT LOST'), '', you ? 'good' : 'bad');
    sfx.point(you);
    if (you) sfx.applause(reason === 'ace' ? 0.9 : 0.6, 1.6);

    if (this.config.mode === 'practice') {
      this.practiceScore.rally = 0;
      this.hooks.onPractice && this.hooks.onPractice(this.practiceScore);
    }
  }

  finishPoint() {
    const d = this.decided;
    this.state = 'point-over';
    this.timer = 0.35;
    this.pointResult = d;
  }

  updatePointOver(dt) {
    this.timer -= dt;
    const b = this.ball;
    if (b.live) {
      const events = [];
      b.step(dt, events);
      for (const e of events) if (e.type === 'bounce') sfx.bounce(e.impact * 0.6);
    }
    this.players[0].moveTowards(this.players[0].x * 0.85, this.players[0].side * (COURT.halfLen + 0.9), dt, 0.5);
    this.players[1].moveTowards(this.players[1].x * 0.85, this.players[1].side * (COURT.halfLen + 0.9), dt, 0.5);
    if (this.timer > 0) return;

    const d = this.pointResult;
    if (!d || d.winner < 0) {
      // Let or fault: same server, serve again.
      this.beginPoint();
      return;
    }

    if (this.config.mode === 'practice') {
      this.practicePoints++;
      this.beginPoint();
      return;
    }

    this.serveNumber = 1;
    const res = this.match.awardPoint(d.winner);
    this.emitScore();

    if (res.kind === 'match') {
      this.running = false;
      const won = res.by === 0;
      this.announce(won ? 'MATCH WON' : 'MATCH LOST', this.match.setSummary(), won ? 'good' : 'bad');
      if (won) sfx.win(); else sfx.lose();
      sfx.applause(1, 2.6);
      setTimeout(() => this.hooks.onMatchEnd && this.hooks.onMatchEnd(this.match, won), 1500);
      return;
    }

    if (res.kind === 'set') {
      const won = res.by === 0;
      this.announce(won ? 'SET — YOU' : 'SET — OPPONENT', this.match.setSummary(), won ? 'good' : 'bad');
      sfx.applause(0.85, 2.2);
      this.state = 'break';
      setTimeout(() => { if (this.running) this.beginPoint(); }, 1900);
      return;
    }

    if (res.kind === 'game') {
      const won = res.by === 0;
      this.announce(won ? 'GAME — YOU' : 'GAME — OPPONENT', res.tiebreak ? 'Tiebreak!' : this.match.setSummary(), won ? 'good' : 'bad');
      sfx.applause(0.6, 1.6);
      this.state = 'break';
      setTimeout(() => { if (this.running) this.beginPoint(); }, 1500);
      return;
    }

    this.beginPoint();
  }

  recoveryY(idx) {
    const p = this.players[idx];
    const base = p.side * (COURT.halfLen + 0.55);
    const struck = this.lastStrikeY[idx];
    if (struck == null) return base;
    if (Math.abs(struck) > 9.2) return base;
    const closed = struck - p.side * 2.6;
    return p.side < 0 ? clamp(closed, base, -4.2) : clamp(closed, 4.2, base);
  }

  // Human movement: run to the ball automatically, the player supplies the shot.
  updateHuman(dt) {
    const p = this.players[0];
    const b = this.ball;
    if (!b.live || this.decided) {
      p.moveTowards(p.x * 0.9, p.side * (COURT.halfLen + 0.8), dt, 0.6);
      return;
    }
    if (b.lastHitBy === 0) {
      const cover = clamp(-this.players[1].x * 0.25, -2.2, 2.2);
      p.moveTowards(cover, this.recoveryY(0), dt, 0.85);
      return;
    }

    // A beat to read the shot before setting off, so a well-placed ball can win the point.
    if (this.readTimer > 0) {
      this.readTimer -= dt;
      p.moveTowards(p.x, p.y, dt, 0.25);
      return;
    }

    if (b.bounces === 0) {
      const bnc = predictBounce(b);
      if (bnc && Math.abs(bnc.y) > 1.0 && !inSinglesCourt(bnc.x, bnc.y, 0.12) && b.z > 0.3) {
        // Leaving it: hold a neutral position rather than chasing a ball that is going out.
        p.moveTowards(clamp(bnc.x * 0.35, -3, 3), p.side * (COURT.halfLen + 0.7), dt, 0.85);
        return;
      }
    }

    const s = predictIntercept(b, -1, 2.2, p.y);
    if (!s) return;
    const ty = clamp(s.y, -(COURT.halfLen + 4.8), -0.85);
    p.moveTowards(s.x, ty, dt, 1);
  }
}
