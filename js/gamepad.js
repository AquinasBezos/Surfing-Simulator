// Game controllers on PC (the Gamepad API, standard mapping; Xbox names). Buttons come from
// the remappable bindings (bindings.js); these are the defaults:
//   LT / RT       : paddle with your left / right arm: each pull of the trigger is a stroke,
//                   faster pulls are harder strokes (a stronger right stroke turns you left)
//   A             : stand up (and lie back down)
//   B             : duck dive while paddling, crouch while surfing (hold)
//   LB or RB      : hold to charge a trick, then flick the right stick sideways: a quick jab
//                   is a tailslide, a flick a snap, held over longer a cutback
//   Y             : back to the lineup
//   Menu (Start)  : pause menu
// and the sticks (fixed): the left one is your movement keys (steer / carve, lean forward and
// back or walk the longboard; while paddling, pull it back to sit up and push it up to lie
// down), the right one looks around. Both go through the sensitivity curves (settings).
// In the menus: D-pad or left stick to move, A to choose, B to go back, Menu to resume.
import { controls, PAD_ACTIONS } from './bindings.js';
import { leanCurve, cleanPad } from './lean.js';

const DEAD = 0.12; // stick dead zone (radial)
const NAV_REPEAT = [0.42, 0.13]; // menu: first repeat after, then every (s)

function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
}

export class GamepadInput {
  constructor() {
    this.pad = null; // the controller being read
    this.connected = false;
    this.settings = cleanPad(null); // sensitivity curves etc. (from the settings)
    this.prev = []; // button pressed last poll
    this.values = [];
    this.axes = [0, 0, 0, 0];
    this.events = []; // gameplay events (as PCInput's), plus { stroke: side, strength } and { flick, omega, sweep }
    this.nav = []; // menu commands: up, down, left, right, accept, back, start
    this.navHeld = null;
    this.navT = 0;
    this.lastActive = -1e9;
    this.time = 0;
    this.trig = { L: { v: 0, armed: true, peak: 0 }, R: { v: 0, armed: true, peak: 0 } };
    this.flickWin = null;
    this.stickEdge = 0; // left stick pushed up (+1) / pulled back (-1) last poll
    this.capture = null; // (binding a button in the settings): fn(i) gets the next press
    window.addEventListener('gamepadconnected', () => this.poll(0));
    window.addEventListener('gamepaddisconnected', () => this.poll(0));
  }

  // was the controller used in the last few seconds?
  get active() {
    return this.connected && this.time - this.lastActive < 8;
  }

  down(id) {
    return this.connected && controls.pad[id].some((b) => b >= 0 && this.values[b] > 0.5);
  }

  // analog value (0..1) of an action's buttons (triggers)
  value(id) {
    if (!this.connected) return 0;
    let v = 0;
    for (const b of controls.pad[id]) if (b >= 0) v = Math.max(v, this.values[b] || 0);
    return v;
  }

  // through the sensitivity curves: steer / carve (+ right), lean (+ forward), look (+ right / up)
  get steer() {
    return leanCurve(this.axes[0], this.settings.x);
  }
  get leanZ() {
    return leanCurve(-this.axes[1], this.settings.z);
  }
  // look rate in rad/s (+ = turn left, look up)
  lookRate() {
    const s = (this.settings.lookSpeed * Math.PI) / 180;
    const inv = this.settings.invertY ? -1 : 1;
    return [-leanCurve(this.axes[2], this.settings.look) * s, -leanCurve(this.axes[3], this.settings.look) * s * inv];
  }
  // raw sticks (for flying the drone): [lx, ly, rx, ry], y + = down
  get sticks() {
    return this.axes;
  }

