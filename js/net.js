// Multiplayer networking (loaded on demand when the player opens Multiplayer).
//
// Matchmaking uses a Firebase Realtime Database, written so it costs almost nothing:
//   lineup/rooms/<roomId>/<peerId> = { n: name, r: room name, p: private, h: passcode hash, t: joined }
// Each player only writes their own small presence entry, with onDisconnect().remove().
// A room is nothing more than its players' entries, so when the last player leaves
// (or their connection drops) the whole room disappears from the database: no cleanup
// job, no orphaned rooms, near-zero storage. Trystero's WebRTC signaling also lives in
// the database only while peers are connecting and removes itself on disconnect.
//
// Gameplay data never touches Firebase: poses, events and clock sync go peer-to-peer.
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, onValue, set, update, remove, onDisconnect, goOffline, goOnline } from 'firebase/database';
import { joinRoom, selfId } from '@trystero-p2p/firebase';
import { MULTIPLAYER as MP, WAVE, WAVE_HEIGHTS } from './config.js';

const app = initializeApp({ databaseURL: MP.databaseURL }, 'lineup');
const db = getDatabase(app);
const perfNow = () => performance.now() / 1000;
const PERIOD = WAVE.spacing / WAVE.speed;

export const POSE_FLOATS = 14;

const randomId = () => {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};

