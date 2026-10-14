// First-person arms (PC, mobile and VR): the character's own arms, lifted out of surfer.glb.
// Every skin triangle that belongs to an arm (upper arm, forearm, hand) is copied into one
// skinned mesh with a skeleton of just those bones, so each arm can be placed anywhere (a
// shoulder point, a wrist and a hand orientation) and solved with two-bone IK. The cut at the
// top of the upper arm is behind or beside the camera.
import * as THREE from 'three';

const ARM_BONES = ['UpperArm', 'LowerArm', 'Hand'];
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _e = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _wr = new THREE.Vector3();

// world rotation that turns a bone's rest frame (arm axis `a`, palm normal -y) into one with
// the arm axis along `dir` and the palm normal along `palm` (both world, need not be unit)
function frameQuat(out, a, dir, palm) {
  _x.copy(dir).normalize();
  _n.copy(palm).addScaledVector(_x, -palm.dot(_x));
  if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0).addScaledVector(_x, _x.y);
  _n.normalize();
  _m.makeBasis(_x, _n, _f.crossVectors(_x, _n));
  const restN = _e.set(0, -1, 0);
  _m2.makeBasis(a, restN, _w.crossVectors(a, restN));
  _m2.transpose();
  return out.setFromRotationMatrix(_m.multiply(_m2));
}

