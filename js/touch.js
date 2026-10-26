// Touch screens (phones and tablets, held sideways). What a finger does is decided by where
// it first touches, and stays that way until it lifts (a paddle stroke that starts at the
// top right and runs down into the look area never turns the view):
//
//   beside the board (left third, or the top of the right third):
//        swipe down to paddle with that arm; faster swipes are harder strokes
//   on the board (the middle third):
//        swipe up to stand; swipe down to lie back down when standing, or, while paddling,
//        to duck dive until you lift your finger; tap to sit up (tap again to lie down)
//   bottom right: drag to look around (with Snap held, a quick sideways swipe is a trick)
//   tilt the phone: left and right to steer and carve, forward and back to trim, stall or
//        walk a longboard (through the tilt curves in the settings). Calibrating (when you
//        start or resume, or with the Level button) takes the way you're holding it as level,
//        and works out which way the screen is turned from which edge you're holding higher,
//        rather than trusting the angle the browser reports (wrong by 90 degrees on some
//        iPads). A setting can turn the directions further if a device still gets it wrong.
//   buttons: pause; while standing, Crouch (toggles) and Snap (hold to charge a trick)
//   flying a drone: drag on the left half to fly, on the right half to turn and tilt the
//        camera; the arrow buttons climb and descend
//
// Or, chosen in the settings (and asked the first time you play), buttons instead of swipes and
// tilt (scheme 'buttons'): a joystick at the bottom left steers (and, standing, carves and
// trims, instead of tilting); Paddle buttons stroke with each arm (held, they keep stroking);
// Duck dive (held) and Sit; Stand once you're moving (over 5 mph) or a wave has you; standing,
// Crouch, Snap and Paddle (lie back down). Dragging anywhere else looks around.
import { leanCurve, cleanTilt, FULL_TILT } from './lean.js';

const BOARD = [0.36, 0.64]; // the board's column (fraction of the width)
const LOOK_TOP = 0.5; // the look area: right of the board, below this (fraction of the height)
const JOY = { right: 0.42, top: 0.3 }; // buttons: the joystick's area (left of and below these)
const STROKE_EVERY = 0.6; // s: a held Paddle button strokes this often

export class TouchInput {
  constructor(dom, ui) {
    this.dom = dom;
    this.ui = ui;
    this.enabled = false;
    this.mode = 'prone'; // the surfer's state, or 'drone' (set by the game each frame)
    this.settings = cleanTilt(null);
    this.scheme = 'swipe'; // or 'buttons' (the settings)
    this.joy = { x: 0, y: 0, id: null }; // buttons: the joystick (-1..1, y + = down)
    this.paddling = { L: -1, R: -1 }; // buttons: a held Paddle button's time to its next stroke (-1: up)
    this.touches = new Map();
    this.events = []; // as PCInput's, plus { stroke: side, strength }
    this.lookX = 0;
    this.lookY = 0;
    this.duck = false;
    this.crouch = false; // toggled
    this.charge = false; // held
    this.climb = 0; // drone: -1, 0, 1
    this.sticks = [0, 0, 0, 0]; // drone: left x / y, right x / y (y + = down)
    this.time = 0;
    this.lastActive = -1e9;
    this.tilt = { roll: 0, pitch: 0, roll0: 0, pitch0: 0, has: false, calibrate: true, angle: null, auto: 0 };
    const opt = { passive: false };
    dom.addEventListener('touchstart', (e) => this.start(e), opt);
    dom.addEventListener('touchmove', (e) => this.move(e), opt);
    dom.addEventListener('touchend', (e) => this.end(e), opt);
    dom.addEventListener('touchcancel', (e) => this.end(e), opt);
    window.addEventListener('deviceorientation', (e) => this.orient(e));
    // the picture turned round (landscape one way to the other): work it out again
    const turned = () => this.calibrate();
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', turned);
    window.addEventListener('orientationchange', turned);
    this.onCalibrated = null; // (level, angle) after each calibration
    this.bindButtons();
  }

  get active() {
    return this.time - this.lastActive < 8;
  }

