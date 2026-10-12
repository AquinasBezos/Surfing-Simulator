// The wave pool: a kite-shaped lagoon in green English countryside. The wave machine sits in
// a long silver housing at the narrow back end; a pier runs from it down the middle to the
// clubhouse on the shore, with a big arch near the shore so you can paddle under it to the
// other side. The back edges are concrete walls, the front edges sandy beaches.
//
// The floor follows the waves (spots.js): deep at the back, a shallow shelf along the line
// where each wave breaks (from the outer corners in toward the pier), beaches at the front, and
// a deep trench along the pier where the current runs back out. It's mirrored in GLSL for the
// water shader; the floor, walls and pier are also real meshes, seen from under the water.
import * as THREE from 'three';
import { WAVE } from './config.js';
import { SPOTS } from './spots.js';
import { smoothstep, mix, poolEdges, poolInside } from './wave.js';
import { hash2, fbm, marchCoords, buildLandMesh, lcg } from './landkit.js';

const W = SPOTS.pool.wave;
const P = poolEdges(W.pool);
const SPEED = WAVE.speed; // (the same everywhere)
const B = [0, W.pool.bz],
  SR = [W.pool.sx, W.pool.sz],
  F = [0, W.pool.fz],
  SL = [-W.pool.sx, W.pool.sz];
const DECK = 1.0; // the walkway round the pool, above still water
const PIER = { half: 2.4, deck: 2.0, slab: 0.35, housingHalf: 5, housingEnd: -38, housingTop: 7.6, platform: [12, 40], platformHalf: 4.6, end: W.pool.fz + 12 };
// the arch under the pier near the shore: centre, half-length along the pier, height
export const ARCH = { z: 82, half: 11, height: 3.1 };
// the top of the pier's wall (under the deck): low, rising to clear the arch
const pierTop = (z) => PIER.deck + 1.45 * (1 - smoothstep(ARCH.half + 2, ARCH.half + 24, Math.abs(z - ARCH.z)));
const RING = 10; // width of the walkway round the pool

const inside = (x, z) => poolInside(x, z, P);
const frontIn = (ax, z) => P.front[0] * ax + P.front[1] * z - P.front[2];
// where the crest is when the wave starts breaking at |x| (from the outer peaks inward)
const breakLine = (ax) => (SPEED * Math.max(0, W.mirror - W.breakWidth - ax)) / W.peelSpeed;

function poolFloor(x, z) {
  const ax = Math.abs(x);
  const zb = breakLine(ax);
  let y = mix(-3.2, -1.35, smoothstep(zb - 16, zb - 3, z));
  const f = frontIn(ax, z);
  y = mix(y, DECK - 0.15, 1 - smoothstep(0, 26, f));
  const trench = (1 - smoothstep(5, 14, ax)) * smoothstep(6, 16, f);
  return mix(y, -4.2, trench);
}

// the land round about: flat by the pool, then gently rolling fields
function ground(x, z) {
  const r = Math.hypot(x, z - 10);
  const hills = smoothstep(260, 1100, r) * (32 * fbm(x * 0.0016 + 2.1, z * 0.0016, 3) + 80 * fbm(x * 0.0005 + 7.3, z * 0.0005 + 1.1, 3) - 40);
  return DECK - 0.05 + Math.max(0, hills);
}

