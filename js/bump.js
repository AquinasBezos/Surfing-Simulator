// Bumping into the other surfers: an experimental multiplayer mode the room's leader turns on.
//
// Each player works out their own side of a bump. Your surfer is simulated here; the others are
// where their snapshots put them now (remote.js predicts that), moving as they last said, with
// their heading, state and lean. Seen from above, each board and its rider is a capsule. When two
// touch while closing on each other they swap an impulse along the line between them. Both
// players work it out from the same numbers, so it comes out the same on both screens, and each
// takes their own half. (Each sees the other a moment late, so sometimes only one game sees a
// bump: then it tells the other one.)
//
// How hard someone is to shift depends on what they're doing (TAKE):
//  - lying down: easy to push along the board (it's shaped to glide that way), hard to push
//    sideways (the rails, the fins and your body all have to shove water aside)
//  - sitting: your legs hang down in the water and anchor you, so a bump hardly moves you, but
//    the board pivots round them, so a knock at the nose swings you round
//  - standing: the fins grip sideways, and your feet are spread along the board, so a jolt from
//    the side unbalances you far more than one from in front or behind
// Leaning into a bump braces you against it: you're pushed less, and it takes a bigger hit to
// throw you off. Leaning away from it, you're pushed further and fall off more easily. A soft
// bump just pushes you; a hard one (too sudden a jolt for how you're placed) knocks you off.
import { BOARDS } from './config.js';

// mLong / mLat: how heavy someone is to push along / across their board (kg: them, the board and
// the water that has to move with them). I: how heavy to turn (kg m²) about pivot (m from the
// board's middle, + toward the nose: where their weight is). tLong / tLat: how sudden a change of
// speed (m/s) along / across the board throws them off. feet: how far their feet (or knees) are
// from the pivot, so how hard a spin jolts them (m). r: half their width from above (m).
const TAKE = {
  prone: { mLong: 85, mLat: 260, I: 30, pivot: -0.1, tLong: 3.4, tLat: 2.2, feet: 0.1, r: 0.3 },
  popup: { mLong: 85, mLat: 170, I: 14, pivot: 0, tLong: 1.2, tLat: 0.7, feet: 0.3, r: 0.3 },
  standing: { mLong: 85, mLat: 170, I: 14, pivot: 0, tLong: 2.0, tLat: 1.2, feet: 0.3, r: 0.3 },
  sitting: { mLong: 240, mLat: 300, I: 12, pivot: -0.15, tLong: 0.9, tLat: 0.6, feet: 0, r: 0.27 },
};
const BOUNCE = 0.2; // boards and bodies are soft
const BRACE_PUSH = 0.45; // leaning right into a bump makes you e^0.45 = 1.6 times as hard to push...
const BRACE_HOLD = 0.8; // ...and e^0.8 = 2.2 times as hard to knock off (leaning away: the reverse)
const REACH = 1.0; // m: one this far above the other (in the air, or under it) doesn't touch it
const SPIN = 4; // rad/s: the most a board's turning counts toward a bump (a tailslide swings fast)
const COOL = 0.3; // s: one bump per meeting (it takes a moment for theirs to reach us)
const MIN_CLOSING = 0.05; // m/s: slower than this, two boards just ease apart

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lengthOf = (board) => (BOARDS[board] || BOARDS.shortboard).length;
const widthOf = (b) => TAKE[b.state].r + (b.board === 'longboard' ? 0.03 : 0);

