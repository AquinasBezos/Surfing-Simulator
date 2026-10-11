// Other surfers: a board plus a low-poly wetsuit figure posed procedurally from a few
// numbers (state, crouch, lean, stance position, paddling effort). Every body part of
// every avatar is one instance of a single ellipsoid mesh, so all bodies cost one draw call.
// Network snapshots are buffered and interpolated on the shared room clock.
import * as THREE from 'three';
import { createBoard } from './board.js';
import { BOARDS } from './config.js';

export const POSE = { PRONE: 0, POPUP: 1, STANDING: 2, WIPEOUT: 3 };
const MAX_PLAYERS = 16;
const PARTS = 16;
const DELAY = 0.15; // render this far behind the newest snapshot (s)

const SUIT = new THREE.Color('#15181b');
const SKINS = ['#c08465', '#8d5a3b', '#e0ac8a', '#6b4430', '#d49a74'].map((c) => new THREE.Color(c));
const HAIRS = ['#2a1d14', '#5b3a1e', '#c9a25a', '#141414', '#7a3b1e'].map((c) => new THREE.Color(c));
const ACCENTS = ['#2f80c8', '#d2553a', '#e3b23c', '#1aa59a', '#8b5cc4', '#e06b9a', '#4caf50', '#f08a24'].map((c) => new THREE.Color(c));

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Two-bone IK: elbow/knee position for root -> end with segment lengths l1, l2.
function ik(root, end, l1, l2, pole, out) {
  const d = _a.subVectors(end, root);
  let len = d.length();
  const dir = d.divideScalar(len || 1);
  len = Math.min(Math.max(len, 0.05), l1 + l2 - 1e-3);
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len);
  const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const p = _b.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(root).addScaledVector(dir, Math.cos(ang) * l1).addScaledVector(p, Math.sin(ang) * l1);
}

const J = () => new THREE.Vector3();
const jointNames = ['pelvis', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'hipL', 'hipR', 'knL', 'knR', 'ftL', 'ftR'];
const makeJoints = () => Object.fromEntries(jointNames.map((n) => [n, J()]));

// Lying on the board, paddling. z0 shifts the body back on longer boards.
function pronePose(j, t, effort, dive, z0) {
  j.pelvis.set(0, 0.15, 0.48 + z0);
  j.neck.set(0, 0.24 - dive * 0.08, -0.05 + z0);
  j.head.set(0, 0.35 - dive * 0.12, -0.17 + z0);
  j.shL.set(-0.19, 0.21 - dive * 0.08, 0.0 + z0);
  j.shR.set(0.19, 0.21 - dive * 0.08, 0.0 + z0);
  for (const [side, key, ph] of [[-1, 'haL', 0], [1, 'haR', 0.5]]) {
    const h = j[key];
    if (dive > 0.5) {
      h.set(0.22 * side, 0.07, -0.5 + z0);
    } else if (effort > 0.05) {
      const p = (t * (1 / Math.max(0.5, 1.15 - 0.63 * effort)) + ph) % 1;
      if (p < 0.55) {
        const q = p / 0.55;
        h.set((0.3 + 0.04 * q) * side, -0.04 - 0.24 * Math.sin(Math.PI * q), -0.55 + 1.0 * q + z0);
      } else {
        const q = (p - 0.55) / 0.45;
        h.set((0.36 + 0.08 * Math.sin(Math.PI * q)) * side, 0.1 + 0.25 * Math.sin(Math.PI * q), 0.45 - 1.0 * (0.5 - 0.5 * Math.cos(Math.PI * q)) + z0);
      }
    } else {
      h.set(0.27 * side, 0.1, -0.2 + z0 + Math.sin(t * 1.3 + side) * 0.02);
    }
  }
  j.hipL.set(-0.1, 0.13, 0.55 + z0);
  j.hipR.set(0.1, 0.13, 0.55 + z0);
  const kick = effort > 0.05 ? Math.sin(t * 6) * 0.04 : 0;
  j.ftL.set(-0.14, 0.12 + kick, 1.4 + z0);
  j.ftR.set(0.14, 0.12 - kick, 1.4 + z0);
}

