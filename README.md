# Ace Point Tennis

One-thumb tennis for the iPhone. Runs as a website, and adds to the Home Screen as a
full-screen app — no App Store, no install, works offline once it has loaded.

You play the near player, hitting up the court. Your player runs to the ball on their
own; your job is choosing and shaping the shot.

## Playing it on your phone

**As a website.** GitHub Pages publishes this repository straight from the branch
root, so every push is live within a minute or two:

```
https://ccalt-77.github.io/vigilant-fishstick/        the installable app
https://ccalt-77.github.io/vigilant-fishstick/dist/   the single-file build
```

`.nojekyll` at the root keeps Pages from running the site through Jekyll.
`.github/workflows/tests.yml` runs the scoring, serving and balance checks on every
push, verifies `dist/` matches the source, and confirms the files the site needs are
present — a green run is already deployed.

Any static host works too: serve the repository root and open `index.html`.

**As an app.** Open that URL in Safari, tap the Share button, then **Add to Home
Screen**. It launches full screen with no browser chrome, and the service worker keeps
it playable with no signal.

**Single file.** `dist/index.html` is the whole game inlined into one file — useful for
opening straight off a disk, emailing to yourself, or dropping into any host.
`dist/artifact.html` is the same bundle without the `<html>`/`<head>`/`<body>` wrapper,
for hosts that supply their own document skeleton. Rebuild both with
`node tools/build.mjs` after changing anything under `js/` or `css/`.

**Locally.** It needs to be served over http rather than opened as a `file://` path,
because it uses ES modules:

```sh
npx http-server -p 8145 .      # then open http://<your-computer-ip>:8145 on the phone
```

## Controls

Everything is one thumb, anywhere on the screen.

| Gesture | Shot |
| --- | --- |
| Tap | Standard drive into the open court |
| Fast flick up | Flat power drive, deep and low |
| Long slow drag up | Lob, over their head |
| Swipe down | Drop shot, dying just over the net |
| Swipe sideways | Angled slice into the tramlines |

The sideways lean of any swipe steers the ball left or right — swipe up and to the
right to drive down the right-hand line. While your thumb is down, the landing spot and
the ball's flight are previewed on the court.

A ring appears around your player when a ball is coming. Swipe as it arrives: meeting
the ball while balanced gives a clean, accurate shot, and hitting it at full stretch or
on the run scatters it. Swiping early is fine — the swipe is buffered until the ball is
in range.

Serving is the same swipe. The box you have to hit is marked on the far court and swaps
side every point, so the aim marker only moves within it. Swipe length sets the pace and
how deep it lands; sideways lean moves it between the centre line and out wide. Two
serves, as usual, and the second is automatically safer.

## Modes

- **Single match** — Quick (one short set to four games), Standard (best of three) or
  Classic (best of five), against an Easy, Medium or Difficult opponent.
- **Tournament** — three events, each a four-round knockout with opponents that get
  harder every round. Progress is saved, so you can put the phone down mid-draw.
- **Practice rally** — no score, endless rally, for learning the gestures.

Scoring is normal tennis: 15/30/40, deuce and advantage, six games to a set with a
tiebreak at 6-6, and lets and double faults on serve. Short sets use a tiebreak at 4-4.

## How it is built

Vanilla ES modules and a single 2D canvas — no framework, no build step for the site
itself, no assets to download. The court is drawn through a pinhole camera fixed above
and behind the near baseline; the ball is a drag-free parabola, which lets the shot
solver, the on-screen aiming preview and the opponent's anticipation all agree exactly
on where a ball is going.

```
index.html            page shell and all the menu screens
css/style.css         menus, HUD, safe-area handling
js/config.js          court dimensions, shot table, difficulty and format definitions
js/camera.js          world -> screen projection and court framing
js/physics.js         flight, shot solving, bounce and intercept prediction
js/entities.js        ball and player state
js/scoring.js         tennis scoring
js/ai.js              opponent movement and shot selection
js/render.js          all drawing
js/input.js           swipe recognition
js/game.js            match loop, rules and point outcomes
js/ui.js              screens, tournament state, records
sw.js                 offline cache
tools/                build, icon generation and the test harnesses
```

## Tests

```sh
node tools/test-scoring.mjs    # scoring rules: deuce, tiebreaks, set and match logic
node tools/test-serve.mjs      # serve legality, court alternation, steady preview, box coverage
node tools/test-shots.mjs      # every shot type reachable, full court covered, player movement range
node tools/sim.mjs             # headless balance run: rally lengths and win rates per difficulty
npx http-server -p 8145 -s . & # the browser tests need the site served
node tools/test-ui.mjs         # menus, tournament flow, pause, saved progress
node tools/test-dist.mjs       # the bundled builds boot and play like the modular site
node tools/smoke.mjs           # plays a match in headless Safari-sized Chromium, screenshots
node tools/test-perf.mjs URL 2 # frame times under CPU throttling
```

`tools/sim.mjs` stubs the DOM and runs the real game modules, so a few hundred points
play out in about a second. It is what the difficulty and rally-length numbers were
tuned against, standing in for a competent player: aims to a side most of the time but
rarely paints a line, and mostly hits deep. Against that, you win roughly 77% against
Easy, 50% against Medium and 35% against Difficult, with median rallies of about 5, 9
and 9 shots.

`tools/test-perf.mjs` reports frame times under CPU throttling. Read the median — on a
shared machine the tail swings enough with run order that A/B comparisons come out
backwards.
