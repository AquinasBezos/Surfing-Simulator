// The player character: assets/surfer.glb, a rigged low-poly surfer (19-bone humanoid,
// boardshorts) with Idle / Walk / Run / Surf / Paddle clips. Every instance gets its own
// skeleton and its own skin and hair materials, so everyone can look different, and is
// posed from the game state:
//   lying down : the Paddle clip, sped up with paddling effort
//   up         : the Surf clip (crossfaded through the pop-up), with crouch and rail lean
//                added by moving the hips and re-solving the legs (two-bone IK) so the
//                feet stay planted on the deck; on a longboard the stance slides along it
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// ---------------------------------------------------------------- looks
export const SKIN_TONES = ['#f3cdb0', '#e2b08b', '#c88f66', '#a86f49', '#7b4a2e', '#4d2c1b'];
export const HAIR_COLORS = ['#16100c', '#3b2416', '#6e4527', '#8e3f1c', '#d6b26a', '#efe3c0', '#2f5d8a', '#c2547a'];
export const BOARD_COLORS = ['#f7f6f1', '#f3e6c6', '#8fd0ee', '#1aa59a', '#f2c94c', '#f08a24', '#d2553a', '#e06b9a', '#8b5cc4', '#30353a'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const HEX = /^#[0-9a-f]{6}$/i;

export function randomLook() {
  return { skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS), board: pick(BOARD_COLORS) };
}

// Accept any #rrggbb colours (from storage or other players); fill gaps at random.
export function cleanLook(l) {
  const r = randomLook();
  const ok = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  return { skin: ok(l && l.skin, r.skin), hair: ok(l && l.hair, r.hair), board: ok(l && l.board, r.board) };
}

// ---------------------------------------------------------------- loading
let loading = null;
export function loadSurferModel() {
  loading ||= new GLTFLoader().loadAsync('assets/surfer.glb').then((gltf) => {
    gltf.scene.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned bounds don't follow the poses
    });
    return gltf;
  });
  return loading;
}

// ---------------------------------------------------------------- posing
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// rotate a bone by a world-space rotation q (about its own origin)
function rotateWorld(bone, q) {
  bone.parent.getWorldQuaternion(_q2);
  _qInv.copy(_q2).invert();
  bone.quaternion.premultiply(_q2).premultiply(q).premultiply(_qInv);
  bone.updateMatrixWorld(true);
}

// Two-bone IK: turn upper / lower so that the end (whose world rotation is kept) reaches
// target, keeping the bend in the plane it already bends in.
function solveTwoBone(upper, lower, end, target) {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const endQ = end.getWorldQuaternion(new THREE.Quaternion());
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  const dist = THREE.MathUtils.clamp(a.distanceTo(target), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  // 1) knee angle
  const ba = _v.subVectors(a, b).normalize();
  const bc = _v2.subVectors(c, b).normalize();
  const cur = Math.acos(THREE.MathUtils.clamp(ba.dot(bc), -1, 1));
  const want = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
  const axis = _v3.crossVectors(ba, bc);
  if (axis.lengthSq() > 1e-10) {
    axis.normalize();
    rotateWorld(lower, _q.setFromAxisAngle(axis, want - cur));
  }
  // 2) swing the whole leg onto the target
  const c2 = end.getWorldPosition(new THREE.Vector3());
  _q.setFromUnitVectors(_v.subVectors(c2, a).normalize(), _v2.subVectors(target, a).normalize());
  rotateWorld(upper, _q);
  // 3) keep the foot's own orientation
  end.parent.getWorldQuaternion(_q2);
  end.quaternion.copy(_q2.invert().multiply(endQ));
  end.updateMatrixWorld(true);
}

export class SurferCharacter {
  // gltf: from loadSurferModel(). The root is meant to sit in the board's frame (nose -z).
  constructor(gltf) {
    this.root = new THREE.Group();
    this.model = cloneSkinned(gltf.scene);
    this.model.rotation.y = Math.PI; // the model faces +z with its nose-end clips at +z
    this.root.add(this.model);
    this.bones = {};
    this.mats = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.material = o.material.clone();
        this.mats[o.material.name] = o.material;
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (name) => gltf.animations.find((a) => a.name === name);
    this.paddle = this.mixer.clipAction(clip('Paddle'));
    this.surf = this.mixer.clipAction(clip('Surf'));
    for (const a of [this.paddle, this.surf]) a.play();
    this.blend = 0; // 0 lying down .. 1 up
  }

  setLook({ skin, hair }) {
    if (skin && this.mats.Skin) this.mats.Skin.color.set(skin);
    if (hair && this.mats.Hair) this.mats.Hair.color.set(hair);
  }

  // p: { standing (0..1 target), effort, crouch, lean, foot, proneZ }
  update(dt, p) {
    this.blend += ((p.standing || 0) - this.blend) * (1 - Math.exp(-dt * 7));
    const up = THREE.MathUtils.smoothstep(this.blend, 0, 1);
    this.paddle.setEffectiveWeight(1 - up);
    this.surf.setEffectiveWeight(up);
    this.paddle.setEffectiveTimeScale(0.3 + (p.effort || 0) * 1.3);
    this.mixer.update(dt);
    // lying on the deck with the hips toward the tail; up, the stance slides with `foot`
    this.model.position.set(0, 0.035, THREE.MathUtils.lerp(p.proneZ ?? 0.42, -(p.foot || 0), up));
    this.model.updateMatrixWorld(true);
    if (up > 0.5) this.adjustStance(p, up);
  }

  // crouch and rail lean on top of the Surf clip, feet kept on the deck
  adjustStance(p, up) {
    const B = this.bones;
    const feet = [
      [B.LeftUpperLeg, B.LeftLowerLeg, B.LeftFoot],
      [B.RightUpperLeg, B.RightLowerLeg, B.RightFoot],
    ];
    const targets = feet.map(([, , f]) => f.getWorldPosition(new THREE.Vector3()));
    const hips = B.Hips;
    const k = up;
    // crouch: the clip is already bent; 0 stands a little taller, 1 is tucked low
    const crouch = THREE.MathUtils.clamp(p.crouch || 0, 0, 1);
    hips.position.y += (0.05 - 0.26 * crouch) * k;
    // lean toward the toes (+) or heels (-): hips shift that way, upper body tips
    const lean = THREE.MathUtils.clamp(p.lean || 0, -1, 1);
    hips.position.x -= 0.07 * lean * k; // (model space is turned round: -x here is toward the toes)
    hips.updateMatrixWorld(true);
    for (const [i, [u, l, f]] of feet.entries()) solveTwoBone(u, l, f, targets[i]);
    if (B.Spine && lean) {
      this.root.getWorldQuaternion(_q2);
      const axis = _v.copy(AXIS_Z).applyQuaternion(_q2); // along the board
      rotateWorld(B.Spine, _q.setFromAxisAngle(axis, -0.32 * lean * k));
    }
  }
}
