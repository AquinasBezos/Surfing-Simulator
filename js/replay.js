// Replay (singleplayer). Every frame you play, the waves and your surfer are written into a
// ring buffer that holds the last REPLAY_SECONDS. A replay plays that back exactly (the waves
// as they were, you as the full character on your board, the spray off your board) while you
// fly the drone around it. main.js does the playing back; this is the recording.
export const REPLAY_SECONDS = 30;
const HZ = 90; // at most this many frames a second are kept

// One frame: these fields, then WAVE_FIELDS for each wave slot.
// (state: remote.js's POSE code; drop, bow, turn, side, move, moveDir: what the board was
// doing to the water, so the replay throws the same spray)
export const F = {
  t: 0, x: 1, y: 2, z: 3, qx: 4, qy: 5, qz: 6, qw: 7,
  state: 8, crouch: 9, foot: 10, lean: 11, effort: 12, dive: 13, lookYaw: 14, lookPitch: 15,
  vx: 16, vy: 17, vz: 18, drop: 19, bow: 20, turn: 21, side: 22, move: 23, moveDir: 24,
};
const BASE = 25;
const WAVE_FIELDS = ['active', 'id', 'crestZ0', 'peakX', 'dir', 'height', 'S'];

export class ReplayBuffer {
  constructor(slots) {
    this.slots = slots;
    this.stride = BASE + slots * WAVE_FIELDS.length;
    this.cap = Math.ceil((REPLAY_SECONDS + 1) * HZ) + 8;
    this.buf = new Float64Array(this.cap * this.stride);
    this.clear();
  }

  clear() {
    this.head = 0; // where the next frame goes
    this.count = 0;
  }

  // where frame i starts (0 = the oldest kept)
  at(i) {
    return ((this.head - this.count + i + this.cap) % this.cap) * this.stride;
  }

  get firstT() {
    return this.count ? this.buf[this.at(0)] : 0;
  }

  get lastT() {
    return this.count ? this.buf[this.at(this.count - 1)] : 0;
  }

  get duration() {
    return this.lastT - this.firstT;
  }

  // Keep this frame (at time t: the wave clock). fill(buf, o) writes the F fields at buf[o + ...].
  record(t, waves, fill) {
    if (this.count) {
      const last = this.lastT;
      if (t < last) this.clear(); // the clock went back: a new game
      else if (t - last < 1 / HZ - 1e-6) return;
    }
    const o = this.head * this.stride;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
    const b = this.buf;
    fill(b, o);
    b[o + F.t] = t;
    let p = o + BASE;
    for (let s = 0; s < this.slots; s++) {
      const w = waves[s];
      b[p++] = w.active ? 1 : 0;
      b[p++] = Number(w.id) || 0;
      b[p++] = w.crestZ0;
      b[p++] = w.peakX;
      b[p++] = w.dir;
      b[p++] = w.height;
      b[p++] = w.S;
    }
    // (older than the replay needs: dropped)
    while (this.count > 2 && t - this.buf[this.at(1)] > REPLAY_SECONDS + 0.5) this.count--;
  }

  // the last frame at or before t (clamped to the ones kept)
  find(t) {
    let lo = 0,
      hi = this.count - 1;
    if (hi < 0) return -1;
    if (t <= this.buf[this.at(0)]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.buf[this.at(mid)] <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  get(i, field) {
    return this.buf[this.at(i) + field];
  }

  // Put the waves of time t (between frames i and i + 1) back into the model's slots: each
  // crest eased between the two frames if it's the same wave in both.
  applyWaves(model, i, t) {
    const b = this.buf;
    const j = Math.min(i + 1, this.count - 1);
    const oi = this.at(i),
      oj = this.at(j);
    const ti = b[oi],
      tj = b[oj];
    const k = tj > ti ? Math.min(1, Math.max(0, (t - ti) / (tj - ti))) : 0;
    const n = WAVE_FIELDS.length;
    for (let s = 0; s < this.slots; s++) {
      const pi = oi + BASE + s * n,
        pj = oj + BASE + s * n;
      const w = model.waves[s];
      w.active = b[pi] > 0.5;
      w.id = b[pi + 1];
      const same = b[pj] > 0.5 && b[pj + 1] === b[pi + 1];
      w.crestZ0 = same ? b[pi + 2] + (b[pj + 2] - b[pi + 2]) * k : b[pi + 2];
      w.peakX = b[pi + 3];
      w.dir = b[pi + 4];
      w.height = b[pi + 5];
      w.S = b[pi + 6];
      if (w.active) model._derive(w);
    }
    model.time = t;
    return k;
  }
}
