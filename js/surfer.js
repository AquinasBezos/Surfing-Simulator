// Board physics and the prone / pop-up / standing / wipeout state machine.
//
// The board rides on the smooth (un-curled) wave surface. Gravity acts along the slope,
// water drag acts relative to the moving water (orbital velocity on the wave face, the
// push of whitewater), and the fins convert sideways slip into forward speed (carving).
// On top of that: effort-based paddling, duck dives, crouching, leg-extension pops and
// airs, walking on a longboard, and snap / cutback / tailslide manoeuvres.
import * as THREE from 'three';
import { GRAVITY, LINEUP_Z, WAVE, WAVE_HEIGHTS, BOARDS } from './config.js';
import { clamp, smoothstep, mix, CURL } from './wave.js';
import { boardBottom } from './board.js';

export const STATE = { PRONE: 'prone', POPUP: 'popup', STANDING: 'standing', WIPEOUT: 'wipeout', SITTING: 'sitting' };

const POPUP_TIME = 0.42;
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

const moveToward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

// Where along the board (0 tail .. 1 nose) it's checked against the water as it's drawn
const RIDE_T = [0.03, 0.2, 0.4, 0.6, 0.75, 0.87, 0.95, 1];
const RIDE_X = new THREE.Vector3(1, 0, 0);
const _rp = new THREE.Vector3();
const _ru = new THREE.Vector3();
const _rz = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rf = new THREE.Vector3();
const _rr = new THREE.Vector3();
const _fu = new THREE.Vector3();

// Backflip: crouch with Snap held, spring up out of the crouch into the air, let go of Snap just
// after you uncrouch (within FLIP_RELEASE s) and look up sharply, and you throw yourself over
// backwards. FLIP_SPIN: how
// fast you go round for a firm flick (rad/s; a sharper one faster); FLIP_POP: the lift the throw
// adds (m/s); FLIP_PIVOT: how far above the board you turn (your middle, m). Land before you're
// FLIP_LAND of the way round and you wipe out; past it, you ride away.
export const FLIP_PIVOT = 0.8;
const FLIP_RELEASE = 0.45,
  FLIP_SPIN = 11,
  FLIP_POP = 2.2,
  FLIP_LAND = 2 * Math.PI - 0.6;

// The least change to the drawn board that keeps it out of the water: a turn about its middle
// (phi, + nose up) and a lift (dy >= 0). need[i]: how far station i is too deep; k[i]: how much
// it comes up per radian of nose-up turn. Turning is preferred to lifting (a centimetre of lift
// costs as much as 2.3 degrees of turn); the small squared terms make the answer unique, so it
// moves smoothly from frame to frame instead of flicking between equally good ones. The cost
// is convex in phi (dy is the least lift for that turn), so a ternary search finds it.
// Returns [phi, dy].
const RIDE_W = 4,
  RIDE_PHI = 0.9,
  RIDE_DY = 0.3;
function solveRide(need, k, n) {
  const lift = (phi) => {
    let dy = 0;
    for (let i = 0; i < n; i++) dy = Math.max(dy, need[i] - k[i] * phi);
    return dy;
  };
  const cost = (phi) => {
    const dy = lift(phi);
    return RIDE_W * dy + 20 * dy * dy + Math.abs(phi) + 2 * phi * phi + (dy > RIDE_DY ? 100 * (dy - RIDE_DY) : 0);
  };
  let a = -RIDE_PHI,
    b = RIDE_PHI;
  for (let it = 0; it < 32; it++) {
    const m1 = a + (b - a) / 3,
      m2 = b - (b - a) / 3;
    if (cost(m1) < cost(m2)) b = m2;
    else a = m1;
  }
  const phi = (a + b) / 2;
  return [phi, Math.min(RIDE_DY, lift(phi))];
}

export class Surfer {
  constructor(model) {
    this.model = model;
    this.board = BOARDS.shortboard;
    this.boardType = 'shortboard';
    this.x = 0;
    this.z = LINEUP_Z;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0; // three.js rotation.y; forward = (-sin yaw, -cos yaw)
    this.state = STATE.PRONE;
    this.stateTime = 0;
    this.leanX = 0;
    this.leanZ = 0;
    this.braceX = 0; // your weight shifted right (+) / toward the nose (+), whatever you're doing: braces you for a bump (bump.js)
    this.braceZ = 0;
    this.knockX = 0; // a bump's sideways shove (m/s), easing off
    this.knockZ = 0;
    this.crouch = 0;
    this.footPos = 0; // longboard: stance position along the board (m from centre, + = nose)
    this.charge = 0; // snap/tailslide charge (Shift / grip)
    this.move = null; // active manoeuvre
    this.roll = 0;
    this.pitch = 0;
    this.yawRate = 0;
    this.paddleEffort = 0;
    this.air = false;
    this.airTime = 0;
    this.popVel = 0;
    this.diving = false;
    this.diveDepth = 0;
    this.diveRate = 0;
    this.diveT = 0;
    this.diveCool = 0;
    // longboard: you can't push it under, so you turtle roll: flip it over and hang on
    // underneath while the wave passes over. 0..1 how far over it is
    this.turtle = 0;
    this.turtleT = 0;
    this.flip = null; // a backflip under way: { angle (rad, 0 .. 2 pi), rate, done }
    this.flipArm = null; // uncrouched with Snap held: { t: since (s), release: when you let go of Snap (s after) }
    this.flipRest = 0; // (what's left of a flip landed a little short, easing out)
    this.flipGrab = 0; // 0 .. 1: tucked and holding the nose rail through a backflip (it's only drawn)
    this.upFlickT = 9; // since you last looked up sharply (s), and how sharply
    this.upFlickPower = 0;
    this.quatBase = new THREE.Quaternion(); // the view's frame: the surface under you (smoothed), with the board's lean and trim
    this.effPitch = 0; // nose-down angle of the board including a pitching ledge (rad)
    this.ledgePitch = 0; // ...of which the pitching ledge, beyond the smooth surface (rad)
    this.ride = { tilt: 0, lift: 0 }; // how the drawn board was moved to sit on the water (rideOnWater)
    this.pearlT = 0;
    this.ceiling = Infinity; // height of the lip above the board (m)
    this.lipT = 0;
    this.normal = new THREE.Vector3(0, 1, 0); // the surface under you, smoothed for the view
    this.normalBoard = new THREE.Vector3(0, 1, 0); // ...and closely, for the board as it's drawn
    this.quat = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.flipShift = new THREE.Vector3(); // how far a backflip has moved the board from where it rides (it turns about your middle)
    this.s = {};
    this.wipeReason = '';
    this.inTube = false;
    this.riding = false;
    this.catching = false;
    this.onEvent = null; // (type, data)
    this.collide = null; // (surfer) => impact speed: walls and piers at the spot (a pool)
    this._n = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.tumble = 0;
  }

