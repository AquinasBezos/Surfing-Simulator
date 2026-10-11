// Meta Quest / WebXR controls.
//   Paddle     : sweep a hand from front to back below chest height ("in the water").
//                Faster strokes paddle faster; a stronger right stroke turns you left.
//   Duck dive  : while paddling, hold a grip with that hand on the front of the board.
//   Pop-up     : physically stand up (head rises > 35 cm above the calibrated paddling height).
//   Surf       : lean your head/torso left/right to carve, forward to trim, back to stall.
//   Crouch     : crouch for real; stand up fast at the lip to hop off it.
//   Manoeuvre  : hold either grip to charge, then whip your head left/right.
//   Longboard  : walk forward / back on the board for real.
//   Trigger    : re-calibrate paddling position     B / Y : back to the lineup
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
    this.effortRaw = 0;
    this.yawRate = 0;
    this.prevYaw = null;
    this.flickWin = null;
    this.flickCool = 0;
    this.out = { paddle: 0, pulse: 0, turn: 0, steer: 0, leanX: 0, leanZ: 0, walk: 0, walkTo: null, crouch: 0, duck: false, charge: false };
    this.hands = [];
    this.onHandModel = null;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const ctrl = renderer.xr.getController(i);
      rig.add(grip, ctrl);
      const h = { grip, ctrl, source: null, side: i === 0 ? -1 : 1, model: null, prev: new THREE.Vector3(), vel: new THREE.Vector3(), has: false, stroking: false, btnA: false, btnB: false, squeeze: false };
      ctrl.addEventListener('connected', (e) => {
        h.source = e.data;
        h.side = e.data.handedness === 'left' ? -1 : 1;
        if (h.model) grip.remove(h.model);
        h.model = createVRHand(h.side);
        grip.add(h.model);
        if (this.onHandModel) this.onHandModel(h.model);
        h.has = false;
      });
      ctrl.addEventListener('disconnected', () => {
        h.source = null;
        if (h.model) grip.remove(h.model);
        h.model = null;
      });
      ctrl.addEventListener('selectstart', () => this.events.push('recalibrate'));
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

  // The board turned under the player (a manoeuvre): make that the new "forward" so the
  // world doesn't spin around them, and re-centre the stance.
  rotateFrame(d) {
    if (!d) return;
    this.yaw0 += d;
    this.restance = true;
  }

  pulse(h, strength, ms) {
    const g = h.source && h.source.gamepad;
    const act = g && g.hapticActuators && g.hapticActuators[0];
    if (act && act.pulse) act.pulse(strength, ms).catch?.(() => {});
  }

  update(dt, frame, state, board) {
    const out = this.out;
    out.paddle = out.pulse = out.turn = out.steer = out.leanX = out.leanZ = out.walk = out.crouch = 0;
    out.walkTo = null;
    out.duck = out.charge = false;
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

    // head turn speed (+ = left)
    if (this.prevYaw !== null && dt > 0) {
      let d = this.headYaw - this.prevYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yawRate += (d / dt - this.yawRate) * (1 - Math.exp(-dt / 0.04));
    }
    this.prevYaw = this.headYaw;

    const prone = state === STATE.PRONE;
    const standing = state === STATE.STANDING;
    let pl = 0,
      pr = 0,
      fastest = 0,
      stickX = 0,
      stickY = 0,
      anyGrip = false,
      noseGrip = false;
    for (const h of this.hands) {
      if (!h.source) continue;
      const lp = this.toBody(h.grip.position, new THREE.Vector3());
      if (h.has && dt > 0) {
        const v = lp.clone().sub(h.prev).divideScalar(dt);
        h.vel.lerp(v, 1 - Math.exp(-dt * 20));
      }
      h.prev.copy(lp);
      h.has = true;
      const gp = h.source.gamepad;
      h.squeeze = !!(gp && gp.buttons[1] && gp.buttons[1].pressed);
      anyGrip = anyGrip || h.squeeze;
      // gripping the front of the board: hand ahead of and below the head
      if (h.squeeze && lp.z < -0.12 && lp.y < -0.05) noseGrip = true;
      // paddling: backward sweep below chest height pushes water
      const inWater = lp.y < -0.22;
      const back = h.vel.z;
      const pulling = prone && inWater && back > 0.3 && !h.squeeze;
      const pw = pulling ? Math.min(2.2, back / 1.1) : 0;
      if (pw > 0.5 && !h.stroking) {
        h.stroking = true;
        this.pulse(h, 0.35, 60);
        if (this.onStroke) this.onStroke(h.side, Math.min(1, back / 1.6));
      } else if (pw < 0.2) h.stroking = false;
      if (h.side < 0) pl += pw;
      else pr += pw;
      if (pulling) fastest = Math.max(fastest, back);
      if (gp) {
        const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
        const ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1] || 0;
        if (Math.abs(ax) > Math.abs(stickX)) stickX = ax;
        if (Math.abs(ay) > Math.abs(stickY)) stickY = ay;
        const a = !!(gp.buttons[4] && gp.buttons[4].pressed);
        if (a && !h.btnA) this.events.push('toggleStand');
        h.btnA = a;
        const b = !!(gp.buttons[5] && gp.buttons[5].pressed);
        if (b && !h.btnB) this.events.push('reset');
        h.btnB = b;
      }
    }
    // effort follows how fast the strokes are
    this.effortRaw += (fastest - this.effortRaw) * (1 - Math.exp(-dt / 1.0));
    out.paddle = Math.max(0, Math.min(1, (this.effortRaw - 0.15) / 1.1));
    out.pulse = (pl + pr) * 1.1;
    out.turn = (pr - pl) * 0.28; // stronger right stroke turns left
    if (prone && stickY < -0.2) {
      out.paddle = Math.max(out.paddle, -stickY);
      out.pulse = Math.max(out.pulse, 1);
    }
    out.steer = Math.abs(stickX) > 0.2 ? stickX : 0;
    out.duck = prone && noseGrip;

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
        this.lastWalk = 0;
      }
      if (this.restance) {
        this.stance.x = lh.x;
        this.stance.z = lh.z + (board.walk ? this.lastWalk || 0 : 0);
        this.restance = false;
      }
      // slowly re-centre the stance so drift doesn't accumulate (not along a longboard,
      // where moving forward/back is walking)
      this.stance.x += (lh.x - this.stance.x) * dt * 0.08;
      if (!board.walk) this.stance.z += (lh.z - this.stance.z) * dt * 0.08;
      out.leanX = Math.max(-1, Math.min(1, (lh.x - this.stance.x) / 0.17));
      if (board.walk) out.walkTo = this.lastWalk = -(lh.z - this.stance.z);
      else out.leanZ = Math.max(-1, Math.min(1, -(lh.z - this.stance.z) / 0.17));
      out.crouch = Math.max(0, Math.min(1, (this.standPeak - dy) / 0.4));
      if (Math.abs(stickX) > 0.2) out.leanX = stickX;
      if (Math.abs(stickY) > 0.2) {
        if (board.walk) out.walk = -stickY;
        else out.leanZ = -stickY;
      }
      out.charge = anyGrip;
      this.proneTimer = dy < 0.15 ? this.proneTimer + dt : 0;
      if (this.proneTimer > 0.45) {
        this.proneTimer = 0;
        this.events.push('layDown');
      }
      // whip the head while charged: snap / cutback / tailslide
      this.flickCool = Math.max(0, this.flickCool - dt);
      if (this.flickWin) {
        const w = this.flickWin;
        w.t += dt;
        w.sweep += this.yawRate * dt * w.dir;
        w.peak = Math.max(w.peak, this.yawRate * w.dir);
        if ((w.t > 0.12 && this.yawRate * w.dir < 1.2) || w.t > 0.45) {
          // head turns are slower and shorter than mouse flicks: scale into the same units
          this.events.push({ flick: w.dir, omega: w.peak * 1.8, sweep: w.sweep * 1.3 });
          this.flickWin = null;
          this.flickCool = 0.4;
        }
      } else if (anyGrip && this.flickCool <= 0 && Math.abs(this.yawRate) > 2.4) {
        this.flickWin = { dir: Math.sign(this.yawRate), t: 0, sweep: 0, peak: 0 };
      }
    } else {
      this.flickWin = null;
      this.restance = false;
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