// Standing sideways (left foot forward), chest toward the board's right side.
function standPose(j, t, crouch, lean, foot) {
  const f = -foot;
  const c = crouch;
  j.ftL.set(0.03, 0.12, -0.27 + f);
  j.ftR.set(0.03, 0.12, 0.38 + f);
  j.pelvis.set(-0.08 * c + 0.06 * lean, 0.98 - 0.42 * c, 0.05 + f);
  j.neck.set(0.03 + 0.2 * c + 0.12 * lean, j.pelvis.y + 0.5 - 0.06 * c, 0.0 + f);
  j.head.set(j.neck.x + 0.03, j.neck.y + 0.13, j.neck.z - 0.04);
  j.shL.set(j.neck.x, j.neck.y - 0.05, j.neck.z - 0.17);
  j.shR.set(j.neck.x, j.neck.y - 0.05, j.neck.z + 0.17);
  const raise = 0.15 * Math.abs(lean) + 0.03 * Math.sin(t * 2.1);
  j.haL.set(j.shL.x + 0.2, j.shL.y - 0.22 + raise, j.shL.z - 0.32);
  j.haR.set(j.shR.x + 0.05, j.shR.y - 0.36 + raise * 0.6, j.shR.z + 0.24);
  j.hipL.set(j.pelvis.x, j.pelvis.y - 0.04, j.pelvis.z - 0.1);
  j.hipR.set(j.pelvis.x, j.pelvis.y - 0.04, j.pelvis.z + 0.1);
}

class Avatar {
  constructor(id, index, parent) {
    this.id = id;
    this.index = index;
    this.name = '';
    this.boardType = '';
    this.root = new THREE.Group();
    parent.add(this.root);
    this.board = null;
    this.snaps = [];
    this.pose = makeJoints();
    this.prone = makeJoints();
    this.stand = makeJoints();
    this.blend = 0; // 0 prone .. 1 standing
    this.visible = false;
    this.lastSeen = 0;
    const h = hashStr(id);
    this.skin = SKINS[h % SKINS.length];
    this.hair = HAIRS[(h >>> 3) % HAIRS.length];
    this.accent = ACCENTS[(h >>> 6) % ACCENTS.length];
    this.tag = null;
    this.cur = { x: 0, y: 0, z: 0, q: new THREE.Quaternion(), state: 0, crouch: 0, foot: 0, lean: 0, effort: 0, dive: 0 };
  }

