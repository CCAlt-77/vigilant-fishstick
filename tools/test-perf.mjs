// Frame-time check under CPU throttling, standing in for a phone.
//
// Read the median, not the tail. On a shared machine the p95 and the
// frames-over-20ms figure swing wildly with run order and background load —
// enough that A/B runs come out backwards. The median is stable and is what
// tells you whether the loop is holding 60fps.
import { chromium } from './playwright.mjs';

const throttle = Number(process.argv[3] || 4);
const url = process.argv[2] || 'http://127.0.0.1:8145/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url, { waitUntil: 'networkidle' });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

await page.click('#s-title [data-go="s-mode"]');
await page.click('[data-mode="match"]');
await page.click('#btn-start');
await page.waitForTimeout(800);

await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

// Play for a while, including a held drag (the most expensive frame: aim preview).
for (let i = 0; i < 12; i++) {
  await page.mouse.move(195, 640);
  await page.mouse.down();
  await page.mouse.move(215, 500, { steps: 10 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const s = await page.evaluate(() => {
  const f = window.__ft.slice(5);
  const sorted = f.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    frames: f.length,
    median: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    worst: +Math.max(...f).toFixed(1),
    over20ms: f.filter((v) => v > 20).length,
  };
});
console.log(`cpu x${throttle} @3x dpr  frames=${s.frames} median=${s.median}ms p95=${s.p95}ms worst=${s.worst}ms  frames>20ms=${s.over20ms} (${((s.over20ms / s.frames) * 100).toFixed(1)}%)`);
await browser.close();
