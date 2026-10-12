// Teahupo'o, Tahiti: the wave comes out of deep ocean onto a shallow coral reef, which
// bends round so the wave wraps as it peels left toward a deep channel (the pass). Inside the
// reef a turquoise lagoon runs to a palm-lined shore under steep green peaks; to the left,
// across a bay, the rest of the island fades into the haze.
//
// The reef's edge follows the line where the wave breaks (worked out from the spot's wave
// below), so the lip always throws onto the shallow reef. The seabed and the colour of the
// bottom are mirrored in GLSL for the water shader; a 3D reef is drawn when you're under.
import * as THREE from 'three';
import { WAVE } from './config.js';
import { SPOTS } from './spots.js';
import { smoothstep, mix, clamp } from './wave.js';
import { smax, hash2, fbm, ridged, marchCoords, buildLandMesh, lcg } from './landkit.js';
import { createReefTexture } from './textures.js';

const W = SPOTS.teahupoo.wave;
const SPEED = WAVE.speed; // (the same at every spot)
const ISLE = [4700, 4400]; // the rest of the island, across the bay to the left

// Where the crest is when the wave starts breaking at x (the peak is at x = 0).
function breakLine(x) {
  const t = x >= 0 ? Math.max(x - W.breakWidth, 0) / W.peelSpeed : Math.max(-x - W.backWidth, 0) / W.backSpeed;
  return SPEED * t - Math.min(W.curveMax, W.curveK * x * x);
}

// The seaward edge of the reef (z) at x: just inside the break line along the wave (wavering
// a little, as a real reef does), then curving away; past the end of the wave a deep pass runs
// through to the lagoon, and the next reef starts beyond it.
export function reefEdge(x) {
  let e = breakLine(clamp(x, -60, 135)) - 2 + 3.2 * Math.sin(0.071 * x + 1.3) + 2 * Math.sin(0.153 * x + 0.4) + 1.1 * Math.sin(0.31 * x + 2.2);
  if (x < -60) e += Math.min(70, 0.3 * (-60 - x));
  const next = 62 + Math.min(80, 0.0011 * (x - 330) * (x - 330)) + 0.85 * Math.max(0, x - 950);
  e = mix(e, next, smoothstep(190, 245, x));
  const pass = smoothstep(130, 175, x) * (1 - smoothstep(205, 250, x));
  return mix(e, 470, pass);
}

export function shoreZ(x) {
  return 640 + 30 * Math.sin(0.0031 * x + 0.7) + 14 * Math.sin(0.0093 * x + 2.1) + 0.9 * Math.max(0, x - 900);
}

// distance inside the coast of the far side of the island
function isleIn(x, z) {
  const dx = x - ISLE[0],
    dz = z - ISLE[1];
  const a = Math.atan2(dz, dx);
  return 2400 + 220 * Math.sin(3 * a + 1) + 120 * Math.sin(7 * a + 2.3) - Math.hypot(dx, dz);
}

