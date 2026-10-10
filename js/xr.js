// Meta Quest / WebXR controls.
//   Paddle     : sweep a hand from front to back below chest height ("in the water").
//                Paddling harder with the right hand turns you left and vice versa.
//   Pop-up     : physically stand up (head rises > 35 cm above the calibrated paddling height).
//   Surf       : lean your head/torso left/right to carve, forward to trim, back to stall.
//   Trigger    : re-calibrate paddling position     Grip : back to the lineup
//   Fallback   : thumbstick forward = paddle, sideways = steer/lean, A/X = pop up / lie down.
import * as THREE from 'three';
import { createVRHand } from './body.js';
import { STATE } from './surfer.js';

const Y = new THREE.Vector3(0, 1, 0);

export class XRControls {
  constructor(renderer, rig) {
    this.renderer = renderer;
    this.rig = rig;
    this.events = [];
    this.calibrated = false;
    this.h0 = new THREE.Vector3(0, 1.0, 0);
    this.yaw0 = 0;
    this.head = new THREE.Vector3();
    this.headYaw = 0;
    this.local = new THREE.Vector3();
    this.stance = new THREE.Vector3();
    this.standPeak = 0;
    this.standTimer = 0;
    this.proneTimer = 0;
    this.out = { thrust: 0, turn: 0, steer: 0, leanX: 0, leanZ: 0, crouch: 0 };
    this.hands = [];
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const ctrl = renderer.xr.getController(i);
      rig.add(grip, ctrl);
      const h = { grip, ctrl, source: null, side: i === 0 ? -1 : 1, model: null, prev: new THREE.Vector3(), vel: new THREE.Vector3(), has: false, thrust: 0, stroking: false, btn: false };
      ctrl.addEventListener('connected', (e) => {
        h.source = e.data;
        h.side = e.data.handedness === 'left' ? -1 : 1;
        if (h.model) grip.remove(h.model);
        h.model = createVRHand(h.side);
        grip.add(h.model);
        h.has = false;
      });
      ctrl.addEventListener('disconnected', () => {
        h.source = null;
        if (h.model) grip.remove(h.model);
        h.model = null;
      });
      ctrl.addEventListener('selectstart', () => this.events.push('recalibrate'));
      ctrl.addEventListener('squeezestart', () => this.events.push('reset'));
      this.hands.push(h);
    }
  }

  calibrate() {
    this.h0.copy(this.head);
    this.yaw0 = this.headYaw;
    this.calibrated = true;
  }

  toBody(p, out) {
    return out.subVectors(p, this.h0).applyAxisAngle(Y, -this.yaw0);
  }

  pulse(h, strength, ms) {
    const g = h.source && h.source.gamepad;
    const act = g && g.hapticActuators && g.hapticActuators[0];
    if (act && act.pulse) act.pulse(strength, ms).catch?.(() => {});
  }

  update(dt, frame, state) {
    const out = this.out;
    out.thrust = out.turn = out.steer = out.leanX = out.leanZ = out.crouch = 0;
    const ref = this.renderer.xr.getReferenceSpace();
    const pose = frame && ref ? frame.getViewerPose(ref) : null;
    if (!pose) return out;
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    this.head.set(p.x, p.y, p.z);
    this._q.set(o.x, o.y, o.z, o.w);
    const f = this._v.set(0, 0, -1).applyQuaternion(this._q);
    this.headYaw = Math.atan2(-f.x, -f.z);
    if (!this.calibrated) this.calibrate();
    const lh = this.toBody(this.head, this.local);

    const prone = state === STATE.PRONE;
    const standing = state === STATE.STANDING;
    let tl = 0,
      tr = 0,
      stickX = 0,
      stickY = 0;
    for (const h of this.hands) {
      if (!h.source) continue;
      const lp = this.toBody(h.grip.position, new THREE.Vector3());
      if (h.has && dt > 0) {
        const v = lp.clone().sub(h.prev).divideScalar(dt);
        h.vel.lerp(v, 1 - Math.exp(-dt * 20));
      }
      h.prev.copy(lp);
      h.has = true;
      const inWater = lp.y < -0.22;
      const t = prone && inWater ? Math.min(3.2, Math.max(0, (h.vel.z - 0.35) * 1.6)) : 0;
      if (t > 0.6 && !h.stroking) {
        h.stroking = true;
        this.pulse(h, 0.35, 60);
        if (this.onStroke) this.onStroke(h.side);
      } else if (t < 0.2) h.stroking = false;
      if (h.side < 0) tl += t;
      else tr += t;
      // gamepad fallback
      const gp = h.source.gamepad;
      if (gp) {
        const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
        const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
        if (Math.abs(ax) > Math.abs(stickX)) stickX = ax;
        if (Math.abs(ay) > Math.abs(stickY)) stickY = ay;
        const b = gp.buttons[4] && gp.buttons[4].pressed;
        if (b && !h.btn) this.events.push('toggleStand');
        h.btn = b;
      }
    }
    out.thrust = (tl + tr) * 0.55;
    out.turn = (tr - tl) * 0.25; // stronger right stroke turns left
    if (prone && stickY < -0.2) out.thrust += 2.3 * -stickY;
    out.steer = Math.abs(stickX) > 0.2 ? stickX : 0;

    // pop-up by standing up for real
    const dy = lh.y;
    if (prone) {
      this.standTimer = dy > 0.35 ? this.standTimer + dt : 0;
      if (this.standTimer > 0.12) {
        this.standTimer = 0;
        this.events.push('popUp');
        this.stance.copy(lh);
        this.standPeak = dy;
      }
    } else this.standTimer = 0;
    if (standing) {
      this.standPeak = Math.max(this.standPeak * (1 - dt * 0.02), dy);
      if (this.stateWas !== STATE.STANDING) {
        this.stance.copy(lh);
        this.standPeak = dy;
      }
      // slowly re-centre the stance so drift doesn't accumulate
      this.stance.x += (lh.x - this.stance.x) * dt * 0.08;
      this.stance.z += (lh.z - this.stance.z) * dt * 0.08;
      out.leanX = Math.max(-1, Math.min(1, (lh.x - this.stance.x) / 0.17));
      out.leanZ = Math.max(-1, Math.min(1, -(lh.z - this.stance.z) / 0.17));
      out.crouch = Math.max(0, Math.min(1, (this.standPeak - dy) / 0.3));
      if (Math.abs(stickX) > 0.2) out.leanX = stickX;
      if (Math.abs(stickY) > 0.2) out.leanZ = -stickY;
      this.proneTimer = dy < 0.15 ? this.proneTimer + dt : 0;
      if (this.proneTimer > 0.45) {
        this.proneTimer = 0;
        this.events.push('layDown');
      }
    }
    this.stateWas = state;
    return out;
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
