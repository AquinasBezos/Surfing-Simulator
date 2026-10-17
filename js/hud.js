// Minimal HUD: DOM overlay on PC, a small head-locked canvas panel in VR. Tricks and ride
// scores come up as chunky stickers, surf-mag style (the same look in VR).
import * as THREE from 'three';

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CHUNKY = "'Titan One', 'Arial Black', system-ui, sans-serif";
const MARKER = "'Permanent Marker', 'Comic Sans MS', system-ui, sans-serif";

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
      ride: document.getElementById('hud-ride'),
      warn: document.getElementById('hud-warn'),
      paddle: document.getElementById('hud-paddle'),
      paddleFill: document.querySelector('#hud-paddle i'),
      foot: document.getElementById('hud-foot'),
      footMark: document.querySelector('#hud-foot i'),
      feed: document.getElementById('hud-feed'),
      players: document.getElementById('hud-players'),
      debug: document.getElementById('debug'),
      replay: document.getElementById('replay-bar'),
    };
    this.toastTimer = 0;
    this.toastText = '';
    this.calloutTimer = 0;
    this.calloutText = '';
    this.calloutSub = '';
    this.rideTimer = 0;
    this.rideInfo = null;
    this.feedTimer = 0;
    this.feedText = '';

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

  // A replay's timeline bar, or null to hide it. r: { t, dur (s), playing, speed, device }.
  // Its buttons (and clicking or dragging along the track) call this.onReplay(command).
  setReplay(r) {
    const el = this.el.replay;
    if (!el) return;
    if (!this.replayBound) {
      this.replayBound = true;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rp]');
        if (b && this.onReplay) this.onReplay(b.dataset.rp);
      });
      const track = el.querySelector('.rp-track');
      const seek = (e) => {
        const box = track.getBoundingClientRect();
        if (this.onReplay) this.onReplay(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
      };
      track.addEventListener('pointerdown', (e) => {
        track.setPointerCapture(e.pointerId);
        seek(e);
        const move = (ev) => seek(ev);
        const up = () => {
          track.removeEventListener('pointermove', move);
          track.removeEventListener('pointerup', up);
          track.removeEventListener('pointercancel', up);
        };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
        track.addEventListener('pointercancel', up);
      });
    }
    el.hidden = !r;
    if (!r) return;
    const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const f = r.dur > 0 ? Math.min(1, r.t / r.dur) : 0;
    const key = `${f.toFixed(3)}|${r.playing}|${r.speed}|${r.device}|${Math.floor(r.t)}`;
    if (key === this.replayKey) return;
    this.replayKey = key;
    el.querySelector('.rp-track i').style.width = `${(f * 100).toFixed(2)}%`;
    el.querySelector('.rp-track b').style.left = `${(f * 100).toFixed(2)}%`;
    el.querySelector('.rp-time').textContent = `${clock(r.t)} / ${clock(r.dur)}`;
    el.querySelector('.rp-play').textContent = r.playing ? '❚❚' : '▶';
    el.querySelector('.rp-speed').textContent = `${r.speed}×`;
    el.classList.toggle('paused', !r.playing);
    el.querySelector('.rp-keys').textContent =
      r.device === 'pad' ? 'X pause · D-pad ◀ ▶ skip 5 s · ▲ ▼ speed · Y restart · Menu: end' : r.device === 'touch' ? '' : 'K pause · J / L skip 5 s · [ ] slow motion · R restart · Esc: end';
  }

  toast(text, seconds = 3.5) {
    this.toastText = text;
    this.toastTimer = seconds;
    this.el.toast.innerHTML = text;
    this.el.toast.classList.add('show');
  }

  // Multiplayer event feed ("Kai paddled out", "Mia: Snap!")
  feed(text) {
    const li = document.createElement('li');
    li.textContent = text;
    this.el.feed.appendChild(li);
    while (this.el.feed.children.length > 5) this.el.feed.firstChild.remove();
    setTimeout(() => li.remove(), 5600);
    this.feedText = text;
    this.feedTimer = 3;
  }

  setPlayers(text) {
    if (this.el.players.textContent !== text) this.el.players.textContent = text;
  }

  // Big transient trick call-out ("SNAP" +40, "HANG TEN!" ...): a sticker slapped on at a
  // jaunty angle, with a scrawled line under it
  callout(text, sub = '', seconds = 1.6) {
    this.calloutText = text;
    this.calloutSub = sub;
    this.calloutTimer = seconds;
    const c = this.el.callout;
    c.style.setProperty('--tilt', `${(Math.random() * 2 - 1) * 5 - 4}deg`);
    c.innerHTML = `<b data-t="${esc(text)}">${esc(text)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}`;
    c.classList.remove('show');
    void c.offsetWidth; // restart the animation
    c.classList.add('show');
  }

  // End of a ride: the score in big chunky numbers, the details scrawled underneath
  rideCard(title, score, lines, best = false, seconds = 5.5) {
    this.rideInfo = { title, score, lines, best };
    this.rideTimer = seconds;
    const r = this.el.ride;
    r.innerHTML = `<em>${esc(title)}</em><b data-t="${score}">${score}<small>pts</small></b>${best ? '<strong>New best!</strong>' : ''}<i>${lines.map(esc).join(' &middot; ')}</i>`;
    r.classList.remove('show');
    void r.offsetWidth;
    r.classList.add('show');
  }

  // the sticker look on the VR panel: big gradient letters with a thick outline
  drawSticker(g, big, small) {
    g.save();
    g.translate(512, 118);
    g.rotate(-0.07);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `92px ${CHUNKY}`;
    g.lineJoin = 'round';
    const t = big.toUpperCase();
    g.fillStyle = '#082a4a';
    g.fillText(t, 7, 9, 900); // drop shadow
    g.lineWidth = 16;
    g.strokeStyle = '#082a4a';
    g.strokeText(t, 0, 0, 900);
    const grad = g.createLinearGradient(0, -46, 0, 46);
    grad.addColorStop(0, '#fff36b');
    grad.addColorStop(0.55, '#ffb21e');
    grad.addColorStop(1, '#ff5b2e');
    g.fillStyle = grad;
    g.fillText(t, 0, 0, 900);
    if (small) {
      g.font = `48px ${MARKER}`;
      g.lineWidth = 10;
      g.strokeStyle = '#082a4a';
      g.strokeText(small, 30, 84, 860);
      g.fillStyle = '#5ff2ff';
      g.fillText(small, 30, 84, 860);
    }
    g.restore();
  }

  drawVR(text, sticker = null) {
    const key = sticker ? `S:${sticker.join('|')}` : text;
    if (key === this._vrText) return;
    this._vrText = key;
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 256);
    if (sticker) this.drawSticker(g, sticker[0], sticker[1]);
    else if (text) {
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
    if (this.rideTimer > 0) {
      this.rideTimer -= dt;
      if (this.rideTimer <= 0) el.ride.classList.remove('show');
    }
    if (this.feedTimer > 0) this.feedTimer -= dt;
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
      let sticker = null;
      if (info.warn) t = info.warn;
      else if (this.calloutTimer > 0) sticker = [this.calloutText, this.calloutSub];
      else if (this.rideTimer > 0 && this.rideTimer > 2.5) sticker = [`${this.rideInfo.score} pts`, this.rideInfo.best ? 'New best!' : this.rideInfo.title];
      else if (this.toastTimer > 0) t = this.toastText;
      else if (this.feedTimer > 0) t = this.feedText;
      else if (info.inTube) sticker = ['Tubed!', ''];
      else if (info.vrLine) t = info.vrLine;
      this.drawVR(t, sticker);
      this.panel.material.opacity = t || sticker ? 1 : 0;
    }
  }
}
