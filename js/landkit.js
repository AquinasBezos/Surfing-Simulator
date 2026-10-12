// Shared pieces for building a surf spot's coastline: noise, and a land mesh built from a
// height function on a grid that is fine near the break and coarse far away.
import * as THREE from 'three';

export function smax(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

export function segDist(x, z, a, b) {
  const px = x - a[0],
    pz = z - a[1];
  const bx = b[0] - a[0],
    bz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, (px * bx + pz * bz) / (bx * bx + bz * bz)));
  return Math.hypot(px - bx * t, pz - bz * t);
}

export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x, z) {
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

export function fbm(x, z, oct = 5) {
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

// Ridged noise: sharp crests where the noise crosses its middle (mountain ridges and spurs).
export function ridged(x, z, oct = 4) {
  let s = 0,
    a = 0.5,
    f = 1,
    w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(2 * vnoise(x * f + i * 17.3, z * f - i * 9.1) - 1);
    r *= r;
    s += a * r * w;
    w = Math.min(1, r * 1.6); // finer ridges mostly on the bigger ones
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

// Grid coordinates from lo to hi: step s0 at `centre`, growing with distance from it.
export function marchCoords(lo, hi, centre, s0, growth) {
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

// A land mesh over the grid xs * zs. sample(x, z, out) sets out.h (and anything paint
// needs); paint(x, z, h, slope, out, color) sets the vertex colour. Quads entirely below
// `cull` are left out (the opaque ocean hides them).
export function buildLandMesh(xs, zs, material, sample, paint, cull = -1.2) {
  const nx = xs.length,
    nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const hs = new Float32Array(nx * nz);
  const tmp = {};
  const c = new THREE.Color();
  // whatever else sample() reports is kept for paint(), so the land is only sampled once
  let keys = null;
  const kept = {};
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      sample(xs[i], zs[j], tmp);
      if (!keys) {
        keys = Object.keys(tmp).filter((key) => key !== 'h');
        for (const key of keys) kept[key] = new Float32Array(nx * nz);
      }
      for (const key of keys) kept[key][k] = tmp[key];
      hs[k] = tmp.h;
      pos[k * 3] = xs[i];
      pos[k * 3 + 1] = Math.max(tmp.h, -8);
      pos[k * 3 + 2] = zs[j];
    }
  // colours need the slope: second pass
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const i0 = Math.max(i - 1, 0),
        i1 = Math.min(i + 1, nx - 1);
      const j0 = Math.max(j - 1, 0),
        j1 = Math.min(j + 1, nz - 1);
      const sx = (hs[j * nx + i1] - hs[j * nx + i0]) / (xs[i1] - xs[i0]);
      const sz = (hs[j1 * nx + i] - hs[j0 * nx + i]) / (zs[j1] - zs[j0]);
      for (const key of keys) tmp[key] = kept[key][k];
      tmp.h = hs[k];
      paint(xs[i], zs[j], hs[k], Math.hypot(sx, sz), tmp, c);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  const idx = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i,
        b = a + 1,
        cc = a + nx,
        d = cc + 1;
      if (Math.max(hs[a], hs[b], hs[cc], hs[d]) < cull) continue;
      idx.push(a, cc, b, b, cc, d);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// Seeded random numbers (for placing trees and houses the same way every time).
export function lcg(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
