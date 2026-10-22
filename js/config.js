// Global tunables for the simulator. Units are metres, seconds, radians.

export const QUALITY = {
  // sheets: the sheets of spray off the board (the bow wave, the fan in a turn)
  high: { rows: 384, cols: 300, cubeSize: 1024, particles: 1600, trees: 1400, pixelRatio: 2, sheets: true },
  low: { rows: 232, cols: 196, cubeSize: 512, particles: 600, trees: 500, pixelRatio: 1, sheets: false },
};

// Breaking wave behaviour. The wave travels toward the beach (+z). The timing below is the
// same everywhere; how the wave breaks belongs to the surf spot (spots.js) and is copied in
// here for the spot being played (applySpotWave in wave.js).
export const WAVE = {
  slots: 4, // waves alive at once (must match shader)
  speed: 5.2, // crest celerity
  // (timing and where waves live can belong to a spot too: a wave pool's are its own)
  spawnZ: -115, // crest z when a wave appears
  breakZ: 0, // crest z at which the peak starts to pitch
  dieStartZ: 82, // the wave turns to whitewater and fades out here...
  dieEndZ: 118, // ...and is gone here
  spacing: 118, // distance between consecutive crests in a set
  // the spot's (Margaret River's until another is chosen):
  peelSpeed: 6.6, // speed the breaking point travels along the crest (main direction)
  backSpeed: 2.4, // speed the break spreads the other way from the peak
  breakWidth: 0, // how much of the crest pitches at once when the wave first breaks...
  backWidth: 0, // ...and on the other side of the peak
  tThrow: 1.5, // seconds for the lip to pitch fully after a section starts breaking
  tTube: 3.6, // seconds a section stays an open barrel
  tCollapse: 1.7, // seconds for the barrel to collapse into whitewater
  curveK: 0.00028, // crest line curvature (sections away from the reef lag behind)
  curveMax: 24,
  peelFlat: 40, // the wave fades out this far along the crest from the peak...
  peelFall: 260, // ...over this distance
  backFall: 45, // (and over this distance on the other side)
  dir: 0, // 0: peels either way, 1: always toward +x (a left)
  mirror: 0, // > 0: every wave peaks at both x = +-mirror and peels in toward x = 0 (a pool)
  spill: [1.0, 1.8], // waves smaller than this (m) spill (crumble from the crest) rather than barrel
  peakSpread: 5,
  shoalFrom: -115,
  shoalBase: 0.5,
  steepFrom: -100,
  pool: null, // a pool's walls and pier: waves die down against them (see spots.js)
  current: null, // { speed, half }: water flowing back out (-z) within `half` m of x = 0
};

// Wave heights you can pick (m), the range the 'random' setting wanders through, the size
// below which a broken wave is gentle enough to ride the whitewater, and the shortest
// horizontal scale a wave gets (smaller waves are relatively longer and gentler). The
// spot's: each spot has its own range (spots.js).
export const WAVE_HEIGHTS = { min: 0.6, max: 3.4, randomMin: 0.8, randomMax: 3.0, default: 2.5, small: 1.5, minScale: 2.2 };

// Gerstner swell components: [direction (deg, 0 = toward the beach), wavelength, amplitude, steepness]
export const SWELL = [
  [0, 66, 0.2, 0.42],
  [11, 43, 0.11, 0.42],
  [-17, 29, 0.065, 0.4],
  [34, 17.5, 0.035, 0.36],
  [-41, 11.2, 0.022, 0.32],
  [68, 7.4, 0.011, 0.3],
  [-63, 5.2, 0.0075, 0.26],
  [108, 3.7, 0.0045, 0.22],
];

export const GRAVITY = 9.81;

// Sun over the ocean so the waves are backlit when looking out to sea or down the line.
const s = [-0.36, 0.6, -0.71];
const sl = Math.hypot(s[0], s[1], s[2]);
export const SUN_DIR = [s[0] / sl, s[1] / sl, s[2] / sl];
export const SUN_COLOR = [1.0, 0.95, 0.86];