export function seabedY(x, z) {
  return inside(x, z) >= 0 ? poolFloor(x, z) : ground(x, z);
}

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
export const SEABED_GLSL = /* glsl */ `
float poolIn(vec2 p) {
  float ax = abs(p.x);
  return min(${f(P.back[0])} * ax + ${f(P.back[1])} * p.y - ${f(P.back[2])}, ${f(P.front[0])} * ax + ${f(P.front[1])} * p.y - ${f(P.front[2])});
}
float frontIn(float ax, float z) { return ${f(P.front[0])} * ax + ${f(P.front[1])} * z - ${f(P.front[2])}; }
float seabedY(vec2 p) {
  if (poolIn(p) < 0.0) return ${f(DECK - 0.05)};
  float ax = abs(p.x);
  float zb = ${f(SPEED)} * max(0.0, ${f(W.mirror - W.breakWidth)} - ax) / ${f(W.peelSpeed)};
  float y = mix(-3.2, -1.35, smoothstep(zb - 16.0, zb - 3.0, p.y));
  float fr = frontIn(ax, p.y);
  y = mix(y, ${f(DECK - 0.15)}, 1.0 - smoothstep(0.0, 26.0, fr));
  float trench = (1.0 - smoothstep(5.0, 14.0, ax)) * smoothstep(6.0, 16.0, fr);
  return mix(y, -4.2, trench);
}
// pale painted concrete in panels, a little darker in the trench, sandy beaches
vec3 bedColor(vec2 p) {
  float y = seabedY(p);
  float sandy = smoothstep(-0.9, -0.3, y);
  vec3 c = mix(vec3(0.42, 0.53, 0.6), vec3(0.56, 0.6, 0.6), smoothstep(-2.6, -1.5, y));
  c = mix(c, vec3(0.33, 0.44, 0.53), smoothstep(3.4, 4.0, -y));
  c = mix(c, vec3(0.74, 0.65, 0.5), sandy);
  vec2 g = abs(fract(mat2(0.8, -0.6, 0.6, 0.8) * p / 13.0) - 0.5);
  c *= 1.0 - 0.08 * smoothstep(0.46, 0.5, max(g.x, g.y)) * (1.0 - sandy);
  return c * (0.9 + 0.2 * texture(uNoise, p * 0.13 + 0.37).b);
}
float bedFoam(vec2 p) { return 0.0; }
`;

// ---------------------------------------------------------------- the pier
function pierHalf(z) {
  if (z < B[1] - 6 || z > PIER.end) return 0;
  if (z < PIER.housingEnd) return PIER.housingHalf;
  if (z > PIER.platform[0] && z < PIER.platform[1]) return PIER.platformHalf;
  return PIER.half;
}
const archOpen = (z) => {
  const t = (z - ARCH.z) / ARCH.half;
  return Math.abs(t) < 1 ? ARCH.height * Math.sqrt(1 - t * t) : 0;
};

// Keep a surfer ({ x, z, vx, vz }) in the water: off the walls, the beaches and the pier
// (except through the arch). Returns how hard they hit something (m/s).
export function collide(s) {
  let hit = 0;
  const sx = Math.sign(s.x) || 1;
  for (const [e, margin] of [
    [P.back, 1.0],
    [P.front, 4.0],
  ]) {
    const nx = e[0] * sx,
      nz = e[1];
    const d = e[0] * Math.abs(s.x) + e[1] * s.z - e[2];
    if (d < margin) {
      s.x += nx * (margin - d);
      s.z += nz * (margin - d);
      const vn = s.vx * nx + s.vz * nz;
      if (vn < 0) {
        s.vx -= vn * nx;
        s.vz -= vn * nz;
        hit = Math.max(hit, -vn);
      }
    }
  }
  const half = pierHalf(s.z);
  const through = Math.abs(s.z - ARCH.z) < ARCH.half - 2.5;
  if (half > 0 && !through && Math.abs(s.x) < half + 0.6) {
    const side = Math.sign(s.x) || 1;
    s.x = side * (half + 0.6);
    if (s.vx * side < 0) {
      hit = Math.max(hit, -s.vx * side);
      s.vx = 0;
    }
  }
  return hit;
}

// Is there something solid at (x, y, z)? (the pier and its housing, the clubhouse: for the drone)
export function solidAt(x, y, z) {
  const half = pierHalf(z);
  if (half > 0 && Math.abs(x) < half + 0.3) {
    const top = z < PIER.housingEnd ? PIER.housingTop : pierTop(z) + PIER.slab + 1.2;
    if (y < top && !(y < archOpen(z) && y > -5)) return true;
  }
  return x > -40 && x < 72 && z > 128 && z < 158 && y < DECK + 9.5;
}

