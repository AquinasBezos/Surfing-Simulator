// First-person body: wetsuit arms with simple 2-bone IK and a paddling stroke cycle (PC),
// plus hand models for VR controllers.
import * as THREE from 'three';

const SUIT = new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.6, metalness: 0.0 });
const SKIN = new THREE.MeshStandardMaterial({ color: 0xc08465, roughness: 0.62, metalness: 0.0 });

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

function limb(r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 1, false);
  g.translate(0, 0.5, 0);
  return new THREE.Mesh(g, SUIT);
}

function placeLimb(mesh, from, to) {
  _a.subVectors(to, from);
  const len = _a.length();
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, _a.divideScalar(len || 1));
  mesh.scale.set(1, len, 1);
}

export function createHand(side) {
  // local frame: fingers toward -z, palm facing -y, thumb toward -side*x (inside)
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), SKIN);
  palm.scale.set(0.043, 0.017, 0.052);
  palm.position.set(0, 0, -0.045);
  hand.add(palm);
  const fingerGeo = new THREE.CapsuleGeometry(0.0085, 0.06, 4, 8);
  fingerGeo.rotateX(Math.PI / 2);
  const lens = [0.92, 1.0, 0.97, 0.82];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(fingerGeo, SKIN);
    const x = (-0.027 + i * 0.018) * side;
    f.position.set(x, -0.002, -0.118 + (1 - lens[i]) * 0.03);
    f.scale.set(1, 1, lens[i]);
    f.rotation.y = (i - 1.5) * 0.06 * side;
    f.rotation.x = -0.12;
    hand.add(f);
  }
  const thumb = new THREE.Mesh(fingerGeo, SKIN);
  thumb.position.set(-0.045 * side, -0.006, -0.05);
  thumb.rotation.y = 0.75 * side;
  thumb.scale.set(1.1, 1.1, 0.8);
  hand.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 12), SUIT);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 0, 0.018);
  hand.add(cuff);
  return hand;
}

class Arm {
  constructor(side) {
    this.side = side; // +1 right, -1 left
    this.shoulder = new THREE.Vector3(0.2 * side, 0.2, 0.38);
    this.upper = limb(0.052, 0.044);
    this.fore = limb(0.043, 0.034);
    this.hand = createHand(side);
    this.elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), SUIT);
    this.phase = -1; // <0 idle, otherwise stroke progress 0..1
    this.blend = 0; // 0 idle pose, 1 stroke pose
    this.wrist = new THREE.Vector3();
    this.handDir = new THREE.Vector3(0, 0, -1);
    this.idleT = Math.random() * 10;
  }

  target(out, dirOut) {
    const s = this.side;
    // idle: hands resting on the water beside the nose
    this.idleT += 0.016;
    const sway = Math.sin(this.idleT * 0.9 + s) * 0.02;
    const idle = _b.set(0.31 * s, 0.015 + sway * 0.4, -0.28 + (s > 0 ? 0.07 : -0.03) + sway);
    let stroke = _c.copy(idle);
    if (this.phase >= 0) {
      const p = this.phase;
      if (p < 0.55) {
        const q = p / 0.55;
        stroke.set((0.3 + 0.05 * q) * s, -0.24 * Math.sin(Math.PI * q) - 0.02, -0.34 + 0.98 * q);
      } else {
        const q = (p - 0.55) / 0.45;
        const e = 0.5 - 0.5 * Math.cos(Math.PI * q);
        stroke.set((0.35 + 0.08 * Math.sin(Math.PI * q)) * s, 0.02 + 0.22 * Math.sin(Math.PI * q), 0.64 - 0.98 * e);
      }
    }
    out.lerpVectors(idle, stroke, this.blend);
    // hand direction: forward while reaching, angled down/back while pulling
    dirOut.set(0.05 * s, -0.15, -1);
    if (this.phase >= 0 && this.phase < 0.55) dirOut.lerp(_a.set(0.1 * s, -1, 0.3), Math.sin((Math.PI * this.phase) / 0.55) * this.blend);
    dirOut.normalize();
    return out;
  }

  solve() {
    const handPos = this.target(new THREE.Vector3(), this.handDir);
    this.wrist.copy(handPos).addScaledVector(this.handDir, 0.035);
    const L1 = 0.31,
      L2 = 0.29;
    const S = this.shoulder;
    const d = _a.subVectors(this.wrist, S);
    let len = d.length();
    const dir = d.clone().divideScalar(len);
    len = Math.min(Math.max(len, 0.12), L1 + L2 - 0.002);
    const wrist = S.clone().addScaledVector(dir, len);
    const cosA = (L1 * L1 + len * len - L2 * L2) / (2 * L1 * len);
    const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
    // elbow points outward, up and back
    const pole = new THREE.Vector3(0.8 * this.side, 0.6, 0.5);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = S.clone().addScaledVector(dir, Math.cos(ang) * L1).addScaledVector(pole, Math.sin(ang) * L1);
    placeLimb(this.upper, S, elbow);
    placeLimb(this.fore, elbow, wrist);
    this.elbowJoint.position.copy(elbow);
    // orient hand: fingers along handDir, palm down
    const fwd = this.handDir;
    const right = _b.crossVectors(fwd, UP).normalize();
    const up = _c.crossVectors(right, fwd).normalize();
    _m.makeBasis(right, up, fwd.clone().negate());
    this.hand.quaternion.setFromRotationMatrix(_m);
    this.hand.position.copy(wrist);
  }
}

export class Arms {
  constructor() {
    this.group = new THREE.Group();
    this.right = new Arm(1);
    this.left = new Arm(-1);
    for (const a of [this.left, this.right]) this.group.add(a.upper, a.fore, a.hand, a.elbowJoint);
    this.pending = 0;
    this.next = this.left;
    this.strokeTime = 0.64;
    this.onStroke = null;
  }

  requestStroke() {
    this.pending = Math.min(this.pending + 1, 2);
  }

  // Returns forward thrust (m/s^2) generated by the arms this frame.
  update(dt, active) {
    let thrust = 0;
    for (const a of [this.left, this.right]) {
      if (a.phase >= 0) {
        a.phase += dt / this.strokeTime;
        if (a.phase < 0.55) thrust += 2.75 * Math.sin((Math.PI * a.phase) / 0.55);
        if (a.phase >= 1) a.phase = -1;
      }
      const target = a.phase >= 0 ? 1 : 0;
      a.blend += (target - a.blend) * Math.min(1, dt * 9);
    }
    if (active && this.pending > 0) {
      const other = this.next === this.left ? this.right : this.left;
      const ready = this.next.phase < 0 && (other.phase < 0 || other.phase > 0.45);
      if (ready) {
        this.next.phase = 0;
        if (this.onStroke) this.onStroke(this.next.side);
        this.next = other;
        this.pending--;
      }
    }
    if (!active) this.pending = 0;
    this.left.solve();
    this.right.solve();
    return active ? thrust : 0;
  }

  get stroking() {
    return this.left.phase >= 0 || this.right.phase >= 0;
  }
}

// Hands that follow VR controller grips (with a short wetsuit forearm).
export function createVRHand(side) {
  const g = new THREE.Group();
  const hand = createHand(side);
  hand.rotation.x = -0.35;
  g.add(hand);
  const fore = limb(0.034, 0.042);
  fore.rotation.x = Math.PI / 2 - 0.35;
  fore.position.set(0, 0, 0.03);
  fore.scale.set(1, 0.26, 1);
  g.add(fore);
  return g;
}
