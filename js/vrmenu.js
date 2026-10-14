// In-headset pause menu for Meta Quest: a floating panel you point at with either
// controller and click with the trigger. Opens with the pause button (Y by default).
//   Pause    : resume, back to the lineup, recalibrate, controls and settings, leave
//   Settings : Quest buttons, leaning sensitivity, the drone in VR, volume
//   Buttons  : the Quest button bindings (‹ ›  to step through the buttons)
//   Leaning  : the sensitivity curves, with graphs and a dot showing your lean now
// Drawn into a canvas texture, like the VR HUD panel.
import * as THREE from 'three';
import { controls, QUEST_ACTIONS, QUEST_OPTIONS, questLabel } from './bindings.js';
import { cleanLean, drawLeanGraph, AXES, LEAN_LIMITS, LEAN_DEFAULTS } from './lean.js';

const W = 1024;
const H = 860;
const PANEL_W = 0.96; // metres
const PANEL_H = (PANEL_W * H) / W;
const SKY = '#8fd0ee';
const FONT = "'Outfit', system-ui, sans-serif";
const ROW_H = 62;
const ARROWS_W = 330; // value column: ‹ value ›
const TITLES = { pause: 'PAUSED', settings: 'CONTROLS AND SETTINGS', buttons: 'QUEST BUTTONS', lean: 'LEANING SENSITIVITY' };

export class VRMenu {
  constructor(renderer, rig, camera, handlers) {
    this.renderer = renderer;
    this.rig = rig;
    this.camera = camera; // three.js keeps it on the head pose (inside the rig) in VR
    this.h = handlers; // onResume, onLineup, onRecalibrate, onQuit, getVolume, setVolume, info,
    // getLean, setLean, leanNow (your lean while standing), getDroneVR, setDroneVR
    this.open = false;
    this.screen = 'pause';
    this.items = [];
    this.hover = null; // { item, part }
    this.message = '';
    this.dirty = true;

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);
    this.mesh.renderOrder = 1001;
    this.mesh.visible = false;
    rig.add(this.mesh);

