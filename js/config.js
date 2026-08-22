// Court dimensions are the real thing, in metres. The world runs:
//   y = 0 at the net, negative towards the near (human) player, positive towards the far player
//   x = 0 at the centre line, positive to the right of the near player
//   z = 0 at the court surface, up is positive

export const G = 9.81;

export const COURT = {
  halfLen: 11.885,        // baseline to net
  halfSingles: 4.115,     // singles sideline
  halfDoubles: 5.485,     // doubles sideline (drawn, not played)
  serviceLine: 6.40,      // service line distance from net
  netCentre: 0.914,
  netPost: 1.07,
  ballR: 0.0335,
};

export function netHeightAt(x) {
  const t = Math.min(1, Math.abs(x) / COURT.halfDoubles);
  return COURT.netCentre + (COURT.netPost - COURT.netCentre) * t * t;
}

// Where the camera sits. High and behind the near player's baseline, tilted down.
export const CAMERA = {
  y: -30,
  z: 17,
  lookY: 1.0,
  lookZ: 0.8,
};

export const PALETTE = {
  sky: '#0d1b2a',
  standsTop: '#101a2c',
  standsBottom: '#1b2740',
  hoarding: '#12304a',
  hoardingInk: '#4fd1c5',
  surround: '#12563f',
  surroundAlt: '#0f4a37',
  court: '#1f6fb2',
  courtInner: '#2a7fc4',
  line: '#f3f7fb',
  net: '#dfe7ef',
  ball: '#e8ff5a',
  ballShade: '#b9d02f',
  shadow: 'rgba(4, 18, 12, 0.34)',
  home: '#f8fafc',
  homeAlt: '#2563eb',
  awayDefault: '#ef4444',
};

export const SHOTS = {
  drive:  { label: 'DRIVE',      T: 0.72, depth: [4.6, 11.0], clear: 0.32, rest: 0.72, fric: 0.64, spread: 3.90 },
  power:  { label: 'FLAT DRIVE', T: 0.60, depth: [7.0, 11.3], clear: 0.18, rest: 0.76, fric: 0.68, spread: 4.00 },
  lob:    { label: 'LOB',        T: 2.07, depth: [8.4, 11.0], clear: 1.90, rest: 0.50, fric: 0.52, spread: 3.00 },
  drop:   { label: 'DROP SHOT',  T: 0.92, depth: [1.1, 3.4],  clear: 0.26, rest: 0.40, fric: 0.38, spread: 3.20 },
  slice:  { label: 'ANGLE',      T: 0.79, depth: [3.4, 8.6],  clear: 0.28, rest: 0.58, fric: 0.74, spread: 4.35 },
};

export const DIFFICULTIES = {
  easy:   { key: 'easy',   name: 'Easy',      speed: 3.7, reaction: 0.32, error: 0.200, jitter: 0.85, serveT: 0.95, aggression: 0.15, variety: 0.15, reach: 1.58, pace: 1.22 },
  medium: { key: 'medium', name: 'Medium',    speed: 4.05, reaction: 0.18, error: 0.100, jitter: 0.62, serveT: 0.86, aggression: 0.50, variety: 0.38, reach: 1.70, pace: 0.92 },
  hard:   { key: 'hard',   name: 'Difficult', speed: 4.5, reaction: 0.07, error: 0.075, jitter: 0.42, serveT: 0.78, aggression: 0.85, variety: 0.62, reach: 1.82, pace: 0.74 },
};

export const FORMATS = {
  quick:    { key: 'quick',    name: 'Quick',    blurb: 'One short set, first to 4 games', sets: 1, gamesPerSet: 4, tiebreakAt: 4 },
  standard: { key: 'standard', name: 'Standard', blurb: 'Best of 3 sets, first to 6 games', sets: 3, gamesPerSet: 6, tiebreakAt: 6 },
  classic:  { key: 'classic',  name: 'Classic',  blurb: 'Best of 5 sets, the full distance', sets: 5, gamesPerSet: 6, tiebreakAt: 6 },
};

export const OPPONENTS = [
  { name: 'Rico Vale',    short: 'VALE',   colour: '#ef4444', trim: '#7f1d1d' },
  { name: 'Jonas Beck',   short: 'BECK',   colour: '#f59e0b', trim: '#78350f' },
  { name: 'Ari Sandoval', short: 'SAND',   colour: '#a855f7', trim: '#4c1d95' },
  { name: 'Theo Marchal', short: 'MARC',   colour: '#10b981', trim: '#064e3b' },
  { name: 'Kai Ostrom',   short: 'OSTR',   colour: '#06b6d4', trim: '#164e63' },
  { name: 'Luca Renzi',   short: 'RENZ',   colour: '#f43f5e', trim: '#881337' },
  { name: 'Mateo Cruz',   short: 'CRUZ',   colour: '#eab308', trim: '#713f12' },
  { name: 'Nils Halvard', short: 'HALV',   colour: '#8b5cf6', trim: '#4c1d95' },
];

export const TOURNAMENTS = [
  {
    key: 'open', name: 'City Open', base: 'easy', crowd: 0.45,
    blurb: 'Four rounds. Friendly draw, decent prize money.',
    rounds: ['Round One', 'Quarter-final', 'Semi-final', 'Final'],
    ramp: [0, 0.18, 0.38, 0.62],
  },
  {
    key: 'masters', name: 'Coastal Masters', base: 'medium', crowd: 0.7,
    blurb: 'Four rounds against seeded professionals.',
    rounds: ['Round One', 'Quarter-final', 'Semi-final', 'Final'],
    ramp: [0, 0.20, 0.42, 0.68],
  },
  {
    key: 'slam', name: 'Grand Championship', base: 'hard', crowd: 1,
    blurb: 'Four rounds. The best in the world, no easy days.',
    rounds: ['Round One', 'Quarter-final', 'Semi-final', 'Final'],
    ramp: [0, 0.22, 0.46, 0.75],
  },
];

// Blend a difficulty preset towards the next one up, for tournament ramping.
export function difficultyWithRamp(baseKey, ramp) {
  const order = ['easy', 'medium', 'hard'];
  const base = DIFFICULTIES[baseKey];
  const idx = order.indexOf(baseKey);
  const next = DIFFICULTIES[order[Math.min(order.length - 1, idx + 1)]];
  const t = idx === order.length - 1 ? ramp * 0.5 : ramp;
  const mix = (a, b) => a + (b - a) * t;
  return {
    key: baseKey,
    name: base.name,
    speed: mix(base.speed, next.speed),
    reaction: mix(base.reaction, next.reaction),
    error: mix(base.error, next.error),
    jitter: mix(base.jitter, next.jitter),
    serveT: mix(base.serveT, next.serveT),
    pace: mix(base.pace, next.pace),
    aggression: mix(base.aggression, next.aggression),
    variety: mix(base.variety, next.variety),
    reach: mix(base.reach, next.reach),
  };
}

export const KEYS = {
  settings: 'acepoint.settings.v1',
  records: 'acepoint.records.v1',
  tournament: 'acepoint.tournament.v1',
  seenHowTo: 'acepoint.seenHowTo.v1',
};
