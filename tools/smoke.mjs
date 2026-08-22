import { chromium } from './playwright.mjs';

const url = process.argv[2] || 'http://127.0.0.1:8145/index.html';
const shots = [];
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/01-title.png' });

await page.click('text=Play');
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/02-mode.png' });

await page.click('text=Single Match');
await page.waitForTimeout(200);
await page.click('#seg-difficulty button[data-key="medium"]');
await page.click('#seg-format button[data-key="quick"]');
await page.screenshot({ path: 'shots/03-setup.png' });

await page.click('#btn-start');
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/04-serve.png' });

async function swipe(dx, dy, ms = 120) {
  const x = 195, y = 640;
  await page.mouse.move(x, y);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(ms / steps);
  }
  await page.mouse.up();
}

// Serve, then rally with a mix of gestures for a while.
await swipe(10, -140, 90);
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/05-rally.png' });

const moves = [
  [0, 0, 60], [30, -160, 80], [-40, -120, 400], [0, 90, 150], [120, 10, 120], [0, -150, 70],
];
const state = [];
for (let i = 0; i < 90; i++) {
  const m = moves[i % moves.length];
  await swipe(m[0], m[1], m[2]);
  await page.waitForTimeout(320);
  if (i === 3) await page.screenshot({ path: 'shots/06-mid.png' });
  if (i % 15 === 0) {
    state.push(await page.evaluate(() => {
      const g = window.__game;
      return g ? { state: g.state, hits: g.ball.hitCount, score: g.match ? g.match.scoreCall : '-', games: g.match ? g.match.games.join('-') : '-' } : null;
    }));
  }
}
await page.screenshot({ path: 'shots/07-later.png' });

// Hold a drag mid-rally so the aiming preview is on screen.
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(() => window.__game.state === 'rally' && window.__game.ball.lastHitBy === 1);
  if (ready) break;
  await swipe(0, -140, 70);
  await page.waitForTimeout(250);
}
await page.mouse.move(195, 640);
await page.mouse.down();
await page.mouse.move(255, 520, { steps: 8 });
await page.waitForTimeout(120);
await page.screenshot({ path: 'shots/08-aim.png' });
await page.mouse.up();

const info = await page.evaluate(() => {
  const g = window.__game;
  return {
    state: g.state,
    running: g.running,
    games: g.match ? g.match.games : null,
    sets: g.match ? g.match.sets : null,
    stats: g.match ? g.match.stats : null,
    overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
  };
});

console.log(JSON.stringify({ errors, state, info }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
