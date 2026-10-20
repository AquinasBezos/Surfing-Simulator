// First-person body: the character's own arms (fparms.js), posed for paddling on PC and
// mobile, and following the controllers in VR. Skin tone follows the player's look
// (setSkinColor).
//
// Paddling (PC, mobile): each stroke follows a smooth loop through the water and back over
// it: reach ahead and catch, pull down and back beside the board with the palm pushing the
// water, slice out at the hip, then swing forward with the elbow high. The shoulder reaches
// with it. Poses blend smoothly between resting, stroking and gripping the rails.
import * as THREE from 'three';
import { ArmRig } from './fparms.js';

const SKIN = new THREE.MeshStandardMaterial({ color: 0xc08465, roughness: 0.62, metalness: 0.0 });

export function setSkinColor(color) {
  SKIN.color.set(color);
}

const mix = (a, b, t) => a + (b - a) * t;
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// The stroke, in the board's frame (x out to this arm's side, y up, z toward the tail), for
// the right arm (the left mirrors it): [time, wrist, fingers, palm normal, elbow direction]
const STROKE = [
  [0.0, [0.27, 0.0, -0.25], [0.05, -0.45, -1], [0, -1, 0.35], [0.8, 0.55, 0.1]], // catch
  [0.14, [0.29, -0.15, -0.1], [0.08, -1, -0.2], [0, -0.25, 1], [0.85, 0.5, 0]], // pull
  [0.32, [0.3, -0.22, 0.1], [0.1, -1, 0.2], [0, 0.1, 1], [0.9, 0.45, -0.05]],
  [0.5, [0.3, -0.13, 0.31], [0.15, -0.7, 0.75], [0, 0.3, 1], [0.8, 0.6, -0.1]], // push past the hip
  [0.6, [0.33, 0.06, 0.38], [0.25, -0.3, 0.9], [-1, 0, 0.1], [0.6, 0.8, 0.1]], // slice out
  [0.76, [0.4, 0.22, 0.2], [0.25, -0.6, -0.5], [-0.6, -0.6, 0], [0.55, 0.85, 0.3]], // elbow high
  [0.9, [0.35, 0.16, -0.2], [0.1, -0.35, -1], [-0.2, -1, 0.2], [0.75, 0.6, 0.2]], // reach
];
const KEYS = STROKE.map(([t, ...v]) => [t, ...v.map((a) => new THREE.Vector3(...a))]);

// periodic Catmull-Rom through the stroke's keys, at phase p (0..1); writes 4 vectors
function strokeAt(p, out) {
  const n = KEYS.length;
  let i = n - 1;
  while (i > 0 && KEYS[i][0] > p) i--;
  const t0 = KEYS[i][0],
    t1 = i + 1 < n ? KEYS[i + 1][0] : 1;
  const u = (p - t0) / Math.max(1e-6, t1 - t0);
  const u2 = u * u,
    u3 = u2 * u;
  for (let c = 1; c <= 4; c++) {
    const P0 = KEYS[(i - 1 + n) % n][c],
      P1 = KEYS[i][c],
      P2 = KEYS[(i + 1) % n][c],
      P3 = KEYS[(i + 2) % n][c];
    out[c - 1].set(0, 0, 0)
      .addScaledVector(P0, -0.5 * u3 + u2 - 0.5 * u)
      .addScaledVector(P1, 1.5 * u3 - 2.5 * u2 + 1)
      .addScaledVector(P2, -1.5 * u3 + 2 * u2 + 0.5 * u)
      .addScaledVector(P3, 0.5 * u3 - 0.5 * u2);
  }
  return out;
}

const mirror = (v, s) => (v.x *= s, v);

class Arm {
  constructor(side) {
    this.side = side; // +1 right, -1 left
    this.phase = -1; // <0 idle, otherwise stroke progress 0..1
    this.blend = 0; // 0 idle pose, 1 stroke pose
    this.dive = 0; // 0..1 blend into gripping the rails (duck dive, turtle roll)
    this.power = 1;
    this.idleT = Math.random() * 10;
    this.k = [0, 1, 2, 3].map(() => new THREE.Vector3()); // the stroke now
    // what the arm is doing (smoothed): shoulder, wrist, fingers, palm, elbow
    this.shoulder = new THREE.Vector3(0.19 * side, 0.19, 0.3);
    this.wrist = new THREE.Vector3(0.31 * side, 0.02, -0.2);
    this.fingers = new THREE.Vector3(0, -0.3, -1);
    this.palm = new THREE.Vector3(0, -1, 0);
    this.pole = new THREE.Vector3(side, 0.5, 0.3);
  }

