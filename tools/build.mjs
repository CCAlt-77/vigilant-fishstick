// Bundles the modular source into a single self-contained dist/index.html,
// handy for hosting anywhere (or just emailing yourself the file).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ORDER = [
  'util', 'config', 'camera', 'physics', 'entities', 'scoring',
  'audio', 'input', 'ai', 'render', 'game', 'ui', 'main',
];

const strip = (src) => src
  .split('\n')
  .filter((l) => !/^\s*import\s.+from\s+'.+';\s*$/.test(l) && !/^\s*import\s+'.+';\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, ''))
  .join('\n');

const js = ORDER.map((m) => `// ---- ${m}.js ----\n${strip(readFileSync(`js/${m}.js`, 'utf8'))}`).join('\n\n');
const css = readFileSync('css/style.css', 'utf8');
const icon = readFileSync('icons/icon-180.png').toString('base64');

// Replacements go through functions: a string replacement would treat `$$` and
// `$&` in the inlined source as substitution patterns and quietly corrupt it.
const sub = (haystack, needle, value) => haystack.replace(needle, () => value);

let html = readFileSync('index.html', 'utf8');
html = sub(html, '<link rel="stylesheet" href="css/style.css" />', `<style>\n${css}\n</style>`);
html = sub(html, '<link rel="manifest" href="manifest.webmanifest" />', '');
html = sub(html, '<link rel="apple-touch-icon" href="icons/icon-180.png" />', `<link rel="apple-touch-icon" href="data:image/png;base64,${icon}" />`);
html = sub(html, '<link rel="icon" href="icons/icon-192.png" />', `<link rel="icon" href="data:image/png;base64,${icon}" />`);
html = sub(html, '<script type="module" src="js/main.js"></script>', `<script type="module">\n${js}\n</script>`);

// The single-file build has nothing to register.
html = html.replace(/if \('serviceWorker' in navigator[\s\S]*?\n}\n/, () => '');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);

// Also emit a fragment build (no <html>/<head>/<body> wrapper) for hosts that
// supply their own document skeleton.
const title = html.match(/<title>([\s\S]*?)<\/title>/)[0];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
writeFileSync('dist/artifact.html', `${title}\n${style}\n${body.trim()}\n`);
console.log(`dist/artifact.html  ${((title.length + style.length + body.length) / 1024).toFixed(0)} KB`);
