// The bundled single-file build must boot and play exactly like the modular site.
import { chromium } from './playwright.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

// Wrap the fragment build the way a host with its own document skeleton would.
const frag = readFileSync('dist/artifact.html', 'utf8');
const title = frag.match(/<title>[\s\S]*?<\/title>/)[0];
const style = frag.match(/<style>[\s\S]*?<\/style>/)[0];
const rest = frag.replace(title, '').replace(style, '');
writeFileSync('dist/_fragment-host.html',
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">${title}${style}</head><body>${rest}</body></html>`);

const browser = await chromium.launch();
let bad = 0;
for (const page of ['dist/index.html', 'dist/_fragment-host.html']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(`http://127.0.0.1:8145/${page}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.click('#s-title [data-go="s-mode"]');
  await p.click('[data-mode="match"]');
  await p.click('#btn-start');
  await p.waitForTimeout(900);
  for (let i = 0; i < 10; i++) {
    await p.mouse.move(195, 640);
    await p.mouse.down();
    await p.mouse.move(205 + i * 4, 520, { steps: 5 });
    await p.mouse.up();
    await p.waitForTimeout(400);
  }
  const st = await p.evaluate(() => ({ running: window.__game.running, hits: window.__game.ball.hitCount, title: document.title }));
  const ok = errors.length === 0 && st.running && st.title === 'Ace Point Tennis';
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${page}  hits=${st.hits} title="${st.title}"${errors.length ? '\n     ' + errors.join('\n     ') : ''}`);
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
