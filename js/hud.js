// Minimal HUD: DOM overlay on PC, a small head-locked canvas panel in VR.
import * as THREE from 'three';

export class Hud {
  constructor(camera) {
    this.el = {
      root: document.getElementById('hud'),
      state: document.getElementById('hud-state'),
      speed: document.getElementById('hud-speed'),
      wave: document.getElementById('hud-wave'),
      toast: document.getElementById('toast'),
      tube: document.getElementById('hud-tube'),
      debug: document.getElementById('debug'),
    };
    this.toastTimer = 0;
    this.toastText = '';

    // VR panel
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), mat);
    this.panel.position.set(0, -0.22, -1.1);
    this.panel.rotation.x = -0.2;
    this.panel.renderOrder = 1000;
    this.panel.visible = false;
    camera.add(this.panel);
    this._vrText = '';
  }

  toast(text, seconds = 3.5) {
    this.toastText = text;
    this.toastTimer = seconds;
    this.el.toast.innerHTML = text;
    this.el.toast.classList.add('show');
  }

  drawVR(text) {
    if (text === this._vrText) return;
    this._vrText = text;
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 256);
    if (text) {
      g.fillStyle = 'rgba(8, 30, 40, 0.55)';
      const r = 40;
      g.beginPath();
      g.roundRect(40, 50, 944, 156, r);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = '600 56px system-ui, -apple-system, Segoe UI, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 512, 128, 900);
    }
    this.tex.needsUpdate = true;
  }

  update(dt, info, xr) {
    this.el.root.classList.toggle('hidden', !!xr || !info.visible);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
    this.el.state.textContent = info.stateLabel;
    this.el.speed.textContent = `${Math.round(info.speed * 3.6)} km/h`;
    this.el.wave.textContent = info.waveLabel;
    this.el.tube.classList.toggle('show', !!info.inTube);
    if (info.debug && this.el.debug) this.el.debug.textContent = info.debug;
    // VR
    this.panel.visible = !!xr;
    if (xr) {
      let t = '';
      if (this.toastTimer > 0) t = this.toastText;
      else if (info.inTube) t = 'IN THE BARREL';
      this.drawVR(t);
      this.panel.material.opacity = t ? 1 : 0;
    }
  }
}
