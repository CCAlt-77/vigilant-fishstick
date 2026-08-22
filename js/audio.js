// Tiny WebAudio synth. No sample files, so nothing extra to download.
import { clamp } from './util.js';

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.crowdGain = null;
    this.crowdSource = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // Continuous, very quiet crowd bed.
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 620;
    bp.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.012;
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    this.crowdGain = g;
    this.crowdSource = src;
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.85 : 0;
  }

  _noise(dur, freq, q, vol, type = 'bandpass') {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, vol, type = 'sine', slideTo = null) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hit(power = 1, type = 'drive') {
    const p = clamp(power, 0.3, 1.4);
    if (type === 'drop') {
      this._noise(0.10, 900, 1.4, 0.16 * p);
      this._tone(240, 0.07, 0.05 * p, 'triangle');
    } else if (type === 'lob') {
      this._noise(0.14, 620, 1.0, 0.18 * p);
      this._tone(180, 0.10, 0.06 * p, 'sine', 120);
    } else {
      this._noise(0.09, 1500 * p, 2.2, 0.30 * p);
      this._tone(320 * p, 0.06, 0.10 * p, 'square', 130);
    }
  }

  serve(power = 1) {
    this._noise(0.10, 1900 * power, 2.4, 0.34 * power);
    this._tone(420, 0.07, 0.10, 'square', 150);
  }

  bounce(impact = 6) {
    const p = clamp(impact / 10, 0.12, 1);
    this._noise(0.07, 480 + p * 700, 1.6, 0.16 * p);
  }

  netHit() {
    this._noise(0.16, 260, 0.9, 0.22, 'lowpass');
  }

  whiff() {
    this._noise(0.16, 1100, 0.7, 0.10, 'highpass');
  }

  point(good) {
    if (good) {
      this._tone(660, 0.11, 0.10, 'triangle');
      setTimeout(() => this._tone(990, 0.16, 0.09, 'triangle'), 90);
    } else {
      this._tone(300, 0.14, 0.08, 'triangle', 200);
    }
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.24, 0.10, 'triangle'), i * 110));
  }

  lose() {
    [392, 349, 294].forEach((f, i) => setTimeout(() => this._tone(f, 0.30, 0.09, 'sine'), i * 150));
  }

  ui() {
    this._tone(560, 0.05, 0.05, 'square');
  }

  applause(intensity = 0.6, dur = 1.5) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled || !this.crowdGain) return;
    const t = ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.012 + 0.16 * intensity, t + 0.12);
    g.linearRampToValueAtTime(0.012, t + dur);
  }
}

export const sfx = new Sfx();