// ---------------------------------------------------------------- land
const GRASS = new THREE.Color('#6a9a45');
const FIELDS = ['#5f8f3a', '#6f9a3f', '#7aa547', '#4f7f35', '#8fa95a', '#689444', '#9aae62'].map((c) => new THREE.Color(c));
const HEDGE = new THREE.Color('#2e4a22');
const PAVING = new THREE.Color('#b9b2a4');
const TARMAC = new THREE.Color('#55575a');
const _c = new THREE.Color();

// fields on a slightly turned grid, edged with hedges
function field(x, z) {
  const u = x * 0.94 + z * 0.34,
    v = -x * 0.34 + z * 0.94;
  const cu = 130,
    cv = 95;
  const wob = 6 * Math.sin(v * 0.02 + 1.3) + 4 * Math.sin(u * 0.031);
  const i = Math.floor((u + wob) / cu),
    j = Math.floor((v - wob) / cv);
  const fu = (u + wob) / cu - i,
    fv = (v - wob) / cv - j;
  const edge = Math.min(fu * cu, (1 - fu) * cu, fv * cv, (1 - fv) * cv);
  return { id: hash2(i * 1.3 + 0.7, j * 2.1 + 0.4), edge };
}

function landSample(x, z, out) {
  const ins = inside(x, z);
  out.ins = ins;
  // (the pool, its floor and the walkway round it are meshes of their own)
  out.h = ins > -4 ? -6 : ground(x, z);
  return out;
}

function paint(x, z, h, slope, t, c) {
  const n = fbm(x * 0.05, z * 0.05, 2);
  const r = Math.hypot(x, z - 10);
  const fd = field(x, z);
  c.copy(FIELDS[Math.floor(fd.id * FIELDS.length)]);
  c.lerp(HEDGE, 1 - smoothstep(1.5, 4, fd.edge));
  // the grounds: mown grass, paving by the clubhouse, the car park
  const grounds = 1 - smoothstep(170, 220, r);
  c.lerp(_c.copy(GRASS).multiplyScalar(0.95 + 0.1 * n), grounds);
  if (Math.abs(x) < 82 && z > 120 && z < 170) c.lerp(PAVING, 0.85);
  if (x > 85 && x < 145 && z > 150 && z < 200) c.lerp(TARMAC, 0.9);
  c.multiplyScalar(0.9 + 0.2 * n);
}

// ---------------------------------------------------------------- the pool itself
// the floor as a grid stretched over the kite (so its edges sit exactly on the walls)
function createBasin(n) {
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const col = new Float32Array((n + 1) * (n + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = i / n,
        v = j / n;
      const x = (1 - u) * (1 - v) * B[0] + u * (1 - v) * SR[0] + u * v * F[0] + (1 - u) * v * SL[0];
      const z = (1 - u) * (1 - v) * B[1] + u * (1 - v) * SR[1] + u * v * F[1] + (1 - u) * v * SL[1];
      const y = poolFloor(x, z);
      const k = j * (n + 1) + i;
      pos.set([x, y, z], k * 3);
      c.setRGB(0.45, 0.56, 0.63)
        .lerp(new THREE.Color(0.58, 0.62, 0.62), smoothstep(-2.6, -1.5, y))
        .lerp(new THREE.Color(0.35, 0.46, 0.55), smoothstep(3.4, 4.0, -y))
        .lerp(new THREE.Color(0.74, 0.64, 0.48), smoothstep(-0.9, -0.3, y))
        .multiplyScalar(0.92 + 0.16 * fbm(x * 0.2, z * 0.2, 2));
      col.set([c.r, c.g, c.b], k * 3);
    }
  const idx = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i,
        b = a + 1,
        cc = a + n + 1,
        d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat({ vertexColors: true, side: THREE.DoubleSide }));
}

