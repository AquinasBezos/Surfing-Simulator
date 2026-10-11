// Global tunables for the simulator. Units are metres, seconds, radians.

export const QUALITY = {
  high: { rows: 384, cols: 300, cubeSize: 1024, particles: 1600, trees: 1400, pixelRatio: 2 },
  low: { rows: 232, cols: 196, cubeSize: 512, particles: 600, trees: 500, pixelRatio: 1 },
};

// Breaking wave behaviour. The wave travels toward the beach (+z).
export const WAVE = {
  slots: 2, // waves alive at once (must match shader)
  speed: 5.2, // crest celerity
  spawnZ: -115, // crest z when a wave appears
  breakZ: 0, // crest z at which the peak starts to pitch
  dieStartZ: 82, // the wave turns to whitewater and fades out here...
  dieEndZ: 118, // ...and is gone here
  spacing: 118, // distance between consecutive crests in a set
  peelSpeed: 6.6, // speed the breaking point travels along the crest (main direction)
  backSpeed: 2.4, // speed the break spreads the other way from the peak
  tThrow: 1.5, // seconds for the lip to pitch fully after a section starts breaking
  tTube: 3.6, // seconds a section stays an open barrel
  tCollapse: 1.7, // seconds for the barrel to collapse into whitewater
  curveK: 0.00028, // crest line curvature (sections away from the reef lag behind)
  curveMax: 24,
};

// Wave heights you can pick (m), the range the 'random' setting wanders through, the size
// below which a broken wave is gentle enough to ride the whitewater, and the shortest
// horizontal scale a wave gets (smaller waves are relatively longer and gentler).
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

export const LINEUP_Z = -5;

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
};

export const CROUCH_DROP = 0.55; // how far the eye drops when fully crouched (m)

export const WORLD_RADIUS = 5000;

// Multiplayer: Firebase Realtime Database used only for room matchmaking; gameplay data
// goes peer-to-peer over WebRTC (Trystero).
export const MULTIPLAYER = {
  databaseURL: 'https://lineup-dbc58-default-rtdb.europe-west1.firebasedatabase.app',
  roomsPath: 'lineup/rooms',
  maxPlayers: 8,
  poseHz: 15,
  protocol: 1,
  // TURN relay. Players connect directly when they can, but strict NATs and many
  // university, office and mobile networks block that; those players need a relay or
  // they can't see each other ("could not connect to peer ... after exchanging SDP").
  // Free option: Metered Open Relay (20 GB a month). Sign up at
  // https://dashboard.metered.ca/signup?tool=turnserver and paste the credentials URL
  // it gives you, like 'https://yourapp.metered.live/api/v1/turn/credentials?apiKey=KEY'.
  // Any URL returning a list of ICE servers (or { iceServers }) works here.
  turnCredentialsURL: '',
  // ...or list TURN servers directly:
  // { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }
  turnServers: [],
};
