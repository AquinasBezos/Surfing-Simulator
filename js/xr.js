// Meta Quest / WebXR controls.
//   Paddle     : sweep a hand from front to back below chest height ("in the water"), any
//                way you hold the controller (thumbs up, or turned in with the palm down and
//                the grip squeezed). Faster strokes paddle faster; a stronger right stroke
//                turns you left.
//   Duck dive  : while paddling, squeeze a grip with that hand held still on the front of
//                the board (a hand squeezing the grip as it sweeps past is still paddling).
//   Pop-up     : physically stand up (head rises > 35 cm above the calibrated paddling height,
//                quickly, or all the way).
//   Sit up     : rise slowly to about half way and stay there (wait for a set); lie back down
//                to paddle again.
//   Surf       : lean your head/torso left/right to carve, forward to trim, back to stall.
//   Crouch     : crouch for real; stand up fast at the lip to hop off it.
//   Manoeuvre  : hold either grip to charge, then whip your head left/right.
//   Longboard  : walk forward / back on the board for real.
//   Buttons    : remappable (bindings.js). Defaults: Y pause menu, B back to the lineup,
//                trigger re-calibrates the paddling position, A/X pop up / lie down, grip
//                duck dives (on the nose) or charges a trick.
//   Fallback   : thumbstick forward = paddle, sideways = steer/lean, back = sit up.
import * as THREE from 'three';
import { createVRHand } from './body.js';
import { STATE } from './surfer.js';
import { controls, QUEST_BUTTON_INDEX } from './bindings.js';
import { leanCurve, cleanLean, FULL_LEAN } from './lean.js';

const Y = new THREE.Vector3(0, 1, 0);

// Is this hand holding the button bound to a Quest action?
function held(h, action) {
  const v = controls.quest[action];
  if (!v || v === 'none' || !h.source) return false;
  const [button, hand] = v.split(':');
  if (hand !== 'any' && hand !== (h.side < 0 ? 'left' : 'right')) return false;
  const gp = h.source.gamepad;
  const b = gp && gp.buttons[QUEST_BUTTON_INDEX[button]];
  return !!(b && b.pressed);
}

// button actions that fire once per press, and the event each one sends
const PRESS_ACTIONS = { pause: 'pause', lineup: 'reset', recalibrate: 'recalibrate', popup: 'toggleStand' };

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
    this.headQuat = this._q; // the head's orientation this frame (reference space)
    this._v = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const ctrl = renderer.xr.getController(i);
      rig.add(grip, ctrl);
      const h = { grip, ctrl, source: null, side: i === 0 ? -1 : 1, model: null, prev: new THREE.Vector3(), vel: new THREE.Vector3(), has: false, stroking: false, holding: false, noseT: 0, onNose: false };
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
      this.hands.push(h);
    }
    this.lean = cleanLean(null); // response curves for leaning (settings)
    this.leanRaw = null; // { x, z } your lean now, while standing (for the menu's graph)
    this.pressed = {}; // action -> held last frame
    this.sticks = { left: [0, 0], right: [0, 0] }; // thumbstick x, y per hand (drone flying)
  }

  // Ignore buttons that are held right now until they're let go (the trigger that just
  // clicked a menu button shouldn't also recalibrate).
  swallowButtons() {
    for (const action of Object.keys(PRESS_ACTIONS)) this.pressed[action] = true;
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
    this.headPitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    if (!this.calibrated) this.calibrate();
    // where you're looking relative to the board (shown on your character to other players)
    this.lookYaw = Math.atan2(Math.sin(this.headYaw - this.yaw0), Math.cos(this.headYaw - this.yaw0));
    this.lookPitch = this.headPitch;
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
    const sitting = state === STATE.SITTING;
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
        // the headset's own velocity for the hand (it blends the cameras with the
        // controller's motion sensors, so it holds up when the hand is low by your side where
        // the cameras see it badly); otherwise from how far it moved
        const v = h.grip.hasLinearVelocity ? this._v.copy(h.grip.linearVelocity).applyAxisAngle(Y, -this.yaw0) : lp.clone().sub(h.prev).divideScalar(dt);
        h.vel.lerp(v, 1 - Math.exp(-dt * 20));
      }
      h.prev.copy(lp);
      h.has = true;
      const gp = h.source.gamepad;
      h.holding = held(h, 'duck');
      anyGrip = anyGrip || held(h, 'charge');
      // holding the front of the board: grip squeezed with the hand ahead of and below the
      // head, held still there a moment (paddling with a squeezed grip sweeps through)
      const atNose = h.holding && lp.z < -0.12 && lp.y < -0.05;
      h.noseT = atNose && h.vel.length() < 0.8 ? h.noseT + dt : 0;
      h.onNose = h.holding && (h.onNose || h.noseT > 0.18);
      if (h.onNose) noseGrip = true;
      // paddling: backward sweep below chest height pushes water
      const inWater = lp.y < -0.18;
      const back = h.vel.z;
      const pulling = prone && inWater && back > 0.3 && !h.onNose;
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
        const st = this.sticks[h.side < 0 ? 'left' : 'right'];
        st[0] = ax;
        st[1] = ay;
      }
    }
    // one-shot button actions fire on the press
    for (const [action, event] of Object.entries(PRESS_ACTIONS)) {
      const now = this.hands.some((h) => held(h, action));
      if (now && !this.pressed[action]) this.events.push(event);
      this.pressed[action] = now;
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

    // pop-up by standing up for real; sitting up by rising slowly part of the way
    const dy = lh.y;
    if (dt > 0) this.riseRate = (this.riseRate || 0) + ((dy - (this.prevDy ?? dy)) / dt - (this.riseRate || 0)) * (1 - Math.exp(-dt / 0.08));
    this.prevDy = dy;
    if (prone) {
      // a pop-up is quick; a slow rise only counts once you're nearly all the way up
      this.standTimer = dy > 0.35 && (this.riseRate > 0.9 || dy > 0.75) ? this.standTimer + dt : 0;
      this.sitTimer = dy > 0.22 && dy < 0.75 && Math.abs(this.riseRate) < 0.35 ? (this.sitTimer || 0) + dt : 0;
      if (this.sitTimer > 0.5) {
        this.sitTimer = 0;
        this.events.push('sit');
      }
      if (this.standTimer > 0.12) {
        this.standTimer = 0;
        this.events.push('popUp');
        this.stance.copy(lh);
        this.standPeak = dy;
      }
    } else this.standTimer = this.sitTimer = 0;
    // thumbstick fallback: pull back to sit up, push forward to lie down again
    this.stickTimer = (prone && stickY > 0.7) || (sitting && stickY < -0.6) ? (this.stickTimer || 0) + dt : 0;
    if (this.stickTimer > 0.3) {
      this.stickTimer = 0;
      this.events.push(prone ? 'sit' : 'layDown');
    }
    // sitting: lie back down to paddle
    if (sitting) {
      this.downTimer = dy < 0.15 ? (this.downTimer || 0) + dt : 0;
      if (this.downTimer > 0.3) {
        this.downTimer = 0;
        this.events.push('layDown');
      }
    } else this.downTimer = 0;
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
      // leaning, through your sensitivity curves
      const rx = (lh.x - this.stance.x) / FULL_LEAN,
        rz = -(lh.z - this.stance.z) / FULL_LEAN;
      this.leanRaw = { x: rx, z: rz };
      out.leanX = leanCurve(rx, this.lean.x);
      if (board.walk) out.walkTo = this.lastWalk = -(lh.z - this.stance.z);
      else out.leanZ = leanCurve(rz, this.lean.z);
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
      this.leanRaw = null;
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
