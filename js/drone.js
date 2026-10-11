// Camera drone for multiplayer spectators: a quadcopter that strafes on the horizontal
// plane, climbs and yaws. The body tilts into its acceleration like a real one while the
// camera hangs on a gimbal and stays level. Crashing into the water, the lip or the land
// ends the flight (the game respawns it).
import * as THREE from 'three';
import { seabedY } from './terrain.js';

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
    const s = model.sample(x, z, this._s || (this._s = {}));
    if (y - DRONE_RADIUS < s.height) return 'Crashed into the water';
    // the pitching lip: fine inside the tube or above the wave, not in the lip itself
    if (s.wave && s.b > 0.25 && s.un > -0.3 && s.un < 2.2 && y < s.H * 1.15 + DRONE_RADIUS) {
      const ceiling = model.tubeCeiling(s.wave, x, z, s.height + 0.05);
      if (y + DRONE_RADIUS > ceiling) return 'Clipped by the lip';
    }
    return null;
  }

  // world position of the gimbal camera: hanging under the body, so the (tilting) drone is
  // only in view when you look up, and still inside the crash radius
  cameraPosition(out = _v) {
    out.copy(this.pos);
    out.y -= 0.16;
    return out;
  }
}

// ---------------------------------------------------------------- model
let parts = null;
function sharedParts() {
  if (parts) return parts;
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.45, metalness: 0.2 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.35, metalness: 0.05 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.1, metalness: 0.6 });
  const blur = new THREE.MeshBasicMaterial({ color: 0xd8e2e8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const blade = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.5 });
  parts = {
    body: new THREE.BoxGeometry(0.16, 0.05, 0.24),
    top: new THREE.SphereGeometry(0.085, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    arm: new THREE.BoxGeometry(0.022, 0.016, 0.2),
    motor: new THREE.CylinderGeometry(0.017, 0.02, 0.032, 12),
    disc: new THREE.CircleGeometry(0.075, 24),
    blade: new THREE.BoxGeometry(0.15, 0.003, 0.014),
    gimbal: new THREE.BoxGeometry(0.045, 0.04, 0.045),
    lens: new THREE.CylinderGeometry(0.013, 0.013, 0.012, 14),
    led: new THREE.SphereGeometry(0.008, 8, 6),
    dark,
    shell,
    lensMat: lens,
    blur,
    bladeMat: blade,
  };
  return parts;
}

// A small quadcopter. Returns a group with .props (spin them), .gimbal (tilt it) and
// .setAccent(color) for the arm lights.
export function createDroneModel(accent = 0x19c2b4) {
  const P = sharedParts();
  const g = new THREE.Group();
  const body = new THREE.Mesh(P.body, P.dark);
  g.add(body);
  const top = new THREE.Mesh(P.top, P.shell);
  top.scale.set(1, 0.45, 1.35);
  top.position.y = 0.024;
  g.add(top);
  const led = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  g.props = [];
  for (const [sx, sz] of [
    [1, -1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const arm = new THREE.Mesh(P.arm, P.dark);
    arm.position.set(sx * 0.1, 0.005, sz * 0.1);
    arm.rotation.y = Math.atan2(sx, sz);
    g.add(arm);
    const motor = new THREE.Mesh(P.motor, P.dark);
    motor.position.set(sx * 0.17, 0.02, sz * 0.17);
    g.add(motor);
    const prop = new THREE.Group();
    prop.position.set(sx * 0.17, 0.04, sz * 0.17);
    const disc = new THREE.Mesh(P.disc, P.blur);
    disc.rotation.x = -Math.PI / 2;
    prop.add(disc);
    const b = new THREE.Mesh(P.blade, P.bladeMat);
    prop.add(b);
    prop.spin = sx * sz; // neighbours turn opposite ways
    g.add(prop);
    g.props.push(prop);
    const l = new THREE.Mesh(P.led, sz < 0 ? led : new THREE.MeshBasicMaterial({ color: 0xff4636, toneMapped: false }));
    l.position.set(sx * 0.17, -0.005, sz * 0.17);
    g.add(l);
  }
  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.045, -0.09);
  const cam = new THREE.Mesh(P.gimbal, P.dark);
  gimbal.add(cam);
  const lensM = new THREE.Mesh(P.lens, P.lensMat);
  lensM.rotation.x = Math.PI / 2;
  lensM.position.z = -0.025;
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
