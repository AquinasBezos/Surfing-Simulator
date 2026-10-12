// Breaking-wave model shared by the renderer (GLSL in shaders/waveChunk.js) and the
// physics (the JS below). Both sides must implement exactly the same maths.
//
// Coordinate conventions
//   x : along the beach            z : toward the beach (waves travel +z)
//   Each wave has a straight-ish crest line, slightly curved around the reef at x = 0.
//   A surface point is addressed by its rest position (x, zr). Its crest-relative
//   coordinate is u = zr - crestOffset(x) - crestZ0.

import { WAVE, WAVE_HEIGHTS, SWELL, GRAVITY } from './config.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const sech2 = (x) => {
  const c = Math.cosh(x);
  return 1 / (c * c);
};

// Small deterministic PRNG (mulberry32) so every client derives identical waves.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash01 = (seed, k) => seededRandom((seed ^ Math.imul(k, 0x2c1b3c6d) ^ 0x68e31da4) >>> 0)();

// Horizontal scale of a wave of this height. Big waves keep their proportions; small ones
// get relatively longer, gentler faces (they're slower and mushier in real life, but here
// every wave travels at the same speed, so a tiny steep face would race past a paddler).
export function waveScale(height) {
  return Math.max(height, WAVE_HEIGHTS.minScale);
}

// Height of wave number k for a heights setting { mode: 'set' | 'random', height }.
//   set    : the chosen height, each wave within a few percent of it
//   random : a slow random walk (smoothed value noise over the wave number, a new target
//            every 12 waves, about four and a half minutes), so the swell builds and fades
//            gradually and never throws up a freak wave
// Deterministic in (seed, k), so every player in a room gets the same waves. range: the
// spot's wave sizes (the one being played by default).
export function waveHeight(seed, k, cfg, range = WAVE_HEIGHTS) {
  const jitter = 1 + 0.06 * (hash01(seed, k) * 2 - 1);
  if (!cfg || cfg.mode !== 'random') {
    const h = cfg && Number.isFinite(cfg.height) ? cfg.height : range.default;
    return clamp(h, range.min, range.max) * jitter;
  }
  const span = 12;
  const i = Math.floor(k / span);
  const f = k / span - i;
  const a = hash01(seed ^ 0x51ed27, i);
  const b = hash01(seed ^ 0x51ed27, i + 1);
  const n = a + (b - a) * f * f * (3 - 2 * f);
  return mix(range.randomMin, range.randomMax, n) * jitter;
}

// Curl (barrel) shape, normalised by the wave scale: the spot's (see applySpotWave).
export const CURL = {
  rin: 0.4, // tube radius
  yc: 0.4, // tube centre height
  ex: 1.12, // horizontal stretch of the tube
  sweep: 3.92699, // 225 degrees of lip rotation
  yb0: 0.45, // back-side height where the lip's outer surface starts
  acoshYc: 1.03172, // acosh(1/sqrt(yc))
  lfLo: 1.25, // face length, gentle .. steep
  lfHi: 0.55,
  lbLo: 2.2, // back length, gentle .. steep
  lbHi: 1.6,
  trough: 0, // water drawn down in front of the wave (a reef sucking dry)
  lip: 0.42, // lip thickness
  tip: 0, // where the lip lands (normalised distance ahead of the crest)...
  tipShift: 0, // ...and how much further than at Margaret River (the rules are tuned there)
};

// Where the falling lip lands, for the curl shape c.
function lipTip(c) {
  const zc = c.lfHi * c.acoshYc + c.rin * c.ex;
  return zc + c.ex * (c.rin * 1.22 + 0.04) * Math.cos(Math.PI - c.sweep);
}
const TIP0 = lipTip(CURL);
CURL.tip = TIP0;

