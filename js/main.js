import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { QUALITY, SUN_DIR, SUN_COLOR, EYE, LINEUP_Z, WAVE, BOARDS, CROUCH_DROP } from './config.js';
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

const params = new URLSearchParams(location.search);
const isMobileXR = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
let qualityName = params.get('q') || (isMobileXR ? 'low' : 'high');
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

// ---------------------------------------------------------------- board choice
const segs = [...document.querySelectorAll('.seg[data-board]')];
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
  for (const s of segs) s.setAttribute('aria-checked', String(s.dataset.board === type));
  try {
    localStorage.setItem('surf.board', type);
  } catch (e) {
    /* storage unavailable */
  }
}
for (const s of segs) s.addEventListener('click', () => setBoardType(s.dataset.board));
let savedBoard = null;
try {
  savedBoard = localStorage.getItem('surf.board');
} catch (e) {
  /* storage unavailable */
}
setBoardType(params.get('board') || savedBoard || 'shortboard');

// ---------------------------------------------------------------- game flow
const game = {
  started: false,
  paused: true,
  invulnerable: true, // title screen
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
};

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
  surfer.reset(s.x, s.z, s.yaw);
  game.snapCam = true;
  game.look.yaw = 0;
  game.look.pitch = 0;
  game.ride = null;
  game.missTimer = 0;
}

