// LINEUP menus: main mode cards, singleplayer / multiplayer / settings sub-screens, the
// multiplayer room browser and lobby, and the in-game pause screen. Pure DOM; the game
// is driven through the handler callbacks passed to the constructor.

const BOARD_SVG = {
  shortboard:
    '<svg viewBox="0 0 44 92" aria-hidden="true"><path d="M22 3c8 12 13 30 13 52 0 15-3 26-6 33H15c-3-7-6-18-6-33C9 33 14 15 22 3z" fill="#f4f3ee" stroke="#9fb2bd" stroke-width="1.2"/><path d="M22 6v80" stroke="#2b2b2b" stroke-width="1"/></svg>',
  longboard:
    '<svg viewBox="0 0 44 92" aria-hidden="true"><path d="M22 2c10 1 15 14 15 40 0 26-3 40-6 47H13c-3-7-6-21-6-47C7 16 12 3 22 2z" fill="#f2ecdd" stroke="#9fb2bd" stroke-width="1.2"/><path d="M8.5 30c0 20 1 40 5 56M35.5 30c0 20-1 40-5 56" stroke="#c0492b" stroke-width="1" fill="none"/><path d="M22 4v84" stroke="#2b2b2b" stroke-width="1"/></svg>',
};
const BOARD_INFO = {
  shortboard: ['Shortboard', '6\'1" · snaps, tailslides, barrels'],
  longboard: ['Longboard', '9\'2" · glides, walk to the nose'],
};
const CRUMBS = { main: '', single: 'Singleplayer', multi: 'Multiplayer', lobby: 'Multiplayer', settings: 'Controls and settings', pause: '' };

const DEFAULT_SETTINGS = { quality: 'auto', volume: 0.8, sensitivity: 1, invertY: false, fullscreen: true };

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

    this.buildBoardPickers();
    this.bindMain();
    this.bindNav();
    this.bindNames();
    this.bindSettings();
    this.bindMultiplayer();
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
    if (this.current && this.current !== name && push) this.stack.push(this.current);
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('on', k === name);
    this.current = name;
    this.crumb.textContent = CRUMBS[name] || '';
    this.root.classList.remove('hidden');
    if (name === 'main') {
      this.stack = [];
      this.highlight(this.root.querySelector('.mode-card.active') || this.root.querySelector('.mode-card'));
    }
    if (name === 'multi' && this.h.onOpenMulti) this.h.onOpenMulti();
    if (name === 'pause') this.stack = [];
    const focusable = this.screens[name].querySelector('.mode-card.active, [data-resume], .btn.primary, input');
    if (focusable && name !== 'multi') setTimeout(() => focusable.focus({ preventScroll: true }), 30);
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
    if (this.current === 'main' && (tag !== 'INPUT')) {
      const cards = [...this.root.querySelectorAll('.mode-card')];
      const i = cards.findIndex((c) => c.classList.contains('active'));
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlight(cards[(i + 1) % cards.length], true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlight(cards[(i + cards.length - 1) % cards.length], true);
      }
    }
  }

  highlight(card, focus = false) {
    if (!card) return;
    for (const c of this.root.querySelectorAll('.mode-card')) c.classList.toggle('active', c === card);
    if (focus) card.focus({ preventScroll: true });
  }

  bindMain() {
    for (const card of this.root.querySelectorAll('.mode-card')) {
      card.addEventListener('mouseenter', () => this.highlight(card));
      card.addEventListener('focus', () => this.highlight(card));
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

  setBoard(type, fromUser = false) {
    this.board = type;
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
  }

  // ---------------------------------------------------------------- VR availability
  setVR(supported, reason = '') {
    for (const b of this.root.querySelectorAll('.vr-launch')) {
      b.disabled = !supported;
      b.classList.toggle('vr-off', !supported);
      b.textContent = supported ? 'Play in VR' : 'VR: open on Meta Quest';
    }
    for (const n of this.root.querySelectorAll('.vr-note')) n.textContent = supported ? '' : reason;
  }

  // ---------------------------------------------------------------- multiplayer
  bindMultiplayer() {
    for (const t of this.root.querySelectorAll('.tab')) {
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
      if (this.h.onCreateRoom) this.h.onCreateRoom({ roomName: name, isPrivate: this.privacy === 'private', passcode: pass });
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
    for (const t of this.root.querySelectorAll('.tab')) {
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
        return `<li><span class="room-name"><b>${r.isPrivate ? '<span class="lock" title="Private">🔒</span>' : ''}${esc(r.name)}</b><small>${esc(who)}</small></span><span class="room-count">${r.count}/${maxPlayers}</span><button type="button" class="btn" data-join="${esc(r.id)}" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button></li>`;
      })
      .join('');
    status.textContent = rooms.length === 0 ? 'No rooms yet. Create one and invite your friends.' : shown.length === 0 ? `No rooms match “${q}”.` : '';
  }

  // room: {id, name, isPrivate}, players: [{name, playing, me}]
  renderLobby(room, players) {
    this.inRoom = !!room;
    if (!room) return;
    document.getElementById('lobby-title').textContent = room.name;
    document.getElementById('lobby-meta').textContent = `${room.isPrivate ? 'Private room (passcode)' : 'Public room'} · ${players.length} surfer${players.length === 1 ? '' : 's'}`;
    document.getElementById('lobby-players').innerHTML = players.map((p) => `<li class="${p.playing ? 'playing' : ''} ${p.me ? 'me' : ''}"><i></i>${esc(p.name)}${p.me ? ' (you)' : ''}</li>`).join('');
    const pr = document.getElementById('pause-room');
    pr.hidden = false;
    pr.textContent = `${room.name} · ${players.length} surfer${players.length === 1 ? '' : 's'}`;
    this.root.querySelector('.pause-name').hidden = false;
    document.querySelector('[data-quit]').textContent = 'Leave room';
  }

  leftRoom() {
    this.inRoom = false;
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