// The reef top is 2.5 m down, deepening across the lagoon. Seaward of the edge the fore-reef
// rounds over, is steepest just below the crest (about 45 degrees) and eases out into the deep.
export function seabedY(x, z) {
  const d = z - reefEdge(x);
  const floor = mix(-38, -14, smoothstep(-60, 460, z));
  let y;
  if (d >= 0) y = -2.5 - 0.7 * smoothstep(15, 110, d) - 2.4 * smoothstep(130, 330, d);
  else {
    const e = Math.sqrt(d * d + 9) - 3;
    y = smax(floor, -2.5 - 36 * (1 - Math.exp(-e / 36)), 3);
  }
  y = smax(y, (z - shoreZ(x)) * 0.05, 1.5);
  return Math.max(y, isleIn(x, z) * 0.05);
}

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
export const SEABED_GLSL = /* glsl */ `
uniform sampler2D uReefTex;
float smaxk(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}
float breakLine(float x) {
  float t = x >= 0.0 ? max(x - ${f(W.breakWidth)}, 0.0) / ${f(W.peelSpeed)} : max(-x - ${f(W.backWidth)}, 0.0) / ${f(W.backSpeed)};
  return ${f(SPEED)} * t - min(${f(W.curveMax)}, ${f(W.curveK)} * x * x);
}
float reefEdge(float x) {
  float e = breakLine(clamp(x, -60.0, 135.0)) - 2.0 + 3.2 * sin(0.071 * x + 1.3) + 2.0 * sin(0.153 * x + 0.4) + 1.1 * sin(0.31 * x + 2.2);
  if (x < -60.0) e += min(70.0, 0.3 * (-60.0 - x));
  float nxt = 62.0 + min(80.0, 0.0011 * (x - 330.0) * (x - 330.0)) + 0.85 * max(0.0, x - 950.0);
  e = mix(e, nxt, smoothstep(190.0, 245.0, x));
  float pass = smoothstep(130.0, 175.0, x) * (1.0 - smoothstep(205.0, 250.0, x));
  return mix(e, 470.0, pass);
}
float shoreZ(float x) { return 640.0 + 30.0 * sin(0.0031 * x + 0.7) + 14.0 * sin(0.0093 * x + 2.1) + 0.9 * max(0.0, x - 900.0); }
float isleIn(vec2 p) {
  vec2 d = p - vec2(${f(ISLE[0])}, ${f(ISLE[1])});
  float a = atan(d.y, d.x);
  return 2400.0 + 220.0 * sin(3.0 * a + 1.0) + 120.0 * sin(7.0 * a + 2.3) - length(d);
}
float seabedY(vec2 p) {
  float d = p.y - reefEdge(p.x);
  float floorY = mix(-38.0, -14.0, smoothstep(-60.0, 460.0, p.y));
  float y;
  if (d >= 0.0) y = -2.5 - 0.7 * smoothstep(15.0, 110.0, d) - 2.4 * smoothstep(130.0, 330.0, d);
  else {
    float e = sqrt(d * d + 9.0) - 3.0;
    y = smaxk(floorY, -2.5 - 36.0 * (1.0 - exp(-e / 36.0)), 3.0);
  }
  y = smaxk(y, (p.y - shoreZ(p.x)) * 0.05, 1.5);
  return max(y, isleIn(p) * 0.05);
}
// the bottom: coral on the reef, more and more sand across the lagoon, rubble down the
// wall and in the pass
vec3 bedColor(vec2 p) {
  float d = p.y - reefEdge(p.x);
  // two scales, one turned, so the pattern doesn't repeat, under broad light and dark patches
  vec3 c1 = texture(uReefTex, p / 22.0).rgb;
  vec3 c2 = texture(uReefTex, mat2(0.8, -0.6, 0.6, 0.8) * p / 9.1 + 0.37).rgb;
  float broad = texture(uNoise, p * 0.0046 + 0.21).a;
  float mottle = 0.6 * texture(uNoise, p * 0.0071 + 0.63).a + 0.4 * texture(uNoise, mat2(0.6, 0.8, -0.8, 0.6) * p * 0.0193).a;
  vec3 coral = mix(c1, c2, 0.5) * (0.6 + 0.8 * mottle);
  float grain = texture(uNoise, p * 0.13 + 0.37).b;
  vec3 sand = vec3(0.7, 0.64, 0.48) * (0.85 + 0.3 * grain);
  // coral thins out across the lagoon into sand with scattered heads; sand pockets on the reef
  float pockets = smoothstep(0.56, 0.68, mottle + 0.15 * grain) * 0.7;
  float reef = smoothstep(-34.0, -8.0, d) * (1.0 - max(smoothstep(60.0, 260.0, d) * smoothstep(0.42, 0.62, broad + 0.25 * grain), pockets));
  vec3 deep = vec3(0.32, 0.3, 0.26) * (0.7 + 0.5 * broad);
  vec3 col = mix(deep, sand, smoothstep(-20.0, 30.0, d) * 0.6 + 0.4 * smoothstep(0.5, 0.7, broad));
  return mix(col, coral, reef);
}
// whitewater where the smaller swells break along the rest of the reef (not on the wave
// itself, nor in the pass): pulses that come and go with the sets
float bedFoam(vec2 p) {
  float d = p.y - reefEdge(p.x);
  float away = max(smoothstep(-50.0, -120.0, p.x), smoothstep(260.0, 330.0, p.x));
  float band = smoothstep(0.0, 6.0, d) * smoothstep(40.0, 12.0, d) * away;
  if (band <= 0.0) return 0.0;
  float n = texture(uNoise, p * 0.006 + 0.17).a;
  float pulse = smoothstep(0.35, 0.9, sin(uTime * 0.42 - d * 0.12 + p.x * 0.004 + n * 9.0) * 0.5 + 0.5);
  return band * (0.25 + 0.75 * pulse) * (0.7 + 0.6 * n);
}
`;

