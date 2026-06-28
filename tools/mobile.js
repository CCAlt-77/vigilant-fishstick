/* iPhone emulation test: load a 15x15 day, confirm the board fits the
 * screen (no horizontal overflow), and that tapping cells works on a
 * touchscreen device profile. */
const path = require('path');
const { chromium, devices } = require('/opt/node22/lib/node_modules/playwright');

const DATE = process.argv[2] || '2026-07-01'; // a 15x15 day (Ghost)

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const profiles = ['iPhone SE', 'iPhone 12', 'iPhone 14 Pro Max'];
  let anyFail = false;

  for (const name of profiles) {
    const device = devices[name];
    const context = await browser.newContext({ ...device });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('file://' + path.join(__dirname, '..', 'index.html') + '?date=' + DATE);
    await page.waitForSelector('.grid-cells .cell');

    const metrics = await page.evaluate(() => ({
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: window.innerWidth,
      cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
      boardRight: document.querySelector('.board').getBoundingClientRect().right,
      size: document.getElementById('size-line').textContent,
    }));

    // Tap two cells to confirm touch input fills them.
    await page.tap('.cell[data-r="3"][data-c="3"]');
    await page.tap('.cell[data-r="3"][data-c="4"]');
    const filled = await page.$$eval('.grid-cells .cell.filled', (els) => els.length);

    const overflow = metrics.docOverflow > 1;
    const fits = metrics.boardRight <= metrics.viewport + 1;
    const ok = !overflow && fits && filled >= 2 && errors.length === 0;
    if (!ok) anyFail = true;

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} vw=${metrics.viewport} cell=${metrics.cell} ` +
      `boardRight=${Math.round(metrics.boardRight)} overflow=${metrics.docOverflow} ` +
      `tapped=${filled} ${metrics.size}`);
    if (errors.length) console.log('   errors: ' + errors.join(' | '));
    await context.close();
  }

  await browser.close();
  if (anyFail) { console.log('\nMOBILE TEST FAILED'); process.exit(1); }
  console.log('\nMOBILE TEST PASSED (15x15 fits and is tappable on all iPhone profiles)');
})().catch((e) => { console.error(e); process.exit(1); });