// Closest points between segments p1-q1 and p2-q2 (x, z): into out.ax/az, out.bx/bz
const EPS = 1e-9;
function closest(p1x, p1z, q1x, q1z, p2x, p2z, q2x, q2z, out) {
  const d1x = q1x - p1x,
    d1z = q1z - p1z,
    d2x = q2x - p2x,
    d2z = q2z - p2z;
  const rx = p1x - p2x,
    rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z,
    e = d2x * d2x + d2z * d2z,
    f = d2x * rx + d2z * rz;
  let s = 0,
    t = 0;
  if (a <= EPS && e > EPS) t = clamp(f / e, 0, 1);
  else if (a > EPS) {
    const c = d1x * rx + d1z * rz;
    if (e <= EPS) s = clamp(-c / a, 0, 1);
    else {
      const b = d1x * d2x + d1z * d2z,
        den = a * e - b * b;
      if (den > 1e-4 * a * e) s = clamp((b * f - c * e) / den, 0, 1);
      else {
        // side by side (parallel): the middle of where they overlap, not an end
        const t0 = -c / a,
          t1 = t0 + b / a;
        const lo = Math.max(0, Math.min(t0, t1)),
          hi = Math.min(1, Math.max(t0, t1));
        s = lo <= hi ? (lo + hi) / 2 : clamp(t0, 0, 1);
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  out.ax = p1x + d1x * s;
  out.az = p1z + d1z * s;
  out.bx = p2x + d2x * t;
  out.bz = p2z + d2z * t;
  return out;
}

// How one surfer gives to an impulse along (nx, nz) at (px, pz). brace: how far they lean
// toward whoever hit them (-1..1). Fills g: lin (how fast the contact gives, m/s per N s, as
// they move), rot (the same, as they turn), nf / nr (the push along / across their board),
// lever and I (their turning), s (how much the bracing stiffens them).
function give(b, T, nx, nz, px, pz, brace, g) {
  const fx = -Math.sin(b.yaw),
    fz = -Math.cos(b.yaw);
  const nf = nx * fx + nz * fz,
    nr = nx * -fz + nz * fx; // (right = (-fz, fx))
  g.s = Math.exp(BRACE_PUSH * brace);
  g.nf = nf;
  g.nr = nr;
  g.lin = ((nf * nf) / T.mLong + (nr * nr) / T.mLat) / g.s;
  // turning about where their weight is (a longboarder stands wherever they've walked to)
  const pivot = b.state === 'standing' && b.board === 'longboard' ? b.foot || 0 : T.pivot;
  const ax = px - (b.x + fx * pivot),
    az = pz - (b.z + fz * pivot);
  g.lever = az * nx - ax * nz;
  g.I = T.I + (b.board === 'longboard' ? 4 : 1); // (and the board's own: a longboard's long and heavy)
  g.rot = (g.lever * g.lever) / g.I;
  return g;
}

// how fast a point of a surfer's board moves (x, z): their speed plus their turning
function pointVel(b, px, pz, out) {
  const w = clamp(b.yawRate || 0, -SPIN, SPIN);
  out[0] = b.vx + w * (pz - b.z);
  out[1] = b.vz - w * (px - b.x);
  return out;
}

const _c = {},
  _ga = {},
  _gb = {},
  _va = [0, 0],
  _vb = [0, 0];

// One bump, seen by `me`. Surfers: { x, y, z, vx, vz, yaw, yawRate, state, board, foot,
// braceX, braceZ } (state: prone, popup, standing or sitting; braceX: leaning right, braceZ:
// toward the nose, -1..1). tie: +1 or -1, which way to part two that sit exactly on top of each
// other (the opposite for each of them). Returns null if they don't touch; else, into out:
//   nx, nz: the way I'm pushed; pen: how far we overlap (m); px, pz: where we touch
//   J: the impulse (N s; 0 if we're not closing); closing: how fast we were (m/s)
//   dvLong, dvLat: my change of speed along / across my board (m/s; + = forward / right)
//   dYaw: my change of turning speed (rad/s); share: how much of the overlap is mine to undo
//   severity: how close it comes to knocking me off (over 1: it does); brace: as I'm leaning
//   mine, theirs: how fast I was going at them, and they at me (m/s)
export function bump(me, other, tie = 1, out = {}) {
  const A = TAKE[me.state],
    B = TAKE[other.state];
  if (!A || !B || Math.abs(me.y - other.y) > REACH) return null;
  const ra = widthOf(me),
    rb = widthOf(other);
  // the boards from above: segments along their middles, rounded off by their widths
  const ha = Math.max(0, lengthOf(me.board) / 2 - ra),
    hb = Math.max(0, lengthOf(other.board) / 2 - rb);
  const afx = -Math.sin(me.yaw),
    afz = -Math.cos(me.yaw),
    bfx = -Math.sin(other.yaw),
    bfz = -Math.cos(other.yaw);
  const c = closest(me.x - afx * ha, me.z - afz * ha, me.x + afx * ha, me.z + afz * ha, other.x - bfx * hb, other.z - bfz * hb, other.x + bfx * hb, other.z + bfz * hb, _c);
  let nx = c.ax - c.bx,
    nz = c.az - c.bz;
  const d = Math.hypot(nx, nz);
  const pen = ra + rb - d;
  if (pen <= 0) return null;
  if (d > 1e-4) {
    nx /= d;
    nz /= d;
  } else {
    // (crossing right over each other: apart along the line between their middles)
    nx = me.x - other.x;
    nz = me.z - other.z;
    const m = Math.hypot(nx, nz);
    if (m > 1e-4) {
      nx /= m;
      nz /= m;
    } else {
      nx = tie;
      nz = 0;
    }
  }
  const px = (c.ax + c.bx) / 2,
    pz = (c.az + c.bz) / 2;
  // (each of us is pushed away from the other: leaning toward them braces you)
  const braceA = leanToward(me, -nx, -nz),
    braceB = leanToward(other, nx, nz);
  const ga = give(me, A, nx, nz, px, pz, braceA, _ga);
  const gb = give(other, B, nx, nz, px, pz, braceB, _gb);
  pointVel(me, px, pz, _va);
  pointVel(other, px, pz, _vb);
  const closing = (_va[0] - _vb[0]) * nx + (_va[1] - _vb[1]) * nz; // (< 0: coming together)
  const J = closing < 0 ? (-(1 + BOUNCE) * closing) / (ga.lin + ga.rot + gb.lin + gb.rot) : 0;
  out.nx = nx;
  out.nz = nz;
  out.pen = pen;
  out.px = px;
  out.pz = pz;
  out.closing = -closing;
  out.share = ga.lin / Math.max(1e-9, ga.lin + gb.lin);
  out.mine = -(me.vx * nx + me.vz * nz);
  out.theirs = other.vx * nx + other.vz * nz;
  return respond(A, ga, J, braceA, out);
}

// How far a surfer leans toward (ux, uz) (-1..1): sideways, and toward the nose
function leanToward(b, ux, uz) {
  const fx = -Math.sin(b.yaw),
    fz = -Math.cos(b.yaw);
  return clamp((b.braceX || 0) * (ux * -fz + uz * fx) + (b.braceZ || 0) * (ux * fx + uz * fz), -1, 1);
}

// My side of an impulse J (N s), as give() says I take it: how it changes my speed and turning,
// and how close it comes to knocking me off (a jolt along the board, across it, and the board
// spun under you)
function respond(A, g, J, brace, out) {
  out.J = J;
  out.dvLong = (J * g.nf) / (A.mLong * g.s);
  out.dvLat = (J * g.nr) / (A.mLat * g.s);
  out.dYaw = (J * g.lever) / g.I;
  out.brace = brace;
  const across = Math.hypot(out.dvLat, out.dYaw * A.feet);
  out.severity = Math.hypot(out.dvLong / A.tLong, across / A.tLat) / Math.exp(BRACE_HOLD * brace);
  return out;
}

// My side of a bump someone else's game worked out: impulse J pushing me along (nx, nz), where
// we touched (px, pz). Into out, as bump()'s; null if I'm not in a state to be bumped.
export function answer(me, J, nx, nz, px, pz, out = {}) {
  const A = TAKE[me.state];
  if (!A) return null;
  const brace = leanToward(me, -nx, -nz);
  const g = give(me, A, nx, nz, px, pz, brace, _ga);
  Object.assign(out, { nx, nz, px, pz, pen: 0, share: 0, closing: 0 });
  return respond(A, g, J, brace, out);
}

// Your surfer against everyone else, every frame: applies your side of each bump to your
// surfer, and says what happened (for the sound, the spray and the messages). You each see the
// other a moment late, so sometimes only one game sees a bump: whoever's does tells the other
// (main.js sends what update() returns; receive() takes it), and either way each of you takes
// it just once.
export class Bumps {
  constructor(surfer) {
    this.surfer = surfer;
    this.cool = new Map(); // id -> seconds until they can bump you again
    this.me = {};
    this.log = []; // (the last few bumps: for testing)
  }

  clear() {
    this.cool.clear();
  }

  // your surfer, as bump() wants it; null if you can't be bumped (wiped out, under the water)
  self() {
    const sf = this.surfer;
    if (!TAKE[sf.state] || sf.diving) return null;
    return Object.assign(this.me, { x: sf.x, y: sf.y, z: sf.z, vx: sf.vx, vz: sf.vz, yaw: sf.yaw, yawRate: sf.yawRate, state: sf.state, board: sf.boardType, foot: sf.footPos, braceX: sf.braceX, braceZ: sf.braceZ });
  }

  // others: [{ id, name, x, y, z, vx, vz, yaw, yawRate, state, board, foot, braceX, braceZ }].
  // selfId: yours (to part two exactly on top of each other the same way on both screens).
  // Returns this frame's bumps: [{ id, name, J, severity, off, px, pz, nx, nz, mine, theirs, ... }].
  update(dt, others, selfId = '') {
    const sf = this.surfer;
    for (const [id, t] of this.cool) {
      if (t - dt <= 0) this.cool.delete(id);
      else this.cool.set(id, t - dt);
    }
    const hits = [];
    const me = this.self();
    if (!me) return hits;
    for (const o of others) {
      const b = bump(me, o, selfId < o.id ? 1 : -1, {});
      if (!b) continue;
      // overlapping: ease apart (your share of it; they move themselves)
      const k = b.share * b.pen * Math.min(1, dt * 10);
      sf.x += b.nx * k;
      sf.z += b.nz * k;
      // (barely touching, or drifting together: that's all)
      if (b.closing < MIN_CLOSING || this.cool.has(o.id)) continue;
      const hit = this.take(o.id, o.name, o.state, b, 'seen');
      // what to tell them: where on their board it hit them, and which way it pushed them, as
      // their board lay on our screen (theirs is where it really is), and where it was
      const fx = -Math.sin(o.yaw),
        fz = -Math.cos(o.yaw);
      const dx = b.px - o.x,
        dz = b.pz - o.z;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      hit.tell = { k: 'bump', J: r3(b.J), at: r3(dx * fx + dz * fz), side: r3(dx * -fz + dz * fx), pa: r3(-(b.nx * fx + b.nz * fz)), ps: r3(-(b.nx * -fz + b.nz * fx)), x: r3(o.x), z: r3(o.z), mine: r3(b.mine), theirs: r3(b.theirs), closing: r3(b.closing) };
      hits.push(hit);
      if (hit.off) break;
    }
    return hits;
  }

  // A bump another player's game saw (what update() said to tell them): the impulse J, where on
  // your board it hit you (at: m toward the nose, side: m to the right), which way it pushed you
  // (pa, ps: the same way round), where they saw you (x, z), and mine / theirs / closing from
  // their side. Returns the hit; null if you've just had it from your own game, or they saw you
  // somewhere you no longer are (too long ago).
  receive(id, name, e) {
    const me = this.self();
    if (!me || this.cool.has(id)) return null;
    if (Math.hypot(e.x - me.x, e.z - me.z) > 1.5 + 0.25 * Math.hypot(me.vx, me.vz)) return null;
    const fx = -Math.sin(me.yaw),
      fz = -Math.cos(me.yaw);
    const n = Math.hypot(e.pa, e.ps) || 1;
    const nx = (e.pa * fx + e.ps * -fz) / n,
      nz = (e.pa * fz + e.ps * fx) / n;
    const b = answer(me, e.J, nx, nz, me.x + e.at * fx + e.side * -fz, me.z + e.at * fz + e.side * fx, {});
    b.mine = e.theirs;
    b.theirs = e.mine;
    b.closing = e.closing;
    return this.take(id, name, null, b, 'told');
  }

  // your side of a bump: change your speed and turning, maybe knock you off. via: 'seen' (by
  // your game) or 'told' (by theirs)
  take(id, name, otherState, b, via) {
    const sf = this.surfer;
    this.cool.set(id, COOL);
    const off = b.severity > 1;
    sf.bumped(b.dvLong, b.dvLat, b.dYaw);
    const hit = { id, name, J: b.J, severity: b.severity, off, px: b.px, pz: b.pz, nx: b.nx, nz: b.nz, mine: b.mine, theirs: b.theirs, closing: b.closing, brace: b.brace, dvLong: b.dvLong, dvLat: b.dvLat, dYaw: b.dYaw, state: sf.state, other: otherState, via };
    this.log.push(hit);
    if (this.log.length > 20) this.log.shift();
    if (off) sf.wipeout(`Knocked off by ${name || 'another surfer'}`);
    return hit;
  }
}
