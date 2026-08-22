// Standard tennis scoring: 15/30/40, deuce and advantage, games, sets and tiebreaks.

const POINT_NAMES = ['0', '15', '30', '40'];

export class Match {
  constructor(format, firstServer = 0) {
    this.format = format;
    this.targetSets = Math.ceil(format.sets / 2);
    this.points = [0, 0];
    this.games = [0, 0];
    this.sets = [0, 0];
    this.completedSets = [];   // [[gamesA, gamesB], ...]
    this.server = firstServer;
    this.tiebreak = false;
    this.tbPoints = [0, 0];
    this.tbServeCount = 0;
    this.over = false;
    this.winner = -1;
    this.pointsInGame = 0;
    this.stats = [
      { won: 0, aces: 0, doubles: 0, winners: 0, errors: 0 },
      { won: 0, aces: 0, doubles: 0, winners: 0, errors: 0 },
    ];
    this.longestRally = 0;
  }

  // Which half the server delivers from. Even points played -> deuce court.
  get serveCourt() {
    return this.pointsInGame % 2 === 0 ? 'deuce' : 'ad';
  }

  pointLabel(i) {
    if (this.tiebreak) return String(this.tbPoints[i]);
    const p = this.points[i], q = this.points[1 - i];
    if (p >= 3 && q >= 3) {
      if (p === q) return '40';
      return p > q ? 'AD' : '–';
    }
    return POINT_NAMES[Math.min(3, p)];
  }

  get scoreCall() {
    if (this.tiebreak) return `${this.tbPoints[0]}-${this.tbPoints[1]}`;
    const [a, b] = this.points;
    if (a >= 3 && b >= 3) {
      if (a === b) return 'Deuce';
      return a > b ? 'Advantage you' : 'Advantage opponent';
    }
    if (a === b) return `${POINT_NAMES[a]}-all`;
    return `${POINT_NAMES[Math.min(3, a)]}-${POINT_NAMES[Math.min(3, b)]}`;
  }

  // Award a point. Returns a description of what that point completed.
  awardPoint(i) {
    if (this.over) return { kind: 'none' };
    const other = 1 - i;
    this.stats[i].won++;
    this.pointsInGame++;

    if (this.tiebreak) {
      this.tbPoints[i]++;
      // Server changes after the first point, then every two points.
      this.tbServeCount++;
      if (this.tbServeCount === 1 || this.tbServeCount % 2 === 1) this.server = 1 - this.server;
      if (this.tbPoints[i] >= 7 && this.tbPoints[i] - this.tbPoints[other] >= 2) {
        this.games[i]++;
        return this._winSet(i);
      }
      return { kind: 'point' };
    }

    this.points[i]++;
    if (this.points[i] >= 4 && this.points[i] - this.points[other] >= 2) {
      return this._winGame(i);
    }
    return { kind: 'point' };
  }

  _winGame(i) {
    this.points = [0, 0];
    this.pointsInGame = 0;
    this.games[i]++;
    this.server = 1 - this.server;

    const f = this.format;
    const other = 1 - i;
    if (this.games[i] >= f.gamesPerSet && this.games[i] - this.games[other] >= 2) {
      return this._winSet(i);
    }
    if (this.games[0] === f.tiebreakAt && this.games[1] === f.tiebreakAt) {
      this.tiebreak = true;
      this.tbPoints = [0, 0];
      this.tbServeCount = 0;
      return { kind: 'game', by: i, tiebreak: true };
    }
    return { kind: 'game', by: i };
  }

  _winSet(i) {
    this.sets[i]++;
    this.completedSets.push([this.games[0], this.games[1]]);
    this.games = [0, 0];
    this.points = [0, 0];
    this.tbPoints = [0, 0];
    this.tiebreak = false;
    this.pointsInGame = 0;
    if (this.sets[i] >= this.targetSets) {
      this.over = true;
      this.winner = i;
      return { kind: 'match', by: i };
    }
    return { kind: 'set', by: i };
  }

  setSummary() {
    const rows = this.completedSets.map(([a, b]) => `${a}-${b}`);
    if (!this.over && (this.games[0] || this.games[1])) rows.push(`${this.games[0]}-${this.games[1]}`);
    return rows.join('  ');
  }
}