  setBoard(type) {
    if (this.boardType === type) return;
    this.boardType = type;
    if (this.board) {
      this.root.remove(this.board);
      this.board.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.board = createBoard(type);
    this.root.add(this.board);
  }

  setName(name) {
    if (this.name === name && this.tag) return;
    this.name = name;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    g.font = '600 54px Outfit, system-ui, sans-serif';
    const w = Math.min(500, g.measureText(name).width + 56);
    g.fillStyle = 'rgba(10, 24, 32, 0.62)';
    g.beginPath();
    g.roundRect((512 - w) / 2, 22, w, 84, 42);
    g.fill();
    g.fillStyle = '#' + this.accent.getHexString();
    g.beginPath();
    g.arc((512 - w) / 2 + 30, 64, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, 256 + 10, 66, 440);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (this.tag) {
      this.tag.material.map.dispose();
      this.tag.material.map = tex;
      this.tag.material.needsUpdate = true;
    } else {
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
      this.tag.renderOrder = 20;
      this.tag.center.set(0.5, 0);
      this.root.parent.add(this.tag);
    }
  }

  push(s) {
    const a = this.snaps;
    if (a.length && s.t <= a[a.length - 1].t) return; // out of order / duplicate
    a.push(s);
    if (a.length > 40) a.shift();
  }

  // Interpolate the snapshot stream at time t into this.cur. Returns false when stale.
  sample(t) {
    const a = this.snaps;
    if (!a.length) return false;
    const c = this.cur;
    const last = a[a.length - 1];
    if (t - last.t > 3) return false;
    let i = a.length - 1;
    while (i > 0 && a[i - 1].t > t) i--;
    const s1 = a[i];
    const s0 = i > 0 ? a[i - 1] : s1;
    let k = 0;
    if (t >= last.t) {
      // brief extrapolation from the last two snapshots
      const p = a.length > 1 ? a[a.length - 2] : last;
      const dt = Math.min(t - last.t, 0.3);
      const span = Math.max(1e-3, last.t - p.t);
      c.x = last.x + ((last.x - p.x) / span) * dt;
      c.y = last.y + ((last.y - p.y) / span) * dt;
      c.z = last.z + ((last.z - p.z) / span) * dt;
      c.q.set(last.qx, last.qy, last.qz, last.qw);
      Object.assign(c, { state: last.state, crouch: last.crouch, foot: last.foot, lean: last.lean, effort: last.effort, dive: last.dive });
      return true;
    }
    if (s1 !== s0) k = Math.min(1, Math.max(0, (t - s0.t) / (s1.t - s0.t)));
    c.x = s0.x + (s1.x - s0.x) * k;
    c.y = s0.y + (s1.y - s0.y) * k;
    c.z = s0.z + (s1.z - s0.z) * k;
    c.q.set(s0.qx, s0.qy, s0.qz, s0.qw).slerp(_q.set(s1.qx, s1.qy, s1.qz, s1.qw), k);
    const n = k < 0.5 ? s0 : s1;
    c.state = n.state;
    c.crouch = s0.crouch + (s1.crouch - s0.crouch) * k;
    c.foot = s0.foot + (s1.foot - s0.foot) * k;
    c.lean = s0.lean + (s1.lean - s0.lean) * k;
    c.effort = n.effort;
    c.dive = s0.dive + (s1.dive - s0.dive) * k;
    return true;
  }

  dispose() {
    if (this.board) this.board.traverse((o) => o.geometry && o.geometry.dispose());
    this.root.parent.remove(this.root);
    if (this.tag) {
      this.tag.material.map.dispose();
      this.tag.material.dispose();
      this.tag.parent.remove(this.tag);
    }
  }
}

export class RemotePlayers {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.avatars = new Map();
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
    this.bodies = new THREE.InstancedMesh(geo, mat, MAX_PLAYERS * PARTS);
    this.bodies.count = 0;
    this.bodies.frustumCulled = false;
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.setColorAt(0, SUIT);
    this.group.add(this.bodies);
    this._slot = 0;
  }

  get size() {
    return this.avatars.size;
  }

  ensure(id) {
    let a = this.avatars.get(id);
    if (!a) {
      if (this.avatars.size >= MAX_PLAYERS) return null;
      a = new Avatar(id, this._slot++, this.group);
      a.setBoard('shortboard');
      a.setName('Surfer');
      this.avatars.set(id, a);
    }
    return a;
  }

  setInfo(id, { name, board }) {
    const a = this.ensure(id);
    if (!a) return;
    if (name) a.setName(name);
    if (board && BOARDS[board]) a.setBoard(board);
  }

  // snapshot: {t, x, y, z, qx, qy, qz, qw, state, crouch, foot, lean, effort, dive}
  push(id, snap) {
    const a = this.ensure(id);
    if (a) a.push(snap);
  }

  remove(id) {
    const a = this.avatars.get(id);
    if (!a) return;
    a.dispose();
    this.avatars.delete(id);
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
    this.bodies.count = 0;
  }

  // Position of an avatar (for effects); null if not visible
  positionOf(id) {
    const a = this.avatars.get(id);
    return a && a.visible ? a.root.position : null;
  }

