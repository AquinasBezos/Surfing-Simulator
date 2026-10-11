// Lightweight spray: mist off the pitching lip, bursts where the lip lands, and offshore
// spray blown back off the steep crest. Simulated on the CPU, drawn as soft points.
import * as THREE from 'three';
import { WAVE } from './config.js';
import { createSoftDotTexture } from './textures.js';

const VERT = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
varying float vLife;
varying float vDist;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.1), 40.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColor;
varying float vLife;
varying float vDist;
void main() {
  float a = texture2D(uTex, gl_PointCoord).r;
  // fade out right in front of the lens so nearby droplets don't turn into big discs
  float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.55, vLife) * smoothstep(0.6, 2.6, vDist);
  gl_FragColor = vec4(uColor, a * fade * 0.38);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Spray {
  constructor(model, max) {
    this.model = model;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(2); // >1 = dead
    this.dur = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: createSoftDotTexture() },
        uColor: { value: new THREE.Color(2.2, 2.35, 2.4) },
        uScale: { value: 500 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.acc = [0, 0, 0];
    this._p = {};
  }

  setViewportHeight(h) {
    this.material.uniforms.uScale.value = h * 0.5;
  }

  emit(x, y, z, vx, vy, vz, dur, size, drag) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.dur[i] = dur;
    this.size[i] = size;
    this.drag[i] = drag;
  }

  // Fan of spray thrown off the rail: (ox, oz) is the outward direction, `power` 0..1.
  fan(x, y, z, ox, oz, power, dt) {
    const R = Math.random;
    let n = this.max * 1.6 * power * dt + R();
    while (n-- >= 1) {
      const s = 3 + R() * 5 * power;
      const j = (R() - 0.5) * 0.7;
      this.emit(x + (R() - 0.5) * 0.3, y + 0.05, z + (R() - 0.5) * 0.3, (ox + j * oz) * s, 1.8 + R() * 3.8 * power, (oz - j * ox) * s, 0.5 + R() * 0.6, 0.018 + R() * R() * 0.05, 1.2);
    }
  }

  update(dt, camPos) {
    const m = this.model;
    const p = this._p;
    const R = Math.random;
    const budget = this.max / 1.6; // particles per second overall
    for (const w of m.waves) {
      if (!w.active || w.H < 0.4) continue;
      const near = Math.abs(w.crestZ0 - camPos.z) < 140;
      if (!near) continue;
      const tau = Math.max(w.tau, 0);
      const peelX = w.peakX + w.dir * WAVE.peelSpeed * tau;
      const backX = w.peakX - w.dir * WAVE.backSpeed * tau;
      // 1) lip mist + impact bursts along the broken section near the camera
      if (w.tau > 0) {
        const lo = Math.min(peelX, backX),
          hi = Math.max(peelX, backX);
        const a = Math.max(lo, camPos.x - 70),
          b = Math.min(hi, camPos.x + 70);
        if (b > a) {
          let n = budget * 0.55 * dt * Math.min(1, (b - a) / 40) + R();
          while (n-- >= 1) {
            const x = a + R() * (b - a);
            m.curlPoint(w, x, w.crestZ0 + (R() - 0.5) * 0.04 * w.S, p);
            if (p.b < 0.3) continue;
            if (p.kappa > 0.05 && p.kappa < 0.9) {
              // whitewater explosion where the lip lands
              this.emit(p.x + (R() - 0.5) * 0.6, Math.max(p.y, 0.1), p.z + (R() - 0.2) * 1.2 * w.S, (R() - 0.5) * 1.5, 2.5 + R() * 4 * (1 - p.kappa), 2 + R() * 3, 1.3 + R() * 1.0, 0.5 + R() * 0.9, 0.9);
            } else if (p.kappa <= 0.05) {
              // fine mist trailing off the lip
              this.emit(p.x, p.y, p.z, (R() - 0.5) * 0.6, -0.5 - R() * 1.5, 1.5 + R() * 2.5, 0.6 + R() * 0.5, 0.12 + R() * 0.2, 1.8);
            }
          }
        }
      }
      // 2) offshore spray off the crest of the steep, about-to-break shoulder
      const ahead = w.tau > 0 ? peelX : w.peakX;
      let n = budget * 0.25 * dt * w.steepG + R();
      while (n-- >= 1) {
        const x = ahead + w.dir * (R() * 25 - 2);
        if (Math.abs(x - camPos.x) > 90) continue;
        m.curlPoint(w, x, w.crestZ0, p);
        if (p.H < 0.8 || p.b > 0.5) continue;
        this.emit(p.x, p.y + 0.05, p.z, (R() - 0.5) * 0.8, 1.2 + R() * 1.6, -2.5 - R() * 2.5, 0.9 + R() * 0.7, 0.07 + R() * 0.12, 1.2);
      }
    }
    // integrate
    const pos = this.pos,
      vel = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] > 1) continue;
      this.life[i] += dt / this.dur[i];
      const k = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - 6.5 * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.life[i] > 1) pos[i * 3 + 1] = -1000;
    }
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}
