import { chromium } from './playwright.mjs';

const diff = process.argv[2] || 'medium';
const fmt = process.argv[3] || 'quick';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
await page.click('text=Play');
await page.click('text=Single Match');
await page.click(`#seg-difficulty button[data-key="${diff}"]`);
await page.click(`#seg-format button[data-key="${fmt}"]`);
await page.click('#btn-start');

await page.evaluate(() => {
  const g = window.__game;
  window.__log = { rallies: [], reasons: {}, points: [] };
  let lastHit = -1;
  const origDecide = g.decide.bind(g);
  g.decide = (w, r) => {
    if (!g.decided) {
      window.__log.rallies.push(g.rallyShots);
      window.__log.reasons[r + (w === 0 ? '/you' : '/opp')] = (window.__log.reasons[r + (w === 0 ? '/you' : '/opp')] || 0) + 1;
    }
    origDecide(w, r);
  };
  const types = ['drive', 'drive', 'drive', 'power', 'lob', 'drop', 'slice'];
  window.__auto = setInterval(() => {
    if (!g.running || g.paused) return;
    if (g.state === 'serve-ready' && g.serverIdx() === 0) {
      g.onSwipe({ type: 'drive', aim: (Math.random() - 0.5) * 1.2, power: 0.85 + Math.random() * 0.3 });
    } else if (g.state === 'rally' && g.strikeReady && !g.pendingSwipe) {
      const t = types[(Math.random() * types.length) | 0];
      g.onSwipe({ type: t, aim: Math.random() * 2 - 1, power: 0.6 + Math.random() * 0.5 });
    }
  }, 20);
});

const t0 = Date.now();
while (Date.now() - t0 < 55000) {
  const done = await page.evaluate(() => !window.__game.running && document.getElementById('s-result').classList.contains('active'));
  if (done) break;
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `shots/auto-${diff}-${fmt}.png` });

const out = await page.evaluate(() => {
  const g = window.__game, l = window.__log;
  const r = l.rallies;
  const avg = r.reduce((a, b) => a + b, 0) / Math.max(1, r.length);
  const hist = {};
  r.forEach((v) => { const k = v >= 8 ? '8+' : String(v); hist[k] = (hist[k] || 0) + 1; });
  return {
    points: r.length, avgRally: +avg.toFixed(2), max: Math.max(0, ...r), hist,
    reasons: l.reasons,
    score: g.match ? g.match.completedSets : null,
    sets: g.match ? g.match.sets : null,
    stats: g.match ? g.match.stats : null,
    finished: !g.running,
  };
});
console.log(diff, fmt, JSON.stringify(out, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close();