  // the pose this frame, in the board's frame
  target(dt) {
    const s = this.side;
    this.idleT += dt;
    // resting: hands on the water beside the nose, drifting a little
    const sway = Math.sin(this.idleT * 0.9 + s) * 0.02;
    const W = _w.set(0.31 * s, 0.02 + sway * 0.4, -0.2 + sway);
    const F = _f.set(0.12 * s, -0.3, -1);
    const N = _n.set(0, -1, 0.2);
    const P = _p.set(0.8 * s, 0.5, 0.3);
    const S = _s.set(0.19 * s, 0.19, 0.3);
    if (this.blend > 0.001) {
      const [kw, kf, kn, kp] = strokeAt(Math.max(0, this.phase < 0 ? 0.999 : this.phase), this.k);
      const b = this.blend;
      W.lerp(mirror(kw, s), b);
      F.lerp(mirror(kf, s), b);
      N.lerp(mirror(kn, s), b);
      P.lerp(mirror(kp, s), b);
      // the shoulder reaches with the catch and drops back on the push
      const ph = this.phase < 0 ? 1 : this.phase;
      S.z += (-0.045 * Math.cos(2 * Math.PI * ph) + 0.01) * b;
      S.y += 0.015 * Math.sin(2 * Math.PI * ph) * b;
    }
    if (this.dive > 0.001) {
      // gripping the rails up by the nose, fingers curled over
      W.lerp(_a.set(0.21 * s, 0.08, -0.2), this.dive);
      F.lerp(_a.set(-0.3 * s, -1, -0.1), this.dive);
      N.lerp(_a.set(-s, 0, 0), this.dive);
      P.lerp(_a.set(0.8 * s, 0.6, 0.2), this.dive);
    }
    // smoothing takes the corners off any change of pose
    const k = 1 - Math.exp(-dt * 22);
    this.shoulder.lerp(S, k);
    this.wrist.lerp(W, k);
    this.fingers.lerp(F.normalize(), k).normalize();
    this.palm.lerp(N.normalize(), k).normalize();
    this.pole.lerp(P.normalize(), k).normalize();
  }
}

export class Arms {
  constructor() {
    // the frame the paddling poses are in (main puts it in the board's frame); the arms
    // themselves are drawn by the rig, once the character has loaded
    this.group = new THREE.Group();
    this.right = new Arm(1);
    this.left = new Arm(-1);
    this.next = this.left;
    this.onStroke = null;
    this.effort = 0;
    this.rig = null;
    // strokes asked for one arm at a time (a controller's triggers, swipes on a phone)
    this.manualEffort = 0; // 0..1, from how often and how hard
    this.manualAt = -1e9; // time of the last one
    this.time = 0;
    this.turn = 0; // rad/s, + = left: a right-arm stroke turns you left
  }

  // the character model has loaded: build its arms (add `rig.group` to the scene)
  setModel(gltf) {
    const src = (() => {
      let m = null;
      gltf.scene.traverse((o) => o.isSkinnedMesh && o.material.name === 'Skin' && (m = o));
      return m;
    })();
    if (src) {
      // the character's skin, in your colour
      SKIN.roughness = src.material.roughness ?? SKIN.roughness;
      SKIN.metalness = src.material.metalness ?? SKIN.metalness;
    }
    this.rig = new ArmRig(gltf, SKIN);
    return this.rig;
  }

  // One stroke with one arm (side -1 left, +1 right), strength 0..1 (how hard the pull or
  // swipe was). Ignored while that arm is still pulling. Returns whether it started.
  stroke(side, strength = 1) {
    const a = side < 0 ? this.left : this.right;
    if (a.phase >= 0 && a.phase < 0.6) return false;
    a.phase = 0;
    a.power = 0.55 + 0.6 * strength;
    this.manualAt = this.time;
    // effort builds with each stroke and fades between them: about three good strokes a
    // second is flat out
    this.manualEffort = Math.min(1, this.manualEffort + 0.22 + 0.2 * strength);
    if (this.onStroke) this.onStroke(side, strength);
    return true;
  }

  // paddling one stroke at a time just now (rather than paced by an effort level)
  get manual() {
    return this.time - this.manualAt < 1.6;
  }

