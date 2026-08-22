import { COURT, SHOTS } from './config.js';
import { predictIntercept, predictBounce, inSinglesCourt } from './physics.js';
import { clamp, rand, chance, lerp } from './util.js';

// Opponent brain. Reads the ball, walks to it, and picks a shot with a
// difficulty-scaled amount of error.
export class AI {
  constructor(params) {
    this.p = params;
    this.reset();
  }

  reset() {
    this.reactTimer = 0;
    this._lastD = null;
    this.trackingHit = -1;
    this.letGo = false;
    this.plan = null;
    this.swingCooldown = 0;
  }

  setParams(p) { this.p = p; }

  // Called once when the human strikes the ball, so the opponent has to react.
  onOpponentHit() {
    this.reactTimer = this.p.reaction * rand(0.85, 1.25);
    this.letGo = false;
    this.plan = null;
  }

  update(dt, game) {
    const me = game.players[1];
    const ball = game.ball;
    this.reactTimer = Math.max(0, this.reactTimer - dt);
    this.swingCooldown = Math.max(0, this.swingCooldown - dt);

    if (!ball.live || ball.held) {
      const home = me.homeSpot();
      me.moveTowards(home.x, home.y, dt, 0.55);
      return;
    }

    const incoming = ball.lastHitBy === 0;
    if (!incoming) {
      // Ball is on its way to the human: recover towards a covering position.
      const cover = this.recoveryX(game);
      me.moveTowards(cover, me.side * (COURT.halfLen + 0.6), dt, 0.8);
      return;
    }

    if (this.trackingHit !== ball.hitCount) {
      this.trackingHit = ball.hitCount;
      this.letGo = false;
      this.plan = null;
      this._lastD = null;
    }

    // Decide whether the ball is going out and should be left.
    if (ball.bounces === 0 && !this.letGo && this.plan === null) {
      const b = predictBounce(ball);
      if (b && !inSinglesCourt(b.x, b.y, 0.06)) {
        const reads = chance(clamp(1 - this.p.error * 3.2, 0.15, 0.97));
        if (reads) this.letGo = true;
        this.plan = 'set';
      }
    }

    if (this.letGo) {
      const home = me.homeSpot();
      me.moveTowards(me.x * 0.7, home.y, dt, 0.5);
      return;
    }

    if (this.reactTimer > 0) {
      // Still reacting: hold position, maybe a small split-step drift.
      me.moveTowards(me.x, me.y, dt, 0.2);
      return;
    }

    const strike = predictIntercept(ball, 1, 2.2);
    if (!strike) return;

    // Weaker opponents read the ball less precisely.
    const miss = this.p.jitter * 0.55;
    const tx = strike.x + (this._noise(ball.hitCount) * miss);
    const ty = clamp(strike.y, 0.9, COURT.halfLen + 4.8);
    me.moveTowards(tx, ty, dt, 1);

    // Swing when the ball is genuinely in range.
    if (this.swingCooldown <= 0 && game.canStrike(1)) {
      const d = me.distanceTo(ball);
      if (d <= me.reach * 0.98 || ball.y > me.y + 0.25) {
        this.swingCooldown = 0.25;
        game.executeShot(1, this.chooseShot(game));
      }
    }
  }

  _noise(seed) {
    const s = Math.sin(seed * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }

  recoveryX(game) {
    // Cover the middle of the angles the human can produce from where they are.
    const human = game.players[0];
    return clamp(-human.x * 0.28, -2.4, 2.4);
  }

  chooseShot(game) {
    const me = game.players[1];
    const human = game.players[0];
    const p = this.p;

    const running = clamp(Math.hypot(me.vx, me.vy) / me.speed, 0, 1);
    const stretched = clamp(Math.max((Math.abs(me.x) - 2.2) / 3.0, running * running * 1.15), 0, 1);
    const atNet = me.y < 5.0;
    const humanAtNet = human.y > -5.0;
    const humanX = human.x;

    let type = 'drive';
    const r = Math.random();
    if (stretched > 0.7 && r < 0.55 - p.aggression * 0.3) {
      type = 'lob';
    } else if (humanAtNet && r < 0.45 + p.variety * 0.3) {
      type = chance(0.6) ? 'lob' : 'power';
    } else if (atNet && r < 0.55) {
      type = chance(0.5) ? 'power' : 'slice';
    } else if (r < p.aggression * 0.42) {
      type = 'power';
    } else if (r < p.aggression * 0.42 + p.variety * 0.22) {
      type = 'slice';
    } else if (r < p.aggression * 0.42 + p.variety * 0.22 + p.variety * 0.16 && me.y < 9.5 && !humanAtNet) {
      type = 'drop';
    }

    const spec = SHOTS[type];
    // Aim into the open court, away from where the human is standing.
    const openSide = humanX > 0 ? -1 : 1;
    const commitment = lerp(0.35, 1.0, p.aggression) * (1 - stretched * 0.6);
    let targetX = openSide * spec.spread * commitment * rand(0.55, 1.0);
    if (type === 'drop') targetX = openSide * rand(1.4, 3.4);
    if (type === 'lob') targetX = clamp(-humanX * 0.4, -2.8, 2.8);

    const depth = rand(spec.depth[0], spec.depth[1]);
    let targetY = -depth;

    // Error: scale the jitter, and occasionally commit a genuine miss.
    const jitter = p.jitter * (0.55 + stretched * 0.9);
    targetX += rand(-jitter, jitter);
    targetY += rand(-jitter * 0.8, jitter * 0.8);

    let forceError = null;
    if (chance(p.error * (1 + stretched * 1.4))) {
      forceError = chance(0.45) ? 'net' : 'long';
      if (forceError === 'long') targetY -= rand(0.6, 1.8);
    }

    targetX = clamp(targetX, -(COURT.halfSingles + 1.4), COURT.halfSingles + 1.4);
    targetY = clamp(targetY, -(COURT.halfLen + 2.0), -0.7);

    return { type, target: { x: targetX, y: targetY }, quality: clamp(1 - p.error * 2.5, 0.25, 1), forceError };
  }

  chooseServe(game) {
    const p = this.p;
    const second = game.serveNumber === 2;
    const court = game.match.serveCourt;
    // Deuce serves from the far player land in the near player's right-hand box.
    const wantPositive = court === 'deuce';
    const inner = second ? 1.1 : 0.45;
    const outer = second ? 3.1 : 3.85;
    let tx = rand(inner, outer) * (wantPositive ? 1 : -1);
    let ty = -rand(second ? 3.4 : 4.3, second ? 5.7 : 6.15);

    const jitter = p.jitter * (second ? 0.28 : 0.55);
    tx += rand(-jitter, jitter);
    ty += rand(-jitter * 0.7, jitter * 0.7);

    const T = second ? p.serveT * 1.16 : p.serveT;
    const faultChance = second ? p.error * 0.55 : p.error * 1.25;
    const fault = chance(faultChance);
    if (fault) {
      if (chance(0.5)) ty -= rand(0.5, 1.4); else tx += Math.sign(tx) * rand(0.6, 1.5);
    }
    return { target: { x: tx, y: ty }, T, fault };
  }
}
