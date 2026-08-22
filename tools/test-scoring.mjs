// Scoring unit checks: games, sets, deuce/advantage, tiebreaks, service rotation.
import { readFileSync, writeFileSync } from 'node:fs';
const strip = (s) => s.split('\n').filter((l) => !/^\s*import\s.+from\s+'.+';\s*$/.test(l))
  .map((l) => l.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, '')).join('\n');
writeFileSync('/tmp/score.mjs', strip(readFileSync('js/scoring.js', 'utf8')) + '\nexport { Match };\n');
const { Match } = await import('/tmp/score.mjs');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fails++; } };

// Deuce and advantage.
let m = new Match({ sets: 1, gamesPerSet: 6, tiebreakAt: 6 });
for (let i = 0; i < 3; i++) { m.awardPoint(0); m.awardPoint(1); }
ok(m.scoreCall === 'Deuce', 'three-all is deuce, got ' + m.scoreCall);
m.awardPoint(0);
ok(m.pointLabel(0) === 'AD', 'advantage shown, got ' + m.pointLabel(0));
m.awardPoint(1);
ok(m.scoreCall === 'Deuce', 'back to deuce');
m.awardPoint(0); m.awardPoint(0);
ok(m.games[0] === 1, 'two clear points wins the game');
ok(m.server === 1, 'server changes after a game');

// A whole set including a tiebreak.
m = new Match({ sets: 1, gamesPerSet: 6, tiebreakAt: 6 });
const winGame = (who) => { for (let i = 0; i < 4; i++) m.awardPoint(who); };
for (let g = 0; g < 6; g++) { winGame(0); winGame(1); }
ok(m.tiebreak === true, 'tiebreak starts at 6-6, games ' + m.games);
const tbFirstServer = m.server;
m.awardPoint(0);
ok(m.server !== tbFirstServer, 'tiebreak server changes after point one');
const s2 = m.server;
m.awardPoint(1);
ok(m.server === s2, 'tiebreak server holds for the second point');
for (let i = 0; i < 6; i++) m.awardPoint(0);
ok(m.over && m.winner === 0, 'tiebreak wins the set and the match');
ok(m.completedSets[0][0] === 7 && m.completedSets[0][1] === 6, 'set recorded 7-6, got ' + m.completedSets[0]);

// Short set format.
m = new Match({ sets: 1, gamesPerSet: 4, tiebreakAt: 4 });
for (let g = 0; g < 4; g++) winGame(0);
ok(m.over && m.winner === 0, 'short set ends at four games');

// Best of five, random points, always terminates with a legal score.
for (let trial = 0; trial < 400; trial++) {
  m = new Match({ sets: 5, gamesPerSet: 6, tiebreakAt: 6 }, trial % 2);
  let guard = 0;
  while (!m.over && guard++ < 100000) m.awardPoint(Math.random() < 0.52 ? 0 : 1);
  ok(m.over, 'best of five terminates');
  ok(m.sets[m.winner] === 3, 'winner has three sets, got ' + m.sets);
  for (const [a, b] of m.completedSets) {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    ok((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)), `legal set score ${a}-${b}`);
  }
}

// Serve court alternates every point.
m = new Match({ sets: 1, gamesPerSet: 6, tiebreakAt: 6 });
ok(m.serveCourt === 'deuce', 'game starts in the deuce court');
m.awardPoint(0);
ok(m.serveCourt === 'ad', 'second point is served from the ad court');

console.log(fails === 0 ? 'scoring: all checks passed' : `scoring: ${fails} failures`);
process.exit(fails ? 1 : 0);
