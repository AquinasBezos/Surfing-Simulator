// Parametric surfboards: outline, rocker, foil and rails. Nose points along local -z,
// the deck is at roughly y = +0.035 with the origin on the water line.
import * as THREE from 'three';
import { BOARDS } from './config.js';
import { createBoardTexture } from './textures.js';

// half-width outlines (t: 0 = tail, 1 = nose)
const SHAPES = {
  shortboard: {
    outline: [
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
    ],
    tailRocker: 0.045,
    noseRocker: 0.125,
    thick: 0.064,
    fins: [
      [0.16, 0.6, 0.05, 1],
      [-0.16, 0.6, -0.05, 1],
      [0, 0.78, 0, 1],
    ],
  },
  longboard: {
    outline: [
      [0.0, 0.17],
      [0.04, 0.215],
      [0.14, 0.255],
      [0.3, 0.282],
      [0.5, 0.292],
      [0.7, 0.288],
      [0.84, 0.268],
      [0.92, 0.238],
      [0.965, 0.19],
      [0.988, 0.12],
      [1.0, 0.0],
    ],
    tailRocker: 0.05,
    noseRocker: 0.11,
    thick: 0.078,
    fins: [[0, 1.18, 0, 1.9]],
  },
};

function outlineAt(table, t) {
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, w0] = table[i],
      [t1, w1] = table[i + 1];
    if (t <= t1) {
      const p0 = table[Math.max(i - 1, 0)][1],
        p3 = table[Math.min(i + 2, table.length - 1)][1];
      const s = (t - t0) / (t1 - t0);
      const s2 = s * s,
        s3 = s2 * s;
      // Catmull-Rom
      return 0.5 * (2 * w0 + (-p0 + w1) * s + (2 * p0 - 5 * w0 + 4 * w1 - p3) * s2 + (-p0 + 3 * w0 - 3 * w1 + p3) * s3);
    }
  }
  return 0;
}

// color: deck colour (#rrggbb), or null for the classic finish
export function createBoard(type = 'shortboard', color = null) {
  const spec = SHAPES[type] || SHAPES.shortboard;
  const L = (BOARDS[type] || BOARDS.shortboard).length;
  const maxHW = Math.max(...spec.outline.map((p) => p[1]));
  const rocker = (t) => {
    const tail = t < 0.3 ? spec.tailRocker * Math.pow(1 - t / 0.3, 2) : 0;
    const nose = t > 0.55 ? spec.noseRocker * Math.pow((t - 0.55) / 0.45, 2.1) : 0;
    return tail + nose;
  };
  const thickness = (t) => 0.016 + (spec.thick - 0.016) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.94)), 0.62);

  const NL = type === 'longboard' ? 96 : 72,
    NA = 28;
  const pos = [],
    uv = [],
    idx = [];
  for (let i = 0; i <= NL; i++) {
    // denser stations near the nose & tail
    const s = i / NL;
    const t = 0.5 - 0.5 * Math.cos(Math.PI * s);
    const hw = Math.max(outlineAt(spec.outline, t), 0.002);
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
      uv.push(t, 0.5 + (x / maxHW) * 0.5 * (sn >= 0 ? 1 : -1));
    }
  }
  const row = NA + 1;
  for (let i = 0; i < NL; i++)
    for (let j = 0; j < NA; j++) {
      const a = i * row + j,
        b = a + 1,
        c = a + row,
        d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise from outside
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    map: createBoardTexture(type, color),
    roughness: 0.32,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // fins: [x, distance from the centre toward the tail, toe, size]
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  const group = new THREE.Group();
  group.add(mesh);
  for (const [x, z, toe, size] of spec.fins) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.quadraticCurveTo(0.03 * size, -0.09 * size, 0.075 * size, -0.115 * size);
    finShape.quadraticCurveTo(0.06 * size, -0.05 * size, 0.11 * size, 0);
    finShape.lineTo(0, 0);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.006, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2);
    const f = new THREE.Mesh(finGeo, finMat);
    const tt = 0.5 - z / L;
    f.position.set(x - 0.003, rocker(tt) - 0.04, z - 0.05 * size);
    f.rotation.y = toe;
    group.add(f);
  }
  group.userData.deckHeight = 0.035;
  group.userData.type = type;
  return group;
}
