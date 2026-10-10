// Keyboard / mouse input for PC play.
//   Scroll wheel  : paddle (each notch queues a stroke)
//   A / D         : steer while prone, lean (carve) while standing
//   W / S         : lean forward (trim / pump) / back (stall, crouch) while standing
//   Space         : pop up (and lie back down)
//   Mouse         : look around (pointer lock)
//   R             : back to the lineup
export class PCInput {
  constructor(dom) {
    this.dom = dom;
    this.keys = new Set();
    this.wheel = 0;
    this.strokes = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.events = [];
    this.locked = false;
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.events.push('toggleStand');
      if (e.code === 'KeyR') this.events.push('reset');
      if (e.code === 'KeyH') this.events.push('help');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
        this.wheel += Math.min(Math.abs(e.deltaY) * scale, 240);
        while (this.wheel >= 90) {
          this.wheel -= 90;
          this.strokes = Math.min(this.strokes + 1, 3);
        }
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

  axis(neg, pos) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  get steer() {
    return this.axis('KeyA', 'KeyD') || this.axis('ArrowLeft', 'ArrowRight');
  }

  get leanZ() {
    return this.axis('KeyS', 'KeyW') || this.axis('ArrowDown', 'ArrowUp');
  }

  consumeStrokes() {
    const n = this.strokes;
    this.strokes = 0;
    return n;
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
