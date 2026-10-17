// LINEUP menus: main mode cards, singleplayer / multiplayer / settings sub-screens, the
// multiplayer room browser and lobby, and the in-game pause screen. Pure DOM; the game
// is driven through the handler callbacks passed to the constructor.
import { controls, PC_ACTIONS, QUEST_ACTIONS, QUEST_OPTIONS, PAD_ACTIONS, RESERVED_KEYS, keyLabel, questLabel, padLabel } from './bindings.js';
import { SPOTS, SPOT_IDS, cleanSpot } from './spots.js';
import { SKIN_TONES, HAIR_COLORS, BOARD_COLORS, cleanLook, randomLook } from './character.js';
import { CharacterPreview } from './preview.js';
import { cleanLean, cleanPad, cleanTilt, drawLeanGraph, AXES, LEAN_LIMITS, LEAN_DEFAULTS, PAD_DEFAULTS, TILT_DEFAULTS } from './lean.js';

const BOARD_SVG = {
  shortboard:
    '<svg viewBox="0 0 44 92" aria-hidden="true"><path class="deck" d="M22 3c8 12 13 30 13 52 0 15-3 26-6 33H15c-3-7-6-18-6-33C9 33 14 15 22 3z" fill="#f4f3ee" stroke="#9fb2bd" stroke-width="1.2"/><path d="M22 6v80" stroke="#2b2b2b" stroke-width="1"/></svg>',
  longboard:
    '<svg viewBox="0 0 44 92" aria-hidden="true"><path class="deck" d="M22 2c10 1 15 14 15 40 0 26-3 40-6 47H13c-3-7-6-21-6-47C7 16 12 3 22 2z" fill="#f2ecdd" stroke="#9fb2bd" stroke-width="1.2"/><path d="M8.5 30c0 20 1 40 5 56M35.5 30c0 20-1 40-5 56" stroke="#c0492b" stroke-width="1" fill="none"/><path d="M22 4v84" stroke="#2b2b2b" stroke-width="1"/></svg>',
};
const BOARD_INFO = {
  shortboard: ['Shortboard', '6\'1" · snaps, tailslides, barrels'],
  longboard: ['Longboard', '9\'2" · glides, walk to the nose'],
};
const CRUMBS = { main: '', single: 'Singleplayer', multi: 'Multiplayer', lobby: 'Multiplayer', settings: 'Controls and settings', pause: '' };

const DEFAULT_SETTINGS = { quality: 'auto', volume: 0.8, sensitivity: 1, invertY: false, fullscreen: true, time: 'day', lean: LEAN_DEFAULTS, pad: PAD_DEFAULTS, tilt: TILT_DEFAULTS, droneVR: 'camera' };

// Sensitivity curves: VR leaning, controller sticks, phone tilt. Each: where its editors go,
// its axes (setting key -> graph axis, lean.js), and its reset button.
const CURVE_SETS = {
  lean: { el: 'lean-set', axes: { x: 'x', z: 'z' }, clean: cleanLean, defaults: LEAN_DEFAULTS, reset: 'lean-reset' },
  pad: { el: 'pad-curves', axes: { x: 'pad.x', z: 'pad.z', look: 'pad.look' }, clean: cleanPad, defaults: PAD_DEFAULTS, reset: 'pad-curves-reset' },
  tilt: { el: 'tilt-curves', axes: { x: 'tilt.x', z: 'tilt.z' }, clean: cleanTilt, defaults: TILT_DEFAULTS, reset: 'tilt-reset' },
};

// the keys on the prompts along the bottom, for what you're playing with
const PROMPT_KEYS = {
  kbm: { choose: '\u2190 \u2192', select: 'Enter', back: 'Esc' },
  pad: { choose: 'D-pad', select: 'A', back: 'B' },
  touch: { choose: '', select: '', back: '' },
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* storage unavailable */
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// a wave setting, kept to the spot's range of sizes
const cleanWaves = (w, spot) => {
  const R = SPOTS[cleanSpot(spot)].heights;
  return {
    mode: w && w.mode === 'random' ? 'random' : 'set',
    height: Math.round(Math.min(R.max, Math.max(R.min, Number(w && w.height) || R.default)) * 10) / 10,
  };
};
const waveWords = (h) =>
  h < 0.9 ? 'knee to waist high' : h < 1.3 ? 'waist to chest high' : h < 1.8 ? 'about head high' : h < 2.5 ? 'overhead' : h < 3.6 ? 'well overhead' : h < 4.8 ? 'double overhead' : 'triple overhead, and heavy';
// your wave size is remembered for each spot (Margaret River's under the original key)
const wavesKey = (spot) => (spot === 'margaret' ? 'lineup.waves' : `lineup.waves.${spot}`);
const TIME_NAMES = { day: 'Midday', sunset: 'Sunset' };
const spotImage = (id) => `assets/menu/spot-${id}.jpg`;

// The menu backdrop: a faint sea chart, depth contours (every fifth one heavier) over a
// lat / long grid. Drawn once, when the page is idle.
function drawChart(w = 960, h = 540) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.className = 'chart';
  const g = c.getContext('2d');
  // value noise (fbm) on the pixel grid
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let fx = x - xi,
      fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi),
      b = hash(xi + 1, yi),
      cc = hash(xi, yi + 1),
      d = hash(xi + 1, yi + 1);
    return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
  };
  const n = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0,
        amp = 0.5,
        f = 1 / 210;
      for (let o = 0; o < 4; o++) {
        v += amp * noise(x * f + o * 7.1, y * f * 1.25 + o * 3.3);
        amp *= 0.5;
        f *= 2.1;
      }
      n[y * w + x] = v + y / h / 2.2; // (deeper toward the top: the lines run across)
    }
  const img = g.createImageData(w, h);
  const levels = 26;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = n[i] * levels;
      const grad = Math.hypot(n[i + 1] - n[i - 1], n[i + w] - n[i - w]) * 0.5 * levels;
      const f = v - Math.floor(v);
      const dist = Math.min(f, 1 - f) / Math.max(grad, 1e-4); // pixels from the nearest contour
      const major = Math.floor(v + 0.5) % 5 === 0;
      let a = Math.max(0, 1 - dist / (major ? 1.1 : 0.75)) * (major ? 0.34 : 0.16);
      if (x % 96 === 0 || y % 96 === 0) a = Math.max(a, 0.06); // the grid
      const k = i * 4;
      img.data[k] = 150;
      img.data[k + 1] = 205;
      img.data[k + 2] = 232;
      img.data[k + 3] = a * 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

// "Crouch (while surfing) is now C" for actions that gave up a key or button
const moveText = (moved) => moved.map((m) => `${m.label} ${m.now === 'nothing' || m.now === 'Not set' ? 'is now unbound' : `is now ${m.now}`}.`).join(' ');

