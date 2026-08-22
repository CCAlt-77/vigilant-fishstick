import { chromium } from './playwright.mjs';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const step = [];
const check = async (label, sel, shot) => {
  const visible = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && el.classList.contains('active');
  }, sel);
  step.push(`${visible ? 'ok  ' : 'FAIL'} ${label}`);
  if (shot) await page.screenshot({ path: `shots/ui-${shot}.png` });
};

await page.goto('http://127.0.0.1:8145/index.html', { waitUntil: 'networkidle' });
await check('title screen', '#s-title', 'title');

await page.click('text=How to play'); await check('how to play', '#s-howto', 'howto');
await page.click('#s-howto [data-back]');
await page.click('text=Records'); await check('records', '#s-records', 'records');
await page.click('#s-records [data-back]');

await page.click('text=Play'); await check('mode picker', '#s-mode', 'mode');
await page.click('text=Tournament'); await check('tournament list', '#s-tourpick', 'tourpick');
await page.click('text=Coastal Masters'); await check('ladder', '#s-ladder', 'ladder');

const rounds = await page.evaluate(() => document.querySelectorAll('#ladder-list li').length);
step.push(`${rounds === 4 ? 'ok  ' : 'FAIL'} ladder has 4 rounds (${rounds})`);

await page.click('#btn-play-round');
await page.waitForTimeout(700);
const inGame = await page.evaluate(() => document.getElementById('overlay').classList.contains('hidden') && window.__game.running);
step.push(`${inGame ? 'ok  ' : 'FAIL'} tournament round launched`);
await page.screenshot({ path: 'shots/ui-round.png' });

await page.click('#btn-pause'); await page.waitForTimeout(200);
await check('pause screen', '#s-pause', 'pause');
await page.click('#btn-resume'); await page.waitForTimeout(200);
const resumed = await page.evaluate(() => !window.__game.paused);
step.push(`${resumed ? 'ok  ' : 'FAIL'} resume works`);

// Force a tournament win and inspect the result screen and ladder progression.
await page.evaluate(() => {
  const g = window.__game;
  g.match.stats = [{ won: 48, aces: 5, doubles: 1, winners: 12, errors: 9 }, { won: 31, aces: 2, doubles: 3, winners: 6, errors: 14 }];
  g.match.completedSets = [[6, 4], [7, 5]];
  g.match.sets = [2, 0];
  g.match.longestRally = 17;
  g.running = false;
  window.__ui.onMatchEnd(g.match, true);
});
await page.waitForTimeout(250);
await check('result screen', '#s-result', 'result');
const nextLabel = await page.evaluate(() => document.getElementById('btn-next').textContent);
step.push(`${/semi|quarter|round|trophy/i.test(nextLabel) ? 'ok  ' : 'FAIL'} result advances tournament ("${nextLabel}")`);

await page.click('#btn-next'); await page.waitForTimeout(200);
await check('back to ladder', '#s-ladder', 'ladder2');
const wonRow = await page.evaluate(() => document.querySelector('#ladder-list li.won') !== null);
step.push(`${wonRow ? 'ok  ' : 'FAIL'} first round marked as won`);

// Tournament progress survives a reload.
await page.reload({ waitUntil: 'networkidle' });
await page.click('text=Play'); await page.click('text=Tournament');
await page.waitForTimeout(150);
const resumedLadder = await page.evaluate(() => document.getElementById('s-ladder').classList.contains('active'));
step.push(`${resumedLadder ? 'ok  ' : 'FAIL'} saved tournament resumes after reload`);

// Practice mode.
await page.evaluate(() => { window.__ui.stack = []; window.__ui.show('s-mode', false); });
await page.click('text=Practice Rally');
await page.click('#btn-start');
await page.waitForTimeout(600);
const practice = await page.evaluate(() => window.__game.running && window.__game.config.mode === 'practice');
step.push(`${practice ? 'ok  ' : 'FAIL'} practice mode starts`);
await page.screenshot({ path: 'shots/ui-practice.png' });

console.log(step.join('\n'));
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
process.exit(step.some((s) => s.startsWith('FAIL')) || errors.length ? 1 : 0);
