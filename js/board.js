// Parametric shortboard: outline, rocker, foil and rails. Nose points along local -z,
// the deck is at roughly y = +0.035 with the origin on the water line.
import * as THREE from 'three';
import { BOARD } from './config.js';
import { createBoardTexture } from './textures.js';

// half-width outline (t: 0 = tail, 1 = nose)
const OUTLINE = [
  [0.0, 0.135],
  [0.04, 0.17],
  [0.12, 0.205],
  [0.25, 0.235],
  [0.45, 0.25],
  [0.62, 0.24],
  [0.76, 0.205],
  [0.86, 0.16],
  [0.93, 0.105],
  [0.975, 0.055],
  [1.0, 0.0],
];

function outline(t) {
  for (let i = 0; i < OUTLINE.length - 1; i++) {
    const [t0, w0] = OUTLINE[i],
      [t1, w1] = OUTLINE[i + 1];
    if (t <= t1) {
      const p0 = OUTLINE[Math.max(i - 1, 0)][1],
        p3 = OUTLINE[Math.min(i + 2, OUTLINE.length - 1)][1];
      const s = (t - t0) / (t1 - t0);
      const s2 = s * s,
        s3 = s2 * s;
      // Catmull-Rom
      return 0.5 * (2 * w0 + (-p0 + w1) * s + (2 * p0 - 5 * w0 + 4 * w1 - p3) * s2 + (-p0 + 3 * w0 - 3 * w1 + p3) * s3);
    }
  }
  return 0;
}

function rocker(t) {
  const tail = t < 0.3 ? 0.045 * Math.pow(1 - t / 0.3, 2) : 0;
  const nose = t > 0.55 ? 0.125 * Math.pow((t - 0.55) / 0.45, 2.1) : 0;
  return tail + nose;
}

function thickness(t) {
  return 0.016 + 0.048 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.94)), 0.62);
}

export function createBoard() {
  const L = BOARD.length;
  const NL = 72,
    NA = 28;
  const pos = [],
    uv = [],
    idx = [];
  for (let i = 0; i <= NL; i++) {
    // denser stations near the nose & tail
    const s = i / NL;
    const t = 0.5 - 0.5 * Math.cos(Math.PI * s);
    const hw = Math.max(outline(t), 0.002);
    const th = thickness(t);
    const r = rocker(t);
    const z = (0.5 - t) * L;
    for (let j = 0; j <= NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      const c = Math.cos(a),
        sn = Math.sin(a);
      const x = hw * Math.sign(c) * Math.pow(Math.abs(c), 0.42);
      // deck domed, bottom flatter, rails pinched slightly below centre
      const yTop = th * 0.62 * Math.pow(Math.abs(sn), 0.55);
      const yBot = -th * 0.38 * Math.pow(Math.abs(sn), 0.28);
      const y = (sn >= 0 ? yTop : yBot) + r - 0.025;
      pos.push(x, y, z);
      uv.push(t, 0.5 + (x / 0.25) * 0.5 * (sn >= 0 ? 1 : -1));
    }
  }
  const row = NA + 1;
  for (let i = 0; i < NL; i++)
    for (let j = 0; j < NA; j++) {
      const a = i * row + j,
        b = a + 1,
        c = a + row,
        d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    map: createBoardTexture(),
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    sheen: 0.0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // fins
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.quadraticCurveTo(0.03, -0.09, 0.075, -0.115);
  finShape.quadraticCurveTo(0.06, -0.05, 0.11, 0);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.006, bevelEnabled: false });
  finGeo.rotateY(-Math.PI / 2);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  const group = new THREE.Group();
  group.add(mesh);
  for (const [x, z, toe] of [
    [0.16, 0.6, 0.05],
    [-0.16, 0.6, -0.05],
    [0, 0.78, 0],
  ]) {
    const f = new THREE.Mesh(finGeo, finMat);
    const tt = 0.5 - z / L;
    f.position.set(x - 0.003, rocker(tt) - 0.04, z - 0.05);
    f.rotation.y = toe;
    group.add(f);
  }
  group.userData.deckHeight = 0.035;
  return group;
}