// concrete walls along the back edges, from below the floor up to the walkway
function createWalls() {
  const pos = [];
  for (const [a, b] of [
    [B, SR],
    [B, SL],
  ]) {
    const steps = 60;
    for (let s = 0; s < steps; s++) {
      const p0 = [mix(a[0], b[0], s / steps), mix(a[1], b[1], s / steps)];
      const p1 = [mix(a[0], b[0], (s + 1) / steps), mix(a[1], b[1], (s + 1) / steps)];
      const lo = -4.6,
        hi = DECK + 0.05;
      pos.push(p0[0], lo, p0[1], p1[0], lo, p1[1], p1[0], hi, p1[1], p0[0], lo, p0[1], p1[0], hi, p1[1], p0[0], hi, p0[1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat({ color: 0xc9c7c0, side: THREE.DoubleSide }));
}

// the walkway round the pool: pale coping by the water, warm decking beyond
function createRing() {
  const poly = [B, SR, F, SL];
  const outward = (i) => {
    // mitred offset of corner i
    const p = poly[i],
      a = poly[(i + 3) % 4],
      b = poly[(i + 1) % 4];
    const n1 = norm2([-(p[1] - a[1]), p[0] - a[0]]),
      n2 = norm2([-(b[1] - p[1]), b[0] - p[0]]);
    // (pointing away from the middle)
    const m = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    const cosH = m[0] * n1[0] + m[1] * n1[1];
    const sgn = m[0] * (p[0] - 0) + m[1] * (p[1] - (B[1] + F[1]) / 2) > 0 ? 1 : -1;
    return (w) => [p[0] + (sgn * m[0] * w) / cosH, p[1] + (sgn * m[1] * w) / cosH];
  };
  const offs = poly.map((_, i) => outward(i));
  const pos = [],
    col = [];
  const bands = [
    [0, 3.5, [0.86, 0.84, 0.79]],
    [3.5, RING, [0.72, 0.56, 0.36]],
  ];
  for (const [w0, w1, cc] of bands)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const a0 = offs[i](w0),
        a1 = offs[i](w1),
        b0 = offs[j](w0),
        b1 = offs[j](w1);
      const y = DECK + 0.02;
      pos.push(a0[0], y, a0[1], b0[0], y, b0[1], b1[0], y, b1[1], a0[0], y, a0[1], b1[0], y, b1[1], a1[0], y, a1[1]);
      for (let k = 0; k < 6; k++) col.push(...cc);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat({ vertexColors: true, side: THREE.DoubleSide }));
}
// built things are lit by the whole sky (image-based light), so walls in shade stay light
const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });

const norm2 = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

