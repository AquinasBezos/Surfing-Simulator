// Procedural ocean soundscape (WebAudio, no samples): ambient sea, the roar of breaking
// sections nearby, wind/board hiss that grows with speed, and paddle splashes.
export class OceanAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0),
      b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    const loop = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    };
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    // muffles everything when your head goes under
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.master.connect(this.lp).connect(ctx.destination);

    // ambient wash
    const amb = loop(brown);
    const ambF = ctx.createBiquadFilter();
    ambF.type = 'lowpass';
    ambF.frequency.value = 700;
    this.ambG = ctx.createGain();
    this.ambG.gain.value = 0.22;
    amb.connect(ambF).connect(this.ambG).connect(this.master);

    // breaking wave roar
    const roar = loop(brown);
    const roarF = ctx.createBiquadFilter();
    roarF.type = 'bandpass';
    roarF.frequency.value = 420;
    roarF.Q.value = 0.5;
    const roar2 = loop(white);
    const roarF2 = ctx.createBiquadFilter();
    roarF2.type = 'bandpass';
    roarF2.frequency.value = 1800;
    roarF2.Q.value = 0.7;
    const r2g = ctx.createGain();
    r2g.gain.value = 0.12;
    this.roarG = ctx.createGain();
    this.roarG.gain.value = 0;
    roar.connect(roarF).connect(this.roarG);
    roar2.connect(roarF2).connect(r2g).connect(this.roarG);
    this.roarG.connect(this.master);

    // wind / board hiss
    const wind = loop(white);
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 900;
    this.windF.Q.value = 0.6;
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    wind.connect(this.windF).connect(this.windG).connect(this.master);

    this.whiteBuf = white;
  }

  splash(strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100 + Math.random() * 700;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * strength, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 2);
    s.stop(t + 0.4);
  }

  // spray sheet off the rail (snaps, cutbacks, tailslides)
  whoosh(strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45 * strength, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 2);
    s.stop(t + 0.75);
  }

  // pushing the board under
  plunge() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 2);
    s.stop(t + 0.65);
  }

  thud() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.whiteBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 1.7);
  }

  // Quadcopter whine: level 0..1 (how loud / close), throttle 0..1 (motor speed).
  drone(level, throttle) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.droneG) {
      this.droneG = ctx.createGain();
      this.droneG.gain.value = 0;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2400;
      this.droneOsc = [0, 7, -5].map((detune) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 180;
        o.detune.value = detune * 10;
        o.connect(f);
        o.start();
        return o;
      });
      // prop wash
      const n = ctx.createBufferSource();
      n.buffer = this.whiteBuf;
      n.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 1500;
      nf.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      n.connect(nf).connect(ng).connect(this.droneG);
      n.start();
      f.connect(this.droneG).connect(this.master);
    }
    const t = ctx.currentTime;
    this.droneG.gain.setTargetAtTime(Math.min(1, level) * 0.05, t, 0.1);
    for (const [i, o] of this.droneOsc.entries()) o.frequency.setTargetAtTime((150 + throttle * 140) * (1 + i * 0.5), t, 0.08);
  }

  update(roar, speed, underwater) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roarG.gain.setTargetAtTime(Math.min(1.2, roar) * 0.9, t, 0.15);
    this.windG.gain.setTargetAtTime(Math.min(0.5, speed * speed * 0.004), t, 0.2);
    this.windF.frequency.setTargetAtTime(700 + speed * 90, t, 0.2);
    this.master.gain.setTargetAtTime((underwater ? 0.7 : 1) * this.volume, t, 0.1);
    this.lp.frequency.setTargetAtTime(underwater ? 420 : 20000, t, 0.05);
  }
}
