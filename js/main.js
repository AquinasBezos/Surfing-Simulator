import * as THREE from 'three';
import { QUALITY, SUN_DIR, SUN_COLOR, EYE, LINEUP_Z, WAVE, BOARDS, CROUCH_DROP, MULTIPLAYER } from './config.js';
import { WaveModel, smoothstep, clamp, crestOffset } from './wave.js';
import { Ocean } from './ocean.js';
import { createSky } from './sky.js';
import { createTerrain, seabedY } from './terrain.js';
import { createWaterNormalTexture, createNoiseTexture } from './textures.js';
import { createBoard } from './board.js';
import { Arms } from './body.js';
import { Spray } from './spray.js';
import { Surfer, STATE } from './surfer.js';
import { PCInput } from './input.js';
import { XRControls } from './xr.js';
import { OceanAudio } from './audio.js';
import { Hud } from './hud.js';
import { waterUniforms, addUnderwaterPass, UnderwaterEnv } from './underwater.js';
import { Menu } from './menu.js';
import { RemotePlayers, POSE } from './remote.js';
import { VRMenu } from './vrmenu.js';
import { controls } from './bindings.js';

const params = new URLSearchParams(location.search);
const isMobileXR = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
let savedQuality = 'auto';
try {
  savedQuality = JSON.parse(localStorage.getItem('lineup.settings') || '{}').quality || 'auto';
} catch (e) {
  /* storage unavailable */
}
const qualityName = params.get('q') || (savedQuality !== 'auto' ? savedQuality : isMobileXR ? 'low' : 'high');
const quality = QUALITY[qualityName] || QUALITY.high;
const debug = params.has('debug');

// ---------------------------------------------------------------- renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 9000);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

const sunDir = new THREE.Vector3(...SUN_DIR);
const sky = createSky(renderer, SUN_DIR, quality.cubeSize);
scene.background = sky.cube;
scene.environment = sky.env;
scene.environmentIntensity = 0.9;

const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_COLOR), 2.6);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa9c8e8, 0x6f8f80, 0.9));
scene.fog = new THREE.Fog(0xb4cbe0, 600, 7000);

const model = new WaveModel();
const normalTex = createWaterNormalTexture(256);
const noiseTex = createNoiseTexture(512);
waterUniforms.uUWNoise.value = noiseTex;
const ocean = new Ocean(model, sky.cube, normalTex, noiseTex, quality);
scene.add(ocean.mesh);
const terrain = createTerrain(qualityName);
scene.add(terrain);
const underwater = new UnderwaterEnv(noiseTex, SUN_DIR, qualityName);
scene.add(underwater.group);

// board + body share the board frame
const bodyFrame = new THREE.Group();
const arms = new Arms();
bodyFrame.add(arms.group);
scene.add(bodyFrame);
let board = null;
let boardType = 'shortboard';
const eyeProne = new THREE.Vector3(...EYE.prone);
const eyeStand = new THREE.Vector3(...EYE.standing);

const spray = new Spray(model, quality.particles);
scene.add(spray.points);
const remote = new RemotePlayers(scene);

// fade sphere for wipeouts and teleports (works in VR too)
const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false });
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), fadeMat);
fade.renderOrder = 999;
camera.add(fade);

const hud = new Hud(camera);
const audio = new OceanAudio();
const surfer = new Surfer(model);
const pc = new PCInput(renderer.domElement);
const xr = new XRControls(renderer, rig);
xr.onHandModel = (m) => addUnderwaterPass(m);

// ---------------------------------------------------------------- game state
const game = {
  mode: null, // 'single' | 'multi' while playing
  started: false,
  paused: true,
  invulnerable: true,
  ride: null,
  best: null,
  waves: 0,
  teleport: 0, // fade timer
  look: { yaw: 0, pitch: 0 },
  lookRate: 0,
  flick: null,
  moveFollow: 0,
  standBlend: 0,
  vrStandOffset: 0,
  missTimer: 0,
  noseT: 0,
  noseCalled: 0,
  splash: 0,
  wasUnder: false,
  poseTimer: 0,
  warmup: 6, // render a few frames behind the menu so shaders compile up front
};
let net = null; // multiplayer, loaded on demand

// ---------------------------------------------------------------- menu & settings
const menu = new Menu({
  onPlay: (mode, platform) => startGame(mode, platform),
  onBoard: (type) => setBoardType(type),
  onName: (name) => net && net.setName(name),
  onSettings: (s) => applySettings(s),
  onOpenMulti: () => openMultiplayer(),
  onCloseMulti: () => {
    if (net && !net.room) {
      net.stopWatching();
      net.offline();
    }
  },
  onCreateRoom: (opts) => createRoom(opts),
  onJoinRoom: (room, pass) => joinRoom(room, pass),
  onLeaveRoom: () => {
    leaveRoom();
    menu.show('multi', { push: false });
  },
  onResume: () => resume(),
  onQuit: () => quitToMenu(),
});
let settings = menu.settings;
function applySettings(s) {
  settings = s;
  audio.setVolume(s.volume);
}
applySettings(settings);

// in-headset pause menu (the page's menus can't be seen in VR)
const vrMenu = new VRMenu(renderer, rig, camera, {
  onResume: () => closeVRMenu(),
  onLineup: () => {
    closeVRMenu();
    respawn(true);
  },
  onRecalibrate: () => {
    closeVRMenu();
    xr.calibrate();
    hud.toast('Calibrated paddling position', 2);
  },
  onQuit: () => {
    game.quitAfterVR = true;
    const session = renderer.xr.getSession();
    if (session) session.end();
  },
  getVolume: () => settings.volume,
  setVolume: (v) => menu.setVolume(v),
  info: () => ({
    inRoom: game.mode === 'multi',
    subtitle: game.mode === 'multi' && net && net.roomInfo ? `${net.roomInfo.name} · ${net.peers.size + 1} surfer${net.peers.size ? 's' : ''}` : 'Singleplayer',
  }),
});

function openVRMenu() {
  vrMenu.show('pause');
  game.paused = true; // singleplayer stops; a multiplayer room keeps going
}

function closeVRMenu() {
  vrMenu.hide();
  xr.swallowButtons();
  game.paused = false;
}

// on-screen hints follow the key bindings
function updateHints() {
  document.getElementById('hud-hint').textContent = `${controls.pcKey('lineup')} lineup · Esc menu`;
}
controls.onChange(updateHints);
updateHints();