// ---------------------------------------------------------------- reef texture (shared)
let reefTex = null;
export function reefTexture() {
  return (reefTex ||= createReefTexture(512));
}

// ---------------------------------------------------------------- land
const SAND_WET = new THREE.Color('#7f7564');
const SAND_DRY = new THREE.Color('#b6a888');
const GARDEN = new THREE.Color('#5d8a35');
const FOREST_DARK = new THREE.Color('#142f10');
const FOREST = new THREE.Color('#2b5a1c');
const FOREST_LIGHT = new THREE.Color('#548a2c');
const ROCK = new THREE.Color('#57564a');
const _c = new THREE.Color();

// height (and how far inland) at x, z
// Peaks: one per cell of a jittered grid (u along the coast, v inland), each a pyramid with
// straight flanks and a slightly softened top; where two meet they make a V-shaped valley.
// height(pu, pv, rnd) gives a peak's height (0 for none). Cached per cell.
function peakField(cellU, cellV, offV, height, salt) {
  const cache = new Map();
  const peak = (i, j) => {
    const key = i * 4096 + j;
    let p = cache.get(key);
    if (!p) {
      const r1 = hash2(i * 1.7 + salt, j * 2.3 + 11.1),
        r2 = hash2(i * 3.1 + 5.2, j * 0.7 + salt),
        r3 = hash2(i + 9.4 + salt, j * 5.3);
      const pu = (i + 0.2 + 0.6 * r1) * cellU,
        pv = (j + 0.25 + 0.5 * r2) * cellV + offV;
      const H = height(pu, pv, r3);
      // (no wider than the cells searched below, or it would end in a cliff)
      p = { pu, pv, H, R: Math.min(H * (1.05 + 0.3 * r2), 1.95 * Math.min(cellU, cellV)) };
      cache.set(key, p);
    }
    return p;
  };
  return (u, v) => {
    const ci = Math.floor(u / cellU),
      cj = Math.floor((v - offV) / cellV);
    let best = 0;
    for (let j = cj - 2; j <= cj + 2; j++)
      for (let i = ci - 2; i <= ci + 2; i++) {
        const p = peak(i, j);
        if (p.H <= 0) continue;
        const d = Math.hypot(u - p.pu, v - p.pv);
        if (d >= p.R) continue;
        // (softened top; reaches the ground exactly at R)
        const r0 = 0.04 * p.R;
        const t = (Math.sqrt(d * d + r0 * r0) - r0) / (Math.sqrt(p.R * p.R + r0 * r0) - r0);
        const h = p.H * Math.max(0, 1 - t);
        if (h > best) best = h;
      }
    return best;
  };
}
// Tahiti Iti: a first row of peaks rising straight behind the coastal flat, bigger ones
// behind, up to the high middle of the island (x along the coast, v = distance inland)
const islandPeaks = peakField(1050, 950, 380, (pu, pv, r) => (pv < 300 ? 0 : Math.min(1350, 400 + 0.24 * pv) * (0.72 + 0.48 * r)), 0.3);
// the far side of the bay: the rest of the island, bigger and further off
const islePeaks = peakField(1300, 1300, 0, (pu, pv, r) => {
  const inside = isleIn(pu, pv);
  return inside < 200 ? 0 : Math.min(1900, 300 + 0.6 * inside) * (0.7 + 0.5 * r);
}, 7.7);