// Times of day. The sun stays on the same bearing (over the sea, so waves are backlit when
// you look out the back); at sunset it sits 4 degrees up, orange, and the sky light turns
// dim and violet. waterSun: sun strength in the water shader; skyAmb: open-sky light on the
// water and seabed; underwater: overall light below the surface.
const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
};
// The setting sun 4.3 degrees up, toward the horizontal bearing [x, z] (a spot can choose).
export function sunsetSun(toward = [SUN_DIR[0], SUN_DIR[2]]) {
  const h = Math.hypot(toward[0], toward[1]);
  const el = (4.3 * Math.PI) / 180;
  return unit([(toward[0] / h) * Math.cos(el), Math.sin(el), (toward[1] / h) * Math.cos(el)]);
}
const sunsetDir = sunsetSun();
export const TIMES_OF_DAY = {
  day: {
    sunDir: SUN_DIR,
    sunColor: SUN_COLOR,
    sunLight: 2.6,
    waterSun: 3.2,
    skyAmb: [0.32, 0.48, 0.62],
    hemiSky: 0xa9c8e8,
    hemiGround: 0x6f8f80,
    hemi: 0.9,
    fog: 0xb4cbe0,
    exposure: 0.95,
    env: 0.9,
    spray: [2.2, 2.35, 2.4],
    underwater: [1, 1, 1],
    sunset: 0,
  },
  sunset: {
    sunDir: sunsetDir,
    sunColor: [1.0, 0.5, 0.24],
    sunLight: 1.9,
    waterSun: 2.9,
    skyAmb: [0.16, 0.13, 0.21],
    hemiSky: 0x8b6f9c,
    hemiGround: 0x3a302e,
    hemi: 0.62,
    fog: 0x9a6c62,
    exposure: 1.05,
    env: 0.85,
    spray: [1.6, 1.12, 0.92],
    underwater: [0.5, 0.42, 0.44],
    sunset: 1,
  },
};

export const LINEUP_Z = -5; // (Margaret River's; each spot has its own lineup)

export const BOARD = { length: 1.86, width: 0.5 };

// Board types. Distances along the board are measured from its centre, + toward the nose.
export const BOARDS = {
  shortboard: {
    label: 'Shortboard',
    length: 1.86,
    paddleTop: 2.5, // m/s at full paddling effort
    paddleTau: 2.6, // s: how quickly paddling reaches that speed
    catchBoost: 1.0,
    turn: 1.0,
    planeLo: 1.8, // speeds (m/s) over which the board starts planing when standing
    planeHi: 4.0,
    proneEyeZ: 0.3,
    walk: false,
  },
  longboard: {
    label: 'Longboard',
    length: 2.8,
    paddleTop: 3.0,
    paddleTau: 2.8,
    catchBoost: 1.35,
    turn: 0.6,
    planeLo: 1.2,
    planeHi: 3.2,
    proneEyeZ: 0.55,
    walk: true,
    footMin: -1.0, // tail (tight turns)
    footMax: 1.18, // nose (hang ten)
  },
};

// First-person eye positions in the board frame (x right, y up, z toward the tail).
export const EYE = {
  prone: [0, 0.34, 0.3],
  standing: [0, 1.32, 0.32],
  sitting: [0, 0.88, 0.2], // sat astride the board, a little behind its middle
};

export const CROUCH_DROP = 0.55; // how far the eye drops when fully crouched (m)

export const WORLD_RADIUS = 5000;

// Multiplayer: Firebase Realtime Database used only for room matchmaking; gameplay data
// goes peer-to-peer over WebRTC (Trystero).
export const MULTIPLAYER = {
  databaseURL: 'https://lineup-dbc58-default-rtdb.europe-west1.firebasedatabase.app',
  roomsPath: 'lineup/rooms',
  maxPlayers: 8,
  // Your position is sent to the others this many times a second: [to players you reach
  // directly, to those you reach through the TURN relay]. The relay's data is metered, and every
  // update costs about 200 bytes with the connection's own headers, so how often depends on
  // what you're doing: riding (or within reach of someone, with collisions on) needs every
  // detail, sitting still very little. In between, the others predict where you are.
  poseRates: { ride: [15, 10], move: [10, 5], walk: [8, 4], drone: [10, 5], still: [4, 2] },
  protocol: 4, // 2: rooms have a surf spot and a time of day; 3: bumping into each other (collisions); 4: packed poses
  // TURN relay. Players connect directly when they can, but strict NATs and many
  // university, office and mobile networks block that; those players need a relay or
  // they can't see each other ("could not connect to peer ... after exchanging SDP").
  // The relay's username and password are NOT in this repo: they're kept in the database
  // at turnPath (readable, but only writable from the Firebase console), as the string
  // "username:password", and the game reads them when you join a room. See the README.
  // To change them (say they leak), just edit that value: no code change.
  turnPath: 'lineup/turn',
  turnHosts: [
    // Metered's relay (the addresses aren't secret; the username and password are)
    'turn:standard.relay.metered.ca:80',
    'turn:standard.relay.metered.ca:80?transport=tcp',
    'turn:standard.relay.metered.ca:443',
    'turns:standard.relay.metered.ca:443?transport=tcp',
  ],
  turnStun: 'stun:stun.relay.metered.ca:80',
  // Alternatives: a URL returning a list of ICE servers (or { iceServers }), for example a
  // small server that hands out short-lived credentials...
  turnCredentialsURL: '',
  // ...or fixed TURN servers: { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
  // (anything here is public, so only for servers that don't need protecting)
  turnServers: [],
};