// Make `spot` the one being played: its wave goes into WAVE, WAVE_HEIGHTS and CURL, which
// the physics, the ocean grid and (through writeSpotUniforms) the shaders read.
export function applySpotWave(spot) {
  const { curl, ...wave } = spot.wave;
  Object.assign(WAVE, wave);
  Object.assign(WAVE_HEIGHTS, spot.heights);
  Object.assign(CURL, {
    rin: curl.rin,
    yc: curl.yc,
    ex: curl.ex,
    sweep: curl.sweep,
    acoshYc: Math.acosh(1 / Math.sqrt(curl.yc)),
    lfLo: curl.lf[0],
    lfHi: curl.lf[1],
    lbLo: curl.lb[0],
    lbHi: curl.lb[1],
    trough: curl.trough,
    lip: curl.lip,
  });
  CURL.tip = lipTip(CURL);
  CURL.tipShift = CURL.tip - TIP0;
}

export function crestOffset(x) {
  return -Math.min(WAVE.curveMax, WAVE.curveK * x * x);
}

// Normalised base (unbroken) profile. Returns normalised height; writes Lf/Lb into out.
export function baseProfile(un, steep, out) {
  const Lf = mix(CURL.lfLo, CURL.lfHi, steep);
  const Lb = mix(CURL.lbLo, CURL.lbHi, steep);
  out.Lf = Lf;
  out.Lb = Lb;
  if (un >= 0) {
    const t = (un - 2.2 * Lf) / (1.3 * Lf);
    let y = sech2(un / Lf) - 0.13 * steep * Math.exp(-t * t) * smoothstep(0, Lf, un);
    if (CURL.trough > 0) {
      const d = (un - 1.7 * Lf) / (1.2 * Lf);
      y -= CURL.trough * steep * Math.exp(-d * d) * smoothstep(0, Lf, un);
    }
    return y;
  }
  return 0.8 * sech2(un / Lb) + 0.2 * sech2(un / (3.5 * Lb));
}

// How long ago the section at dx (along the crest from the peak; side = dx * dir) started
// breaking, given the time since the peak did. A wide first section pitches all at once.
export function sectionAge(tau, dx, side) {
  return side >= 0 ? tau - Math.max(side - WAVE.breakWidth, 0) / WAVE.peelSpeed : tau - Math.max(-side - WAVE.backWidth, 0) / WAVE.backSpeed;
}

// Where the breaking point has got to on the peel side, and on the other side.
export function peelPoints(w, tau = Math.max(w.tau, 0)) {
  const d = w.dir;
  return [w.peakX + d * (WAVE.breakWidth + WAVE.peelSpeed * tau), w.peakX - d * (WAVE.backWidth + WAVE.backSpeed * tau)];
}

class Wave {
  constructor(slot) {
    this.slot = slot;
    this.active = false;
    this.id = 0;
    this.crestZ0 = 0;
    this.peakX = 0;
    this.dir = 1;
    this.height = 2.5; // target peak height
    this.tau = -1e3; // time since the peak started breaking
    this.H = 0; // current peak height including shoaling and fade
    this.S = 2.5; // horizontal scale
    this.steepG = 0;
    this.collapseG = 0;
    this.fade = 0;
  }
}

export class WaveModel {
  constructor() {
    this.time = 0;
    this.waves = Array.from({ length: WAVE.slots }, (_, i) => new Wave(i));
    this.nextId = 1;
    this.heights = { mode: 'set', height: WAVE_HEIGHTS.default }; // singleplayer setting
    this.seed = (Math.random() * 2 ** 32) >>> 0;
    this.onSpawn = null;
    this._prof = { Lf: 0, Lb: 0 };
    this._sec = { H: 0, S: 1, b: 0, kappa: 0, steep: 0, age: 0 };
    this.swell = SWELL.map(([deg, lambda, amp, steep], i) => {
      const a = (deg * Math.PI) / 180;
      const k = (2 * Math.PI) / lambda;
      return {
        dx: Math.sin(a),
        dz: Math.cos(a),
        amp,
        k,
        lambda,
        horiz: steep * amp, // horizontal orbit radius (<= amplitude)
        omega: Math.sqrt(GRAVITY * k),
        phase: (i * 2.399) % (2 * Math.PI),
      };
    });
  }

  reset(firstZ = WAVE.spawnZ) {
    this.schedule = null;
    this.seed = (Math.random() * 2 ** 32) >>> 0;
    for (const w of this.waves) w.active = false;
    this.spawn(firstZ);
  }

  // Singleplayer wave size; takes effect from the next wave.
  setHeights(cfg) {
    this.heights = { mode: cfg.mode === 'random' ? 'random' : 'set', height: cfg.height };
  }

