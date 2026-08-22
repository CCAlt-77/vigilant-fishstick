// Resolves playwright whether it is installed locally or globally.
// Set PLAYWRIGHT_PATH to point at a specific install.
let pw;
const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright/index.js'];
for (const c of candidates) {
  if (!c) continue;
  try { pw = await import(c); break; } catch { /* try the next one */ }
}
if (!pw) {
  console.error('playwright not found. Install it with `npm i -D playwright`, or set PLAYWRIGHT_PATH.');
  process.exit(2);
}
export const { chromium } = pw.default || pw;