  setBoard(type) {
    this.board = BOARDS[type] || BOARDS.shortboard;
    this.boardType = BOARDS[type] ? type : 'shortboard';
    this.footPos = 0;
  }

  // How fast the board moves through the water: what makes it plane and turn. On the sea
  // that's taken as the speed over the ground (the physics was tuned that way); on a river
  // you can hold still on a standing wave with the water rushing under you, so it's the
  // speed relative to the water there.
  get planeSpeed() {
    if (!this.model.river) return this.speed;
    return Math.hypot(this.vx, this.vz - (this.s.waterVz || 0));
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forward() {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  emit(type, data = {}) {
    if (this.onEvent) this.onEvent(type, data);
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.yaw = yaw;
    this.yawRate = 0;
    this.leanX = this.leanZ = this.crouch = this.footPos = this.charge = 0;
    this.braceX = this.braceZ = this.knockX = this.knockZ = 0;
    this.legCrouch = this.stanceCrouch = 0;
    this.roll = this.pitch = 0;
    this.tumble = 0;
    this.move = null;
    this.air = false;
    this.airTime = 0;
    this.popVel = 0;
    this.diving = false;
    this.diveDepth = this.diveRate = 0;
    this.turtle = 0;
    this.flip = this.flipArm = null;
    this.flipRest = this.flipGrab = 0;
    this.pearlT = this.lipT = 0;
    this.ledgePitch = 0;
    this.paddleEffort = 0;
    this.setState(STATE.PRONE);
    this.inTube = false;
    this.riding = false;
    this.model.sample(x, z, this.s);
    this.y = this.s.height;
    this.normal.set(0, 1, 0);
    this.normalBoard.set(0, 1, 0);
    this.updatePose(1);
  }

  setState(st) {
    if (this.state === st) return;
    const prev = this.state;
    this.state = st;
    this.stateTime = 0;
    this.pearlT = 0;
    if (st !== STATE.STANDING) this.move = null;
    this.emit('state', { from: prev, to: st });
  }

  popUp() {
    if (this.state === STATE.PRONE && !this.diving) this.setState(STATE.POPUP);
  }

  layDown() {
    if ((this.state === STATE.STANDING || this.state === STATE.POPUP || this.state === STATE.SITTING) && !this.air) this.setState(STATE.PRONE);
  }

  // Sit up on the board (from lying down) to wait for a set.
  sit() {
    if (this.state === STATE.PRONE && !this.diving && !this.air) this.setState(STATE.SITTING);
  }

  wipeout(reason) {
    if (this.state === STATE.WIPEOUT) return;
    this.wipeReason = reason;
    this.air = false;
    this.diving = false;
    this.knockX = this.knockZ = 0;
    this.flip = this.flipArm = null;
    this.setState(STATE.WIPEOUT);
    this.emit('wipeout', { reason });
  }

  // Bumped by another surfer (bump.js): a change of speed along the board (m/s, + forward),
  // which it glides on with, and across it (+ right), which the fins, the rails or your legs
  // soon stop (it's kept apart, so the fins don't turn it into speed); and a spin (rad/s, +
  // left), which eases off as you steer.
  bumped(dvLong, dvLat, dYaw) {
    if (this.state === STATE.WIPEOUT) return;
    const [fx, fz] = this.forward;
    this.vx += fx * dvLong;
    this.vz += fz * dvLong;
    this.knockX += -fz * dvLat;
    this.knockZ += fx * dvLat;
    if (!this.move) this.yawRate += clamp(dYaw, -6, 6);
  }

  // A sharp look upwards (power: how sharp, about 1 for a firm flick). In the air, after a pop
  // with Snap let go in time, it throws you into a backflip (updateFlip).
  flipUp(power = 1) {
    this.upFlickT = 0;
    this.upFlickPower = power;
  }

  // crouch as it's drawn and sent (others' and the replay's character): through a backflip
  // you tuck right down (1) and above 1 is how far you've reached for the rail (character.js)
  get poseCrouch() {
    const g = this.flipGrab;
    return g ? this.crouch + (1 - this.crouch) * Math.min(1, g * 2) + g : this.crouch;
  }

  // how far round a backflip has turned you (rad; 0 when you're not flipping)
  get flipAngle() {
    return this.flip ? this.flip.angle : this.flipRest;
  }

  // A quick look/head turn while charged: snap, cutback or tailslide toward `dir`
  // (+1 = left, -1 = right). omega: peak turn speed (rad/s), sweep: how far the look turned.
  flick(dir, omega, sweep) {
    if (this.state !== STATE.STANDING || this.air || this.move || this.charge < 0.15 || this.planeSpeed < 3) return null;
    const same = this.yawRate * dir; // > 0 when already turning that way
    let kind, theta, dur, slide = 0, loss;
    if (omega > 10 || (omega > 6.5 && same > 1.0)) {
      kind = 'tailslide';
      theta = clamp(1.25 + 0.07 * omega, 1.4, 2.3);
      dur = 0.28;
      slide = 0.5;
      loss = 0.1;
    } else if (sweep > 1.3) {
      kind = 'cutback';
      theta = clamp(2.3 + 0.35 * (sweep - 1.3), 2.3, 3.0);
      dur = 0.9;
      loss = 0.16;
    } else {
      kind = 'snap';
      theta = clamp(0.6 + 0.09 * omega + 0.35 * sweep, 0.75, 1.7);
      dur = 0.3;
      loss = 0.08;
    }
    theta *= mix(0.6, 1, this.charge) * (this.board.walk ? 0.85 : 1);
    this.move = { kind, dir, theta, dur, slide, loss, t: 0, yaw0: this.yaw };
    this.charge = 0;
    this.emit('maneuver', { kind, dir });
    return kind;
  }

  // input: { paddle, pulse, turn, steer, leanX, leanZ, walk, walkTo, crouch, duck, charge }
  update(dt, input) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, input);
    this.updatePose(dt);
  }

