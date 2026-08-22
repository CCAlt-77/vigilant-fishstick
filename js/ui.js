import { DIFFICULTIES, FORMATS, TOURNAMENTS, OPPONENTS, KEYS, difficultyWithRamp } from './config.js';
import { store, pick } from './util.js';
import { sfx } from './audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DIFF_HINTS = {
  easy: 'Slower around the court and prone to errors. A gentle introduction.',
  medium: 'Solid, consistent, and will punish a short ball.',
  hard: 'Fast, accurate and inventive. Expect angles, lobs and drop shots.',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.current = null;
    this.settings = store.get(KEYS.settings, { sound: true, difficulty: 'medium', format: 'standard' });
    this.records = store.get(KEYS.records, {
      played: 0, won: 0, lost: 0, tourneys: 0, aces: 0, longestRally: 0, bestWin: '—',
    });
    this.tournament = store.get(KEYS.tournament, null);
    this.mode = 'match';
    this.pendingResult = null;

    sfx.setEnabled(this.settings.sound);
    this.bind();
    this.buildSegments();
    this.show('s-title');
  }

  // ------------------------------------------------------------ navigation

  show(id, remember = true) {
    if (this.current && remember) this.stack.push(this.current);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    this.current = id;
    $('#overlay').classList.remove('hidden');
    $('#hud').classList.add('hidden');
    if (id === 's-records') this.renderRecords();
    if (id === 's-tourpick') this.renderTournamentList();
    if (id === 's-ladder') this.renderLadder();
  }

  back() {
    const prev = this.stack.pop() || 's-title';
    this.show(prev, false);
  }

  hideOverlay() {
    $('#overlay').classList.add('hidden');
    $('#hud').classList.remove('hidden');
  }

  bind() {
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { sfx.ui(); this.show(go.dataset.go); return; }
      const back = e.target.closest('[data-back]');
      if (back) { sfx.ui(); this.back(); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode) { sfx.ui(); this.chooseMode(mode.dataset.mode); }
    });

    $('#btn-sound').addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      sfx.setEnabled(this.settings.sound);
      sfx.ui();
      this.saveSettings();
      this.renderSound();
    });
    this.renderSound();

    $('#btn-start').addEventListener('click', () => this.startFromSetup());
    $('#btn-pause').addEventListener('click', () => this.pause());
    $('#btn-resume').addEventListener('click', () => this.resume());
    $('#btn-quit').addEventListener('click', () => { this.game.stop(); this.stack = []; this.show('s-title', false); });
    $('#btn-menu').addEventListener('click', () => { this.game.stop(); this.stack = []; this.show('s-title', false); });
    $('#btn-next').addEventListener('click', () => this.onContinue());
    $('#btn-play-round').addEventListener('click', () => this.startTournamentRound());
    $('#btn-abandon').addEventListener('click', () => {
      this.tournament = null;
      store.set(KEYS.tournament, null);
      this.show('s-tourpick', false);
    });
    $('#btn-clear').addEventListener('click', () => {
      this.records = { played: 0, won: 0, lost: 0, tourneys: 0, aces: 0, longestRally: 0, bestWin: '—' };
      store.set(KEYS.records, this.records);
      this.renderRecords();
    });
  }

  renderSound() {
    $('#btn-sound').textContent = `Sound: ${this.settings.sound ? 'on' : 'off'}`;
  }

  saveSettings() { store.set(KEYS.settings, this.settings); }

  // --------------------------------------------------------------- setup

  buildSegments() {
    const dseg = $('#seg-difficulty');
    dseg.innerHTML = '';
    Object.values(DIFFICULTIES).forEach((d) => {
      const b = document.createElement('button');
      b.innerHTML = `<span>${d.name}</span>`;
      b.onclick = () => { sfx.ui(); this.settings.difficulty = d.key; this.saveSettings(); this.syncSegments(); };
      b.dataset.key = d.key;
      dseg.appendChild(b);
    });

    const fseg = $('#seg-format');
    fseg.innerHTML = '';
    Object.values(FORMATS).forEach((f) => {
      const b = document.createElement('button');
      b.innerHTML = `<span>${f.name}</span><small>${f.blurb}</small>`;
      b.onclick = () => { sfx.ui(); this.settings.format = f.key; this.saveSettings(); this.syncSegments(); };
      b.dataset.key = f.key;
      fseg.appendChild(b);
    });
    this.syncSegments();
  }

  syncSegments() {
    $$('#seg-difficulty button').forEach((b) => b.classList.toggle('on', b.dataset.key === this.settings.difficulty));
    $$('#seg-format button').forEach((b) => b.classList.toggle('on', b.dataset.key === this.settings.format));
    $('#hint-difficulty').textContent = DIFF_HINTS[this.settings.difficulty];
  }

  chooseMode(mode) {
    this.mode = mode;
    if (mode === 'tournament') { this.show(this.tournament ? 's-ladder' : 's-tourpick'); return; }
    $('#setup-title').textContent = mode === 'practice' ? 'Practice Rally' : 'Single Match';
    $('#field-format').style.display = mode === 'practice' ? 'none' : '';
    $('#btn-start').textContent = mode === 'practice' ? 'Start rallying' : 'Start match';
    this.show('s-setup');
  }

  startFromSetup() {
    sfx.ensure();
    const diff = DIFFICULTIES[this.settings.difficulty];
    const opp = pick(OPPONENTS);
    this.launch({
      mode: this.mode,
      difficulty: { ...diff },
      difficultyKey: this.settings.difficulty,
      format: FORMATS[this.settings.format],
      opponent: opp,
      context: this.mode === 'practice' ? 'Practice' : `${diff.name} · ${FORMATS[this.settings.format].name}`,
    });
  }

  // ---------------------------------------------------------- tournament

  renderTournamentList() {
    const list = $('#tour-list');
    list.innerHTML = '';
    TOURNAMENTS.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<strong>${t.name}</strong><span>${t.blurb} Opponents start at ${DIFFICULTIES[t.base].name.toLowerCase()} and get harder each round.</span>`;
      b.onclick = () => { sfx.ui(); this.createTournament(t); };
      list.appendChild(b);
    });
  }

  createTournament(t) {
    const pool = OPPONENTS.slice();
    const draw = [];
    for (let i = 0; i < t.rounds.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      draw.push(pool.splice(idx, 1)[0]);
    }
    this.tournament = {
      key: t.key,
      formatKey: this.settings.format,
      round: 0,
      draw,
      results: [],
    };
    store.set(KEYS.tournament, this.tournament);
    this.show('s-ladder');
  }

  tourneyDef() { return TOURNAMENTS.find((t) => t.key === this.tournament.key) || TOURNAMENTS[0]; }

  renderLadder() {
    if (!this.tournament) { this.show('s-tourpick', false); return; }
    const t = this.tourneyDef();
    const st = this.tournament;
    $('#ladder-title').textContent = t.name;
    $('#ladder-sub').textContent = `${FORMATS[st.formatKey].name} matches · ${FORMATS[st.formatKey].blurb.toLowerCase()}`;
    const list = $('#ladder-list');
    list.innerHTML = '';
    t.rounds.forEach((rd, i) => {
      const li = document.createElement('li');
      const res = st.results[i];
      const cls = res ? (res.won ? 'won' : 'lost') : (i === st.round ? 'now' : '');
      li.className = cls;
      const opp = st.draw[i];
      const d = difficultyWithRamp(t.base, t.ramp[i]);
      li.innerHTML = `<span class="dot"></span><span class="rd">${rd}</span><span class="op">${opp.name}${res ? ` · ${res.score}` : ` · ${d.name}+`}</span>`;
      list.appendChild(li);
    });
    const done = st.round >= t.rounds.length;
    $('#btn-play-round').style.display = done ? 'none' : '';
    $('#btn-play-round').textContent = `Play ${t.rounds[Math.min(st.round, t.rounds.length - 1)]}`;
  }

  startTournamentRound() {
    sfx.ensure();
    const t = this.tourneyDef();
    const st = this.tournament;
    const i = st.round;
    const diff = difficultyWithRamp(t.base, t.ramp[i]);
    this.launch({
      mode: 'tournament',
      difficulty: diff,
      difficultyKey: t.base,
      format: FORMATS[st.formatKey],
      opponent: st.draw[i],
      context: `${t.name} · ${t.rounds[i]}`,
    });
  }

  // --------------------------------------------------------------- match

  launch(config) {
    this.config = config;
    this.hideOverlay();
    $('#context').textContent = config.context;
    $('[data-name="1"]').textContent = config.opponent.short || config.opponent.name.split(' ').pop().toUpperCase();
    $('#scoreboard').style.display = config.mode === 'practice' ? 'none' : '';
    this.game.start(config);
  }

  pause() {
    if (!this.game.running) return;
    this.game.setPaused(true);
    $('#pause-score').textContent = this.game.match
      ? `${this.config.context} — ${this.game.match.setSummary() || 'first game'}`
      : this.config.context;
    this.stack = ['s-title'];
    this.show('s-pause', false);
  }

  resume() {
    $('#overlay').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    this.game.setPaused(false);
  }

  // --------------------------------------------------------------- hooks

  onScore(match) {
    if (!match) return;
    const sets = match.completedSets;
    for (let i = 0; i < 2; i++) {
      $(`[data-serve="${i}"]`).classList.toggle('on', match.server === i);
      $(`[data-sets="${i}"]`).textContent = sets.map((s) => s[i]).join(' ');
      $(`[data-games="${i}"]`).textContent = match.games[i];
      $(`[data-points="${i}"]`).textContent = match.pointLabel(i);
    }
  }

  onAnnounce(text, sub, tone) {
    const el = $('#announce');
    el.className = `show ${tone}`;
    el.querySelector('span').textContent = text;
    el.querySelector('small').textContent = sub || '';
    clearTimeout(this._annT);
    this._annT = setTimeout(() => { el.className = tone; }, 1400);
  }

  onPrompt(text) { $('#prompt').textContent = text || ''; }

  onShotLabel(text) {
    const el = $('#shot-label');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._shotT);
    this._shotT = setTimeout(() => el.classList.remove('show'), 900);
  }

  onPractice(score) {
    $('#context').textContent = `Practice · rally ${score.rally} · best ${score.best}`;
  }

  onMatchEnd(match, won) {
    const cfg = this.config;
    this.records.played++;
    this.records[won ? 'won' : 'lost']++;
    this.records.aces += match.stats[0].aces;
    this.records.longestRally = Math.max(this.records.longestRally, match.longestRally);
    if (won) this.records.bestWin = `${cfg.opponent.name} (${match.setSummary()})`;

    let nextLabel = 'Play again';
    let trophy = '';
    if (cfg.mode === 'tournament' && this.tournament) {
      const t = this.tourneyDef();
      const st = this.tournament;
      st.results[st.round] = { won, score: match.setSummary() };
      if (won) {
        st.round++;
        if (st.round >= t.rounds.length) {
          this.records.tourneys++;
          trophy = '🏆';
          nextLabel = 'Collect the trophy';
        } else {
          nextLabel = `On to the ${t.rounds[st.round].toLowerCase()}`;
        }
      } else {
        nextLabel = 'Back to tournaments';
      }
      store.set(KEYS.tournament, st);
    }
    store.set(KEYS.records, this.records);

    const isChampion = trophy !== '';
    $('#result-title').textContent = isChampion
      ? `${this.tourneyDef().name} champion`
      : won ? 'Match won' : 'Match lost';
    $('#result-score').textContent = `${won ? 'Beat' : 'Lost to'} ${cfg.opponent.name}  ·  ${match.setSummary()}`;
    const s = match.stats[0], o = match.stats[1];
    $('#result-stats').innerHTML = `
      ${isChampion ? '<div class="trophy">🏆</div>' : ''}
      <div><span>Points won</span><span>${s.won} – ${o.won}</span></div>
      <div><span>Aces</span><span>${s.aces}</span></div>
      <div><span>Double faults</span><span>${s.doubles}</span></div>
      <div><span>Winners</span><span>${s.winners}</span></div>
      <div><span>Unforced errors</span><span>${s.errors}</span></div>
      <div><span>Longest rally</span><span>${match.longestRally} shots</span></div>`;
    $('#btn-next').textContent = nextLabel;
    this.pendingResult = { won, mode: cfg.mode };
    this.stack = ['s-title'];
    this.show('s-result', false);
  }

  onContinue() {
    sfx.ui();
    const r = this.pendingResult;
    if (!r) { this.show('s-title', false); return; }
    if (r.mode === 'tournament') {
      const t = this.tourneyDef();
      const st = this.tournament;
      if (!r.won || !st) {
        this.tournament = null;
        store.set(KEYS.tournament, null);
        this.show('s-tourpick', false);
        return;
      }
      if (st.round >= t.rounds.length) {
        this.tournament = null;
        store.set(KEYS.tournament, null);
        this.show('s-tourpick', false);
        return;
      }
      this.show('s-ladder', false);
      return;
    }
    this.show('s-setup', false);
  }

  renderRecords() {
    const r = this.records;
    $('#records-list').innerHTML = `
      <div><span>Matches played</span><span>${r.played}</span></div>
      <div><span>Won</span><span>${r.won}</span></div>
      <div><span>Lost</span><span>${r.lost}</span></div>
      <div><span>Tournaments won</span><span>${r.tourneys}</span></div>
      <div><span>Aces served</span><span>${r.aces}</span></div>
      <div><span>Longest rally</span><span>${r.longestRally} shots</span></div>
      <div><span>Latest win</span><span>${r.bestWin}</span></div>`;
  }
}