  // effort: 0..1 paddling intensity (sets the stroke cadence). dive: gripping the rails.
  // Returns the stroke pulse: power of the pulling arms, averaging ~1 while paddling
  // continuously, whatever the cadence. Strokes asked for with stroke() take over from the
  // automatic ones for a while.
  update(dt, active, effort = 0, dive = false) {
    this.time += dt;
    this.manualEffort *= Math.exp(-dt / 1.3);
    const manual = this.manual;
    this.effort = active ? (manual ? Math.max(effort, this.manualEffort) : effort) : 0;
    const strokeTime = mix(1.15, 0.52, this.effort);
    let pulse = 0;
    let turn = 0;
    for (const a of [this.left, this.right]) {
      if (a.phase >= 0) {
        a.phase += dt / strokeTime;
        if (a.phase < 0.55) {
          const p = (Math.sin((Math.PI * a.phase) / 0.55) / 0.7) * (manual ? a.power : 1);
          pulse += p;
          turn += a.side * p;
        }
        if (a.phase >= 1) a.phase = -1;
      }
      const target = a.phase >= 0 ? 1 : 0;
      // into a stroke quickly, out of it gently
      a.blend += (target - a.blend) * Math.min(1, dt * (target ? 12 : 4));
      a.dive += ((dive ? 1 : 0) - a.dive) * Math.min(1, dt * 8);
    }
    this.turn = manual && active && !dive ? turn * 0.28 : 0;
    if (active && !dive && this.effort > 0.04 && !manual) {
      // alternate arms: the next stroke starts as the other arm passes mid-stroke
      const other = this.next === this.left ? this.right : this.left;
      if (this.next.phase < 0 && (other.phase < 0 || other.phase > 0.5)) {
        this.next.phase = 0;
        if (this.onStroke) this.onStroke(this.next.side, this.effort);
        this.next = other;
      }
    }
    if (dt > 0) for (const a of [this.left, this.right]) a.target(dt);
    return active && !dive ? pulse : 0;
  }

  get stroking() {
    return this.left.phase >= 0 || this.right.phase >= 0;
  }

  // Draw the paddling arms where `group` is now (after the board has moved this frame).
  pose() {
    if (!this.rig) return;
    this.rig.visible = this.group.visible && !!this.group.parent;
    if (!this.rig.visible) return;
    this.group.updateWorldMatrix(true, false);
    const M = this.group.matrixWorld;
    this.group.getWorldQuaternion(_q);
    for (const a of [this.left, this.right]) {
      const S = a.shoulder.clone().applyMatrix4(M);
      const W = a.wrist.clone().applyMatrix4(M);
      this.rig.pose(a.side, S, W, a.fingers.clone().applyQuaternion(_q), a.palm.clone().applyQuaternion(_q), a.pole.clone().applyQuaternion(_q));
    }
  }

  // On foot with the board under your right arm. frame: your body (feet at its origin, facing
  // -z): the right hand round the bottom rail, the left arm down by your side.
  poseCarry(frame, show) {
    if (!this.rig) return;
    this.rig.visible = show;
    if (!show) return;
    frame.updateWorldMatrix(true, false);
    const M = frame.matrixWorld;
    frame.getWorldQuaternion(_q);
    const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    const D = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(_q);
    this.rig.pose(1, P(0.19, 1.42, 0.06), P(0.37, 0.8, -0.14), D(-0.3, 0.15, -1), D(-1, 0.15, 0), D(1, 0, 0.7));
    this.rig.pose(-1, P(-0.19, 1.42, 0.06), P(-0.25, 0.84, 0.08), D(0, -1, 0.05), D(1, 0, 0), D(-0.3, 0, 1));
  }

  // VR: the arms reach from your (estimated) shoulders to the controllers. hands: xr.hands;
  // head, headQuat: the headset in the rig's space; rig: the camera rig; prone: lying down.
  poseVR(hands, head, headQuat, rig, prone, show) {
    if (!this.rig) return;
    const any = show && hands.some((h) => h.source && h.has);
    this.rig.visible = any;
    if (!any) return;
    rig.updateMatrixWorld(true);
    // the shoulders: below and behind the head, across its heading (further behind lying down)
    const fwd = _a.set(0, 0, -1).applyQuaternion(headQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, Y);
    const down = prone ? 0.15 : 0.21,
      back = prone ? 0.16 : 0.06;
    for (const h of hands) {
      if (!h.source || !h.has) continue;
      const s = h.side;
      const S = head.clone().addScaledVector(right, 0.17 * s).addScaledVector(Y, -down).addScaledVector(fwd, -back).applyMatrix4(rig.matrixWorld);
      h.grip.updateWorldMatrix(true, false);
      h.grip.getWorldQuaternion(_q);
      // the hand in the controller's grip: fingers forward and a little down, palm down-ish
      const F = new THREE.Vector3(0, -0.343, -0.939).applyQuaternion(_q);
      const N = new THREE.Vector3(0, -0.939, 0.343).applyQuaternion(_q);
      const W = h.grip.getWorldPosition(new THREE.Vector3()).addScaledVector(F, -0.03);
      // the elbow out to the side and down
      const P = right.clone().transformDirection(rig.matrixWorld).multiplyScalar(0.7 * s).add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fwd.clone().transformDirection(rig.matrixWorld), -0.3);
      this.rig.pose(s, S, W, F, N, P);
    }
  }
}

// VR controllers: an empty holder (the arms are drawn by the rig, posed from the grips)
export function createVRHand() {
  return new THREE.Group();
}
