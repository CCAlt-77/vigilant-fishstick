import { Game } from './game.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';

const canvas = document.getElementById('court');
let ui;

const game = new Game(canvas, {
  onScore: (m) => ui && ui.onScore(m),
  onAnnounce: (t, s, tone) => ui && ui.onAnnounce(t, s, tone),
  onPrompt: (t) => ui && ui.onPrompt(t),
  onShotLabel: (t) => ui && ui.onShotLabel(t),
  onMatchEnd: (m, won) => ui && ui.onMatchEnd(m, won),
  onPractice: (s) => ui && ui.onPractice(s),
});

ui = new UI(game);

// Handy for debugging from the console.
window.__game = game;
window.__ui = ui;

function fit() {
  game.resize();
}
fit();

window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 220));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.running && !game.paused) ui.pause();
});

// Unlock audio on the first touch anywhere.
const unlock = () => { sfx.ensure(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);

// Keep iOS from scrolling, zooming or bouncing the page under the canvas.
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest('.screen.scroll')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch < 320) e.preventDefault();
  lastTouch = now;
}, { passive: false });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline play just won't be cached */ });
  });
}
