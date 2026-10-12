// LINEUP menus: main mode cards, singleplayer / multiplayer / settings sub-screens, the
// multiplayer room browser and lobby, and the in-game pause screen. Pure DOM; the game
// is driven through the handler callbacks passed to the constructor.
import { controls, PC_ACTIONS, QUEST_ACTIONS, QUEST_OPTIONS, RESERVED_KEYS, keyLabel, questLabel } from './bindings.js';
import { SPOTS, SPOT_IDS, cleanSpot } from './spots.js';
import { SKIN_TONES, HAIR_COLORS, BOARD_COLORS, cleanLook, randomLook } from './character.js';
import { CharacterPreview } from './preview.js';

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

const DEFAULT_SETTINGS = { quality: 'auto', volume: 0.8, sensitivity: 1, invertY: false, fullscreen: true, time: 'day' };

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
    // (no card is focused on the main screen: only the hovered one is outlined)
    const focusable = this.screens[name].querySelector('[data-resume], .btn.primary, input');
    if (focusable && name !== 'multi' && name !== 'main') setTimeout(() => focusable.focus({ preventScroll: true }), 30);
    else if (name === 'main' && document.activeElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.syncPreview();
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
      // arrow keys move the focus (and its blue outline) between the cards
      const cards = [...this.root.querySelectorAll('.mode-card')];
      const i = cards.indexOf(document.activeElement);
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % cards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i < 0 ? cards.length - 1 : (i + cards.length - 1) % cards.length;
      if (next >= 0) {
        e.preventDefault();
        cards[next].focus({ preventScroll: true });
      }
    }
  }

  bindMain() {
    // only one outlined card at a time: the mouse takes over from the keyboard focus
    for (const card of this.root.querySelectorAll('.mode-card')) {
      card.addEventListener('mouseenter', () => {
        const f = document.activeElement;
        if (f && f !== card && f.classList.contains('mode-card')) f.blur();
      });
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
  }

  // e.g. from the in-headset menu
  setVolume(v) {
    this._volumeInput.value = Math.round(v * 100);
    this._applySettings();
  }

  selectSettingsTab(tab) {
    this.endCapture();
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

    pcBody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-bind]');
      if (!b || this.capture) return;
      this.startCapture(b);
    });
    // while capturing, the next key (or a mouse button on the cell) becomes the binding
    window.addEventListener(
      'keydown',
      (e) => {
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
    for (const b of this.root.querySelectorAll('[data-play="pc"]')) b.textContent = fly && b.closest('[data-screen="lobby"]') ? 'Fly on PC' : 'Play on PC';
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
