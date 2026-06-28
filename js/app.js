/*
 * Daily Nonogram — game engine and UI.
 *
 * Picks one picture per day (deterministically, so everyone sees the
 * same puzzle), renders the clue grid, handles fill/mark drawing,
 * tracks progress + streak in localStorage, and detects the win.
 */
(function () {
  'use strict';

  const Puzzles = window.NonogramPuzzles;
  const Solver = window.NonogramSolver;

  // Cell states.
  const EMPTY = 0, FILLED = 1, MARKED = 2;

  // ---- Daily puzzle selection ------------------------------------------

  // Number of whole days since the Unix epoch in the player's local
  // timezone. Increments by exactly 1 each local midnight.
  function epochDay(date) {
    return Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
    );
  }

  // A fixed shuffle of puzzle indices so the daily sequence feels varied
  // but is identical for every player and never repeats a picture until
  // the whole list has been used. Seeded => deterministic.
  function fixedPermutation(n) {
    const order = Array.from({ length: n }, (_, i) => i);
    let seed = 0x9e3779b9 ^ n;
    const rand = () => {
      // Mulberry32 PRNG.
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  }

  function pickDailyPuzzle(date) {
    const n = Puzzles.all.length;
    const perm = fixedPermutation(n);
    const idx = perm[((epochDay(date) % n) + n) % n];
    return Puzzles.all[idx];
  }

  function dateKey(date) {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
  }

  // ---- Game state ------------------------------------------------------

  const today = new Date();
  const puzzle = pickDailyPuzzle(today);
  const solution = Puzzles.toGrid(puzzle.grid); // 0/1
  const N = puzzle.size;
  const rowClues = solution.map(Solver.lineClues);
  const colClues = [];
  for (let c = 0; c < N; c++) {
    colClues.push(Solver.lineClues(solution.map((row) => row[c])));
  }

  const STORAGE_KEY = `nono_progress_${dateKey(today)}`;
  const SOLVED_KEY = `nono_solved_${dateKey(today)}`;
  const STREAK_KEY = 'nono_streak';

  let state = loadProgress();
  let mode = 'fill';
  let solved = localStorage.getItem(SOLVED_KEY) === '1';
  const undoStack = [];

  function blankState() {
    return Array.from({ length: N }, () => new Array(N).fill(EMPTY));
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length === N && data[0].length === N) {
        return data.map((row) => row.slice());
      }
    } catch (e) { /* ignore corrupt data */ }
    return blankState();
  }

  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* storage may be unavailable */ }
  }

  // ---- DOM construction ------------------------------------------------

  const boardEl = document.getElementById('board');
  const cellEls = []; // cellEls[r][c]
  const colClueEls = [];
  const rowClueEls = [];

  function buildBoard() {
    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'auto auto';
    boardEl.style.gridTemplateRows = 'auto auto';

    const corner = el('div', 'corner');
    const colCluesEl = el('div', 'col-clues');
    const rowCluesEl = el('div', 'row-clues');
    const gridEl = el('div', 'grid-cells');

    colCluesEl.style.display = 'grid';
    colCluesEl.style.gridTemplateColumns = `repeat(${N}, var(--cell))`;
    rowCluesEl.style.display = 'grid';
    rowCluesEl.style.gridTemplateRows = `repeat(${N}, var(--cell))`;
    gridEl.style.gridTemplateColumns = `repeat(${N}, var(--cell))`;
    gridEl.style.gridTemplateRows = `repeat(${N}, var(--cell))`;

    for (let c = 0; c < N; c++) {
      const cc = el('div', 'col-clue');
      colClues[c].forEach((num) => { if (num > 0) cc.appendChild(span(num)); });
      if (colClues[c].length === 1 && colClues[c][0] === 0) cc.appendChild(span(0));
      colCluesEl.appendChild(cc);
      colClueEls.push(cc);
    }

    for (let r = 0; r < N; r++) {
      const rc = el('div', 'row-clue');
      rowClues[r].forEach((num) => { if (num > 0) rc.appendChild(span(num)); });
      if (rowClues[r].length === 1 && rowClues[r][0] === 0) rc.appendChild(span(0));
      rowCluesEl.appendChild(rc);
      rowClueEls.push(rc);
    }

    for (let r = 0; r < N; r++) {
      cellEls.push([]);
      for (let c = 0; c < N; c++) {
        const cell = el('div', 'cell');
        cell.dataset.r = r;
        cell.dataset.c = c;
        if ((c + 1) % 5 === 0 && c !== N - 1) cell.classList.add('block-right');
        if ((r + 1) % 5 === 0 && r !== N - 1) cell.classList.add('block-bottom');
        gridEl.appendChild(cell);
        cellEls[r].push(cell);
      }
    }

    boardEl.appendChild(corner);
    boardEl.appendChild(colCluesEl);
    boardEl.appendChild(rowCluesEl);
    boardEl.appendChild(gridEl);

    attachPointerHandlers(gridEl);
  }

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function span(n) { const s = document.createElement('span'); s.textContent = n; return s; }

  // ---- Rendering -------------------------------------------------------

  function renderCell(r, c) {
    const cell = cellEls[r][c];
    cell.classList.toggle('filled', state[r][c] === FILLED);
    cell.classList.toggle('marked', state[r][c] === MARKED);
    cell.classList.remove('error');
  }

  function renderAll() {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) renderCell(r, c);
    updateClueSatisfaction();
  }

  // Dim a row/column clue once the filled cells in that line exactly
  // match its clue numbers.
  function lineMatches(values, clue) {
    const got = Solver.lineClues(values.map((v) => (v === FILLED ? 1 : 0)));
    if (got.length !== clue.length) return false;
    for (let i = 0; i < got.length; i++) if (got[i] !== clue[i]) return false;
    return true;
  }

  function updateClueSatisfaction() {
    for (let r = 0; r < N; r++) {
      rowClueEls[r].classList.toggle('satisfied', lineMatches(state[r], rowClues[r]));
    }
    for (let c = 0; c < N; c++) {
      const col = state.map((row) => row[c]);
      colClueEls[c].classList.toggle('satisfied', lineMatches(col, colClues[c]));
    }
  }

  // ---- Drawing / interaction ------------------------------------------

  let drawing = false;
  let drawValue = EMPTY;   // value being painted
  let drawAxis = null;     // 'row' | 'col' | null (locked after first move)
  let drawStart = null;    // {r, c}
  let dragHappened = false;

  function attachPointerHandlers(gridEl) {
    gridEl.addEventListener('contextmenu', (e) => e.preventDefault());

    gridEl.addEventListener('pointerdown', (e) => {
      const cell = cellFromEvent(e);
      if (!cell || solved) return;
      e.preventDefault();
      pushUndo();
      drawing = true;
      dragHappened = false;
      drawAxis = null;
      drawStart = cell;

      const cur = state[cell.r][cell.c];
      const useMark = mode === 'mark' || e.button === 2 || e.pointerType === 'pen' && e.button === 2;
      if (useMark) {
        drawValue = cur === MARKED ? EMPTY : MARKED;
      } else {
        drawValue = cur === FILLED ? EMPTY : FILLED;
      }
      applyCell(cell.r, cell.c, drawValue);
    });

    gridEl.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const cell = cellFromPoint(e.clientX, e.clientY);
      if (!cell) return;
      if (cell.r === drawStart.r && cell.c === drawStart.c) return;
      dragHappened = true;
      if (!drawAxis) {
        drawAxis = cell.r === drawStart.r ? 'row' : 'col';
      }
      if (drawAxis === 'row' && cell.r !== drawStart.r) return;
      if (drawAxis === 'col' && cell.c !== drawStart.c) return;
      applyCell(cell.r, cell.c, drawValue);
    });

    const end = () => {
      if (!drawing) return;
      drawing = false;
      saveProgress();
      updateClueSatisfaction();
      checkWin();
    };
    gridEl.addEventListener('pointerup', end);
    gridEl.addEventListener('pointercancel', end);
    window.addEventListener('pointerup', end);
  }

  function applyCell(r, c, value) {
    if (state[r][c] === value) return;
    state[r][c] = value;
    renderCell(r, c);
  }

  function cellFromEvent(e) {
    return cellFromTarget(e.target);
  }
  function cellFromTarget(target) {
    if (!target || !target.classList || !target.classList.contains('cell')) return null;
    return { r: +target.dataset.r, c: +target.dataset.c };
  }
  function cellFromPoint(x, y) {
    return cellFromTarget(document.elementFromPoint(x, y));
  }

  // ---- Undo ------------------------------------------------------------

  function pushUndo() {
    undoStack.push(state.map((row) => row.slice()));
    if (undoStack.length > 100) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length || solved) return;
    state = undoStack.pop();
    renderAll();
    saveProgress();
  }

  // ---- Check / win -----------------------------------------------------

  function checkMistakes() {
    let mistakes = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const wrong = state[r][c] === FILLED && solution[r][c] === 0;
        if (wrong) { cellEls[r][c].classList.add('error'); mistakes++; }
      }
    }
    if (mistakes === 0) {
      flashHint('No mistakes so far — keep going!');
    } else {
      flashHint(`${mistakes} filled cell${mistakes > 1 ? 's are' : ' is'} wrong (outlined).`);
      setTimeout(() => {
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++) cellEls[r][c].classList.remove('error');
      }, 2000);
    }
  }

  function isSolved() {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if ((state[r][c] === FILLED) !== (solution[r][c] === 1)) return false;
    return true;
  }

  function checkWin() {
    if (solved) return;
    if (!isSolved()) return;
    solved = true;
    try { localStorage.setItem(SOLVED_KEY, '1'); } catch (e) {}
    // Clean up stray marks so the finished picture is clean.
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (state[r][c] === MARKED) { state[r][c] = EMPTY; renderCell(r, c); }
      }
    }
    saveProgress();
    recordStreak();
    showWin();
  }

  // ---- Streak ----------------------------------------------------------

  function recordStreak() {
    let data;
    try { data = JSON.parse(localStorage.getItem(STREAK_KEY)) || {}; }
    catch (e) { data = {}; }
    const todayKey = dateKey(today);
    if (data.lastSolved === todayKey) return; // already counted
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    data.count = data.lastSolved === dateKey(yest) ? (data.count || 0) + 1 : 1;
    data.lastSolved = todayKey;
    try { localStorage.setItem(STREAK_KEY, JSON.stringify(data)); } catch (e) {}
    updateStreakLine();
  }

  function currentStreak() {
    try {
      const data = JSON.parse(localStorage.getItem(STREAK_KEY)) || {};
      const todayKey = dateKey(today);
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      // Streak is "live" only if the last solve was today or yesterday.
      if (data.lastSolved === todayKey || data.lastSolved === dateKey(yest)) {
        return data.count || 0;
      }
    } catch (e) {}
    return 0;
  }

  // ---- UI glue ---------------------------------------------------------

  const dateLine = document.getElementById('date-line');
  const hintLine = document.getElementById('hint-line');
  const streakLine = document.getElementById('streak-line');
  const sizeLine = document.getElementById('size-line');
  const defaultHint = hintLine.textContent;
  let hintTimer = null;

  function flashHint(msg) {
    hintLine.textContent = msg;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintLine.textContent = defaultHint; }, 3500);
  }

  function updateStreakLine() {
    const s = currentStreak();
    streakLine.textContent = s > 0 ? `🔥 Streak: ${s} day${s > 1 ? 's' : ''}` : '';
  }

  function setMode(m) {
    mode = m;
    document.getElementById('mode-fill').classList.toggle('active', m === 'fill');
    document.getElementById('mode-mark').classList.toggle('active', m === 'mark');
  }

  function showWin() {
    document.getElementById('win-emoji').textContent = puzzle.emoji || '🎉';
    document.getElementById('win-title').textContent = 'You solved it!';
    document.getElementById('win-sub').innerHTML =
      `It's a <strong>${puzzle.name}</strong> ${puzzle.emoji || ''}`;
    const s = currentStreak();
    document.getElementById('win-next').textContent =
      (s > 1 ? `🔥 ${s}-day streak! ` : '') + 'Come back tomorrow for a new picture.';
    document.getElementById('win-banner').hidden = false;
  }

  function setupControls() {
    document.getElementById('mode-fill').addEventListener('click', () => setMode('fill'));
    document.getElementById('mode-mark').addEventListener('click', () => setMode('mark'));
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-check').addEventListener('click', checkMistakes);
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (solved) return;
      if (!confirm('Clear the whole board?')) return;
      pushUndo();
      state = blankState();
      renderAll();
      saveProgress();
    });

    const howOverlay = document.getElementById('how-overlay');
    document.getElementById('btn-how').addEventListener('click', () => { howOverlay.hidden = false; });
    document.getElementById('how-close').addEventListener('click', () => { howOverlay.hidden = true; });

    document.getElementById('win-close').addEventListener('click', () => {
      document.getElementById('win-banner').hidden = true;
    });

    // Keyboard: F / X to switch modes, Z to undo.
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') setMode('fill');
      else if (e.key === 'x' || e.key === 'X') setMode('mark');
      else if ((e.key === 'z' || e.key === 'Z')) undo();
    });
  }

  // ---- Init ------------------------------------------------------------

  function init() {
    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateLine.textContent = today.toLocaleDateString(undefined, opts);
    sizeLine.textContent = `Grid: ${N}×${N}`;
    buildBoard();
    renderAll();
    setupControls();
    updateStreakLine();
    if (solved) showWin();
  }

  init();
})();
