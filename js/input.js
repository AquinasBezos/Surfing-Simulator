// Keyboard / mouse input for PC play. Keys come from the remappable bindings (bindings.js);
// these are the defaults:
//   Scroll wheel  : paddle; the faster you scroll the harder you paddle (fixed)
//   A / D         : steer while prone, lean (carve) while standing
//   W / S         : lean forward / back (shortboard) or walk to the nose / tail (longboard)
//   Ctrl (or C)   : duck dive while paddling, crouch while standing
//   Shift + flick : hold Shift and flick the mouse sideways for a snap, cutback or tailslide
//   Space         : pop up (and lie back down)
//   Mouse         : look around (pointer lock, fixed)
//   R             : back to the lineup
//   Esc           : pause (fixed)
import { controls, normCode, lockCodes } from './bindings.js';

// Keys that browsers would otherwise grab (Ctrl+W closes the tab) are captured with the
// Keyboard Lock API while in fullscreen.
export class PCInput {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set(); // held keys / mouse buttons, as binding codes
    this.wheelAccum = 0;
    this.scrollRate = 0; // smoothed scroll speed (px/s)
    this.lookX = 0;
    this.lookY = 0;
    this.events = [];
    this.locked = false;
    this.enabled = false;

    const press = (code, e) => {
      if (!this.enabled) return;
      if (e.ctrlKey || Object.values(controls.pc).some((k) => k.includes(code))) e.preventDefault();
      if (this.keys.has(code)) return; // key repeat
      this.keys.add(code);
      if (controls.pcHas('popup', code)) this.events.push('toggleStand');
      if (controls.pcHas('lineup', code)) this.events.push('reset');
    };
    window.addEventListener('keydown', (e) => press(normCode(e.code), e));
    window.addEventListener('keyup', (e) => this.keys.delete(normCode(e.code)));
    window.addEventListener('blur', () => this.keys.clear());
    // mouse buttons can be bound too (only while the mouse is captured by the game)
    document.addEventListener('mousedown', (e) => {
      if (this.locked) press(`Mouse${e.button}`, e);
    });
    document.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    dom.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault(); // also stops Ctrl+wheel zooming the page
        const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
        // Shift+wheel arrives as deltaX in some browsers
        this.wheelAccum += Math.min((Math.abs(e.deltaY) + Math.abs(e.deltaX)) * scale, 400);
      },
      { passive: false },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  // Fullscreen + pointer lock + keyboard lock (must be called from a click).
  capture(fullscreen = true) {
    const el = document.documentElement;
    const lockKeys = () => {
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(lockCodes()).catch(() => {});
    };
    if (!fullscreen) {
      this.requestLock();
      return;
    }
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(lockKeys, () => {});
    } else lockKeys();
    this.requestLock();
  }

  requestLock() {
    if (this.dom.requestPointerLock) {
      try {
        const p = this.dom.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* not available */
      }
    }
  }

  update(dt) {
    if (dt <= 0) return;
    const inst = this.wheelAccum / dt;
    this.wheelAccum = 0;
    this.scrollRate += (inst - this.scrollRate) * (1 - Math.exp(-dt / 0.35));
  }

  // 0..1 paddling effort from how fast the wheel is turning (~10 notches/s = flat out)
  get paddle() {
    return Math.max(0, Math.min(1, (this.scrollRate - 40) / 1050));
  }

  // is an action's key (or mouse button) held?
  down(id) {
    return controls.pc[id].some((k) => k && this.keys.has(k));
  }

  get steer() {
    return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
  }

  get leanZ() {
    return (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
  }

  get charge() {
    return this.down('charge');
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
}