  // ---------------------------------------------------------------- tilt
  // iOS asks before sharing the phone's orientation: call from a tap
  static askForTilt() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
  }

  // the way the phone is held now counts as level (straight away, from the latest reading)
  calibrate() {
    this.tilt.calibrate = true;
    if (this.lastUp) this.applyUp(...this.lastUp);
  }

  // how far the screen's picture is turned from the device's own axes, as the browser says (deg)
  static reportedAngle() {
    const so = screen.orientation;
    const a = so && typeof so.angle === 'number' ? so.angle : typeof window.orientation === 'number' ? window.orientation : 0;
    return (((Math.round(a / 90) * 90) % 360) + 360) % 360;
  }

  orient(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = (e.beta * Math.PI) / 180,
      g = (e.gamma * Math.PI) / 180;
    // which way is up, in the device's own axes (x right, y top, z out of the screen, as
    // the browser reports them: normally the natural, upright position)
    const ux = -Math.sin(g) * Math.cos(b),
      uy = Math.sin(b),
      uz = Math.cos(g) * Math.cos(b);
    this.lastUp = [ux, uy, uz];
    this.applyUp(ux, uy, uz);
  }

  applyUp(ux, uy, uz) {
    const T = this.tilt;
    if (T.calibrate || T.angle == null) {
      // Which way is the picture turned? The edge you hold higher is the top of the screen:
      // the one the up direction points most toward, across the screen. (If the device is
      // nearly flat, that can't tell, so take the browser's word.)
      const across = Math.hypot(ux, uy);
      T.auto = across > 0.3 ? ((((Math.round((Math.atan2(ux, uy) * 2) / Math.PI) * 90) % 360) + 360) % 360) : TouchInput.reportedAngle();
      T.angle = (T.auto + this.settings.turn) % 360;
    }
    const a = (T.angle * Math.PI) / 180;
    // up, on the screen as it's showing: its right, and its top
    const right = ux * Math.cos(a) - uy * Math.sin(a);
    const up = ux * Math.sin(a) + uy * Math.cos(a);
    // right edge down = steer right; top edge away from you (screen facing up more) = forward
    T.roll = (Math.asin(Math.max(-1, Math.min(1, -right))) * 180) / Math.PI;
    T.pitch = (Math.atan2(up, uz) * 180) / Math.PI;
    T.has = true;
    if (T.calibrate) {
      T.roll0 = T.roll;
      T.pitch0 = T.pitch;
      T.calibrate = false;
      if (this.onCalibrated) this.onCalibrated(T.angle);
    }
  }

  // how far you're tilting now, as fractions of a full tilt (before the curves): for the
  // settings' level; null until the motion sensors have said anything
  get tiltNow() {
    const T = this.tilt;
    if (!T.has) return null;
    return { x: (T.roll - T.roll0) / FULL_TILT, z: (T.pitch0 - T.pitch) / FULL_TILT };
  }

  // through the tilt curves: steer / carve (+ right), lean (+ forward); with buttons, the joystick
  get steer() {
    if (this.scheme === 'buttons') return leanCurve(this.joy.x, this.settings.x);
    return this.tilt.has ? leanCurve((this.tilt.roll - this.tilt.roll0) / FULL_TILT, this.settings.x) : 0;
  }
  get leanZ() {
    if (this.scheme === 'buttons') return leanCurve(-this.joy.y, this.settings.z);
    return this.tilt.has ? leanCurve((this.tilt.pitch0 - this.tilt.pitch) / FULL_TILT, this.settings.z) : 0;
  }

  setScheme(scheme) {
    this.scheme = scheme === 'buttons' ? 'buttons' : 'swipe';
    this.ui.dataset.scheme = this.scheme;
  }

  // ---------------------------------------------------------------- fingers
  role(fx, fy) {
    // (a drone, and walking a river bank: a stick each side)
    if (this.mode === 'drone' || this.mode === 'bank') return fx < 0.5 ? 'stickL' : 'stickR';
    if (this.scheme === 'buttons') return fx < JOY.right && fy > JOY.top && this.joy.id === null ? 'joy' : 'look';
    if (fx >= BOARD[0] && fx <= BOARD[1]) return 'board';
    if (fx > BOARD[1] && fy > LOOK_TOP) return 'look';
    return fx < BOARD[0] ? 'paddleL' : 'paddleR';
  }

  start(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.lastActive = this.time;
    const r = this.dom.getBoundingClientRect();
    for (const t of e.changedTouches) {
      const fx = (t.clientX - r.left) / r.width,
        fy = (t.clientY - r.top) / r.height;
      const role = this.role(fx, fy);
      this.touches.set(t.identifier, { role, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t0: this.time, top: t.clientY, low: t.clientY, armed: true, speed: 0, at: performance.now(), decided: false });
      // (the joystick's centre is wherever your thumb lands)
      if (role === 'joy') {
        this.joy.id = t.identifier;
        this.placeJoy(t.clientX - r.left, t.clientY - r.top, 0, 0);
      }
    }
  }

  move(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.lastActive = this.time;
    const H = this.dom.clientHeight || 1;
    for (const t of e.changedTouches) {
      const f = this.touches.get(t.identifier);
      if (!f) continue;
      const now = performance.now();
      const dtm = Math.max(1, now - f.at) / 1000;
      const dx = t.clientX - f.x,
        dy = t.clientY - f.y;
      f.speed += (dy / dtm - f.speed) * 0.5; // downward speed, px/s
      f.at = now;
      f.x = t.clientX;
      f.y = t.clientY;
      if (f.role === 'look') {
        this.lookX += dx * this.settings.look * 1.4;
        this.lookY += dy * this.settings.look * 1.4;
      } else if (f.role === 'paddleL' || f.role === 'paddleR') {
        // a stroke for each downward swipe; drawing back up a little arms the next one
        f.low = Math.max(f.low, f.y);
        if (f.armed && f.y - f.top > 0.07 * H && f.speed > 0.35 * H) {
          if (this.mode === 'prone') this.events.push({ stroke: f.role === 'paddleL' ? -1 : 1, strength: Math.min(1, f.speed / (2.4 * H)) });
          f.armed = false;
        } else if (!f.armed && f.y < f.low - 0.04 * H) {
          f.armed = true;
          f.top = f.y;
          f.low = f.y;
        } else if (f.armed && f.y < f.top) f.top = f.y;
      } else if (f.role === 'board' && !f.decided) {
        const ddx = f.x - f.x0,
          ddy = f.y - f.y0;
        if (Math.abs(ddy) > 0.06 * H && Math.abs(ddy) > 1.2 * Math.abs(ddx)) {
          f.decided = true;
          const down = ddy > 0;
          if (this.mode === 'prone') {
            if (down) {
              f.ducking = true; // until this finger lifts
              this.duck = true;
            } else this.events.push('toggleStand');
          } else if (this.mode === 'sitting' && !down) this.events.push('forward', 'toggleStand'); // lie down, then up
          else if (this.mode === 'standing' && down) this.events.push('toggleStand'); // back to paddling
        }
      } else if (f.role === 'joy') {
        const R = 0.13 * H;
        let jx = (f.x - f.x0) / R,
          jy = (f.y - f.y0) / R;
        const m = Math.hypot(jx, jy);
        if (m > 1) {
          jx /= m;
          jy /= m;
        }
        this.joy.x = Math.abs(jx) < 0.08 ? 0 : jx;
        this.joy.y = Math.abs(jy) < 0.08 ? 0 : jy;
        this.placeJoy(null, null, jx, jy);
      } else if (f.role === 'stickL' || f.role === 'stickR') {
        const R = 0.13 * H;
        const sx = Math.max(-1, Math.min(1, (f.x - f.x0) / R)),
          sy = Math.max(-1, Math.min(1, (f.y - f.y0) / R));
        const o = f.role === 'stickL' ? 0 : 2;
        this.sticks[o] = sx;
        this.sticks[o + 1] = sy;
      }
    }
  }

  end(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const H = this.dom.clientHeight || 1;
    for (const t of e.changedTouches) {
      const f = this.touches.get(t.identifier);
      if (!f) continue;
      this.touches.delete(t.identifier);
      if (f.ducking && ![...this.touches.values()].some((o) => o.ducking)) this.duck = false;
      // a tap on the board: sit up while paddling, lie back down while sitting
      if (f.role === 'board' && !f.decided && Math.hypot(f.x - f.x0, f.y - f.y0) < 0.04 * H && this.time - f.t0 < 0.4) {
        if (this.mode === 'prone') this.events.push('back');
        else if (this.mode === 'sitting') this.events.push('forward');
      }
      if (f.role === 'joy') this.releaseJoy();
      if (f.role === 'stickL') this.sticks[0] = this.sticks[1] = 0;
      if (f.role === 'stickR') this.sticks[2] = this.sticks[3] = 0;
    }
  }

  // ---------------------------------------------------------------- buttons
  bindButtons() {
    const hold = (name, on) => {
      const b = this.ui.querySelector(`[data-t="${name}"]`);
      if (!b) return;
      const set = (v) => (e) => {
        e.preventDefault();
        this.lastActive = this.time;
        on(v, b);
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture?.(e.pointerId);
        set(true)(e);
      });
      for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, set(false));
    };
    hold('pause', (v) => v && this.events.push('pause'));
    hold('crouch', (v, b) => {
      if (!v) return;
      this.crouch = !this.crouch;
      b.classList.toggle('on', this.crouch);
    });
    hold('charge', (v, b) => {
      this.charge = v;
      b.classList.toggle('on', v);
    });
    hold('up', (v) => (this.climb = v ? 1 : 0));
    hold('down', (v) => (this.climb = v ? -1 : 0));
    hold('lineup', (v) => v && this.events.push('reset'));
    hold('jump', (v) => v && this.events.push('toggleStand')); // (on a river bank: jump in)
    hold('level', (v) => v && this.events.push('level'));
    // buttons
    for (const side of ['L', 'R'])
      hold('paddle' + side, (v, b) => {
        b.classList.toggle('on', v);
        if (v) this.stroke(side);
        this.paddling[side] = v ? STROKE_EVERY : -1;
      });
    hold('duckdive', (v, b) => {
      this.duck = v;
      b.classList.toggle('on', v);
    });
    hold('sit', (v) => v && this.events.push(this.mode === 'sitting' ? 'forward' : 'back')); // (sit up, or lie back down)
    hold('stand', (v) => v && this.events.push(this.mode === 'sitting' ? 'forward' : 'toggleStand'));
    hold('lie', (v) => v && this.mode === 'standing' && this.events.push('toggleStand')); // back to paddling
  }

  // a stroke with one arm (a Paddle button): lying down only (from sitting it lies you down)
  stroke(side) {
    if (this.mode === 'prone' || this.mode === 'sitting') this.events.push({ stroke: side === 'L' ? -1 : 1, strength: 0.85 });
  }

  // the joystick's look: where its base sits (px in the game's area; null: leave it) and its knob
  placeJoy(x, y, jx, jy) {
    const el = this.ui.querySelector('.t-joy');
    if (!el) return;
    if (x !== null) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.classList.add('held');
    }
    el.style.setProperty('--jx', jx.toFixed(3));
    el.style.setProperty('--jy', jy.toFixed(3));
  }

  releaseJoy() {
    this.joy.x = this.joy.y = 0;
    this.joy.id = null;
    const el = this.ui.querySelector('.t-joy');
    if (!el) return;
    el.classList.remove('held');
    el.style.left = el.style.top = '';
    el.style.setProperty('--jx', 0);
    el.style.setProperty('--jy', 0);
  }

  // buttons: show Stand (you're moving fast enough, or a wave has you)
  setFast(on) {
    this.ui.classList.toggle('fast', on);
  }

  // what the on-screen buttons show, for the surfer's state now
  showButtons(visible) {
    this.ui.hidden = !visible;
    this.ui.dataset.mode = this.mode;
    const sit = this.ui.querySelector('[data-t="sit"]');
    if (sit) sit.textContent = this.mode === 'sitting' ? 'Lie down' : 'Sit';
    if (this.mode !== 'standing' && this.crouch) {
      this.crouch = false;
      this.ui.querySelector('[data-t="crouch"]').classList.remove('on');
    }
  }

  update(dt) {
    this.time += dt;
    // held Paddle buttons keep stroking
    for (const side of ['L', 'R']) {
      if (this.paddling[side] < 0) continue;
      this.paddling[side] -= dt;
      if (this.paddling[side] <= 0) {
        this.stroke(side);
        this.paddling[side] += STROKE_EVERY;
      }
    }
  }

  consumeLook() {
    const r = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return r;
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  reset() {
    this.touches.clear();
    this.releaseJoy();
    this.paddling.L = this.paddling.R = -1;
    for (const b of this.ui.querySelectorAll('.t-btn.on:not([data-t="crouch"])')) b.classList.remove('on');
    this.duck = this.charge = false;
    this.climb = 0;
    this.sticks.fill(0);
  }
}