  spawn(z = WAVE.spawnZ) {
    let slot = this.waves.find((w) => !w.active);
    if (!slot) {
      // recycle the oldest
      slot = this.waves.reduce((a, b) => (a.crestZ0 > b.crestZ0 ? a : b));
    }
    slot.active = true;
    slot.id = this.nextId++;
    slot.crestZ0 = z;
    slot.peakX = (Math.random() * 2 - 1) * WAVE.peakSpread;
    slot.dir = Math.random() < 0.5 ? 1 : -1;
    if (WAVE.dir) slot.dir = WAVE.dir;
    slot.height = waveHeight(this.seed, this.nextId, this.heights);
    slot.S = waveScale(slot.height);
    this._derive(slot);
    if (this.onSpawn) this.onSpawn(slot);
    return slot;
  }

  newest() {
    let best = null;
    for (const w of this.waves) if (w.active && (!best || w.crestZ0 < best.crestZ0)) best = w;
    return best;
  }

  _derive(w) {
    const c = w.crestZ0;
    w.tau = (c - WAVE.breakZ) / WAVE.speed;
    w.fade = smoothstep(WAVE.spawnZ, WAVE.spawnZ + 25, c) * (1 - smoothstep(WAVE.dieStartZ, WAVE.dieEndZ, c));
    const shoal = smoothstep(WAVE.shoalFrom, WAVE.breakZ, c);
    w.H = w.height * (WAVE.shoalBase + (1 - WAVE.shoalBase) * shoal) * w.fade;
    w.steepG = smoothstep(WAVE.steepFrom, WAVE.breakZ - 4, c);
    w.collapseG = smoothstep(WAVE.dieStartZ - 25, WAVE.dieStartZ + 12, c);
  }

  // Multiplayer: waves become a pure function of (seed, shared time) so every client
  // sees the same set. `clock()` returns the room's shared time in seconds; `heights` is the
  // room's wave size: { mode, height, fromK, prev } (from wave fromK on; `prev` before it).
  setSchedule(seed, clock, heights = null) {
    this.schedule = { seed: seed >>> 0, clock, heights };
    for (const w of this.waves) {
      w.active = false;
      w.id = null;
    }
    this._applySchedule();
  }

  clearSchedule() {
    this.schedule = null;
  }

  // A room's wave size changed: waves already on their way keep their height.
  setScheduleHeights(heights) {
    if (this.schedule) this.schedule.heights = heights;
  }

  _applySchedule() {
    const { seed, clock } = this.schedule;
    const t = clock();
    this.time = t;
    const P = WAVE.spacing / WAVE.speed; // a new wave every P seconds
    const kNow = Math.floor(t / P);
    for (const k of [kNow, kNow - 1]) {
      const w = this.waves[((k % 2) + 2) % 2];
      const crest = WAVE.spawnZ + WAVE.speed * (t - k * P);
      if (crest > WAVE.dieEndZ) {
        w.active = false;
        continue;
      }
      if (w.id !== `s${k}`) {
        const r = seededRandom(seed ^ Math.imul(k, 0x9e3779b1));
        w.id = `s${k}`;
        w.peakX = (r() * 2 - 1) * WAVE.peakSpread;
        w.dir = r() < 0.5 ? 1 : -1;
        if (WAVE.dir) w.dir = WAVE.dir;
        const hs = this.schedule.heights;
        w.height = waveHeight(seed, k, hs && hs.prev && hs.fromK != null && k < hs.fromK ? hs.prev : hs);
        w.S = waveScale(w.height);
        w.active = true;
        w.crestZ0 = crest;
        this._derive(w);
        if (this.onSpawn) this.onSpawn(w);
      }
      w.active = true;
      w.crestZ0 = crest;
      this._derive(w);
    }
  }

  update(dt) {
    if (this.schedule) return this._applySchedule();
    this.time += dt;
    for (const w of this.waves) {
      if (!w.active) continue;
      w.crestZ0 += WAVE.speed * dt;
      this._derive(w);
      if (w.crestZ0 > WAVE.dieEndZ) w.active = false;
    }
    const n = this.newest();
    if (!n || n.crestZ0 > WAVE.spawnZ + WAVE.spacing) this.spawn();
  }

