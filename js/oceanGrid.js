// Adaptive ocean grid. The mesh is a fixed (cols x rows) lattice of indices; the actual
// rest positions of each column (x) and row (z, crest-aligned) are recomputed on the CPU
// every frame and uploaded as a tiny float texture. Vertices are concentrated around the
// camera and around each wave crest / breaking point so the barrel is finely tessellated
// while the ocean still reaches the horizon.
import * as THREE from 'three';
import { WAVE, WORLD_RADIUS } from './config.js';
import { crestOffset } from './wave.js';

function distribute(out, n, lo, hi, spacing) {
  // Find a scale so that marching lo -> hi with step scale*spacing(p) takes exactly n-1 steps.
  const fracSteps = (scale) => {
    let p = lo;
    for (let i = 0; i < 4 * n; i++) {
      const step = scale * spacing(p);
      if (p + step >= hi) return i + (hi - p) / step;
      p += step;
    }
    return 4 * n;
  };
  let a = 0.02,
    b = 200;
  for (let it = 0; it < 40; it++) {
    const m = Math.sqrt(a * b);
    if (fracSteps(m) > n - 1) a = m;
    else b = m;
  }
  const scale = Math.sqrt(a * b);
  let p = lo;
  out[0] = lo;
  for (let i = 1; i < n; i++) {
    p += scale * spacing(p);
    out[i] = Math.min(p, hi);
  }
  out[n - 1] = hi;
}

export class OceanGrid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.width = Math.max(cols, rows);
    this.data = new Float32Array(this.width * 2);
    this.texture = new THREE.DataTexture(this.data, this.width, 2, THREE.RedFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.xs = new Float32Array(cols);
    this.zs = new Float32Array(rows);
    this.geometry = this.buildGeometry();
  }

  buildGeometry() {
    const { cols, rows } = this;
    const pos = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 3;
        pos[k] = i;
        pos[k + 1] = j;
      }
    const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let t = 0;
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i,
          b = a + 1,
          c = a + cols,
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
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    return geo;
  }

  update(camX, camZ, model) {
    const camRow = camZ - crestOffset(camX);
    const cores = [];
    const peels = [];
    for (const w of model.waves) {
      if (!w.active || w.H < 0.15) continue;
      const S = w.S;
      // detail falls off with distance from the camera
      const d = Math.max(0, Math.abs(camRow - w.crestZ0) - 3 * S);
      cores.push({ c: w.crestZ0, S, k: 1 + d / 35 });
      if (w.tau > -2) {
        const px = w.peakX + w.dir * WAVE.peelSpeed * Math.max(w.tau, 0);
        const bx = w.peakX - w.dir * WAVE.backSpeed * Math.max(w.tau, 0);
        const near = 1 + Math.max(0, Math.abs(camRow - w.crestZ0) - 3 * S) / 30;
        peels.push({ x: px, k: near }, { x: bx, k: near * 1.5 });
      }
    }
    const rowSpacing = (z) => {
      let s = 0.085 + 0.055 * Math.abs(z - camRow);
      for (const c of cores) {
        const u = (z - c.c) / c.S;
        // finest in the curl zone, fine across the whole wave, growing outside
        const outCurl = Math.max(0, -0.3 - u, u - 0.85);
        const outCore = Math.max(0, -1.7 - u, u - 2.3);
        const sc = c.S * (0.021 + 0.013 * Math.min(1, outCurl / 0.35)) * c.k + 0.05 * outCore * c.S;
        if (sc < s) s = sc;
      }
      return Math.min(s, 380);
    };
    const colSpacing = (x) => {
      let s = 0.13 + 0.05 * Math.abs(x - camX);
      for (const p of peels) {
        const sp = (0.28 + 0.05 * Math.abs(x - p.x)) * p.k;
        if (sp < s) s = sp;
      }
      return Math.min(s, 380);
    };
    distribute(this.zs, this.rows, -WORLD_RADIUS, WORLD_RADIUS, rowSpacing);
    distribute(this.xs, this.cols, camX - WORLD_RADIUS, camX + WORLD_RADIUS, colSpacing);
    const W = this.width;
    for (let i = 0; i < this.cols; i++) this.data[i] = this.xs[i];
    for (let j = 0; j < this.rows; j++) this.data[W + j] = this.zs[j];
    this.texture.needsUpdate = true;
  }
}
