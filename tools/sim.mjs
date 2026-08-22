// Headless balance harness: runs the real game modules with a stubbed DOM so we
// can play hundreds of points in a second and look at the shape of the rallies.
import { readFileSync, writeFileSync } from 'node:fs';

const ORDER = ['util', 'config', 'camera', 'physics', 'entities', 'scoring', 'audio', 'input', 'ai', 'render', 'game'];
const strip = (src) => src.split('\n')
  .filter((l) => !/^\s*import\s.+from\s+'.+';\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, ''))
  .join('\n');
const bundle = ORDER.map((m) => strip(readFileSync(`js/${m}.js`, 'utf8'))).join('\n')
  + '\nexport { Game, SHOTS, DIFFICULTIES, FORMATS, OPPONENTS };\n';
writeFileSync('/tmp/sim-bundle.mjs', bundle);

const noopCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 390, height: 844 };
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set: () => true,
});
const fakeCanvas = {
  width: 390, height: 844, clientWidth: 390, clientHeight: 844,
  getContext: () => noopCtx,
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 };
globalThis.document = { createElement: () => fakeCanvas };
globalThis.requestAnimationFrame = () => 0;

const { Game, DIFFICULTIES, FORMATS, SHOTS } = await import('/tmp/sim-bundle.mjs');
const BASE_T = Object.fromEntries(Object.entries(SHOTS).map(([k, v]) => [k, v.T]));
const setPace = (p) => { for (const k of Object.keys(SHOTS)) SHOTS[k].T = BASE_T[k] * p; };

const TYPES = ['drive', 'drive', 'drive', 'drive', 'power', 'power', 'lob', 'drop', 'slice'];

// Stands in for a competent player: aims to a side most of the time but rarely
// paints the line, and mostly hits deep. Spraying every ball at full width is
// not what a person does, and measuring against that would mis-tune the game.
const aimLike = () => {
  const r = Math.random();
  const side = Math.random() < 0.5 ? -1 : 1;
  if (r < 0.15) return side * (0.85 + Math.random() * 0.15);
  if (r < 0.55) return side * (0.35 + Math.random() * 0.45);
  return side * Math.random() * 0.3;
};
const depthLike = () => (Math.random() < 0.25 ? 0.15 + Math.random() * 0.4 : 0.6 + Math.random() * 0.4);

function playPoints(diffKey, points, opts = {}) {
  setPace(opts.pace || 1);
  const game = new Game(fakeCanvas, {});
  const log = [];
  const origDecide = game.decide.bind(game);
  game.decide = (w, r) => {
    if (!game.decided) log.push({ w, r, shots: game.rallyShots });
    origDecide(w, r);
  };
  game.start({
    mode: 'match',
    difficulty: { ...DIFFICULTIES[diffKey] },
    difficultyKey: diffKey,
    format: FORMATS.classic,
    opponent: { name: 'Sim', short: 'SIM', colour: '#f00', trim: '#900' },
    context: 'sim',
  });
  game.running = true;
  if (opts.humanSpeed) game.players[0].speed = opts.humanSpeed;
  if (opts.humanReach) game.players[0].reach = opts.humanReach;
  if (opts.aiSpeed) { game.players[1].speed = opts.aiSpeed; game.ai.p.speed = opts.aiSpeed; }
  if (opts.aiReact != null) game.ai.p.reaction = opts.aiReact;
  if (opts.aiError != null) game.ai.p.error = opts.aiError;
  if (opts.aiPace != null) game.config.difficulty.pace = opts.aiPace;

  let steps = 0;
  while (log.length < points && steps < points * 3000) {
    steps++;
    if (game.state === 'serve-ready' && game.serverIdx() === 0) {
      game.onSwipe({
        type: 'drive', aim: aimLike(),
        up: 0.12 + Math.random() * 0.22,          // how far up the box it is aimed
        speed: 1.1 + Math.random() * 1.3,          // how hard it is struck
        depth: 0.6, power: 0.9,
      });
    } else if (game.state === 'rally' && game.strikeReady && !game.pendingSwipe) {
      // skill < 1 makes the shot sloppier, standing in for a real player's timing.
      const t = TYPES[(Math.random() * TYPES.length) | 0];
      game.onSwipe({ type: t, aim: aimLike(), depth: depthLike(), power: 0.55 + Math.random() * 0.6 });
    }
    game.update(1 / 60);
    if (game.state === 'break') game.beginPoint();
    if (game.match && game.match.over) { game.match.over = false; game.match.sets = [0, 0]; }
  }
  return log;
}

const SWEEP = process.argv[2] ? JSON.parse(process.argv[2]) : {};
let broken = 0;
for (const d of ['easy', 'medium', 'hard']) {
  const o = { ...SWEEP };
  if (SWEEP.aiSpeeds) o.aiSpeed = SWEEP.aiSpeeds[d];
  if (SWEEP.aiReacts) o.aiReact = SWEEP.aiReacts[d];
  if (SWEEP.aiErrors) o.aiError = SWEEP.aiErrors[d];
  if (SWEEP.aiPaces) o.aiPace = SWEEP.aiPaces[d];
  const log = playPoints(d, 160, o);
  const shots = log.map((l) => l.shots);
  const avg = shots.reduce((a, b) => a + b, 0) / shots.length;
  const sorted = shots.slice().sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const youWon = log.filter((l) => l.w === 0).length;
  const hist = [0, 0, 0, 0, 0];
  shots.forEach((s) => { hist[s <= 1 ? 0 : s <= 3 ? 1 : s <= 6 ? 2 : s <= 12 ? 3 : 4]++; });
  const isErr = (r) => r === 'out' || r === 'net' || r === 'double';
  const yourErrors = log.filter((l) => isErr(l.r) && l.w === 1).length;
  const aiErrors = log.filter((l) => isErr(l.r) && l.w === 0).length;
  const yourWinners = log.filter((l) => !isErr(l.r) && l.w === 0).length;
  const aiWinners = log.filter((l) => !isErr(l.r) && l.w === 1).length;
  console.log(
    d.padEnd(7),
    'pts', String(log.length).padStart(3),
    'avg', avg.toFixed(1).padStart(5),
    'median', String(med).padStart(3),
    'you win%', String(Math.round((youWon / log.length) * 100)).padStart(3),
    '| rally 1/2-3/4-6/7-12/13+:', hist.join('/'),
    '| yourErr', String(yourErrors).padStart(3), 'aiErr', String(aiErrors).padStart(3),
    'yourWin', String(yourWinners).padStart(3), 'aiWin', String(aiWinners).padStart(3)
  );

  // Loose guards only: the win rates move around by several points run to run,
  // so assert on the things that mean the game is actually broken rather than
  // merely tuned differently.
  if (log.length < 20) { console.log(`  FAIL ${d}: only ${log.length} points played — points are not completing`); broken++; }
  if (med < 2) { console.log(`  FAIL ${d}: median rally ${med} — rallies are not happening`); broken++; }
  if (yourErrors + aiErrors === 0) { console.log(`  FAIL ${d}: no errors at all — the in/out rules look inert`); broken++; }
}

if (broken) {
  console.log(`balance: ${broken} problem(s)`);
  process.exit(1);
}