  step(h, inp) {
    const s = this.model.sample(this.x, this.z, this.s);
    const B = this.board;
    this.stateTime += h;
    if (this.state === STATE.POPUP && this.stateTime > POPUP_TIME) this.setState(STATE.STANDING);

    // surface gradient (finite differences on the smooth surface)
    const e = 0.06;
    const hx = (this.model.heightAt(this.x + e, this.z) - this.model.heightAt(this.x - e, this.z)) / (2 * e);
    const hz = (this.model.heightAt(this.x, this.z + e) - this.model.heightAt(this.x, this.z - e)) / (2 * e);
    this._gx = hx;
    this._gz = hz;

    const standing = this.state === STATE.STANDING;
    const prone = this.state === STATE.PRONE || this.state === STATE.POPUP;
    const sitting = this.state === STATE.SITTING;

    // --- stance ---
    const k = 1 - Math.exp(-h * (standing ? 7 : 4));
    this.leanX += ((standing && !this.move ? inp.leanX : 0) - this.leanX) * k;
    this.leanZ += ((standing && !B.walk ? inp.leanZ : 0) - this.leanZ) * k;
    if (standing && B.walk) {
      if (inp.walkTo != null) this.footPos += (clamp(inp.walkTo, B.footMin, B.footMax) - this.footPos) * (1 - Math.exp(-h * 8));
      else this.footPos = clamp(this.footPos + (inp.walk || 0) * 0.8 * h, B.footMin, B.footMax);
    } else if (!standing) this.footPos = moveToward(this.footPos, 0, h * 2);
    // (bracing: your lean even lying down or sitting, as your weight shifts to a rail; toward the
    // nose only standing on a shortboard, where that's the stance's own lean)
    const kb = 1 - Math.exp(-h * 7);
    this.braceX += ((this.state === STATE.WIPEOUT ? 0 : inp.leanX || 0) - this.braceX) * kb;
    this.braceZ += ((standing && !B.walk ? inp.leanZ || 0 : 0) - this.braceZ) * kb;
    this.charge = standing && inp.charge ? Math.min(1, this.charge + h / 0.45) : Math.max(0, this.charge - h * 4);
    // deliberate crouching (Ctrl / your real knees) drives the leg-extension pop; charging a
    // manoeuvre or stalling just compresses the stance
    const prevLeg = this.legCrouch || 0;
    this.legCrouch = prevLeg + ((standing ? inp.crouch || 0 : 0) - prevLeg) * (1 - Math.exp(-h * 11));
    const ext = Math.max(0, (prevLeg - this.legCrouch) / h); // leg extension rate
    const stance = standing ? Math.max(0.45 * this.charge, this.move ? 0.45 : 0, Math.max(-this.leanZ, 0) * 0.5) : 0;
    this.stanceCrouch = (this.stanceCrouch || 0) + (stance - (this.stanceCrouch || 0)) * (1 - Math.exp(-h * 6));
    this.crouch = Math.max(this.legCrouch, this.stanceCrouch);

    if (this.state === STATE.WIPEOUT) {
      // tumbling in the whitewater: carried by the water, no control
      const kk = 1 - Math.exp(-h * 2.5);
      this.vx += (0 - this.vx) * kk;
      this.vz += (s.waterVz * 0.9 - this.vz) * kk;
      this.x += this.vx * h;
      this.z += this.vz * h;
      this.tumble += h;
      this.diveDepth = moveToward(this.diveDepth, 0, h);
      this.y = s.height - Math.min(1.4, this.tumble * 1.5);
      return;
    }

    this.updateDive(h, inp);
    const deep = this.diveDepth > 0.35 || this.turtle > 0.8;
    // (upside down under the board you're pushed back less, though more than duck diving)
    const wvz = s.waterVz * Math.exp(-this.diveDepth * 1.4) * (1 - 0.6 * this.turtle);

    // --- forces ---
    // A board drifting with the water just rides the orbital motion (the slope is what
    // drives the water itself); only once it moves through the water (paddling, planing)
    // does it slide down the face. So scale slope gravity by the speed relative to the water.
    const g2 = hx * hx + hz * hz;
    const relSp = Math.hypot(this.vx, this.vz - wvz);
    let plane = standing ? mix(0.45, 1, smoothstep(B.planeLo - 0.3, B.planeHi, relSp)) : mix(0.2, 1, smoothstep(1.1, 3.0, relSp));
    if (sitting) plane = 0.12; // upright with your legs in the water: the board barely slides
    // extending out of a crouch presses the board into the face (pumping)
    if (standing && ext > 0.5) plane *= 1 + Math.min(0.7, ext * 0.12);
    if (this.diving) plane *= 1 - smoothstep(0.1, 0.6, this.diveDepth);
    let ax = (-GRAVITY * hx * plane) / (1 + g2);
    let az = (-GRAVITY * hz * plane) / (1 + g2);
    const [fx, fz] = this.forward;
    const rx = -fz,
      rz = fx; // right vector (x, z) = (cos yaw, -sin yaw)
    const slope = Math.sqrt(g2);

    // paddling: effort sets the speed you can paddle at, each stroke pushes toward it
    let thrust = 0;
    const vfw = this.vx * fx + (this.vz - wvz) * fz;
    const effort = this.state === STATE.PRONE && !this.diving ? clamp(inp.paddle || 0, 0, 1) : 0;
    this.paddleEffort += (effort - this.paddleEffort) * (1 - Math.exp(-h * 3));
    if (effort > 0.02) {
      const vTop = B.paddleTop * mix(0.35, 1, effort);
      const v = Math.max(vfw, 0);
      const lin = mix(0.38, 0.2, smoothstep(2.2, 4.5, v));
      const drag = lin * v + 0.11 * v * v;
      thrust = (inp.pulse || 0) * Math.max(0, drag + (vTop - v) / B.paddleTau) * smoothstep(vTop + 0.5, vTop - 0.05, v);
    }
    if (thrust > 0.25) this.lastStroke = 0;
    else this.lastStroke = (this.lastStroke ?? 9) + h;
    if (standing && this.leanZ > 0.1 && slope > 0.1 && this.planeSpeed > 2) thrust += 1.1 * this.leanZ * Math.min(1, slope * 3);
    ax += fx * thrust;
    az += fz * thrust;

    // Catching: a paddler stroking on the steep part of the face, pointed at the beach,
    // gets picked up by the wave and accelerated toward its speed.
    this.catching = false;
    if (prone && !this.diving && this.lastStroke < 0.7 && s.wave && s.H > 0.6 && s.un > 0.05 && s.un < 1.5 && slope > 0.16 && fz > 0.35) {
      const pull = 2.4 * B.catchBoost * mix(0.45, 1, this.paddleEffort) * smoothstep(0.16, 0.45, slope) * smoothstep(0.35, 0.8, fz);
      az += Math.max(0, WAVE.speed * 0.95 - this.vz) * pull;
      this.catching = true;
    }

    if (!this.air) {
      this.vx += ax * h;
      this.vz += az * h;

      // --- drag relative to the water ---
      let rvx = this.vx,
        rvz = this.vz - wvz;
      let vf = rvx * fx + rvz * fz;
      let vl = rvx * rx + rvz * rz;
      const sp = Math.hypot(vf, vl);
      const m = this.move;
      const sliding = m && m.kind === 'tailslide' && m.t < m.dur + m.slide;
      if (standing) {
        const planing = smoothstep(B.planeLo, B.planeHi, sp);
        let lin = mix(0.65, 0.07, planing);
        let quad = 0.042;
        lin *= 1 - 0.3 * Math.max(this.leanZ, 0);
        lin += 1.6 * Math.max(-this.leanZ, 0) * planing; // stall
        lin += 0.07 * Math.abs(this.yawRate) * planing; // carving costs a little speed
        // a river wave: ridden with your weight back in rough water, so you hold a spot on the
        // face rather than sinking to its foot (W / S still take you down and up it)
        if (this.model.river) lin += 0.55 * planing;
        if (B.walk) {
          // longboard: trim forward glides, stepping back stalls
          lin *= 1 - 0.3 * smoothstep(0.2, 1.0, this.footPos);
          lin += 0.9 * smoothstep(0.3, 1.0, -this.footPos) * planing;
        }
        quad += 0.05 * smoothstep(8.5, 12, sp); // hull speed: hard to go much faster
        vf -= (lin * vf + quad * vf * Math.abs(vf)) * h;
        if (sliding) {
          // fins released: the board skids sideways and scrubs speed
          vl *= Math.exp(-h * 1.25);
        } else {
          // fins: sideways slip is converted to forward speed
          const vl2 = vl * Math.exp(-h * 7.5);
          vf += Math.sign(vf || 1) * (Math.abs(vl) - Math.abs(vl2)) * (m ? 0.7 : 0.82);
          vl = vl2;
        }
      } else {
        const lin = mix(0.38, 0.2, smoothstep(2.2, 4.5, sp)) + (this.diving ? 0.8 : 0) + (sitting ? 1.4 : 0),
          quad = 0.11;
        vf -= (lin * vf + quad * vf * Math.abs(vf)) * h;
        const vl2 = vl * Math.exp(-h * 2.6);
        vf += Math.sign(vf || 1) * (Math.abs(vl) - Math.abs(vl2)) * 0.3;
        vl = vl2;
      }
      this.vx = vf * fx + vl * rx;
      this.vz = vf * fz + vl * rz + wvz;
    }

    // --- steering ---
    const speed = this.planeSpeed;
    if (this.move) {
      const m = this.move;
      m.t += h;
      const p = Math.min(1, m.t / m.dur);
      const ease = 1 - Math.pow(1 - p, 3);
      const yaw = m.yaw0 + m.dir * m.theta * ease;
      this.yawRate = (yaw - this.yaw) / h;
      this.yaw = yaw;
      if (m.t >= m.dur + m.slide) {
        const f = 1 - m.loss;
        this.vx *= f;
        this.vz = wvz + (this.vz - wvz) * f;
        this.move = null;
        this.yawRate *= 0.2;
      }
    } else if (standing) {
      let turn = B.turn;
      if (B.walk) turn *= mix(1, 0.35, smoothstep(0.2, 1.0, this.footPos)) * mix(1, 2.1, smoothstep(0.2, 0.9, -this.footPos));
      const target = this.air ? 0 : -this.leanX * Math.min(2.8, 0.55 + 0.3 * speed) * turn;
      this.yawRate += (target - this.yawRate) * (1 - Math.exp(-h * 6));
    } else if (prone) {
      // steer: +1 = right (D). turn: VR paddling differential in rad/s, + = left.
      const target = (-inp.steer * 1.25) / (1 + 0.18 * speed) + (inp.turn || 0);
      this.yawRate += (target - this.yawRate) * (1 - Math.exp(-h * 5));
    } else if (sitting) {
      // eggbeater kicks swing the board round slowly
      this.yawRate += (-inp.steer * 0.75 - this.yawRate) * (1 - Math.exp(-h * 3));
    }
    if (!this.move) this.yaw += this.yawRate * h;

    this.x += this.vx * h;
    this.z += this.vz * h;
    if (this.knockX || this.knockZ) {
      // a bump's sideways shove (bump.js): the fins, the rails, or your legs in the water stop it
      this.x += this.knockX * h;
      this.z += this.knockZ * h;
      const kd = Math.exp(-h * (standing ? 5 : sitting ? 3 : 2.6));
      this.knockX *= kd;
      this.knockZ *= kd;
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 1e-3) this.knockX = this.knockZ = 0;
    }
    if (this.collide) {
      const hit = this.collide(this);
      // (a pool's walls take a proper crash; a river's narrow channel, much less)
      if (hit > (this.model.river ? 1.5 : 3.5) && this.state === STATE.STANDING) return this.wipeout('Ran into the wall');
    }

