import * as THREE from 'three';
import { QUALITY, SUN_DIR, SUN_COLOR, EYE, WAVE, BOARDS, CROUCH_DROP, MULTIPLAYER, TIMES_OF_DAY, sunsetSun } from './config.js';
import { WaveModel, smoothstep, clamp, crestOffset, waveScale, applySpotWave, peelPoints } from './wave.js';
import { Ocean } from './ocean.js';
import { createSky } from './sky.js';
import { createTerrain, seabedY, setLandSpot, spotCollider } from './terrain.js';
import { SPOTS, cleanSpot } from './spots.js';
import { reefTexture } from './teahupoo.js';
import { createWaterNormalTexture, createNoiseTexture } from './textures.js';
import { createBoard, railHalfWidth } from './board.js';
import { Arms, setSkinColor } from './body.js';
import { Spray } from './spray.js';
import { SpraySheets } from './spraysheet.js';
import { Surfer, STATE } from './surfer.js';
import { Bumps } from './bump.js';
import { PCInput } from './input.js';
import { XRControls } from './xr.js';
import { OceanAudio } from './audio.js';
import { Hud } from './hud.js';
import { waterUniforms, addUnderwaterPass, addUnderwaterFog, UnderwaterEnv } from './underwater.js';
import { Menu } from './menu.js';
import { RemotePlayers, POSE, POSE_DELAY } from './remote.js';
import { ReplayBuffer, REPLAY_SECONDS, F as RF } from './replay.js';
import { VRMenu } from './vrmenu.js';
import { controls } from './bindings.js';
import { Drone, createDroneModel, animateDrone } from './drone.js';
import { loadSurferModel, randomLook } from './character.js';
import { Fish } from './fish.js';
import { loadEisbach, eisbachSite, eisbachGroup } from './eisbach.js';
import { River } from './river.js';
import { Walker } from './walker.js';
import { cleanLean, cleanPad, cleanTilt } from './lean.js';
import { GamepadInput } from './gamepad.js';
import { TouchInput } from './touch.js';

const params = new URLSearchParams(location.search);
const isMobileXR = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
// phones and tablets: touch controls, and the lighter graphics by default
const isTouchDevice = !isMobileXR && (navigator.maxTouchPoints || 0) > 0 && window.matchMedia('(pointer: coarse)').matches;
let savedQuality = 'auto';
try {
  savedQuality = JSON.parse(localStorage.getItem('lineup.settings') || '{}').quality || 'auto';
} catch (e) {
  /* storage unavailable */
}
const qualityName = params.get('q') || (savedQuality !== 'auto' ? savedQuality : isMobileXR || isTouchDevice ? 'low' : 'high');
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
let sky = createSky(renderer, SUN_DIR, quality.cubeSize);
scene.background = sky.cube;
scene.environment = sky.env;
scene.environmentIntensity = 0.9;

const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_COLOR), 2.6);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xa9c8e8, 0x6f8f80, 0.9);
scene.add(hemi);
scene.fog = new THREE.Fog(0xb4cbe0, 600, 7000);

const model = new WaveModel();
const normalTex = createWaterNormalTexture(256);
const noiseTex = createNoiseTexture(512);
waterUniforms.uUWNoise.value = noiseTex;
const ocean = new Ocean(model, sky.cube, normalTex, noiseTex, quality);
scene.add(ocean.mesh);
const underwater = new UnderwaterEnv(noiseTex, SUN_DIR, qualityName);
scene.add(underwater.group);
const fish = new Fish(); // (sometimes, when you go under in the ocean)
scene.add(fish.mesh);

// ---------------------------------------------------------------- surf spot
// The spot being played: its wave, seabed, water and land. Each spot's land is built the
// first time it's needed and kept.
let spot = null;
let terrain = null;
const lands = {};
// The Eisbach: its river (made once the model has loaded) and you on foot on its banks
let river = null;
let eisbachLoad = null;
const walker = new Walker();
function applySpot(id) {
  id = cleanSpot(id);
  if (spot && spot.id === id) return;
  spot = SPOTS[id];
  applySpotWave(spot);
  setLandSpot(id);
  const reef = id === 'teahupoo' ? reefTexture().texture : null;
  ocean.setSpot(id, reef);
  underwater.setWater(spot.water, !!reef || !!spot.river); // (a reef, a river's bed: seabeds of their own)
  if (terrain) {
    scene.remove(terrain);
    if (terrain.userData.underwater) scene.remove(terrain.userData.underwater);
  }
  terrain = lands[id] ||= buildLand(id);
  scene.add(terrain);
  surfer.collide = spotCollider(); // (a pool's walls and pier; a river's banks)
  fish.setKind(spot.fish);
  // a river: no sea, and its own water (once the model has loaded: until then, Play waits)
  ocean.mesh.visible = !spot.river;
  model.setRiver(spot.river ? river : null);
  if (spot.river && !river) startEisbachLoad();
  else menu.setSpotLoading(null);
  if (terrain.userData.underwater) scene.add(terrain.userData.underwater);
  if (!model.schedule) model.reset(-62);
  applyTimeOfDay(timeOfDay); // (the sunset is somewhere else here)
  game.warmup = Math.max(game.warmup, 4); // compile the new shaders behind the menu
}
// The Eisbach's model is big: it's only fetched (and its Draco geometry decoded) when someone
// picks the spot. Play waits for it.
function startEisbachLoad() {
  if (eisbachLoad) return;
  const say = (f) => menu.setSpotLoading(f < 1 ? `Loading the Eisbach… ${Math.round(f * 100)}%` : 'Unpacking the Eisbach…');
  say(0);
  eisbachLoad = loadEisbach(say)
    .then((site) => {
      river = new River(site.channel, inRoom() ? net.waves.height : model.heights.height);
      eisbachGroup.add(river.build({ env: sky.cube, normalTex, noiseTex, rows: site.waterRows, ground: site.solidModel }));
      riverLight();
      if (spot && spot.river) {
        model.setRiver(river);
        if (model.schedule) model.setSchedule(model.schedule.seed, model.schedule.clock, model.schedule.heights);
      }
      menu.setSpotLoading(null);
      game.warmup = Math.max(game.warmup, 4); // (compile its shaders behind the menu)
    })
    .catch((e) => {
      console.warn('LINEUP: could not load the Eisbach', e);
      eisbachLoad = null;
      menu.setSpotLoading(`Couldn't load the Eisbach: ${e.message || e}. Pick it again to retry.`, true);
    });
}

// the river's water in this light
function riverLight() {
  if (!river || !river.uniforms) return;
  const T = TIMES_OF_DAY[timeOfDay] || TIMES_OF_DAY.day;
  river.uniforms.uEnv.value = sky.cube;
  river.setLight(sunDir, new THREE.Vector3(...T.sunColor).multiplyScalar(T.waterSun), new THREE.Vector3(...T.skyAmb));
}

// Build the other spots' land while the player is still in the menus, so picking one (or
// joining a room there) doesn't stall.
function prebuildLands() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  for (const id of Object.keys(SPOTS))
    idle(() => {
      if (!lands[id] && !game.started && !SPOTS[id].river) lands[id] = buildLand(id);
    });
}
setTimeout(prebuildLands, 4000);

function buildLand(id) {
  const g = createTerrain(id, qualityName);
  const under = g.userData.underwater; // seen only from under the water
  if (under) {
    under.traverse((o) => o.isMesh && addUnderwaterFog(o.material));
    under.visible = false;
  }
  return g;
}

// board + body share the board frame
const bodyFrame = new THREE.Group();
const arms = new Arms();
bodyFrame.add(arms.group);
scene.add(bodyFrame);
let board = null;
let boardType = 'shortboard';
const eyeProne = new THREE.Vector3(...EYE.prone);
const eyeStand = new THREE.Vector3(...EYE.standing);
const eyeSit = new THREE.Vector3(...EYE.sitting);

const spray = new Spray(model, quality.particles);
scene.add(spray.points);
// sheets of water off the board (high quality): the bow wave along each front rail as you
// paddle in, and the fan off the tail in a turn
const sheets = quality.sheets ? new SpraySheets() : null;
if (sheets) scene.add(sheets.group);
const BOW_LOOK = { scale: [4, 4], churn: 1 };
const FAN_LOOK = { scale: [7, 1], churn: 0 };
const bowSheets = sheets ? [sheets.stream(48, 10, 0.045, BOW_LOOK), sheets.stream(48, 10, 0.045, BOW_LOOK)] : [];
const tailFan = sheets ? [sheets.stream(120, 9, 0.035, FAN_LOOK), sheets.stream(120, 9, 0.035, { scale: [7, 1.3], churn: 0 })] : [];
const remote = new RemotePlayers(scene, model);
// fetch the character early (other players, the menu preview, and your own first-person arms)
loadSurferModel()
  .then((g) => {
    scene.add(arms.setModel(g).group);
    addUnderwaterPass(arms.rig.mesh); // (seen through the water as they paddle)
  })
  .catch(() => {});

// spectator camera drone (multiplayer): the flight model, and the body you see if you look up
const drone = new Drone();
const droneBody = createDroneModel();
droneBody.gimbal.visible = false; // the camera is in there
droneBody.visible = false;
scene.add(droneBody);

// fade sphere for wipeouts and teleports (works in VR too)
const fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false });
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), fadeMat);
fade.renderOrder = 999;
camera.add(fade);

const hud = new Hud(camera);
const audio = new OceanAudio();
const surfer = new Surfer(model);
const bumps = new Bumps(surfer); // bumping into the others (multiplayer, when the room has it on)
const pc = new PCInput(renderer.domElement);
const gamepad = new GamepadInput();
const touch = new TouchInput(renderer.domElement, document.getElementById('touch-ui'));
const xr = new XRControls(renderer, rig);
xr.onHandModel = (m) => addUnderwaterPass(m);

// ---------------------------------------------------------------- game state
const game = {
  mode: null, // 'single' | 'multi' while playing
  role: 'surfer', // or 'drone' (multiplayer spectator)
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
  sitBlend: 0,
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
  onRole: (role) => net && net.setRole(role),
  onLook: (look) => applyLook(look),
  onSpot: (id) => {
    // (after the menu has shown the choice: the first visit builds the scene)
    setTimeout(() => !inRoom() && applySpot(menu.spot), 30);
  },
  onWaves: (cfg) => {
    if (net && net.room) net.setWaves(cfg); // the room's waves, for everyone
    else model.setHeights(cfg);
  },
  onCollide: (on) => net && net.setCollide(on), // (the room's leader)
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
  onReplay: () => {
    if (startReplay()) {
      resume();
      replayToast();
    }
  },
  onEndReplay: () => {
    endReplay();
    menu.setReplay({ can: canReplay(), active: false });
    menu.focusFirst(menu.screens.pause);
  },
  onLineup: () => {
    resume();
    respawn(true);
  },
  onQuit: () => quitToMenu(),
  onCapturePad: (fn) => (gamepad.capture = fn), // (binding a controller button)
  // recalibrate the phone's tilt (from the settings, or the pause screen: then carry on)
  onLevel: (andResume) => {
    TouchInput.askForTilt();
    touch.calibrate();
    if (andResume) {
      resume();
      hud.toast('Tilt recalibrated: the way you hold it now is level', 2.5);
    }
  },
  getTilt: () => touch.tiltNow,
});
let settings = menu.settings;
function applySettings(s) {
  settings = s;
  audio.setVolume(s.volume);
  xr.lean = cleanLean(s.lean);
  gamepad.settings = cleanPad(s.pad);
  const tilt = cleanTilt(s.tilt);
  const turned = tilt.turn !== touch.settings.turn;
  touch.settings = tilt;
  if (turned) touch.calibrate(); // (the tilt directions were turned by hand: apply it now)
  applyTimeOfDay(inRoom() ? net.time : s.time); // a room's time of day is the same for everyone
}
const inRoom = () => !!(net && net.room);

// Midday or sunset: a new sky (background, reflections and image-based light), then the
// sun, the light from the sky, haze and exposure, and the water, underwater and spray.
// (The sunset's bearing belongs to the spot: called again when the spot changes.)
let timeOfDay = 'day'; // the time of day being shown...
let skyKey = `day:${SUN_DIR.map((v) => v.toFixed(3))}`; // ...and what the scene was built with
function applyTimeOfDay(name) {
  if (!TIMES_OF_DAY[name]) name = 'day';
  timeOfDay = name;
  let T = TIMES_OF_DAY[name];
  if (name === 'sunset' && spot && spot.sunset) T = { ...T, sunDir: sunsetSun(spot.sunset) };
  const key = `${name}:${T.sunDir.map((v) => v.toFixed(3))}`;
  if (key === skyKey) return;
  skyKey = key;
  sunDir.set(...T.sunDir);
  const old = sky;
  sky = createSky(renderer, T.sunDir, quality.cubeSize, T.sunset);
  scene.background = sky.cube;
  scene.environment = sky.env;
  scene.environmentIntensity = T.env;
  ocean.uniforms.uEnv.value = sky.cube;
  old.dispose();
  sun.color.setRGB(...T.sunColor);
  sun.intensity = T.sunLight;
  sun.position.copy(sunDir).multiplyScalar(100);
  hemi.color.set(T.hemiSky);
  hemi.groundColor.set(T.hemiGround);
  hemi.intensity = T.hemi;
  scene.fog.color.set(T.fog);
  renderer.toneMappingExposure = T.exposure;
  const u = ocean.uniforms;
  u.uSunDir.value.copy(sunDir);
  u.uSunColor.value.set(...T.sunColor).multiplyScalar(T.waterSun);
  u.uSkyAmb.value.set(...T.skyAmb);
  u.uUWLight.value.set(...T.underwater);
  waterUniforms.uUWLight.value.set(...T.underwater);
  underwater.setSun(T.sunDir, T.underwater);
  spray.material.uniforms.uColor.value.setRGB(...T.spray);
  if (sheets) sheets.setLight(T.spray, sunDir, T.sunColor.map((c) => c * 1.6));
  riverLight();
}
applySettings(settings);
if (params.has('spot')) menu.setSpot(params.get('spot')); // (?spot=teahupoo: testing, not saved)
applySpot(menu.spot);
model.setHeights(menu.waves);

