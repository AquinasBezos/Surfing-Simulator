// Camera drone for multiplayer spectators: a quadcopter that strafes on the horizontal
// plane, climbs and yaws. The body tilts into its acceleration like a real one while the
// camera hangs on a gimbal and stays level. Crashing into the water, the lip or the land
// ends the flight (the game respawns it).
import * as THREE from 'three';
import { seabedY, solidAt } from './terrain.js';

const MAX_SPEED = 12; // m/s on the horizontal plane
const BOOST = 1.9; // with the boost held
const MAX_CLIMB = 5; // m/s
const RESPONSE = 2.2; // 1/s: how quickly the drone reaches the commanded velocity
const CEILING = 140; // m
const RANGE = 700; // m from the break
export const DRONE_RADIUS = 0.2;

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();

export class Drone {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; // heading (0 = looking out to sea, -z)
    this.camPitch = -0.3; // gimbal tilt
    this.tiltF = 0; // body pitch (nose down accelerating forward)
    this.tiltR = 0; // body roll (right side down moving right)
    this.throttle = 0.5;
    this.quat = new THREE.Quaternion(); // body orientation
    this.crash = null; // reason, once it hits something
  }

  reset(x, y, z, yaw = 0, pitch = -0.3) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.camPitch = pitch;
    this.tiltF = this.tiltR = 0;
    this.crash = null;
    this._orient();
  }

  get speed() {
    return this.vel.length();
  }

  // input: fwd / right / up in -1..1, yawRate (rad/s), boost (bool)
  update(dt, input, model) {
    if (dt <= 0 || this.crash) return;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const max = MAX_SPEED * (input.boost ? BOOST : 1);
    // commanded velocity: forward is -z rotated by yaw, right is +x rotated by yaw
    const tx = (-s * input.fwd + c * input.right) * max;
    const tz = (-c * input.fwd - s * input.right) * max;
    const ty = input.up * MAX_CLIMB;
    const k = 1 - Math.exp(-dt * RESPONSE);
    const ax = (tx - this.vel.x) * k;
    const az = (tz - this.vel.z) * k;
    this.vel.x += ax;
    this.vel.z += az;
    this.vel.y += (ty - this.vel.y) * (1 - Math.exp(-dt * RESPONSE * 1.4));
    this.yaw += input.yawRate * dt;
    this.pos.addScaledVector(this.vel, dt);
    // soft limits: a height ceiling and a range around the break
    if (this.pos.y > CEILING) {
      this.pos.y = CEILING;
      this.vel.y = Math.min(0, this.vel.y);
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > RANGE) this.pos.multiplyScalar(RANGE / r).setY(this.pos.y);

    // tilt into the acceleration (and a little into the speed), in the drone's own frame
    const af = (-s * ax - c * az) / dt; // forward acceleration
    const ar = (c * ax - s * az) / dt;
    const vf = -s * this.vel.x - c * this.vel.z;
    const vr = c * this.vel.x - s * this.vel.z;
    const tf = THREE.MathUtils.clamp(-af * 0.045 - vf * 0.018, -0.6, 0.6);
    const tr = THREE.MathUtils.clamp(-ar * 0.045 - vr * 0.018, -0.6, 0.6);
    const kt = 1 - Math.exp(-dt * 8);
    this.tiltF += (tf - this.tiltF) * kt;
    this.tiltR += (tr - this.tiltR) * kt;
    this.throttle += (Math.min(1, 0.45 + Math.hypot(af, ar) * 0.04 + Math.max(0, this.vel.y) * 0.08 + Math.abs(input.yawRate) * 0.05) - this.throttle) * kt;
    this._orient();
    if (model) this.crash = this.collide(model);
  }

  _orient() {
    this.quat.setFromEuler(_e.set(this.tiltF, this.yaw, this.tiltR, 'YXZ'));
  }

  // Hit anything? Returns a reason or null.
  collide(model) {
    const { x, y, z } = this.pos;
    if (y - DRONE_RADIUS < seabedY(x, z) + 0.05) return 'Crashed into the land';
    if (solidAt(x, y, z)) return 'Flew into the pier';
    const s = model.sample(x, z, this._s || (this._s = {}));
    if (y - DRONE_RADIUS < s.height) return 'Crashed into the water';
    // the pitching lip: fine inside the tube or above the wave, not in the lip itself
    if (s.wave && s.b > 0.25 && s.un > -0.3 && s.un < 2.2 && y < s.H * 1.15 + DRONE_RADIUS) {
      const ceiling = model.tubeCeiling(s.wave, x, z, s.height + 0.05);
      if (y + DRONE_RADIUS > ceiling) return 'Clipped by the lip';
    }
    return null;
  }

  // world position of the gimbal camera, in the nose: the arms and props are all behind
  // and beside it, so none of the drone is ever in your shot
  cameraPosition(out = _v) {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    out.copy(this.pos);
    out.x -= s * CAM_FORWARD;
    out.z -= c * CAM_FORWARD;
    out.y += CAM_Y;
    return out;
  }
}

// gimbal camera position in the drone's frame (nose toward -z)
const CAM_FORWARD = 0.13;
const CAM_Y = -0.028;

