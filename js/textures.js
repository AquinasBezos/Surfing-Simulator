// Procedural, tileable textures generated at start-up (no binary assets needed).
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Periodic value noise on an integer lattice of size `period`.
function periodicNoise(period, rand) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let fx = x - xi,
      fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period,
      y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period,
      y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0],
      b = g[y0 * period + x1],
      c = g[y1 * period + x0],
      d = g[y1 * period + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbmFactory(baseP, octaves, rand) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(periodicNoise(baseP << o, rand));
  return (u, v) => {
    // u, v in [0,1)
    let sum = 0,
      amp = 0.5,
      norm = 0;
    for (let o = 0; o < octaves; o++) {
      const p = baseP << o;
      sum += amp * layers[o](u * p, v * p);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

// Periodic Worley noise: returns [F1, F2] distances in cell units.
function worleyFactory(cells, rand) {
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  return (u, v) => {
    const x = u * cells,
      y = v * cells;
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let f1 = 9,
      f2 = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i,
          cy = yi + j;
        const wx = ((cx % cells) + cells) % cells,
          wy = ((cy % cells) + cells) % cells;
        const k = (wy * cells + wx) * 2;
        const dx = cx + pts[k] - x,
          dy = cy + pts[k + 1] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    return [f1, f2];
  };
}

// Sum of periodic sine waves -> height & gradient, used for normals and caustics.
function waveSpectrum(rand, count, kMin, kMax, power) {
  const waves = [];
  for (let i = 0; i < count; i++) {
    let kx, ky, k;
    do {
      kx = Math.round((rand() * 2 - 1) * kMax);
      ky = Math.round((rand() * 2 - 1) * kMax);
      k = Math.hypot(kx, ky);
    } while (k < kMin || k > kMax);
    waves.push({ kx: kx * 2 * Math.PI, ky: ky * 2 * Math.PI, a: Math.pow(k, -power), p: rand() * Math.PI * 2 });
  }
  return waves;
}

export function createWaterNormalTexture(size = 256) {
  const rand = rng(1234);
  const waves = waveSpectrum(rand, 56, 1, 22, 1.55);
  const data = new Uint8Array(size * size * 4);
  let maxSlope = 0;
  const gx = new Float32Array(size * size),
    gy = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      let dx = 0,
        dy = 0;
      for (const w of waves) {
        const c = Math.cos(w.kx * u + w.ky * v + w.p) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      gx[y * size + x] = dx;
      gy[y * size + x] = dy;
      maxSlope = Math.max(maxSlope, Math.abs(dx), Math.abs(dy));
    }
  const scale = 1.6 / maxSlope;
  for (let i = 0; i < size * size; i++) {
    const nx = -gx[i] * scale,
      ny = -gy[i] * scale;
    const l = Math.hypot(nx, ny, 1);
    data[i * 4] = ((nx / l) * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = ((1 / l) * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// R: foam bubbles, G: caustics, B: sand detail, A: broad noise
export function createNoiseTexture(size = 512) {
  const rand = rng(777);
  const fbmA = fbmFactory(4, 6, rand);
  const fbmB = fbmFactory(8, 5, rand);
  const worleyA = worleyFactory(18, rand);
  const worleyB = worleyFactory(42, rand);
  const data = new Uint8Array(size * size * 4);

  // caustics by splatting refracted light rays through a periodic surface
  const caust = new Float32Array(size * size);
  const cw = waveSpectrum(rand, 14, 2, 7, 1.0);
  const R = size;
  const depthK = 0.016;
  for (let y = 0; y < R; y++)
    for (let x = 0; x < R; x++) {
      const u = x / R,
        v = y / R;
      let dx = 0,
        dy = 0;
      for (const w of cw) {
        const c = Math.cos(w.kx * u + w.ky * v + w.p) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      let px = (u - dx * depthK) * size,
        py = (v - dy * depthK) * size;
      const ix = Math.floor(px),
        iy = Math.floor(py);
      const fx = px - ix,
        fy = py - iy;
      const x0 = ((ix % size) + size) % size,
        y0 = ((iy % size) + size) % size;
      const x1 = (x0 + 1) % size,
        y1 = (y0 + 1) % size;
      caust[y0 * size + x0] += (1 - fx) * (1 - fy);
      caust[y0 * size + x1] += fx * (1 - fy);
      caust[y1 * size + x0] += (1 - fx) * fy;
      caust[y1 * size + x1] += fx * fy;
    }
  // blur & normalise
  const blurred = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const xx = (x + i + size) % size,
            yy = (y + j + size) % size;
          s += caust[yy * size + xx] * (i === 0 && j === 0 ? 4 : i === 0 || j === 0 ? 2 : 1);
        }
      blurred[y * size + x] = s / 16;
    }

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const i = (y * size + x) * 4;
      // foam: lacy webs along cell borders at two scales + small bubbles, broken up by fbm
      const [a1, a2] = worleyA(u, v);
      const [b1, b2] = worleyB(u, v);
      const n = fbmA(u, v);
      const webA = 1 - Math.min(1, (a2 - a1) / 0.22);
      const webB = 1 - Math.min(1, (b2 - b1) / 0.3);
      const bubbles = Math.max(0, 1 - b1 * 2.4);
      const patch = Math.min(1, Math.max(0, (n - 0.38) / 0.3));
      let foam = 0.38 * webA * webA + 0.22 * webB + 0.2 * bubbles + 0.55 * patch * (0.6 + 0.4 * webB) - 0.05;
      data[i] = Math.max(0, Math.min(255, foam * 255));
      // caustics
      const c = Math.pow(Math.max(0, blurred[y * size + x] - 0.35) / 2.2, 1.4);
      data[i + 1] = Math.max(0, Math.min(255, c * 255));
      // sand: ripples + patches
      const m = fbmB(u, v);
      const ripple = 0.5 + 0.5 * Math.sin((u * 46 + v * 9 + m * 6) * Math.PI * 2);
      data[i + 2] = Math.max(0, Math.min(255, (0.55 * m + 0.25 * ripple + 0.2) * 255));
      data[i + 3] = Math.max(0, Math.min(255, n * 255));
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// brown, purple-brown, pale (dead) and grey-green coral; sand
const REEF_KINDS = [
  [0.3, 0.2, 0.08],
  [0.36, 0.25, 0.11],
  [0.3, 0.15, 0.17],
  [0.6, 0.55, 0.42],
  [0.22, 0.27, 0.15],
  [0.46, 0.36, 0.2],
];
const REEF_SAND = [0.7, 0.64, 0.48];

// Coral reef (Teahupo'o), tileable. RGB: colour (linear) of coral colonies of a few kinds
// with dark cracks between and sand in the gaps; A: relief (how high the coral stands).
// Returns the texture, a bump map (R: relief plus rough detail) and relief(u, v) for
// building the reef's shape.
export function createReefTexture(size = 512) {
  const rand = rng(4242);
  const fine = fbmFactory(32, 3, rand);
  const rough = fbmFactory(64, 2, rand);
  const broad = fbmFactory(4, 4, rand);
  // Worley cells that also say which cell (for a colour per colony)
  const cellsA = 15;
  const ptsA = Float32Array.from({ length: cellsA * cellsA * 3 }, rand);
  const worleyA = (u, v) => {
    const x = u * cellsA,
      y = v * cellsA;
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let f1 = 9,
      f2 = 9,
      id = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const wx = (((xi + i) % cellsA) + cellsA) % cellsA,
          wy = (((yi + j) % cellsA) + cellsA) % cellsA;
        const k = (wy * cellsA + wx) * 3;
        const d = Math.hypot(xi + i + ptsA[k] - x, yi + j + ptsA[k + 1] - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = ptsA[k + 2];
        } else if (d < f2) f2 = d;
      }
    return [f1, f2, id];
  };
  const worleyB = worleyFactory(44, rand);
  const relief = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  const bump = new Uint8Array(size * size * 4);
  const sat = (x) => Math.max(0, Math.min(1, x));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const [a1, , id] = worleyA(u, v);
      const [b1, b2] = worleyB(u, v);
      const crackB = sat((b2 - b1) / 0.14);
      const fn = fine(u, v);
      const rg = rough(u, v);
      // soft mounds (colonies), knobbly heads on them and between
      const dome = Math.pow(sat(1 - a1 / (0.75 + 0.35 * fn)), 0.8);
      const heads = sat(1 - b1 * 1.6) * crackB;
      const n = broad(u, v);
      const r = sat(0.5 * dome + 0.4 * heads + 0.22 * (rg - 0.5) - 0.1 * (1 - n));
      relief[y * size + x] = r;
      const sand = sat((n - 0.58) / 0.12) * sat(1 - r * 2.2);
      // patches of a few kinds of coral, blending into each other
      const kt = sat(fn * 1.25 - 0.12 + 0.35 * (id - 0.5)) * (REEF_KINDS.length - 1);
      const k0 = Math.floor(kt);
      const kf = kt - k0;
      const ka = REEF_KINDS[k0],
        kb = REEF_KINDS[Math.min(k0 + 1, REEF_KINDS.length - 1)];
      const shade = (0.5 + 0.6 * heads + 0.25 * dome) * (0.8 + 0.4 * rg);
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) data[i + ch] = sat((ka[ch] + (kb[ch] - ka[ch]) * kf) * shade * (1 - sand) + REEF_SAND[ch] * (0.85 + 0.3 * rg) * sand) * 255;
      data[i + 3] = r * 255;
      bump[i] = bump[i + 1] = bump[i + 2] = sat(r * 0.75 + rg * 0.35) * 255;
      bump[i + 3] = 255;
    }
  const make = (d) => {
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const tex = make(data);
  const bumpTex = make(bump);
  const at = (ix, iy) => relief[(((iy % size) + size) % size) * size + (((ix % size) + size) % size)];
  // bilinear, tiling
  const sample = (u, v) => {
    const fx = u * size - 0.5,
      fy = v * size - 0.5;
    const ix = Math.floor(fx),
      iy = Math.floor(fy);
    const tx = fx - ix,
      ty = fy - iy;
    return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
  };
  return { texture: tex, bump: bumpTex, relief: sample };
}

// Deck graphics for the board: u along the length (tail -> nose), v across.
// color: the deck / bottom colour (#rrggbb); the default is the classic white (or cream).
export function createBoardTexture(type = 'shortboard', color = null) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  if (type === 'longboard') {
    // cream deck, twin pinlines, logo near the nose, big wax patch in the middle
    g.fillStyle = color || '#f4efe2';
    g.fillRect(0, 0, c.width, c.height);
    const rand = rng(17);
    for (let i = 0; i < 1600; i++) {
      const x = 180 + rand() * 660,
        y = 30 + rand() * (c.height - 60);
      g.fillStyle = `rgba(205,198,180,${0.05 + rand() * 0.07})`;
      g.beginPath();
      g.ellipse(x, y, 3 + rand() * 12, 2 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#c0492b';
    g.fillRect(0, 22, c.width, 5);
    g.fillRect(0, c.height - 27, c.width, 5);
    g.fillStyle = '#2b2b2b';
    g.fillRect(0, c.height / 2 - 2.2, c.width, 4.4);
    g.save();
    g.translate(c.width * 0.86, c.height / 2);
    g.fillStyle = '#c0492b';
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color || '#f4efe2';
    g.beginPath();
    g.arc(0, 0, 18, 0, Math.PI * 2);
    g.fill();
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }
  g.fillStyle = color || '#f7f6f1';
  g.fillRect(0, 0, c.width, c.height);
  // faint wax smudges
  const rand = rng(99);
  for (let i = 0; i < 900; i++) {
    const x = rand() * c.width,
      y = 40 + rand() * (c.height - 80);
    g.fillStyle = `rgba(200,198,188,${0.04 + rand() * 0.06})`;
    g.beginPath();
    g.ellipse(x, y, 4 + rand() * 14, 2 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // stringer
  g.fillStyle = '#2b2b2b';
  g.fillRect(0, c.height / 2 - 2.2, c.width, 4.4);
  // small logo near the nose
  g.save();
  g.translate(c.width * 0.8, c.height / 2);
  g.fillStyle = '#1d4f7a';
  g.beginPath();
  g.ellipse(0, -34, 26, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color || '#f7f6f1';
  g.beginPath();
  g.ellipse(-4, -34, 14, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // tail pad
  g.fillStyle = '#1c1c1c';
  g.fillRect(0, 50, 92, c.height - 100);
  g.fillStyle = '#2e2e2e';
  for (let x = 6; x < 92; x += 8) g.fillRect(x, 54, 3, c.height - 108);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createSoftDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