function waveLabelFor(w) {
  return w.dir > 0 ? 'left' : 'right'; // +x is the surfer's left when facing the beach
}

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
  } else if (type === 'air') {
    hud.callout(`Air ${data.time.toFixed(1)} s`);
    if (game.ride) game.ride.tricks.push('air');
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
      game.noseCalled = 1;
    }
    if (surfer.footPos > 1.06 && game.noseT > 0.6 && game.noseCalled < 2) {
      hud.callout('Hang ten');
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
  const [lx, ly] = pc.consumeLook();
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

// ---------------------------------------------------------------- UI wiring
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start');
const resumeTitle = document.getElementById('overlay-title');
const vrHolder = document.getElementById('vr-slot');

function pause() {
  if (!game.started || game.paused || renderer.xr.isPresenting) return;
  game.paused = true;
  pc.enabled = false;
  resumeTitle.textContent = 'Paused';
  startBtn.textContent = 'Resume';
  overlay.classList.remove('hidden');
}

function begin() {
  audio.start();
  if (!game.started) {
    game.started = true;
    game.invulnerable = false;
    respawn(false);
    hud.toast('Scroll to paddle (faster = harder) · A / D steer · Space to pop up', 5);
  }
  game.paused = false;
  overlay.classList.add('hidden');
  pc.enabled = true;
  pc.capture();
}

startBtn.addEventListener('click', begin);
pc.onLockChange = (locked) => {
  if (!locked) pause();
};
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

const vrButton = VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
vrButton.classList.add('vr-button');
vrHolder.appendChild(vrButton);
// friendlier wording than three's default when no headset is available
const relabel = () => {
  const t = vrButton.textContent.trim().toUpperCase();
  if (t === 'VR NOT SUPPORTED' || t === 'WEBXR NOT AVAILABLE') {
    vrButton.textContent = 'VR: open on Meta Quest';
    vrButton.classList.add('vr-off');
  } else if (t === 'WEBXR NEEDS HTTPS') {
    vrButton.textContent = 'VR needs HTTPS';
    vrButton.classList.add('vr-off');
  }
};
new MutationObserver(relabel).observe(vrButton, { childList: true, characterData: true, subtree: true });
relabel();

renderer.xr.addEventListener('sessionstart', () => {
  audio.start();
  overlay.classList.add('hidden');
  if (!game.started) {
    game.started = true;
    game.invulnerable = false;
    respawn(false);
  }
  game.paused = false;
  ocean.setQuality(QUALITY.low, false);
  xr.calibrated = false;
  bodyFrame.remove(arms.group);
  spray.setViewportHeight(1700);
  underwater.setViewportHeight(1700);
  hud.toast('Lie or kneel down, then press the trigger to calibrate. Paddle with your arms, stand up to surf.', 7);
});
renderer.xr.addEventListener('sessionend', () => {
  ocean.setQuality(quality, qualityName === 'high');
  bodyFrame.add(arms.group);
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  game.paused = true;
  overlay.classList.remove('hidden');
  onResize();
});

function onResize() {
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
  // Deterministic views for screenshots / testing.
  game.started = true;
  game.paused = params.has('freeze');
  game.invulnerable = true;
  overlay.classList.add('hidden');
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
  if (name === 'lineup') {
    setTau(-6.5);
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
  model.spawn = () => w; // keep the scene stable
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
  const running = !game.paused || inXR || !game.started;
  let inp = NO_INPUT;
  pc.update(dt);

  if (inXR) {
    inp = xr.update(dt, xrFrame, surfer.state, surfer.board);
    for (const e of xr.consumeEvents()) {
      if (typeof e === 'object' && e.flick) surfer.flick(e.flick, e.omega, e.sweep);
      else if (e === 'recalibrate') {
        xr.calibrate();
        hud.toast('Calibrated paddling position', 2);
      } else if (e === 'reset') respawn(true);
      else if (e === 'popUp') surfer.popUp();
      else if (e === 'layDown') surfer.layDown();
      else if (e === 'toggleStand') surfer.state === STATE.PRONE ? surfer.popUp() : surfer.layDown();
    }
  } else if (game.started && !game.paused) {
    const steer = pc.steer;
    const crouchKey = pc.crouch;
    inp = {
      paddle: pc.paddle,
      pulse: 0,
      turn: 0,
      steer,
      leanX: steer,
      leanZ: pc.leanZ,
      walk: pc.leanZ,
      walkTo: null,
      crouch: crouchKey ? 1 : 0,
      duck: crouchKey && surfer.state === STATE.PRONE,
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
    const paddling = !inXR && surfer.state === STATE.PRONE && game.started && !game.paused;
    const pulse = arms.update(dt, paddling, inp.paddle, surfer.diving);
    if (!inXR) inp = { ...inp, pulse };
    surfer.update(dt, inp);
    if (game.started) updateGame(dt);
  } else arms.update(0, false);

  updateBody(dt);
  arms.group.visible = !inXR && surfer.state === STATE.PRONE && game.standBlend < 0.05;
  if (inXR) updateCameraXR(dt);
  else updateCameraPC(dt);

  rig.updateMatrixWorld(true);
  camera.getWorldPosition(focus);
  if (inXR) renderer.xr.getCamera().getWorldPosition(focus); // centre detail on the head
  ocean.update(focus);
  spray.update(running ? dt : 0, focus);

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
  if (surfer.state === STATE.STANDING && surfer.ceiling < 2.1 && surfer.crouch < 0.65) warn = inXR ? 'Crouch!' : 'Crouch! (Ctrl)';
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
  hud.update(
    dt,
    {
      visible: game.started && !game.paused,
      stateLabel,
      speed: surfer.speed,
      waveLabel: nextWaveInfo(),
      inTube: surfer.inTube,
      warn,
      paddle: surfer.state === STATE.PRONE && !surfer.diving ? surfer.paddleEffort : null,
      foot: B.walk && surfer.state === STATE.STANDING ? (surfer.footPos - B.footMin) / (B.footMax - B.footMin) : null,
      debug: dbg,
    },
    inXR,
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

function nextWaveInfo() {
  if (surfer.state === STATE.WIPEOUT) return '';
  if (surfer.state !== STATE.PRONE) {
    const r = game.ride;
    return r ? `Ride ${r.time.toFixed(1)} s${r.tube > 0.1 ? ` · barrel ${r.tube.toFixed(1)} s` : ''}` : '';
  }
  if (surfer.diving) return 'Release to surface';
  if (surfer.catching) return 'Caught it! Pop up (Space) before it goes vertical';
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
window.__surf = { THREE, renderer, scene, camera, model, surfer, game, ocean, pc, arms, xr, underwater, STATE, respawn, begin, setBoardType };
document.body.classList.add('ready');