  update(now, camPos, dt) {
    let n = 0;
    const mtx = this.bodies.instanceMatrix.array;
    for (const a of this.avatars.values()) {
      const ok = a.sample(now - DELAY);
      a.visible = ok;
      a.root.visible = ok;
      if (a.tag) a.tag.visible = ok;
      if (!ok) continue;
      const c = a.cur;
      a.root.position.set(c.x, c.y, c.z);
      a.root.quaternion.copy(c.q);
      a.root.updateMatrixWorld(true);
      // tumbling board, no rider, during a wipeout
      if (c.state === POSE.WIPEOUT) {
        if (a.tag) a.tag.position.set(c.x, c.y + 1.2, c.z);
        continue;
      }
      const target = c.state === POSE.STANDING ? 1 : c.state === POSE.POPUP ? 0.6 : 0;
      a.blend += (target - a.blend) * (1 - Math.exp(-dt * 7));
      const t = now + a.index * 1.7;
      const B = BOARDS[a.boardType] || BOARDS.shortboard;
      pronePose(a.prone, t, c.effort, Math.min(1, c.dive / 0.5), B.proneEyeZ - 0.3);
      standPose(a.stand, t, c.crouch, c.lean, c.foot);
      const p = a.pose;
      for (const k of jointNames) p[k].lerpVectors(a.prone[k], a.stand[k], a.blend);
      // elbows & knees
      const st = a.blend;
      ik(p.shL, p.haL, 0.29, 0.27, _c.set(-0.4 * (1 - st) - 0.2 * st, 0.6 - 1.4 * st, 0.4 - 0.3 * st), p.elL);
      ik(p.shR, p.haR, 0.29, 0.27, _c.set(0.4 * (1 - st) - 0.2 * st, 0.6 - 1.4 * st, 0.4 + 0.3 * st), p.elR);
      ik(p.hipL, p.ftL, 0.45, 0.44, _c.set(0.15 * st, 1 - st, 0.0 - st * 0.1), p.knL);
      ik(p.hipR, p.ftR, 0.45, 0.44, _c.set(0.15 * st + (1 - st) * 0.0, 1 - st, 0.1 * st), p.knR);
      const W = a.root.matrixWorld;
      const put = (A, B, r, col, rz = r, xAxis = null) => {
        if (n >= MAX_PLAYERS * PARTS) return;
        const dir = _d.subVectors(B, A);
        const len = dir.length();
        const yv = dir.divideScalar(len || 1);
        if (xAxis) {
          const x = _a.copy(xAxis).addScaledVector(yv, -xAxis.dot(yv)).normalize();
          const z = _b.crossVectors(x, yv);
          _m.makeBasis(x, yv, z);
          _q.setFromRotationMatrix(_m);
        } else _q.setFromUnitVectors(UP, yv);
        _c.addVectors(A, B).multiplyScalar(0.5);
        _s.set(r, len * 0.5 + r * 0.35, rz);
        _m.compose(_c, _q, _s);
        _m2.multiplyMatrices(W, _m);
        _m2.toArray(mtx, n * 16);
        this.bodies.setColorAt(n, col);
        n++;
      };
      const ball = (P, r, col, sy = r) => {
        if (n >= MAX_PLAYERS * PARTS) return;
        _m.compose(P, _q.identity(), _s.set(r, sy, r));
        _m2.multiplyMatrices(W, _m);
        _m2.toArray(mtx, n * 16);
        this.bodies.setColorAt(n, col);
        n++;
      };
      const shoulderAxis = _d.subVectors(p.shR, p.shL).clone();
      put(p.pelvis, p.neck, 0.16, a.accent, 0.11, shoulderAxis);
      put(p.hipL, p.hipR, 0.13, SUIT);
      ball(p.head, 0.105, a.skin, 0.115);
      ball(_c.copy(p.head).add(_d.set(0, 0.035, 0.01)), 0.108, a.hair, 0.09);
      put(p.shL, p.elL, 0.05, SUIT);
      put(p.elL, p.haL, 0.042, SUIT);
      put(p.shR, p.elR, 0.05, SUIT);
      put(p.elR, p.haR, 0.042, SUIT);
      ball(p.haL, 0.045, a.skin, 0.03);
      ball(p.haR, 0.045, a.skin, 0.03);
      put(p.hipL, p.knL, 0.07, SUIT);
      put(p.knL, p.ftL, 0.055, SUIT);
      put(p.hipR, p.knR, 0.07, SUIT);
      put(p.knR, p.ftR, 0.055, SUIT);
      ball(_c.copy(p.ftL).add(_d.set(0.05 * st, -0.05, -0.03 * (1 - st))), 0.05, a.skin, 0.03);
      ball(_c.copy(p.ftR).add(_d.set(0.05 * st, -0.05, -0.03 * (1 - st))), 0.05, a.skin, 0.03);
      if (a.tag) {
        const top = _c.copy(p.head).applyMatrix4(W);
        const dist = camPos.distanceTo(top);
        a.tag.position.set(top.x, top.y + 0.25, top.z);
        const s = Math.min(3, Math.max(0.32, dist * 0.04));
        a.tag.scale.set(s * 4, s, 1);
        a.tag.material.opacity = 1 - Math.min(1, Math.max(0, (dist - 120) / 60));
      }
    }
    this.bodies.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }
}
