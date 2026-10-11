// Keyboard / mouse input for PC play.
//   Scroll wheel  : paddle; the faster you scroll the harder you paddle
//   A / D         : steer while prone, lean (carve) while standing
//   W / S         : lean forward / back (shortboard) or walk to the nose / tail (longboard)
//   Ctrl (or C)   : duck dive while paddling, crouch while standing
//   Shift + flick : hold Shift and flick the mouse sideways for a snap, cutback or tailslide
//   Space         : pop up (and lie back down)
//   Mouse         : look around (pointer lock)
//   R             : back to the lineup

// Keys that browsers would otherwise grab (Ctrl+W closes the tab) are captured with the
// Keyboard Lock API while in fullscreen.
const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyT', 'KeyN', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'];
const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class PCInput {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.wheelAccum = 0;
    this.scrollRate = 0; // smoothed scroll speed (px/s)
    this.lookX = 0;
    this.lookY = 0;
    this.events = [];
    this.locked = false;
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code) || e.ctrlKey) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.events.push('toggleStand');
      if (e.code === 'KeyR' && !e.ctrlKey) this.events.push('reset');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
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
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  // Fullscreen + pointer lock + keyboard lock (must be called from a click).
  capture(fullscreen = true) {
    const el = document.documentElement;
    const lockKeys = () => {
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(LOCK_KEYS).catch(() => {});
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

  axis(neg, pos) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  get steer() {
    return this.axis('KeyA', 'KeyD') || this.axis('ArrowLeft', 'ArrowRight');
  }

  get leanZ() {
    return this.axis('KeyS', 'KeyW') || this.axis('ArrowDown', 'ArrowUp');
  }

  get crouch() {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
  }

  get charge() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
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