    // a pointer ray and cursor dot per controller
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.pointers = [0, 1].map((i) => {
      const ctrl = renderer.xr.getController(i);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x8fd0ee, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }));
      line.renderOrder = 1002;
      line.visible = false;
      ctrl.add(line);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.009, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false }));
      dot.renderOrder = 1003;
      dot.visible = false;
      this.mesh.add(dot);
      const p = { ctrl, line, dot, source: null, hit: null };
      ctrl.addEventListener('connected', (e) => (p.source = e.data));
      ctrl.addEventListener('disconnected', () => (p.source = null));
      ctrl.addEventListener('selectstart', () => this.select(p));
      return p;
    });
    this._ray = new THREE.Raycaster();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.unsub = controls.onChange(() => {
      this.dirty = true;
    });
  }

  show(screen = 'pause') {
    this.open = true;
    this.screen = screen;
    this.message = '';
    this.hover = null;
    this.place();
    this.build();
    this.mesh.visible = true;
  }

  hide() {
    this.open = false;
    this.mesh.visible = false;
    for (const p of this.pointers) {
      p.line.visible = false;
      p.dot.visible = false;
      p.hit = null;
    }
  }

  // float the panel in front of the head, a little below eye level, facing the player
  place() {
    this.rig.updateMatrixWorld(true);
    const head = this.camera.getWorldPosition(new THREE.Vector3());
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const at = head.clone().addScaledVector(fwd, 0.85);
    at.y -= 0.12;
    this.mesh.position.copy(this.rig.worldToLocal(at.clone()));
    this.mesh.lookAt(head.x, at.y, head.z);
  }

  // ---------------------------------------------------------------- content
  build() {
    const items = [];
    const add = (o) => items.push(o);
    if (this.screen === 'pause') {
      const drone = this.h.info().drone;
      add({ label: 'Resume', primary: true, onClick: () => this.h.onResume() });
      add({ label: drone ? 'Relaunch the drone' : 'Back to the lineup', onClick: () => this.h.onLineup() });
      if (drone) add({ label: 'Re-centre the view', sub: 'Puts the camera back where your head is now', onClick: () => this.h.onRecalibrate() });
      else add({ label: 'Recalibrate paddling height', sub: 'Lie or kneel in your paddling position first', onClick: () => this.h.onRecalibrate() });
      add({ label: 'Controls and settings', onClick: () => this.go('settings') });
      add({ label: this.h.info().inRoom ? 'Leave room' : 'Main menu', sub: 'Leaves VR', onClick: () => this.h.onQuit() });
    } else if (this.screen === 'settings') {
      add({ label: 'Quest buttons', sub: 'Change what each button does', onClick: () => this.go('buttons') });
      add({ label: 'Leaning sensitivity', sub: 'How hard the board turns for how far you lean', onClick: () => this.go('lean') });
      add({
        label: 'Drone in VR',
        value: () => (this.h.getDroneVR() === 'fpv' ? 'FPV (acro)' : 'Camera drone'),
        step: () => this.h.setDroneVR(this.h.getDroneVR() === 'fpv' ? 'camera' : 'fpv'),
      });
      add({
        label: 'Volume',
        value: () => `${Math.round(this.h.getVolume() * 100)}%`,
        step: (dir) => this.h.setVolume(Math.max(0, Math.min(1, Math.round(this.h.getVolume() * 10 + dir) / 10))),
      });
      add({ label: 'Back', primary: true, onClick: () => this.go('pause') });
    } else if (this.screen === 'lean') {
      for (const axis of ['x', 'z'])
        for (const key of ['centre', 'max']) {
          add({
            label: `${AXES[axis].title} · ${key === 'centre' ? 'centre' : 'max'}`,
            value: () => `${this.h.getLean()[axis][key].toFixed(2)}×`,
            step: (dir) => {
              const lean = cleanLean(this.h.getLean());
              const [lo, hi] = LEAN_LIMITS[key];
              lean[axis][key] = Math.max(lo, Math.min(hi, Math.round((lean[axis][key] + dir * 0.05) * 100) / 100));
              this.h.setLean(lean);
            },
          });
        }
      add({ spacer: 236 }); // the graphs
      add({
        label: 'Reset to defaults',
        onClick: () => {
          this.h.setLean(LEAN_DEFAULTS);
          this.message = 'Leaning reset to the defaults';
        },
      });
      add({ label: 'Back', primary: true, onClick: () => this.go('settings') });
    } else {
      for (const a of QUEST_ACTIONS) {
        add({
          label: a.label,
          value: () => questLabel(controls.quest[a.id]),
          step: (dir) => this.stepBinding(a, dir),
        });
      }
      add({
        label: 'Reset buttons to defaults',
        onClick: () => {
          controls.resetQuest();
          this.message = 'Buttons reset to the defaults';
        },
      });
      add({ label: 'Back', primary: true, onClick: () => this.go('settings') });
    }
    // lay out the rows under the header
    const big = this.screen === 'pause' || this.screen === 'settings';
    const gap = big ? 22 : 10;
    const h = big ? 76 : ROW_H;
    let y = 128;
    for (const it of items) {
      it.y = y;
      it.h = it.spacer || h;
      y += it.h + gap;
    }
    this.items = items;
    this.dirty = true;
  }

  go(screen) {
    this.screen = screen;
    this.message = '';
    this.hover = null;
    this.build();
  }

  // step a Quest action through the button list, skipping choices that are refused
  stepBinding(a, dir) {
    const opts = QUEST_OPTIONS.filter((o) => !(a.required && o === 'none'));
    let i = opts.indexOf(controls.quest[a.id]);
    for (let n = 0; n < opts.length; n++) {
      i = (i + dir + opts.length) % opts.length;
      const r = controls.setQuest(a.id, opts[i]);
      if (r.refused) continue;
      this.message = r.moved.map((m) => `${m.label} → ${m.now}`).join(' · ');
      return;
    }
  }

  // ---------------------------------------------------------------- pointing
  hitTest(px, py) {
    for (const it of this.items) {
      if (it.spacer) continue;
      if (py < it.y || py > it.y + it.h || px < 40 || px > W - 40) continue;
      if (it.step) {
        const x0 = W - 40 - ARROWS_W;
        if (px < x0) return { item: it, part: 'row' };
        return { item: it, part: px < x0 + ARROWS_W / 2 ? 'prev' : 'next' };
      }
      return { item: it, part: 'row' };
    }
    return null;
  }

  update() {
    if (!this.open) return;
    let hover = null;
    for (const p of this.pointers) {
      const show = !!p.source && p.source.targetRayMode !== 'gaze';
      p.line.visible = show;
      p.dot.visible = false;
      p.hit = null;
      if (!show) continue;
      p.ctrl.getWorldPosition(this._o);
      this._d.set(0, 0, -1).applyQuaternion(p.ctrl.getWorldQuaternion(this._q));
      this._ray.set(this._o, this._d);
      const hit = this._ray.intersectObject(this.mesh, false)[0];
      p.line.scale.z = hit ? hit.distance : 1.2;
      if (!hit || !hit.uv) continue;
      p.hit = this.hitTest(hit.uv.x * W, (1 - hit.uv.y) * H);
      p.dot.visible = true;
      p.dot.position.copy(this.mesh.worldToLocal(hit.point.clone()));
      p.dot.position.z = 0.002;
      if (p.hit) hover = p.hit;
    }
    const key = (x) => (x ? `${this.items.indexOf(x.item)}:${x.part}` : '');
    if (key(hover) !== key(this.hover)) {
      if (hover) for (const p of this.pointers) if (p.hit && key(p.hit) === key(hover)) this.pulse(p, 0.15, 12);
      this.hover = hover;
      this.dirty = true;
    }
    // the leaning graphs follow your lean (a few times a second, while you're standing)
    if (this.screen === 'lean') {
      const now = performance.now();
      const live = this.h.leanNow();
      const key = live ? `${live.x.toFixed(2)},${live.z.toFixed(2)}` : '';
      if (key !== this.liveKey && now - (this.liveAt || 0) > 100) {
        this.liveKey = key;
        this.liveAt = now;
        this.dirty = true;
      }
    }
    if (this.dirty) this.draw();
  }

  select(p) {
    if (!this.open || !p.hit) return;
    const { item, part } = p.hit;
    this.pulse(p, 0.45, 30);
    if (item.step) item.step(part === 'prev' ? -1 : 1);
    else if (item.onClick) item.onClick();
    this.dirty = true;
  }

  pulse(p, strength, ms) {
    const g = p.source && p.source.gamepad;
    const act = g && g.hapticActuators && g.hapticActuators[0];
    if (act && act.pulse) act.pulse(strength, ms).catch?.(() => {});
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    this.dirty = false;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    // panel
    roundRect(g, 4, 4, W - 8, H - 8, 26);
    g.fillStyle = 'rgba(14, 20, 26, 0.94)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    g.stroke();
    // header bar
    g.save();
    roundRect(g, 4, 4, W - 8, H - 8, 26);
    g.clip();
    const grad = g.createLinearGradient(0, 0, 0, 100);
    grad.addColorStop(0, '#3e4043');
    grad.addColorStop(1, '#121314');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, 100);
    g.restore();
    g.fillStyle = 'rgba(143, 208, 238, 0.5)';
    g.fillRect(4, 100, W - 8, 2);
    const info = this.h.info();
    g.textBaseline = 'middle';
    g.fillStyle = SKY;
    g.font = `500 44px ${FONT}`;
    g.textAlign = 'left';
    g.fillText(TITLES[this.screen], 44, 54);
    g.font = `400 26px ${FONT}`;
    g.fillStyle = 'rgba(226, 236, 241, 0.72)';
    g.textAlign = 'right';
    g.fillText(this.screen === 'pause' ? info.subtitle : this.screen === 'lean' ? 'Stand and lean: the dot is you' : 'Point and pull the trigger', W - 44, 54);

    for (const it of this.items) {
      const hov = this.hover && this.hover.item === it ? this.hover.part : null;
      if (it.spacer) this.drawLeanGraphs(g, it);
      else if (it.step) this.drawValueRow(g, it, hov);
      else this.drawButton(g, it, !!hov);
    }
    if (this.message) {
      g.font = `500 26px ${FONT}`;
      g.fillStyle = '#ffc9a8';
      g.textAlign = 'center';
      g.fillText(this.message, W / 2, H - 34);
    }
    this.tex.needsUpdate = true;
  }

  // side to side, and forward and back, with your lean on them
  drawLeanGraphs(g, it) {
    const lean = this.h.getLean();
    const live = this.h.leanNow();
    const w = (W - 80 - 20) / 2;
    for (const [i, axis] of ['x', 'z'].entries()) {
      const x = 40 + i * (w + 20);
      roundRect(g, x, it.y, w, it.h, 14);
      g.fillStyle = 'rgba(255, 255, 255, 0.04)';
      g.fill();
      g.fillStyle = '#eef5f8';
      g.font = `600 22px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(AXES[axis].title, x + 16, it.y + 22);
      drawLeanGraph(g, x + 4, it.y + 40, w - 8, it.h - 46, axis, lean[axis], { scale: 1.7, marker: live ? live[axis] : null, font: FONT });
    }
    g.textBaseline = 'middle';
  }

  drawButton(g, it, hov) {
    const x = 40;
    const w = W - 80;
    roundRect(g, x, it.y, w, it.h, it.h / 2);
    g.fillStyle = hov ? SKY : it.primary ? 'rgba(143, 208, 238, 0.22)' : 'rgba(255, 255, 255, 0.06)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = hov ? SKY : 'rgba(255, 255, 255, 0.24)';
    g.stroke();
    g.fillStyle = hov ? '#0d1a22' : '#eef5f8';
    g.textAlign = 'center';
    g.font = `600 ${it.h > 70 ? 32 : 28}px ${FONT}`;
    g.fillText(it.label, W / 2, it.y + it.h / 2 - (it.sub ? 9 : 0));
    if (it.sub) {
      g.font = `400 20px ${FONT}`;
      g.fillStyle = hov ? 'rgba(13, 26, 34, 0.75)' : 'rgba(226, 236, 241, 0.6)';
      g.fillText(it.sub, W / 2, it.y + it.h / 2 + 18);
    }
  }

  drawValueRow(g, it, hov) {
    const x = 40;
    const w = W - 80;
    roundRect(g, x, it.y, w, it.h, 14);
    g.fillStyle = hov ? 'rgba(143, 208, 238, 0.12)' : 'rgba(255, 255, 255, 0.04)';
    g.fill();
    g.fillStyle = '#eef5f8';
    g.textAlign = 'left';
    g.font = `500 25px ${FONT}`;
    g.fillText(it.label, x + 22, it.y + it.h / 2);
    // ‹ value ›
    const x0 = x + w - ARROWS_W;
    const half = ARROWS_W / 2;
    for (const [part, cx, glyph] of [
      ['prev', x0 + 28, '‹'],
      ['next', x0 + ARROWS_W - 28, '›'],
    ]) {
      g.beginPath();
      g.arc(cx, it.y + it.h / 2, 22, 0, Math.PI * 2);
      g.fillStyle = hov === part ? SKY : 'rgba(255, 255, 255, 0.08)';
      g.fill();
      g.fillStyle = hov === part ? '#0d1a22' : '#eef5f8';
      g.textAlign = 'center';
      g.font = `600 34px ${FONT}`;
      g.fillText(glyph, cx, it.y + it.h / 2 - 3);
    }
    g.fillStyle = SKY;
    g.font = `600 25px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(it.value(), x0 + half, it.y + it.h / 2);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