// your look: skin tone on your first-person arms, board colour, and what others see
function applyLook(look) {
  setSkinColor(look.skin);
  if (board) setBoardType(boardType);
  if (net) net.setLook(look);
}
setSkinColor(menu.look.skin);

// in-headset pause menu (the page's menus can't be seen in VR)
const vrMenu = new VRMenu(renderer, rig, camera, {
  onResume: () => closeVRMenu(),
  onLineup: () => {
    closeVRMenu();
    respawn(true);
  },
  onReplay: () => {
    if (!startReplay()) return;
    closeVRMenu();
    replayToast();
  },
  onReplayControl: (c) => {
    replayControl(c);
    vrMenu.go('pause'); // (its labels change)
  },
  onEndReplay: () => {
    endReplay();
    vrMenu.go('pause');
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
  getLean: () => settings.lean,
  setLean: (lean) => menu.setLean(lean, true),
  leanNow: () => xr.leanRaw, // (only while you're standing)
  getDroneVR: () => settings.droneVR,
  setDroneVR: (mode) => menu.setDroneVR(mode, true),
  setCollide: (on) => net && net.setCollide(on),
  info: () => ({
    inRoom: game.mode === 'multi',
    collide: game.mode === 'multi' && net && net.room ? { on: net.collide, leader: net.isLeader } : null,
    drone: game.role === 'drone' || !!game.replay,
    canReplay: canReplay(),
    replay: game.replay ? { playing: game.replay.playing, speed: game.replay.speed } : null,
    subtitle: game.mode === 'multi' && net && net.roomInfo ? roomLine() : 'Singleplayer',
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

// What you're playing with (the last one used): keyboard and mouse, a controller, or touch.
// It picks the hints, the menu's button prompts, the touch buttons, and whether a drone set
// to FPV flies FPV (with a controller, as in VR).
let device = isTouchDevice ? 'touch' : 'kbm';
function setDevice(d) {
  if (d === device) return;
  device = d;
  document.body.dataset.device = d;
  menu.setDevice(d);
  updateHints();
}
document.body.dataset.device = device;
menu.setDevice(device);
menu.setTouchDevice(isTouchDevice);
window.addEventListener('keydown', () => setDevice('kbm'), true);
window.addEventListener('mousemove', (e) => (e.movementX || e.movementY) && !isTouchDevice && setDevice('kbm'));
window.addEventListener('touchstart', () => setDevice('touch'), { capture: true, passive: true });

// on-screen hints follow the key bindings
function updateHints() {
  const el = document.getElementById('hud-hint');
  if (device === 'pad') el.textContent = `${controls.padText('lineup')}: lineup · ${controls.padText('pause')}: menu`;
  else if (device === 'touch') el.textContent = '';
  else el.textContent = `${controls.pcKey('lineup')} lineup · Esc menu`;
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
  board = createBoard(type, menu.look.board);
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
  const L = spot.lineup;
  let w = null;
  for (const c of model.waves) if (c.active && c.crestZ0 < L.z - 6 && (!w || c.crestZ0 > w.crestZ0)) w = c;
  let x = w ? w.peakX + w.dir * L.side : 0;
  // a pool: the peak on whichever side of the pier you're on (either, the first time)
  if (WAVE.mirror) x = (Math.sign(surfer.x) || (Math.random() < 0.5 ? -1 : 1)) * ((w ? w.peakX : WAVE.mirror) - L.side);
  return { x, z: L.z, yaw: 0 };
}

function respawn(fadeOut = true) {
  if (fadeOut) {
    game.teleport = 1.4;
    return;
  }
  if (game.replay) return placeReplayDrone(game.replay.t);
  if (spot && spot.river) {
    // a river: back on the bank (a drone: hovering downstream, looking up at the wave)
    if (game.role === 'drone') drone.reset(0, 5, -13, Math.PI, -0.28);
    else toBank();
    return;
  }
  const s = lineupSpot();
  if (game.role === 'drone') {
    // hovering inside the break, looking out at the faces of the incoming waves
    drone.reset(s.x + (Math.random() * 2 - 1) * 4, 9, 24, 0, -0.32);
    return;
  }
  // spread players out a little along the lineup in multiplayer (clear of each other, if
  // they can bump into each other)
  const spread = game.mode !== 'multi' ? 0 : collisionsOn() ? clearSpread(s.x, s.z) : (Math.random() * 2 - 1) * 6;
  surfer.reset(s.x + spread, s.z, s.yaw);
  bumps.clear();
  game.snapCam = true;
  game.look.yaw = 0;
  game.look.pitch = 0;
  game.ride = null;
  game.missTimer = 0;
}

function startGame(mode, platform) {
  if (mode === 'multi' && (!net || !net.room)) return;
  if (spot && spot.river && !river) return; // (still loading: Play is greyed out until it's there)
  audio.start();
  endReplay();
  replayBuf.clear();
  game.mode = mode;
  game.role = mode === 'multi' ? menu.role : 'surfer';
  if (net) net.setRole(game.role);
  const flying = game.role === 'drone';
  bodyFrame.visible = !flying;
  droneBody.visible = flying;
  if (mode === 'multi') {
    model.setSchedule(net.seed, () => net.now(), net.waves);
    net.setPlaying(true);
  } else {
    applySpot(menu.spot);
    model.clearSchedule();
    model.setHeights(menu.waves);
    model.reset(-62);
    remote.clear();
  }
  game.started = true;
  game.invulnerable = false;
  game.ride = null;
  game.bank = false;
  game.jumpIn = null;
  game.bankSide = 'east';
  spray.clear();
  if (sheets) sheets.clear();
  underwater.clearBubbles();
  respawn(false);
  menu.setInGame(true);
  if (platform === 'vr') {
    menu.hide();
    enterVR(); // must stay synchronous with the click for the browser to allow it
  } else if (platform === 'pc') {
    resume();
    startToast(flying);
  } else menu.hide(); // a VR session that started on its own
}

// how to play, for what you're playing with
function startToast(flying) {
  if (spot && spot.river && !flying) {
    const touchy = device === 'touch';
    const jump = touchy ? 'tap Jump in' : `${device === 'pad' ? controls.padText('popup') : controls.pcKey('popup')} jumps in`;
    const walk = touchy ? 'Drag on the left to walk, on the right to look' : device === 'pad' ? 'Left stick walks, right stick looks' : `${controls.pcKey('forward')} ${controls.pcKey('left')} ${controls.pcKey('back')} ${controls.pcKey('right')} to walk (${controls.pcKey('charge')} runs)`;
    const out = touchy ? 'tap Crouch, then tap it again' : device === 'pad' ? `hold ${controls.padText('crouch')} and let go` : `hold ${controls.pcKey('crouch')} and let go`;
    hud.toast(`The Eisbach. ${walk} · at the edge beside the wave, ${jump} · near a bank, ${out} to jump out onto it`, 8);
    return;
  }
  if (device === 'touch') {
    TouchInput.askForTilt();
    touch.ui.classList.add('guide'); // the zones, for a few seconds
    setTimeout(() => touch.ui.classList.remove('guide'), 6000);
    const tip = window.innerHeight > window.innerWidth ? '<br>Tip: turn the screen sideways to see more of the wave' : '';
    if (flying) hud.toast(`Drag on the left to fly, on the right to turn · ▲ ▼ climb and descend${tip}`, 6);
    else hud.toast(`Swipe down beside the board to paddle · tilt to steer · swipe up on the board to stand${tip}`, 7);
  } else if (device === 'pad') {
    const b = (id) => controls.padText(id);
    if (flying && settings.droneVR === 'fpv') hud.toast('FPV, acro mode. Left stick: throttle (the middle hovers) and yaw · right stick: pitch and roll', 7);
    else if (flying) hud.toast(`Left stick flies · right stick turns and tilts the camera · ${b('paddleR')} / ${b('paddleL')} climb and descend`, 6);
    else hud.toast(`Pull ${b('paddleL')} and ${b('paddleR')} to paddle (faster = harder) · left stick steers · ${b('popup')} to stand up · pull the stick back to sit`, 7);
  } else {
    const k = (id) => controls.pcKey(id);
    if (flying) hud.toast(`${k('forward')} ${k('left')} ${k('back')} ${k('right')} fly · ${k('popup')} up · ${k('crouch')} down · mouse turns and tilts the camera`, 6);
    else hud.toast(`Scroll to paddle (faster = harder) · ${k('left')} / ${k('right')} steer · ${k('popup')} to pop up · ${k('back')} sit up and wait`, 6);
  }
}

function resume() {
  if (!game.started) return;
  audio.start();
  game.paused = false;
  menu.hide();
  pc.enabled = true;
  touch.reset();
  touch.calibrate(); // the way the phone is held now is level
  if (device === 'touch') TouchInput.askForTilt();
  // (a controller can't grab the mouse or go fullscreen: that needs a click or a key)
  if (device !== 'pad') pc.capture(settings.fullscreen, device !== 'touch');
}

function pause() {
  if (!game.started || game.paused || renderer.xr.isPresenting) return;
  game.paused = true;
  pc.enabled = false;
  menu.setInGame(true);
  menu.setReplay({ can: canReplay(), active: !!game.replay });
  menu.show('pause');
}

function quitToMenu() {
  endReplay();
  replayBuf.clear();
  if (game.mode === 'multi') leaveRoom(); // finishes in the background
  game.started = false;
  game.paused = true;
  game.mode = null;
  game.role = 'surfer';
  bodyFrame.visible = true;
  droneBody.visible = false;
  audio.drone(0, 0);
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
  if (game.started && !game.paused && !pc.locked && !renderer.xr.isPresenting && device !== 'touch') pc.requestLock();
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
  if (game.role === 'drone') {
    if (settings.droneVR === 'fpv') hud.toast(`FPV, acro mode. Left stick: throttle (the middle hovers) and yaw · right stick: pitch and roll. ${press('pause')}: menu.`, 8);
    else hud.toast(`Left stick: climb and turn · right stick: fly · look around to aim the camera. ${press('pause')}: menu.`, 7);
    return;
  }
  if (spot && spot.river) {
    hud.toast(`The Eisbach: stand up. Left stick walks, right stick turns. At the edge beside the wave, ${press('popup')} jumps in. ${press('pause')}: menu.`, 8);
    return;
  }
  const calibrate = controls.quest.recalibrate === 'none' ? 'Lie or kneel down to start.' : `Lie or kneel down, then press ${press('recalibrate')} to calibrate.`;
  hud.toast(`${calibrate} Paddle with your arms, stand up to surf. ${press('pause')}: menu.`, 7);
});
renderer.xr.addEventListener('sessionend', () => {
  vrMenu.hide();
  menu.setReplay({ can: canReplay(), active: !!game.replay });
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
    hud.callout(TRICK_NAMES[data.kind], '+40');
    audio.whoosh(data.kind === 'cutback' ? 0.8 : 1);
    if (game.ride) game.ride.tricks.push(data.kind);
    sendEvent({ k: 'trick', kind: data.kind, dir: data.dir });
  } else if (type === 'air') {
    hud.callout('Air!', `${data.time.toFixed(1)} s · +40`);
    if (game.ride) game.ride.tricks.push('air');
    sendEvent({ k: 'air', t: Math.round(data.time * 10) / 10 });
  } else if (type === 'takeoff') {
    audio.splash(0.6);
    if (spot && spot.river && river) riverExitJump();
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
  const best = !game.best || score > game.best;
  if (best) game.best = score;
  const title = { wipeout: 'Ride over', kickout: 'Nice kick-out!', closeout: 'Closed out' }[reason] || 'Ride over';
  setTimeout(() => hud.rideCard(title, score, parts, best && score > 120), reason === 'wipeout' ? 3000 : 0);
  sendEvent({ k: 'ride', time: Math.round(r.time * 10) / 10, tube: Math.round(r.tube * 10) / 10, score });
}

// What your board is doing to the water this frame. The spray off it all comes from this,
// whether it's you now or a replay. position / quat / vel: the board; fx, fz: its heading;
// type, L: which board; drop: how hard the nose drives in as you drop (0..1); bow: the bow
// wave as you paddle in (0..1); turn, side: the fan out of a turn (0..1; side +1 turning
// left); move, moveDir: a snap, cutback or tailslide throwing spray off the rail.
const boardFx = { position: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), fx: 0, fz: -1, type: 'shortboard', L: 1.86, drop: 0, bow: 0, turn: 0, side: 0, move: 0, moveDir: 0 };

// ...from you, now
function liveBoardFx(out = boardFx) {
  const s = surfer.s;
  const st = surfer.state;
  out.position.copy(surfer.position);
  out.quat.copy(surfer.quat);
  out.vel.set(surfer.vx, surfer.vy, surfer.vz);
  [out.fx, out.fz] = surfer.forward;
  out.type = boardType;
  out.L = surfer.board.length;
  // dropping in: the nose knifes down the face (lying down too, once you're caught)
  const up = st === STATE.STANDING || st === STATE.POPUP;
  out.drop = 0;
  if (!surfer.air && s.wave && (up || surfer.catching) && s.un >= -0.2 && s.un <= 1.8) {
    const down = Math.max(0, -surfer.vy); // m/s down the face
    const steep = Math.max(surfer.effPitch, Math.atan(down / Math.max(1, surfer.planeSpeed)));
    out.drop = smoothstep(3.5, 9, surfer.planeSpeed) * smoothstep(0.1, 0.45, steep) * (up ? 1 : 0.6);
  }
  const ok = !surfer.air && !surfer.diving && surfer.turtle === 0 && (st === STATE.PRONE || st === STATE.POPUP || st === STATE.STANDING);
  // the bow wave: going fast through the water lying down, or the nose driving in on the drop
  const rel = Math.hypot(surfer.vx, surfer.vz - (s.waterVz || 0));
  out.bow = !ok ? 0 : st === STATE.STANDING ? out.drop * 0.75 : smoothstep(2.8, 5, rel);
  // the fan out of a turn (a carve throws a smaller one than a snap, cutback or tailslide)
  out.turn = 0;
  out.side = 0;
  out.move = 0;
  out.moveDir = 0;
  const m = surfer.move;
  if (ok && st === STATE.STANDING) {
    out.turn = 0.6 * smoothstep(4, 12, Math.abs(surfer.yawRate) * surfer.planeSpeed) * smoothstep(3, 6, surfer.planeSpeed);
    out.side = Math.sign(surfer.yawRate);
    if (m && m.t < m.dur + m.slide) {
      out.turn = Math.max(out.turn, (m.kind === 'cutback' ? 0.75 : 1) * smoothstep(2, 5, surfer.planeSpeed));
      out.side = m.dir;
    }
  }
  if (m && m.t < m.dur + m.slide) {
    out.move = m.kind === 'cutback' ? 0.6 : 1;
    out.moveDir = m.dir;
  }
  return out;
}

// All the spray off the board
function boardSpray(b, dt) {
  noseSpray(b, dt);
  // off the rail in a snap, cutback or tailslide
  if (b.move) {
    const ox = -b.fz * b.moveDir - b.fx * 0.5,
      oz = b.fx * b.moveDir - b.fz * 0.5;
    const n = Math.hypot(ox, oz);
    spray.fan(b.position.x - b.fx * b.L * 0.35, b.position.y, b.position.z - b.fz * b.L * 0.35, ox / n, oz / n, b.move, dt);
  }
  boardSheets(b, dt);
}

// Dropping in: the nose knifes down the face and throws white water off both sides of it,
// more the faster and steeper you go (and when you're caught and sliding down lying down).
function noseSpray(b, dt) {
  const power = b.drop;
  if (power <= 0.01) return;
  const { fx, fz, L } = b;
  const { x: vx, y: vy, z: vz } = b.vel;
  const nx = b.position.x + fx * L * 0.42,
    nz = b.position.z + fz * L * 0.42,
    ny = model.heightAt(nx, nz) + 0.05;
  const R = Math.random;
  let n = 900 * (spray.max / 1600) * power * dt + R();
  while (n-- >= 1) {
    const side = R() < 0.5 ? -1 : 1;
    const out = 0.6 + R() * 1.8 * power; // out to the side
    // thrown on ahead with the board (down the face too: the sheets of white water carry on a
    // moment before the board runs through them), so you see it from where you stand
    const clump = R() < 0.35; // soft clumps of white water among the droplets
    const k = 1 + R() * 0.3,
      fwd = R() * 1.5;
    const along = (R() - 0.3) * L * 0.25;
    spray.emit(
      nx - fx * along + (R() - 0.5) * 0.1,
      ny,
      nz - fz * along + (R() - 0.5) * 0.1,
      vx * k + fx * fwd - fz * side * out,
      vy * k + 1.2 + R() * 2 * power,
      vz * k + fz * fwd + fx * side * out,
      0.45 + R() * 0.5,
      clump ? 0.07 + R() * 0.09 : 0.02 + R() * R() * 0.035,
      clump ? 0.7 : 1.3,
    );
  }
}

// Sheets of water off the board (high quality).
// - The bow wave: lying down and going fast through the water (paddling into a wave), the
//   nose shoves it up into a churning wall along each front rail; standing, the same as the
//   nose drives in on the drop.
// - The fan: in a hard carve, and in a snap, cutback or tailslide, the tail throws a fan of
//   spray out of the turn (other surfers' too).
const _src = new THREE.Vector3();
const _camVel = new THREE.Vector3();
const _camLast = new THREE.Vector3();
const _vin = new THREE.Vector3();
const _vout = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _re = new THREE.Euler();
// a point on a board's rail: t along it (0 tail, 1 nose), side -1 left / +1 right
function railPoint(t, side, out, pos, quat, type) {
  return out
    .set(side * railHalfWidth(type, t), 0, (0.5 - t) * (BOARDS[type] || BOARDS.shortboard).length)
    .applyQuaternion(quat)
    .add(pos);
}
function sheetFrom(S, p, dt, rate, emit) {
  const prev = S.prev || (S.prev = p.clone());
  S.run(dt, rate, (f) => emit(prev.x + (p.x - prev.x) * f, prev.y + (p.y - prev.y) * f, prev.z + (p.z - prev.z) * f));
  prev.copy(p);
}
// drops thrown along with a sheet's column (somewhere across it, a little scattered), drawn
// as streaks blurred over `blur` seconds
function sheetDrops(x, y, z, n, width, dur, blur) {
  const R = Math.random;
  for (let i = 0; i < n; i++) {
    const f = Math.pow(R(), 0.7),
      j = 0.3 * f;
    sheets.streaks.emit(
      x,
      y,
      z,
      (_vin.x + (_vout.x - _vin.x) * f) * (1 + (R() - 0.5) * j) + (R() - 0.5) * j * 4,
      (_vin.y + (_vout.y - _vin.y) * f) * (1 + (R() - 0.5) * j) + (R() - 0.5) * j * 2,
      (_vin.z + (_vout.z - _vin.z) * f) * (1 + (R() - 0.5) * j) + (R() - 0.5) * j * 4,
      dur * (0.55 + R() * 0.6),
      width * (0.5 + R() * R() * 1.5),
      0.9 + R() * 0.8,
      blur,
    );
  }
}

// The fan out of a turn, from a board at pos / quat moving at vel (heading fx, fz): `turn`
// 0..1 how hard, `side` +1 turning left (the spray goes out to the right) or -1. F is the
// fan's pair of streams (a high, wide curtain and a lower one inside it).
function turnFan(F, dt, turn, side, pos, quat, type, vel, fx, fz) {
  if (turn < 0.05 || !side) {
    for (const S of F) S.idle();
    return null;
  }
  for (const S of F)
    if (side !== S.side) {
      S.idle();
      S.lastT = -1; // (the other way: a new sheet)
      S.side = side;
    }
  const p = railPoint(0.17, side, _src, pos, quat, type);
  p.y = model.heightAt(p.x, p.z) + 0.02;
  const ox = -fz * side,
    oz = fx * side;
  const { x: vx, y: vy, z: vz } = vel;
  for (let k = 0; k < F.length; k++) {
    const S = F[k],
      h = k ? 0.72 : 1; // (the inner curtain: lower and not so far out)
    // out of the turn, up, and a little back
    _vin.set(vx * 0.6 + ox * (1.5 + 3 * turn) * h - fx * 0.6 * turn, vy * 0.5 + (1.2 + 2 * turn) * h, vz * 0.6 + oz * (1.5 + 3 * turn) * h - fz * 0.6 * turn);
    _vout.set(vx * 0.35 + ox * (3 + 5 * turn) * h - fx * 1.4 * turn, vy * 0.3 + (4 + 6 * turn) * h, vz * 0.35 + oz * (3 + 5 * turn) * h - fz * 1.4 * turn);
    sheetFrom(S, p, dt, 80, (x, y, z) => {
      S.emit(x, y, z, _vin, _vout, (0.9 + 0.6 * turn) * (k ? 0.85 : 1), Math.min(1, 0.4 + turn) * (k ? 0.8 : 1), 0.08, 0.5, 1.1);
      sheetDrops(x, y, z, Math.round(turn * 12), 0.026, 1.1, 0.022);
    });
  }
  return p;
}

function boardSheets(b, dt) {
  if (!sheets) return;
  const { vel, fx, fz } = b;
  const rx = -fz,
    rz = fx;
  // the bow wave
  const bow = b.bow;
  for (let k = 0; k < 2; k++) {
    const S = bowSheets[k],
      side = k ? 1 : -1;
    if (bow < 0.04) {
      S.idle();
      continue;
    }
    const ox = rx * side,
      oz = rz * side;
    const p = railPoint(0.87, side, _src, b.position, b.quat, b.type);
    p.x += ox * 0.02;
    p.z += oz * 0.02;
    p.y = model.heightAt(p.x, p.z) + 0.01;
    // up the rail in a wall that falls away outward, trailing back past you
    _vin.set(vel.x * 0.78 + ox * (0.25 + 0.25 * bow), vel.y * 0.8 + 1.2 + 1.6 * bow, vel.z * 0.78 + oz * (0.25 + 0.25 * bow));
    _vout.set(vel.x * 0.62 + ox * (1 + 1.6 * bow), vel.y * 0.7 + 1.5 + 1.9 * bow, vel.z * 0.62 + oz * (1 + 1.6 * bow));
    sheetFrom(S, p, dt, 75, (x, y, z) => {
      S.emit(x, y, z, _vin, _vout, 0.38 + 0.2 * bow, Math.min(1, bow * 1.3), 0.07, 0.8, 2.4);
      sheetDrops(x, y, z, Math.round(bow * 4 * Math.random() + 0.3), 0.007, 0.5, 0.008);
    });
  }
  // the fan out of a turn
  const p = turnFan(tailFan, dt, b.turn, b.side, b.position, b.quat, b.type, vel, fx, fz);
  // loose drops around it in a carve (the moves throw their own: boardSpray)
  if (p && !b.move) spray.fan(p.x, p.y, p.z, -fz * b.side - fx * 0.3, fx * b.side - fz * 0.3, b.turn * 0.35, dt);
}

// Other surfers' fans: how hard they're turning, from their board as it's shown here
const remoteFans = new Map(); // avatar id -> { F, yaw, yawRate, p, v }
const fanPool = [];
function otherSheets(dt) {
  if (!sheets) return;
  for (const [id, m] of remoteFans)
    if (!remote.avatars.has(id)) {
      // (their streams go back to the pool; someone who never turned hard has none)
      if (m.F) {
        for (const S of m.F) S.clear();
        fanPool.push(m.F);
      }
      remoteFans.delete(id);
    }
  if (dt <= 0) return;
  for (const a of remote.avatars.values()) {
    const c = a.cur;
    let m = remoteFans.get(a.id);
    if (!m) remoteFans.set(a.id, (m = { F: null, yaw: null, yawRate: 0, p: new THREE.Vector3(c.x, c.y, c.z), v: new THREE.Vector3() }));
    const yaw = _re.setFromQuaternion(c.q, 'YXZ').y;
    if (m.yaw !== null) {
      const d = Math.atan2(Math.sin(yaw - m.yaw), Math.cos(yaw - m.yaw));
      m.yawRate += (d / dt - m.yawRate) * (1 - Math.exp(-dt * 12));
      const dv = _src.set(c.x - m.p.x, c.y - m.p.y, c.z - m.p.z).divideScalar(dt);
      if (dv.lengthSq() > 900) dv.set(0, 0, 0); // (a jump)
      m.v.lerp(dv, 1 - Math.exp(-dt * 8));
    }
    m.yaw = yaw;
    m.p.set(c.x, c.y, c.z);
    const speed = Math.hypot(m.v.x, m.v.z);
    const up = a.visible && (c.state === POSE.STANDING || c.state === POSE.POPUP);
    // (as yours: a carve throws a smaller fan than the sharper turn of a snap)
    const a2 = Math.abs(m.yawRate) * speed;
    const turn = up ? (0.6 * smoothstep(4, 12, a2) + 0.4 * smoothstep(14, 24, a2)) * smoothstep(3, 6, speed) : 0;
    if (turn < 0.05 && !m.F) continue;
    if (!m.F) m.F = fanPool.pop() || [sheets.stream(100, 9, 0.035, FAN_LOOK), sheets.stream(100, 9, 0.035, FAN_LOOK)];
    turnFan(m.F, dt, turn, Math.sign(m.yawRate), m.p, c.q, a.boardType || 'shortboard', m.v, -Math.sin(yaw), -Math.cos(yaw));
  }
}

function updateGame(dt) {
  const s = surfer.s;
  // ride tracking
  if (surfer.riding && surfer.state === STATE.STANDING) {
    if (!game.ride) startRide();
    const r = game.ride;
    r.time += dt;
    r.top = Math.max(r.top, surfer.planeSpeed);
    if (surfer.inTube) r.tube += dt;
  } else if (game.ride && surfer.state === STATE.STANDING && !surfer.air) {
    const behind = s.un < -0.7 || !s.wave || s.H < 0.6;
    if (behind) endRide(s.un < -0.7 ? 'kickout' : 'over');
  } else if (game.ride && surfer.state === STATE.PRONE) endRide('over');

  // nose riding on the longboard
  const onNose = surfer.board.walk && surfer.state === STATE.STANDING && surfer.footPos > 0.88 && surfer.planeSpeed > 3;
  if (onNose) {
    game.noseT += dt;
    if (game.ride) game.ride.nose += dt;
    if (game.noseT > 0.3 && game.noseCalled < 1) {
      hud.callout('Hang five', 'nose ride');
      sendEvent({ k: 'hang', n: 5 });
      game.noseCalled = 1;
    }
    if (surfer.footPos > 1.06 && game.noseT > 0.6 && game.noseCalled < 2) {
      hud.callout('Hang ten!', 'toes over the nose');
      sendEvent({ k: 'hang', n: 10 });
      game.noseCalled = 2;
    }
  } else if (surfer.footPos < 0.6) {
    game.noseT = 0;
    game.noseCalled = 0;
  }

  // wipeout -> back to the lineup
  if (surfer.state === STATE.WIPEOUT && surfer.stateTime > 2.4 && game.teleport <= 0) respawn(true);
  if (spot.river) return; // (a river: riverRules)

  // drifted inside or far away (or washed up on a beach) without a ride: paddle back out
  const inside = surfer.z > spot.inside.z || Math.abs(surfer.x) > spot.inside.x || surfer.z < -260 || seabedY(surfer.x, surfer.z) > -0.45;
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
      net = new mod.Net({ name: menu.name, board: boardType, role: menu.role, look: menu.look });
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
    const p = n.peers.get(id);
    hud.feed(p && p.role === 'drone' ? `${name} launched a drone` : `${name} paddled out`);
    if (id === failedPeer) menu.setLobbyStatus(''); // got through after all
  });
  n.on('leave', (id, name) => {
    remote.remove(id);
    hud.feed(`${name} left the lineup`);
  });
  n.on('info', (id, p) => remote.setInfo(id, { name: p.name, board: p.board, look: p.look }));
  n.on('pose', (id, f) => remote.push(id, decodePose(f)));
  n.on('event', (id, e) => onRemoteEvent(id, e));
  n.on('collide', (on, by) => {
    bumps.clear();
    updateLobby();
    hud.feed(on ? `${by || 'You'} turned collisions on (experimental): you can bump into each other` : `${by || 'You'} turned collisions off`);
  });
  n.on('timeline', () => {
    roomSettings(n); // (the room's first player may have picked a different spot or time)
    menu.setWaves(n.waves);
    updateLobby(); // (and whether it has collisions on)
    if (n.collide) hud.feed('Collisions are on in this room (experimental): you can bump into each other');
    if (game.mode === 'multi') {
      model.setSchedule(n.seed, () => n.now(), n.waves);
      for (const a of remote.avatars.values()) a.snaps.length = 0;
      spray.clear();
      if (sheets) sheets.clear();
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
  n.on('waves', (w, by) => {
    model.setScheduleHeights(w);
    menu.setWaves(w);
    const what = w.mode === 'random' ? 'random sizes' : `${w.height.toFixed(1)} m`;
    hud.feed(by ? `${by} set the waves to ${what}` : `Waves set to ${what} from the next one`);
  });
  n.on('left', () => {
    failedPeer = null;
    remote.clear();
    menu.leftRoom();
    // back to your own spot and time of day
    applySpot(menu.spot);
    applyTimeOfDay(settings.time);
    if (!game.started) model.setHeights(menu.waves);
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

// Where the room surfs and at what time of day, for everyone in it.
function roomSettings(n) {
  if (!n.room) return;
  applySpot(n.spot);
  if (river && spot.river) river.setHeight(n.waves.height); // (the room's, in the lobby too)
  menu.enterRoom(n.roomInfo);
  applyTimeOfDay(n.time);
}

async function createRoom(opts) {
  try {
    const n = await ensureNet();
    await n.createRoom(opts);
    roomSettings(n);
    menu.setWaves(n.waves);
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
    await n.joinRoom({ id: room.id, name: room.name, isPrivate: room.isPrivate, passcode, hash: room.hash, waves: menu.waves, spot: room.spot, time: room.time });
    roomSettings(n);
    menu.setWaves(n.waves);
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
  const leader = net.leaderId;
  const players = [{ name: net.name, playing: game.mode === 'multi', me: true, role: game.mode === 'multi' ? game.role : menu.role, leader: leader === net.selfId }];
  for (const [id, p] of net.peers) players.push({ name: p.name, playing: p.playing, role: p.role, leader: id === leader });
  menu.renderLobby(net.roomInfo, players);
  menu.setCollide({ on: net.collide, leader: net.isLeader, leaderName: net.leaderName });
}

// "3 surfers · 1 drone · Dawn patrol"
function roomLine() {
  let surfers = game.role === 'drone' ? 0 : 1;
  let drones = 1 - surfers;
  for (const p of net.peers.values()) p.role === 'drone' ? drones++ : surfers++;
  const parts = [`${surfers} surfer${surfers === 1 ? '' : 's'}`];
  if (drones) parts.push(`${drones} drone${drones === 1 ? '' : 's'}`);
  if (net.collide) parts.push('collisions on');
  return `${parts.join(' · ')} · ${net.roomInfo.name}`;
}

function sendEvent(e) {
  if (game.mode === 'multi' && net) net.sendEvent(e);
}

// ---------------------------------------------------------------- bumping into each other
// An experimental mode the room's leader turns on (?bump tries it on the debug ?bots alone).
// bump.js works out each bump; here we gather everyone it could be with, and show what happened.
function collisionsOn() {
  if (game.mode === 'multi') return !!(net && net.room && net.collide);
  return !!game.bots && params.has('bump');
}

// ...and you're a surfer in the water (not flying, on a bank, or fading back to the lineup)
function canBump() {
  return collisionsOn() && game.role !== 'drone' && !game.replay && !game.bank && !game.jumpIn && !(game.teleport > 0);
}

const BUMP_STATE = { [POSE.PRONE]: 'prone', [POSE.POPUP]: 'popup', [POSE.STANDING]: 'standing', [POSE.SITTING]: 'sitting' };
const _bumpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
// the other surfers in the water, as bump.js wants them (not drones, walkers or wipeouts)
function bumpables() {
  const out = [];
  for (const a of remote.avatars.values()) {
    const last = a.snaps[a.snaps.length - 1];
    const state = a.visible && last ? BUMP_STATE[last.state] : null;
    if (!state) continue;
    const c = a.cur;
    _bumpEuler.setFromQuaternion(c.q);
    out.push({ id: a.id, name: a.name, x: c.x, y: c.y, z: c.z, vx: c.vx || 0, vz: c.vz || 0, yaw: _bumpEuler.y, yawRate: c.yawRate || 0, state, board: a.boardType, foot: last.foot || 0, braceX: last.bx || 0, braceZ: last.bz || 0 });
  }
  return out;
}

function bumpOthers(dt) {
  if (!canBump()) return;
  const others = bumpables();
  if (!others.length) return;
  for (const h of bumps.update(dt, others, net ? net.selfId : '')) {
    bumpFx(h);
    // (their game may not have seen it: tell them, and theirs takes its side of it once)
    if (game.mode === 'multi') net.sendEvent(h.tell, h.id);
  }
}

// Another player's game saw them bump you
function bumpFrom(id, e) {
  if (!canBump()) return;
  const v = {};
  for (const k of ['J', 'at', 'side', 'pa', 'ps', 'x', 'z', 'mine', 'theirs', 'closing']) {
    v[k] = Number(e[k]);
    if (!Number.isFinite(v[k])) return;
  }
  if (!(v.J > 0 && v.J < 5000 && Math.abs(v.at) < 3 && Math.abs(v.side) < 2 && Math.hypot(v.pa, v.ps) > 0.5)) return;
  const a = remote.avatars.get(id);
  const hit = bumps.receive(id, a ? a.name : 'another surfer', v);
  if (hit) bumpFx(hit);
}

// a bump: a splash where you touched, a thump, a buzz in your hands, and who ran into whom
const bumpSaid = new Map(); // id -> when we last said so (s)
function bumpFx(h) {
  const s = Math.min(1, h.J / 160); // how hard (160 N s: about a 2 m/s jolt to someone standing)
  spray.fan(h.px, model.heightAt(h.px, h.pz), h.pz, h.nx, h.nz, 0.3 + 0.7 * s, 0.08);
  audio.splash(0.35 + 0.65 * s);
  if (renderer.xr.isPresenting) for (const hand of xr.hands) xr.pulse(hand, 0.3 + 0.7 * s, 40 + 100 * s);
  else if (device === 'touch') navigator.vibrate?.(Math.round(30 + 60 * s));
  else gamepad.rumble(0.3 + 0.7 * s, 60 + 140 * s);
  if (h.off || s < 0.15) return; // (a knock-off says who in the wipeout)
  const now = performance.now() / 1000;
  if (now - (bumpSaid.get(h.id) || -9) < 3) return;
  bumpSaid.set(h.id, now);
  const name = h.name || 'another surfer';
  hud.feed(h.mine > h.theirs ? `You ran into ${name}` : `${name} ran into you`);
}

// Somewhere along the lineup clear of everyone else (with collisions on): the most room of a few tries
function clearSpread(x, z) {
  const others = bumpables();
  let best = 0,
    room = -1;
  for (let i = 0; i < 12; i++) {
    const spread = (Math.random() * 2 - 1) * 8;
    let near = Infinity;
    for (const o of others) near = Math.min(near, Math.hypot(o.x - (x + spread), o.z - z));
    if (near > room) {
      room = near;
      best = spread;
    }
    if (near > 4) break;
  }
  return best;
}

const STATE_CODE = { prone: POSE.PRONE, popup: POSE.POPUP, standing: POSE.STANDING, wipeout: POSE.WIPEOUT, sitting: POSE.SITTING };
// t, position, orientation, state, crouch, foot, lean, effort, dive, look yaw / pitch,
// height above the water, velocity x / z (so others can show you where you are now), and how
// you're bracing for a bump, sideways and along the board
const poseBuf = new Float32Array(21);
function sendPose() {
  if (game.role === 'drone') {
    // same packet; crouch carries the gimbal pitch and effort the throttle
    const q = drone.quat;
    poseBuf.set([net.now(), drone.pos.x, drone.pos.y, drone.pos.z, q.x, q.y, q.z, q.w, POSE.DRONE, drone.camPitch, 0, 0, drone.throttle, 0, 0, 0, 0, drone.vel.x, drone.vel.z, 0, 0]);
    net.sendPose(poseBuf);
    return;
  }
  if (game.bank || game.jumpIn) {
    // on foot: crouch is unused, effort is how fast you're walking; no height above the water
    const q = _wq.setFromAxisAngle(Yaxis, walker.yaw);
    poseBuf.set([net.now(), walker.x, walker.y, walker.z, q.x, q.y, q.z, q.w, POSE.WALK, 0, 0, 0, walker.speed / 3.4, 0, 0, walker.pitch, NaN, walker.vx, walker.vz, 0, 0]);
    net.sendPose(poseBuf);
    return;
  }
  const q = surfer.quat;
  poseBuf[0] = net.now();
  poseBuf[1] = surfer.x;
  poseBuf[2] = surfer.position.y; // (as it's drawn: sitting on the water along its length)
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
  // where you're looking, relative to the board (your character turns its head / body)
  const vr = renderer.xr.isPresenting;
  poseBuf[14] = vr ? xr.lookYaw || 0 : game.look.yaw;
  poseBuf[15] = vr ? xr.lookPitch || 0 : game.look.pitch;
  poseBuf[16] = surfer.position.y - model.heightAt(surfer.x, surfer.z);
  poseBuf[17] = surfer.vx;
  poseBuf[18] = surfer.vz;
  poseBuf[19] = surfer.braceX;
  poseBuf[20] = surfer.braceZ;
  net.sendPose(poseBuf);
}

function decodePose(f) {
  const look = f.length >= 16; // (older clients send 14, 16 or 19 values)
  const pred = f.length >= 19;
  const brace = f.length >= 21;
  return { t: f[0], x: f[1], y: f[2], z: f[3], qx: f[4], qy: f[5], qz: f[6], qw: f[7], state: Math.round(f[8]), crouch: f[9], foot: f[10], lean: f[11], effort: f[12], dive: f[13], lookYaw: look ? f[14] : 0, lookPitch: look ? f[15] : 0, heave: pred ? f[16] : NaN, vx: pred ? f[17] : NaN, vz: pred ? f[18] : NaN, bx: brace ? f[19] : 0, bz: brace ? f[20] : 0 };
}

function onRemoteEvent(id, e) {
  const p = net && net.peers.get(id);
  const name = p ? p.name : 'Someone';
  const pos = remote.positionOf(id);
  if (e.k === 'bump') bumpFrom(id, e);
  else if (e.k === 'trick' && TRICK_NAMES[e.kind]) {
    hud.feed(`${name}: ${TRICK_NAMES[e.kind]}!`);
    if (pos) spray.fan(pos.x, pos.y, pos.z, Math.random() - 0.5, Math.random() - 0.5, 1, 0.22);
  } else if (e.k === 'wipe') {
    const why = String(e.reason || '').replace(/[!.].*$/, '');
    hud.feed(`${name} wiped out${why ? ` (${why.charAt(0).toLowerCase()}${why.slice(1)})` : ''}`);
    if (pos) spray.fan(pos.x, pos.y, pos.z, 0, 0, 1, 0.3);
  } else if (e.k === 'air') hud.feed(`${name}: air ${Number(e.t) || 0} s!`);
  else if (e.k === 'hang') hud.feed(`${name}: hang ${e.n === 10 ? 'ten' : 'five'}!`);
  else if (e.k === 'ride' && Number(e.time) >= 4) hud.feed(`${name} rode ${Number(e.time)} s${Number(e.tube) > 0.3 ? ` · barrel ${Number(e.tube)} s` : ''}`);
  else if (e.k === 'crash') {
    hud.feed(`${name} crashed their drone`);
    if (pos) spray.fan(pos.x, pos.y, pos.z, 0, 0, 0.6, 0.25);
  }
}

// ---------------------------------------------------------------- camera
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qPart = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const Yaxis = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _v2 = new THREE.Vector3();
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
  game.sitBlend += clamp((surfer.state === STATE.SITTING ? 1 : 0) - game.sitBlend, -2 * dt, 2 * dt);
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
  } else if ((pc.charge || touch.charge) && surfer.state === STATE.STANDING && !surfer.move && Math.abs(game.lookRate) > 4) {
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
  const [tx, ty] = touch.consumeLook();
  const sens = settings.sensitivity;
  const lx = lx0 * sens + tx;
  const ly = ly0 * sens * (settings.invertY ? -1 : 1) + ty;
  game.look.yaw = clamp(game.look.yaw - lx * 0.0024, -2.9, 2.9);
  game.look.pitch = clamp(game.look.pitch - ly * 0.0024, -1.35, 1.35);
  // the right stick turns the view at a speed (its tricks are flicks: gamepad.js)
  const [gy, gp] = gamepad.lookRate();
  game.look.yaw = clamp(game.look.yaw + gy * dt, -2.9, 2.9);
  game.look.pitch = clamp(game.look.pitch + gp * dt, -1.35, 1.35);
  // with a controller or a touch screen the view drifts back to straight ahead once you
  // stop looking around (a mouse leaves it where you put it)
  if (lx || ly || gy || gp) game.lookIdle = 0;
  else game.lookIdle = (game.lookIdle || 0) + dt;
  if ((device === 'pad' || device === 'touch') && game.lookIdle > 1.2 && !game.flick) {
    const k = Math.exp(-dt * 1.6);
    game.look.yaw *= k;
    game.look.pitch *= k;
  }
  detectFlickPC(dt, lx);

  updateCamYaw(dt, false);
  _qYaw.setFromAxisAngle(Yaxis, game.camYaw);
  rig.position.copy(surfer.position);
  rig.quaternion.copy(_qYaw);

  // board orientation relative to the (smoothed) heading frame
  _q.copy(_qYaw).invert().multiply(surfer.quatBase); // (the turtle roll is added below)
  _e.setFromQuaternion(_q, 'YXZ');
  const b = smoothstep(0, 1, game.standBlend);
  const sb = smoothstep(0, 1, game.sitBlend);
  const eye = _v.lerpVectors(eyeProne, eyeStand, b).lerp(eyeSit, sb);
  eye.x += surfer.leanX * 0.14 * b;
  eye.z -= (surfer.leanZ * 0.12 + surfer.footPos) * b;
  eye.y -= surfer.crouch * CROUCH_DROP * b;
  // the body stays roughly upright while the board tilts on the face
  _qPart.identity().slerp(_q, mix(mix(0.85, 0.3, b), 0.3, sb));
  eye.applyQuaternion(_qPart);
  camera.position.copy(eye);

  // (sitting, you stay upright as the board's nose lifts)
  let pitch = game.look.pitch + _e.x * mix(mix(0.5, 0.22, b), 0.1, sb) + mix(mix(-0.05, -0.2 - 0.12 * surfer.crouch, b), -0.22, sb);
  let roll = _e.z * mix(0.3, 0.2, b);
  // turtle roll (longboard): you go over with the board, and hang underneath it upside down
  const turtle = surfer.turtleAngle;
  if (turtle > 0) {
    camera.position.applyAxisAngle(_Z, turtle); // (about the board's length: the rig sits on it)
    roll += turtle;
  }
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
  const turtle = surfer.turtleAngle;
  const eyeW = _v.copy(eyeProne).applyAxisAngle(_Z, turtle).applyQuaternion(_qYaw).add(surfer.position);
  if (turtle > 0) {
    // turtle roll: the whole world turns over around your head, about the way you're facing
    // (so you end up under the board, upside down, wherever you're looking)
    const fwd = _v2.set(-Math.sin(xr.yaw0), 0, -Math.cos(xr.yaw0));
    rig.quaternion.setFromAxisAngle(Yaxis, rigYaw).multiply(_qh.setFromAxisAngle(fwd, -turtle));
    rig.position.copy(eyeW).sub(_v2.copy(xr.h0).applyQuaternion(rig.quaternion));
    return;
  }
  const rise = Math.max(0, xr.head.y - xr.h0.y);
  const target = surfer.state === STATE.STANDING ? clamp(1.3 - (EYE.prone[1] + rise), 0, 0.45) : surfer.state === STATE.SITTING ? clamp(EYE.sitting[1] - (EYE.prone[1] + rise), 0, 0.35) : 0;
  game.vrStandOffset += (target - game.vrStandOffset) * (1 - Math.exp(-dt * 2));
  const h0 = xr.h0.clone().applyAxisAngle(Yaxis, rigYaw);
  rig.position.copy(eyeW).sub(h0);
  rig.position.y += game.vrStandOffset;
  if (surfer.state === STATE.WIPEOUT) rig.position.y -= Math.min(1.2, surfer.stateTime * 1.4);
}

// Fit the screen, whatever its size and shape: phones in either orientation (the visible
// area, which changes as the browser's bars come and go), tablets, ultrawide monitors. On a
// tall screen the view widens so you still see along the wave (the field of view is set for
// the narrower direction).
function screenSize() {
  const vv = window.visualViewport;
  const w = Math.round(vv && isTouchDevice ? vv.width : window.innerWidth);
  const h = Math.round(vv && isTouchDevice ? vv.height : window.innerHeight);
  return [Math.max(1, w), Math.max(1, h)];
}
function onResize() {
  if (renderer.xr.isPresenting) return; // the headset sets the size; sessionend calls this again
  const [w, h] = screenSize();
  camera.aspect = w / h;
  // at least about 80 degrees across, at most 100 up and down (portrait phones)
  const across = (Math.atan(Math.tan((72 * Math.PI) / 360) * camera.aspect) * 360) / Math.PI;
  camera.fov = across < 80 ? Math.min(100, (Math.atan(Math.tan((80 * Math.PI) / 360) / camera.aspect) * 360) / Math.PI) : 72;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  document.documentElement.style.setProperty('--vh', `${h / 100}px`);
  spray.setViewportHeight(renderer.domElement.height);
  if (sheets) sheets.setView(camera.fov, renderer.domElement.height);
  underwater.setViewportHeight(renderer.domElement.height);
}
window.addEventListener('resize', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
document.addEventListener('fullscreenchange', () => {
  setTimeout(onResize, 200);
  // phones: sideways while playing fullscreen, where the phone lets us
  if (document.fullscreenElement && isTouchDevice && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
});
onResize();

arms.onStroke = (side, effort) => audio.splash(0.5 + 0.5 * effort);
xr.onStroke = (side, effort) => audio.splash(0.5 + 0.5 * effort);

// ---------------------------------------------------------------- start state
model.reset(-62);
surfer.reset(0, spot.lineup.z, 0);
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
  w.height = parseFloat(params.get('waveh')) || (WAVE.mirror ? 1.6 : 2.6);
  w.S = waveScale(w.height);
  if (WAVE.mirror) {
    // a pool: the wave breaks from both outer corners in toward the pier; the views below
    // are on the left-hand side (x < 0), where it peels toward +x like a left
    w.dir = 0;
    w.peakX = WAVE.mirror;
  }
  const setTau = (tau) => {
    w.crestZ0 = WAVE.breakZ + tau * WAVE.speed;
    model._derive(w);
  };
  const zAt = (x, un) => w.crestZ0 + crestOffset(x) + un * w.S;
  game.zAt = zAt;
  if (params.has('tau')) setTau(parseFloat(params.get('tau')));
  if (name === 'lineup') {
    if (!params.has('tau')) setTau(-6.5);
    surfer.reset(WAVE.mirror ? spot.lineup.side - WAVE.mirror : spot.lineup.side, spot.lineup.z, 0);
  } else if (name === 'barrel') {
    setTau(4.2);
    const x = WAVE.mirror ? peelPoints(w)[1] - 9 : peelPoints(w)[0] - 9;
    surfer.reset(x, zAt(x, 0.78), -Math.PI / 2 + 0.12);
    surfer.setState(STATE.STANDING);
    surfer.crouch = surfer.legCrouch = 0.6;
    game.standBlend = 1;
    surfer.vx = 8;
  } else if (name === 'shoulder') {
    setTau(4.0);
    const x = WAVE.mirror ? peelPoints(w)[1] + 22 : peelPoints(w)[0] + 22;
    surfer.reset(x, zAt(x, 1.6), Math.PI / 2 - 0.35);
    game.look.pitch = 0.05;
  } else if (name === 'behind') {
    setTau(3.0);
    surfer.reset(14, zAt(14, -9), Math.PI + 0.25);
  } else if (name === 'paddle') {
    setTau(-2.2);
    surfer.reset(spot.lineup.side, spot.lineup.z + 2, Math.PI + 0.3);
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
    remote.setInfo(id, { name: names[i % names.length], board: i % 3 === 1 ? 'longboard' : 'shortboard', look: randomLook() });
    game.bots.push({ id, x: surfer.x + fx * ahead - fz * side, z: surfer.z + fz * ahead + fx * side, yaw: surfer.yaw + dyaw, effort });
  }
}

const _bq = new THREE.Quaternion();
const _be = new THREE.Euler();
function updateBots(dt = 0) {
  for (const b of game.bots) {
    const e = 0.06;
    const y = model.heightAt(b.x, b.z);
    const gx = (model.heightAt(b.x + e, b.z) - model.heightAt(b.x - e, b.z)) / (2 * e);
    const gz = (model.heightAt(b.x, b.z + e) - model.heightAt(b.x, b.z - e)) / (2 * e);
    // (a test can give one a pose, and a velocity it moves at, to bump into you: ?bump)
    const pose = b.pose || params.get('botpose') || (b.effort > 0 ? 'prone' : 'sit');
    const state = pose === 'sit' ? POSE.SITTING : pose === 'stand' ? POSE.STANDING : POSE.PRONE;
    b.x += (b.vx || 0) * dt;
    b.z += (b.vz || 0) * dt;
    _be.set(Math.atan(gz) * 0.8 + (state === POSE.SITTING ? 0.2 : 0.03), b.yaw, -Math.atan(gx) * 0.8, 'YXZ');
    _bq.setFromEuler(_be);
    const t = model.time + b.x;
    remote.push(b.id, { t: model.time, x: b.x, y: y - (state === POSE.SITTING ? 0.07 : 0), z: b.z, qx: _bq.x, qy: _bq.y, qz: _bq.z, qw: _bq.w, state, crouch: 0.2, foot: 0, lean: 0, effort: b.effort, dive: 0, lookYaw: state === POSE.PRONE ? 0 : Math.sin(t * 0.35) * 1.4, lookPitch: Math.sin(t * 0.21) * 0.25, heave: state === POSE.SITTING ? -0.07 : 0, vx: b.vx || 0, vz: b.vz || 0 });
  }
}

// ---------------------------------------------------------------- the Eisbach on foot
// You start on a bank with your board under your arm. Walk to the edge beside the wave and
// jump in (Space, A, the Jump in button, A / X in a headset): you land standing on the wave.
// Crouch and let go near a bank and you jump out onto it, landing on your feet. Wipe out, or
// get swept off the wave, and the river takes you away: you're back on the bank.
const walkGround = (x, z) => {
  const site = eisbachSite();
  if (!site) return null;
  if (river && river.inChannel(x, z, -0.15)) return null; // (the river, and its wall's edge: you jump in instead)
  const g = site.groundAt(x, z);
  return g !== null && g > -0.12 ? g : null;
};

// on a bank: at a spawn (side 'east' / 'west'), or where you landed ({ x, z, yaw })
function toBank(side = game.bankSide || 'east', at = null) {
  const site = eisbachSite();
  if (!site) return;
  if (game.ride) endRide('kickout');
  game.bank = true;
  game.jumpIn = null;
  game.bankSide = side;
  let x, z, yaw;
  if (at) ({ x, z, yaw } = at);
  else {
    const p = site.spawns[side] || site.spawns.east;
    x = p.z;
    z = -p.x;
    // looking across at the wave, a little up the river toward the bridge
    yaw = side === 'east' ? Math.PI / 2 + 0.35 : -Math.PI / 2 - 0.35;
  }
  walker.reset(x, z, yaw, walkGround);
  surfer.reset(x, z, yaw);
  surfer.setState(STATE.PRONE);
  game.look.yaw = 0;
  game.look.pitch = 0;
  game.snapCam = true;
}

// Close enough to jump in? Beside the wave, at the edge: returns where you'd land, or null.
function jumpSpot() {
  const site = eisbachSite();
  if (!site || !river || !game.bank) return null;
  const X = -walker.z,
    Z = walker.x;
  const [z0, z1] = site.channel(X);
  const side = Z > (z0 + z1) / 2 ? 1 : -1; // (+ the east bank)
  const toEdge = side > 0 ? Z - z1 : z0 - Z;
  if (X < -4.5 || X > 4.5 || toEdge > 2.4 || toEdge < -0.2) return null;
  const Xl = river.restX();
  const [a, b] = site.channel(Xl);
  const Zl = side > 0 ? b - 1.8 : a + 1.8;
  // facing up the river into the wave, turned a little away from your bank
  return { x: Zl, z: -Xl, yaw: Math.PI - side * 0.08, side: side > 0 ? 'east' : 'west' };
}

function jumpKey() {
  if (renderer.xr.isPresenting) return controls.questText('popup');
  if (device === 'touch') return 'Jump in';
  if (device === 'pad') return controls.padText('popup');
  return controls.pcKey('popup');
}

function jumpIn() {
  const to = jumpSpot();
  if (!to) {
    hud.toast('Walk to the edge of the river beside the wave to jump in', 2.5);
    return;
  }
  game.bankSide = to.side;
  const vr = renderer.xr.isPresenting;
  game.jumpIn = { t: 0, dur: vr ? 0.01 : 0.55, from: { x: walker.x, y: walker.eyeY(), z: walker.z, yaw: walker.yaw, pitch: walker.pitch }, to };
  audio.whoosh(0.5);
}

// (the jump's over: you're on the wave)
function landJump() {
  const { to } = game.jumpIn;
  game.jumpIn = null;
  game.bank = false;
  surfer.reset(to.x, to.z, to.yaw);
  surfer.setState(STATE.STANDING);
  surfer.y = model.heightAt(to.x, to.z);
  game.standBlend = 1;
  game.sitBlend = 0;
  game.snapCam = true;
  game.look.yaw = 0;
  game.look.pitch = -0.1;
  game.splash = 0.22;
  audio.splash(1);
  underwater.burst(to.x, surfer.y - 0.2, to.z, 30, 0.8, 0.3);
  if (renderer.xr.isPresenting) xr.calibrateStanding();
}

function walkBank(dt, acceptInput, inXR) {
  let fwd = 0,
    right = 0,
    run = false;
  if (acceptInput) {
    if (inXR) {
      // the left thumbstick walks the way you're looking; the right one turns you
      const L = xr.sticks.left,
        Rs = xr.sticks.right;
      fwd = -deadzone(L[1]);
      right = deadzone(L[0]);
      const turn = Math.abs(Rs[0]) > 0.7 ? Math.sign(Rs[0]) : 0;
      if (turn && !game.snapTurned) game.bankTurn = (game.bankTurn || 0) - turn * (Math.PI / 6);
      game.snapTurned = turn !== 0;
      walker.yaw = (game.bankTurn || 0) + xr.headYaw;
      run = Math.hypot(L[0], L[1]) > 0.95;
    } else {
      const [Lx, Ly] = gamepad.sticks;
      const T = touch.sticks;
      fwd = clamp(pc.leanZ - Ly - T[1], -1, 1);
      right = clamp(pc.steer + Lx + T[0], -1, 1);
      run = pc.charge || gamepad.down('charge') || Math.hypot(Lx, Ly) > 0.92 || Math.hypot(T[0], T[1]) > 0.92;
    }
  }
  walker.update(dt, { fwd, right, run }, walkGround);
}

// the board under your right arm (in your body's frame), and your arms round it
const BOARD_CARRY = { p: new THREE.Vector3(0.3, 0.98, 0.02), r: new THREE.Euler(0.12, 0, Math.PI / 2) };
function carryBoard() {
  const J = game.jumpIn;
  bodyFrame.position.set(walker.x, walker.y, walker.z);
  bodyFrame.quaternion.setFromAxisAngle(Yaxis, J ? J.from.yaw : walker.yaw);
  if (!board.userData.carried) {
    board.userData.carried = true;
    board.position.copy(BOARD_CARRY.p);
    board.rotation.copy(BOARD_CARRY.r);
  }
  arms.group.visible = !renderer.xr.isPresenting && !game.hideArms;
}
function uncarryBoard() {
  board.userData.carried = false;
  board.position.set(0, 0, 0);
  board.rotation.set(0, 0, 0);
}

function updateCameraBankPC(dt) {
  if (game.freeCam) return updateCameraPC(dt);
  const [lx0, ly0] = pc.consumeLook();
  const [tx, ty] = touch.consumeLook();
  const sens = settings.sensitivity;
  const T = touch.sticks;
  const [gy, gp] = gamepad.lookRate();
  walker.yaw += -(lx0 * sens + tx) * 0.0024 + gy * dt - T[2] * 1.8 * dt;
  walker.pitch = clamp(walker.pitch - (ly0 * sens * (settings.invertY ? -1 : 1) + ty) * 0.0024 + gp * dt - T[3] * 1.2 * dt, -1.45, 1.4);
  const J = game.jumpIn;
  if (J) {
    // the jump: up and out over the water, turning to face up the river
    const e = Math.min(1, J.t / J.dur);
    const k = e * e * (3 - 2 * e);
    const ex = J.to.x + 0.32 * Math.sin(J.to.yaw),
      ez = J.to.z + 0.32 * Math.cos(J.to.yaw);
    const ey = model.heightAt(J.to.x, J.to.z) + EYE.standing[1];
    rig.position.set(J.from.x + (ex - J.from.x) * k, J.from.y + (ey - J.from.y) * k + 0.55 * Math.sin(Math.PI * e), J.from.z + (ez - J.from.z) * k);
    rig.quaternion.setFromAxisAngle(Yaxis, J.from.yaw + wrap(J.to.yaw - J.from.yaw) * k);
    camera.position.set(0, 0, 0);
    camera.rotation.set(J.from.pitch + (-0.25 - J.from.pitch) * k, 0, 0, 'YXZ');
    return;
  }
  rig.position.set(walker.x, walker.eyeY(), walker.z);
  rig.quaternion.setFromAxisAngle(Yaxis, walker.yaw);
  camera.position.set(0, 0, 0);
  camera.rotation.set(walker.pitch, 0, 0, 'YXZ');
}

function updateCameraBankXR() {
  // your feet on the ground where the walker is; you can still step about for real
  const rigYaw = game.bankTurn || 0;
  rig.rotation.set(0, rigYaw, 0);
  const h0 = _v.set(xr.h0.x, 0, xr.h0.z).applyAxisAngle(Yaxis, rigYaw);
  rig.position.set(walker.x, walker.y, walker.z).sub(h0);
}

// After the physics: out of the channel and on a bank (a jump out), or taken away by the river
function riverRules() {
  const site = eisbachSite();
  if (!site || game.bank) return;
  const X = -surfer.z;
  const [z0, z1] = site.channel(X);
  if (surfer.x < z0 || surfer.x > z1) {
    const g = site.groundAt(surfer.x, surfer.z);
    if (g !== null && g > -0.3 && (!surfer.air || surfer.y <= g + 0.05)) {
      // landed on the bank: on your feet, board under your arm (somewhere you can stand: a
      // step further from the edge if you came down right on it)
      const side = surfer.x > z1 ? 'east' : 'west';
      const out = side === 'east' ? 1 : -1;
      let x = surfer.x;
      for (let k = 0; k < 8 && walkGround(x, surfer.z) === null; k++) x += out * 0.25;
      toBank(side, { x, z: surfer.z, yaw: surfer.yaw });
      hud.callout('Jumped out', 'back on the bank');
      audio.thud();
      return;
    }
  }
  if (game.teleport > 0) return;
  const wiped = surfer.state === STATE.WIPEOUT;
  const off = surfer.state !== STATE.STANDING && !surfer.air;
  if ((wiped && surfer.stateTime > 2.3) || (off && X > river.P.xC + 5) || X > river.P.xC + 14) {
    game.teleport = 1.4; // (fades out; respawn() puts you back on the bank)
    if (!wiped) hud.toast('Swept off down the river: back to the bank', 2.4);
  }
}

// Crouched and sprang off the wave near a bank: over the wall and onto it
function riverExitJump() {
  const site = eisbachSite();
  if (!site) return;
  const X = -surfer.z;
  const [z0, z1] = site.channel(X);
  const toEast = z1 - surfer.x,
    toWest = surfer.x - z0;
  const side = toEast < toWest ? 1 : -1;
  const dist = Math.min(toEast, toWest);
  if (dist > 4.2) return; // (out in the middle: an air, back down on the wave)
  const bx = side > 0 ? z1 + 1.1 : z0 - 1.1;
  const g = site.groundAt(bx, surfer.z) ?? 0.3;
  surfer.vy = Math.max(surfer.vy, 3.1);
  const dy = surfer.y - g;
  const t = (surfer.vy + Math.sqrt(surfer.vy * surfer.vy + 2 * 9.81 * Math.max(dy, -0.4))) / 9.81;
  surfer.vx = (side * (dist + 1.1)) / Math.max(t, 0.3);
  surfer.vz *= 0.2;
}

// mist and spray off the river's crest, and splashes against the walls
function riverSpray(dt) {
  const site = eisbachSite();
  if (!site) return;
  const R = Math.random;
  const xC = river.P.xC;
  let n = 90 * (spray.max / 1600) * dt + R();
  while (n-- >= 1) {
    const [z0, z1] = site.channel(xC);
    const Z = z0 + R() * (z1 - z0);
    const X = xC + (R() - 0.4) * 0.8;
    const y = river.surface(X, Z) + 0.05;
    const big = R() < 0.3;
    // up out of the foam pile, and carried off downstream (-z)
    spray.emit(Z, y, -X, (R() - 0.5) * 0.8, 0.8 + R() * (big ? 2.4 : 1.4), -1.2 - R() * 2.2, 0.5 + R() * 0.7, big ? 0.1 + R() * 0.15 : 0.03 + R() * 0.05, 1.4);
  }
}

// ---------------------------------------------------------------- replay
// Singleplayer keeps the last REPLAY_SECONDS of the waves and your surfer (replay.js). A
// replay freezes the game where you paused it, plays that back (slowed down, paused, skipped
// through) with you as the full character on your board, and you fly the drone round it.
// Ending it puts the game back exactly as it was.
const replayBuf = new ReplayBuffer(WAVE.slots);
const replayCast = new RemotePlayers(scene, null); // you, in the replay
const REPLAY_SPEEDS = [0.25, 0.5, 1];

const _wq = new THREE.Quaternion();
function recordFrame(b) {
  const vr = renderer.xr.isPresenting;
  if (game.bank || game.jumpIn) {
    // on foot on the bank
    replayBuf.record(model.time, model.waves, (f, o) => {
      const q = _wq.setFromAxisAngle(Yaxis, walker.yaw);
      f.fill(0, o, o + RF.moveDir + 1);
      f[o + RF.x] = walker.x;
      f[o + RF.y] = walker.y;
      f[o + RF.z] = walker.z;
      f[o + RF.qx] = q.x;
      f[o + RF.qy] = q.y;
      f[o + RF.qz] = q.z;
      f[o + RF.qw] = q.w;
      f[o + RF.state] = POSE.WALK;
      f[o + RF.effort] = walker.speed / 3.4;
      f[o + RF.lookPitch] = walker.pitch;
      f[o + RF.vx] = walker.vx;
      f[o + RF.vz] = walker.vz;
    });
    return;
  }
  replayBuf.record(model.time, model.waves, (f, o) => {
    const q = surfer.quat;
    f[o + RF.x] = surfer.x;
    f[o + RF.y] = surfer.position.y; // (as it's drawn)
    f[o + RF.z] = surfer.z;
    f[o + RF.qx] = q.x;
    f[o + RF.qy] = q.y;
    f[o + RF.qz] = q.z;
    f[o + RF.qw] = q.w;
    f[o + RF.state] = STATE_CODE[surfer.state];
    f[o + RF.crouch] = surfer.crouch;
    f[o + RF.foot] = surfer.footPos;
    f[o + RF.lean] = surfer.leanX;
    f[o + RF.effort] = surfer.paddleEffort;
    f[o + RF.dive] = surfer.diveDepth;
    f[o + RF.lookYaw] = vr ? xr.lookYaw || 0 : game.look.yaw;
    f[o + RF.lookPitch] = vr ? xr.lookPitch || 0 : game.look.pitch;
    f[o + RF.vx] = surfer.vx;
    f[o + RF.vy] = surfer.vy;
    f[o + RF.vz] = surfer.vz;
    f[o + RF.drop] = b.drop;
    f[o + RF.bow] = b.bow;
    f[o + RF.turn] = b.turn;
    f[o + RF.side] = b.side;
    f[o + RF.move] = b.move;
    f[o + RF.moveDir] = b.moveDir;
  });
}

function canReplay() {
  return game.started && game.mode === 'single' && replayBuf.count > 1 && replayBuf.duration > 2;
}

function startReplay() {
  if (game.replay || !canReplay()) return false;
  const t1 = replayBuf.lastT;
  const t0 = Math.max(replayBuf.firstT, t1 - REPLAY_SECONDS);
  // the game as it is now, to come back to (the surfer just waits: nothing moves it)
  game.replay = { t0, t1, t: t0, speed: 1, playing: true, live: { time: model.time, waves: model.waves.map((w) => ({ ...w })), teleport: game.teleport } };
  game.teleport = 0;
  const a = replayCast.ensure('you', false);
  a.setLook(menu.look);
  a.setBoard(boardType, a.look.board);
  replayCast.group.visible = true;
  bodyFrame.visible = false; // (your first-person board and arms)
  seekReplay(t0);
  placeReplayDrone(t0);
  return true;
}

function endReplay() {
  const R = game.replay;
  if (!R) return;
  game.replay = null;
  model.time = R.live.time;
  R.live.waves.forEach((w, i) => Object.assign(model.waves[i], w));
  game.teleport = R.live.teleport;
  replayCast.clear();
  replayCast.group.visible = false;
  spray.clear();
  if (sheets) sheets.clear();
  underwater.clearBubbles();
  bodyFrame.visible = game.role !== 'drone';
  droneBody.visible = false;
  audio.drone(0, 0);
  game.snapCam = true;
}

// what to show for the replay: the timeline bar, and a line for the headset
function replayInfo() {
  const R = game.replay;
  const t = R.t - R.t0,
    dur = R.t1 - R.t0;
  const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const speed = R.speed === 1 ? '' : ` · ${R.speed}×`;
  return { t, dur, playing: R.playing, speed: R.speed, device, line: `Replay ${clockText(t)} / ${clockText(dur)}${speed}${R.playing ? '' : ' · paused'}` };
}

function replayToast() {
  if (renderer.xr.isPresenting) hud.toast(`Replay: the last ${Math.round(game.replay.t1 - game.replay.t0)} s. Fly the drone round it. ${controls.questText('pause')}: menu (pause, slow motion, end).`, 6);
  else if (device === 'touch') hud.toast('Replay: drag on the left to fly, on the right to turn · the bar at the bottom plays, pauses and skips', 6);
  else if (device === 'pad') hud.toast('Replay: fly the drone · X pause · D-pad ◀ ▶ skip, ▲ ▼ speed · Y restart', 6);
  else hud.toast(`Replay: fly the drone (${controls.pcKey('forward')} ${controls.pcKey('left')} ${controls.pcKey('back')} ${controls.pcKey('right')}, mouse) · K pause · J / L skip 5 s · [ ] speed · R restart`, 7);
}

// the drone near you at time t, looking at you from the beach side
function placeReplayDrone(t) {
  const i = Math.max(0, replayBuf.find(t));
  const x = replayBuf.get(i, RF.x),
    y = replayBuf.get(i, RF.y),
    z = replayBuf.get(i, RF.z);
  const cx = x + 4,
    cy = Math.max(y, model.heightAt(x, z)) + 4.5,
    cz = z + 10;
  const dx = x - cx,
    dy = y + 0.6 - cy,
    dz = z - cz;
  drone.reset(cx, cy, cz, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}

// a jump in the replay's time: the spray in the air doesn't belong there
function seekReplay(t) {
  const R = game.replay;
  R.t = Math.min(R.t1, Math.max(R.t0, t));
  spray.clear();
  if (sheets) sheets.clear();
  underwater.clearBubbles();
  showReplay(0);
}

function replayControl(c) {
  const R = game.replay;
  if (!R) return;
  if (c === 'toggle') {
    R.playing = !R.playing;
    if (R.playing && R.t >= R.t1 - 0.01) seekReplay(R.t0);
  } else if (c === 'back') seekReplay(R.t - 5);
  else if (c === 'fwd') seekReplay(R.t + 5);
  else if (c === 'restart') {
    seekReplay(R.t0);
    R.playing = true;
  } else if (c === 'slower' || c === 'faster' || c === 'speed') {
    const k = REPLAY_SPEEDS.indexOf(R.speed);
    const n = c === 'speed' ? (k + 1) % REPLAY_SPEEDS.length : Math.min(REPLAY_SPEEDS.length - 1, Math.max(0, k + (c === 'faster' ? 1 : -1)));
    R.speed = REPLAY_SPEEDS[n];
  } else if (typeof c === 'number') seekReplay(R.t0 + c * (R.t1 - R.t0)); // (0..1 along the bar)
  else if (c === 'end') {
    endReplay();
    pause();
  }
}

// One frame of replay: move its clock on (round to the start again at the end). Returns how
// far the world moves this frame (the spray, the fish and the water run on it).
function updateReplay(dt) {
  const R = game.replay;
  const rdt = R.playing ? dt * R.speed : 0;
  if (rdt > 0) {
    R.t += rdt;
    if (R.t > R.t1) {
      seekReplay(R.t0);
      return 0;
    }
  }
  showReplay(rdt);
  return rdt;
}

const _ra = {},
  _rb = {};
const _rq = new THREE.Quaternion();
const _ry = new THREE.Euler(0, 0, 0, 'YXZ');
function replaySnap(i, out) {
  const g = (f) => replayBuf.get(i, f);
  out.t = g(RF.t);
  out.x = g(RF.x);
  out.y = g(RF.y);
  out.z = g(RF.z);
  out.qx = g(RF.qx);
  out.qy = g(RF.qy);
  out.qz = g(RF.qz);
  out.qw = g(RF.qw);
  out.state = Math.round(g(RF.state));
  out.crouch = g(RF.crouch);
  out.foot = g(RF.foot);
  out.lean = g(RF.lean);
  out.effort = g(RF.effort);
  out.dive = g(RF.dive);
  out.lookYaw = g(RF.lookYaw);
  out.lookPitch = g(RF.lookPitch);
  out.vx = g(RF.vx);
  out.vy = g(RF.vy);
  out.vz = g(RF.vz);
  return out;
}

// the waves, you and the spray off your board at the replay's time
function showReplay(rdt) {
  const R = game.replay;
  const i = replayBuf.find(R.t);
  const j = Math.min(i + 1, replayBuf.count - 1);
  const k = replayBuf.applyWaves(model, i, R.t);
  const a = replayCast.ensure('you', false);
  const s0 = replaySnap(i, _ra),
    s1 = replaySnap(j, _rb);
  a.snaps.length = 0;
  a.snaps.push(s0);
  if (j !== i) a.snaps.push(s1);
  replayCast.update(R.t + POSE_DELAY, focus, rdt);
  if (rdt <= 0) return;
  // what the board was doing to the water, between the two frames
  const b = boardFx;
  b.position.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
  b.quat.set(s0.qx, s0.qy, s0.qz, s0.qw).slerp(_rq.set(s1.qx, s1.qy, s1.qz, s1.qw), k);
  b.vel.set(s0.vx + (s1.vx - s0.vx) * k, s0.vy + (s1.vy - s0.vy) * k, s0.vz + (s1.vz - s0.vz) * k);
  const yaw = _ry.setFromQuaternion(b.quat).y;
  b.fx = -Math.sin(yaw);
  b.fz = -Math.cos(yaw);
  b.type = boardType;
  b.L = (BOARDS[boardType] || BOARDS.shortboard).length;
  const n = k < 0.5 ? i : j;
  for (const f of ['drop', 'bow', 'turn', 'side', 'move', 'moveDir']) b[f] = replayBuf.get(n, RF[f]);
  boardSpray(b, rdt);
}

// replay keys (not ones a control uses): K or P pause, J / L skip 5 s, [ ] speed
const REPLAY_KEYS = { KeyK: 'toggle', KeyP: 'toggle', KeyJ: 'back', KeyL: 'fwd', BracketLeft: 'slower', BracketRight: 'faster' };
window.addEventListener('keydown', (e) => {
  const c = REPLAY_KEYS[e.code];
  if (!c || !game.replay || game.paused || menu.isOpen || e.repeat) return;
  if (Object.values(controls.pc).some((keys) => keys.includes(e.code))) return;
  replayControl(c);
});
hud.onReplay = (c) => game.replay && replayControl(c);

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let fpsAcc = 0,
  fpsFrames = 0,
  fps = 0;
const NO_INPUT = { paddle: 0, pulse: 0, turn: 0, steer: 0, leanX: 0, leanZ: 0, walk: 0, walkTo: null, crouch: 0, duck: false, charge: false };
const NO_FLIGHT = { fwd: 0, right: 0, up: 0, yawRate: 0, boost: false };
const FPV_IDLE = { fpv: true, throttle: 0.5, yaw: 0, pitch: 0, roll: 0 };

// ---------------------------------------------------------------- drone
// PC: strafe on the movement keys, climb / descend on the pop-up / crouch keys, the mouse
// turns the drone and tilts the gimbal camera. Controller: left stick flies, right stick
// turns and tilts the camera, the paddle triggers climb (right) and descend (left); or, set
// to FPV, acro mode as in VR (left stick throttle and yaw, right stick pitch and roll).
// Touch: drag on the left half to fly, on the right half to turn and tilt; ▲ ▼ climb.
function droneInputPC(dt) {
  const [Lx, Ly, Rx, Ry] = gamepad.sticks;
  if (drone.fpv) return { fpv: true, throttle: clamp((1 - Ly) / 2, 0, 1), yaw: Lx, pitch: -Ry, roll: Rx };
  const [lx, ly] = pc.consumeLook();
  touch.consumeLook();
  const sens = settings.sensitivity;
  const T = touch.sticks;
  drone.yaw -= lx * sens * 0.0024;
  drone.camPitch = clamp(drone.camPitch - ly * sens * 0.0024 * (settings.invertY ? -1 : 1) - (Ry * (gamepad.settings.invertY ? -1 : 1) + T[3]) * 1.1 * dt, -1.5, 0.6);
  return {
    fwd: clamp(pc.leanZ - Ly - T[1], -1, 1),
    right: clamp(pc.steer + Lx + T[0], -1, 1),
    up: clamp((pc.down('popup') ? 1 : 0) - (pc.down('crouch') ? 1 : 0) + gamepad.value('paddleR') - gamepad.value('paddleL') + touch.climb, -1, 1),
    yawRate: -(Rx + T[2]) * 1.5,
    boost: pc.charge || gamepad.down('charge'),
  };
}

// Quest: left stick climbs / descends and turns, right stick strafes; the head aims.
// FPV (acro): left stick throttle (up = full, the middle about hovers) and yaw rate, right
// stick pitch and roll rates.
const deadzone = (v, d = 0.15) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
function droneInputXR() {
  const L = xr.sticks.left;
  const R = xr.sticks.right;
  if (drone.fpv) return { fpv: true, throttle: Math.min(1, Math.max(0, (1 - L[1]) / 2)), yaw: deadzone(L[0], 0.06), pitch: -deadzone(R[1], 0.06), roll: deadzone(R[0], 0.06) };
  return { fwd: -deadzone(R[1]), right: deadzone(R[0]), up: -deadzone(L[1]), yawRate: -deadzone(L[0]) * 1.4, boost: false };
}

function updateDrone(dt, fly) {
  const wasDown = drone.crash;
  if (drone.fpv) drone.updateFPV(dt, fly.fpv ? fly : FPV_IDLE, model); // (sticks centred while the menu is open)
  else drone.update(dt, fly, model);
  if (drone.crash && !wasDown) {
    // into the water (or the lip, or the land): splash, fade out and relaunch
    game.teleport = 1.4;
    game.splash = 0.25;
    spray.fan(drone.pos.x, drone.pos.y, drone.pos.z, 0, 0, 0.7, 0.3);
    audio.splash(1.2);
    hud.toast(`<b>Drone down</b> · ${drone.crash}. Relaunching…`, 2.6);
    sendEvent({ k: 'crash' });
  }
  // height over the water, and flying through a barrel
  const s = model.sample(drone.pos.x, drone.pos.z, game.droneS || (game.droneS = {}));
  game.droneAlt = drone.pos.y - s.height;
  const ceiling = s.wave && s.b > 0.5 && s.un > 0 && s.un < 1.6 ? model.tubeCeiling(s.wave, drone.pos.x, drone.pos.z, drone.pos.y) : Infinity;
  game.droneTube = ceiling < Infinity && !drone.crash;
}

function updateCameraDronePC() {
  if (drone.fpv) {
    // FPV: the camera in the nose, tilted up, turning with the drone
    drone.fpvCameraPosition(rig.position);
    drone.fpvCameraQuat(rig.quaternion);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    return;
  }
  // level gimbal: only the drone's heading and the camera tilt, never the body's tilt
  drone.cameraPosition(rig.position);
  rig.quaternion.setFromAxisAngle(Yaxis, drone.yaw);
  camera.position.set(0, 0, 0);
  camera.rotation.set(drone.camPitch, 0, 0, 'YXZ');
}

const _qc = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
function updateCameraDroneXR() {
  if (drone.fpv) {
    // FPV goggles: the view is the drone's camera, whatever your head does. The rig cancels
    // the head's pose this frame, so the eyes end up exactly on the camera.
    drone.fpvCameraQuat(_qc);
    rig.quaternion.copy(_qc).multiply(_qh.copy(xr.headQuat).invert());
    drone.fpvCameraPosition(rig.position).sub(_v.copy(xr.head).applyQuaternion(rig.quaternion));
    return;
  }
  // the calibrated head sits on the drone's camera point, facing the drone's heading
  const rigYaw = drone.yaw - xr.yaw0;
  rig.rotation.set(0, rigYaw, 0);
  const h0 = _v.copy(xr.h0).applyAxisAngle(Yaxis, rigYaw);
  drone.cameraPosition(rig.position).sub(h0);
  // others see the gimbal follow your head
  camera.getWorldDirection(_v);
  drone.camPitch = Math.asin(clamp(_v.y, -1, 1));
}

function frame(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const inXR = renderer.xr.isPresenting;
  if (game.onFrame) game.onFrame(dt);
  // the controller: polled every frame, menus or not
  const padWas = gamepad.lastActive;
  gamepad.poll(dt);
  touch.update(dt);
  if (gamepad.lastActive !== padWas) setDevice('pad');
  const padName = gamepad.connected ? gamepad.pad.id : '';
  if (padName !== game.padName) {
    game.padName = padName;
    menu.setPadStatus(padName);
  }
  if (!inXR && menu.isOpen) {
    for (const c of gamepad.consumeNav()) menu.navigate(c);
    gamepad.consumeEvents(); // (a press the menu used, like A on Play or Start to resume, isn't also a move)
  } else gamepad.consumeNav();
  touch.enabled = game.started && !game.paused && !inXR;
  document.body.classList.toggle('playing', game.started && !inXR && !menu.isOpen);
  // behind the opaque menu nothing is visible: don't simulate or render
  const hidden = menu.opaque && !inXR && game.warmup <= 0 && !game.started;
  if (hidden) return;
  game.warmup--;
  // multiplayer keeps the shared world moving even while the menu is open
  const running = game.started && (!game.paused || game.mode === 'multi');
  const acceptInput = game.started && !game.paused;
  const replaying = !!game.replay;
  const flying = game.started && (game.role === 'drone' || replaying);
  let inp = NO_INPUT;
  let fly = NO_FLIGHT;
  pc.update(dt);

  // the drone flies FPV in VR, or with a controller, if you chose that (else the camera drone)
  drone.setFPV(flying && settings.droneVR === 'fpv' && (inXR || device === 'pad'));
  const onBank = !flying && (game.bank || !!game.jumpIn);
  touch.mode = flying ? 'drone' : onBank ? 'bank' : surfer.state === STATE.POPUP ? 'standing' : surfer.state;
  touch.showButtons(touch.enabled && device === 'touch');
  if (inXR) {
    const gestures = xr.update(dt, xrFrame, onBank ? 'bank' : surfer.state, surfer.board);
    if (acceptInput) {
      if (flying) fly = droneInputXR();
      else if (!onBank) inp = gestures;
    }
    for (const e of xr.consumeEvents()) {
      if (e === 'pause') vrMenu.open ? closeVRMenu() : game.started && openVRMenu();
      else if (!acceptInput) continue; // the headset menu is open
      else if (onBank) {
        if (e === 'toggleStand') jumpIn();
        else if (e === 'reset') toBank(game.bankSide === 'east' ? 'west' : 'east');
        else if (e === 'recalibrate') xr.calibrate();
      } else if (spot && spot.river && e === 'recalibrate') {
        xr.calibrateStanding();
        hud.toast('Recentred', 1.5);
      } else if (spot && spot.river && e === 'reset') respawn(true);
      else if (flying) {
        if (e === 'reset') replaying ? replayControl('restart') : respawn(true);
        else if (e === 'recalibrate') xr.calibrate(); // re-centre the view under the drone
      } else if (typeof e === 'object' && e.flick) surfer.flick(e.flick, e.omega, e.sweep);
      else if (e === 'recalibrate') {
        xr.calibrate();
        hud.toast('Calibrated paddling position', 2);
      } else if (e === 'reset') respawn(true);
      else if (e === 'popUp') surfer.popUp();
      else if (e === 'sit') surfer.sit();
      else if (e === 'layDown') surfer.layDown();
      else if (e === 'toggleStand') surfer.state === STATE.PRONE ? surfer.popUp() : surfer.layDown();
    }
  } else if (acceptInput && flying) {
    fly = droneInputPC(dt);
    for (const e of [...pc.consumeEvents(), ...gamepad.consumeEvents(), ...touch.consumeEvents()]) {
      if (e === 'reset') replaying ? replayControl('restart') : respawn(true);
      else if (e === 'pause') pause();
      else if (e && e.replay && replaying) replayControl(e.replay);
    }
  } else if (acceptInput && onBank) {
    // on foot: your movement keys, the left stick or the left of the screen walk; Space / A
    // / the button jumps in; back to the lineup swaps banks
    for (const e of [...pc.consumeEvents(), ...gamepad.consumeEvents(), ...touch.consumeEvents()]) {
      if (e === 'toggleStand') jumpIn();
      else if (e === 'reset') toBank(game.bankSide === 'east' ? 'west' : 'east');
      else if (e === 'pause') pause();
      else if (e === 'level') touch.calibrate();
    }
  } else if (acceptInput) {
    // keyboard and mouse, a controller and a touch screen all at once (the phone's tilt
    // only while you're playing by touch)
    const tilt = device === 'touch';
    const steer = clamp(pc.steer + gamepad.steer + (tilt ? touch.steer : 0), -1, 1);
    const leanZ = clamp(pc.leanZ + gamepad.leanZ + (tilt ? touch.leanZ : 0), -1, 1);
    const prone = surfer.state === STATE.PRONE;
    inp = {
      paddle: pc.paddle,
      pulse: 0,
      turn: 0,
      steer,
      leanX: steer,
      leanZ,
      walk: leanZ,
      walkTo: null,
      crouch: pc.down('crouch') || gamepad.down('crouch') || touch.crouch ? 1 : 0,
      duck: (pc.down('duck') || gamepad.down('duck') || touch.duck) && prone,
      charge: pc.charge || gamepad.down('charge') || touch.charge,
    };
    for (const e of [...pc.consumeEvents(), ...gamepad.consumeEvents(), ...touch.consumeEvents()]) {
      if (typeof e === 'object') {
        // one arm's stroke (a trigger pulled, a swipe): paddling lies you down from sitting
        if (e.stroke) {
          if (surfer.state === STATE.SITTING) surfer.layDown();
          if (surfer.state === STATE.PRONE && !surfer.diving) arms.stroke(e.stroke, e.strength);
        } else if (e.flick) surfer.flick(e.flick, e.omega, e.sweep);
      } else if (e === 'toggleStand') {
        if (surfer.state === STATE.PRONE) surfer.popUp();
        else surfer.layDown(); // (from sitting too)
      } else if (e === 'reset') respawn(true);
      else if (e === 'pause') pause();
      else if (e === 'level') {
        touch.calibrate();
        hud.toast('Tilt recalibrated: the way you hold it now is level', 2.5);
      } else if (e === 'back' && surfer.state === STATE.PRONE) surfer.sit();
      else if (e === 'forward' && surfer.state === STATE.SITTING) surfer.layDown();
    }
    // starting to paddle lies you back down
    if (surfer.state === STATE.SITTING && pc.paddle > 0.15) surfer.layDown();
  } else {
    // paused: nothing carries over
    pc.consumeEvents();
    gamepad.consumeEvents();
    touch.consumeEvents();
  }

  let simDt = running ? dt : 0;
  if (running && replaying) {
    simDt = updateReplay(dt);
    updateDrone(dt, fly); // (the drone flies in real time, whatever the replay's speed)
  } else if (running && flying) {
    model.update(dt);
    updateDrone(dt, fly);
  } else if (running && onBank) {
    model.update(dt);
    arms.update(dt, false);
    if (game.jumpIn) game.jumpIn.t += dt;
    else walkBank(dt, acceptInput, inXR);
    if (game.jumpIn && game.jumpIn.t >= game.jumpIn.dur) landJump();
    if (game.mode === 'single') recordFrame(boardFx);
  } else if (running) {
    model.update(dt);
    const paddling = !inXR && acceptInput && surfer.state === STATE.PRONE;
    const pulse = arms.update(dt, paddling, inp.paddle, surfer.diving);
    // (strokes one arm at a time: their effort, and a harder right stroke turns you left)
    if (!inXR) inp = { ...inp, pulse, turn: arms.turn, paddle: Math.max(inp.paddle, arms.manual ? arms.manualEffort : 0) };
    surfer.update(dt, inp);
    boardSpray(liveBoardFx(), dt);
    if (game.mode === 'single') recordFrame(boardFx);
    updateGame(dt);
    if (spot.river && river) riverRules();
  } else arms.update(0, false);

  if (flying) {
    // your own drone: in view above you on PC; in a headset it would sit right by your eyes
    droneBody.visible = !inXR;
    for (const h of xr.hands) if (h.model) h.model.visible = false; // no arms on a drone
    arms.group.visible = false;
    droneBody.position.copy(drone.pos);
    droneBody.quaternion.copy(drone.quat);
    animateDrone(droneBody, dt, drone.throttle, drone.camPitch, drone.quat, drone.yaw);
    if (inXR) updateCameraDroneXR();
    else updateCameraDronePC();
  } else if (onBank) {
    // on foot with your board under your arm
    for (const h of xr.hands) if (h.model) h.model.visible = true;
    carryBoard();
    if (inXR) updateCameraBankXR();
    else updateCameraBankPC(dt);
  } else {
    for (const h of xr.hands) if (h.model) h.model.visible = true;
    if (board.userData.carried) uncarryBoard();
    updateBody(dt);
    arms.group.visible = !inXR && !game.hideArms && surfer.state === STATE.PRONE && game.standBlend < 0.05 && game.sitBlend < 0.05;
    if (inXR) updateCameraXR(dt);
    else updateCameraPC(dt);
  }

  rig.updateMatrixWorld(true);
  // your arms: paddling on PC and mobile, reaching for the controllers in VR
  if (inXR) arms.poseVR(xr.hands, xr.head, xr.headQuat, rig, surfer.state === STATE.PRONE && !onBank, !flying);
  else if (onBank) arms.poseCarry(bodyFrame, !game.hideArms);
  else arms.pose();
  // the head. (In VR three.js keeps `camera` on the head pose inside the rig; the XR camera's
  // own world position is only rig-relative here, between renders.)
  camera.getWorldPosition(focus);
  vrMenu.update();
  if (ocean.mesh.visible) ocean.update(focus); // (not at a river: the sea isn't there)
  if (spot && spot.river && river) {
    river.update(simDt, game.wasUnder);
    if (simDt > 0) riverSpray(simDt);
  }
  spray.update(simDt, focus);
  if (sheets) {
    // (the camera's speed, for the drops' blur, on the spray's clock; not across a jump)
    const cv = _camVel.subVectors(focus, _camLast).divideScalar(Math.max(dt, 1e-3));
    if (!running || cv.lengthSq() > 900) cv.set(0, 0, 0);
    _camLast.copy(focus);
    sheets.setCameraVelocity(cv.multiplyScalar(simDt / Math.max(dt, 1e-3)));
    sheets.update(simDt);
  }

  // ---- other surfers
  if (game.mode === 'multi' && net && net.room) {
    game.poseTimer -= dt;
    if (game.poseTimer <= 0 && game.started) {
      game.poseTimer = 1 / MULTIPLAYER.poseHz;
      sendPose();
    }
    remote.update(net.now(), focus, dt);
    if (running && !flying && !onBank) bumpOthers(dt);
    otherSheets(running ? dt : 0);
    hud.setPlayers(roomLine());
    // motor whine: your own drone, or the nearest one buzzing past
    const ds = flying ? { level: 0.7, throttle: drone.throttle } : remote.droneSound(focus);
    audio.drone(ds.level, ds.throttle);
  } else if (game.bots) {
    updateBots(running ? dt : 0);
    remote.update(model.time, focus, dt);
    if (running && !flying && !onBank) bumpOthers(dt);
    otherSheets(running ? dt : 0);
  }
  if (replaying) audio.drone(running ? 0.7 : 0, drone.throttle); // (your drone's motors)

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
  terrain.visible = !camUnder || !!spot.river; // land is only visible through the surface from below (a river's banks are its land)
  if (terrain.userData.underwater) terrain.userData.underwater.visible = camUnder;
  const gx = surfer._gx || 0,
    gz = surfer._gz || 0;
  const waterY = (x, z) => hBoard + gx * (x - surfer.x) + gz * (z - surfer.z);
  if (running && !replaying && !onBank) emitBubbles(dt, camUnder, camDepth);
  camera.getWorldDirection(_v);
  fish.update(simDt, camUnder, focus, _v, (x, z) => model.heightAt(x, z), seabedY);
  underwater.update(simDt, focus, camUnder, camDepth, focus.y - seabedY(focus.x, focus.z), waterY, model.time);
  if (camUnder !== game.wasUnder) {
    game.splash = 0.18; // crossing the surface
    game.wasUnder = camUnder;
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
  if (surfer.state === STATE.WIPEOUT && fadeAlpha < 0.5 && !replaying && !onBank) {
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

  // ---- audio: roar from breaking sections near the listener (or the river's wave)
  let roar = 0;
  if (spot && spot.river) roar = 1.1 * (25 / (25 + Math.hypot(focus.x, focus.z + (river ? river.P.xC : 0))));
  for (const w of model.waves) {
    if (!w.active || w.tau < 0) continue;
    const [peelX, backX] = peelPoints(w);
    const dx = Math.max(0, Math.min(Math.abs(focus.x - peelX), Math.abs(focus.x - (peelX + backX) / 2)) - 15);
    const dz = Math.abs(focus.z - w.crestZ0);
    roar += (w.H / 2.6) * 30 / (30 + dx + dz * 1.5);
  }
  audio.update(roar, flying ? drone.speed * 0.6 : onBank ? 0 : surfer.planeSpeed, camUnder);

  // ---- HUD
  let stateLabel = { prone: 'Paddling', popup: 'Popping up', standing: 'Surfing', wipeout: 'Wipeout!', sitting: 'Sitting up' }[surfer.state];
  if (surfer.diving) stateLabel = surfer.turtle > 0 || surfer.board.walk ? 'Turtle roll' : 'Duck diving';
  else if (surfer.air) stateLabel = 'Airborne';
  else if (surfer.state === STATE.STANDING && surfer.crouch > 0.5) stateLabel = 'Surfing · crouched';
  else if (surfer.state === STATE.STANDING && surfer.onWhitewater) stateLabel = 'Surfing the whitewater';
  let warn = '';
  if (surfer.state === STATE.STANDING && surfer.ceiling < 2.1 && surfer.crouch < 0.65) warn = inXR ? 'Crouch!' : `Crouch! (${controls.pcKey('crouch')})`;
  if (onBank) {
    stateLabel = game.jumpIn ? 'Jumping in' : jumpSpot() ? `On the bank · ${device === 'touch' && !inXR ? 'tap Jump in' : `${jumpKey()}: jump in`}` : 'On the bank';
    warn = '';
  }
  if (flying) {
    stateLabel = drone.crash ? 'Drone down' : `${drone.fpv ? 'FPV' : 'Drone'} · ${Math.max(0, game.droneAlt || 0).toFixed(1)} m up`;
    warn = !drone.crash && game.droneAlt < 0.9 && drone.vel.y < -0.3 ? 'Pull up!' : '';
  }
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
  hud.setReplay(replaying ? replayInfo() : null);
  hud.update(
    dt,
    {
      visible: game.started && (!game.paused || inXR) && !menu.isOpen,
      stateLabel,
      speed: flying ? drone.speed : onBank ? walker.speed : surfer.planeSpeed,
      waveLabel: nextWaveInfo(),
      inTube: flying ? game.droneTube : surfer.inTube,
      warn,
      paddle: !flying && !onBank && surfer.state === STATE.PRONE && !surfer.diving ? surfer.paddleEffort : null,
      foot: !flying && B.walk && surfer.state === STATE.STANDING ? (surfer.footPos - B.footMin) / (B.footMax - B.footMin) : null,
      debug: dbg,
      vrLine: replaying ? replayInfo().line : '',
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
  if (w.dir === 0) return 'left and right'; // (a pool: both sides of the pier)
  return w.dir > 0 ? 'left' : 'right'; // +x is the surfer's left when facing the beach
}

function nextWaveInfo() {
  if (game.replay) return '';
  if (spot && spot.river) return river ? `Eisbach · ${river.P.A.toFixed(1)} m standing wave` : '';
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
  bumps,
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
  drone,
  droneBody,
  STATE,
  respawn,
  setBoardType,
  startGame,
  ensureNet,
  get net() {
    return net;
  },
  gamepad,
  touch,
  hud,
  get device() {
    return device;
  },
  get spot() {
    return spot;
  },
  applySpot,
  fish,
  sheets,
  walker,
  get river() {
    return river;
  },
  jumpIn,
  jumpSpot,
  toBank,
  replayBuf,
  startReplay,
  endReplay,
  replayControl,
  replayCast,
  WAVE,
  peelPoints,
  begin: () => startGame('single', 'pc'),
};
document.body.classList.add('ready');
