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
import { leanCurve, cleanTilt, FULL_TILT } from './lean.js';

const BOARD = [0.36, 0.64]; // the board's column (fraction of the width)
const LOOK_TOP = 0.5; // the look area: right of the board, below this (fraction of the height)

export class TouchInput {
  constructor(dom, ui) {
    this.dom = dom;
    this.ui = ui;
    this.enabled = false;
    this.mode = 'prone'; // the surfer's state, or 'drone' (set by the game each frame)
    this.settings = cleanTilt(null);
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

  // through the tilt curves: steer / carve (+ right), lean (+ forward)
  get steer() {
    return this.tilt.has ? leanCurve((this.tilt.roll - this.tilt.roll0) / FULL_TILT, this.settings.x) : 0;
  }
  get leanZ() {
    return this.tilt.has ? leanCurve((this.tilt.pitch0 - this.tilt.pitch) / FULL_TILT, this.settings.z) : 0;
  }

  // ---------------------------------------------------------------- fingers
  role(fx, fy) {
    // (a drone, and walking a river bank: a stick each side)
    if (this.mode === 'drone' || this.mode === 'bank') return fx < 0.5 ? 'stickL' : 'stickR';
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
      this.touches.set(t.identifier, { role: this.role(fx, fy), x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t0: this.time, top: t.clientY, low: t.clientY, armed: true, speed: 0, at: performance.now(), decided: false });
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
  }

  // what the on-screen buttons show, for the surfer's state now
  showButtons(visible) {
    this.ui.hidden = !visible;
    this.ui.dataset.mode = this.mode;
    if (this.mode !== 'standing' && this.crouch) {
      this.crouch = false;
      this.ui.querySelector('[data-t="crouch"]').classList.remove('on');
    }
  }

  update(dt) {
    this.time += dt;
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
    this.duck = this.charge = false;
    this.climb = 0;
    this.sticks.fill(0);
  }
}