export class ArmRig {
  // gltf: from loadSurferModel(); material: what the skin looks like (its colour follows your look)
  constructor(gltf, material) {
    gltf.scene.updateMatrixWorld(true);
    let src = null;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh && (!src || (o.material && o.material.name === 'Skin'))) src = o;
    });
    const sb = src.skeleton.bones;
    const sides = { L: 'Left', R: 'Right' };
    // new bone index for each source bone: the arm's own three, the rest of the body to the
    // upper arm of the nearer side
    this.bones = [];
    const inverses = [];
    const map = new Map();
    this.arm = {};
    for (const [k, name] of Object.entries(sides)) {
      const chain = ARM_BONES.map((b) => sb.find((x) => x.name === name + b));
      const bones = chain.map((b) => {
        const nb = new THREE.Bone();
        nb.name = `fp${b.name}`;
        return nb;
      });
      bones[0].add(bones[1]);
      bones[1].add(bones[2]);
      chain.forEach((b, i) => {
        map.set(sb.indexOf(b), this.bones.length);
        this.bones.push(bones[i]);
        inverses.push(b.matrixWorld.clone().invert());
        if (i) bones[i].position.copy(b.position);
      });
      const s = k === 'L' ? 1 : -1; // (the model's left arm points along +x)
      this.arm[k] = {
        bones,
        axis: new THREE.Vector3(s, 0, 0),
        L1: chain[1].position.length(),
        L2: chain[2].position.length(),
        rest1: chain[1].position.clone(),
        rest2: chain[2].position.clone(),
        root: sb.indexOf(chain[0]),
      };
    }
    // copy the arm triangles
    const g = src.geometry;
    const pos = g.attributes.position,
      nor = g.attributes.normal,
      uv = g.attributes.uv,
      si = g.attributes.skinIndex,
      sw = g.attributes.skinWeight;
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const armWeight = (v) => {
      let L = 0,
        R = 0;
      for (let c = 0; c < 4; c++) {
        const b = sb[si.getComponent(v, c)],
          w = sw.getComponent(v, c);
        if (!b || !map.has(si.getComponent(v, c))) continue;
        if (b.name.startsWith('Left')) L += w;
        else R += w;
      }
      return [L, R];
    };
    const keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const ws = [idx[t], idx[t + 1], idx[t + 2]].map(armWeight);
      if (ws.every((w) => w[0] > 0.45) || ws.every((w) => w[1] > 0.45)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const remap = new Map();
    const P = [],
      N = [],
      U = [],
      SI = [],
      SW = [],
      I = [];
    src.updateMatrixWorld(true);
    for (const v of keep) {
      if (!remap.has(v)) {
        remap.set(v, P.length / 3);
        _v.fromBufferAttribute(pos, v).applyMatrix4(src.matrixWorld);
        P.push(_v.x, _v.y, _v.z);
        if (nor) {
          _v.fromBufferAttribute(nor, v);
          N.push(_v.x, _v.y, _v.z);
        }
        if (uv) U.push(uv.getX(v), uv.getY(v));
        // weights onto this skeleton: other bones go to the upper arm of the side the vertex is on
        const side = armWeight(v)[0] >= armWeight(v)[1] ? 'L' : 'R';
        const acc = new Map();
        for (let c = 0; c < 4; c++) {
          const w = sw.getComponent(v, c);
          if (!w) continue;
          const j = map.has(si.getComponent(v, c)) ? map.get(si.getComponent(v, c)) : map.get(this.arm[side].root);
          acc.set(j, (acc.get(j) || 0) + w);
        }
        const e = [...acc.entries()].slice(0, 4);
        const tot = e.reduce((a, [, w]) => a + w, 0) || 1;
        for (let c = 0; c < 4; c++) {
          SI.push(e[c] ? e[c][0] : 0);
          SW.push(e[c] ? e[c][1] / tot : 0);
        }
      }
      I.push(remap.get(v));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (N.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    else geo.computeVertexNormals();
    if (U.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    geo.setIndex(I);
    // one group at the world origin holds the mesh and the bones (posed in world space)
    this.group = new THREE.Group();
    this.mesh = new THREE.SkinnedMesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.uwSkinned = true; // (underwater.js: seen through the water too)
    for (const k of ['L', 'R']) this.group.add(this.arm[k].bones[0]);
    this.group.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones, inverses), new THREE.Matrix4());
  }

  set visible(v) {
    this.group.visible = v;
  }
  get visible() {
    return this.group.visible;
  }

  // Place one arm (side -1 left, +1 right, as you see them), all in world space: the shoulder,
  // the wrist, which way the fingers point and the palm faces, and which way the elbow
  // should point. Reaches a little further than the arm if it has to.
  pose(side, shoulder, wrist, fingers, palm, pole) {
    const A = this.arm[side < 0 ? 'L' : 'R'];
    const [u, l, hand] = A.bones;
    _d.subVectors(wrist, shoulder);
    let dist = _d.length();
    _d.divideScalar(dist || 1);
    const reach = A.L1 + A.L2;
    const st = Math.min(1.25, Math.max(1, dist / (reach * 0.985)));
    l.position.copy(A.rest1).multiplyScalar(st);
    hand.position.copy(A.rest2).multiplyScalar(st);
    const L1 = A.L1 * st,
      L2 = A.L2 * st;
    dist = Math.min(Math.max(dist, Math.abs(L1 - L2) + 0.02), L1 + L2 - 0.001);
    const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
    const elbow = _v.copy(shoulder).addScaledVector(_d, cosA * L1).addScaledVector(_p, sinA * L1);
    const wr = _wr.copy(shoulder).addScaledVector(_d, dist); // (not _w: frameQuat uses that)
    // palm normals along the arm, untwisting from the hand back up (no candy-wrapping)
    const fore = new THREE.Vector3().subVectors(wr, elbow);
    const up = new THREE.Vector3().subVectors(elbow, shoulder);
    const pf = palm.clone().addScaledVector(fore.clone().normalize(), -palm.dot(fore) / fore.lengthSq());
    const pu = pf.clone().addScaledVector(up.clone().normalize(), -pf.dot(up) / up.lengthSq());
    // upper arm
    u.position.copy(shoulder);
    frameQuat(u.quaternion, A.axis, up, pu);
    u.updateMatrixWorld(true);
    // forearm: its world rotation, as a local one under the upper arm
    frameQuat(_q, A.axis, fore, pf);
    l.quaternion.copy(_q2.copy(u.quaternion).invert().multiply(_q));
    // hand
    frameQuat(_q2, A.axis, fingers, palm);
    hand.quaternion.copy(_q.invert().multiply(_q2));
    u.updateMatrixWorld(true);
  }
}
