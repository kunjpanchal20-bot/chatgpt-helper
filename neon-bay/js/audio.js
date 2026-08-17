'use strict';
/* ============================================================
   Neon Bay — audio.js
   Every sound is synthesised with the Web Audio API. No assets,
   no downloads, nothing to 404.
   ============================================================ */

const Audio_ = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  noise: null,
  ready: false,
  muted: false,

  engine: null,   // player engine voice
  siren: null,    // shared police siren voice

  radio: {
    on: true,
    station: 0,
    nextNote: 0,
    step: 0,
    bus: null,
  },

  /** Must be called from a user gesture (browsers block autoplay). */
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);
    this.radio.bus = this.musicBus;

    // One second of white noise, reused by every percussive sound.
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this._buildEngine();
    this._buildSiren();
    this.ready = true;
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  },

  now() { return this.ctx ? this.ctx.currentTime : 0; },

  // ---------------------------------------------------------- primitives

  _noiseSource(dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  },

  /** Short enveloped tone. */
  tone(freq, dur, type, gain, slideTo) {
    if (!this.ready || this.muted) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain === undefined ? 0.2 : gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g); g.connect(this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  },

  /** Filtered noise burst — the backbone of guns, impacts and explosions. */
  burst(dur, filterType, freq, freqEnd, gain, q) {
    if (!this.ready || this.muted) return;
    const t = this.now();
    const src = this._noiseSource(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = filterType || 'bandpass';
    filt.frequency.setValueAtTime(freq, t);
    if (freqEnd) filt.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur);
    filt.Q.value = q === undefined ? 1 : q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain === undefined ? 0.3 : gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  },

  // ---------------------------------------------------------- game sounds

  gunshot(kind) {
    if (!this.ready) return;
    if (kind === 'shotgun') {
      this.burst(0.32, 'lowpass', 2400, 180, 0.5, 1);
      this.tone(90, 0.18, 'square', 0.18, 45);
    } else if (kind === 'smg') {
      this.burst(0.09, 'bandpass', 2200, 900, 0.26, 1.4);
      this.tone(220, 0.05, 'square', 0.07, 120);
    } else if (kind === 'rifle') {
      this.burst(0.16, 'bandpass', 3000, 700, 0.34, 1.1);
      this.tone(160, 0.09, 'sawtooth', 0.1, 70);
    } else {
      this.burst(0.13, 'bandpass', 1800, 700, 0.3, 1.2);
      this.tone(150, 0.07, 'square', 0.1, 80);
    }
  },

  explosion() {
    if (!this.ready) return;
    this.burst(1.2, 'lowpass', 1400, 60, 0.75, 0.7);
    this.tone(70, 0.7, 'sawtooth', 0.32, 24);
    setTimeout(() => this.burst(0.6, 'lowpass', 500, 80, 0.3, 0.6), 60);
  },

  impact() { this.burst(0.07, 'bandpass', 900, 400, 0.2, 2); },
  bodyHit() { this.burst(0.12, 'lowpass', 700, 200, 0.28, 0.8); },
  crash(force) {
    const f = clamp(force, 0.2, 1);
    this.burst(0.22 * f + 0.06, 'bandpass', 1600, 260, 0.34 * f, 1.6);
    this.tone(110, 0.14, 'square', 0.12 * f, 55);
  },
  skid() { this.burst(0.18, 'highpass', 1800, 1400, 0.08, 0.6); },
  pickup() { this.tone(660, 0.09, 'sine', 0.2); setTimeout(() => this.tone(990, 0.12, 'sine', 0.2), 70); },
  cash() { this.tone(880, 0.07, 'triangle', 0.18); setTimeout(() => this.tone(1320, 0.1, 'triangle', 0.16), 60); },
  blip() { this.tone(520, 0.05, 'square', 0.12); },
  denied() { this.tone(200, 0.16, 'square', 0.14, 110); },
  missionStart() {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.2), i * 110));
  },
  missionDone() {
    const seq = [784, 988, 1175, 1568];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.22), i * 120));
  },
  missionFail() {
    const seq = [392, 330, 262];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'sawtooth', 0.18), i * 160));
  },
  wantedUp() { this.tone(440, 0.14, 'square', 0.16); setTimeout(() => this.tone(587, 0.2, 'square', 0.16), 110); },

  // ---------------------------------------------------------- engine voice

  _buildEngine() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    filt.Q.value = 3;

    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 90;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;

    o1.connect(filt); o2.connect(g2); g2.connect(filt);
    filt.connect(g); g.connect(this.master);
    o1.start(); o2.start();

    this.engine = { gain: g, filt, o1, o2 };
  },

  /** rpm 0..1, load 0..1 */
  updateEngine(rpm, load, active) {
    if (!this.ready || !this.engine) return;
    const e = this.engine;
    const t = this.now();
    const target = active ? 0.05 + load * 0.09 : 0;
    e.gain.gain.setTargetAtTime(this.muted ? 0 : target, t, 0.08);
    const f = 42 + rpm * 190;
    e.o1.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 1.51, t, 0.05);
    e.filt.frequency.setTargetAtTime(420 + rpm * 1500, t, 0.08);
  },

  // ---------------------------------------------------------- siren voice

  _buildSiren() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1200;
    filt.Q.value = 2;
    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start();
    this.siren = { gain: g, osc, phase: 0 };
  },

  /** proximity 0..1 — 0 silences the siren entirely. */
  updateSiren(proximity, dt) {
    if (!this.ready || !this.siren) return;
    const s = this.siren;
    const t = this.now();
    s.phase += dt * 1.6;
    const two = Math.sin(s.phase * TAU) > 0;
    s.osc.frequency.setTargetAtTime(two ? 780 : 560, t, 0.02);
    s.gain.gain.setTargetAtTime(this.muted ? 0 : proximity * 0.06, t, 0.1);
  },

  // ---------------------------------------------------------- radio

  stations: [
    { name: 'NEON 101.5 — Synthwave', root: 55, scale: [0, 3, 5, 7, 10], bpm: 104, lead: 'sawtooth', prog: [0, 0, 5, 3] },
    { name: 'BAYSIDE FM — Chillwave', root: 49, scale: [0, 2, 4, 7, 9], bpm: 88, lead: 'triangle', prog: [0, 5, 3, 7] },
    { name: 'K-RATT — Hard Rock', root: 41, scale: [0, 3, 5, 6, 7, 10], bpm: 128, lead: 'square', prog: [0, 0, 3, 5] },
    { name: 'PULSE 88 — Drum Machine', root: 45, scale: [0, 2, 3, 7, 8], bpm: 140, lead: 'sawtooth', prog: [0, 7, 5, 3] },
    { name: 'RADIO OFF', off: true },
  ],

  stationName() { return this.stations[this.radio.station].name; },

  nextStation() {
    this.radio.station = (this.radio.station + 1) % this.stations.length;
    this.radio.step = 0;
    this.radio.nextNote = this.now();
    this.blip();
    return this.stationName();
  },

  midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); },

  _radioVoice(time, midi, dur, type, gain, dest) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(this.midiToFreq(midi), time);
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, time + dur);
    osc.connect(g); g.connect(dest);
    osc.start(time); osc.stop(time + dur + 0.02);
  },

  _radioDrum(time, kind, dest) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
      osc.connect(g); g.connect(dest);
      osc.start(time); osc.stop(time + 0.24);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      if (kind === 'snare') {
        filt.type = 'bandpass'; filt.frequency.value = 1800; filt.Q.value = 0.8;
        g.gain.setValueAtTime(0.28, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
        src.start(time); src.stop(time + 0.18);
      } else {
        filt.type = 'highpass'; filt.frequency.value = 7000;
        g.gain.setValueAtTime(0.1, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
        src.start(time); src.stop(time + 0.07);
      }
      src.connect(filt); filt.connect(g); g.connect(dest);
    }
  },

  /** Called every frame; schedules a little ahead of the audio clock. */
  updateRadio() {
    if (!this.ready || this.muted) return;
    const st = this.stations[this.radio.station];
    if (st.off) return;
    const t = this.now();
    const beat = 60 / st.bpm / 2;          // eighth notes
    if (this.radio.nextNote < t) this.radio.nextNote = t + 0.05;

    while (this.radio.nextNote < t + 0.25) {
      const time = this.radio.nextNote;
      const s = this.radio.step;
      const bar = Math.floor(s / 8) % st.prog.length;
      const rootOffset = st.prog[bar];
      const dest = this.radio.bus;

      // Bass on every beat.
      if (s % 2 === 0) {
        this._radioVoice(time, st.root + rootOffset, beat * 1.8, 'square', 0.16, dest);
      }
      // Arpeggiated lead.
      const deg = st.scale[(s * 3 + bar) % st.scale.length];
      this._radioVoice(time, st.root + 24 + rootOffset + deg, beat * 1.4, st.lead, 0.075, dest);
      if (s % 4 === 2) {
        this._radioVoice(time, st.root + 12 + rootOffset + st.scale[(s + 2) % st.scale.length], beat * 2.4, 'triangle', 0.05, dest);
      }
      // Drums.
      if (s % 4 === 0) this._radioDrum(time, 'kick', dest);
      if (s % 8 === 4) this._radioDrum(time, 'snare', dest);
      this._radioDrum(time, 'hat', dest);

      this.radio.step = (s + 1) % 64;
      this.radio.nextNote += beat;
    }
  },
};
