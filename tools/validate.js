#!/usr/bin/env node
/*
 * Validates every picture in js/puzzles.js:
 *   - the picture is rectangular and 12x12 or 15x15
 *   - the resulting nonogram has EXACTLY ONE solution
 *   - that solution is reachable by pure line-logic (no guessing)
 *
 * Run: node tools/validate.js
 * Exits non-zero if any puzzle fails the uniqueness check.
 */
const path = require('path');
const solver = require(path.join(__dirname, '..', 'js', 'solver.js'));
const puzzles = require(path.join(__dirname, '..', 'js', 'puzzles.js'));

let failures = 0;
let warnings = 0;

console.log(`Validating ${puzzles.all.length} puzzles...\n`);

for (const p of puzzles.all) {
  const issues = [];

  // Dimension checks.
  const height = p.grid.length;
  const widths = new Set(p.grid.map((r) => r.length));
  if (widths.size !== 1) issues.push(`ragged rows: widths ${[...widths]}`);
  const width = p.grid[0].length;
  if (height !== p.size || width !== p.size) {
    issues.push(`expected ${p.size}x${p.size}, got ${height}x${width}`);
  }
  if (p.size !== 12 && p.size !== 15) {
    issues.push(`size ${p.size} is not 12 or 15`);
  }

  let uniqueTag = '';
  if (issues.length === 0) {
    const grid = puzzles.toGrid(p.grid);
    const { unique, count, lineSolvable } = solver.verify(grid);
    if (!unique) issues.push(`solutions found: ${count} (not unique)`);
    if (unique && !lineSolvable) {
      warnings++;
      uniqueTag = ' (unique, but needs guessing)';
    }
  }

  if (issues.length) {
    failures++;
    console.log(`  FAIL  ${p.emoji} ${p.name} [${p.size}x${p.size}] -- ${issues.join('; ')}`);
  } else {
    console.log(`  ok    ${p.emoji} ${p.name} [${p.size}x${p.size}]${uniqueTag}`);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} puzzle(s) FAILED validation.`);
  process.exit(1);
} else {
  console.log(`All ${puzzles.all.length} puzzles are uniquely solvable.` +
    (warnings ? ` (${warnings} require some guessing.)` : ' (all line-solvable.)'));
}