    this.snapHeld = !!inp.charge;
    // springing up out of a crouch with Snap held: a backflip's on, if you let go of it in time
    const crouchIn = standing && (inp.crouch || 0) > 0.5;
    if (this.crouchHeld && !crouchIn && this.snapHeld && !this.air) this.flipArm = { t: 0, release: null };
    this.crouchHeld = crouchIn;
    this.updateVertical(h, s, ext);
    if (this.state === STATE.WIPEOUT) return;
    this.updateFlip(h, inp);
    this.updatePitch(h, hx, hz, slope, fx, fz, s);
    if (!this.air) this.checkRules(s, h, deep);
  }

  // Duck dive: hold to push the board under, release to float back up. On a longboard the
  // same input turtle rolls instead: over (about half a second), hold on, back up on release.
  updateDive(h, inp) {
    const can = this.state === STATE.PRONE && !this.air;
    const want = can && !!inp.duck;
    const prev = this.diveDepth;
    this.diveCool = Math.max(0, this.diveCool - h);
    if (this.board.walk || this.turtle > 0) {
      if (want && !this.diving && this.diveCool <= 0 && this.board.walk) {
        this.diving = true;
        this.turtleT = 0;
        this.emit('duckdive', { turtle: true });
      }
      if (this.diving) {
        this.turtleT += h;
        const hold = want && this.turtleT < 4;
        this.turtle = moveToward(this.turtle, hold ? 1 : 0, (hold ? 1 / 0.55 : 1 / 0.65) * h);
        if (!can || (!hold && this.turtle <= 0.001)) {
          this.diving = false;
          this.diveCool = 0.5;
          this.emit('surface', {});
        }
      } else this.turtle = moveToward(this.turtle, 0, h / 0.65);
      this.diveDepth = moveToward(this.diveDepth, 0, 1.5 * h);
      this.diveRate = (this.diveDepth - prev) / h;
      return;
    }
    if (want && !this.diving && this.diveCool <= 0) {
      this.diving = true;
      this.diveT = 0;
      this.emit('duckdive', {});
    }
    if (this.diving) {
      this.diveT += h;
      const hold = want && this.diveT < 3.2;
      const target = hold ? 0.95 + 0.25 * Math.min(this.speed, 2.4) : 0;
      this.diveDepth = moveToward(this.diveDepth, target, (target > this.diveDepth ? 2.4 : 1.5) * h);
      if (!can || (!hold && this.diveDepth <= 0.001)) {
        this.diving = false;
        this.diveCool = 0.5;
        this.emit('surface', {});
      }
    } else this.diveDepth = moveToward(this.diveDepth, 0, 1.5 * h);
    this.diveRate = (this.diveDepth - prev) / h;
  }

  // Vertical motion: glued to the surface until the surface drops away faster than gravity
  // (cresting the lip at speed) or a leg extension pops the board up, then ballistic.
  updateVertical(h, s, ext) {
    // sitting up, more of your weight is on the board: it floats a little lower
    const target = this.model.heightAt(this.x, this.z) - this.diveDepth - (this.state === STATE.SITTING ? 0.07 : 0) - 0.12 * this.turtle;
    const standing = this.state === STATE.STANDING;
    if (!this.air) {
      const vySurf = (target - this.y) / h;
      let launch = null;
      if (standing) {
        // extending the legs pushes down on the board; the rebound pops it up
        if (ext > 1.2) this.popVel = Math.max(this.popVel, Math.min(2.4, ext * 0.42) * mix(0.35, 1, smoothstep(2, 7, this.planeSpeed)));
        else {
          if (this.popVel > 0.6) launch = vySurf + this.popVel;
          this.popVel = 0;
        }
        // going up and over the top of the wave fast enough leaves the water (suction keeps
        // most of the upward speed from carrying over)
        const aReq = (vySurf - this.vy) / h;
        // (not while turning off the top: the fins hold the board in for snaps)
        const nearTop = s.wave && (s.yb > 0.82 || s.un < -0.1);
        const turning = this.move || this.charge > 0.1;
        if (launch === null && !turning && nearTop && this.vy > 3.5 && aReq < -GRAVITY * 2.6) launch = Math.min(this.vy, 4.5) * 0.55;
      } else this.popVel = 0;
      if (launch !== null && launch > vySurf + 0.3) {
        this.air = true;
        this.airTime = 0;
        this.vy = launch;
        this.y += this.vy * h;
        // a turn can't continue without water under the fins
        if (this.move) {
          this.move = null;
          this.yawRate = 0;
        }
        this.flip = null;
        this.emit('takeoff', {});
      } else {
        this.y = target;
        this.vy = vySurf;
      }
    } else {
      this.vy -= GRAVITY * h;
      this.y += this.vy * h;
      this.airTime += h;
      if (this.y <= target) this.land(target);
    }
  }

  // A backflip: once armed (you sprang out of a crouch with Snap held), let go of Snap in time,
  // and once you're in the air with a sharp look up just before or then, over you go, about
  // your middle, at a rate set by how sharply you looked. It stops once you're all the way round.
  updateFlip(h, inp) {
    this.upFlickT += h;
    const A = this.flipArm;
    if (A) {
      A.t += h;
      if (!inp.charge && A.release === null) A.release = A.t;
      // (too late letting go, or never left the water)
      if ((A.release !== null && A.release > FLIP_RELEASE) || (A.release === null && A.t > FLIP_RELEASE) || (!this.air && A.t > 1)) this.flipArm = null;
    }
    if (!this.air) return;
    if (this.flipArm && !this.flip) {
      if (this.flipArm.release !== null && this.upFlickT < 0.3) {
        this.flip = { angle: 0, rate: FLIP_SPIN * clamp(this.upFlickPower, 0.8, 1.25), done: false };
        this.flipArm = null;
        this.vy += FLIP_POP;
        this.emit('flipstart', {});
      }
    }
    const F = this.flip;
    if (F && !F.done) {
      F.angle = Math.min(2 * Math.PI, F.angle + F.rate * h);
      F.done = F.angle >= 2 * Math.PI;
    }
  }

  land(target) {
    this.air = false;
    this.y = target;
    const flip = this.flip;
    this.flip = this.flipArm = null;
    if (flip) {
      // not far enough round: you land on your back, or the nose
      if (flip.angle < FLIP_LAND) return this.wipeout('Under-rotated the backflip');
      this.flipRest = flip.angle - 2 * Math.PI; // (a little short: the rest eases out)
      this.emit('backflip', {});
    }
    const [fx, fz] = this.forward;
    // (which way you're going through the water: on a river, relative to it)
    const wvz = this.model.river ? this.s.waterVz || 0 : 0;
    const sp = Math.hypot(this.vx, this.vz - wvz);
    const align = sp > 0.5 ? (this.vx * fx + (this.vz - wvz) * fz) / sp : 1;
    const n = this._n.set(-(this._gx || 0), 1, -(this._gz || 0)).normalize();
    const impact = -(this.vx * n.x + this.vy * n.y + this.vz * n.z);
    const t = this.airTime;
    this.airTime = 0;
    // legs absorb a lot; landing sideways or from a huge drop doesn't work
    if (t > 0.35 && (align < 0.3 || impact > 10)) return this.wipeout(align < 0.3 ? 'Landed sideways' : 'Too big a drop: botched the landing');
    const f = 1 - Math.min(0.35, Math.max(0, impact) * 0.03);
    this.vx *= f;
    this.vz *= f;
    if (t > 0.35) this.emit('air', { time: t });
  }

  // How steeply the nose points down. A pitching lip turns the face toward vertical.
  updatePitch(h, hx, hz, slope, fx, fz, s) {
    const fall = -(hx * fx + hz * fz); // slope along the heading (> 0 = nose down)
    let ang = Math.atan(Math.max(0, fall));
    const surface = ang;
    if (s.wave && slope > 0.05) {
      // when a section pitches the whole upper face goes near-vertical (the ledge)
      const ledge = s.b * (1 - s.kappa) * smoothstep(-0.3, 0.1, s.un) * smoothstep(1.25, 0.75, s.un);
      const align = Math.max(0, fall / slope);
      ang += (Math.PI / 2 - ang) * ledge * align;
    }
    this.effPitch += (ang - this.effPitch) * (1 - Math.exp(-h * 12));
    this.ledgePitch += (ang - surface - this.ledgePitch) * (1 - Math.exp(-h * 12));
  }

  checkRules(s, h, deep) {
    const st = this.state;
    const big = s.wave && s.H > 0.45;
    this.inTube = false;
    this.ceiling = Infinity;
    // standing without enough speed to plane: sink back to prone
    if (st === STATE.STANDING && this.planeSpeed < 1.2 && this.stateTime > 1.0) {
      this._slow = (this._slow || 0) + h;
      if (this._slow > 1.2) {
        this._slow = 0;
        this.setState(STATE.PRONE);
        this.emit('sink', { waveNear: !!big && Math.abs(s.un) < 4 });
        return;
      }
    } else this._slow = 0;

    // nose-dive: lying down as the board goes vertical, or popping up too late
    const ang = this.effPitch;
    let limit = Infinity,
      why = '';
    if (st === STATE.PRONE && !this.diving) {
      limit = 52 * DEG;
      why = 'Pearled! Pop up before the board goes vertical';
    } else if (st === STATE.POPUP) {
      limit = 41 * DEG;
      why = 'Too late! Pearled on the take-off';
    } else if (st === STATE.STANDING && this.board.walk && this.footPos > 0.85) {
      limit = 42 * DEG;
      why = 'Nose-dived off the nose';
    }
    if (ang > limit) {
      this.pearlT += h;
      if (this.pearlT > (st === STATE.POPUP ? 0.1 : 0.18)) return this.wipeout(why);
    } else this.pearlT = 0;

    if (!big) {
      this.riding = false;
      return;
    }
    const un = s.un;
    // a river's standing wave: ride over the top and the water behind it takes you away
    if (s.river && st === STATE.STANDING && !this.air && un < -0.3) return this.wipeout('Washed over the back of the wave');
    // a wider barrel (some spots) lands its lip further out in front
    const tip = CURL.tipShift;
    // small waves: the lip and the whitewater haven't the power to knock you off, so you can
    // keep riding the foam after the wave breaks
    const small = s.H < WAVE_HEIGHTS.small;
    if (!deep) {
      // over the falls: sucked up the face of a pitching section
      if (s.H > 1.0 && s.yb > 0.8 && s.b > 0.3 && un > -0.3 && un < 0.65) return this.wipeout('Over the falls!');
      // the lip lands on you
      if (!small && s.b > 0.55 && un > 1.2 + tip && un < 1.75 + tip && s.kappa < 0.95) return this.wipeout('Smashed by the lip!');
    }
    this.onWhitewater = false;
    if (st === STATE.STANDING) {
      // the whole wave closing out at the end of its life ends the ride gracefully
      if (s.wave.collapseG > 0.3) {
        this.riding = false;
        this.setState(STATE.PRONE);
        this.emit('closeout', {});
        return;
      }
      if (s.kappa > 0.5 && un > -0.3 && un < 2.4 + tip) {
        if (!small) return this.wipeout('Caught inside the whitewater');
        this.onWhitewater = true;
      }
      // the lip overhead: crouch to fit under it (a small wave's lip only hits your legs)
      if (!small && s.b > 0.25 && un > 0.2 && un < 1.7 + tip) {
        const c = this.model.tubeCeiling(s.wave, this.x, this.z, this.y + 0.35);
        this.ceiling = c - this.y;
        const head = mix(1.8, 1.05, this.crouch);
        if (this.ceiling < head) {
          this.lipT += h;
          if (this.lipT > 0.08) return this.wipeout('Clipped by the lip! Crouch under it');
        } else this.lipT = 0;
      } else this.lipT = 0;
      this.inTube = s.b > 0.6 && s.kappa < 0.35 && un > 0.38 && un < 1.25 + tip && s.H > 1.2;
      this.riding = un > -0.7 && un < 3 && this.planeSpeed > 2.2;
    } else {
      this.riding = false;
      // sitting in the impact zone: a big wave's whitewater washes you off the board
      if (st === STATE.SITTING && !small && s.kappa > 0.5 && un > -0.3 && un < 2.0 + tip) return this.wipeout('Caught inside the whitewater');
    }
  }

  updatePose(dt) {
    // The surface normal, smoothed: gently for the view (the camera rides quatBase), closely for
    // the board as it's drawn (quat), which then sits on the water along its length
    // (rideOnWater). Both level out in the air.
    const gx = this._gx || 0,
      gz = this._gz || 0;
    const n = this.air ? this._n.set(0, 1, 0) : this._n.set(-gx, 1, -gz).normalize();
    this.normal.lerp(n, 1 - Math.exp(-dt * (this.air ? 3 : 10))).normalize();
    this.normalBoard.lerp(n, 1 - Math.exp(-dt * (this.air ? 3 : 30))).normalize();
    this.flipRest *= Math.exp(-dt * 14);
    if (Math.abs(this.flipRest) < 1e-3) this.flipRest = 0;
    // grab the rail as you go over, let go as you come round to land
    const grabTo = this.flip && this.flip.angle < 2 * Math.PI - 0.7 ? 1 : 0;
    this.flipGrab += (grabTo - this.flipGrab) * (1 - Math.exp(-dt * (grabTo ? 14 : 7)));
    if (this.flipGrab < 1e-3) this.flipGrab = 0;
    this.position.set(this.x, this.y, this.z);

    // rail lean, trim, dives and ledges
    const st = this.state;
    const standing = st === STATE.STANDING;
    let targetRoll = standing ? -this.leanX * 0.42 : st === STATE.WIPEOUT ? Math.sin(this.tumble * 5) * 1.2 : -this.yawRate * 0.05;
    if (this.move) targetRoll = this.move.dir * (this.move.kind === 'tailslide' ? 0.2 : 0.6);
    let targetPitch = standing ? -this.leanZ * 0.06 : st === STATE.PRONE ? 0.035 : st === STATE.SITTING ? 0.2 : 0;
    if (standing && this.board.walk) targetPitch -= 0.06 * smoothstep(0.3, 1.1, this.footPos) - 0.07 * smoothstep(0.3, 1.0, -this.footPos);
    // the extra steepness of a pitching ledge beyond the smooth surface (only the ledge's: the
    // board already lies along the surface)
    targetPitch -= Math.max(0, this.ledgePitch) * 0.8;
    if (this.diving || this.diveDepth > 0) targetPitch -= clamp(this.diveRate * 0.22, -0.35, 0.45);
    if (this.air) targetPitch += clamp(this.vy * 0.04, -0.25, 0.2);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-dt * 8));
    this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-dt * 6));
    this._q.setFromEuler(new THREE.Euler(this.pitch, 0, this.roll, 'YXZ'));

    // the view's frame
    this.frameOn(this.normal, this.quatBase).multiply(this._q);
    // the board: on the surface, then sitting on the water along its length, not just at its
    // middle (in the air too: coming down, the nose meets the water first and the board
    // settles onto it as it lands)
    this.frameOn(this.normalBoard, this.quat).multiply(this._q);
    this.ride.tilt = this.ride.lift = 0;
    const flip = this.flipAngle;
    if (!this.diving && this.turtle === 0 && st !== STATE.WIPEOUT && !flip) this.rideOnWater();
    // turtle roll: over onto its back about its length
    if (this.turtle > 0) this.quat.multiply(this._q.setFromAxisAngle(AXIS_Z, this.turtleAngle));
    // backflip: over backwards (nose up and over), about your middle above the board
    this.flipShift.set(0, 0, 0);
    if (flip) {
      _fu.set(0, FLIP_PIVOT, 0).applyQuaternion(this.quat);
      this.quat.multiply(this._q.setFromAxisAngle(RIDE_X, flip));
      this.flipShift.copy(_fu).sub(_rp.set(0, FLIP_PIVOT, 0).applyQuaternion(this.quat));
      this.position.add(this.flipShift);
    }
  }

  // The board's frame on a surface with normal `up`, facing the way it's heading, into out
  frameOn(up, out) {
    const fwd = _rf.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = _rr.crossVectors(fwd, up).normalize();
    this._m.makeBasis(right, up, fwd.negate());
    return out.setFromRotationMatrix(this._m);
  }

  // The board resting on the water. The physics keeps the middle of the board on the surface
  // and lays it along the surface there, but the water curves: a face steepening into the
  // trough is hollow, so a rigid board laid flat at its middle has its nose (and tail) under
  // the water at the bottom of the face, or wherever it points down into a hollow. So the board
  // as it's drawn (and as the camera, the replay and other players see it) is turned about its
  // middle and, where it has to be, lifted, so that no part of it is deeper in the water than
  // it is on flat water: the nose at most touching it, the tail a little way in. The physics
  // isn't touched. A few rounds: the water isn't flat, so each answer is only nearly right.
  rideOnWater() {
    const n = RIDE_T.length;
    const need = this._need || (this._need = new Float64Array(n));
    const k = this._k || (this._k = new Float64Array(n));
    const hs = this._hs || (this._hs = new Float64Array(n));
    const L = this.board.length;
    const M = this.model;
    // (every point is within a board's length of the middle: heightNear from its swell shift)
    const shift = M.swellShift(this.position.x, this.position.z, this._shift || (this._shift = { x: 0, z: 0 }));
    const shifts = this._shifts || (this._shifts = RIDE_T.map(() => ({ x: 0, z: 0 }))); // (each point's own)
    const station = (i) => {
      const t = RIDE_T[i];
      return _rp.set(0, boardBottom(this.boardType, t), -(t - 0.5) * L).applyQuaternion(this.quat).add(this.position);
    };
    for (let round = 0; round < 3; round++) {
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const t = RIDE_T[i];
        const b = boardBottom(this.boardType, t);
        const p = station(i);
        // as deep as it sits on flat water: the nose touching at most; the tail and the middle,
        // under the rider, a little more (a longboard's more again: it's heavier, and long)
        const allowed = Math.max(0, -b) + (t >= 0.6 ? 0.004 : 0.03 + 0.05 * Math.max(0, L - 1.86));
        hs[i] = M.heightNear(p.x, p.z, shift, 1, round === 0 ? shifts[i] : null);
        need[i] = hs[i] - allowed - p.y;
        if (need[i] > worst) worst = need[i];
      }
      if (worst < (round ? 0.002 : 1e-4)) break;
      if (round === 0) {
        // How much each point comes up per radian of nose-up turn: it moves along s*up + b*back,
        // so up (the board's part of it), and sideways too, onto water that's higher or lower
        // on a sloping face. (Worked out once: the later rounds only tidy up.)
        _ru.set(0, 1, 0).applyQuaternion(this.quat);
        _rz.set(0, 0, 1).applyQuaternion(this.quat);
        for (let i = 0; i < n; i++) {
          const t = RIDE_T[i];
          const b = boardBottom(this.boardType, t);
          const s = (t - 0.5) * L; // ahead of the middle
          const vx = s * _ru.x + b * _rz.x,
            vz = s * _ru.z + b * _rz.z;
          const vh = Math.hypot(vx, vz);
          let slope = 0;
          if (vh > 1e-4) {
            // (5 cm on, the swell's shift is the point's own)
            const p = station(i);
            slope = ((M.heightNear(p.x + (vx / vh) * 0.05, p.z + (vz / vh) * 0.05, shifts[i], 0) - hs[i]) / 0.05) * vh;
          }
          k[i] = s * _ru.y + b * _rz.y - slope;
        }
      }
      let [phi, dy] = solveRide(need, k, n);
      // (no more than RIDE_PHI and RIDE_DY in all)
      phi = clamp(phi, -RIDE_PHI - this.ride.tilt, RIDE_PHI - this.ride.tilt);
      dy = Math.min(dy, RIDE_DY - this.ride.lift);
      if (Math.abs(phi) < 1e-5 && dy < 1e-5) break;
      this.quat.multiply(_rq.setFromAxisAngle(RIDE_X, phi));
      this.position.y += dy;
      this.ride.tilt += phi;
      this.ride.lift += dy;
    }
  }

  // how far the board has rolled over (rad; 0 upright, pi upside down)
  get turtleAngle() {
    const t = this.turtle;
    return Math.PI * t * t * (3 - 2 * t);
  }
}
