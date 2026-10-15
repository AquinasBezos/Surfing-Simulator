// Sheets of water thrown off the board: the bow wave that piles up along the rails as you
// paddle into a wave, and the fan of spray off the tail in a turn (high quality; the loose
// droplets around them are spray.js's).
//
// A sheet is a ribbon. Its source, a point on the rail, throws out a column of points many
// times a second, from the slow inner edge that stays by the board to the fast outer edge,
// and each point then flies on its own (gravity, air drag). Joined up, the columns make a
// curtain that fans out and arcs over. The shader tears it into streaks and then drops as it
// ages and spreads, so it reads as a sheet of water breaking up into spray.
import * as THREE from 'three';
import { createSprayTexture } from './textures.js';

const GRAVITY = 9.8;

const VERT = /* glsl */ `
attribute vec2 aUV;   // x: along the sheet (when it was thrown), y: 0 at the rail .. 1 at the outer edge
attribute vec2 aLife; // x: age (0..1 of its life), y: strength
varying vec2 vUV;
varying vec2 vLife;
varying vec3 vWorld;
void main() {
  vUV = aUV;
  vLife = aLife;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColor;    // the spray's colour in this light (as spray.js's)
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uScale;    // texture repeats along the sheet and across it
uniform float uChurn;   // 0: a fan of spray (a turn); 1: churned, see-through water (the bow wave)
varying vec2 vUV;
varying vec2 vLife;
varying vec3 vWorld;
void main() {
  float age = vLife.x;
  if (age >= 1.0) discard;
  float f = vUV.y; // 0 at the rail .. 1 at the outer edge
  vec2 uv = vec2(vUV.x, f) * uScale;
  // g: drops, a: grain (round drops: a fan is much wider across than its texture says)
  vec4 d = texture2D(uTex, vec2(uv.x * 2.2 + 0.57, mix(f * 9.0, uv.y * 1.3, uChurn)));
  float lace = texture2D(uTex, vec2(uv.x * 1.6 + 0.31, uv.y * 0.7)).b;
  float lace2 = texture2D(uTex, vec2(uv.x * 3.1 + 0.6, uv.y * 1.7 + 0.2)).b;

  // a fan: fine streaks of drops running out from the rail (the sheet spreads as it flies, so
  // they fan out), thick and white at the root, thinning out and tearing apart further out
  // and as it ages, with loose drops at the fringe
  float streak = texture2D(uTex, vec2(uv.x, uv.y * 0.12)).r * 0.6 + texture2D(uTex, vec2(uv.x * 2.7 + 0.4, uv.y * 0.25)).r * 0.4;
  float dens = 1.0 - smoothstep(0.15, 1.25, f * 0.55 + age * 0.8);
  float fan = smoothstep(0.6 - 0.5 * dens, 0.85 - 0.3 * dens, streak) * (0.45 + 0.55 * dens);
  float drops = d.g * smoothstep(0.2, 0.7, f + age * 0.6) * (1.0 - age);
  fan = max(fan, drops);

  // churned water: whole by the rail while it's young, torn as it ages; see-through where it's
  // solid water, white where it's full of air
  float body = texture2D(uTex, vec2(uv.x * 1.1, uv.y * 0.5)).r * 0.6 + texture2D(uTex, vec2(uv.x * 2.9 + 0.2, uv.y * 1.4)).r * 0.4;
  float tear = -0.05 + 0.6 * age * age + 0.3 * f;
  float churn = max(smoothstep(tear - 0.1, tear + 0.24, body), drops);
  float foamC = max(smoothstep(0.34, 0.72, body * 0.55 + d.g * 0.45 + age * 0.3), drops);
  churn *= mix(0.32, 0.92, foamC);

  // (a fan dissolves into drops as it spreads and ages)
  fan *= mix(1.0, d.g * 1.6 + 0.15, smoothstep(0.35, 1.0, f * 0.6 + age * 0.7));
  float a = mix(fan, churn, uChurn);
  float foam = mix(0.85 + 0.15 * dens, foamC, uChurn);
  a *= smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age));
  // a ragged outer edge: streaks reach out different distances
  float reach = mix(0.6, 0.5, uChurn) + 0.45 * texture2D(uTex, vec2(uv.x * 1.3 + 0.17, 0.37)).r;
  a *= 1.0 - smoothstep(reach - 0.15, reach, f);
  a *= smoothstep(0.12, 0.45, length(vWorld - cameraPosition)); // (no big blobs right at the lens)
  a *= vLife.y;
  if (a < 0.01) discard;
  // lit like spray: brighter where it's thicker, glowing when you look through it toward the
  // sun, and glinting
  vec3 water = uColor * vec3(0.26, 0.5, 0.52);
  vec3 V = normalize(vWorld - cameraPosition);
  float toSun = pow(max(dot(V, uSunDir), 0.0), 5.0);
  vec3 col = mix(water, uColor, foam) * mix(0.72, 1.05, mix(streak, body, uChurn)) + uSunColor * toSun * mix(0.8, 1.6, foam);
  float glint = pow(d.g * d.a, 4.0) + pow(lace2 * d.a * 1.25, 6.0) * uChurn;
  col += uSunColor * glint * (1.0 + 4.0 * toSun);
  gl_FragColor = vec4(col, min(1.0, a + glint * 0.4 * a));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// One stream of sheet: a ring of columns, each `rows` points from the rail outward.
export class SheetStream {
  constructor(material, cols, rows, uStep) {
    this.cols = cols;
    this.rows = rows;
    this.uStep = uStep; // how far along the texture each column moves on
    const n = cols * rows;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.drag = new Float32Array(n);
    this.uv = new Float32Array(n * 2);
    this.life = new Float32Array(n * 2).fill(1);
    this.colAge = new Float32Array(cols).fill(1);
    this.colDur = new Float32Array(cols).fill(1);
    this.head = 0;
    this.t = 0;
    this.lastT = -1;
    this.u = Math.random() * 10;
    this.acc = 0;
    this.prev = null; // where the source was last frame
    this.side = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aUV', this.uvAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    this.indexAttr = new THREE.BufferAttribute(new Uint16Array(cols * (rows - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this.indexAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // (before the droplets)
    this.mesh.visible = false;
  }

  // the triangles joining column c to column `next` (none if next < 0)
  quad(c, next) {
    const R = this.rows,
      I = this.indexAttr.array;
    let o = c * (R - 1) * 6;
    for (let j = 0; j < R - 1; j++, o += 6) {
      if (next < 0) {
        I[o] = I[o + 1] = I[o + 2] = I[o + 3] = I[o + 4] = I[o + 5] = 0;
        continue;
      }
      const a = c * R + j,
        b = a + 1,
        d = next * R + j,
        e = d + 1;
      I[o] = a;
      I[o + 1] = d;
      I[o + 2] = b;
      I[o + 3] = b;
      I[o + 4] = d;
      I[o + 5] = e;
    }
    this.indexAttr.needsUpdate = true;
  }

  // Throw out a column from (px, py, pz): its inner edge moving at vIn, its outer edge at vOut
  // (world, m/s), lasting `dur` seconds. The outer edge is ragged (`jitter`) and slowed more by
  // the air (it's breaking into drops).
  emit(px, py, pz, vIn, vOut, dur, strength, jitter = 0.15, dragIn = 0.6, dragOut = 1.8) {
    const c = this.head;
    this.head = (c + 1) % this.cols;
    const join = this.t - this.lastT < 0.1;
    this.quad((c - 1 + this.cols) % this.cols, join ? c : -1);
    this.quad(c, -1);
    this.lastT = this.t;
    this.colAge[c] = 0;
    this.colDur[c] = dur;
    this.u += this.uStep;
    const R = this.rows,
      Rn = Math.random;
    const spread = Math.hypot(vOut.x - vIn.x, vOut.y - vIn.y, vOut.z - vIn.z);
    for (let j = 0; j < R; j++) {
      const f = j / (R - 1);
      const i = c * R + j;
      const s = 1 + (Rn() - 0.5) * 2 * jitter * f;
      const w = spread * jitter * f;
      this.pos[i * 3] = px + (Rn() - 0.5) * 0.02;
      this.pos[i * 3 + 1] = py;
      this.pos[i * 3 + 2] = pz + (Rn() - 0.5) * 0.02;
      this.vel[i * 3] = (vIn.x + (vOut.x - vIn.x) * f) * s + (Rn() - 0.5) * w;
      this.vel[i * 3 + 1] = (vIn.y + (vOut.y - vIn.y) * f) * s + (Rn() - 0.5) * w;
      this.vel[i * 3 + 2] = (vIn.z + (vOut.z - vIn.z) * f) * s + (Rn() - 0.5) * w;
      this.drag[i] = dragIn + (dragOut - dragIn) * f;
      this.uv[i * 2] = this.u;
      this.uv[i * 2 + 1] = f;
      this.life[i * 2] = 0;
      this.life[i * 2 + 1] = strength;
    }
    this.mesh.visible = true;
  }

  // Columns at `rate` a second for this frame: make(f) is called for each, with f how far
  // through the frame it falls (0 = last frame, 1 = now), and should call emit().
  run(dt, rate, make) {
    this.acc += dt * rate;
    const k = Math.min(Math.floor(this.acc), 8);
    this.acc -= Math.floor(this.acc);
    for (let i = 0; i < k; i++) make((i + 1) / k);
  }

  // not throwing anything this frame: the next column starts a new sheet
  idle() {
    this.acc = 0;
    this.prev = null;
  }

  update(dt) {
    this.t += dt;
    if (!this.mesh.visible || dt <= 0) return;
    const R = this.rows,
      pos = this.pos,
      vel = this.vel;
    let any = false;
    for (let c = 0; c < this.cols; c++) {
      if (this.colAge[c] >= 1) continue;
      const age = (this.colAge[c] = Math.min(1, this.colAge[c] + dt / this.colDur[c]));
      for (let j = 0; j < R; j++) {
        const i = c * R + j;
        this.life[i * 2] = age;
        const k = Math.exp(-this.drag[i] * dt);
        vel[i * 3] *= k;
        vel[i * 3 + 1] = vel[i * 3 + 1] * k - GRAVITY * dt;
        vel[i * 3 + 2] *= k;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      if (age < 1) any = true;
    }
    this.mesh.visible = any;
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
  }

  clear() {
    this.colAge.fill(1);
    this.life.fill(1);
    this.lifeAttr.needsUpdate = true;
    this.idle();
    this.lastT = -1;
    this.mesh.visible = false;
  }
}


// Drops flying with the sheets, each drawn as a short streak along the way it's going (as a
// camera blurs them), so a fan of them reads as spray rather than dots.
const STREAK_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec3 iLife; // age (0..1 of its life), width (m), seconds of movement the streak shows
uniform float uPixel; // the size of a pixel at 1 m (m)
uniform vec3 uCamVel; // (streaks show how a drop moves past the camera, which may be moving too)
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  vUv = uv;
  if (iLife.x >= 1.0) {
    vAlpha = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 rel = iVel - uCamVel;
  float sp = length(rel);
  vec3 axis = sp > 1e-3 ? rel / sp : vec3(0.0, 1.0, 0.0);
  vec3 toCam = cameraPosition - iPos;
  float dist = length(toCam);
  vec3 side = cross(axis, toCam / max(dist, 1e-3));
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  // never thinner than a pixel and a half (fainter instead)
  float w = max(iLife.y, dist * uPixel * 1.5);
  float len = w + sp * iLife.z;
  vec3 p = iPos + axis * ((position.y - 0.5) * len) + side * (position.x * w);
  float age = iLife.x;
  vAlpha = (iLife.y / w) * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.55, 1.0, age)) * smoothstep(0.4, 1.2, dist);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWorld;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  // brightest at the drop (the head), fading back along the streak
  float a = smoothstep(0.0, 0.7, across) * smoothstep(0.0, 0.6, vUv.y) * vAlpha;
  if (a < 0.01) discard;
  vec3 V = normalize(vWorld - cameraPosition);
  float toSun = pow(max(dot(V, uSunDir), 0.0), 5.0);
  vec3 col = uColor * 1.05 + uSunColor * toSun * 2.0;
  gl_FragColor = vec4(col, min(1.0, a * 0.85));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Streaks {
  constructor(max, uniforms) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max * 3).fill(1); // age, width, blur
    this.dur = new Float32Array(max).fill(1);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    this.alive = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.velAttr = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.InstancedBufferAttribute(this.life, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.posAttr);
    geo.setAttribute('iVel', this.velAttr);
    geo.setAttribute('iLife', this.lifeAttr);
    geo.instanceCount = max;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uPixel = { value: 0.0015 };
    this.uCamVel = { value: new THREE.Vector3() };
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uPixel: this.uPixel, uCamVel: this.uCamVel },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  emit(x, y, z, vx, vy, vz, dur, width, drag = 1.2, blur = 0.022) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i * 3] = 0;
    this.life[i * 3 + 1] = width;
    this.life[i * 3 + 2] = blur;
    this.dur[i] = dur;
    this.drag[i] = drag;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.mesh.visible || dt <= 0) return;
    const pos = this.pos,
      vel = this.vel,
      life = this.life;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (life[i * 3] >= 1) continue;
      life[i * 3] = Math.min(1, life[i * 3] + dt / this.dur[i]);
      const k = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - GRAVITY * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      any = true;
    }
    this.mesh.visible = any;
    this.posAttr.needsUpdate = true;
    this.velAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  clear() {
    this.life.fill(1);
    this.lifeAttr.needsUpdate = true;
    this.mesh.visible = false;
  }
}

export class SpraySheets {
  constructor(maxStreaks = 3000) {
    // (shared by every stream's material)
    this.uniforms = {
      uTex: { value: createSprayTexture() },
      uColor: { value: new THREE.Color(2.2, 2.35, 2.4) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
    };
    this.group = new THREE.Group();
    this.streams = [];
    this.streaks = new Streaks(maxStreaks, this.uniforms);
    this.group.add(this.streaks.mesh);
  }

  // how fast the camera is moving (m/s), so the streaks blur as they would in its view
  setCameraVelocity(v) {
    this.streaks.uCamVel.value.copy(v);
  }

  // the size of a pixel at 1 m, for the streaks' minimum width (fov in degrees, height in pixels)
  setView(fov, height) {
    this.streaks.uPixel.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, height);
  }

  // a new stream: `cols` columns of `rows` points; the texture moves on uStep a column.
  // look: { scale: [along, across] texture repeats, churn: 0 a fan of streaks .. 1 churned water }
  stream(cols, rows, uStep, look = {}) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uScale: { value: new THREE.Vector2(...(look.scale || [1, 1])) },
        uChurn: { value: look.churn || 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const s = new SheetStream(material, cols, rows, uStep);
    this.streams.push(s);
    this.group.add(s.mesh);
    return s;
  }

  // the light: spray colour (as spray.js), the sun's direction and colour
  setLight(color, sunDir, sunColor) {
    const u = this.uniforms;
    u.uColor.value.setRGB(...color);
    u.uSunDir.value.copy(sunDir).normalize();
    u.uSunColor.value.setRGB(...sunColor);
  }

  update(dt) {
    for (const s of this.streams) s.update(dt);
    this.streaks.update(dt);
  }

  clear() {
    for (const s of this.streams) s.clear();
    this.streaks.clear();
  }
}
