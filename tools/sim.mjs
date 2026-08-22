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
      game.onSwipe({ type: 'drive', aim: (Math.random() - 0.5) * 1.6, power: 0.8 + Math.random() * 0.4 });
    } else if (game.state === 'rally' && game.strikeReady && !game.pendingSwipe) {
      // skill < 1 makes the shot sloppier, standing in for a real player's timing.
      const t = TYPES[(Math.random() * TYPES.length) | 0];
      game.onSwipe({ type: t, aim: Math.random() * 2 - 1, power: 0.55 + Math.random() * 0.6 });
    }
    game.update(1 / 60);
    if (game.state === 'break') game.beginPoint();
    if (game.match && game.match.over) { game.match.over = false; game.match.sets = [0, 0]; }
  }
  return log;
}

const SWEEP = process.argv[2] ? JSON.parse(process.argv[2]) : {};
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
}
