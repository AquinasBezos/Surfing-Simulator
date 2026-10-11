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
import { getDatabase, ref, onValue, set, update, remove, onDisconnect, goOffline, goOnline } from 'firebase/database';
import { joinRoom, selfId } from '@trystero-p2p/firebase';
import { MULTIPLAYER as MP, WAVE } from './config.js';

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

const olderTimeline = (a, b) => a.created < b.created || (a.created === b.created && a.origin < b.origin);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

export class Net {
  constructor({ name, board }) {
    this.selfId = selfId;
    this.name = clean(name, 24) || 'Surfer';
    this.board = board;
    this.room = null;
    this.roomInfo = null;
    this.peers = new Map(); // peerId -> { name, board, origin, playing }
    this.playing = false;
    this.timeline = null; // { seed, origin, created }
    this.offset = 0; // shared clock = perfNow() + offset
    this.listeners = {};
    this._unwatch = null;
    this._online = true;
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

  async createRoom({ roomName, isPrivate, passcode }) {
    const id = randomId();
    const hash = isPrivate ? await hashPasscode(id, passcode) : '';
    await this.joinRoom({ id, name: roomName, isPrivate, passcode, hash, creating: true });
    return id;
  }

  async joinRoom({ id, name, isPrivate, passcode, hash, creating = false }) {
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
    this.timeline = { seed: crypto.getRandomValues(new Uint32Array(1))[0], origin: selfId, created: Date.now() };
    this.offset = PERIOD * 0.55 - perfNow();

    // presence in the room list (removed automatically if we vanish)
    this.presenceRef = ref(db, `${MP.roomsPath}/${id}/${selfId}`);
    await onDisconnect(this.presenceRef).remove();
    await set(this.presenceRef, { n: this.name, r: roomName, p: !!isPrivate, h: hash || '', t: Date.now() });

    const config = { appId: MP.databaseURL, relayConfig: { firebaseApp: app } };
    if (isPrivate) config.password = passcode;
    if (MP.turnServers.length) config.turnConfig = MP.turnServers;
    const room = joinRoom(config, `lineup-${id}`, {
      onJoinError: (e) => this.emit('joinError', e && e.error ? e.error : 'Could not connect to a player'),
    });
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
      if (!this.peers.has(peerId)) this.peers.set(peerId, { name: '…', board: 'shortboard', origin: null, playing: false });
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

  // ---------------------------------------------------------------- identity
  setName(name) {
    this.name = clean(name, 24) || 'Surfer';
    if (!this.room) return;
    update(this.presenceRef, { n: this.name }).catch(() => {});
    this.aHello.send(this._hello());
  }

  setBoard(board) {
    this.board = board;
    if (this.room) this.aHello.send(this._hello());
  }

  setPlaying(playing) {
    this.playing = playing;
    if (this.room) this.aHello.send(this._hello());
  }

  _hello() {
    return { v: MP.protocol, name: this.name, board: this.board, playing: this.playing, tl: this.timeline };
  }

  _onHello(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const before = this.peers.get(peerId);
    const p = before || { name: '…', board: 'shortboard', origin: null, playing: false };
    const firstHello = !before || before.name === '…';
    p.name = clean(msg.name, 24) || 'Surfer';
    p.board = msg.board === 'longboard' ? 'longboard' : 'shortboard';
    p.playing = !!msg.playing;
    p.origin = msg.tl && msg.tl.origin;
    p.version = msg.v;
    this.peers.set(peerId, p);
    if (firstHello) this.emit('join', peerId, p.name);
    this.emit('info', peerId, p);
    this.emit('peers');
    if (msg.v !== MP.protocol) this.emit('warn', `${p.name} is on a different version of the game`);
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
