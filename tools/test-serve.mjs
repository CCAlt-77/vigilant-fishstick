// Serving must be legal and predictable: a serve aimed inside the box must land
// in the box, in every mode, from both courts, on both serves.
import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = ['util', 'config', 'camera', 'physics', 'entities', 'scoring', 'audio', 'input', 'ai', 'render', 'game'];
const strip = (s) => s.split('\n').filter((l) => !/^\s*import\s.+from\s+'.+';\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, '')).join('\n');
writeFileSync('/tmp/serve-bundle.mjs', ORDER.map((m) => strip(readFileSync(`js/${m}.js`, 'utf8'))).join('\n')
  + '\nexport { Game, DIFFICULTIES, FORMATS };\n');

const noopCtx = new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 390, height: 844 }
  : (k === 'createLinearGradient' || k === 'createRadialGradient') ? () => ({ addColorStop() {} })
  : k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
const fc = { width: 390, height: 844, clientWidth: 390, clientHeight: 844, getContext: () => noopCtx,
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }) };
globalThis.window = { devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 };
globalThis.document = { createElement: () => fc };
globalThis.requestAnimationFrame = () => 0;
const { Game, DIFFICULTIES, FORMATS } = await import('/tmp/serve-bundle.mjs');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fails++; } };

function run(mode, serves) {
  const game = new Game(fc, {});
  const outcomes = [];
  const origFault = game.serveFault.bind(game);
  game.serveFault = (why) => { outcomes.push('fault:' + why); origFault(why); };
  const origDecide = game.decide.bind(game);
  game.decide = (w, r) => { if (!game.decided && r !== 'fault') outcomes.push(r); origDecide(w, r); };

  game.start({
    mode, difficulty: { ...DIFFICULTIES.easy }, difficultyKey: 'easy', format: FORMATS.classic,
    opponent: { name: 'Sim', short: 'SIM', colour: '#f00', trim: '#900' }, context: 'serve test',
  });
  game.running = true;

  const courts = [];
  const aims = [];
  let served = 0;
  let steps = 0;
  while (served < serves && steps < serves * 4000) {
    steps++;
    if (game.state === 'serve-ready' && game.serverIdx() === 0) {
      courts.push(game.serveCourt());
      // Aim mid-box: neither wide nor down the T.
      const g = { type: 'drive', aim: (served % 5) / 4 * 2 - 1, power: 0.9, tap: false };
      // The preview must agree with itself frame to frame.
      game.onDrag(g);
      const a1 = { ...game.aim };
      game.onDrag(g);
      const a2 = { ...game.aim };
      aims.push([a1, a2]);
      game.onSwipe(g);
      served++;
    }
    game.update(1 / 60);
    if (game.state === 'break') game.beginPoint();
    if (game.match && game.match.over) { game.match.over = false; game.match.sets = [0, 0]; }
  }

  const faults = outcomes.filter((o) => o.startsWith('fault')).length;
  const steady = aims.every(([a, b]) => a && b && a.x === b.x && a.y === b.y);
  return { faults, served, courts, steady, outcomes };
}

for (const mode of ['match', 'practice']) {
  const r = run(mode, 24);
  const rate = r.faults / Math.max(1, r.served);
  ok(rate < 0.25, `${mode}: fault rate ${(rate * 100).toFixed(0)}% over ${r.served} serves aimed inside the box`);
  ok(r.steady, `${mode}: serve aim preview is steady between frames (no wobble)`);
  const courts = new Set(r.courts);
  ok(courts.size === 2, `${mode}: serves alternate between the deuce and ad courts (saw ${[...courts].join(', ')})`);
  console.log(`  ${mode}: ${r.served} serves, ${r.faults} faults, courts seen: ${[...courts].join('/')}, preview steady: ${r.steady}`);
}

console.log(fails === 0 ? 'serving: all checks passed' : `serving: ${fails} failures`);
process.exit(fails ? 1 : 0);