// height (and how far inland, how mountainous, how ridged) at x, z
function landSample(x, z, out) {
  const base = seabedY(x, z);
  let h = base;
  const s = z - shoreZ(x);
  out.s = s;
  out.mtn = 0;
  out.rid = 0.5;
  if (s > 0) {
    // a narrow coastal flat, then the peaks, with spurs and gullies running down their sides
    const flat = 1.2 + 3.2 * smoothstep(15, 160, s) + 1.6 * fbm(x * 0.02, z * 0.02, 3) * smoothstep(10, 60, s);
    const cone = islandPeaks(x, s);
    const wx = x + 200 * (fbm(x * 0.0015, z * 0.0015, 3) - 0.5);
    const wz = z + 200 * (fbm(x * 0.0015 + 7.1, z * 0.0015, 3) - 0.5);
    const rid = ridged(wx * 0.0032, wz * 0.0032, 3);
    const m = smoothstep(40, 300, s);
    const mtn = m * (cone * (0.88 + 0.34 * (rid - 0.35)) + 60 * smoothstep(150, 900, s));
    h += flat * smoothstep(0, 25, s) + mtn;
    out.mtn = smoothstep(20, 300, cone) * m;
    out.rid = rid;
  }
  const isle = isleIn(x, z);
  if (isle > -400) {
    const cone = islePeaks(x, z);
    if (cone > 0) {
      const rid = ridged(x * 0.0022, z * 0.0022 + 1.7, 3);
      const hi = base + 2 + smoothstep(-100, 300, isle) * (cone * (0.88 + 0.34 * (rid - 0.35)) + 80);
      if (hi > h) {
        h = hi;
        out.rid = rid;
        out.mtn = Math.max(out.mtn, smoothstep(20, 300, cone));
      }
    }
  }
  out.h = h;
  return out;
}

function paint(x, z, h, slope, t, c) {
  const n = fbm(x * 0.011, z * 0.011, 3);
  const n2 = fbm(x * 0.06, z * 0.06, 2);
  c.copy(SAND_WET).lerp(SAND_DRY, smoothstep(0.2, 1.4, h));
  // gardens and palms on the flat, then rainforest: lighter on the ridges, dark in the
  // valleys and on the steepest slopes
  c.lerp(GARDEN, smoothstep(1.6, 3.2, h));
  _c.copy(FOREST_DARK).lerp(FOREST, smoothstep(0.25, 0.65, n * 0.6 + t.rid * 0.6)).lerp(FOREST_LIGHT, smoothstep(0.55, 0.85, t.rid) * 0.6);
  _c.multiplyScalar(mix(0.62, 1.08, smoothstep(0.15, 0.7, t.rid)) * mix(1, 0.75, smoothstep(0.8, 2.2, slope)));
  c.lerp(_c, smoothstep(4, 14, h) * (0.55 + 0.45 * t.mtn));
  // bare rock only on the sheerest faces
  c.lerp(ROCK, smoothstep(1.6, 2.8, slope) * 0.5 * smoothstep(30, 80, h));
  c.multiplyScalar(0.86 + 0.26 * n2);
}

// ---------------------------------------------------------------- palms and houses
function palmGeometry() {
  // a curved trunk with a crown of drooping fronds, about 9 m tall, in vertex colours
  const pos = [],
    col = [],
    idx = [];
  const trunk = new THREE.Color('#8a7f6c'),
    frond = new THREE.Color('#3f6d22'),
    tip = new THREE.Color('#2a4a17');
  const H = 9,
    seg = 6,
    sides = 5;
  const bend = (y) => 0.9 * (y / H) * (y / H);
  for (let j = 0; j <= seg; j++) {
    const y = (j / seg) * H;
    const r = mix(0.22, 0.13, j / seg);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      pos.push(bend(y) + Math.cos(a) * r, y, Math.sin(a) * r);
      col.push(trunk.r, trunk.g, trunk.b);
    }
  }
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i,
        b = j * sides + ((i + 1) % sides);
      idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
  const top = [bend(H), H, 0];
  const fronds = 9;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + 0.3 * Math.sin(k * 3.7);
    const len = 3.2 + 0.6 * Math.sin(k * 2.3);
    const dx = Math.cos(a),
      dz = Math.sin(a);
    const base = pos.length / 3;
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const w = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
      const y = top[1] + 0.9 * t - 2.2 * t * t;
      const cx = top[0] + dx * len * t,
        cz = top[2] + dz * len * t;
      pos.push(cx - dz * w, y, cz + dx * w, cx + dz * w, y, cz - dx * w);
      const cc = frond.clone().lerp(tip, t);
      col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
    }
    for (let s = 0; s < steps; s++) {
      const a0 = base + s * 2;
      idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function placeAlongCoast(count, rand, sMin, sMax, xMin, xMax, tmp, ok) {
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 30; tries++) {
    const x = mix(xMin, xMax, rand());
    const z = shoreZ(x) + mix(sMin, sMax, Math.pow(rand(), 1.4));
    landSample(x, z, tmp);
    if (ok(tmp)) out.push([x, tmp.h, z]);
  }
  return out;
}