// a box from (x0, y0, z0) to (x1, y1, z1)
function box(x0, y0, z0, x1, y1, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function merge(geos) {
  // non-indexed merge of position/normal (and uv if every part has one)
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// The pier: the wave machine's housing (glass sides under a silver arched roof), then the
// walkway on its concrete wall with a viewing platform part-way, railings, and the arch.
function createPier() {
  const g = new THREE.Group();
  const concrete = mat({ color: 0xa6a299 });
  const deckMat = mat({ color: 0x9c958a });
  const H = PIER;
  // housing
  const hz0 = B[1] - 6,
    hz1 = H.housingEnd;
  g.add(new THREE.Mesh(box(-H.housingHalf, -4.6, hz0, H.housingHalf, 1.0, hz1), mat({ color: 0x6f767b })));
  const glass = new THREE.MeshStandardMaterial({ color: 0x5b8fbf, metalness: 0.3, roughness: 0.12 });
  g.add(new THREE.Mesh(box(-H.housingHalf, 1.0, hz0, H.housingHalf, 2.6, hz1), glass));
  // (the upper half of a cylinder lying along the pier)
  const roof = new THREE.CylinderGeometry(H.housingHalf, H.housingHalf, hz1 - hz0, 40, 1, true, Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2).translate(0, 2.6, (hz0 + hz1) / 2);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xc6ccd1, metalness: 0.55, roughness: 0.35, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(roof, roofMat));
  // (the roof's ends)
  for (const z of [hz0, hz1]) {
    const cap = new THREE.CircleGeometry(H.housingHalf, 40, 0, Math.PI).translate(0, 2.6, z);
    g.add(new THREE.Mesh(cap, mat({ color: 0x8d969c, side: THREE.DoubleSide })));
  }
  // the walkway: its wall (open under the arch), the deck along the top (wider at the
  // platform) and railings, built in short lengths so they can rise over the arch
  const walls = [],
    decks = [],
    rails = [];
  const step = 2;
  for (let z0 = hz1; z0 < H.end; z0 += step) {
    const z1 = Math.min(z0 + step, H.end),
      zm = (z0 + z1) / 2;
    const half = zm > H.platform[0] && zm < H.platform[1] ? H.platformHalf : H.half;
    const top = Math.max(pierTop(z0), pierTop(z1));
    const open = Math.max(archOpen(z0), archOpen(z1)); // (under the arch the wall stops above the opening)
    walls.push(box(-half, open > 0 ? open : -4.6, z0, half, top, z1));
    decks.push(box(-half - 0.2, top, z0, half + 0.2, top + H.slab, z1));
    const y = top + H.slab;
    for (const side of [-1, 1]) {
      const x = side * (half + 0.05);
      rails.push(box(x - 0.04, y, z0 - 0.04, x + 0.04, y + 1.1, z0 + 0.04));
      rails.push(box(x - 0.04, y + 1.05, z0, x + 0.04, y + 1.12, z1), box(x - 0.03, y + 0.55, z0, x + 0.03, y + 0.6, z1));
    }
  }
  g.add(new THREE.Mesh(merge(walls), concrete));
  g.add(new THREE.Mesh(merge(decks), deckMat));
  g.add(new THREE.Mesh(merge(rails), mat({ color: 0xd7dbdc, roughness: 0.5, metalness: 0.3 })));
  return g;
}

// the clubhouse on the shore: timber-clad, glass facing the pool, solar panels on the roof
function createClubhouse() {
  const g = new THREE.Group();
  const wood = mat({ color: 0xa87f50 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2c3a44, metalness: 0.4, roughness: 0.1 });
  const roof = mat({ color: 0x5d7085 });
  const solar = new THREE.MeshStandardMaterial({ color: 0x1d2a44, metalness: 0.5, roughness: 0.25 });
  g.add(new THREE.Mesh(merge([box(-40, DECK, 136, 40, DECK + 8, 156), box(40, DECK, 130, 72, DECK + 5.5, 152)]), wood));
  g.add(new THREE.Mesh(merge([box(-38, DECK + 0.4, 135.6, 38, DECK + 3.4, 136.1), box(-30, DECK + 4.6, 135.6, 30, DECK + 6.8, 136.1), box(42, DECK + 0.4, 129.6, 70, DECK + 3.6, 130.1)]), glass));
  g.add(new THREE.Mesh(merge([box(-41, DECK + 8, 135, 41, DECK + 8.5, 157), box(39, DECK + 5.5, 129, 73, DECK + 5.9, 153)]), roof));
  const panels = [];
  for (let i = 0; i < 6; i++) panels.push(box(-34 + i * 11, DECK + 8.5, 140, -26 + i * 11, DECK + 8.75, 152));
  g.add(new THREE.Mesh(merge(panels), solar));
  return g;
}

// glamping cabins on the grass to one side
function createCabins(rand) {
  const g = new THREE.Group();
  const walls = [],
    roofs = [];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 4; c++) {
      const x = 165 + c * 22 + (rand() - 0.5) * 4,
        z = -30 + r * 26 + (rand() - 0.5) * 4;
      walls.push(box(x - 3.5, DECK - 0.1, z - 2.3, x + 3.5, DECK + 2.6, z + 2.3));
      // (a triangular prism with its ridge on top)
      const roof = new THREE.CylinderGeometry(2.9, 2.9, 7.6, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(x, DECK + 2.6 + 0.45, z);
      roofs.push(roof);
    }
  g.add(new THREE.Mesh(merge(walls), mat({ color: 0x9a7650 })));
  g.add(new THREE.Mesh(merge(roofs), mat({ color: 0xd9dbd8 })));
  return g;
}

// white star-shaped sail canopies over picnic tables
function createCanopies() {
  const spots = [
    [-112, 150],
    [-92, 178],
    [-138, 176],
    [-118, 200],
    [-150, 30],
  ];
  const pos = [];
  const tables = [];
  for (const [cx, cz] of spots) {
    const apex = [cx, DECK + 5.4, cz];
    const pts = 5;
    for (let i = 0; i < pts; i++) {
      const a0 = (i / pts) * Math.PI * 2,
        a1 = ((i + 1) / pts) * Math.PI * 2,
        am = (a0 + a1) / 2;
      const tip0 = [cx + Math.cos(a0) * 8.5, DECK + 0.6, cz + Math.sin(a0) * 8.5];
      const tip1 = [cx + Math.cos(a1) * 8.5, DECK + 0.6, cz + Math.sin(a1) * 8.5];
      const mid = [cx + Math.cos(am) * 3.8, DECK + 3.4, cz + Math.sin(am) * 3.8];
      pos.push(...apex, ...tip0, ...mid, ...apex, ...mid, ...tip1);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const tx = cx + Math.cos(a) * 4,
        tz = cz + Math.sin(a) * 4;
      tables.push(box(tx - 0.9, DECK + 0.45, tz - 0.35, tx + 0.9, DECK + 0.75, tz + 0.35), box(tx - 0.9, DECK + 0.25, tz - 0.75, tx + 0.9, DECK + 0.4, tz - 0.5), box(tx - 0.9, DECK + 0.25, tz + 0.5, tx + 0.9, DECK + 0.4, tz + 0.75));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat({ color: 0xf2f2ee, side: THREE.DoubleSide })));
  g.add(new THREE.Mesh(merge(tables), mat({ color: 0x8a6a45 })));
  return g;
}

// trees along the hedgerows and in small woods
function createTrees(quality, rand) {
  const count = quality === 'low' ? 600 : 1600;
  const geo = new THREE.IcosahedronGeometry(1, 1).translate(0, 0.6, 0);
  const trees = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), count);
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    p = new THREE.Vector3(),
    c = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  const dark = new THREE.Color('#344f24'),
    light = new THREE.Color('#5d7e36');
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 40; tries++) {
    const a = rand() * Math.PI * 2,
      r = 190 + Math.pow(rand(), 1.3) * 1700;
    const x = Math.cos(a) * r,
      z = 10 + Math.sin(a) * r;
    const fd = field(x, z);
    const wood = fd.id < 0.12;
    if (!wood && fd.edge > 3) continue;
    const h = ground(x, z);
    const s = 3 + Math.pow(rand(), 1.5) * 4;
    m.compose(p.set(x, h - 0.3 * s, z), q.setFromAxisAngle(Y, rand() * 6.28), sc.set(s, s * (1 + rand() * 0.4), s));
    trees.setMatrixAt(placed, m);
    trees.setColorAt(placed, c.copy(dark).lerp(light, rand()).multiplyScalar(0.85 + rand() * 0.3));
    placed++;
  }
  trees.count = placed;
  return trees;
}

