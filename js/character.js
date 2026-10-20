// The player character: assets/surfer.glb, a rigged low-poly surfer (19-bone humanoid,
// boardshorts) with Idle / Walk / Run / Surf / Paddle clips. Every instance gets its own
// skeleton and its own skin and hair materials, so everyone can look different, and is
// posed from the game state:
//   lying down : the Paddle clip, sped up with paddling effort
//   up         : the Surf clip (crossfaded through the pop-up), with crouch and rail lean
//                added by moving the hips and re-solving the legs (two-bone IK) so the
//                feet stay planted on the deck; on a longboard the stance slides along it
//   sitting    : a sitting pose made here, for waiting out the back
//   walking    : the Walk clip (Idle when still), board under the right arm (a river bank)
// and turned to look where the player is looking (head and neck, or the whole upper body
// when they're up and riding).
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
const _qLook = new THREE.Quaternion();
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

// Sitting astride the board waiting for a set: thighs forward and out either side, shins
// hanging in the water, hands resting forward, with a slow breathing sway. The model has no
// sitting clip, so it's built here. Angles in degrees (ZYX, the model's frame: it faces +z,
// left is +x); the rig's rest pose has no rotations, so these are rotations from the T-pose.
let sitClipCache = null;
function sitClip() {
  if (sitClipCache) return sitClipCache;
  const D = Math.PI / 180;
  const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D, 'ZYX'));
  const pose = {
    Spine: [[3, 0, 0], [6, 0, 0]],
    Chest: [[2, 0, 0], [4, 0, 0]],
    Neck: [[0, 0, 0]],
    Head: [[-4, 0, 0]],
    LeftShoulder: [[0, 0, 0]],
    RightShoulder: [[0, 0, 0]],
    LeftUpperArm: [[0, -32, -68], [0, -30, -70]],
    RightUpperArm: [[0, 32, 68], [0, 30, 70]],
    LeftLowerArm: [[0, -55, 0]],
    RightLowerArm: [[0, 55, 0]],
    LeftHand: [[0, -10, 0]],
    RightHand: [[0, 10, 0]],
    LeftUpperLeg: [[-68, 0, 20], [-64, 0, 22]],
    RightUpperLeg: [[-68, 0, -20], [-66, 0, -21]],
    LeftLowerLeg: [[82, 0, 0], [76, 0, 0]],
    RightLowerLeg: [[82, 0, 0], [86, 0, 0]],
    LeftFoot: [[25, 0, 0]],
    RightFoot: [[25, 0, 0]],
  };
  const times = [0, 2, 4];
  const tracks = [new THREE.VectorKeyframeTrack('Hips.position', times, [0, 0.1, 0, 0, 0.104, 0, 0, 0.1, 0])];
  tracks.push(new THREE.QuaternionKeyframeTrack('Hips.quaternion', times, [...q(-4, 0, 0).toArray(), ...q(-3, 0, 0).toArray(), ...q(-4, 0, 0).toArray()]));
  for (const [bone, keys] of Object.entries(pose)) {
    const a = q(...keys[0]);
    const b = keys[1] ? q(...keys[1]) : a;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, [...a.toArray(), ...b.toArray(), ...a.toArray()]));
  }
  sitClipCache = new THREE.AnimationClip('Sit', 4, tracks);
  return sitClipCache;
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
    this.sit = this.mixer.clipAction(sitClip());
    this.walk = this.mixer.clipAction(clip('Walk'));
    this.idle = this.mixer.clipAction(clip('Idle'));
    this.actions = [this.paddle, this.surf, this.sit, this.walk, this.idle];
    for (const a of this.actions) a.play();
    this.weights = [1, 0, 0, 0, 0]; // lying down, up, sitting, walking, standing about
    // The mixer only writes a bone when its animated value changes, so a held pose would keep
    // the look / IK tweaks from the last frame and they'd pile up (a head that spins). Keep
    // the mixer's output and put it back before each update.
    this.boneList = Object.values(this.bones);
    this.base = this.boneList.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  }

  setLook({ skin, hair }) {
    if (skin && this.mats.Skin) this.mats.Skin.color.set(skin);
    if (hair && this.mats.Hair) this.mats.Hair.color.set(hair);
  }

  // p: { pose: 'prone' | 'stand' | 'sit' | 'walk', effort, crouch, lean, foot, proneZ, lookYaw, lookPitch }
  //    (lookYaw / lookPitch: where they're looking, relative to the board's nose, + = left / up;
  //    walking, effort is how fast: 0 standing about .. 1 running)
  update(dt, p) {
    const moving = (p.effort || 0) > 0.06;
    const target = p.pose === 'stand' ? 1 : p.pose === 'sit' ? 2 : p.pose === 'walk' ? (moving ? 3 : 4) : 0;
    const k = 1 - Math.exp(-dt * 7);
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      this.weights[i] = (this.weights[i] || 0) + ((i === target ? 1 : 0) - (this.weights[i] || 0)) * k;
      sum += this.weights[i];
    }
    const [wP, wU, wS, wW, wI] = this.weights.map((w) => w / sum);
    this.paddle.setEffectiveWeight(wP);
    this.surf.setEffectiveWeight(wU);
    this.sit.setEffectiveWeight(wS);
    this.walk.setEffectiveWeight(wW);
    this.idle.setEffectiveWeight(wI);
    this.paddle.setEffectiveTimeScale(0.3 + (p.effort || 0) * 1.3);
    this.walk.setEffectiveTimeScale(p.pose === 'walk' ? Math.max(0.5, (p.effort || 0) * 2.4) : 1);
    this.boneList.forEach((b, i) => {
      b.quaternion.copy(this.base[i].q);
      b.position.copy(this.base[i].p);
    });
    this.mixer.update(dt);
    this.boneList.forEach((b, i) => {
      this.base[i].q.copy(b.quaternion);
      this.base[i].p.copy(b.position);
    });
    // lying with the hips toward the tail; up, the stance slides with `foot`; sitting just
    // behind the middle
    // (on foot the root is at the feet; on a board it's the board, a little below the deck)
    this.model.position.set(0, 0.035 * (wP + wU + wS), wP * (p.proneZ ?? 0.42) + wU * -(p.foot || 0) + wS * 0.18);
    this.model.updateMatrixWorld(true);
    if (wU > 0.5) this.adjustStance(p, wU);
    if (wW + wI > 0.5) this.carryBoard();
    this.applyLook(p.lookYaw || 0, p.lookPitch || 0, wP, wU, wS);
  }

  // on foot: the right hand round the bottom rail of the board under the arm (the root's frame:
  // feet at the origin, facing -z, the board at the right hip)
  carryBoard() {
    const B = this.bones;
    if (!B.RightUpperArm || !B.RightLowerArm || !B.RightHand) return;
    this.root.updateMatrixWorld(true);
    const target = _v3.set(0.37, 0.8, -0.12).applyMatrix4(this.root.matrixWorld);
    solveTwoBone(B.RightUpperArm, B.RightLowerArm, B.RightHand, target.clone());
  }

  // Turn to look: lying down or sitting it's the head and neck (and a little of the chest);
  // up on the board the whole upper body twists with the view.
  applyLook(yaw, pitch, wP, wU, wS) {
    if (Math.abs(yaw) < 1e-3 && Math.abs(pitch) < 1e-3) return;
    const B = this.bones;
    const maxYaw = wP * 1.1 + wU * 1.9 + wS * 2.0;
    yaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
    pitch = THREE.MathUtils.clamp(pitch, -0.9, 0.7);
    // axes from the board's frame, worked out first (rotateWorld reuses the scratch quaternions)
    const boardQ = this.root.getWorldQuaternion(_qLook);
    const up = _v.set(0, 1, 0).applyQuaternion(boardQ);
    const fwd = _v2.set(0, 0, -1).applyQuaternion(boardQ).applyAxisAngle(up, yaw);
    const across = _v3.crossVectors(fwd, up).normalize(); // to the right of the line of sight
    const share = [
      [B.Spine, wU * 0.2],
      [B.Chest, wU * 0.25 + wS * 0.15],
      [B.Neck, wU * 0.25 + wS * 0.35 + wP * 0.4],
      [B.Head, wU * 0.3 + wS * 0.5 + wP * 0.6],
    ];
    for (const [bone, f] of share) if (bone && f > 0) rotateWorld(bone, _q.setFromAxisAngle(up, yaw * f));
    // nod about the axis across the line of sight (+ pitch tips the face up)
    for (const [bone, f] of [
      [B.Chest, wU * 0.15],
      [B.Neck, 0.4],
      [B.Head, 0.6 - wU * 0.15],
    ])
      if (bone && f > 0) rotateWorld(bone, _q.setFromAxisAngle(across, pitch * f));
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