  // Along-crest state of wave w at x.
  section(w, x, out = this._sec) {
    const dx = x - w.peakX;
    const side = dx * w.dir;
    const age = sectionAge(w.tau, dx, side);
    const e = side >= 0 ? Math.max(side - WAVE.peelFlat, 0) / WAVE.peelFall : side / WAVE.backFall;
    const env = Math.exp(-e * e);
    const kappa = Math.max(smoothstep(WAVE.tTube, WAVE.tTube + WAVE.tCollapse, age), w.collapseG);
    out.H = w.H * env * (1 - 0.5 * kappa);
    out.S = w.S;
    out.b = smoothstep(0, WAVE.tThrow, age) * smoothstep(0.05, 0.3, out.H / out.S);
    out.kappa = kappa;
    out.steep = w.steepG * mix(0.55, 1, Math.exp(-Math.max(-age, 0) / 5));
    out.age = age;
    return out;
  }

  // Curl a normalised base point (un, yb) of a section with breaking amount b.
  // Writes the curled normalised position into out.zn / out.yn.
  curlNorm(un, yb, b, Lf, out) {
    out.zn = un;
    out.yn = yb;
    const { rin, yc, ex, sweep, yb0, acoshYc } = CURL;
    const zc = Lf * acoshYc + rin * ex;
    const sF = un >= 0 ? clamp((yb - yc) / (1 - yc), 0, 1) : 0;
    const sB = un < 0 ? clamp((yb - yb0) / (1 - yb0), 0, 1) : 0;
    const s = Math.max(sF, sB);
    if (s > 0 && b > 0) {
      const lipThick = 0.04 + CURL.lip * Math.pow(1 - s, 1.5);
      const dz = (un - zc) / ex;
      const dy = yb - yc;
      const phiB = Math.atan2(dy, dz);
      const rB = Math.hypot(dz, dy);
      let phiT = Math.PI - s * sweep;
      let rT = rin * (1 + 0.22 * s * s);
      let wgt;
      if (un >= 0) wgt = smoothstep(0, 0.35, s);
      else {
        rT += lipThick;
        wgt = smoothstep(0, 0.55, s);
      }
      phiT = mix(phiB, phiT, wgt);
      rT = mix(rB, rT, wgt);
      const k = smoothstep(0, 1, b * 1.5 - (1 - s) * 0.5);
      const kr = smoothstep(0, 1, b * 2.4 - (1 - s) * 0.9);
      const phi = mix(phiB, phiT, k);
      const r = mix(rB, rT, kr);
      out.zn = zc + ex * r * Math.cos(phi);
      out.yn = yc + r * Math.sin(phi);
    }
    return out;
  }

  // Height (world y) of the underside of the curling lip directly above world point (x, z),
  // ignoring anything below yMin. Infinity when no lip is overhead.
  tubeCeiling(w, x, z, yMin) {
    const sc = this.section(w, x);
    if (sc.b < 0.25 || sc.H < 0.6) return Infinity;
    const { S, H, b, steep } = sc;
    const target = (z - crestOffset(x) - w.crestZ0) / S;
    baseProfile(0, steep, this._prof);
    const Lf = this._prof.Lf;
    const ufc = Lf * CURL.acoshYc;
    const c = this._cn || (this._cn = { zn: 0, yn: 0 });
    let best = Infinity,
      pz = 0,
      py = 0;
    const N = 40;
    for (let i = 0; i <= N; i++) {
      // walk the inside of the tube from the face (s = 0) to the lip tip (s = 1)
      const un = ufc * (1 - i / N);
      const yb = baseProfile(un, steep, this._prof);
      this.curlNorm(un, yb, b, Lf, c);
      if (i > 0 && (pz - target) * (c.zn - target) <= 0 && pz !== c.zn) {
        const t = (target - pz) / (c.zn - pz);
        const y = (py + (c.yn - py) * t) * H;
        if (y > yMin && y < best) best = y;
      }
      pz = c.zn;
      py = c.yn;
    }
    return best;
  }

