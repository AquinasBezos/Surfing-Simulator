// The Eisbach, Munich: the river wave by the Prinzregentenstrasse bridge, from
// assets/eisbach_wave_munich_draco.glb (Draco-compressed; decoded with three.js's
// DRACOLoader the first time someone picks the spot). The model has the bridge, both banks,
// the channel bed with the blocks that make the wave, the park and the city behind it, but no
// water: river.js is the water.
//
// The model's frame: metres, +X downstream (north), +Z the east bank, origin = the wave's
// centre on the mean water level. The game turns it a quarter turn so the river runs toward
// -z: world x = model Z, world z = -model X.
//
// From the model's triangles this also measures, on grids a quarter of a metre square:
//   - the ground you can walk on (the banks, steps, platforms, park, the bridge), and
//   - the channel's bed, which gives the channel's walls (for the water and the surfer).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { addUnderwaterFogWhenUnder } from './underwater.js';

const URL = 'assets/eisbach_wave_munich_draco.glb';
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/';

// the grids (model frame)
const G = { x0: -24, x1: 140, z0: -40, z1: 22, cell: 0.25 };
G.nx = Math.round((G.x1 - G.x0) / G.cell);
G.nz = Math.round((G.z1 - G.z0) / G.cell);
const NONE = -1e9;

// (of the props, only the timber platforms: the lamp posts, signs and the cable over the river
// would stand up as walls)
const WALK = ['Bank_East', 'Bank_West', 'Steps_East', 'Retaining_Wall_East', 'Terrain_Park', 'Props_1', 'Bridge_Structure', 'Bridge_Ornament', 'Road_Prinzregentenstrasse'];
const BED = ['Channel_Bed'];
// the banks themselves, without what stands on them (for where the water meets them)
const BANKS = ['Bank_East', 'Bank_West', 'Steps_East', 'Retaining_Wall_East', 'Terrain_Park'];

// The group the spot's land goes in: empty until the model has loaded.
export const eisbachGroup = new THREE.Group();
eisbachGroup.name = 'Eisbach';
eisbachGroup.rotation.y = Math.PI / 2; // (model +X, downstream, to world -z)

let loading = null;
let site = null; // once loaded: { ground, bed, spawns, channel, rows }

export const eisbachSite = () => site;

// Load and decode the model (once). onProgress(0..1) while it downloads.
export function loadEisbach(onProgress) {
  const listeners = (loadEisbach.listeners ||= new Set());
  if (onProgress) listeners.add(onProgress);
  loading ||= new Promise((resolve, reject) => {
    const draco = new DRACOLoader().setDecoderPath(DRACO);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load(
      URL,
      (gltf) => {
        try {
          site = buildSite(gltf);
          draco.dispose();
          for (const fn of listeners) fn(1);
          resolve(site);
        } catch (e) {
          reject(e);
        }
      },
      (e) => {
        if (e.total) for (const fn of listeners) fn(Math.min(0.97, e.loaded / e.total));
      },
      (e) => {
        loading = null;
        reject(e);
      },
    );
  });
  return loading;
}