export class Menu {
  constructor(h) {
    this.h = h;
    this.root = document.getElementById('menu');
    this.crumb = document.getElementById('crumb');
    this.screens = Object.fromEntries([...this.root.querySelectorAll('.screen')].map((s) => [s.dataset.screen, s]));
    this.stack = [];
    this.current = null;
    this.board = 'shortboard';
    this.settings = { ...DEFAULT_SETTINGS, ...load('lineup.settings', {}) };
    this.settings.lean = cleanLean(this.settings.lean);
    this.settings.pad = cleanPad(this.settings.pad);
    this.settings.tilt = cleanTilt(this.settings.tilt);
    this.device = 'kbm'; // what you're playing with (the prompts follow it)
    this.touchDevice = false;
    this.settings.droneVR = this.settings.droneVR === 'fpv' ? 'fpv' : 'camera';
    this.name = load('lineup.name', null) || `Surfer ${100 + Math.floor(Math.random() * 900)}`;
    this.rooms = [];
    this.inRoom = false;
    this.privacy = 'public';
    this.role = load('lineup.role', 'surfer') === 'drone' ? 'drone' : 'surfer';
    this.vrSupported = false;
    // where you surf (singleplayer, and the rooms you create); in a room, the room's spot
    // sets the wave sizes on offer
    this.spot = cleanSpot(load('lineup.spot', null));
    this.waveSpot = this.spot;
    this.waves = cleanWaves(load(wavesKey(this.spot), null), this.spot);
    // your look: random the first time (so everyone looks different), then remembered
    this.look = cleanLook(load('lineup.look', null));
    save('lineup.look', this.look);
    this.preview = new CharacterPreview();
    this.prompts = document.getElementById('prompts');
    this.cards = [...this.root.querySelectorAll('.mode-card')];
    this.sel = this.cards[0];
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    idle(() => this.root.querySelector('.menu-bg').appendChild(drawChart()));

    this.buildBoardPickers();
    this.buildWavePickers();
    this.buildSpotPickers();
    this.buildTimePickers();
    this.buildLookPickers();
    this.bindMain();
    this.bindNav();
    this.bindNames();
    this.bindSettings();
    this.bindMultiplayer();
    this.bindRole();
    this.bindPass();
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.show('main');
  }

  // ---------------------------------------------------------------- navigation
  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  // Opaque menu screens hide the world; the pause screen overlays it.
  get opaque() {
    return this.isOpen && !this.root.classList.contains('ingame');
  }

