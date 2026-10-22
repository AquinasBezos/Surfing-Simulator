// Multiplayer networking (loaded on demand when the player opens Multiplayer).
//
// Matchmaking uses a Firebase Realtime Database, written so it costs almost nothing:
//   lineup/rooms/<roomId>/<peerId> = { n: name, r: room name, p: private, h: passcode hash, t: joined,
//                                      l: surf spot, d: time of day }
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
import { MULTIPLAYER as MP, WAVE } from './config.js';
import { SPOTS, cleanSpot } from './spots.js';

const app = initializeApp({ databaseURL: MP.databaseURL }, 'lineup');
const db = getDatabase(app);
const perfNow = () => performance.now() / 1000;
const period = () => WAVE.spacing / WAVE.speed; // (the spot's: a pool sends waves more often)

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

// TURN servers for players whose networks block direct connections: the fixed list, the
// relay login kept in the database at MP.turnPath (not in the code: see config.js), and
// whatever MP.turnCredentialsURL hands out. Fetched when you join a room (alongside the
// rest of joining: it takes about 0.1 s) and reused for half an hour; a failed fetch is
// tried again next time. Only call it with the database online: a read started offline
// waits until it's back.
let fetchedRelays = null; // { servers, expires }
let fetchingRelays = null;
const timeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]);
async function relaysFromDatabase() {
  if (!MP.turnPath) return [];
  const v = (await timeout(get(ref(db, MP.turnPath)), 6000)).val();
  if (!v) return [];
  // "username:password", or { username, credential }
  let username, credential;
  if (typeof v === 'string') {
    const i = v.indexOf(':');
    if (i < 1) return [];
    username = v.slice(0, i).trim();
    credential = v.slice(i + 1).trim();
  } else ({ username, credential } = v);
  if (!username || !credential) return [];
  return [{ urls: MP.turnStun }, ...MP.turnHosts.map((urls) => ({ urls, username: String(username), credential: String(credential) }))];
}
async function relaysFromURL() {
  if (!MP.turnCredentialsURL) return [];
  const res = await fetch(MP.turnCredentialsURL, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  let list = Array.isArray(data) ? data : data && data.iceServers;
  if (list && !Array.isArray(list)) list = [list];
  return (list || []).filter((s) => s && s.urls);
}
async function relayServers() {
  const servers = [...MP.turnServers];
  if (!fetchedRelays || fetchedRelays.expires < Date.now()) {
    fetchingRelays ||= (async () => {
      const got = await Promise.allSettled([relaysFromDatabase(), relaysFromURL()]);
      for (const r of got) if (r.status === 'rejected') console.warn('LINEUP: could not get the TURN relay login', r.reason);
      const list = got.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      // (only a login that was found is kept: with none, the next room you join looks again)
      fetchedRelays = list.length ? { servers: list, expires: Date.now() + 30 * 60 * 1000 } : null;
      fetchingRelays = null;
      return list;
    })();
    return servers.concat(await fetchingRelays);
  }
  return servers.concat(fetchedRelays.servers);
}

// A room's wave size: { mode: 'set' | 'random', height, fromK, prev, rev }. A change takes
// effect from wave fromK (the next one to appear) so the waves already rolling in stay as
// they are for everyone; rev orders changes. Heights are kept to the room's spot's range.
function cleanWaves(w, spot) {
  const R = SPOTS[cleanSpot(spot)].heights;
  const one = (x) => ({ mode: x && x.mode === 'random' ? 'random' : 'set', height: Math.min(R.max, Math.max(R.min, Number(x && x.height) || R.default)) });
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

const cleanTime = (t) => (t === 'sunset' ? 'sunset' : 'day');

// A room's collisions (bumping into each other: experimental), { on, rev }: rev orders changes,
// as for the waves
const cleanCollide = (c) => ({ on: !!(c && c.on === true), rev: c && Number.isInteger(c.rev) ? c.rev : 0 });

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
    this.peers = new Map(); // peerId -> { name, board, role, origin, playing, joined, tl }
    this.playing = false;
    this.joinedAt = 0; // when we joined the room (Date.now()): the longest there leads it
    this.timeline = null; // { seed, origin, created }
    this.offset = 0; // shared clock = perfNow() + offset
    this.listeners = {};
    this._unwatch = null;
    this._online = true;
    this.hasRelay = false; // a TURN relay was configured for the current room
    this.relayed = new Set(); // peers we only reach through it (its data is metered)
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
          rooms.push({ id, name: first.r, isPrivate: !!first.p, hash: first.h || '', count: list.length, players: list.map((p) => p.n), created: first.t || 0, spot: cleanSpot(first.l), time: cleanTime(first.d) });
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

  // spot, time: where the room surfs and at what time of day (the same for everyone)
  async createRoom({ roomName, isPrivate, passcode, waves, spot, time }) {
    const id = randomId();
    const hash = isPrivate ? await hashPasscode(id, passcode) : '';
    await this.joinRoom({ id, name: roomName, isPrivate, passcode, hash, waves, spot, time, creating: true });
    return id;
  }

  async joinRoom({ id, name, isPrivate, passcode, hash, waves = null, spot, time, creating = false }) {
    if (this.room) await this.leave();
    if (isPrivate) {
      if (!passcode) throw new Error('This room needs a passcode');
      const h = await hashPasscode(id, passcode);
      if (hash && h !== hash) throw new Error('Wrong passcode');
    }
    this.online();
    this.stopWatching();
    const roomName = clean(name, 40) || 'Lineup';
    spot = cleanSpot(spot);
    time = cleanTime(time);
    this.roomInfo = { id, name: roomName, isPrivate: !!isPrivate, hash: hash || '', spot, time };
    this.peers.clear();
    this.joinedAt = Date.now();
    // a fresh timeline; replaced by the room's oldest one as soon as we meet a peer
    this.timeline = { seed: crypto.getRandomValues(new Uint32Array(1))[0], origin: selfId, created: Date.now(), waves: cleanWaves(waves, spot), spot, time, collide: cleanCollide(null) };
    this.offset = period() * 0.55 - perfNow();

    const relays = relayServers();
    // presence in the room list (removed automatically if we vanish)
    this.presenceRef = ref(db, `${MP.roomsPath}/${id}/${selfId}`);
    await onDisconnect(this.presenceRef).remove();
    await this._writePresence();

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
      if (!data || typeof data.byteLength !== 'number') return;
      const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      this.emit('pose', peerId, buf); // (main.js decodes it: packed, or older clients' floats)
    };
    this.aEvt.onMessage = (msg, { peerId }) => {
      if (msg && typeof msg === 'object') this.emit('event', peerId, msg);
    };
    room.onPeerJoin = (peerId) => {
      if (!this.peers.has(peerId)) this.peers.set(peerId, { name: '…', board: 'shortboard', role: 'surfer', origin: null, playing: false, joined: null, tl: null });
      this.aHello.send(this._hello(), { target: peerId });
      this.emit('peers');
      setTimeout(() => this._checkRoutes(), 2500); // (direct, or through the relay?)
    };
    room.onPeerLeave = (peerId) => {
      const p = this.peers.get(peerId);
      this.peers.delete(peerId);
      this.relayed.delete(peerId);
      this.emit('leave', peerId, p ? p.name : 'A surfer');
      this.emit('peers');
    };
    this._resync = setInterval(() => this._refreshClock(), 30000);
    this._routes = setInterval(() => this._checkRoutes(), 5000);
    this.emit('joined', this.roomInfo, creating);
    this.emit('timeline');
  }

  // Our entry in the room list. Databases still on the original rules only accept the
  // first five fields: then the spot and time of day travel with the timeline alone.
  async _writePresence() {
    const r = this.roomInfo;
    const entry = { n: this.name, r: r.name, p: r.isPrivate, h: r.hash, t: Date.now() };
    if (!this.oldRules) {
      try {
        return await set(this.presenceRef, { ...entry, l: r.spot, d: r.time });
      } catch (e) {
        this.oldRules = true;
        console.warn('LINEUP: the database rules are out of date (see database.rules.json); rooms will list as Margaret River at midday', e);
      }
    }
    return set(this.presenceRef, entry);
  }

  async leave() {
    clearInterval(this._resync);
    clearInterval(this._routes);
    this.relayed.clear();
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
    const cur = cleanWaves(this.timeline.waves, this.spot);
    const kNext = Math.floor(this.now() / period()) + 1;
    const active = cur.prev && cur.fromK != null && kNext - 1 < cur.fromK ? cur.prev : cur;
    const waves = cleanWaves({ ...cfg, fromK: kNext, prev: active, rev: cur.rev + 1 }, this.spot);
    this.timeline = { ...this.timeline, waves };
    this.aHello.send(this._hello());
    this.emit('waves', waves, null);
  }

  get waves() {
    return cleanWaves(this.timeline && this.timeline.waves, this.spot);
  }

  // The room's leader, who can turn its experimental modes on: whoever started the room's
  // timeline (the room's creator) while they're in it, then whoever has been in it longest.
  // Everyone works it out from the same numbers, so everyone agrees.
  get leaderId() {
    if (!this.room || !this.timeline) return null;
    // (the room's timeline is the oldest anyone has: we take it on if it isn't ours yet)
    let tl = this.timeline;
    for (const p of this.peers.values()) if (p.tl && olderTimeline(p.tl, tl)) tl = p.tl;
    if (tl.origin === selfId || this.peers.has(tl.origin)) return tl.origin;
    let best = selfId,
      bestJ = this.joinedAt;
    for (const [id, p] of this.peers) {
      if (p.joined == null) continue; // (not heard from yet)
      if (p.joined < bestJ || (p.joined === bestJ && id < best)) {
        best = id;
        bestJ = p.joined;
      }
    }
    return best;
  }

  get isLeader() {
    return !!this.room && this.leaderId === selfId;
  }

  get leaderName() {
    const id = this.leaderId;
    return id === selfId ? this.name : (this.peers.get(id) || {}).name || 'the room’s leader';
  }

  // Bumping into each other (experimental): on for the whole room or for no one
  get collide() {
    return cleanCollide(this.timeline && this.timeline.collide).on;
  }

  // Turn it on or off for everyone (only the leader can). Takes effect at once.
  setCollide(on) {
    if (!this.room || !this.timeline || !this.isLeader) return;
    const collide = { on: !!on, rev: cleanCollide(this.timeline.collide).rev + 1 };
    this.timeline = { ...this.timeline, collide };
    this.aHello.send(this._hello());
    this.emit('collide', collide.on, null);
  }

  // where the room surfs, and when
  get spot() {
    return this.roomInfo ? this.roomInfo.spot : 'margaret';
  }

  get time() {
    return this.roomInfo ? this.roomInfo.time : 'day';
  }

  _hello() {
    return { v: MP.protocol, name: this.name, board: this.board, role: this.role, look: this.look, playing: this.playing, tl: this.timeline, j: this.joinedAt };
  }

  _onHello(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const before = this.peers.get(peerId);
    const p = before || { name: '…', board: 'shortboard', role: 'surfer', origin: null, playing: false, joined: null, tl: null };
    const firstHello = !before || before.name === '…';
    p.name = clean(msg.name, 24) || 'Surfer';
    p.board = msg.board === 'longboard' ? 'longboard' : 'shortboard';
    p.role = msg.role === 'drone' ? 'drone' : 'surfer';
    p.look = cleanLook(msg.look);
    p.playing = !!msg.playing;
    p.origin = msg.tl && msg.tl.origin;
    // (which timeline they're on, and since when they've been here: who leads the room)
    p.tl = msg.tl && typeof msg.tl.origin === 'string' && Number.isFinite(msg.tl.created) ? { origin: msg.tl.origin, created: msg.tl.created } : null;
    p.joined = Number.isFinite(msg.j) ? msg.j : null;
    p.version = msg.v;
    this.peers.set(peerId, p);
    if (firstHello) this.emit('join', peerId, p.name);
    this.emit('info', peerId, p);
    this.emit('peers');
    if (msg.v !== MP.protocol) this.emit('warn', `${p.name} is on a different version of the game`);
    // someone changed the room's waves (same timeline, newer revision)
    if (msg.tl && this.timeline && msg.tl.origin === this.timeline.origin && msg.tl.seed === this.timeline.seed) {
      const theirs = cleanWaves(msg.tl.waves, this.spot);
      if (theirs.rev > cleanWaves(this.timeline.waves, this.spot).rev) {
        this.timeline = { ...this.timeline, waves: theirs };
        this.emit('waves', theirs, p.name);
      }
      // ...or the leader turned collisions on or off
      const coll = cleanCollide(msg.tl.collide);
      if (coll.rev > cleanCollide(this.timeline.collide).rev) {
        this.timeline = { ...this.timeline, collide: coll };
        this.emit('collide', coll.on, p.name);
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
      let changed = !this.timeline || best.tl.origin !== this.timeline.origin || best.tl.seed !== this.timeline.seed;
      this.timeline = best.tl;
      this.offset = best.offset;
      // the room's spot and time of day are whatever its first player chose
      const spot = cleanSpot(best.tl.spot),
        time = cleanTime(best.tl.time);
      if (spot !== this.roomInfo.spot || time !== this.roomInfo.time) {
        Object.assign(this.roomInfo, { spot, time });
        this._writePresence().catch(() => {});
        changed = true;
      }
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

  // Which peers we only reach through the TURN relay. The browser connects directly whenever it
  // can and only falls back to the relay when that fails; the relay's data is metered, so those
  // peers get fewer updates (sendPose). From the connection's own stats: the route it chose.
  async _checkRoutes() {
    const room = this.room;
    if (!room || !room.getPeers) return;
    const relayed = new Set();
    for (const [id, pc] of Object.entries(room.getPeers())) {
      try {
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach((r) => {
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        });
        if (!pair) stats.forEach((r) => r.type === 'candidate-pair' && (r.selected || (r.nominated && r.state === 'succeeded')) && (pair = r));
        if (!pair) continue;
        const ends = [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)];
        if (ends.some((c) => c && c.candidateType === 'relay')) relayed.add(id);
      } catch (e) {
        /* closing */
      }
    }
    if (this.room !== room) return;
    const changed = relayed.size !== this.relayed.size || [...relayed].some((id) => !this.relayed.has(id));
    this.relayed = relayed;
    if (changed) this.emit('peers');
  }

  // ---------------------------------------------------------------- gameplay
  // relayToo: also to the peers we reach through the relay (else only the direct ones)
  sendPose(bytes, relayToo = true) {
    if (!this.room || !this.peers.size) return;
    if (relayToo || !this.relayed.size) return void this.aPose.send(bytes)?.catch?.(() => {});
    const direct = [...this.peers.keys()].filter((id) => !this.relayed.has(id));
    if (direct.length) this.aPose.send(bytes, { target: direct })?.catch?.(() => {});
  }

  // to: one peer's id (else everyone; they may have just left)
  sendEvent(evt, to = null) {
    if (this.room && this.peers.size) this.aEvt.send(evt, to ? { target: to } : undefined)?.catch?.(() => {});
  }
}
