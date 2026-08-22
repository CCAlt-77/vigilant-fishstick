// Two things this checks, both of which were too narrow before:
//   1. the gestures reach the whole court, long and short and to both sides
//   2. the player actually moves around it, rather than living on the baseline
import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = ['util', 'config', 'camera', 'physics', 'entities', 'scoring', 'audio', 'input', 'ai', 'render', 'game'];
const strip = (s) => s.split('\n').filter((l) => !/^\s*import\s.+from\s+'.+';\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, '')).join('\n');
writeFileSync('/tmp/shots-bundle.mjs', ORDER.map((m) => strip(readFileSync(`js/${m}.js`, 'utf8'))).join('\n')
  + '\nexport { Game, DIFFICULTIES, FORMATS, COURT, classify, SWIPE };\n');

const noopCtx = new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 390, height: 844 }
  : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} })
  : k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
const fc = { width: 390, height: 844, clientWidth: 390, clientHeight: 844, getContext: () => noopCtx,
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) };
globalThis.window = { devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 };
globalThis.document = { createElement: () => fc };
globalThis.requestAnimationFrame = () => 0;
const { Game, DIFFICULTIES, FORMATS, COURT, classify, SWIPE } = await import('/tmp/shots-bundle.mjs');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fails++; } };

const game = new Game(fc, {});
game.start({
  mode: 'match', difficulty: { ...DIFFICULTIES.medium }, difficultyKey: 'medium', format: FORMATS.classic,
  opponent: { name: 'Sim', short: 'SIM', colour: '#f00', trim: '#900' }, context: 'shots',
});
game.running = true;

// --- 1. What the gestures can ask for -------------------------------------
const W = 390, H = 844;
const targets = [];
const types = new Set();
for (let dx = -110; dx <= 110; dx += 22) {
  for (let dy = -380; dy <= 120; dy += 20) {
    for (const ms of [90, 400]) {
      const g = classify(dx, dy, ms, W, H);
      types.add(g.type);
      targets.push(game.humanPlan(g).target);
    }
  }
}
const xs = targets.map((t) => t.x);
const ys = targets.map((t) => t.y);
const xSpan = Math.max(...xs) - Math.min(...xs);
const ySpan = Math.max(...ys) - Math.min(...ys);

ok(types.has('drive') && types.has('power') && types.has('lob') && types.has('drop') && types.has('slice'),
  `every shot type is reachable by gesture (got ${[...types].sort().join(', ')})`);
ok(Math.max(...xs) > 3.4 && Math.min(...xs) < -3.4, `both sidelines are reachable (x ${Math.min(...xs).toFixed(1)} to ${Math.max(...xs).toFixed(1)})`);
ok(Math.min(...ys) < 3.0, `short balls are reachable (shortest ${Math.min(...ys).toFixed(1)}m from the net)`);
ok(Math.max(...ys) > 10.5, `deep balls are reachable (deepest ${Math.max(...ys).toFixed(1)}m)`);
ok(ySpan > 7.5, `the depth you can ask for spans the court (${ySpan.toFixed(1)}m)`);
console.log(`  placement: x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} (${xSpan.toFixed(1)}m), y ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} (${ySpan.toFixed(1)}m)`);

// The drive zone has to be a usable scale, not a cliff between two values.
const depths = [0.06, 0.12, 0.18, 0.24, 0.30].map((up) => {
  const g = classify(4, -up * H, 400, W, H);
  return { up, type: g.type, y: +game.humanPlan(g).target.y.toFixed(1) };
});
const rising = depths.every((d, i) => i === 0 || d.y > depths[i - 1].y);
ok(rising, `dragging further up asks for a deeper ball (${depths.map((d) => d.y).join(' -> ')})`);
console.log(`  drive scale: ${depths.map((d) => `${d.up}=>${d.y}m`).join('  ')}`);
ok(classify(4, -(SWIPE.lob + 0.03) * H, 400, W, H).type === 'lob', 'dragging past the lob band plays a lob');
ok(classify(4, -0.20 * H, 90, W, H).type === 'power', 'a fast flick plays a flat drive');
ok(classify(4, -0.20 * H, 600, W, H).type === 'drive', 'the same distance drawn slowly plays a drive');

// --- 2. Where the player actually goes -------------------------------------
const seen = { minAbsY: 99, maxAbsY: 0, minX: 99, maxX: -99, volleys: 0, inside: 0, frames: 0 };
let steps = 0;
const aimLike = () => (Math.random() * 2 - 1) * 0.8;
while (steps < 90000) {
  steps++;
  if (game.state === 'serve-ready' && game.serverIdx() === 0) {
    game.onSwipe({ type: 'drive', aim: aimLike(), up: 0.2, speed: 1.6, depth: 0.7, power: 0.9 });
  } else if (game.state === 'rally' && game.strikeReady && !game.pendingSwipe) {
    const t = ['drive', 'drive', 'drive', 'power', 'drop', 'slice'][(Math.random() * 6) | 0];
    game.onSwipe({ type: t, aim: aimLike(), depth: Math.random(), power: 0.9 });
    if (game.ball.bounces === 0) seen.volleys++;
  }
  game.update(1 / 60);
  if (game.state === 'break') game.beginPoint();
  if (game.match && game.match.over) { game.match.over = false; game.match.sets = [0, 0]; }
  if (game.state === 'rally') {
    const p = game.players[0];
    seen.frames++;
    seen.minAbsY = Math.min(seen.minAbsY, Math.abs(p.y));
    seen.maxAbsY = Math.max(seen.maxAbsY, Math.abs(p.y));
    seen.minX = Math.min(seen.minX, p.x);
    seen.maxX = Math.max(seen.maxX, p.x);
    if (Math.abs(p.y) < COURT.halfLen - 1) seen.inside++;
  }
}
const insidePct = (seen.inside / Math.max(1, seen.frames)) * 100;
console.log(`  player: ${seen.minAbsY.toFixed(1)}..${seen.maxAbsY.toFixed(1)}m from the net, x ${seen.minX.toFixed(1)}..${seen.maxX.toFixed(1)}, inside the baseline ${insidePct.toFixed(0)}% of rally time, ${seen.volleys} volleys`);
ok(seen.minAbsY < 7.0, `the player comes into the court (closest ${seen.minAbsY.toFixed(1)}m from the net)`);
ok(insidePct > 6, `time is spent inside the baseline, not only behind it (${insidePct.toFixed(0)}%)`);
ok(seen.maxX - seen.minX > 5.0, `the player covers the width of the court (${(seen.maxX - seen.minX).toFixed(1)}m)`);
ok(seen.volleys > 0, `balls get taken out of the air (${seen.volleys})`);

console.log(fails === 0 ? 'shots and movement: all checks passed' : `shots and movement: ${fails} failures`);
process.exit(fails ? 1 : 0);
