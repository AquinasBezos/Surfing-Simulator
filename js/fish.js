// Small fish that sometimes swim past when you go under (duck dives, wipeouts) in the
// ocean: a school appears a few metres in front of you, crosses your view with a wiggle of
// their tails, and scatters if you come too close. Drawn as one instanced mesh; the tails
// swing in the vertex shader. A spot's fish (spots.js): silvery baitfish, or reef fish.
import * as THREE from 'three';
import { addUnderwaterFog } from './underwater.js';

const MAX = 48;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, 1);

// a fish 1 long facing +z: a body flattened side to side, a forked tail, a dorsal fin.
// Vertex colours: a dark back over a pale belly.
function fishGeometry() {
  const pos = [],
    col = [],
    idx = [];
  const back = new THREE.Color(0.32, 0.36, 0.4),
    belly = new THREE.Color(1, 1, 1),
    c = new THREE.Color();
  const rings = 10,
    sides = 8;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings; // 0 nose .. 1 tail root
    const z = 0.5 - t * 0.78;
    const r = 0.17 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.75) + 0.008;
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const y = Math.cos(a) * r,
        x = Math.sin(a) * r * 0.42;
      pos.push(x, y, z);
      c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(Math.cos(a), -0.2, 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j,
        b = i * sides + ((j + 1) % sides);
      idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
  // tail: a forked fin in the vertical plane
  const tb = pos.length / 3;
  const tail = [
    [0, 0, -0.27],
    [0, 0.17, -0.5],
    [0, 0.02, -0.4],
    [0, -0.17, -0.5],
  ];
  for (const p of tail) {
    pos.push(...p);
    col.push(back.r, back.g, back.b);
  }
  idx.push(tb, tb + 1, tb + 2, tb, tb + 2, tb + 3);
  // dorsal fin
  const db = pos.length / 3;
  for (const p of [
    [0, 0.15, 0.12],
    [0, 0.26, -0.02],
    [0, 0.14, -0.14],
  ]) {
    pos.push(...p);
    col.push(back.r, back.g, back.b);
  }
  idx.push(db, db + 1, db + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// fish kinds: [colour, size range (m)]
const KINDS = {
  bait: { colors: ['#e8eef2', '#d9e4ea', '#f2f4f2'], size: [0.18, 0.27], count: [14, 26], metal: 0.65 },
  reef: { colors: ['#ffe14a', '#4a8cff', '#ff9a40', '#ffffff', '#a070ff', '#3fe0cc'], size: [0.2, 0.36], count: [6, 12], metal: 0.15 },
};

export class Fish {
  constructor() {
    const geo = fishGeometry();
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aPhase', this.phase);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    this.time = { value: 0 };
    // fade into the water like everything else under it, and swing the tail
    addUnderwaterFog(this.material);
    const fog = this.material.onBeforeCompile;
    this.material.onBeforeCompile = (shader, r) => {
      fog(shader, r);
      shader.uniforms.uFishTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uFishTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float tailK = smoothstep(0.35, -0.5, position.z);
          transformed.x += sin(uFishTime * (10.0 + aPhase * 4.0) + aPhase * 6.28 - position.z * 6.0) * (0.015 + 0.11 * tailK * tailK);`,
        );
    };
    this.material.customProgramCacheKey = () => 'fish';
    this.fish = []; // { school, off: Vector3, size, wob, phase }
    this.school = null; // { pos, vel, life, kind }
    this.cool = 0;
    this.wasUnder = false;
  }

  // kind: the spot's fish ('bait', 'reef') or null for none
  setKind(kind) {
    this.kind = KINDS[kind] ? kind : null;
    this.school = null;
    this.mesh.count = 0;
  }

  // A school, somewhere ahead of the camera and below the surface, swimming across.
  spawn(cam, look, waterY, bedY) {
    const K = KINDS[this.kind];
    const R = Math.random;
    _v.set(look.x, 0, look.z);
    if (_v.lengthSq() < 1e-4) _v.set(0, 0, -1);
    _v.normalize();
    const dist = 2.6 + R() * 1.8;
    const side = (R() - 0.5) * 3;
    const pos = new THREE.Vector3(cam.x + _v.x * dist - _v.z * side, 0, cam.z + _v.z * dist + _v.x * side);
    const top = waterY(pos.x, pos.z) - 0.9,
      bot = bedY(pos.x, pos.z) + 0.5;
    if (top - bot < 0.6) return false; // too shallow here
    pos.y = Math.min(top, Math.max(bot, cam.y - 0.6 - R() * 1.6));
    // across the view, either way, angled a little
    const dir = R() < 0.5 ? 1 : -1;
    const a = Math.atan2(_v.x, _v.z) + dir * (Math.PI / 2) + (R() - 0.5) * 0.7;
    const speed = 0.7 + R() * 0.5;
    this.school = { pos, vel: new THREE.Vector3(Math.sin(a) * speed, 0, Math.cos(a) * speed), life: 25, top, bot };
    const n = Math.min(MAX, Math.round(K.count[0] + R() * (K.count[1] - K.count[0])));
    const size = K.size[0] + R() * (K.size[1] - K.size[0]);
    this.fish = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // a loose ball, longer along the way they swim
      const off = new THREE.Vector3((R() - 0.5) * 2.4, (R() - 0.5) * 0.9, (R() - 0.5) * 1.6);
      this.fish.push({ off, size: size * (0.8 + R() * 0.4), wob: R() * 10, heading: new THREE.Vector3().copy(this.school.vel).normalize(), flee: new THREE.Vector3() });
      this.phase.array[i] = R();
      c.set(K.colors[Math.floor(R() * K.colors.length)]).convertSRGBToLinear();
      this.mesh.setColorAt(i, c);
    }
    this.phase.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.material.metalness = K.metal;
    this.mesh.count = n;
    return true;
  }

  // under: is the camera under the water; look: its forward direction
  update(dt, under, cam, look, waterY, bedY) {
    this.time.value += dt;
    this.cool = Math.max(0, this.cool - dt);
    // going under sometimes brings a school past (not every time, and not straight after)
    if (under && !this.wasUnder && this.kind && this.cool <= 0 && (!this.school || this.school.pos.distanceTo(cam) > 14)) {
      if (Math.random() < 0.6 && this.spawn(cam, look, waterY, bedY)) this.cool = 6;
      else this.cool = 2;
    }
    this.wasUnder = under;
    const S = this.school;
    this.mesh.visible = under && !!S;
    if (!S) return;
    S.life -= dt;
    if (S.life <= 0 || S.pos.distanceTo(cam) > 40) {
      this.school = null;
      this.mesh.count = 0;
      return;
    }
    S.pos.addScaledVector(S.vel, dt);
    S.pos.y = Math.min(S.top, Math.max(S.bot, S.pos.y));
    const t = this.time.value;
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      // each fish weaves about its place in the school...
      _p.copy(f.off);
      _p.x += Math.sin(t * 0.9 + f.wob) * 0.25;
      _p.y += Math.sin(t * 0.7 + f.wob * 1.3) * 0.12;
      _p.z += Math.sin(t * 0.8 + f.wob * 0.7) * 0.25;
      // (the school's frame: z along the way it swims)
      const yaw = Math.atan2(S.vel.x, S.vel.z);
      _p.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(S.pos);
      // ...and darts away from you if you come close
      _v.subVectors(_p, cam);
      const d = _v.length();
      if (d < 1.6) f.flee.addScaledVector(_v.normalize(), (1.6 - d) * dt * 6);
      f.flee.multiplyScalar(Math.exp(-dt * 0.6));
      _p.add(f.flee);
      // face the way it's going
      _v.copy(S.vel).normalize();
      _v.x += Math.cos(t * 0.9 + f.wob) * 0.2;
      _v.addScaledVector(f.flee, 0.8).normalize();
      f.heading.lerp(_v, 1 - Math.exp(-dt * 4)).normalize();
      _q.setFromUnitVectors(FWD, f.heading);
      _m.compose(_p, _q, _s.setScalar(f.size));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
