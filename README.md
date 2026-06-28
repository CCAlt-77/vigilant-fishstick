# Daily Nonogram 🧩

A web app for a **daily Nonogram** (a.k.a. Picross / Griddler) picture-logic
puzzle. Every day reveals a different hidden picture on a **12×12** or
**15×15** grid. Like the daily Futoshiki app, everyone gets the same puzzle
each day, and your progress is saved in the browser.

Fill the cells using the number clues beside each row and above each column to
uncover the picture.

Works great in a mobile browser (e.g. Safari on iPhone): tap to fill, tap the
**Mark** button to flag empty cells, and drag to paint a run. The grid auto-sizes
to fit your screen and re-fits when you rotate the phone.

## Play it

It's a static site — no build step, no dependencies.

```bash
# Option 1: just open the file
open index.html            # macOS  (or double-click it)

# Option 2: run the tiny dev server
npm start                  # serves http://localhost:8080
```

## How to play

- The numbers beside a **row** / above a **column** are the lengths of the
  consecutive runs of filled cells in that line, in order. `4 2` means a block
  of 4, a gap, then a block of 2.
- **Fill** mode colours a cell. **Mark** mode (or right-click / long-press)
  flags a cell as definitely empty, to help you keep track.
- **Drag** across cells to fill or mark a whole run at once.
- **Check** outlines any wrong filled cells. **Undo** steps back. **Reset**
  clears the board.
- Solve the whole grid to reveal the picture. Keep a daily **streak** going!

Every daily puzzle is guaranteed to have **exactly one solution** that can be
reached by pure logic — you never have to guess.

## How a new picture is chosen each day

- `js/puzzles.js` holds a library of hand-designed pixel pictures. The row and
  column number clues are derived from each picture automatically.
- The app maps the calendar date to a puzzle with a fixed shuffle
  (`pickDailyPuzzle` in `js/app.js`), so the choice is deterministic — the same
  for everyone — and cycles through the whole library before any picture
  repeats. Consecutive days are always different pictures.

Append `?date=YYYY-MM-DD` to the URL to preview or replay the puzzle for any
specific day (handy for testing).

To add your own picture, append an entry to `js/puzzles.js` (a list of
`'#'`/`'.'` rows, 12×12 or 15×15) and re-run the validator below.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `css/style.css` | Styling / responsive layout |
| `js/solver.js` | Nonogram line-solver + uniqueness verifier |
| `js/puzzles.js` | The picture library |
| `js/app.js` | Game engine, rendering, daily pick, save/streak |
| `tools/validate.js` | Checks every picture is uniquely solvable |
| `tools/smoke.js` | Headless browser test that solves the day's puzzle |
| `tools/mobile.js` | Emulates iPhones to confirm a 15×15 fits and is tappable |

## Tests

```bash
npm run validate     # verify all 40 pictures are uniquely (logic-)solvable
node tools/smoke.js  # end-to-end browser test (requires Playwright + Chromium)
node tools/mobile.js # iPhone-emulation layout/touch test
```

`validate.js` confirms each picture is the right size, is rectangular, and
yields a nonogram with exactly one solution that is solvable without guessing.
