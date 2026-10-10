// Coastline: sandy beach with dunes and wooded hills, a forested headland and an offshore
// island. The seabed function is mirrored in GLSL so the water shader knows the depth.
import * as THREE from 'three';
import { smoothstep, mix } from './wave.js';

const HEAD_A = [840, 330];
const HEAD_B = [1260, -620];
const ISLAND = [-1750, -2950];

export function shoreZ(x) {
  return 252 + 14 * Math.sin(0.0037 * x) + 6 * Math.sin(0.011 * x + 1.3);
}

function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

function segDist(x, z, a, b) {
  const px = x - a[0],
    pz = z - a[1];
  const bx = b[0] - a[0],
    bz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, (px * bx + pz * bz) / (bx * bx + bz * bz)));
  return Math.hypot(px - bx * t, pz - bz * t);
}

export function headlandH(x, z) {
  return 102 * (1 - segDist(x, z, HEAD_A, HEAD_B) / 240) - 30;
}

export function islandH(x, z) {
  return 75 * (1 - Math.hypot(x - ISLAND[0], z - ISLAND[1]) / 290) - 16;
}

export function seabedY(x, z) {
  let d = mix(-16, -4.4, smoothstep(-320, -30, z));
  d = mix(d, -3.0, smoothstep(-30, 110, z));
  const beach = (z - shoreZ(x)) * 0.035;
  d = smax(d, beach, 1.5);
  d = smax(d, headlandH(x, z), 4);
  d = Math.max(d, islandH(x, z));
  return d;
}

export const SEABED_GLSL = /* glsl */ `
float smaxk(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
float shoreZ(float x) { return 252.0 + 14.0 * sin(0.0037 * x) + 6.0 * sin(0.011 * x + 1.3); }
float seabedY(vec2 p) {
  float d = mix(-16.0, -4.4, smoothstep(-320.0, -30.0, p.y));
  d = mix(d, -3.0, smoothstep(-30.0, 110.0, p.y));
  d = smaxk(d, (p.y - shoreZ(p.x)) * 0.035, 1.5);
  d = smaxk(d, 102.0 * (1.0 - segDist(p, vec2(${HEAD_A[0]}.0, ${HEAD_A[1]}.0), vec2(${HEAD_B[0]}.0, ${HEAD_B[1]}.0)) / 240.0) - 30.0, 4.0);
  d = max(d, 75.0 * (1.0 - length(p - vec2(${ISLAND[0]}.0, ${ISLAND[1]}.0)) / 290.0) - 16.0);
  return d;
}
`;

