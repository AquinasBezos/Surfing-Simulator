// Board physics and the prone / pop-up / standing / wipeout state machine.
//
// The board rides on the smooth (un-curled) wave surface. Gravity acts along the slope,
// water drag acts relative to the moving water (orbital velocity on the wave face, the
// push of whitewater), and the fins convert sideways slip into forward speed (carving).
import * as THREE from 'three';
import { GRAVITY, LINEUP_Z, WAVE } from './config.js';
import { clamp, smoothstep, mix } from './wave.js';

export const STATE = { PRONE: 'prone', POPUP: 'popup', STANDING: 'standing', WIPEOUT: 'wipeout' };

const POPUP_TIME = 0.42;
const WIPEOUT_TIME = 3.4;

export class Surfer {
  constructor(model) {
    this.model = model;
    this.x = 0;
    this.z = LINEUP_Z;
    this.y = 0;
    this.vx = 0;
    this.vz = 0;
    this.yaw = 0; // three.js rotation.y; forward = (-sin yaw, -cos yaw)
    this.state = STATE.PRONE;
    this.stateTime = 0;
    this.leanX = 0;
    this.leanZ = 0;
    this.crouch = 0;
    this.roll = 0;
    this.pitch = 0;
    this.yawRate = 0;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.s = {};
    this.wipeReason = '';
    this.inTube = false;
    this.riding = false;
    this.onEvent = null; // (type, data)
    this._n = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.tumble = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forward() {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.yaw = yaw;
    this.yawRate = 0;
    this.leanX = this.leanZ = this.crouch = 0;
    this.roll = this.pitch = 0;
    this.tumble = 0;
    this.setState(STATE.PRONE);
    this.inTube = false;
    this.riding = false;
    this.model.sample(x, z, this.s);
    this.y = this.s.height;
    this.normal.set(0, 1, 0);
    this.updatePose(1);
  }

  setState(st) {
    if (this.state === st) return;
    const prev = this.state;
    this.state = st;
    this.stateTime = 0;
    if (this.onEvent) this.onEvent('state', { from: prev, to: st });
  }

  popUp() {
    if (this.state === STATE.PRONE) this.setState(STATE.POPUP);
  }

  layDown() {
    if (this.state === STATE.STANDING || this.state === STATE.POPUP) this.setState(STATE.PRONE);
  }

  wipeout(reason) {
    if (this.state === STATE.WIPEOUT) return;
    this.wipeReason = reason;
    this.setState(STATE.WIPEOUT);
    if (this.onEvent) this.onEvent('wipeout', { reason });
  }

  // input: { thrust, turn, steer, leanX, leanZ, crouch }
  update(dt, input) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, input);
    this.updatePose(dt);
  }

  step(h, inp) {
    const s = this.model.sample(this.x, this.z, this.s);
    this.stateTime += h;
    const st = this.state;
    if (st === STATE.POPUP && this.stateTime > POPUP_TIME) this.setState(STATE.STANDING);

    // surface gradient (finite differences on the smooth surface)
    const e = 0.06;
    const hx = (this.model.heightAt(this.x + e, this.z) - this.model.heightAt(this.x - e, this.z)) / (2 * e);
    const hz = (this.model.heightAt(this.x, this.z + e) - this.model.heightAt(this.x, this.z - e)) / (2 * e);
    this._gx = hx;
    this._gz = hz;

    const standing = this.state === STATE.STANDING;
    const prone = this.state === STATE.PRONE || this.state === STATE.POPUP;

    // smoothed weight shift
    const k = 1 - Math.exp(-h * (standing ? 7 : 4));
    this.leanX += ((standing ? inp.leanX : 0) - this.leanX) * k;
    this.leanZ += ((standing ? inp.leanZ : 0) - this.leanZ) * k;
    this.crouch += ((standing ? Math.max(inp.crouch || 0, -Math.min(this.leanZ, 0) * 0.8, this.inTube ? 0.6 : 0) : 0) - this.crouch) * k;

    if (this.state === STATE.WIPEOUT) {
      // tumbling in the whitewater: carried by the water, no control
      const kk = 1 - Math.exp(-h * 2.5);
      this.vx += (0 - this.vx) * kk;
      this.vz += (s.waterVz * 0.9 - this.vz) * kk;
      this.x += this.vx * h;
      this.z += this.vz * h;
      this.tumble += h;
      return;
    }

    // --- forces ---
    // A board drifting with the water just rides the orbital motion (the slope is what
    // drives the water itself); only once it moves through the water (paddling, planing)
    // does it slide down the face. So scale slope gravity by the speed relative to the water.
    const g2 = hx * hx + hz * hz;
    const relSp = Math.hypot(this.vx, this.vz - s.waterVz);
    const plane = standing ? mix(0.45, 1, smoothstep(1.5, 4, relSp)) : mix(0.2, 1, smoothstep(1.1, 3.0, relSp));
    let ax = (-GRAVITY * hx * plane) / (1 + g2);
    let az = (-GRAVITY * hz * plane) / (1 + g2);
    const [fx, fz] = this.forward;
    const rx = -fz,
      rz = fx; // right vector (x, z) = (cos yaw, -sin yaw)
    const slope = Math.sqrt(g2);

    // paddling / pumping
    let thrust = prone ? inp.thrust : 0;
    if (thrust > 0.3) this.lastStroke = 0;
    else this.lastStroke = (this.lastStroke ?? 9) + h;
    if (standing && this.leanZ > 0.1 && slope > 0.1 && this.speed > 2) thrust += 1.1 * this.leanZ * Math.min(1, slope * 3);
    ax += fx * thrust;
    az += fz * thrust;

    // Catching: a paddler stroking on the steep part of the face, pointed at the beach,
    // gets picked up by the wave and accelerated toward its speed.
    this.catching = false;
    if (prone && this.lastStroke < 0.7 && s.wave && s.H > 0.6 && s.un > 0.05 && s.un < 1.5 && slope > 0.16 && fz > 0.35) {
      const c = WAVE.speed;
      const pull = 2.4 * smoothstep(0.16, 0.45, slope) * smoothstep(0.35, 0.8, fz);
      az += Math.max(0, c * 0.95 - this.vz) * pull;
      this.catching = true;
    }

    this.vx += ax * h;
    this.vz += az * h;

    // --- drag relative to the water ---
    const wvz = s.waterVz;
    let rvx = this.vx,
      rvz = this.vz - wvz;
    let vf = rvx * fx + rvz * fz;
    let vl = rvx * rx + rvz * rz;
    const sp = Math.hypot(vf, vl);
    if (standing) {
      const planing = smoothstep(1.8, 4.0, sp);
      let lin = mix(0.65, 0.07, planing);
      let quad = 0.042;
      lin *= 1 - 0.3 * Math.max(this.leanZ, 0);
      lin += 1.6 * Math.max(-this.leanZ, 0) * planing; // stall
      lin += 0.07 * Math.abs(this.yawRate) * planing; // carving costs a little speed
      quad += 0.05 * smoothstep(8.5, 12, sp); // hull speed: hard to go much faster
      vf -= (lin * vf + quad * vf * Math.abs(vf)) * h;
      // fins: sideways slip is converted to forward speed
      const vl2 = vl * Math.exp(-h * 7.5);
      vf += Math.sign(vf || 1) * (Math.abs(vl) - Math.abs(vl2)) * 0.82;
      vl = vl2;
    } else {
      const lin = mix(0.38, 0.2, smoothstep(2.2, 4.5, sp)),
        quad = 0.11;
      vf -= (lin * vf + quad * vf * Math.abs(vf)) * h;
      const vl2 = vl * Math.exp(-h * 2.6);
      vf += Math.sign(vf || 1) * (Math.abs(vl) - Math.abs(vl2)) * 0.3;
      vl = vl2;
    }
    this.vx = vf * fx + vl * rx;
    this.vz = vf * fz + vl * rz + wvz;

    // --- steering ---
    const speed = this.speed;
    if (standing) {
      const target = -this.leanX * Math.min(2.8, 0.55 + 0.3 * speed);
      this.yawRate += (target - this.yawRate) * (1 - Math.exp(-h * 6));
    } else if (prone) {
      // steer: +1 = right (D). turn: VR paddling differential in rad/s, + = left.
      const target = (-inp.steer * 1.25) / (1 + 0.18 * speed) + (inp.turn || 0);
      this.yawRate += (target - this.yawRate) * (1 - Math.exp(-h * 5));
    }
    this.yaw += this.yawRate * h;

    this.x += this.vx * h;
    this.z += this.vz * h;

    this.checkRules(s, h);
  }

  checkRules(s, h) {
    const st = this.state;
    const big = s.wave && s.H > 0.7;
    this.inTube = false;
    // standing without enough speed to plane: sink back to prone
    if (st === STATE.STANDING && this.speed < 1.2 && this.stateTime > 1.0) {
      this._slow = (this._slow || 0) + h;
      if (this._slow > 1.2) {
        this._slow = 0;
        this.setState(STATE.PRONE);
        if (this.onEvent) this.onEvent('sink', {});
        return;
      }
    } else this._slow = 0;
    if (!big) {
      this.riding = false;
      return;
    }
    const un = s.un;
    // over the falls: sucked up the face of a pitching section
    if (s.yb > 0.8 && s.b > 0.3 && un > -0.3 && un < 0.65) return this.wipeout('Over the falls!');
    // the lip lands on you
    if (s.b > 0.55 && un > 1.2 && un < 1.75 && s.kappa < 0.95) return this.wipeout('Smashed by the lip!');
    if (st === STATE.STANDING) {
      // the whole wave closing out at the end of its life ends the ride gracefully
      if (s.wave.collapseG > 0.3) {
        this.riding = false;
        this.setState(STATE.PRONE);
        if (this.onEvent) this.onEvent('closeout', {});
        return;
      }
      if (s.kappa > 0.5 && un > -0.3 && un < 2.4) return this.wipeout('Caught inside the whitewater');
      this.inTube = s.b > 0.6 && s.kappa < 0.35 && un > 0.38 && un < 1.25 && s.H > 1.2;
      this.riding = un > -0.7 && un < 3 && this.speed > 2.2;
    } else this.riding = false;
  }

  updatePose(dt) {
    // surface normal (smoothed)
    const gx = this._gx || 0,
      gz = this._gz || 0;
    const n = this._n.set(-gx, 1, -gz).normalize();
    this.normal.lerp(n, 1 - Math.exp(-dt * 10)).normalize();
    const s = this.s;
    let y = s.height;
    if (this.state === STATE.WIPEOUT) y -= Math.min(1.4, this.tumble * 1.5);
    this.y = y;

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const up = this.normal;
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    this._m.makeBasis(right, up, fwd.clone().negate());
    this.quat.setFromRotationMatrix(this._m);

    // rail lean & trim
    const standing = this.state === STATE.STANDING;
    const targetRoll = standing ? -this.leanX * 0.42 : this.state === STATE.WIPEOUT ? Math.sin(this.tumble * 5) * 1.2 : -this.yawRate * 0.05;
    const targetPitch = standing ? -this.leanZ * 0.06 : this.state === STATE.PRONE ? 0.035 : 0;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 8));
    this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-dt * 6));
    this._q.setFromEuler(new THREE.Euler(this.pitch, 0, this.roll, 'YXZ'));
    this.quat.multiply(this._q);
    this.position.set(this.x, this.y, this.z);
  }
}