function createPalms(quality, rand) {
  const tmp = {};
  const spots = placeAlongCoast(quality === 'low' ? 160 : 320, rand, 5, 75, -1700, 1150, tmp, (t) => t.h > 1.1 && t.h < 9);
  const mesh = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), spots.length);
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    sc = new THREE.Vector3(),
    p = new THREE.Vector3(),
    c = new THREE.Color();
  spots.forEach(([x, h, z], i) => {
    const s = 0.75 + rand() * 0.55;
    // the ones on the beach lean out over the water
    const seaward = smoothstep(60, 10, z - shoreZ(x));
    e.set((rand() - 0.5) * 0.15, rand() * Math.PI * 2, 0, 'YXZ');
    q.setFromEuler(e);
    if (seaward > 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25 * seaward * rand()));
    m.compose(p.set(x, h - 0.3, z), q, sc.set(s, s * (0.85 + rand() * 0.3), s));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(0.8 + rand() * 0.35));
  });
  return mesh;
}

function createHouses(rand) {
  const tmp = {};
  // the village along the road at the end of the island
  const spots = placeAlongCoast(70, rand, 28, 120, -950, 650, tmp, (t) => t.h > 2 && t.h < 9);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), spots.length);
  const roofGeo = new THREE.CylinderGeometry(0.62, 0.62, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 2 - 0.0).translate(0, 0.25, 0);
  roofGeo.scale(1, 0.75, 1.15);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial(), spots.length);
  const WALL = ['#f1ede2', '#e8dcc0', '#d9e6e4', '#f0d9c8', '#e5e5dd'];
  const ROOF = ['#9b3b2a', '#4a6a7c', '#7c8a86', '#b9b4a6', '#3d5b3a'];
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    p = new THREE.Vector3(),
    c = new THREE.Color();
  spots.forEach(([x, h, z], i) => {
    const w = 6 + rand() * 5,
      d = 5 + rand() * 4,
      ht = 2.6 + rand() * 1.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan(0.9 * smoothstep(800, 1000, x)) + (rand() - 0.5) * 0.4);
    m.compose(p.set(x, h - 0.2, z), q, sc.set(w, ht, d));
    walls.setMatrixAt(i, m);
    walls.setColorAt(i, c.set(WALL[Math.floor(rand() * WALL.length)]));
    m.compose(p.set(x, h - 0.2 + ht, z), q, sc.set(w * 1.15, ht * 0.9, d * 1.1));
    roofs.setMatrixAt(i, m);
    roofs.setColorAt(i, c.set(ROOF[Math.floor(rand() * ROOF.length)]));
  });
  const g = new THREE.Group();
  g.add(walls, roofs);
  return g;
}

// round-topped trees on the flat and the foot of the slopes (the forest higher up is in
// the land's colours)
function createTrees(quality, rand) {
  const count = quality === 'low' ? 400 : 1100;
  const geo = new THREE.IcosahedronGeometry(1, 1).translate(0, 0.6, 0);
  const trees = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), count);
  const tmp = {};
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    p = new THREE.Vector3(),
    c = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 20; tries++) {
    const x = mix(-1800, 1100, rand());
    const z = shoreZ(x) + 40 + Math.pow(rand(), 1.6) * 220;
    landSample(x, z, tmp);
    if (tmp.h < 3 || tmp.h > 24) continue;
    const r = 3 + Math.pow(rand(), 1.5) * 4.5;
    m.compose(p.set(x, tmp.h - 0.4 * r, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28), sc.set(r, r * (0.7 + rand() * 0.5), r));
    trees.setMatrixAt(placed, m);
    trees.setColorAt(placed, c.copy(FOREST).lerp(FOREST_LIGHT, rand()).multiplyScalar(0.85 + rand() * 0.35));
    placed++;
  }
  trees.count = placed;
  return trees;
}

