/*
 * Nonogram solver / verifier.
 *
 * Works in the browser (attaches to window.Nonogram) and in Node
 * (module.exports), so the same logic powers in-app hints and the
 * offline puzzle-validation script.
 *
 * Cell states used internally:
 *   -1 = unknown, 0 = empty, 1 = filled
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NonogramSolver = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNKNOWN = -1;
  const EMPTY = 0;
  const FILLED = 1;

  // Build the run-length clue list for a single line of 0/1 values.
  function lineClues(line) {
    const clues = [];
    let run = 0;
    for (const v of line) {
      if (v === FILLED) {
        run++;
      } else if (run > 0) {
        clues.push(run);
        run = 0;
      }
    }
    if (run > 0) clues.push(run);
    return clues.length ? clues : [0];
  }

  // Derive row clues and column clues from a solution grid (array of
  // arrays of 0/1).
  function cluesFromGrid(grid) {
    const rows = grid.map(lineClues);
    const cols = [];
    const width = grid[0].length;
    for (let c = 0; c < width; c++) {
      const col = grid.map((row) => row[c]);
      cols.push(lineClues(col));
    }
    return { rows, cols };
  }

  // Enumerate every valid placement of `clues` over a line of `length`
  // cells, constrained by `known` (-1/0/1). For each cell, tally how
  // often it is filled; cells that are filled in every arrangement (or
  // in none) can be fixed. Returns the deduced line or null on a
  // contradiction. `changed` is set true when new cells are deduced.
  function solveLine(known, clues) {
    const length = known.length;
    const filledCount = new Array(length).fill(0);
    const emptyCount = new Array(length).fill(0);
    let arrangements = 0;

    const blocks = clues[0] === 0 ? [] : clues;
    const placement = new Array(length).fill(EMPTY);

    function fits() {
      for (let i = 0; i < length; i++) {
        if (known[i] !== UNKNOWN && known[i] !== placement[i]) return false;
      }
      return true;
    }

    function place(blockIdx, start) {
      if (blockIdx === blocks.length) {
        // Remaining cells stay empty (already EMPTY in placement).
        if (!fits()) return;
        arrangements++;
        for (let i = 0; i < length; i++) {
          if (placement[i] === FILLED) filledCount[i]++;
          else emptyCount[i]++;
        }
        return;
      }
      const size = blocks[blockIdx];
      // Remaining blocks need at least sum+gaps space.
      let need = 0;
      for (let b = blockIdx; b < blocks.length; b++) need += blocks[b];
      need += blocks.length - blockIdx - 1; // gaps between remaining
      const maxStart = length - need;
      for (let s = start; s <= maxStart; s++) {
        // Early prune: any known FILLED cell skipped in [start, s) makes
        // this and later starts invalid for the gap region.
        let gapHasFilled = false;
        for (let g = start; g < s; g++) {
          if (known[g] === FILLED) { gapHasFilled = true; break; }
        }
        if (gapHasFilled) break;
        // Place block at [s, s+size).
        let ok = true;
        for (let i = s; i < s + size; i++) {
          if (known[i] === EMPTY) { ok = false; break; }
        }
        if (ok) {
          for (let i = s; i < s + size; i++) placement[i] = FILLED;
          place(blockIdx + 1, s + size + 1);
          for (let i = s; i < s + size; i++) placement[i] = EMPTY;
        }
      }
    }

    place(0, 0);

    if (arrangements === 0) return null; // contradiction

    const result = known.slice();
    let changed = false;
    for (let i = 0; i < length; i++) {
      if (result[i] !== UNKNOWN) continue;
      if (filledCount[i] === arrangements) {
        result[i] = FILLED;
        changed = true;
      } else if (emptyCount[i] === arrangements) {
        result[i] = EMPTY;
        changed = true;
      }
    }
    return { line: result, changed };
  }

  // Constraint-propagation pass over the whole grid. Mutates `grid`
  // (array of arrays, -1/0/1). Returns 'contradiction', 'changed', or
  // 'stable'.
  function propagate(grid, rowClues, colClues) {
    const height = grid.length;
    const width = grid[0].length;
    let anyChange = false;

    for (let r = 0; r < height; r++) {
      const res = solveLine(grid[r], rowClues[r]);
      if (!res) return 'contradiction';
      if (res.changed) { grid[r] = res.line; anyChange = true; }
    }
    for (let c = 0; c < width; c++) {
      const col = grid.map((row) => row[c]);
      const res = solveLine(col, colClues[c]);
      if (!res) return 'contradiction';
      if (res.changed) {
        for (let r = 0; r < height; r++) grid[r][c] = res.line[r];
        anyChange = true;
      }
    }
    return anyChange ? 'changed' : 'stable';
  }

  function isComplete(grid) {
    for (const row of grid) {
      for (const v of row) if (v === UNKNOWN) return false;
    }
    return true;
  }

  // Count solutions up to `limit` (default 2 — enough to test
  // uniqueness). Uses propagation, then branches on the first unknown
  // cell. Returns { count, solution } where solution is the first one
  // found.
  function countSolutions(rowClues, colClues, height, width, limit) {
    limit = limit || 2;
    let count = 0;
    let firstSolution = null;

    function search(grid) {
      if (count >= limit) return;
      // Propagate to a fixed point.
      let status = 'changed';
      while (status === 'changed') {
        status = propagate(grid, rowClues, colClues);
      }
      if (status === 'contradiction') return;
      if (isComplete(grid)) {
        count++;
        if (!firstSolution) firstSolution = grid.map((row) => row.slice());
        return;
      }
      // Branch on the first unknown cell.
      let br = -1, bc = -1;
      outer:
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          if (grid[r][c] === UNKNOWN) { br = r; bc = c; break outer; }
        }
      }
      for (const guess of [FILLED, EMPTY]) {
        if (count >= limit) return;
        const copy = grid.map((row) => row.slice());
        copy[br][bc] = guess;
        search(copy);
      }
    }

    const start = Array.from({ length: height }, () => new Array(width).fill(UNKNOWN));
    search(start);
    return { count, solution: firstSolution };
  }

  // Convenience: verify a solution grid produces a uniquely-solvable
  // puzzle. Returns { unique, count, lineSolvable }.
  function verify(grid) {
    const { rows, cols } = cluesFromGrid(grid);
    const height = grid.length;
    const width = grid[0].length;

    // Is it solvable by pure line logic (no guessing)? Nicer puzzles
    // are.
    const work = Array.from({ length: height }, () => new Array(width).fill(UNKNOWN));
    let status = 'changed';
    while (status === 'changed') status = propagate(work, rows, cols);
    const lineSolvable = status !== 'contradiction' && isComplete(work);

    const { count } = countSolutions(rows, cols, height, width, 2);
    return { unique: count === 1, count, lineSolvable };
  }

  return {
    UNKNOWN, EMPTY, FILLED,
    lineClues, cluesFromGrid, solveLine, propagate,
    countSolutions, verify, isComplete,
  };
});