// ---------------------------------------------------------------- model
// A folding-arm camera drone in the style of a DJI Mavic: slim body, "deadcat" arms (the
// front pair swept out wide, the rear pair lower and further back) so the propellers stay
// out of the camera's view, and a three-axis gimbal hanging under the nose.
let parts = null;
function sharedParts() {
  if (parts) return parts;
  const body = new THREE.MeshStandardMaterial({ color: 0x5d6268, roughness: 0.42, metalness: 0.15 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.5, metalness: 0.2 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.08, metalness: 0.7 });
  const blur = new THREE.MeshBasicMaterial({ color: 0xd8e2e8, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const blade = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5 });
  const top = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  parts = {
    body: new THREE.BoxGeometry(0.085, 0.046, 0.19),
    top,
    nose: new THREE.BoxGeometry(0.07, 0.03, 0.03),
    arm: new THREE.BoxGeometry(1, 0.012, 0.018), // stretched along x between body and motor
    motor: new THREE.CylinderGeometry(0.014, 0.017, 0.026, 12),
    disc: new THREE.CircleGeometry(0.066, 24),
    blade: new THREE.BoxGeometry(0.13, 0.003, 0.012),
    yoke: new THREE.BoxGeometry(0.008, 0.03, 0.026),
    camBody: new THREE.BoxGeometry(0.034, 0.03, 0.034),
    lens: new THREE.CylinderGeometry(0.011, 0.012, 0.01, 16),
    eye: new THREE.CircleGeometry(0.006, 10),
    led: new THREE.SphereGeometry(0.006, 8, 6),
    bodyMat: body,
    shellMat: shell,
    darkMat: dark,
    lensMat: lens,
    blur,
    bladeMat: blade,
  };
  return parts;
}

// Returns a group with .props (spin them), .gimbal (tilt it) and .setAccent(color) for the
// front arm lights. Nose toward -z.
export function createDroneModel(accent = 0x19c2b4) {
  const P = sharedParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(P.body, P.bodyMat));
  const top = new THREE.Mesh(P.top, P.shellMat);
  top.scale.set(0.044, 0.02, 0.1);
  top.position.y = 0.022;
  g.add(top);
  // dark sensor face on the nose, with two obstacle sensors
  const nose = new THREE.Mesh(P.nose, P.darkMat);
  nose.position.set(0, 0.004, -0.1);
  nose.rotation.x = -0.35;
  g.add(nose);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(P.eye, P.lensMat);
    eye.position.set(sx * 0.018, 0.008, -0.1165);
    eye.rotation.x = -0.35 + Math.PI;
    eye.rotation.y = Math.PI;
    g.add(eye);
  }
  const led = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  const rear = new THREE.MeshBasicMaterial({ color: 0x41e07a, toneMapped: false });
  g.props = [];
  // [root on the body, motor position, prop height above the motor]
  const arms = [
    [new THREE.Vector3(0.036, 0.012, -0.07), new THREE.Vector3(0.155, 0.02, -0.1)],
    [new THREE.Vector3(0.036, -0.012, 0.07), new THREE.Vector3(0.13, -0.02, 0.13)],
  ];
  for (const [i, [root, motorAt]] of arms.entries()) {
    for (const sx of [-1, 1]) {
      const a = root.clone().setX(root.x * sx);
      const m = motorAt.clone().setX(motorAt.x * sx);
      const arm = new THREE.Mesh(P.arm, P.darkMat);
      arm.position.addVectors(a, m).multiplyScalar(0.5);
      arm.scale.x = a.distanceTo(m);
      arm.rotation.y = -Math.atan2(m.z - a.z, m.x - a.x);
      g.add(arm);
      const motor = new THREE.Mesh(P.motor, P.darkMat);
      motor.position.copy(m);
      g.add(motor);
      const prop = new THREE.Group();
      prop.position.set(m.x, m.y + 0.018, m.z);
      const disc = new THREE.Mesh(P.disc, P.blur);
      disc.rotation.x = -Math.PI / 2;
      prop.add(disc);
      prop.add(new THREE.Mesh(P.blade, P.bladeMat));
      prop.spin = i === 0 ? sx : -sx; // diagonal pairs turn the same way
      g.add(prop);
      g.props.push(prop);
      const l = new THREE.Mesh(P.led, i === 0 ? led : rear);
      l.position.set(m.x, m.y - 0.016, m.z);
      g.add(l);
    }
  }
  // gimbal under the nose: yoke arms either side of the camera
  const gimbal = new THREE.Group();
  gimbal.position.set(0, CAM_Y, -CAM_FORWARD + 0.012);
  for (const sx of [-1, 1]) {
    const yoke = new THREE.Mesh(P.yoke, P.darkMat);
    yoke.position.set(sx * 0.022, 0.006, 0);
    g.add(yoke.translateZ(-CAM_FORWARD + 0.012).translateY(CAM_Y));
  }
  gimbal.add(new THREE.Mesh(P.camBody, P.darkMat));
  const lensM = new THREE.Mesh(P.lens, P.lensMat);
  lensM.rotation.x = Math.PI / 2;
  lensM.position.z = -0.019;
  gimbal.add(lensM);
  g.add(gimbal);
  g.gimbal = gimbal;
  g.setAccent = (c) => led.color.set(c);
  return g;
}

// Spin the props for this throttle and point the gimbal camera (level, pitched by `pitch`).
export function animateDrone(model, dt, throttle, pitch, bodyQuat, yaw) {
  for (const p of model.props) p.rotation.y += p.spin * dt * (90 + throttle * 60);
  // the gimbal cancels the body tilt: world orientation = yaw then pitch
  _e.set(pitch, yaw, 0, 'YXZ');
  model.gimbal.quaternion.setFromEuler(_e).premultiply(_q2.copy(bodyQuat).invert());
}
const _q2 = new THREE.Quaternion();
