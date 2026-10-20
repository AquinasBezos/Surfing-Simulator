// The land and the seabed of each surf spot, and the switch between them. Margaret River
// (here): a sandy beach with dunes and wooded hills, a forested headland and an offshore
// island. Teahupo'o: teahupoo.js. A spot's seabed function is mirrored in GLSL (with the
// colour of the bottom) so the water shader knows the depth and what it sees through it.
import * as THREE from 'three';
import { smoothstep, mix } from './wave.js';
import { smax, segDist, fbm, marchCoords, buildLandMesh, lcg } from './landkit.js';
import * as teahupoo from './teahupoo.js';
import * as wavepool from './wavepool.js';
import { eisbachGroup, eisbachBedY, eisbachCollide, eisbachSolidAt } from './eisbach.js';

const HEAD_A = [840, 330];
const HEAD_B = [1260, -620];
const ISLAND = [-1750, -2950];

export function shoreZ(x) {
  return 252 + 14 * Math.sin(0.0037 * x) + 6 * Math.sin(0.011 * x + 1.3);
}

export function headlandH(x, z) {
  return 102 * (1 - segDist(x, z, HEAD_A, HEAD_B) / 240) - 30;
}

export function islandH(x, z) {
  return 75 * (1 - Math.hypot(x - ISLAND[0], z - ISLAND[1]) / 290) - 16;
}

function margaretSeabed(x, z) {
  let d = mix(-16, -4.4, smoothstep(-320, -30, z));
  d = mix(d, -3.0, smoothstep(-30, 110, z));
  const beach = (z - shoreZ(x)) * 0.035;
  d = smax(d, beach, 1.5);
  d = smax(d, headlandH(x, z), 4);
  d = Math.max(d, islandH(x, z));
  return d;
}

const MARGARET_GLSL = /* glsl */ `
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
// the bottom: sand with darker weed and rock patches
vec3 bedColor(vec2 p) {
  float s1 = texture(uNoise, p * 0.021).b;
  float s2 = texture(uNoise, p * 0.13 + 0.37).b;
  float patches = texture(uNoise, p * 0.0042 + 0.11).a;
  vec3 sand = vec3(0.62, 0.5, 0.33) * (0.72 + 0.42 * s1) * (0.88 + 0.22 * s2);
  vec3 weed = vec3(0.17, 0.16, 0.09);
  float wm = smoothstep(0.56, 0.68, patches + 0.25 * s1);
  return mix(sand, weed, wm * 0.75);
}
float bedFoam(vec2 p) { return 0.0; } // (no reef breaking away from the wave)
`;

// --- land detail (JS only; applied well above the waterline) ---------------------------
// Returns { h, veg } where veg in [0,1] marks vegetated ground.
function landSample(x, z, out) {
  const base = margaretSeabed(x, z);
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

const SAND_DRY = new THREE.Color('#e3cfa4');
const SAND_WET = new THREE.Color('#ad9670');
const VEG_A = new THREE.Color('#1c3319');
const VEG_B = new THREE.Color('#34502a');
const ROCK = new THREE.Color('#6f675e');
const GRASS = new THREE.Color('#7f8a52');

function paint(x, z, h, slope, tmp, c) {
  const n = fbm(x * 0.05, z * 0.05, 3);
  c.copy(SAND_WET).lerp(SAND_DRY, smoothstep(0.1, 0.9, h));
  c.lerp(GRASS, smoothstep(3.5, 6, h) * smoothstep(40, 80, tmp.s) * 0.6);
  const veg = tmp.veg * (1 - smoothstep(0.75, 1.1, slope));
  const vc = VEG_A.clone().lerp(VEG_B, n);
  c.lerp(vc, veg);
  c.lerp(ROCK, smoothstep(0.55, 0.95, slope) * smoothstep(0.5, 3, h));
  c.multiplyScalar(0.88 + 0.24 * n);
}

const buildMesh = (xs, zs, material) => buildLandMesh(xs, zs, material, landSample, paint);

function createMargaret(quality) {
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
  const rand = lcg(4242);
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

// ---------------------------------------------------------------- the spots
const LAND = {
  margaret: { seabedY: margaretSeabed, glsl: MARGARET_GLSL, create: createMargaret },
  teahupoo: { seabedY: teahupoo.seabedY, glsl: teahupoo.SEABED_GLSL, create: teahupoo.createLand },
  pool: { seabedY: wavepool.seabedY, glsl: wavepool.SEABED_GLSL, create: wavepool.createLand, collide: wavepool.collide, solidAt: wavepool.solidAt },
  // (a river: the land is the model, filled in once it has loaded; the sea isn't drawn)
  eisbach: { seabedY: eisbachBedY, glsl: MARGARET_GLSL, create: () => eisbachGroup, collide: eisbachCollide, solidAt: eisbachSolidAt },
};
let active = LAND.margaret;

// The spot being played (for seabedY).
export function setLandSpot(id) {
  active = LAND[id] || LAND.margaret;
}

// Height of the bottom (negative under water) at the spot being played.
export function seabedY(x, z) {
  return active.seabedY(x, z);
}

// Walls and piers at the spot being played (a pool): keeps a surfer ({ x, z, vx, vz }) out of
// them and says how hard they hit (m/s); null where there are none.
export function spotCollider() {
  return active.collide || null;
}

// Something solid (not the ground) at x, y, z? (for the drone)
export function solidAt(x, y, z) {
  return active.solidAt ? active.solidAt(x, y, z) : false;
}

// GLSL: float seabedY(vec2 p) and vec3 bedColor(vec2 p) for a spot.
export function seabedGLSL(id) {
  return (LAND[id] || LAND.margaret).glsl;
}

// The land (and anything else the spot needs) as one group.
export function createTerrain(id, quality) {
  return (LAND[id] || LAND.margaret).create(quality);
}