function buildSite(gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const ground = new Float32Array(G.nx * G.nz).fill(NONE);
  const bed = new Float32Array(G.nx * G.nz).fill(NONE);
  const banks = new Float32Array(G.nx * G.nz).fill(NONE);
  const spawns = {};
  scene.traverse((o) => {
    if (o.name.startsWith('SPAWN_')) spawns[o.userData.side || o.name] = o.position.clone();
    if (!o.isMesh) return;
    const name = meshName(o);
    if (WALK.some((n) => name.startsWith(n))) rasterize(o, ground);
    if (BED.some((n) => name.startsWith(n))) rasterize(o, bed);
    if (BANKS.some((n) => name.startsWith(n))) rasterize(o, banks);
    // looks: everything fogs green under the water; the foliage cuts out cleanly
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.userData.eisbach) continue;
      m.userData.eisbach = true;
      if (m.alphaTest === 0 && m.transparent === false && m.name === 'Leaves') m.alphaTest = 0.5;
      m.envMapIntensity = 0.8;
      addUnderwaterFogWhenUnder(m);
    }
  });
  // the channel's walls along the river, from the bed: the deep run of cells containing the
  // channel's line (which bends toward the west bank downstream)
  const rows = [];
  let centre = 0;
  for (let i = 0; i < G.nx; i++) {
    const X = G.x0 + (i + 0.5) * G.cell;
    const deep = (k) => bed[i * G.nz + k] < -0.3 && bed[i * G.nz + k] > NONE / 2;
    let k = Math.round((centre - G.z0) / G.cell);
    k = Math.min(G.nz - 1, Math.max(0, k));
    if (!deep(k)) {
      // find the nearest deep cell
      let best = -1;
      for (let d = 1; d < 60 && best < 0; d++) {
        if (k - d >= 0 && deep(k - d)) best = k - d;
        else if (k + d < G.nz && deep(k + d)) best = k + d;
      }
      if (best < 0) {
        rows.push(null);
        continue;
      }
      k = best;
    }
    let a = k,
      b = k;
    while (a > 0 && deep(a - 1)) a--;
    while (b < G.nz - 1 && deep(b + 1)) b++;
    const z0 = G.z0 + a * G.cell,
      z1 = G.z0 + (b + 1) * G.cell;
    rows.push([z0, z1]);
    centre = (z0 + z1) / 2;
  }
  // smooth out the cell steps (and fill any gaps) so the water's edge runs straight
  const n = rows.length;
  let last = rows.find(Boolean);
  for (let i = 0; i < n; i++) {
    if (!rows[i]) rows[i] = last.slice();
    last = rows[i];
  }
  const walls = rows.map(([z0, z1], i) => {
    let s0 = 0,
      s1 = 0,
      w = 0;
    for (let j = -3; j <= 3; j++) {
      const r = rows[Math.min(n - 1, Math.max(0, i + j))];
      s0 += r[0];
      s1 += r[1];
      w++;
    }
    return [s0 / w, s1 / w];
  });
  const channel = (X) => {
    const f = Math.min(n - 1.001, Math.max(0, (X - G.x0) / G.cell - 0.5));
    const i = Math.floor(f),
      t = f - i;
    const a = walls[i],
      b = walls[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // where the water mesh has rows (river X): dense round the wave
  const waterRows = [];
  for (let X = -17; X < 136; ) {
    waterRows.push(X);
    X += X < -6 ? 0.6 : X < -4.2 ? 0.25 : X < 9 ? 0.09 : X < 24 ? 0.3 : 0.9;
  }
  waterRows.push(136);
  eisbachGroup.add(scene);
  return {
    model: scene,
    spawns,
    channel,
    waterRows,
    // the walkable ground at world x, z (the top surface there), or null
    groundAt(x, z) {
      const v = lookup(ground, -z, x);
      return v > NONE / 2 ? v : null;
    },
    bedAt(x, z) {
      const v = lookup(bed, -z, x);
      return v > NONE / 2 ? v : null;
    },
    // the top of the banks or the bed at model X, Z (not what stands on them), or null
    solidModel(X, Z) {
      const v = Math.max(lookup(banks, X, Z), lookup(bed, X, Z));
      return v > NONE / 2 ? v : null;
    },
  };
}

// ---------------------------------------------------------------- for the game (world x, z)
// the bottom of the river (or the ground) at x, z
export function eisbachBedY(x, z) {
  if (!site) return -1.3;
  const b = site.bedAt(x, z);
  if (b !== null) return b;
  const g = site.groundAt(x, z);
  return g !== null ? g : -1.3;
}

// the banks and the bridge are solid (for the drone)
export function eisbachSolidAt(x, y, z) {
  if (!site) return false;
  const g = site.groundAt(x, z);
  return g !== null && g > -0.3 && y < g;
}

// Keep a surfer ({ x, z, vx, vz, air }) on the water between the channel's walls; returns how
// hard they hit one (m/s). In the air they can go over (to land on a bank).
export function eisbachCollide(s) {
  if (!site || s.air) return 0;
  const [z0, z1] = site.channel(-s.z);
  const m = 0.42;
  let hit = 0;
  const touch = s.x < z0 + m || s.x > z1 - m;
  if (s.x < z0 + m) {
    hit = Math.max(hit, -s.vx);
    s.x = z0 + m;
    if (s.vx < 0) s.vx = 0;
  } else if (s.x > z1 - m) {
    hit = Math.max(hit, s.vx);
    s.x = z1 - m;
    if (s.vx > 0) s.vx = 0;
  }
  // scraping along the wall brakes you (and stops the fins turning the wall's push into speed)
  if (touch) s.vz *= 0.97;
  // under the bridge: its piers stop you going far up the inflow
  if (s.z > 14) {
    hit = Math.max(hit, s.vz);
    s.z = 14;
    if (s.vz > 0) s.vz = 0;
  }
  return hit;
}

function meshName(o) {
  let p = o;
  while (p && !p.name) p = p.parent;
  // (three names the parts of a multi-material mesh after it: Bank_East_1 ...)
  return p ? p.name : '';
}

function lookup(grid, X, Z) {
  const i = Math.floor((X - G.x0) / G.cell),
    k = Math.floor((Z - G.z0) / G.cell);
  if (i < 0 || k < 0 || i >= G.nx || k >= G.nz) return NONE;
  return grid[i * G.nz + k];
}

// Put a mesh's triangles into a height grid: each cell keeps the highest surface over it.
const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3();
function rasterize(mesh, grid) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index ? geo.index.array : null;
  const count = index ? index.length : pos.count;
  const m = mesh.matrixWorld;
  for (let t = 0; t < count; t += 3) {
    const ia = index ? index[t] : t,
      ib = index ? index[t + 1] : t + 1,
      ic = index ? index[t + 2] : t + 2;
    _a.fromBufferAttribute(pos, ia).applyMatrix4(m);
    _b.fromBufferAttribute(pos, ib).applyMatrix4(m);
    _c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    const minX = Math.min(_a.x, _b.x, _c.x),
      maxX = Math.max(_a.x, _b.x, _c.x);
    const minZ = Math.min(_a.z, _b.z, _c.z),
      maxZ = Math.max(_a.z, _b.z, _c.z);
    if (maxX < G.x0 || minX > G.x1 || maxZ < G.z0 || minZ > G.z1) continue;
    const i0 = Math.max(0, Math.floor((minX - G.x0) / G.cell)),
      i1 = Math.min(G.nx - 1, Math.floor((maxX - G.x0) / G.cell));
    const k0 = Math.max(0, Math.floor((minZ - G.z0) / G.cell)),
      k1 = Math.min(G.nz - 1, Math.floor((maxZ - G.z0) / G.cell));
    // barycentric over the XZ projection (steep or vertical faces: their top edge)
    const d = (_b.z - _c.z) * (_a.x - _c.x) + (_c.x - _b.x) * (_a.z - _c.z);
    const flat = Math.abs(d) < 1e-6;
    for (let i = i0; i <= i1; i++) {
      const px = G.x0 + (i + 0.5) * G.cell;
      for (let k = k0; k <= k1; k++) {
        const pz = G.z0 + (k + 0.5) * G.cell;
        let h;
        if (flat) {
          // a wall seen edge on: count it where it passes through the cell
          const near = distToSeg(px, pz, _a, _b) < G.cell * 0.75 || distToSeg(px, pz, _b, _c) < G.cell * 0.75 || distToSeg(px, pz, _c, _a) < G.cell * 0.75;
          if (!near) continue;
          h = Math.max(_a.y, _b.y, _c.y);
        } else {
          const l1 = ((_b.z - _c.z) * (px - _c.x) + (_c.x - _b.x) * (pz - _c.z)) / d;
          const l2 = ((_c.z - _a.z) * (px - _c.x) + (_a.x - _c.x) * (pz - _c.z)) / d;
          const l3 = 1 - l1 - l2;
          const e = -0.02;
          if (l1 < e || l2 < e || l3 < e) continue;
          h = l1 * _a.y + l2 * _b.y + l3 * _c.y;
        }
        const g = i * G.nz + k;
        if (h > grid[g]) grid[g] = h;
      }
    }
  }
}

function distToSeg(px, pz, a, b) {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const l = dx * dx + dz * dz;
  const t = l > 0 ? Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / l)) : 0;
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}