  poll(dt) {
    this.time += dt;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    // the one in use: keep it while it's there, else the first standard one
    if (!this.pad || !pads.some((p) => p.index === this.pad.index)) this.pad = pads.find((p) => p.mapping === 'standard') || pads[0] || null;
    else this.pad = pads.find((p) => p.index === this.pad.index);
    this.connected = !!this.pad;
    if (!this.pad) {
      this.values = [];
      this.axes = [0, 0, 0, 0];
      return;
    }
    const p = this.pad;
    const values = p.buttons.map((b) => (typeof b === 'object' ? b.value || (b.pressed ? 1 : 0) : b));
    const [lx, ly] = stick(p.axes[0] || 0, p.axes[1] || 0);
    const [rx, ry] = stick(p.axes[2] || 0, p.axes[3] || 0);
    this.axes = [lx, ly, rx, ry];
    const pressed = values.map((v) => v > 0.5);
    if (pressed.some(Boolean) || Math.hypot(lx, ly) > 0.3 || Math.hypot(rx, ry) > 0.3) this.lastActive = this.time;
    // binding a button in the settings: the next press goes there, and nothing else
    if (this.capture) {
      const i = pressed.findIndex((v, k) => v && !this.prev[k]);
      if (i >= 0) {
        const fn = this.capture;
        this.capture = null;
        fn(i);
      }
      this.prev = pressed;
      this.values = values;
      return;
    }
    const edge = (id) => controls.pad[id].some((b) => b >= 0 && pressed[b] && !this.prev[b]);
    if (edge('popup')) this.events.push('toggleStand');
    if (edge('lineup')) this.events.push('reset');
    if (edge('pause')) this.events.push('pause');
    // the left stick like W / S: pushed up / pulled back (sits you up while paddling)
    const ed = ly < -0.7 ? 1 : ly > 0.7 ? -1 : Math.abs(ly) < 0.4 ? 0 : this.stickEdge;
    if (ed !== this.stickEdge && ed) this.events.push(ed > 0 ? 'forward' : 'back');
    this.stickEdge = ed;
    // paddling: a stroke each time a trigger is pulled in, harder the faster it went
    for (const [side, id] of [
      [-1, 'paddleL'],
      [1, 'paddleR'],
    ]) {
      const T = this.trig[side < 0 ? 'L' : 'R'];
      const v = this.value(id);
      const rate = dt > 0 ? (v - T.v) / dt : 0;
      T.peak = Math.max(T.peak, rate);
      if (T.armed && v > 0.6) {
        this.events.push({ stroke: side, strength: Math.min(1, Math.max(0.25, T.peak / 9)) });
        T.armed = false;
      } else if (v < 0.25) {
        T.armed = true;
        T.peak = 0;
      }
      T.v = v;
    }
    // tricks: with a charge button held, flick the right stick sideways
    this.detectFlick(dt, rx);
    // the menus
    this.navigate(dt, pressed, values, lx, ly);
    this.prev = pressed;
    this.values = values;
  }

  // How long the stick is held out picks the move (a thumb flicks a stick fast whatever it
  // means to do): straight out and back is a tailslide, a short hold a snap, longer a cutback.
  detectFlick(dt, rx) {
    const charging = this.down('charge');
    const w = this.flickWin;
    if (w) {
      w.t += dt;
      if (Math.abs(rx) > 0.6) w.held += dt;
      if ((w.t > 0.06 && Math.abs(rx) < 0.35) || w.t > 0.6) {
        const h = w.held;
        // (in the units surfer.flick() takes: turn speed and how far the look swept)
        this.events.push({ flick: w.dir, omega: h < 0.13 ? 12 : 8, sweep: h > 0.32 ? 1.5 + (h - 0.32) * 2 : 0.6 + h });
        this.flickWin = null;
      }
    } else if (charging && Math.abs(rx) > 0.35) {
      // (+ = left, like the look)
      this.flickWin = { dir: rx < 0 ? 1 : -1, t: 0, held: 0 };
    }
  }

  navigate(dt, pressed, values, lx, ly) {
    const was = (i) => this.prev[i];
    const btn = (i) => pressed[i] && !was(i);
    if (btn(0)) this.nav.push('accept');
    if (btn(1)) this.nav.push('back');
    if (btn(9)) this.nav.push('start');
    // directions: the D-pad or the left stick, repeating while held
    const dir = pressed[12] || ly < -0.6 ? 'up' : pressed[13] || ly > 0.6 ? 'down' : pressed[14] || lx < -0.6 ? 'left' : pressed[15] || lx > 0.6 ? 'right' : null;
    if (dir !== this.navHeld) {
      this.navHeld = dir;
      this.navT = 0;
      if (dir) this.nav.push(dir);
    } else if (dir) {
      this.navT += dt;
      if (this.navT > NAV_REPEAT[0]) {
        this.navT -= NAV_REPEAT[1];
        this.nav.push(dir);
      }
    }
  }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  consumeNav() {
    const n = this.nav;
    this.nav = [];
    return n;
  }
}

export { PAD_ACTIONS };