  // Full displaced surface point of wave w (including the curl) for rest coords (x, rowZ).
  // Used for spray emission.
  curlPoint(w, x, rowZ, out) {
    const sc = this.section(w, x);
    const S = sc.S;
    const u = rowZ - w.crestZ0;
    const un = u / S;
    const yb = baseProfile(un, sc.steep, this._prof);
    const c = this.curlNorm(un, yb, sc.b, this._prof.Lf, this._cp || (this._cp = { zn: 0, yn: 0 }));
    const zn = c.zn,
      yn = c.yn;
    out.x = x;
    out.y = yn * sc.H;
    out.z = rowZ + crestOffset(x) + (zn * S - u);
    out.b = sc.b;
    out.kappa = sc.kappa;
    out.H = sc.H;
    out.age = sc.age;
    return out;
  }

  // Gerstner swell displacement at rest position (x, z). dist = distance to camera for LOD.
  swellAt(x, z, t, dist, out) {
    let ox = 0,
      oy = 0,
      oz = 0;
    for (const c of this.swell) {
      const f = 1 - smoothstep(c.lambda * 4, c.lambda * 9, dist);
      if (f <= 0) continue;
      const th = c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase;
      const a = c.amp * f;
      oy += a * Math.sin(th);
      const h = c.horiz * f * Math.cos(th);
      ox += c.dx * h;
      oz += c.dz * h;
    }
    out.x = ox;
    out.y = oy;
    out.z = oz;
    return out;
  }

  // Smooth (no curl) surface height used by the physics, with per-wave details.
  // Writes into `out`: height, plus info about the dominant wave.
  sample(x, z, out) {
    // Undo the swell's horizontal displacement (fixed-point iteration).
    const sw = this._sw || (this._sw = { x: 0, y: 0, z: 0 });
    let rx = x,
      rz = z;
    for (let i = 0; i < 3; i++) {
      this.swellAt(rx, rz, this.time, 0, sw);
      rx = x - sw.x;
      rz = z - sw.z;
    }
    this.swellAt(rx, rz, this.time, 0, sw);
    let h = sw.y;
    const rowZ = rz - crestOffset(rx);
    let best = null,
      bestVal = -1;
    out.waterVz = 0;
    for (const w of this.waves) {
      if (!w.active || w.H < 0.01) continue;
      const sc = this.section(w, rx);
      const u = rowZ - w.crestZ0;
      const un = u / sc.S;
      if (un < -16 || un > 7) continue;
      const yb = baseProfile(un, sc.steep, this._prof);
      const y = yb * sc.H;
      h += y;
      const hn = sc.H / sc.S;
      // orbital surface velocity (toward the beach), plus the push of broken whitewater
      const orb = 0.75 * Math.pow(clamp(yb, 0, 1), 2.2) * Math.min(hn, 1) * (0.4 + 0.6 * sc.steep);
      const bore = sc.kappa * smoothstep(-0.6, 0.2, un) * smoothstep(2.6, 1.0, un) * Math.min(hn * 1.6, 1);
      out.waterVz += WAVE.speed * Math.max(orb, bore);
      const val = Math.abs(un) < 4 ? 10 - Math.abs(un) : yb;
      if (val > bestVal) {
        bestVal = val;
        best = w;
        out.wave = w;
        out.un = un;
        out.u = u;
        out.yb = yb;
        out.H = sc.H;
        out.S = sc.S;
        out.b = sc.b;
        out.kappa = sc.kappa;
        out.age = sc.age;
        out.steep = sc.steep;
      }
    }
    if (!best) {
      out.wave = null;
      out.un = 99;
      out.u = 999;
      out.yb = 0;
      out.H = 0;
      out.S = 1;
      out.b = 0;
      out.kappa = 0;
      out.age = -99;
    }
    out.height = h;
    return out;
  }

  heightAt(x, z) {
    const o = this._tmpS || (this._tmpS = {});
    return this.sample(x, z, o).height;
  }

  // Values for the shader uniforms.
  writeUniforms(u) {
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const A = u.uWaveA.value[i];
      const B = u.uWaveB.value[i];
      A.set(w.crestZ0, w.peakX, w.dir, w.tau);
      B.set(w.active ? w.H : 0, w.S, w.steepG, w.collapseG);
    }
    u.uTime.value = this.time;
  }
}
