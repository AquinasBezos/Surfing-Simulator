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
      callout: document.getElementById('hud-callout'),
      warn: document.getElementById('hud-warn'),
      paddle: document.getElementById('hud-paddle'),
      paddleFill: document.querySelector('#hud-paddle i'),
      foot: document.getElementById('hud-foot'),
      footMark: document.querySelector('#hud-foot i'),
      debug: document.getElementById('debug'),
    };
    this.toastTimer = 0;
    this.toastText = '';
    this.calloutTimer = 0;
    this.calloutText = '';

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

  // Big transient trick call-out ("SNAP", "AIR 0.6 s" ...)
  callout(text, seconds = 1.4) {
    this.calloutText = text;
    this.calloutTimer = seconds;
    const c = this.el.callout;
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth; // restart the animation
    c.classList.add('show');
  }

  drawVR(text) {
    if (text === this._vrText) return;
    this._vrText = text;
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 256);
    if (text) {
      g.fillStyle = 'rgba(8, 30, 40, 0.55)';
      g.beginPath();
      g.roundRect(40, 50, 944, 156, 40);
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
    const el = this.el;
    el.root.classList.toggle('hidden', !!xr || !info.visible);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) el.toast.classList.remove('show');
    }
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) el.callout.classList.remove('show');
    }
    el.state.textContent = info.stateLabel;
    el.speed.textContent = `${Math.round(info.speed * 3.6)} km/h`;
    el.wave.textContent = info.waveLabel;
    el.tube.classList.toggle('show', !!info.inTube && !info.warn);
    el.warn.textContent = info.warn || '';
    el.warn.classList.toggle('show', !!info.warn);
    el.paddle.classList.toggle('show', info.paddle != null);
    if (info.paddle != null) el.paddleFill.style.width = `${Math.round(info.paddle * 100)}%`;
    el.foot.classList.toggle('show', info.foot != null);
    if (info.foot != null) el.footMark.style.left = `${Math.round(info.foot * 100)}%`;
    if (info.debug && el.debug) el.debug.textContent = info.debug;
    // VR
    this.panel.visible = !!xr;
    if (xr) {
      let t = '';
      if (info.warn) t = info.warn;
      else if (this.calloutTimer > 0) t = this.calloutText;
      else if (this.toastTimer > 0) t = this.toastText;
      else if (info.inTube) t = 'IN THE BARREL';
      this.drawVR(t);
      this.panel.material.opacity = t ? 1 : 0;
    }
  }
}