// Everything as one group. userData.underwater: the floor, walls and pier again, with the
// underwater fog (main adds it to that copy), shown only while the camera is under.
export function createLand(quality) {
  const group = new THREE.Group();
  const low = quality === 'low';
  const coarse = low ? 1.8 : 1;
  const xs = marchCoords(-4000, 4000, 0, 3 * coarse, 0.012 * coarse);
  const zs = marchCoords(-4000, 4000, 10, 3 * coarse, 0.012 * coarse);
  group.add(buildLandMesh(xs, zs, new THREE.MeshLambertMaterial({ vertexColors: true }), landSample, paint));
  const basin = createBasin(low ? 110 : 170);
  const walls = createWalls();
  const pier = createPier();
  group.add(basin, walls, createRing(), pier, createClubhouse());
  const rand = lcg(2024);
  group.add(createCabins(rand), createCanopies(), createTrees(quality, rand));
  // the same structure seen from under the water (its own materials, fogged by main)
  const under = new THREE.Group();
  for (const src of [basin, walls, pier])
    src.traverse((o) => {
      if (!o.isMesh) return;
      const copy = new THREE.Mesh(o.geometry, o.material.clone());
      copy.applyMatrix4(o.matrixWorld);
      under.add(copy);
    });
  group.userData.underwater = under;
  return group;
}
