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

// Deck graphics for the board: u along the length (tail -> nose), v across.
export function createBoardTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f6f1';
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
  g.fillStyle = '#f7f6f1';
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