// ---------------------------------------------------------------- the reef, under water
// A real 3D reef around the break (the water shader paints it from above; this is what you
// see once you're under): the wall dropping into the deep, coral heads on top.
function createReef(quality) {
  const { texture, bump, relief } = reefTexture();
  // fine around the break, coarser further out (where the water hides the detail anyway),
  // reaching well past where you can see so the reef never just stops
  const low = quality === 'low';
  const xs = marchCoords(-300, 460, 40, low ? 1.4 : 0.75, low ? 0.014 : 0.008);
  const zs = marchCoords(-190, 400, 20, low ? 1.4 : 0.75, low ? 0.014 : 0.008);
  const nx = xs.length,
    nz = zs.length;
  const pos = new Float32Array(nx * nz * 3),
    uv = new Float32Array(nx * nz * 2),
    col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = xs[i],
        z = zs[j];
      const k = j * nx + i;
      const d = z - reefEdge(x);
      // mounds and gullies with coral heads on top, proud on the reef and down the fore-reef,
      // sand and rubble in the deep
      const amp = mix(0.25, 1.0, smoothstep(-40, -6, d)) * (1 - 0.35 * smoothstep(80, 160, d));
      const lumps = fbm(x * 0.16 + 3.1, z * 0.16, 3) - 0.5;
      const r = 0.55 * relief(x / 11, z / 11) + 0.45 * relief(x / 3.7 + 0.37, z / 3.7 + 0.37);
      // spurs and grooves running down the fore-reef
      const e = Math.max(0, -d);
      const groove = Math.sin(x * 0.45 + 3 * Math.sin(x * 0.037) + z * 0.04) * smoothstep(1, 8, e) * smoothstep(60, 22, e);
      const y = seabedY(x, z) + amp * (lumps * 1.5 + (r - 0.35) * 0.7) + 1.4 * groove;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      // in the shadow deep down the slope
      const shade = mix(0.6, 1, smoothstep(-40, -4, d));
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade;
    }
  // texture coordinates measured along the surface (not straight down), so the coral keeps
  // its size down the slopes instead of streaking
  for (let j = 0; j < nz; j++) {
    let u = xs[0];
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i) u += Math.hypot(xs[i] - xs[i - 1], pos[k * 3 + 1] - pos[(k - 1) * 3 + 1]);
      uv[k * 2] = u / 7.5;
    }
  }
  for (let i = 0; i < nx; i++) {
    let v = zs[0];
    for (let j = 0; j < nz; j++) {
      const k = j * nx + i;
      if (j) v += Math.hypot(zs[j] - zs[j - 1], pos[k * 3 + 1] - pos[(k - nx) * 3 + 1]);
      uv[k * 2 + 1] = v / 7.5;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let t = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i,
        b = a + 1,
        c = a + nx,
        d = c + 1;
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture, bumpMap: bump, bumpScale: 3, vertexColors: true }));
  mesh.frustumCulled = false;
  return mesh;
}

// Everything above the water as one group; userData.underwater: the reef, shown only
// while the camera is under the surface.
export function createLand(quality) {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const coarse = quality === 'low' ? 1.8 : 1;
  const xs = marchCoords(-4500, 8200, 0, 3 * coarse, 0.012 * coarse);
  const zs = marchCoords(-300, 8200, 640, 2.5 * coarse, 0.012 * coarse);
  group.add(buildLandMesh(xs, zs, material, landSample, paint));
  const rand = lcg(9001);
  group.add(createPalms(quality, rand));
  group.add(createHouses(rand));
  group.add(createTrees(quality, rand));
  group.userData.underwater = createReef(quality);
  return group;
}