  show(name, { push = true } = {}) {
    if (this.capture) this.endCapture();
    if (this.current && this.current !== name && push) this.stack.push(this.current);
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('on', k === name);
    this.current = name;
    this.crumb.textContent = CRUMBS[name] || '';
    this.root.classList.remove('hidden');
    if (name === 'main') this.stack = [];
    if (name === 'multi' && this.h.onOpenMulti) this.h.onOpenMulti();
    if (name === 'pause') this.stack = [];
    // (on the main screen one card is always selected; nothing has the keyboard focus)
    const focusable = this.screens[name].querySelector('[data-resume], .btn.primary, input');
    if (focusable && name !== 'multi' && name !== 'main') setTimeout(() => focusable.focus({ preventScroll: true }), 30);
    else if (name === 'main' && document.activeElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    if (name === 'main') this.select(this.sel);
    this.showPrompts(name);
    this.syncPreview();
  }

  // keyboard and mouse, a controller or touch: the prompts show its buttons
  setDevice(d) {
    this.device = d;
    this.root.dataset.device = d;
    if (this.current) this.showPrompts(this.current);
  }

  setTouchDevice(on) {
    this.touchDevice = on;
    this.playLabels();
  }

  // ---------------------------------------------------------------- with a controller
  // cmd: up, down, left, right, accept, back, start. On the main screen the directions move
  // the selected card; elsewhere they move the focus to the nearest control that way (left
  // and right change a focused slider or list instead).
  navigate(cmd) {
    if (!this.isOpen || this.capture || this.padCapture) return;
    const dlg = document.getElementById('pass-dialog');
    const scope = dlg.hidden ? this.screens[this.current] : dlg;
    if (cmd === 'back') {
      if (!dlg.hidden) return this.closePass();
      if (this.current === 'pause') return this.h.onResume && this.h.onResume();
      if (this.current !== 'main' && this.current !== 'lobby') this.back();
      return;
    }
    if (cmd === 'start') {
      if (this.current === 'pause') this.h.onResume && this.h.onResume();
      return;
    }
    if (this.current === 'main' && dlg.hidden) {
      const i = this.cards.indexOf(this.sel);
      if (cmd === 'accept') return this.sel && this.sel.click();
      const step = cmd === 'right' || cmd === 'down' ? 1 : -1;
      const next = this.cards[(i + step + this.cards.length) % this.cards.length];
      this.select(next);
      next.focus({ preventScroll: true });
      return;
    }
    const el = document.activeElement;
    const inScope = el && el !== document.body && scope.contains(el) && this.focusables(scope).includes(el);
    if (!inScope) return this.focusFirst(scope);
    if (cmd === 'accept') {
      if (el.tagName === 'SELECT') return this.stepSelect(el, 1);
      return el.click();
    }
    if ((cmd === 'left' || cmd === 'right') && (el.type === 'range' || el.tagName === 'SELECT')) {
      const dir = cmd === 'right' ? 1 : -1;
      if (el.tagName === 'SELECT') return this.stepSelect(el, dir);
      if (el.disabled) return;
      const st = Number(el.step) || 1;
      el.value = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + dir * st));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const next = this.nearest(scope, el, cmd);
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  focusables(scope) {
    return [...scope.querySelectorAll('button, input, select, a[href]')].filter((e) => !e.disabled && e.type !== 'hidden' && !e.classList.contains('visually-hidden') && e.getClientRects().length && !e.closest('[hidden]'));
  }

  focusFirst(scope) {
    const f = scope.querySelector('[data-resume]:not([disabled])') || scope.querySelector('.btn.primary:not([disabled])') || this.focusables(scope)[0];
    if (f) {
      f.focus({ preventScroll: true });
      f.scrollIntoView({ block: 'nearest' });
    }
  }

  // the closest control in that direction (straight ahead counts for more than off to the side)
  nearest(scope, from, dir) {
    const r0 = from.getBoundingClientRect();
    const c0 = [r0.left + r0.width / 2, r0.top + r0.height / 2];
    let best = null,
      bestScore = Infinity;
    for (const e of this.focusables(scope)) {
      if (e === from) continue;
      const r = e.getBoundingClientRect();
      const c = [r.left + r.width / 2, r.top + r.height / 2];
      const dx = c[0] - c0[0],
        dy = c[1] - c0[1];
      let along, across;
      if (dir === 'right') [along, across] = [dx, dy];
      else if (dir === 'left') [along, across] = [-dx, dy];
      else if (dir === 'down') [along, across] = [dy, dx];
      else [along, across] = [-dy, dx];
      if (along < 4) continue;
      const score = along + Math.abs(across) * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  stepSelect(el, dir) {
    const n = el.options.length;
    el.selectedIndex = (el.selectedIndex + dir + n) % n;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // the main screen's selected card
  select(card) {
    if (!card) return;
    this.sel = card;
    for (const c of this.cards) c.classList.toggle('sel', c === card);
  }

  // the key prompts along the bottom, for this screen
  showPrompts(name) {
    const K = PROMPT_KEYS[this.device] || PROMPT_KEYS.kbm;
    const list = [];
    if (name === 'main') {
      if (K.choose) list.push({ key: K.choose, label: 'Choose' });
      list.push({ key: K.select, label: 'Select', cls: 'p-go', act: () => this.sel && this.sel.click() });
    } else if (name === 'pause') {
      list.push({ key: K.back, label: 'Resume', cls: 'p-back', act: () => this.h.onResume && this.h.onResume() });
    } else if (name !== 'lobby') {
      list.push({ key: K.back, label: 'Back', cls: 'p-back', act: () => this.back() });
    }
    this.prompts.innerHTML = list.map((p, i) => `<button type="button" class="prompt ${p.cls || ''}" data-prompt="${i}" ${p.act ? '' : 'disabled'}>${p.key ? `<kbd>${esc(p.key)}</kbd>` : ''}${esc(p.label)}</button>`).join('');
    this.prompts.onclick = (e) => {
      const b = e.target.closest('[data-prompt]');
      const p = b && list[+b.dataset.prompt];
      if (p && p.act) p.act();
    };
    this.prompts.parentElement.hidden = !list.length;
  }

  back() {
    if (this.current === 'multi' && this.h.onCloseMulti) this.h.onCloseMulti();
    const prev = this.stack.pop();
    if (prev) this.show(prev, { push: false });
    else if (this.root.classList.contains('ingame')) this.show('pause', { push: false });
    else this.show('main', { push: false });
  }

  hide() {
    this.root.classList.add('hidden');
    this.preview.stop();
  }

  setInGame(on) {
    this.root.classList.toggle('ingame', on);
  }

  // The pause screen's replay buttons: can (there's something to replay: singleplayer),
  // active (a replay is on: resume it or end it)
  setReplay({ can, active }) {
    const q = (sel) => this.root.querySelector(sel);
    q('[data-replay]').hidden = active || !can;
    q('[data-endreplay]').hidden = !active;
    q('[data-lineup]').hidden = active;
    q('[data-resume]').textContent = active ? 'Resume replay' : 'Resume';
    document.getElementById('pause-title').textContent = active ? 'Replay paused' : 'Paused';
  }

  onKey(e) {
    if (!this.isOpen) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key === 'Escape') {
      if (!document.getElementById('pass-dialog').hidden) return this.closePass();
      if (this.current === 'pause') {
        e.preventDefault();
        return this.h.onResume && this.h.onResume();
      }
      if (this.current !== 'main' && this.current !== 'lobby') {
        e.preventDefault();
        this.back();
      }
      return;
    }
    if (this.current === 'main' && tag !== 'INPUT') {
      // arrow keys move the selection (and its blue outline) between the cards; Enter picks it
      const cards = this.cards;
      const i = cards.indexOf(this.sel);
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % cards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + cards.length - 1) % cards.length;
      if (next >= 0) {
        e.preventDefault();
        this.select(cards[next]);
        cards[next].focus({ preventScroll: true });
      } else if (e.key === 'Enter' && !cards.includes(document.activeElement)) {
        e.preventDefault();
        if (this.sel) this.sel.click();
      }
    }
  }

  bindMain() {
    // one card is selected at a time: the mouse or the keyboard moves it
    for (const card of this.cards) {
      card.addEventListener('mouseenter', () => {
        const f = document.activeElement;
        if (f && f !== card && f.classList.contains('mode-card')) f.blur();
        this.select(card);
      });
      card.addEventListener('focus', () => this.select(card));
    }
  }

  bindNav() {
    this.root.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        if (go.dataset.go === 'multi' && this.inRoom) return this.show('lobby');
        return this.show(go.dataset.go);
      }
      if (e.target.closest('[data-back]')) return this.back();
      const play = e.target.closest('[data-play]');
      if (play && !play.disabled) {
        const mode = this.current === 'lobby' ? 'multi' : 'single';
        return this.h.onPlay && this.h.onPlay(mode, play.dataset.play);
      }
      if (e.target.closest('[data-resume]')) return this.h.onResume && this.h.onResume();
      if (e.target.closest('[data-replay]')) return this.h.onReplay && this.h.onReplay();
      if (e.target.closest('[data-endreplay]')) return this.h.onEndReplay && this.h.onEndReplay();
      if (e.target.closest('[data-lineup]')) return this.h.onLineup && this.h.onLineup();
      if (e.target.closest('[data-level]')) return this.h.onLevel && this.h.onLevel(true);
      if (e.target.closest('[data-quit]')) return this.h.onQuit && this.h.onQuit();
      if (e.target.closest('[data-leave]')) return this.h.onLeaveRoom && this.h.onLeaveRoom();
    });
  }

  // ---------------------------------------------------------------- boards
  buildBoardPickers() {
    for (const pick of this.root.querySelectorAll('.board-pick')) {
      pick.innerHTML = Object.entries(BOARD_INFO)
        .map(([k, [title, sub]]) => `<button type="button" class="board-opt" role="radio" data-board="${k}" aria-checked="false">${BOARD_SVG[k]}<b>${title}</b><small>${sub}</small></button>`)
        .join('');
      pick.addEventListener('click', (e) => {
        const b = e.target.closest('[data-board]');
        if (b) this.setBoard(b.dataset.board, true);
      });
    }
  }

  // ---------------------------------------------------------------- your look
  buildLookPickers() {
    const row = (key, label, colors) =>
      `<div class="swatch-row"><span>${label}</span><div class="swatches" role="radiogroup" aria-label="${label} colour">${colors
        .map((c) => `<button type="button" class="swatch" role="radio" data-look="${key}" data-color="${c}" style="--c:${c}" aria-label="${label} ${c}"></button>`)
        .join('')}</div></div>`;
    for (const el of this.root.querySelectorAll('.look-pick')) {
      el.innerHTML = `<div class="look-preview"></div><div class="look-opts">${row('skin', 'Skin', SKIN_TONES)}${row('hair', 'Hair', HAIR_COLORS)}${row('board', 'Board', BOARD_COLORS)}<button type="button" class="link look-random">Random look</button></div>`;
      el.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-look]');
        if (sw) this.setLook({ ...this.look, [sw.dataset.look]: sw.dataset.color }, true);
        else if (e.target.closest('.look-random')) this.setLook(randomLook(), true);
      });
    }
    this.setLook(this.look);
  }

  setLook(look, fromUser = false) {
    this.look = cleanLook(look);
    for (const sw of this.root.querySelectorAll('.swatch')) {
      const on = this.look[sw.dataset.look] === sw.dataset.color;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
    }
    for (const d of this.root.querySelectorAll('.board-opt .deck')) d.setAttribute('fill', this.look.board);
    this.preview.set(this.look, this.board);
    if (fromUser) {
      save('lineup.look', this.look);
      if (this.h.onLook) this.h.onLook(this.look);
    }
  }

  // run the turntable only on a screen that shows it
  syncPreview() {
    const scr = this.isOpen && this.screens[this.current];
    const slot = scr && scr.querySelector('.look-pick:not([hidden]) .look-preview');
    if (slot) {
      this.preview.attach(slot);
      this.preview.start();
    } else this.preview.stop();
  }

  // ---------------------------------------------------------------- surf spot
  buildSpotPickers() {
    for (const el of this.root.querySelectorAll('.spot-pick')) {
      const opts = SPOT_IDS.map((id) => {
        const S = SPOTS[id];
        return `<button type="button" class="spot-opt" role="radio" data-spot="${id}" aria-checked="false"><img src="${spotImage(id)}" alt="" /><b>${esc(S.name)}</b><small>${esc(S.place)} · ${esc(S.blurb)}</small></button>`;
      }).join('');
      el.innerHTML = `<div class="wave-row"><span class="wave-label">Location</span></div><div class="spot-opts" role="radiogroup" aria-label="Location">${opts}</div>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-spot]');
        if (b) this.setSpot(b.dataset.spot, true);
      });
    }
    this.setSpot(this.spot);
  }

  // Your spot (singleplayer, and rooms you create). Its wave sizes come with it.
  setSpot(id, fromUser = false) {
    this.spot = cleanSpot(id);
    for (const b of this.root.querySelectorAll('[data-spot]')) b.setAttribute('aria-checked', String(b.dataset.spot === this.spot));
    if (!this.inRoom) {
      this.waveSpot = this.spot;
      this.setWaves(load(wavesKey(this.spot), null));
    }
    if (fromUser) {
      save('lineup.spot', this.spot);
      if (this.h.onSpot) this.h.onSpot(this.spot);
      if (this.h.onWaves && !this.inRoom) this.h.onWaves(this.waves);
    }
  }

  // ---------------------------------------------------------------- time of day
  buildTimePickers() {
    for (const el of this.root.querySelectorAll('.tod-pick')) {
      el.innerHTML = `<div class="wave-row"><span class="wave-label">Time of day</span><div class="seg" role="radiogroup" aria-label="Time of day"><button type="button" role="radio" data-tod="day">Midday</button><button type="button" role="radio" data-tod="sunset">Sunset</button></div></div>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-tod]');
        if (b) this.setTimeOfDay(b.dataset.tod, true);
      });
    }
    this.setTimeOfDay(this.settings.time);
  }

  setTimeOfDay(time, fromUser = false) {
    this.settings.time = time === 'sunset' ? 'sunset' : 'day';
    for (const b of this.root.querySelectorAll('[data-tod]')) {
      const on = b.dataset.tod === this.settings.time;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (fromUser) {
      save('lineup.settings', this.settings);
      if (this.h.onSettings) this.h.onSettings(this.settings);
    }
  }

  // ---------------------------------------------------------------- wave size
  buildWavePickers() {
    for (const el of this.root.querySelectorAll('.wave-pick')) {
      el.innerHTML = `<div class="wave-row"><span class="wave-label">Waves</span><div class="seg" role="radiogroup" aria-label="Wave size"><button type="button" role="radio" data-wmode="set">Set height</button><button type="button" role="radio" data-wmode="random">Random</button></div></div><input type="range" step="0.1" aria-label="Wave height" /><p class="wave-desc"></p>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-wmode]');
        if (b) this.setWaves({ ...this.waves, mode: b.dataset.wmode }, true);
      });
      const range = el.querySelector('input');
      // show the size while dragging; apply it (and tell the room) on release
      range.addEventListener('input', () => this.setWaves({ mode: 'set', height: +range.value }));
      range.addEventListener('change', () => this.setWaves({ mode: 'set', height: +range.value }, true));
    }
    this.setWaves(this.waves);
  }

  // Show a wave setting (the room's while you're in one). fromUser: the player changed it.
  setWaves(cfg, fromUser = false) {
    this.waves = cleanWaves(cfg, this.waveSpot);
    const { mode, height } = this.waves;
    const R = SPOTS[this.waveSpot].heights;
    for (const el of this.root.querySelectorAll('.wave-pick')) {
      for (const b of el.querySelectorAll('[data-wmode]')) {
        b.classList.toggle('on', b.dataset.wmode === mode);
        b.setAttribute('aria-checked', String(b.dataset.wmode === mode));
      }
      const range = el.querySelector('input');
      range.min = R.min;
      range.max = R.max;
      if (document.activeElement !== range) range.value = height;
      range.disabled = mode === 'random';
      el.querySelector('.wave-desc').textContent =
        mode === 'random' ? `Sets build and fade over a few minutes, from ${R.randomMin.toFixed(1)} m to ${R.randomMax.toFixed(1)} m.` : `${height.toFixed(1)} m · ${waveWords(height)}`;
    }
    if (fromUser) {
      save(wavesKey(this.waveSpot), { mode, height });
      if (this.h.onWaves) this.h.onWaves(this.waves);
    }
  }

  setBoard(type, fromUser = false) {
    this.board = type;
    if (this.preview) this.preview.set(this.look, type);
    for (const b of this.root.querySelectorAll('.board-opt')) b.setAttribute('aria-checked', String(b.dataset.board === type));
    if (fromUser && this.h.onBoard) this.h.onBoard(type);
  }

  // ---------------------------------------------------------------- names
  bindNames() {
    const inputs = [...this.root.querySelectorAll('.name-input')];
    for (const inp of inputs) {
      inp.value = this.name;
      const commit = () => {
        const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (!v) {
          inp.value = this.name;
          return;
        }
        if (v === this.name) return;
        this.name = v;
        save('lineup.name', v);
        for (const other of inputs) if (other !== inp) other.value = v;
        if (this.h.onName) this.h.onName(v);
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commit();
          inp.blur();
        }
      });
    }
  }

  // ---------------------------------------------------------------- settings
  bindSettings() {
    const s = this.settings;
    const q = document.getElementById('set-quality');
    const vol = document.getElementById('set-volume');
    const sens = document.getElementById('set-sens');
    const inv = document.getElementById('set-invert');
    const fs = document.getElementById('set-fullscreen');
    const outV = document.getElementById('out-volume');
    const outS = document.getElementById('out-sens');
    q.value = s.quality;
    vol.value = Math.round(s.volume * 100);
    sens.value = Math.round(s.sensitivity * 100);
    inv.checked = s.invertY;
    fs.checked = s.fullscreen;
    const showOut = () => {
      outV.textContent = `${vol.value}%`;
      outS.textContent = `${(sens.value / 100).toFixed(2)}×`;
    };
    showOut();
    const initialQuality = s.quality;
    const apply = () => {
      s.quality = q.value;
      s.volume = vol.value / 100;
      s.sensitivity = sens.value / 100;
      s.invertY = inv.checked;
      s.fullscreen = fs.checked;
      document.getElementById('quality-note').hidden = s.quality === initialQuality;
      showOut();
      save('lineup.settings', s);
      if (this.h.onSettings) this.h.onSettings(s);
    };
    for (const el of [q, vol, sens, inv, fs]) el.addEventListener('input', apply);
    document.getElementById('reload').addEventListener('click', () => location.reload());
    this._volumeInput = vol;
    this._applySettings = apply;

    for (const t of this.screens.settings.querySelectorAll('[data-stab]')) {
      t.addEventListener('click', () => this.selectSettingsTab(t.dataset.stab));
    }
    this.bindKeybinds();
    this.buildCurves();
    this.bindDroneVR();
  }

  // ---------------------------------------------------------------- sensitivity curves
  // VR leaning, controller sticks and phone tilt: a centre and a max slider per axis, and a
  // graph of what it does
  buildCurves() {
    const row = (group, k, key, label) => {
      const [lo, hi] = LEAN_LIMITS[key];
      return `<label class="field"><span>${label} <output data-curve-out="${group}.${k}.${key}"></output></span><input type="range" min="${lo}" max="${hi}" step="0.05" data-curve="${group}.${k}.${key}" /></label>`;
    };
    this.curveResize = new ResizeObserver(() => this.drawCurves());
    for (const [group, C] of Object.entries(CURVE_SETS)) {
      const set = document.getElementById(C.el);
      set.innerHTML = Object.entries(C.axes)
        .map(([k, axis]) => `<div class="lean-axis"><b>${AXES[axis].title} <small>· ${AXES[axis].what}</small></b>${row(group, k, 'centre', 'Centre sensitivity')}${row(group, k, 'max', 'Max sensitivity')}<canvas data-curve-graph="${group}.${k}"></canvas></div>`)
        .join('');
      set.addEventListener('input', (e) => {
        const r = e.target.closest('[data-curve]');
        if (!r) return;
        const [g, k, key] = r.dataset.curve.split('.');
        const v = C.clean(this.settings[g]);
        v[k][key] = +r.value;
        this.setCurves(g, v, true);
      });
      document.getElementById(C.reset).addEventListener('click', () => this.setCurves(group, { ...C.defaults, invertY: this.settings[group].invertY }, true));
      for (const c of set.querySelectorAll('canvas')) this.curveResize.observe(c);
    }
    // the controller's look speed and invert, the touch look sensitivity
    const extra = (id, group, key, read) =>
      document.getElementById(id).addEventListener('input', (e) => {
        const v = CURVE_SETS[group].clean(this.settings[group]);
        v[key] = read(e.target);
        this.setCurves(group, v, true);
      });
    extra('set-pad-look', 'pad', 'lookSpeed', (el) => +el.value);
    extra('set-pad-invert', 'pad', 'invertY', (el) => el.checked);
    extra('set-touch-look', 'tilt', 'look', (el) => +el.value);
    // the tilt's direction correction, recalibrating, and the live level
    for (const b of this.root.querySelectorAll('[data-tiltturn]'))
      b.addEventListener('click', () => {
        const v = cleanTilt(this.settings.tilt);
        v.turn = +b.dataset.tiltturn;
        this.setCurves('tilt', v, true);
      });
    document.getElementById('tilt-calibrate').addEventListener('click', () => this.h.onLevel && this.h.onLevel());
    this.watchTilt();
    for (const g of Object.keys(CURVE_SETS)) this.setCurves(g, this.settings[g]);
  }

  // a set of curves (from the page, or the headset menu for leaning); fromUser: save and apply
  setCurves(group, value, fromUser = false) {
    const v = (this.settings[group] = CURVE_SETS[group].clean(value));
    for (const r of this.root.querySelectorAll(`[data-curve^="${group}."]`)) {
      const [, k, key] = r.dataset.curve.split('.');
      if (document.activeElement !== r) r.value = v[k][key];
    }
    for (const o of this.root.querySelectorAll(`[data-curve-out^="${group}."]`)) {
      const [, k, key] = o.dataset.curveOut.split('.');
      o.textContent = `${v[k][key].toFixed(2)}×`;
    }
    if (group === 'pad') {
      document.getElementById('set-pad-look').value = v.lookSpeed;
      document.getElementById('out-pad-look').textContent = `${v.lookSpeed}°/s`;
      document.getElementById('set-pad-invert').checked = v.invertY;
    } else if (group === 'tilt') {
      document.getElementById('set-touch-look').value = v.look;
      document.getElementById('out-touch-look').textContent = `${v.look.toFixed(2)}×`;
      for (const b of this.root.querySelectorAll('[data-tiltturn]')) {
        const on = +b.dataset.tiltturn === v.turn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
    }
    this.drawCurves();
    if (fromUser) {
      save('lineup.settings', this.settings);
      if (this.h.onSettings) this.h.onSettings(this.settings);
    }
  }

  // While the Touch tab is showing, the bubble level follows the phone's tilt (and so do
  // dots on the tilt graphs).
  watchTilt() {
    const level = document.getElementById('tilt-level');
    const dot = level.querySelector('i');
    const status = document.getElementById('tilt-status');
    let last = '';
    const tick = () => {
      requestAnimationFrame(tick);
      const body = this.screens.settings.querySelector('[data-stab-body="touch"]');
      if (!this.isOpen || this.current !== 'settings' || body.hidden) return;
      const t = this.h.getTilt ? this.h.getTilt() : null;
      level.classList.toggle('off', !t);
      const key = t ? `${t.x.toFixed(3)},${t.z.toFixed(3)}` : 'none';
      if (key === last) return;
      last = key;
      if (!t) {
        status.textContent = 'No tilt yet: tap Recalibrate tilt (your phone may ask to use its motion sensors), then tilt it.';
        dot.style.transform = '';
        return;
      }
      status.textContent = 'Tilt your phone: the dot should follow it (right edge down moves it right, top edge away from you moves it up).';
      const R = 60; // px for a full tilt
      const cx = Math.max(-1.15, Math.min(1.15, t.x)) * R,
        cz = Math.max(-1.15, Math.min(1.15, t.z)) * R;
      dot.style.transform = `translate(${cx}px, ${-cz}px)`;
      this.tiltMarker = t;
      this.drawCurves();
    };
    requestAnimationFrame(tick);
  }

  setLean(lean, fromUser = false) {
    this.setCurves('lean', lean, fromUser);
  }

  drawCurves() {
    const font = getComputedStyle(document.body).fontFamily;
    for (const c of this.root.querySelectorAll('[data-curve-graph]')) {
      const w = c.clientWidth,
        h = c.clientHeight;
      if (!w || !h) continue;
      const [group, k] = c.dataset.curveGraph.split('.');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const axis = CURVE_SETS[group].axes[k];
      const marker = group === 'tilt' && this.tiltMarker ? this.tiltMarker[k] : null;
      drawLeanGraph(g, 0, 0, w, h, axis, this.settings[group][k], { font, out: axis === 'pad.look' ? this.settings.pad.lookSpeed : null, marker });
    }
  }

  // ---------------------------------------------------------------- the drone in VR
  bindDroneVR() {
    for (const b of this.root.querySelectorAll('[data-dronevr]')) b.addEventListener('click', () => this.setDroneVR(b.dataset.dronevr, true));
    this.setDroneVR(this.settings.droneVR);
  }

  setDroneVR(mode, fromUser = false) {
    this.settings.droneVR = mode === 'fpv' ? 'fpv' : 'camera';
    for (const b of this.root.querySelectorAll('[data-dronevr]')) {
      const on = b.dataset.dronevr === this.settings.droneVR;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const n of this.root.querySelectorAll('.dronevr-note'))
      n.textContent =
        this.settings.droneVR === 'fpv'
          ? 'FPV: flown like a racing drone in acro mode, in VR or with a controller. Left stick: throttle (the middle hovers) and yaw. Right stick: pitch and roll, as rates: the drone keeps its angle when you let go. The camera is fixed to the drone, tilted up, and in a headset ignores your head, like FPV goggles. That is intense in VR: stop if you feel unwell.'
          : 'Camera drone: it holds its height and stays level, and the camera stays level on its gimbal. In VR it follows your head. With keyboard and mouse or touch the drone is always the camera drone.';
    if (fromUser) {
      save('lineup.settings', this.settings);
      if (this.h.onSettings) this.h.onSettings(this.settings);
    }
  }

  // e.g. from the in-headset menu
  setVolume(v) {
    this._volumeInput.value = Math.round(v * 100);
    this._applySettings();
  }

  selectSettingsTab(tab) {
    this.endCapture();
    this.endPadCapture();
    for (const t of this.screens.settings.querySelectorAll('[data-stab]')) {
      t.classList.toggle('on', t.dataset.stab === tab);
      t.setAttribute('aria-selected', String(t.dataset.stab === tab));
    }
    for (const b of this.screens.settings.querySelectorAll('[data-stab-body]')) b.hidden = b.dataset.stabBody !== tab;
  }

  // ---------------------------------------------------------------- key bindings
  bindKeybinds() {
    this.capture = null; // { id, slot, btn } while waiting for a key
    const pcBody = document.querySelector('#binds-pc tbody');
    const questBody = document.querySelector('#binds-quest tbody');
    this.pcNote = document.getElementById('binds-pc-note');
    this.pcNoteDefault = this.pcNote.textContent;
    this.questNote = document.getElementById('binds-quest-note');
    this.padNote = document.getElementById('binds-pad-note');
    this.padNoteDefault = this.padNote.textContent;
    this.padCapture = null; // { id, slot, btn } while waiting for a controller button
    document.querySelector('#binds-pad tbody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-padbind]');
      if (b && !this.padCapture) this.startPadCapture(b);
    });
    document.getElementById('binds-pad-reset').addEventListener('click', () => {
      this.endPadCapture();
      controls.resetPad();
      this.padNote.textContent = 'Buttons reset to the defaults.';
    });

    pcBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bind]');
      if (!b || this.capture) return;
      this.startCapture(b);
    });
    // while capturing, the next key (or a mouse button on the cell) becomes the binding
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.padCapture) {
          // (binding a controller button: the keyboard can only cancel or clear)
          if (e.code === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.endPadCapture();
          } else if (e.code === 'Backspace' || e.code === 'Delete') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.finishPadCapture(-1);
          }
          return;
        }
        if (!this.capture) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code === 'Escape') return this.endCapture();
        if (e.code === 'Backspace' || e.code === 'Delete') return this.finishCapture('');
        if (RESERVED_KEYS.has(e.code)) {
          this.pcNote.textContent = `${keyLabel(e.code)} can't be used: Esc pauses the game, and F5, F11 and F12 belong to the browser.`;
          return;
        }
        this.finishCapture(e.code);
      },
      true,
    );
    window.addEventListener(
      'mousedown',
      (e) => {
        if (this.padCapture && e.target !== this.padCapture.btn) this.endPadCapture();
        if (!this.capture) return;
        if (e.target === this.capture.btn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.finishCapture(`Mouse${e.button}`);
        } else this.endCapture();
      },
      true,
    );
    window.addEventListener(
      'contextmenu',
      (e) => {
        if (e.target.closest && e.target.closest('#binds-pc')) e.preventDefault();
      },
      true,
    );
    document.getElementById('binds-pc-reset').addEventListener('click', () => {
      this.endCapture();
      controls.resetPC();
      this.pcNote.textContent = 'Keys reset to the defaults.';
    });

    questBody.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-quest]');
      if (!sel) return;
      const r = controls.setQuest(sel.dataset.quest, sel.value);
      if (r.refused) {
        this.questNote.textContent = r.refused;
        sel.value = controls.quest[sel.dataset.quest];
      } else this.questNote.textContent = moveText(r.moved);
    });
    document.getElementById('binds-quest-reset').addEventListener('click', () => {
      controls.resetQuest();
      this.questNote.textContent = 'Buttons reset to the defaults.';
    });

    controls.onChange(() => this.renderKeybinds());
    this.renderKeybinds();
  }

  renderKeybinds() {
    const cell = (id, slot) => {
      const code = controls.pc[id][slot];
      return `<button type="button" class="keycap${code ? '' : ' empty'}" data-bind="${id}" data-slot="${slot}">${code ? esc(keyLabel(code)) : 'Not set'}</button>`;
    };
    const fixed = (label, what) => `<tr class="fixed"><td>${label}</td><td colspan="2"><span class="keycap fixed">${what}</span></td></tr>`;
    document.querySelector('#binds-pc tbody').innerHTML =
      fixed('Paddle (faster = harder)', 'Scroll wheel') +
      fixed('Look around', 'Mouse') +
      PC_ACTIONS.map((a) => `<tr><td>${esc(a.label)}</td><td>${cell(a.id, 0)}</td><td>${cell(a.id, 1)}</td></tr>`).join('') +
      fixed('Pause menu', 'Esc');
    document.querySelector('#binds-quest tbody').innerHTML = QUEST_ACTIONS.map((a) => {
      const opts = QUEST_OPTIONS.filter((o) => !(a.required && o === 'none'))
        .map((o) => `<option value="${o}"${o === controls.quest[a.id] ? ' selected' : ''}>${esc(questLabel(o))}</option>`)
        .join('');
      return `<tr><td>${esc(a.label)}</td><td><select data-quest="${a.id}" aria-label="${esc(a.label)}">${opts}</select></td></tr>`;
    }).join('');
    if (!this.questNote.textContent) this.questNote.textContent = `You can change these in VR too: ${controls.questText('pause')} opens the pause menu.`;
    const pcell = (id, slot) => {
      const b = controls.pad[id][slot];
      return `<button type="button" class="keycap${b >= 0 ? '' : ' empty'}" data-padbind="${id}" data-slot="${slot}">${b >= 0 ? esc(padLabel(b)) : 'Not set'}</button>`;
    };
    document.querySelector('#binds-pad tbody').innerHTML =
      fixed('Steer, carve, lean, walk the longboard (pull back to sit up)', 'Left stick') +
      fixed('Look around (flick it, holding a trick button, for a snap)', 'Right stick') +
      PAD_ACTIONS.map((a) => `<tr><td>${esc(a.label)}</td><td>${pcell(a.id, 0)}</td><td>${pcell(a.id, 1)}</td></tr>`).join('');
  }

  startPadCapture(btn) {
    this.padCapture = { id: btn.dataset.padbind, slot: +btn.dataset.slot, btn };
    btn.classList.add('listening');
    btn.textContent = 'Press a button…';
    this.padNote.textContent = 'Press the controller button you want. Backspace clears it, Esc cancels.';
    if (this.h.onCapturePad) this.h.onCapturePad((i) => this.finishPadCapture(i));
  }

  finishPadCapture(i) {
    const { id, slot } = this.padCapture;
    this.padCapture = null;
    if (this.h.onCapturePad) this.h.onCapturePad(null);
    const r = controls.setPad(id, slot, i); // re-renders the table
    if (r && r.refused) {
      this.padNote.textContent = r.refused;
      this.renderKeybinds();
    } else this.padNote.textContent = r.length ? moveText(r) : this.padNoteDefault;
  }

  endPadCapture() {
    if (!this.padCapture) return;
    this.padCapture = null;
    if (this.h.onCapturePad) this.h.onCapturePad(null);
    this.renderKeybinds();
    this.padNote.textContent = this.padNoteDefault;
  }

  // which controller is connected (the Controller tab says)
  setPadStatus(name) {
    document.getElementById('pad-status').textContent = name ? `Connected: ${name}` : 'No controller found. Connect one and press any button on it.';
  }

  startCapture(btn) {
    this.capture = { id: btn.dataset.bind, slot: +btn.dataset.slot, btn };
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
    this.pcNote.textContent = 'Press a key, or click this box with the mouse button you want. Backspace clears it, Esc cancels.';
  }

  finishCapture(code) {
    const { id, slot } = this.capture;
    this.capture = null;
    const moved = controls.setPC(id, slot, code); // re-renders the table
    this.pcNote.textContent = moved.length ? moveText(moved) : this.pcNoteDefault;
  }

  endCapture() {
    if (!this.capture) return;
    this.capture = null;
    this.renderKeybinds();
    this.pcNote.textContent = this.pcNoteDefault;
  }

  // ---------------------------------------------------------------- VR availability
  setVR(supported, reason = '') {
    this.vrSupported = supported;
    for (const b of this.root.querySelectorAll('.vr-launch')) {
      b.disabled = !supported;
      b.classList.toggle('vr-off', !supported);
    }
    for (const n of this.root.querySelectorAll('.vr-note')) n.textContent = supported ? '' : reason;
    this.playLabels();
  }

  playLabels() {
    const fly = this.role === 'drone';
    const where = this.touchDevice ? '' : ' on PC';
    for (const b of this.root.querySelectorAll('[data-play="pc"]')) b.textContent = fly && b.closest('[data-screen="lobby"]') ? `Fly${where}` : `Play${where}`;
    for (const b of this.root.querySelectorAll('.vr-launch')) {
      b.textContent = !this.vrSupported ? 'VR: open on Meta Quest' : fly && b.closest('[data-screen="lobby"]') ? 'Fly in VR' : 'Play in VR';
    }
  }

  // ---------------------------------------------------------------- surfer or drone (multiplayer)
  bindRole() {
    this.screens.lobby.querySelector('.role-pick').addEventListener('click', (e) => {
      const o = e.target.closest('[data-role]');
      if (o) this.setRole(o.dataset.role, true);
    });
    controls.onChange(() => this.setRole(this.role));
    this.setRole(this.role);
  }

  setRole(role, fromUser = false) {
    this.role = role;
    for (const o of this.screens.lobby.querySelectorAll('[data-role]')) {
      o.classList.toggle('on', o.dataset.role === role);
      o.setAttribute('aria-checked', String(o.dataset.role === role));
    }
    const drone = role === 'drone';
    this.screens.lobby.querySelector('.lobby-boards').hidden = drone;
    this.screens.lobby.querySelector('.lobby-look').hidden = drone;
    if (this.current) this.syncPreview();
    const help = this.screens.lobby.querySelector('.drone-help');
    help.hidden = !drone;
    const k = (id) => controls.pcKey(id);
    help.innerHTML = `PC: <kbd>${esc(k('forward'))}</kbd><kbd>${esc(k('left'))}</kbd><kbd>${esc(k('back'))}</kbd><kbd>${esc(k('right'))}</kbd> fly · <kbd>${esc(k('popup'))}</kbd> up · <kbd>${esc(k('crouch'))}</kbd> down · mouse turns and tilts the camera · hold <kbd>${esc(k('charge'))}</kbd> for speed.<br>Quest: left stick climbs and turns, right stick flies, look around to aim the camera.`;
    this.playLabels();
    if (fromUser) {
      save('lineup.role', role);
      if (this.h.onRole) this.h.onRole(role);
    }
  }

  // ---------------------------------------------------------------- multiplayer
  bindMultiplayer() {
    for (const t of this.screens.multi.querySelectorAll('[data-tab]')) {
      t.addEventListener('click', () => this.selectTab(t.dataset.tab));
    }
    document.getElementById('room-search').addEventListener('input', () => {
      if (this.rooms) this.renderRooms(this.rooms);
    });
    for (const o of this.root.querySelectorAll('[data-privacy]')) {
      o.addEventListener('click', () => {
        this.privacy = o.dataset.privacy;
        for (const x of this.root.querySelectorAll('[data-privacy]')) {
          x.classList.toggle('on', x === o);
          x.setAttribute('aria-checked', String(x === o));
        }
        this.root.querySelector('.pass-field').hidden = this.privacy !== 'private';
      });
    }
    const roomName = document.getElementById('room-name');
    roomName.placeholder = `${this.name}'s lineup`;
    document.getElementById('create-room').addEventListener('click', () => {
      const status = document.getElementById('create-status');
      status.classList.remove('error');
      const name = roomName.value.trim() || `${this.name}'s lineup`;
      const pass = document.getElementById('room-pass').value;
      if (this.privacy === 'private' && pass.length < 3) {
        status.textContent = 'Private rooms need a passcode of at least 3 characters.';
        status.classList.add('error');
        return;
      }
      status.textContent = 'Creating room…';
      if (this.h.onCreateRoom) this.h.onCreateRoom({ roomName: name, isPrivate: this.privacy === 'private', passcode: pass, waves: this.waves, spot: this.spot, time: this.settings.time });
    });
    document.getElementById('room-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-join]');
      if (!b) return;
      const room = this.rooms && this.rooms.find((r) => r.id === b.dataset.join);
      if (!room) return;
      if (room.isPrivate) this.openPass(room);
      else if (this.h.onJoinRoom) this.h.onJoinRoom(room, '');
    });
  }

  selectTab(tab) {
    for (const t of this.screens.multi.querySelectorAll('[data-tab]')) {
      t.classList.toggle('on', t.dataset.tab === tab);
      t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    }
    for (const b of this.root.querySelectorAll('[data-tab-body]')) b.hidden = b.dataset.tabBody !== tab;
  }

  setNetStatus(text) {
    this.root.querySelector('.mp-net').textContent = text;
  }

  setCreateStatus(text, error = false) {
    const s = document.getElementById('create-status');
    s.textContent = text;
    s.classList.toggle('error', error);
  }

  renderRooms(rooms, error, maxPlayers = 8) {
    const list = document.getElementById('room-list');
    const status = document.getElementById('room-status');
    status.classList.toggle('error', !!error);
    if (error || !rooms) {
      // never leave rooms from an earlier visit clickable
      this.rooms = null;
      list.innerHTML = '';
      status.textContent = error || 'Looking for rooms…';
      return;
    }
    this.rooms = rooms;
    const q = document.getElementById('room-search').value.trim().toLowerCase();
    const shown = q ? rooms.filter((r) => r.name.toLowerCase().includes(q)) : rooms;
    list.innerHTML = shown
      .map((r) => {
        const full = r.count >= maxPlayers;
        const who = r.players.slice(0, 4).join(', ') + (r.players.length > 4 ? '…' : '');
        const where = `${SPOTS[cleanSpot(r.spot)].name} · ${TIME_NAMES[r.time] || TIME_NAMES.day}`;
        return `<li><span class="room-name"><b>${r.isPrivate ? '<span class="lock" title="Private">🔒</span>' : ''}${esc(r.name)}</b><small>${esc(where)} · ${esc(who)}</small></span><span class="room-count">${r.count}/${maxPlayers}</span><button type="button" class="btn" data-join="${esc(r.id)}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button></li>`;
      })
      .join('');
    status.textContent = rooms.length === 0 ? 'No rooms yet. Create one and invite your friends.' : shown.length === 0 ? `No rooms match “${q}”.` : '';
  }

  // You're in a room (or its spot or time of day just changed): its wave sizes and where it
  // surfs. The time of day is the room's, so it isn't on the pause screen.
  enterRoom(room) {
    this.inRoom = true;
    this.waveSpot = cleanSpot(room.spot);
    const S = SPOTS[this.waveSpot];
    const where = document.getElementById('lobby-where');
    where.hidden = false;
    where.innerHTML = `<img src="${spotImage(this.waveSpot)}" alt="" /><span><b>${esc(S.name)}</b><small>${esc(S.place)} · ${TIME_NAMES[room.time] || TIME_NAMES.day} · the same for everyone in the room</small></span>`;
    for (const el of this.root.querySelectorAll('.pause-tod')) el.hidden = true;
  }

  // room: {id, name, isPrivate, spot, time}, players: [{name, playing, me}]
  renderLobby(room, players) {
    this.inRoom = !!room;
    if (!room) return;
    document.getElementById('lobby-title').textContent = room.name;
    document.getElementById('lobby-meta').textContent = `${room.isPrivate ? 'Private room (passcode)' : 'Public room'} · ${players.length} player${players.length === 1 ? '' : 's'}`;
    document.getElementById('lobby-players').innerHTML = players
      .map((p) => `<li class="${p.playing ? 'playing' : ''} ${p.me ? 'me' : ''}"><i></i>${esc(p.name)}${p.me ? ' (you)' : ''}${p.role === 'drone' ? ' <small>drone</small>' : ''}</li>`)
      .join('');
    const pr = document.getElementById('pause-room');
    pr.hidden = false;
    pr.textContent = `${room.name} · ${SPOTS[cleanSpot(room.spot)].name} · ${players.length} player${players.length === 1 ? '' : 's'}`;
    this.root.querySelector('.pause-name').hidden = false;
    document.querySelector('[data-quit]').textContent = 'Leave room';
  }

  setLobbyStatus(text) {
    document.getElementById('lobby-status').textContent = text;
  }

  leftRoom() {
    this.inRoom = false;
    this.setLobbyStatus('');
    // back to your own spot and wave size
    this.waveSpot = this.spot;
    this.setWaves(load(wavesKey(this.spot), null));
    document.getElementById('lobby-where').hidden = true;
    for (const el of this.root.querySelectorAll('.pause-tod')) el.hidden = false;
    document.getElementById('pause-room').hidden = true;
    this.root.querySelector('.pause-name').hidden = true;
    document.querySelector('[data-quit]').textContent = 'Main menu';
  }

  // ---------------------------------------------------------------- passcode dialog
  bindPass() {
    document.getElementById('pass-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = document.getElementById('pass-input').value;
      if (this.passRoom && this.h.onJoinRoom) this.h.onJoinRoom(this.passRoom, pass);
    });
    document.getElementById('pass-cancel').addEventListener('click', () => this.closePass());
  }

  openPass(room) {
    this.passRoom = room;
    document.getElementById('pass-room').textContent = `“${room.name}” is private. Enter its passcode to join.`;
    document.getElementById('pass-error').textContent = '';
    const inp = document.getElementById('pass-input');
    inp.value = '';
    document.getElementById('pass-dialog').hidden = false;
    setTimeout(() => inp.focus(), 30);
  }

  passError(text) {
    document.getElementById('pass-error').textContent = text;
  }

  closePass() {
    document.getElementById('pass-dialog').hidden = true;
    this.passRoom = null;
  }
}