// --- land detail (JS only; applied well above the waterline) ---------------------------
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x),
    zi = Math.floor(z);
  let fx = x - xi,
    fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi),
    b = hash2(xi + 1, zi),
    c = hash2(xi, zi + 1),
    d = hash2(xi + 1, zi + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x, z, oct = 5) {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Returns { h, veg } where veg in [0,1] marks vegetated ground.
function landSample(x, z, out) {
  const base = seabedY(x, z);
  const s = z - shoreZ(x);
  let h = base;
  let veg = 0;
  // dunes and hills behind the beach
  const inland = smoothstep(18, 60, s);
  if (inland > 0) {
    const dunes = 3.2 * smoothstep(30, 80, s) + 1.6 * fbm(x * 0.02, z * 0.02, 3) * inland;
    const hills = Math.max(0, s - 110) * 0.05 + 70 * smoothstep(250, 1400, s) * fbm(x * 0.0018 + 3.1, z * 0.0018, 4);
    const canopy = 3.5 * fbm(x * 0.09, z * 0.09, 3) * smoothstep(70, 120, s);
    h += (dunes + hills + canopy) * inland;
    veg = Math.max(veg, smoothstep(62, 95, s + 25 * (fbm(x * 0.01, z * 0.01, 2) - 0.5)));
  }
  // headland & island get rugged, forested tops
  const hd = headlandH(x, z);
  if (hd > 0) {
    const r = smoothstep(2, 20, hd);
    h += r * (14 * (fbm(x * 0.008, z * 0.008, 4) - 0.35) + 4 * fbm(x * 0.07, z * 0.07, 3));
    veg = Math.max(veg, smoothstep(6, 16, hd + 8 * (fbm(x * 0.03, z * 0.03, 2) - 0.5)));
  }
  const il = islandH(x, z);
  if (il > 0) {
    const r = smoothstep(2, 15, il);
    h += r * 9 * (fbm(x * 0.012, z * 0.012, 4) - 0.3);
    veg = Math.max(veg, smoothstep(10, 22, il));
  }
  out.h = h;
  out.veg = veg;
  out.s = s;
  return out;
}

function marchCoords(lo, hi, centre, s0, growth) {
  const pts = [];
  let x = centre;
  while (x > lo) {
    pts.unshift(x);
    x -= s0 + growth * Math.abs(x - centre);
  }
  pts.unshift(lo);
  x = centre + s0;
  while (x < hi) {
    pts.push(x);
    x += s0 + growth * Math.abs(x - centre);
  }
  pts.push(hi);
  return pts;
}

const SAND_DRY = new THREE.Color('#e3cfa4');
const SAND_WET = new THREE.Color('#ad9670');
const VEG_A = new THREE.Color('#1c3319');
const VEG_B = new THREE.Color('#34502a');
const ROCK = new THREE.Color('#6f675e');
const GRASS = new THREE.Color('#7f8a52');

function buildMesh(xs, zs, material) {
  const nx = xs.length,
    nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz);
  const tmp = {};
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i],
        z = zs[j];
      landSample(x, z, tmp);
      hs[k] = tmp.h;
      pos[k * 3] = x;
      pos[k * 3 + 1] = Math.max(tmp.h, -8);
      pos[k * 3 + 2] = z;
    }
  // colours need slope -> second pass
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i],
        z = zs[j];
      const h = hs[k];
      const i0 = Math.max(i - 1, 0),
        i1 = Math.min(i + 1, nx - 1);
      const j0 = Math.max(j - 1, 0),
        j1 = Math.min(j + 1, nz - 1);
      const sx = (hs[j * nx + i1] - hs[j * nx + i0]) / (xs[i1] - xs[i0]);
      const sz = (hs[j1 * nx + i] - hs[j0 * nx + i]) / (zs[j1] - zs[j0]);
      const slope = Math.hypot(sx, sz);
      landSample(x, z, tmp);
      const n = fbm(x * 0.05, z * 0.05, 3);
      c.copy(SAND_WET).lerp(SAND_DRY, smoothstep(0.1, 0.9, h));
      c.lerp(GRASS, smoothstep(3.5, 6, h) * smoothstep(40, 80, tmp.s) * 0.6);
      const veg = tmp.veg * (1 - smoothstep(0.75, 1.1, slope));
      const vc = VEG_A.clone().lerp(VEG_B, n);
      c.lerp(vc, veg);
      c.lerp(ROCK, smoothstep(0.55, 0.95, slope) * smoothstep(0.5, 3, h));
      const shade = 0.88 + 0.24 * n;
      col[k * 3] = c.r * shade;
      col[k * 3 + 1] = c.g * shade;
      col[k * 3 + 2] = c.b * shade;
    }
  const idx = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i,
        b = a + 1,
        cc = a + nx,
        d = cc + 1;
      const hmax = Math.max(hs[a], hs[b], hs[cc], hs[d]);
      if (hmax < -1.2) continue; // fully underwater: hidden by the opaque ocean
      idx.push(a, cc, b, b, cc, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

export function createTerrain(quality) {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const coarse = quality === 'low' ? 1.8 : 1;
  const xs = marchCoords(-3800, 3800, 0, 3 * coarse, 0.012 * coarse);
  const zs = marchCoords(-1000, 3400, 255, 2.5 * coarse, 0.012 * coarse);
  const main = buildMesh(xs, zs, material);
  group.add(main);
  const ixs = marchCoords(ISLAND[0] - 330, ISLAND[0] + 330, ISLAND[0], 12 * coarse, 0);
  const izs = marchCoords(ISLAND[1] - 330, ISLAND[1] + 330, ISLAND[1], 12 * coarse, 0);
  group.add(buildMesh(ixs, izs, material));

  // trees: low-poly blobs that give the forest a broken silhouette
  const count = quality === 'low' ? 650 : 2000;
  const treeGeo = new THREE.IcosahedronGeometry(1, 1);
  treeGeo.translate(0, 0.6, 0);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tc = new THREE.Color();
  const tmp = {};
  let placed = 0,
    tries = 0;
  const rand = (() => {
    let s = 4242;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  while (placed < count && tries < count * 40) {
    tries++;
    let x, z;
    const pick = rand();
    if (pick < 0.5) {
      // headland
      const t = rand();
      x = mix(HEAD_A[0], HEAD_B[0], t) + (rand() * 2 - 1) * 170;
      z = mix(HEAD_A[1], HEAD_B[1], t) + (rand() * 2 - 1) * 170;
    } else if (pick < 0.58) {
      x = ISLAND[0] + (rand() * 2 - 1) * 220;
      z = ISLAND[1] + (rand() * 2 - 1) * 220;
    } else {
      x = (rand() * 2 - 1) * 1800;
      z = shoreZ(x) + 72 + Math.pow(rand(), 1.6) * 520;
    }
    landSample(x, z, tmp);
    if (tmp.veg < 0.55 || tmp.h < 3) continue;
    const r = 3.5 + Math.pow(rand(), 1.5) * 6;
    p.set(x, tmp.h - 0.35 * r, z);
    sc.set(r * (0.9 + rand() * 0.3), r * (0.75 + rand() * 0.6), r * (0.9 + rand() * 0.3));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    m.compose(p, q, sc);
    trees.setMatrixAt(placed, m);
    tc.copy(VEG_A).lerp(VEG_B, rand() * rand()).multiplyScalar(0.75 + rand() * 0.4);
    trees.setColorAt(placed, tc);
    placed++;
  }
  trees.count = placed;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  group.add(trees);
  return group;
}
