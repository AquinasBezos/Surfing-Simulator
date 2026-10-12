// Other players. Surfers are the rigged character (character.js) on a board in their own
// colours, posed from a few numbers per snapshot (state, crouch, lean, stance position,
// paddling effort). Spectators flying camera drones send a DRONE pose instead and show up
// as a quadcopter. Network snapshots are buffered and interpolated on the shared room clock.
import * as THREE from 'three';
import { createBoard } from './board.js';
import { BOARDS } from './config.js';
import { createDroneModel, animateDrone } from './drone.js';
import { SurferCharacter, loadSurferModel, cleanLook } from './character.js';

// for a DRONE pose the snapshot's crouch is the gimbal pitch and effort the throttle
export const POSE = { PRONE: 0, POPUP: 1, STANDING: 2, WIPEOUT: 3, DRONE: 4, SITTING: 5 };
const MAX_PLAYERS = 16;
const DELAY = 0.15; // render this far behind the newest snapshot (s)

const ACCENTS = ['#2f80c8', '#d2553a', '#e3b23c', '#1aa59a', '#8b5cc4', '#e06b9a', '#4caf50', '#f08a24'].map((c) => new THREE.Color(c));
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Avatar {
  constructor(id, index, parent) {
    this.id = id;
    this.index = index;
    this.name = '';
    this.boardType = '';
    this.boardColor = '';
    this.root = new THREE.Group();
    parent.add(this.root);
    this.board = null;
    this.character = null; // made once the model has loaded
    this.look = cleanLook(null);
    this.snaps = [];
    this.visible = false;
    this.accent = ACCENTS[(hashStr(id) >>> 6) % ACCENTS.length];
    this.tag = null;
    this.drone = null; // quadcopter model, made the first time they fly one
    this.cur = { x: 0, y: 0, z: 0, q: new THREE.Quaternion(), state: 0, crouch: 0, foot: 0, lean: 0, effort: 0, dive: 0, lookYaw: 0, lookPitch: 0 };
  }

  setBoard(type, color = this.look.board) {
    if (this.boardType === type && this.boardColor === color) return;
    this.boardType = type;
    this.boardColor = color;
    if (this.board) {
      this.root.remove(this.board);
      this.board.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map) o.material.map.dispose();
      });
    }
    this.board = createBoard(type, color);
    this.root.add(this.board);
  }

  setLook(look) {
    this.look = cleanLook(look);
    if (this.character) this.character.setLook(this.look);
    this.setBoard(this.boardType || 'shortboard', this.look.board);
  }

  ensureCharacter(gltf) {
    if (this.character || !gltf) return;
    this.character = new SurferCharacter(gltf);
    this.character.setLook(this.look);
    this.root.add(this.character.root);
  }

  // show the drone or the surfer
  setDrone(on) {
    if (on && !this.drone) {
      this.drone = createDroneModel(this.accent);
      this.root.add(this.drone);
    }
    if (this.drone) this.drone.visible = on;
    if (this.board) this.board.visible = !on;
    if (this.character) this.character.root.visible = !on;
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
      Object.assign(c, { state: last.state, crouch: last.crouch, foot: last.foot, lean: last.lean, effort: last.effort, dive: last.dive, lookYaw: last.lookYaw || 0, lookPitch: last.lookPitch || 0 });
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
    const dy = Math.atan2(Math.sin((s1.lookYaw || 0) - (s0.lookYaw || 0)), Math.cos((s1.lookYaw || 0) - (s0.lookYaw || 0)));
    c.lookYaw = (s0.lookYaw || 0) + dy * k;
    c.lookPitch = (s0.lookPitch || 0) + ((s1.lookPitch || 0) - (s0.lookPitch || 0)) * k;
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
    this._slot = 0;
    this.gltf = null;
    loadSurferModel()
      .then((g) => (this.gltf = g))
      .catch((e) => console.warn('LINEUP: could not load the surfer model', e));
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

  setInfo(id, { name, board, look }) {
    const a = this.ensure(id);
    if (!a) return;
    if (name) a.setName(name);
    if (look) a.setLook(look);
    if (board && BOARDS[board]) a.setBoard(board);
  }

  // snapshot: {t, x, y, z, qx, qy, qz, qw, state, crouch, foot, lean, effort, dive, lookYaw, lookPitch}
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
  }

  // Position of an avatar (for effects); null if not visible
  positionOf(id) {
    const a = this.avatars.get(id);
    return a && a.visible ? a.root.position : null;
  }

  // How loud the other drones are here: { level 0..1, throttle } of the loudest
  droneSound(camPos) {
    let level = 0,
      throttle = 0;
    for (const a of this.avatars.values()) {
      if (!a.visible || a.cur.state !== POSE.DRONE) continue;
      const d = camPos.distanceTo(a.root.position);
      const l = 4 / (4 + d * d * 0.15);
      if (l > level) {
        level = l;
        throttle = a.cur.effort;
      }
    }
    return { level, throttle };
  }

  update(now, camPos, dt) {
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
      a.ensureCharacter(this.gltf);
      a.setDrone(c.state === POSE.DRONE);
      let top = null;
      if (c.state === POSE.DRONE) {
        animateDrone(a.drone, dt, c.effort, c.crouch, c.q, _eul.setFromQuaternion(c.q, 'YXZ').y);
        top = _v.set(c.x, c.y + 0.22, c.z);
      } else if (a.character) {
        // tumbling board, no rider, during a wipeout
        const ch = a.character;
        ch.root.visible = c.state !== POSE.WIPEOUT;
        if (ch.root.visible) {
          const B = BOARDS[a.boardType] || BOARDS.shortboard;
          ch.update(dt, {
            pose: c.state === POSE.STANDING || c.state === POSE.POPUP ? 'stand' : c.state === POSE.SITTING ? 'sit' : 'prone',
            effort: c.effort,
            crouch: c.crouch,
            lean: c.lean,
            foot: c.foot,
            proneZ: 0.42 + (B.proneEyeZ - 0.3),
            lookYaw: c.lookYaw,
            lookPitch: c.lookPitch,
          });
          top = ch.bones.Head.getWorldPosition(_v);
          top.y += 0.3;
        }
      }
      if (!top) top = _v.set(c.x, c.y + 1.2, c.z);
      if (a.tag) {
        const dist = camPos.distanceTo(top);
        const s = Math.min(3, Math.max(0.32, dist * 0.04));
        a.tag.position.copy(top);
        a.tag.scale.set(s * 4, s, 1);
        a.tag.material.opacity = 1 - Math.min(1, Math.max(0, (dist - 120) / 60));
      }
    }
  }
}
