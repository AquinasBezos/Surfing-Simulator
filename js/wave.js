// Breaking-wave model shared by the renderer (GLSL in shaders/waveChunk.js) and the
// physics (the JS below). Both sides must implement exactly the same maths.
//
// Coordinate conventions
//   x : along the beach            z : toward the beach (waves travel +z)
//   Each wave has a straight-ish crest line, slightly curved around the reef at x = 0.
//   A surface point is addressed by its rest position (x, zr). Its crest-relative
//   coordinate is u = zr - crestOffset(x) - crestZ0.

import { WAVE, SWELL, GRAVITY } from './config.js';

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

// Curl (barrel) constants, normalised by the wave scale.
export const CURL = {
  rin: 0.4, // tube radius
  yc: 0.4, // tube centre height
  ex: 1.12, // horizontal stretch of the tube
  sweep: 3.92699, // 225 degrees of lip rotation
  yb0: 0.45, // back-side height where the lip's outer surface starts
  acoshYc: 1.03172, // acosh(1/sqrt(yc))
};

export function crestOffset(x) {
  return -Math.min(WAVE.curveMax, WAVE.curveK * x * x);
}

// Normalised base (unbroken) profile. Returns normalised height; writes Lf/Lb into out.
export function baseProfile(un, steep, out) {
  const Lf = mix(1.25, 0.55, steep);
  const Lb = mix(2.2, 1.6, steep);
  out.Lf = Lf;
  out.Lb = Lb;
  if (un >= 0) {
    const t = (un - 2.2 * Lf) / (1.3 * Lf);
    return sech2(un / Lf) - 0.13 * steep * Math.exp(-t * t) * smoothstep(0, Lf, un);
  }
  return 0.8 * sech2(un / Lb) + 0.2 * sech2(un / (3.5 * Lb));
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
    for (const w of this.waves) w.active = false;
    this.spawn(firstZ);
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
    slot.peakX = (Math.random() * 2 - 1) * 5;
    slot.dir = Math.random() < 0.5 ? 1 : -1;
    slot.height = mix(WAVE.minHeight, WAVE.maxHeight, Math.random());
    slot.S = slot.height;
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
    const shoal = smoothstep(WAVE.spawnZ, WAVE.breakZ, c);
    w.H = w.height * (0.5 + 0.5 * shoal) * w.fade;
    w.steepG = smoothstep(WAVE.spawnZ + 15, WAVE.breakZ - 4, c);
    w.collapseG = smoothstep(WAVE.dieStartZ - 25, WAVE.dieStartZ + 12, c);
  }

  update(dt) {
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
    const v = side >= 0 ? WAVE.peelSpeed : WAVE.backSpeed;
    const age = w.tau - Math.abs(dx) / v;
    const e = side >= 0 ? Math.max(side - 40, 0) / 260 : side / 45;
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

  // Full displaced surface point of wave w (including the curl) for rest coords (x, rowZ).
  // Returns {dy, dz, lipTip:boolean info}. Used for spray emission.
  curlPoint(w, x, rowZ, out) {
    const sc = this.section(w, x);
    const S = sc.S;
    const u = rowZ - w.crestZ0;
    const un = u / S;
    const yb = baseProfile(un, sc.steep, this._prof);
    let zn = un;
    let yn = yb;
    const { rin, yc, ex, sweep, yb0, acoshYc } = CURL;
    const zc = this._prof.Lf * acoshYc + rin * ex;
    const sF = un >= 0 ? clamp((yb - yc) / (1 - yc), 0, 1) : 0;
    const sB = un < 0 ? clamp((yb - yb0) / (1 - yb0), 0, 1) : 0;
    const s = Math.max(sF, sB);
    if (s > 0 && sc.b > 0) {
      const lipThick = 0.04 + 0.42 * Math.pow(1 - s, 1.5);
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
      const k = smoothstep(0, 1, sc.b * 1.5 - (1 - s) * 0.5);
      const kr = smoothstep(0, 1, sc.b * 2.4 - (1 - s) * 0.9);
      const phi = mix(phiB, phiT, k);
      const r = mix(rB, rT, kr);
      zn = zc + ex * r * Math.cos(phi);
      yn = yc + r * Math.sin(phi);
    }
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