function setBoardType(type) {
  if (!BOARDS[type]) type = 'shortboard';
  boardType = type;
  if (board) {
    bodyFrame.remove(board);
    board.traverse((o) => o.geometry && o.geometry.dispose());
  }
  board = createBoard(type);
  bodyFrame.add(board);
  addUnderwaterPass(bodyFrame);
  surfer.setBoard(type);
  eyeProne.z = BOARDS[type].proneEyeZ;
  arms.group.position.z = BOARDS[type].proneEyeZ - EYE.prone[2];
  menu.setBoard(type);
  try {
    localStorage.setItem('surf.board', type);
  } catch (e) {
    /* storage unavailable */
  }
  if (net) net.setBoard(type);
}
let savedBoard = null;
try {
  savedBoard = localStorage.getItem('surf.board');
} catch (e) {
  /* storage unavailable */
}
setBoardType(params.get('board') || savedBoard || 'shortboard');

// ---------------------------------------------------------------- VR launcher
const XR_FEATURES = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] };
let xrSupported = false;
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr
    .isSessionSupported('immersive-vr')
    .then((ok) => {
      xrSupported = ok;
      menu.setVR(ok, ok ? '' : 'Open this page in the Meta Quest browser to play in VR.');
    })
    .catch(() => menu.setVR(false, 'Open this page in the Meta Quest browser to play in VR.'));
} else menu.setVR(false, window.isSecureContext ? 'Open this page in the Meta Quest browser to play in VR.' : 'VR needs the page to be served over HTTPS.');

function enterVR() {
  if (!xrSupported || renderer.xr.isPresenting) return;
  navigator.xr
    .requestSession('immersive-vr', XR_FEATURES)
    .then((session) => renderer.xr.setSession(session))
    .catch((e) => {
      menu.show('pause');
      hud.toast(`Couldn't start VR: ${e.message}`, 4);
    });
}

// ---------------------------------------------------------------- game flow
function lineupSpot() {
  // in front of the next wave's peak, slightly toward the shoulder
  let w = null;
  for (const c of model.waves) if (c.active && c.crestZ0 < LINEUP_Z - 6 && (!w || c.crestZ0 > w.crestZ0)) w = c;
  const x = w ? w.peakX + w.dir * 4 : 0;
  return { x, z: LINEUP_Z, yaw: 0 };
}

function respawn(fadeOut = true) {
  if (fadeOut) {
    game.teleport = 1.4;
    return;
  }
  const s = lineupSpot();
  // spread players out a little along the lineup in multiplayer
  const spread = game.mode === 'multi' ? (Math.random() * 2 - 1) * 6 : 0;
  surfer.reset(s.x + spread, s.z, s.yaw);
  game.snapCam = true;
  game.look.yaw = 0;
  game.look.pitch = 0;
  game.ride = null;
  game.missTimer = 0;
}

function startGame(mode, platform) {
  if (mode === 'multi' && (!net || !net.room)) return;
  audio.start();
  game.mode = mode;
  if (mode === 'multi') {
    model.setSchedule(net.seed, () => net.now());
    net.setPlaying(true);
  } else {
    model.clearSchedule();
    model.reset(-62);
    remote.clear();
  }
  game.started = true;
  game.invulnerable = false;
  game.ride = null;
  spray.clear();
  underwater.clearBubbles();
  respawn(false);
  menu.setInGame(true);
  if (platform === 'vr') {
    menu.hide();
    enterVR(); // must stay synchronous with the click for the browser to allow it
  } else if (platform === 'pc') {
    resume();
    hud.toast(`Scroll to paddle (faster = harder) · ${controls.pcKey('left')} / ${controls.pcKey('right')} steer · ${controls.pcKey('popup')} to pop up`, 5);
  } else menu.hide(); // a VR session that started on its own
}

function resume() {
  if (!game.started) return;
  audio.start();
  game.paused = false;
  menu.hide();
  pc.enabled = true;
  pc.capture(settings.fullscreen);
}

function pause() {
  if (!game.started || game.paused || renderer.xr.isPresenting) return;
  game.paused = true;
  pc.enabled = false;
  menu.setInGame(true);
  menu.show('pause');
}

function quitToMenu() {
  if (game.mode === 'multi') leaveRoom(); // finishes in the background
  game.started = false;
  game.paused = true;
  game.mode = null;
  game.invulnerable = true;
  pc.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  model.clearSchedule();
  model.reset(-62);
  menu.setInGame(false);
  menu.show('main');
}