export async function hashPasscode(roomId, passcode) {
  const data = new TextEncoder().encode(`lineup:${roomId}:${passcode}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ?relay sends everything through the TURN relay: a way to check the relay works.
const RELAY_ONLY = new URLSearchParams(location.search).has('relay');

// TURN servers for players whose networks block direct connections: the static list
// plus whatever MP.turnCredentialsURL hands out (fetched once, reused for half an hour).
let fetchedRelays = null; // { servers, expires }
let fetchingRelays = null;
async function relayServers() {
  const servers = [...MP.turnServers];
  if (!MP.turnCredentialsURL) return servers;
  if (!fetchedRelays || fetchedRelays.expires < Date.now()) {
    fetchingRelays ||= (async () => {
      try {
        const res = await fetch(MP.turnCredentialsURL, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let list = Array.isArray(data) ? data : data && data.iceServers;
        if (list && !Array.isArray(list)) list = [list];
        fetchedRelays = { servers: (list || []).filter((s) => s && s.urls), expires: Date.now() + 30 * 60 * 1000 };
      } catch (e) {
        console.warn('LINEUP: could not get TURN relay credentials', e);
        fetchedRelays = { servers: [], expires: Date.now() + 60 * 1000 };
      } finally {
        fetchingRelays = null;
      }
    })();
    await fetchingRelays;
  }
  return servers.concat(fetchedRelays.servers);
}

// A room's wave size: { mode: 'set' | 'random', height, fromK, prev, rev }. A change takes
// effect from wave fromK (the next one to appear) so the waves already rolling in stay as
// they are for everyone; rev orders changes.
function cleanWaves(w) {
  const one = (x) => ({ mode: x && x.mode === 'random' ? 'random' : 'set', height: Math.min(WAVE_HEIGHTS.max, Math.max(WAVE_HEIGHTS.min, Number(x && x.height) || WAVE_HEIGHTS.default)) });
  if (!w || typeof w !== 'object') return { ...one(null), fromK: null, prev: null, rev: 0 };
  return { ...one(w), fromK: Number.isInteger(w.fromK) ? w.fromK : null, prev: w.prev ? one(w.prev) : null, rev: Number.isInteger(w.rev) ? w.rev : 0 };
}

// someone's colours: only well-formed #rrggbb values get through
const HEX = /^#[0-9a-f]{6}$/i;
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const out = {};
  for (const k of ['skin', 'hair', 'board']) if (typeof l[k] === 'string' && HEX.test(l[k])) out[k] = l[k];
  return out;
}

const olderTimeline = (a, b) => a.created < b.created || (a.created === b.created && a.origin < b.origin);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

export class Net {
  constructor({ name, board, role = 'surfer', look = null }) {
    this.selfId = selfId;
    this.name = clean(name, 24) || 'Surfer';
    this.board = board;
    this.role = role; // 'surfer' or 'drone'
    this.look = look; // { skin, hair, board } colours
    this.room = null;
    this.roomInfo = null;
    this.peers = new Map(); // peerId -> { name, board, role, origin, playing }
    this.playing = false;
    this.timeline = null; // { seed, origin, created }
    this.offset = 0; // shared clock = perfNow() + offset
    this.listeners = {};
    this._unwatch = null;
    this._online = true;
    this.hasRelay = false; // a TURN relay was configured for the current room
    relayServers(); // warm up: fetch relay credentials while the player browses rooms
  }

  on(event, fn) {
    (this.listeners[event] ||= []).push(fn);
    return () => (this.listeners[event] = this.listeners[event].filter((f) => f !== fn));
  }

  emit(event, ...args) {
    for (const fn of this.listeners[event] || []) fn(...args);
  }

  // Shared room clock in seconds (drives the wave schedule).
  now() {
    return perfNow() + this.offset;
  }

  get seed() {
    return this.timeline ? this.timeline.seed : 0;
  }

  online() {
    if (!this._online) {
      goOnline(db);
      this._online = true;
    }
  }

  // Drop the database connection when we don't need it (frees one of the free plan's
  // 100 simultaneous connections).
  offline() {
    if (this.room || this._unwatch) return;
    if (this._online) {
      goOffline(db);
      this._online = false;
    }
  }

  // ---------------------------------------------------------------- lobby
  watchRooms(cb) {
    this.stopWatching();
    this.online();
    this._unwatch = onValue(
      ref(db, MP.roomsPath),
      (snap) => {
        const val = snap.val() || {};
        const rooms = [];
        for (const [id, players] of Object.entries(val)) {
          const list = Object.values(players || {}).filter((v) => v && typeof v === 'object' && v.r);
          if (!list.length) continue;
          list.sort((a, b) => (a.t || 0) - (b.t || 0));
          const first = list[0];
          rooms.push({ id, name: first.r, isPrivate: !!first.p, hash: first.h || '', count: list.length, players: list.map((p) => p.n), created: first.t || 0 });
        }
        rooms.sort((a, b) => b.count - a.count || a.created - b.created);
        cb(rooms, null);
      },
      (err) => cb(null, err),
    );
  }

  stopWatching() {
    if (this._unwatch) {
      this._unwatch();
      this._unwatch = null;
    }
  }

  async createRoom({ roomName, isPrivate, passcode, waves }) {
    const id = randomId();
    const hash = isPrivate ? await hashPasscode(id, passcode) : '';
    await this.joinRoom({ id, name: roomName, isPrivate, passcode, hash, waves, creating: true });
    return id;
  }

  async joinRoom({ id, name, isPrivate, passcode, hash, waves = null, creating = false }) {
    if (this.room) await this.leave();
    if (isPrivate) {
      if (!passcode) throw new Error('This room needs a passcode');
      const h = await hashPasscode(id, passcode);
      if (hash && h !== hash) throw new Error('Wrong passcode');
    }
    this.online();
    this.stopWatching();
    const roomName = clean(name, 40) || 'Lineup';
    this.roomInfo = { id, name: roomName, isPrivate: !!isPrivate, hash: hash || '' };
    this.peers.clear();
    // a fresh timeline; replaced by the room's oldest one as soon as we meet a peer
    this.timeline = { seed: crypto.getRandomValues(new Uint32Array(1))[0], origin: selfId, created: Date.now(), waves: cleanWaves(waves) };
    this.offset = PERIOD * 0.55 - perfNow();

    const relays = relayServers();
    // presence in the room list (removed automatically if we vanish)
    this.presenceRef = ref(db, `${MP.roomsPath}/${id}/${selfId}`);
    await onDisconnect(this.presenceRef).remove();
    await set(this.presenceRef, { n: this.name, r: roomName, p: !!isPrivate, h: hash || '', t: Date.now() });

    const turn = await relays;
    this.hasRelay = turn.length > 0;
    const config = { appId: MP.databaseURL, relayConfig: { firebaseApp: app } };
    if (isPrivate) config.password = passcode;
    if (turn.length) config.turnConfig = turn;
    if (RELAY_ONLY) config.rtcConfig = { iceTransportPolicy: 'relay' };
    const room = joinRoom(config, `lineup-${id}`, { onJoinError: (e) => this._joinError(e || {}) });
    this.room = room;

    this.aHello = room.makeAction('hello');
    this.aPose = room.makeAction('pose');
    this.aEvt = room.makeAction('evt');
    this.aSync = room.makeAction('sync', { kind: 'request', onRequest: () => ({ now: this.now(), tl: this.timeline }) });

    this.aHello.onMessage = (msg, { peerId }) => this._onHello(peerId, msg);
    this.aPose.onMessage = (data, { peerId }) => {
      const p = this.peers.get(peerId);
      if (!p || !this.timeline || p.origin !== this.timeline.origin) return; // not on our clock yet
      const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const f = new Float32Array(buf);
      if (f.length < POSE_FLOATS) return;
      this.emit('pose', peerId, f);
    };
    this.aEvt.onMessage = (msg, { peerId }) => {
      if (msg && typeof msg === 'object') this.emit('event', peerId, msg);
    };
    room.onPeerJoin = (peerId) => {
      if (!this.peers.has(peerId)) this.peers.set(peerId, { name: '…', board: 'shortboard', role: 'surfer', origin: null, playing: false });
      this.aHello.send(this._hello(), { target: peerId });
      this.emit('peers');
    };
    room.onPeerLeave = (peerId) => {
      const p = this.peers.get(peerId);
      this.peers.delete(peerId);
      this.emit('leave', peerId, p ? p.name : 'A surfer');
      this.emit('peers');
    };
    this._resync = setInterval(() => this._refreshClock(), 30000);
    this.emit('joined', this.roomInfo, creating);
    this.emit('timeline');
  }

  async leave() {
    clearInterval(this._resync);
    const room = this.room;
    if (!room) return;
    // reset straight away so the game can move on (or join another room) while the
    // network catches up
    const presence = this.presenceRef;
    this.room = null;
    this.presenceRef = null;
    this.peers.clear();
    this.roomInfo = null;
    this.timeline = null;
    this.emit('left');
    this.emit('peers');
    // tell the peers (they drop our surfer at once) and take our entry off the room list.
    // The onDisconnect remove stays registered: harmless, and a safety net if this write is lost.
    await Promise.allSettled([Promise.resolve().then(() => room.leave()), remove(presence)]);
  }

  // Trystero couldn't connect to someone. Work out who it was (their room-list entry is
  // keyed by the same peer id) and why, for a message players can understand.
  async _joinError({ error = '', peerId }) {
    const roomId = this.roomInfo && this.roomInfo.id;
    let name = peerId && this.peers.has(peerId) ? this.peers.get(peerId).name : null;
    if ((!name || name === '…') && peerId && roomId) {
      try {
        name = (await get(ref(db, `${MP.roomsPath}/${roomId}/${peerId}/n`))).val();
      } catch (e) {
        name = null;
      }
    }
    if (!this.room || !this.roomInfo || this.roomInfo.id !== roomId) return; // we've left since
    const reason = /password/i.test(error) ? 'passcode' : /exchanging SDP/i.test(error) ? 'blocked' : 'other';
    this.emit('joinError', { peerId, name: clean(name, 24) || 'another surfer', reason, error });
  }

  // ---------------------------------------------------------------- identity
  setName(name) {
    this.name = clean(name, 24) || 'Surfer';
    if (!this.room) return;
    update(this.presenceRef, { n: this.name }).catch(() => {});
    this.aHello.send(this._hello());
  }

  setLook(look) {
    this.look = look;
    if (this.room) this.aHello.send(this._hello());
  }

  setRole(role) {
    this.role = role;
    if (this.room) this.aHello.send(this._hello());
  }

  setBoard(board) {
    this.board = board;
    if (this.room) this.aHello.send(this._hello());
  }

  setPlaying(playing) {
    this.playing = playing;
    if (this.room) this.aHello.send(this._hello());
  }

  // Change the room's wave size (anyone in the room can). Applies from the next wave.
  setWaves(cfg) {
    if (!this.room || !this.timeline) return;
    const cur = cleanWaves(this.timeline.waves);
    const kNext = Math.floor(this.now() / PERIOD) + 1;
    const active = cur.prev && cur.fromK != null && kNext - 1 < cur.fromK ? cur.prev : cur;
    const waves = cleanWaves({ ...cfg, fromK: kNext, prev: active, rev: cur.rev + 1 });
    this.timeline = { ...this.timeline, waves };
    this.aHello.send(this._hello());
    this.emit('waves', waves, null);
  }

  get waves() {
    return cleanWaves(this.timeline && this.timeline.waves);
  }

  _hello() {
    return { v: MP.protocol, name: this.name, board: this.board, role: this.role, look: this.look, playing: this.playing, tl: this.timeline };
  }

  _onHello(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const before = this.peers.get(peerId);
    const p = before || { name: '…', board: 'shortboard', role: 'surfer', origin: null, playing: false };
    const firstHello = !before || before.name === '…';
    p.name = clean(msg.name, 24) || 'Surfer';
    p.board = msg.board === 'longboard' ? 'longboard' : 'shortboard';
    p.role = msg.role === 'drone' ? 'drone' : 'surfer';
    p.look = cleanLook(msg.look);
    p.playing = !!msg.playing;
    p.origin = msg.tl && msg.tl.origin;
    p.version = msg.v;
    this.peers.set(peerId, p);
    if (firstHello) this.emit('join', peerId, p.name);
    this.emit('info', peerId, p);
    this.emit('peers');
    if (msg.v !== MP.protocol) this.emit('warn', `${p.name} is on a different version of the game`);
    // someone changed the room's waves (same timeline, newer revision)
    if (msg.tl && this.timeline && msg.tl.origin === this.timeline.origin && msg.tl.seed === this.timeline.seed) {
      const theirs = cleanWaves(msg.tl.waves);
      if (theirs.rev > cleanWaves(this.timeline.waves).rev) {
        this.timeline = { ...this.timeline, waves: theirs };
        this.emit('waves', theirs, p.name);
      }
    }
    if (msg.tl && this.timeline && olderTimeline(msg.tl, this.timeline)) this._adopt(peerId);
  }

  // Take on a peer's (older) timeline: measure the clock offset with a few round trips
  // and keep the fastest one.
  async _adopt(peerId) {
    if (this._adopting) return;
    this._adopting = true;
    try {
      let best = null;
      for (let i = 0; i < 5; i++) {
        const t0 = perfNow();
        const res = await this.aSync.request({ k: 'time' }, { target: peerId, timeoutMs: 2500 });
        const t1 = perfNow();
        const rtt = t1 - t0;
        if (res && res.tl && (!best || rtt < best.rtt)) best = { rtt, offset: res.now + rtt / 2 - t1, tl: res.tl };
      }
      if (!best || !this.room) return;
      const changed = !this.timeline || best.tl.origin !== this.timeline.origin || best.tl.seed !== this.timeline.seed;
      this.timeline = best.tl;
      this.offset = best.offset;
      this.aHello.send(this._hello());
      if (changed) this.emit('timeline');
    } catch (e) {
      /* peer left mid-sync; the next hello retries */
    } finally {
      this._adopting = false;
    }
  }

  // Keep the clock tight against whoever owns the timeline.
  async _refreshClock() {
    if (!this.room || !this.timeline || this.timeline.origin === selfId) return;
    const owner = this.peers.has(this.timeline.origin) ? this.timeline.origin : [...this.peers.keys()].find((id) => this.peers.get(id).origin === this.timeline.origin);
    if (!owner) return;
    try {
      let best = null;
      for (let i = 0; i < 3; i++) {
        const t0 = perfNow();
        const res = await this.aSync.request({ k: 'time' }, { target: owner, timeoutMs: 2500 });
        const t1 = perfNow();
        if (res && res.tl && res.tl.origin === this.timeline.origin && (!best || t1 - t0 < best.rtt)) best = { rtt: t1 - t0, offset: res.now + (t1 - t0) / 2 - t1 };
      }
      if (best && Math.abs(best.offset - this.offset) < 1) this.offset += (best.offset - this.offset) * 0.5;
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- gameplay
  sendPose(floats) {
    if (this.room && this.peers.size) this.aPose.send(floats);
  }

  sendEvent(evt) {
    if (this.room && this.peers.size) this.aEvt.send(evt);
  }
}
