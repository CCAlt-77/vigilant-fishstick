/* Headless smoke test: load the app, solve today's puzzle by clicking the
 * solution cells, and confirm the win banner appears. */
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const puzzles = require(path.join(__dirname, '..', 'js', 'puzzles.js'));
const solver = require(path.join(__dirname, '..', 'js', 'solver.js'));

// Reproduce the app's daily pick so we know which picture to solve.
function epochDay(d){return Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);}
function fixedPermutation(n){const o=Array.from({length:n},(_,i)=>i);let s=0x9e3779b9^n;const r=()=>{s|=0;s=(s+0x6d2b79f5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};for(let i=n-1;i>0;i--){const j=Math.floor(r()*(i+1));[o[i],o[j]]=[o[j],o[i]];}return o;}
const today = new Date();
const n = puzzles.all.length;
const idx = fixedPermutation(n)[((epochDay(today)%n)+n)%n];
const puzzle = puzzles.all[idx];
const sol = puzzles.toGrid(puzzle.grid);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForSelector('.grid-cells .cell');

  const N = puzzle.size;
  const cells = await page.$$('.grid-cells .cell');
  if (cells.length !== N * N) throw new Error(`expected ${N*N} cells, got ${cells.length}`);

  // Click each cell that should be filled (default mode is fill).
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (sol[r][c] === 1) {
        await page.click(`.cell[data-r="${r}"][data-c="${c}"]`);
      }
    }
  }

  await page.waitForSelector('#win-banner:not([hidden])', { timeout: 4000 });
  const winText = await page.textContent('#win-sub');
  const dateText = await page.textContent('#date-line');
  const sizeText = await page.textContent('#size-line');

  // Reload to confirm progress + solved state persist.
  await page.reload();
  await page.waitForSelector('.grid-cells .cell');
  const persisted = await page.isVisible('#win-banner');

  await browser.close();

  console.log(`Picture of the day: ${puzzle.emoji} ${puzzle.name} (${N}x${N})`);
  console.log(`Date line: ${dateText.trim()}`);
  console.log(`Size line: ${sizeText.trim()}`);
  console.log(`Win subtitle: ${winText.trim()}`);
  console.log(`Win persists after reload: ${persisted}`);
  if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
  if (!winText.includes(puzzle.name)) { console.log('FAIL: win text missing picture name'); process.exit(1); }
  if (!persisted) { console.log('FAIL: solved state did not persist'); process.exit(1); }
  console.log('\nSMOKE TEST PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