pc.onLockChange = (locked) => {
  if (!locked) pause();
};
// Esc normally pauses by releasing pointer lock, but the lock can be refused (Chrome turns
// down a re-lock within ~1 s of leaving it), so Esc and clicking also work without it
window.addEventListener('keydown', (e) => {
  // (defaultPrevented: the menu already used this Esc, e.g. to resume from the pause screen)
  if (e.key === 'Escape' && !e.defaultPrevented && !pc.locked && game.started && !game.paused && !renderer.xr.isPresenting) pause();
});
renderer.domElement.addEventListener('mousedown', () => {
  if (game.started && !game.paused && !pc.locked && !renderer.xr.isPresenting) pc.requestLock();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) pause();
});
// Ctrl+W can't always be intercepted (no fullscreen keyboard lock): ask before leaving
window.addEventListener('beforeunload', (e) => {
  if (game.started && !game.paused) {
    e.preventDefault();
    e.returnValue = '';
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  audio.start();
  menu.hide();
  if (!game.started) startGame(game.mode || 'single', 'vr-session');
  game.paused = false;
  ocean.setQuality(QUALITY.low, false);
  xr.calibrated = false;
  bodyFrame.remove(arms.group);
  spray.setViewportHeight(1700);
  underwater.setViewportHeight(1700);
  const press = (id) => controls.questText(id).replace(/^Either/, 'either');
  const calibrate = controls.quest.recalibrate === 'none' ? 'Lie or kneel down to start.' : `Lie or kneel down, then press ${press('recalibrate')} to calibrate.`;
  hud.toast(`${calibrate} Paddle with your arms, stand up to surf. ${press('pause')}: menu.`, 7);
});
renderer.xr.addEventListener('sessionend', () => {
  vrMenu.hide();
  ocean.setQuality(quality, qualityName === 'high');
  bodyFrame.add(arms.group);
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  onResize();
  if (game.quitAfterVR) {
    // "Main menu" / "Leave room" in the headset menu
    game.quitAfterVR = false;
    quitToMenu();
    return;
  }
  game.paused = true;
  menu.setInGame(true);
  menu.show('pause');
});

model.onSpawn = () => {
  game.waves++;
};

const TRICK_NAMES = { snap: 'Snap', cutback: 'Cutback', tailslide: 'Tailslide' };

surfer.onEvent = (type, data) => {
  if (type === 'wipeout') {
    if (game.invulnerable) {
      respawn(false);
      return;
    }
    endRide('wipeout');
    hud.toast(`<b>Wipeout</b> · ${data.reason}`, 3.2);
    audio.thud();
    underwater.burst(surfer.x, surfer.y - 0.6, surfer.z, 60, 1.6, 0.4);
    sendEvent({ k: 'wipe', reason: data.reason });
  } else if (type === 'closeout') {
    endRide('closeout');
  } else if (type === 'sink') {
    hud.toast(data.waveNear ? 'Too early! Pop up once the wave is carrying you' : 'Too slow to stand. Paddle (scroll) to get moving again', 3);
  } else if (type === 'state' && data.to === STATE.STANDING) {
    xr.stateWas = null;
  } else if (type === 'maneuver') {
    hud.callout(TRICK_NAMES[data.kind]);
    audio.whoosh(data.kind === 'cutback' ? 0.8 : 1);
    if (game.ride) game.ride.tricks.push(data.kind);
    sendEvent({ k: 'trick', kind: data.kind, dir: data.dir });
  } else if (type === 'air') {
    hud.callout(`Air ${data.time.toFixed(1)} s`);
    if (game.ride) game.ride.tricks.push('air');
    sendEvent({ k: 'air', t: Math.round(data.time * 10) / 10 });
  } else if (type === 'takeoff') {
    audio.splash(0.6);
  } else if (type === 'duckdive') {
    audio.plunge();
    const [fx, fz] = surfer.forward;
    underwater.burst(surfer.x + fx * 0.6, surfer.y, surfer.z + fz * 0.6, 26, 0.7, 0.3);
  } else if (type === 'surface') {
    audio.splash(0.7);
  }
};

function startRide() {
  game.ride = { time: 0, top: 0, tube: 0, nose: 0, tricks: [] };
}

function endRide(reason) {
  const r = game.ride;
  game.ride = null;
  if (!r || r.time < 2) return;
  const parts = [`Ride ${r.time.toFixed(1)} s`, `top ${Math.round(r.top * 3.6)} km/h`];
  if (r.tube > 0.3) parts.push(`barrel ${r.tube.toFixed(1)} s`);
  if (r.nose > 0.3) parts.push(`nose ${r.nose.toFixed(1)} s`);
  const counts = {};
  for (const t of r.tricks) counts[t] = (counts[t] || 0) + 1;
  for (const [k, n] of Object.entries(counts)) parts.push(`${n} ${k === 'air' ? 'air' : k}${n > 1 ? 's' : ''}`);
  const score = Math.round(r.time * 10 + r.top * 6 + r.tube * 60 + r.nose * 25 + r.tricks.length * 40);
  if (!game.best || score > game.best) game.best = score;
  const title = { wipeout: 'Ride ended', kickout: 'Nice kick-out!', closeout: 'The wave closed out' }[reason] || 'Ride over';
  setTimeout(() => hud.toast(`<b>${title}</b> · ${parts.join(' · ')} · score ${score}`, 5), reason === 'wipeout' ? 3000 : 0);
  sendEvent({ k: 'ride', time: Math.round(r.time * 10) / 10, tube: Math.round(r.tube * 10) / 10, score });
}

function updateGame(dt) {
  const s = surfer.s;
  // ride tracking
  if (surfer.riding && surfer.state === STATE.STANDING) {
    if (!game.ride) startRide();
    const r = game.ride;
    r.time += dt;
    r.top = Math.max(r.top, surfer.speed);
    if (surfer.inTube) r.tube += dt;
  } else if (game.ride && surfer.state === STATE.STANDING && !surfer.air) {
    const behind = s.un < -0.7 || !s.wave || s.H < 0.6;
    if (behind) endRide(s.un < -0.7 ? 'kickout' : 'over');
  } else if (game.ride && surfer.state === STATE.PRONE) endRide('over');

  // nose riding on the longboard
  const onNose = surfer.board.walk && surfer.state === STATE.STANDING && surfer.footPos > 0.88 && surfer.speed > 3;
  if (onNose) {
    game.noseT += dt;
    if (game.ride) game.ride.nose += dt;
    if (game.noseT > 0.3 && game.noseCalled < 1) {
      hud.callout('Hang five');
      sendEvent({ k: 'hang', n: 5 });
      game.noseCalled = 1;
    }
    if (surfer.footPos > 1.06 && game.noseT > 0.6 && game.noseCalled < 2) {
      hud.callout('Hang ten');
      sendEvent({ k: 'hang', n: 10 });
      game.noseCalled = 2;
    }
  } else if (surfer.footPos < 0.6) {
    game.noseT = 0;
    game.noseCalled = 0;
  }

  // wipeout -> back to the lineup
  if (surfer.state === STATE.WIPEOUT && surfer.stateTime > 2.4 && game.teleport <= 0) respawn(true);

  // drifted inside or far away without a ride: paddle back out automatically
  const inside = surfer.z > 45 || Math.abs(surfer.x) > 650 || surfer.z < -260;
  const idle = surfer.state === STATE.PRONE && !surfer.riding;
  if (inside && idle && game.teleport <= 0) {
    game.missTimer += dt;
    if (game.missTimer > 4) {
      hud.toast('Paddling back out to the lineup…', 2.5);
      respawn(true);
    }
  } else game.missTimer = 0;
}

// ---------------------------------------------------------------- multiplayer
// One shared load: opening Multiplayer and creating a room straight away must not build
// two Net instances (the room would end up on one and the game would use the other).
let netLoading = null;
function ensureNet() {
  if (net) return Promise.resolve(net);
  netLoading ||= import('./net.js').then(
    (mod) => {
      net = new mod.Net({ name: menu.name, board: boardType });
      wireNet(net);
      return net;
    },
    (e) => {
      netLoading = null; // let the next attempt retry the download
      throw e;
    },
  );
  return netLoading;
}

function wireNet(n) {
  let failedPeer = null; // the surfer named in the lobby's connection warning
  n.on('peers', () => updateLobby());
  n.on('join', (id, name) => {
    hud.feed(`${name} paddled out`);
    if (id === failedPeer) menu.setLobbyStatus(''); // got through after all
  });
  n.on('leave', (id, name) => {
    remote.remove(id);
    hud.feed(`${name} left the lineup`);
  });
  n.on('info', (id, p) => remote.setInfo(id, { name: p.name, board: p.board }));
  n.on('pose', (id, f) => remote.push(id, decodePose(f)));
  n.on('event', (id, e) => onRemoteEvent(id, e));
  n.on('timeline', () => {
    if (game.mode === 'multi') {
      model.setSchedule(n.seed, () => n.now());
      for (const a of remote.avatars.values()) a.snaps.length = 0;
      spray.clear();
      respawn(true); // the waves just changed under us: fade back to the lineup
    }
  });
  n.on('joinError', ({ peerId, name, reason, error }) => {
    let text;
    if (reason === 'blocked')
      text = n.hasRelay
        ? `Couldn't connect to ${name}, even through the relay server.`
        : `Couldn't connect to ${name}: one of your networks blocks direct connections, and no relay server is set up.`;
    else if (reason === 'passcode') text = `Couldn't connect to ${name}: the passcodes don't match.`;
    else text = `Couldn't connect to ${name} (${error}).`;
    failedPeer = peerId;
    hud.feed(text);
    menu.setLobbyStatus(text);
  });
  n.on('warn', (msg) => hud.feed(msg));
  n.on('left', () => {
    failedPeer = null;
    remote.clear();
    menu.leftRoom();
  });
}

async function openMultiplayer() {
  menu.renderRooms(null);
  menu.setNetStatus('');
  try {
    const n = await ensureNet();
    // the player may have backed out, or already created/joined a room, while it loaded
    if (menu.current !== 'multi' || n.room) return n.offline();
    n.watchRooms((rooms, err) => {
      if (err) menu.renderRooms(null, "Can't reach the room server. Check your connection (or the database rules).");
      else menu.renderRooms(rooms, null, MULTIPLAYER.maxPlayers);
    });
  } catch (e) {
    menu.renderRooms(null, `Multiplayer couldn't load: ${e.message}`);
  }
}

async function createRoom(opts) {
  try {
    const n = await ensureNet();
    await n.createRoom(opts);
    menu.setCreateStatus('');
    menu.show('lobby', { push: false });
    updateLobby();
  } catch (e) {
    menu.setCreateStatus(e.message || 'Could not create the room', true);
  }
}

async function joinRoom(room, passcode) {
  const n = await ensureNet();
  if (room.count >= MULTIPLAYER.maxPlayers) return menu.renderRooms(menu.rooms, null, MULTIPLAYER.maxPlayers);
  try {
    await n.joinRoom({ id: room.id, name: room.name, isPrivate: room.isPrivate, passcode, hash: room.hash });
    menu.closePass();
    menu.show('lobby', { push: false });
    updateLobby();
  } catch (e) {
    if (room.isPrivate) menu.passError(e.message || 'Could not join');
    else hud.feed(e.message || 'Could not join');
  }
}

async function leaveRoom() {
  if (!net) return;
  if (game.mode === 'multi') {
    game.mode = 'single';
    model.clearSchedule();
    model.reset(-62);
  }
  await net.leave(); // resets at once (the 'left' event clears the other surfers), then waits for the network
  if (!menu.isOpen || menu.current !== 'multi') net.offline();
}

function updateLobby() {
  if (!net || !net.room) return;
  const players = [{ name: net.name, playing: game.mode === 'multi', me: true }];
  for (const p of net.peers.values()) players.push({ name: p.name, playing: p.playing });
  menu.renderLobby(net.roomInfo, players);
}

function sendEvent(e) {
  if (game.mode === 'multi' && net) net.sendEvent(e);
}

const STATE_CODE = { prone: POSE.PRONE, popup: POSE.POPUP, standing: POSE.STANDING, wipeout: POSE.WIPEOUT };
const poseBuf = new Float32Array(14);
function sendPose() {
  const q = surfer.quat;
  poseBuf[0] = net.now();
  poseBuf[1] = surfer.x;
  poseBuf[2] = surfer.y;
  poseBuf[3] = surfer.z;
  poseBuf[4] = q.x;
  poseBuf[5] = q.y;
  poseBuf[6] = q.z;
  poseBuf[7] = q.w;
  poseBuf[8] = STATE_CODE[surfer.state];
  poseBuf[9] = surfer.crouch;
  poseBuf[10] = surfer.footPos;
  poseBuf[11] = surfer.leanX;
  poseBuf[12] = surfer.paddleEffort;
  poseBuf[13] = surfer.diveDepth;
  net.sendPose(poseBuf);
}

function decodePose(f) {
  return { t: f[0], x: f[1], y: f[2], z: f[3], qx: f[4], qy: f[5], qz: f[6], qw: f[7], state: Math.round(f[8]), crouch: f[9], foot: f[10], lean: f[11], effort: f[12], dive: f[13] };
}

function onRemoteEvent(id, e) {
  const p = net && net.peers.get(id);
  const name = p ? p.name : 'Someone';
  const pos = remote.positionOf(id);
  if (e.k === 'trick' && TRICK_NAMES[e.kind]) {
    hud.feed(`${name}: ${TRICK_NAMES[e.kind]}!`);
    if (pos) spray.fan(pos.x, pos.y, pos.z, Math.random() - 0.5, Math.random() - 0.5, 1, 0.22);
  } else if (e.k === 'wipe') {
    hud.feed(`${name} wiped out${e.reason ? ` (${String(e.reason).replace(/[!.].*$/, '').toLowerCase()})` : ''}`);
    if (pos) spray.fan(pos.x, pos.y, pos.z, 0, 0, 1, 0.3);
  } else if (e.k === 'air') hud.feed(`${name}: air ${Number(e.t) || 0} s!`);
  else if (e.k === 'hang') hud.feed(`${name}: hang ${e.n === 10 ? 'ten' : 'five'}!`);
  else if (e.k === 'ride' && Number(e.time) >= 4) hud.feed(`${name} rode ${Number(e.time)} s${Number(e.tube) > 0.3 ? ` · barrel ${Number(e.tube)} s` : ''}`);
}

// ---------------------------------------------------------------- camera
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qPart = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const Yaxis = new THREE.Vector3(0, 1, 0);
const focus = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function mix(a, b, t) {
  return a + (b - a) * t;
}

function updateBody(dt) {
  bodyFrame.position.copy(surfer.position);
  bodyFrame.quaternion.copy(surfer.quat);
  const standingish = surfer.state === STATE.STANDING || surfer.state === STATE.POPUP;
  const target = standingish ? 1 : 0;
  const rate = surfer.state === STATE.POPUP ? 1 / 0.42 : 1 / 0.35;
  game.standBlend += clamp(target - game.standBlend, -rate * dt, rate * dt);
}

// The view follows the board heading with a little lag so steering corrections don't jerk
// it. During a manoeuvre the board swings round under a fixed view (you looked where you
// wanted to go), then the view eases back to straight ahead.
function updateCamYaw(dt, inXR) {
  if (game.camYaw === undefined || game.snapCam) {
    game.camYaw = surfer.yaw;
    game.snapCam = false;
  }
  if (surfer.move) game.moveFollow = 0.6;
  if (game.moveFollow > 0) {
    const d = wrap(surfer.yaw - game.camYaw);
    game.camYaw += d;
    if (inXR) xr.rotateFrame(d);
    else game.look.yaw = clamp(game.look.yaw - d, -2.9, 2.9);
    if (!surfer.move) {
      game.moveFollow -= dt;
      if (!inXR) game.look.yaw *= Math.exp(-dt * 5);
    }
    return;
  }
  const d = wrap(surfer.yaw - game.camYaw);
  game.camYaw += d * (1 - Math.exp(-dt * 7));
}

function detectFlickPC(dt, lx) {
  // look turn speed (+ = left) while Shift is held
  const rate = dt > 0 ? (-lx * 0.0024) / dt : 0;
  game.lookRate += (rate - game.lookRate) * (1 - Math.exp(-dt / 0.03));
  const f = game.flick;
  if (f) {
    // keep measuring while the look keeps turning: short fast flick = tailslide, medium = snap,
    // long sweeping look = cutback
    f.t += dt;
    f.sweep += -lx * 0.0024 * f.dir;
    f.peak = Math.max(f.peak, game.lookRate * f.dir);
    if ((f.t > 0.1 && game.lookRate * f.dir < 1.5) || f.t > 0.45) {
      surfer.flick(f.dir, f.peak, f.sweep);
      game.flick = null;
    }
  } else if (pc.charge && surfer.state === STATE.STANDING && !surfer.move && Math.abs(game.lookRate) > 4) {
    game.flick = { dir: Math.sign(game.lookRate), t: 0, sweep: 0, peak: 0 };
  }
}

function updateCameraPC(dt) {
  if (game.freeCam) {
    const [x, y, z, yaw, pitch] = game.freeCam;
    rig.position.set(x, y, z);
    rig.rotation.set(0, 0, 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0, 'YXZ');
    return;
  }
  const [lx0, ly0] = pc.consumeLook();
  const sens = settings.sensitivity;
  const lx = lx0 * sens;
  const ly = ly0 * sens * (settings.invertY ? -1 : 1);
  game.look.yaw = clamp(game.look.yaw - lx * 0.0024, -2.9, 2.9);
  game.look.pitch = clamp(game.look.pitch - ly * 0.0024, -1.35, 1.35);
  detectFlickPC(dt, lx);

  updateCamYaw(dt, false);
  _qYaw.setFromAxisAngle(Yaxis, game.camYaw);
  rig.position.copy(surfer.position);
  rig.quaternion.copy(_qYaw);

  // board orientation relative to the (smoothed) heading frame
  _q.copy(_qYaw).invert().multiply(surfer.quat);
  _e.setFromQuaternion(_q, 'YXZ');
  const b = smoothstep(0, 1, game.standBlend);
  const eye = _v.lerpVectors(eyeProne, eyeStand, b);
  eye.x += surfer.leanX * 0.14 * b;
  eye.z -= (surfer.leanZ * 0.12 + surfer.footPos) * b;
  eye.y -= surfer.crouch * CROUCH_DROP * b;
  // the body stays roughly upright while the board tilts on the face
  _qPart.identity().slerp(_q, mix(0.85, 0.3, b));
  eye.applyQuaternion(_qPart);
  camera.position.copy(eye);

  let pitch = game.look.pitch + _e.x * mix(0.5, 0.22, b) + mix(-0.05, -0.2 - 0.12 * surfer.crouch, b);
  let roll = _e.z * mix(0.3, 0.2, b);
  let yaw = game.look.yaw;
  if (surfer.state === STATE.WIPEOUT) {
    const t = surfer.stateTime;
    camera.position.y -= Math.min(1.2, t * 1.4);
    roll += Math.sin(t * 3.1) * 1.2 * Math.min(1, t);
    pitch += Math.sin(t * 2.3) * 0.8 * Math.min(1, t);
  }
  camera.rotation.set(pitch, yaw, roll, 'YXZ');
}

function updateCameraXR(dt) {
  // rig yaw follows the board heading; the calibrated head maps onto the paddling eye point
  updateCamYaw(dt, true);
  const rigYaw = game.camYaw - xr.yaw0;
  rig.rotation.set(0, rigYaw, 0);
  _qYaw.setFromAxisAngle(Yaxis, surfer.yaw);
  const eyeW = _v.copy(eyeProne).applyQuaternion(_qYaw).add(surfer.position);
  const target = surfer.state === STATE.STANDING ? clamp(1.3 - (EYE.prone[1] + Math.max(0, xr.head.y - xr.h0.y)), 0, 0.45) : 0;
  game.vrStandOffset += (target - game.vrStandOffset) * (1 - Math.exp(-dt * 2));
  const h0 = xr.h0.clone().applyAxisAngle(Yaxis, rigYaw);
  rig.position.copy(eyeW).sub(h0);
  rig.position.y += game.vrStandOffset;
  if (surfer.state === STATE.WIPEOUT) rig.position.y -= Math.min(1.2, surfer.stateTime * 1.4);
}

function onResize() {
  if (renderer.xr.isPresenting) return; // the headset sets the size; sessionend calls this again
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  spray.setViewportHeight(renderer.domElement.height);
  underwater.setViewportHeight(renderer.domElement.height);
}
window.addEventListener('resize', onResize);
onResize();

arms.onStroke = (side, effort) => audio.splash(0.5 + 0.5 * effort);
xr.onStroke = (side, effort) => audio.splash(0.5 + 0.5 * effort);

// ---------------------------------------------------------------- start state
model.reset(-62);
surfer.reset(0, LINEUP_Z, 0);
if (params.has('shot')) applyShot(params.get('shot'));

function applyShot(name) {
  // Deterministic views for screenshots / testing (bypasses the menu).
  game.started = true;
  game.mode = 'single';
  game.paused = params.has('freeze');
  game.invulnerable = true;
  menu.hide();
  const w = model.waves[0];
  for (const o of model.waves) o.active = false;
  w.active = true;
  w.peakX = 0;
  w.dir = 1;
  w.height = 2.6;
  w.S = 2.6;
  const setTau = (tau) => {
    w.crestZ0 = WAVE.breakZ + tau * WAVE.speed;
    model._derive(w);
  };
  const zAt = (x, un) => w.crestZ0 + crestOffset(x) + un * w.S;
  game.zAt = zAt;
  if (params.has('tau')) setTau(parseFloat(params.get('tau')));
  if (name === 'lineup') {
    if (!params.has('tau')) setTau(-6.5);
    surfer.reset(4, LINEUP_Z, 0);
  } else if (name === 'barrel') {
    setTau(4.2);
    const x = WAVE.peelSpeed * 4.2 - 9;
    surfer.reset(x, zAt(x, 0.78), -Math.PI / 2 + 0.12);
    surfer.setState(STATE.STANDING);
    surfer.crouch = surfer.legCrouch = 0.6;
    game.standBlend = 1;
    surfer.vx = 8;
  } else if (name === 'shoulder') {
    setTau(4.0);
    const x = WAVE.peelSpeed * 4.0 + 22;
    surfer.reset(x, zAt(x, 1.6), Math.PI / 2 - 0.35);
    game.look.pitch = 0.05;
  } else if (name === 'behind') {
    setTau(3.0);
    surfer.reset(14, zAt(14, -9), Math.PI + 0.25);
  } else if (name === 'paddle') {
    setTau(-2.2);
    surfer.reset(4, LINEUP_Z + 2, Math.PI + 0.3);
  } else if (name === 'duckdive') {
    // facing an incoming broken wave
    setTau(2.2);
    surfer.reset(6, zAt(6, 2.2), 0.15);
  } else if (name === 'beach') {
    setTau(1);
    surfer.reset(0, 60, Math.PI);
    game.look.pitch = 0.05;
  } else if (name === 'boards') {
    // both boards floating side by side (menu art)
    setTau(-14);
    surfer.reset(0.42, -30, 0);
    const other = createBoard(boardType === 'longboard' ? 'shortboard' : 'longboard');
    other.position.set(-0.42, model.heightAt(-0.42, -30.2), -30.2);
    scene.add(other);
    arms.group.visible = false;
    game.hideArms = true;
  }
  game.snapCam = true;
  if (params.has('cam')) game.freeCam = params.get('cam').split(',').map(Number);
  if (params.has('pitch')) game.look.pitch = parseFloat(params.get('pitch'));
  if (params.has('lookyaw')) game.look.yaw = parseFloat(params.get('lookyaw'));
  if (params.has('stand')) {
    surfer.setState(STATE.STANDING);
    game.standBlend = 1;
  }
  if (params.has('crouch')) surfer.crouch = surfer.legCrouch = parseFloat(params.get('crouch')) || 1;
  if (params.has('foot')) surfer.footPos = parseFloat(params.get('foot'));
  if (params.has('dive')) {
    const d = parseFloat(params.get('dive')) || 1.1;
    surfer.diving = true;
    surfer.diveDepth = d;
    surfer.y -= d;
    surfer.updatePose(1);
  }
  if (params.has('bots')) spawnBots(parseInt(params.get('bots'), 10) || 3);
  if (params.has('wave2')) {
    // a second wave of the set further out (menu art)
    const w2 = model.waves[1];
    Object.assign(w2, { active: true, peakX: -12, dir: -1, height: 2.4, S: 2.4, crestZ0: parseFloat(params.get('wave2')) });
    model._derive(w2);
  }
  model.spawn = () => w; // keep the scene stable
}

// Debug / menu-art bots: fake remote surfers driven locally (?bots=N). They sit in a fan
// in front of the camera: [sideways (m), ahead (m), heading relative to ours, paddling].
function spawnBots(n) {
  const names = ['Kai', 'Mia', 'Leo', 'Nalu', 'Ivy', 'Tao', 'Remy', 'Zoe'];
  const spots = [
    [-2.1, 4.2, 2.6, 0.0],
    [2.6, 6.5, -0.5, 0.8],
    [-5.5, 10, 0.4, 0.6],
    [6.5, 13, 3.0, 0.0],
    [-10, 18, 0.2, 0.9],
    [12, 22, -0.3, 0.4],
  ];
  const fx = -Math.sin(surfer.yaw),
    fz = -Math.cos(surfer.yaw);
  game.bots = [];
  for (let i = 0; i < n; i++) {
    const id = `bot${i}`;
    const [side, ahead, dyaw, effort] = spots[i % spots.length];
    remote.setInfo(id, { name: names[i % names.length], board: i % 3 === 1 ? 'longboard' : 'shortboard' });
    game.bots.push({ id, x: surfer.x + fx * ahead - fz * side, z: surfer.z + fz * ahead + fx * side, yaw: surfer.yaw + dyaw, effort });
  }
}

const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
function updateBots() {
  for (const b of game.bots) {
    const e = 0.06;
    const y = model.heightAt(b.x, b.z);
    const gx = (model.heightAt(b.x + e, b.z) - model.heightAt(b.x - e, b.z)) / (2 * e);
    const gz = (model.heightAt(b.x, b.z + e) - model.heightAt(b.x, b.z - e)) / (2 * e);
    _be.set(Math.atan(gz) * 0.8 + 0.03, b.yaw, -Math.atan(gx) * 0.8, 'YXZ');
    _bq.setFromEuler(_be);
    remote.push(b.id, { t: model.time, x: b.x, y, z: b.z, qx: _bq.x, qy: _bq.y, qz: _bq.z, qw: _bq.w, state: POSE.PRONE, crouch: 0, foot: 0, lean: 0, effort: b.effort, dive: 0 });
  }
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let fpsAcc = 0,
  fpsFrames = 0,
  fps = 0;
const NO_INPUT = { paddle: 0, pulse: 0, turn: 0, steer: 0, leanX: 0, leanZ: 0, walk: 0, walkTo: null, crouch: 0, duck: false, charge: false };

function frame(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const inXR = renderer.xr.isPresenting;
  if (game.onFrame) game.onFrame(dt);
  // behind the opaque menu nothing is visible: don't simulate or render
  const hidden = menu.opaque && !inXR && game.warmup <= 0 && !game.started;
  if (hidden) return;
  game.warmup--;
  // multiplayer keeps the shared world moving even while the menu is open
  const running = game.started && (!game.paused || game.mode === 'multi');
  const acceptInput = game.started && !game.paused;
  let inp = NO_INPUT;
  pc.update(dt);

  if (inXR) {
    const gestures = xr.update(dt, xrFrame, surfer.state, surfer.board);
    if (acceptInput) inp = gestures;
    for (const e of xr.consumeEvents()) {
      if (e === 'pause') vrMenu.open ? closeVRMenu() : game.started && openVRMenu();
      else if (!acceptInput) continue; // the headset menu is open
      else if (typeof e === 'object' && e.flick) surfer.flick(e.flick, e.omega, e.sweep);
      else if (e === 'recalibrate') {
        xr.calibrate();
        hud.toast('Calibrated paddling position', 2);
      } else if (e === 'reset') respawn(true);
      else if (e === 'popUp') surfer.popUp();
      else if (e === 'layDown') surfer.layDown();
      else if (e === 'toggleStand') surfer.state === STATE.PRONE ? surfer.popUp() : surfer.layDown();
    }
  } else if (acceptInput) {
    const steer = pc.steer;
    inp = {
      paddle: pc.paddle,
      pulse: 0,
      turn: 0,
      steer,
      leanX: steer,
      leanZ: pc.leanZ,
      walk: pc.leanZ,
      walkTo: null,
      crouch: pc.down('crouch') ? 1 : 0,
      duck: pc.down('duck') && surfer.state === STATE.PRONE,
      charge: pc.charge,
    };
    for (const e of pc.consumeEvents()) {
      if (e === 'toggleStand') {
        if (surfer.state === STATE.PRONE) surfer.popUp();
        else surfer.layDown();
      } else if (e === 'reset') respawn(true);
    }
  }

  if (running) {
    model.update(dt);
    const paddling = !inXR && acceptInput && surfer.state === STATE.PRONE;
    const pulse = arms.update(dt, paddling, inp.paddle, surfer.diving);
    if (!inXR) inp = { ...inp, pulse };
    surfer.update(dt, inp);
    updateGame(dt);
  } else arms.update(0, false);

  updateBody(dt);
  arms.group.visible = !inXR && !game.hideArms && surfer.state === STATE.PRONE && game.standBlend < 0.05;
  if (inXR) updateCameraXR(dt);
  else updateCameraPC(dt);

  rig.updateMatrixWorld(true);
  // the head. (In VR three.js keeps `camera` on the head pose inside the rig; the XR camera's
  // own world position is only rig-relative here, between renders.)
  camera.getWorldPosition(focus);
  vrMenu.update();
  ocean.update(focus);
  spray.update(running ? dt : 0, focus);

  // ---- other surfers
  if (game.mode === 'multi' && net && net.room) {
    game.poseTimer -= dt;
    if (game.poseTimer <= 0 && game.started) {
      game.poseTimer = 1 / MULTIPLAYER.poseHz;
      sendPose();
    }
    remote.update(net.now(), focus, dt);
    hud.setPlayers(`${net.peers.size + 1} surfer${net.peers.size ? 's' : ''} · ${net.roomInfo.name}`);
  } else if (game.bots) {
    updateBots();
    remote.update(model.time, focus, dt);
  }

  // ---- water around the body, and is the camera under it?
  const hBoard = model.heightAt(surfer.x, surfer.z);
  waterUniforms.uWaterY.value = hBoard;
  waterUniforms.uWaterGrad.value.set(surfer._gx || 0, surfer._gz || 0);
  waterUniforms.uWaterP.value.set(surfer.x, surfer.z);
  waterUniforms.uUWTime.value = model.time;
  const hCam = model.heightAt(focus.x, focus.z);
  const camDepth = hCam - focus.y;
  const camUnder = camDepth > 0.03;
  waterUniforms.uCamUnder.value = camUnder ? 1 : 0;
  ocean.uniforms.uCamUnder.value = camUnder ? 1 : 0;
  terrain.visible = !camUnder; // land is only visible through the surface from below
  const gx = surfer._gx || 0,
    gz = surfer._gz || 0;
  const waterY = (x, z) => hBoard + gx * (x - surfer.x) + gz * (z - surfer.z);
  if (running) emitBubbles(dt, camUnder, camDepth);
  underwater.update(running ? dt : 0, focus, camUnder, camDepth, focus.y - seabedY(focus.x, focus.z), waterY, model.time);
  if (camUnder !== game.wasUnder) {
    game.splash = 0.18; // crossing the surface
    game.wasUnder = camUnder;
  }

  // ---- spray off the rail during manoeuvres
  if (surfer.move && running) {
    const m = surfer.move;
    const [fx, fz] = surfer.forward;
    const L = surfer.board.length;
    const ox = -fz * m.dir - fx * 0.5,
      oz = fx * m.dir - fz * 0.5;
    const n = Math.hypot(ox, oz);
    const power = m.kind === 'cutback' ? 0.6 : 1;
    if (m.t < m.dur + m.slide) spray.fan(surfer.x - fx * L * 0.35, surfer.y, surfer.z - fz * L * 0.35, ox / n, oz / n, power, dt);
  }

  // ---- fades: teleports, whitewater flash on wipeouts, surface crossings
  let fadeAlpha = 0;
  let fadeColor = 0x000000;
  if (game.teleport > 0) {
    const before = game.teleport;
    game.teleport -= dt;
    if (before > 0.7 && game.teleport <= 0.7) respawn(false);
    fadeAlpha = Math.max(0, 1 - Math.abs(game.teleport - 0.7) / 0.7);
  }
  if (surfer.state === STATE.WIPEOUT && fadeAlpha < 0.5) {
    fadeColor = 0xcdeee9;
    fadeAlpha = Math.max(fadeAlpha, 0.7 * Math.exp(-surfer.stateTime * 1.6));
  } else if (game.splash > 0 && fadeAlpha < 0.2) {
    fadeColor = 0xbfe9e2;
    fadeAlpha = Math.max(fadeAlpha, game.splash * 2.2);
  }
  game.splash = Math.max(0, game.splash - dt);
  fadeMat.color.setHex(fadeColor);
  fadeMat.opacity = fadeAlpha;
  fade.visible = fadeAlpha > 0.001;

  // ---- audio: roar from breaking sections near the listener
  let roar = 0;
  for (const w of model.waves) {
    if (!w.active || w.tau < 0) continue;
    const peelX = w.peakX + w.dir * WAVE.peelSpeed * w.tau;
    const dx = Math.max(0, Math.abs(focus.x - peelX) - 15);
    const dz = Math.abs(focus.z - w.crestZ0);
    roar += (w.H / 2.6) * 30 / (30 + dx + dz * 1.5);
  }
  audio.update(roar, surfer.speed, camUnder);

  // ---- HUD
  let stateLabel = { prone: 'Paddling', popup: 'Popping up', standing: 'Surfing', wipeout: 'Wipeout!' }[surfer.state];
  if (surfer.diving) stateLabel = 'Duck diving';
  else if (surfer.air) stateLabel = 'Airborne';
  else if (surfer.state === STATE.STANDING && surfer.crouch > 0.5) stateLabel = 'Surfing · crouched';
  let warn = '';
  if (surfer.state === STATE.STANDING && surfer.ceiling < 2.1 && surfer.crouch < 0.65) warn = inXR ? 'Crouch!' : `Crouch! (${controls.pcKey('crouch')})`;
  const B = surfer.board;
  let dbg = '';
  if (debug) {
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 0.5) {
      fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    const s = surfer.s;
    dbg = `${fps.toFixed(0)} fps | x ${surfer.x.toFixed(1)} z ${surfer.z.toFixed(1)} | un ${s.un?.toFixed(2)} yb ${s.yb?.toFixed(2)} b ${s.b?.toFixed(2)} k ${s.kappa?.toFixed(2)} H ${s.H?.toFixed(2)} | v ${surfer.speed.toFixed(2)} pitch ${((surfer.effPitch * 180) / Math.PI).toFixed(0)}° ceil ${surfer.ceiling.toFixed(2)}`;
  }
  if (game.mode !== 'multi') hud.setPlayers('');
  hud.update(
    dt,
    {
      visible: game.started && (!game.paused || inXR) && !menu.isOpen,
      stateLabel,
      speed: surfer.speed,
      waveLabel: nextWaveInfo(),
      inTube: surfer.inTube,
      warn,
      paddle: surfer.state === STATE.PRONE && !surfer.diving ? surfer.paddleEffort : null,
      foot: B.walk && surfer.state === STATE.STANDING ? (surfer.footPos - B.footMin) / (B.footMax - B.footMin) : null,
      debug: dbg,
    },
    inXR && !vrMenu.open,
  );

  renderer.render(scene, camera);
}

function emitBubbles(dt, camUnder, camDepth) {
  const R = Math.random;
  // pushing the board under: bubbles stream off the rails and hands
  if (surfer.diving && surfer.diveRate > 0.2) {
    const [fx, fz] = surfer.forward;
    let n = 70 * dt * surfer.diveRate + R();
    while (n-- >= 1) {
      const a = (R() - 0.5) * surfer.board.length;
      underwater.bubble(surfer.x + fx * a + (R() - 0.5) * 0.5, surfer.y - 0.05, surfer.z + fz * a + (R() - 0.5) * 0.5, (R() - 0.5) * 0.6, 0.2, (R() - 0.5) * 0.6, 0.006 + R() * 0.02, 1 + R());
    }
  }
  // whitewater overhead churns clouds of bubbles down around you
  if (camUnder) {
    const s = surfer.s;
    const churn = s.wave ? s.kappa * smoothstep(-1.5, 0.3, s.un) * smoothstep(3, 1.2, s.un) : 0;
    let n = (8 + 160 * churn) * dt + R();
    while (n-- >= 1) {
      underwater.bubble(focus.x + (R() - 0.5) * 6, focus.y + R() * Math.max(0.2, camDepth) - 0.4 - churn * R() * 1.5, focus.z + (R() - 0.5) * 6, (R() - 0.5) * 0.6, -churn * R() * 1.2, (R() - 0.5) * 0.6, 0.005 + R() * R() * 0.03, 1 + R() * 1.5);
    }
  }
}

function waveLabelFor(w) {
  return w.dir > 0 ? 'left' : 'right'; // +x is the surfer's left when facing the beach
}

function nextWaveInfo() {
  if (surfer.state === STATE.WIPEOUT) return '';
  if (surfer.state !== STATE.PRONE) {
    const r = game.ride;
    return r ? `Ride ${r.time.toFixed(1)} s${r.tube > 0.1 ? ` · barrel ${r.tube.toFixed(1)} s` : ''}` : '';
  }
  if (surfer.diving) return 'Release to surface';
  if (surfer.catching) return renderer.xr.isPresenting ? 'Caught it! Stand up before it goes vertical' : `Caught it! Pop up (${controls.pcKey('popup')}) before it goes vertical`;
  let best = null;
  for (const w of model.waves) {
    if (!w.active) continue;
    const t = (surfer.z - w.crestZ0) / WAVE.speed;
    if (t > 0 && (!best || t < best.t)) best = { t, w };
  }
  if (!best) return '';
  if (best.t < 3) return 'Paddle hard! (scroll fast)';
  return `Next wave ${Math.ceil(best.t)} s · ${best.w.height.toFixed(1)} m ${waveLabelFor(best.w)}`;
}

renderer.setAnimationLoop(frame);

// test / automation hook
window.__surf = {
  THREE,
  renderer,
  scene,
  camera,
  model,
  surfer,
  game,
  ocean,
  pc,
  arms,
  xr,
  underwater,
  remote,
  menu,
  vrMenu,
  rig,
  STATE,
  respawn,
  setBoardType,
  startGame,
  ensureNet,
  get net() {
    return net;
  },
  begin: () => startGame('single', 'pc'),
};
document.body.classList.add('ready');
