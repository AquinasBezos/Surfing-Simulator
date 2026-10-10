import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { QUALITY, SUN_DIR, SUN_COLOR, EYE, LINEUP_Z, WAVE } from './config.js';
import { WaveModel, smoothstep, clamp, crestOffset } from './wave.js';
import { Ocean } from './ocean.js';
import { createSky } from './sky.js';
import { createTerrain } from './terrain.js';
import { createWaterNormalTexture, createNoiseTexture } from './textures.js';
import { createBoard } from './board.js';
import { Arms } from './body.js';
import { Spray } from './spray.js';
import { Surfer, STATE } from './surfer.js';
import { PCInput } from './input.js';
import { XRControls } from './xr.js';
import { OceanAudio } from './audio.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const isMobileXR = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
let qualityName = params.get('q') || (isMobileXR ? 'low' : 'high');
const quality = QUALITY[qualityName] || QUALITY.high;
const debug = params.has('debug');

// ---------------------------------------------------------------- renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
const ocean = new Ocean(model, sky.cube, normalTex, noiseTex, quality);
scene.add(ocean.mesh);
scene.add(createTerrain(qualityName));

// board + body share the board frame
const bodyFrame = new THREE.Group();
const board = createBoard();
bodyFrame.add(board);
const arms = new Arms();
bodyFrame.add(arms.group);
scene.add(bodyFrame);

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

// ---------------------------------------------------------------- game flow
const game = {
  started: false,
  paused: true,
  invulnerable: true, // title screen
  ride: null,
  best: null,
  waves: 0,
  teleport: 0, // fade timer
  teleportTarget: null,
  look: { yaw: 0, pitch: 0 },
  standBlend: 0,
  vrStandOffset: 0,
  missTimer: 0,
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

surfer.onEvent = (type, data) => {
  if (type === 'wipeout') {
    if (game.invulnerable) {
      respawn(false);
      return;
    }
    endRide('wipeout');
    hud.toast(`<b>Wipeout</b> · ${data.reason}`, 3);
    audio.thud();
  } else if (type === 'closeout') {
    endRide('closeout');
  } else if (type === 'sink') {
    hud.toast('Too slow to stand. Paddle (scroll) to get moving again', 3);
  } else if (type === 'state' && data.to === STATE.STANDING) {
    xr.stateWas = null;
  }
};

function startRide() {
  game.ride = { time: 0, top: 0, tube: 0, dist: 0 };
}

function endRide(reason) {
  const r = game.ride;
  game.ride = null;
  if (!r || r.time < 2) return;
  const parts = [`Ride ${r.time.toFixed(1)} s`, `top ${Math.round(r.top * 3.6)} km/h`];
  if (r.tube > 0.3) parts.push(`barrel ${r.tube.toFixed(1)} s`);
  const score = Math.round(r.time * 10 + r.top * 6 + r.tube * 60);
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
  } else if (game.ride && surfer.state === STATE.STANDING) {
    const behind = s.un < -0.7 || !s.wave || s.H < 0.6;
    if (behind) endRide(s.un < -0.7 ? 'kickout' : 'over');
  } else if (game.ride && surfer.state === STATE.PRONE) endRide('over');

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
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const eyeProne = new THREE.Vector3(...EYE.prone);
const eyeStand = new THREE.Vector3(...EYE.standing);
const Yaxis = new THREE.Vector3(0, 1, 0);
const focus = new THREE.Vector3();

function updateBody(dt) {
  bodyFrame.position.copy(surfer.position);
  bodyFrame.quaternion.copy(surfer.quat);
  const standingish = surfer.state === STATE.STANDING || surfer.state === STATE.POPUP;
  const target = standingish ? 1 : 0;
  const rate = surfer.state === STATE.POPUP ? 1 / 0.42 : 1 / 0.35;
  game.standBlend += clamp(target - game.standBlend, -rate * dt, rate * dt);
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

  updateCamYaw(dt);
  _qYaw.setFromAxisAngle(Yaxis, game.camYaw);
  rig.position.copy(surfer.position);
  rig.quaternion.copy(_qYaw);

  // board orientation relative to the (smoothed) heading frame
  _q.copy(_qYaw).invert().multiply(surfer.quat);
  _e.setFromQuaternion(_q, 'YXZ');
  const b = smoothstep(0, 1, game.standBlend);
  const eye = _v.lerpVectors(eyeProne, eyeStand, b);
  eye.x += surfer.leanX * 0.14 * b;
  eye.z -= surfer.leanZ * 0.12 * b;
  eye.y -= surfer.crouch * 0.34 * b;
  // the body stays roughly upright while the board tilts on the face
  _qPart.identity().slerp(_q, mix(0.85, 0.3, b));
  eye.applyQuaternion(_qPart);
  camera.position.copy(eye);

  let pitch = game.look.pitch + _e.x * mix(0.5, 0.22, b) + mix(-0.05, -0.2, b);
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

function mix(a, b, t) {
  return a + (b - a) * t;
}

const _qPart = new THREE.Quaternion();
// The view follows the board heading with a little lag so steering corrections don't jerk it.
function updateCamYaw(dt) {
  if (game.camYaw === undefined || game.snapCam) {
    game.camYaw = surfer.yaw;
    game.snapCam = false;
  }
  let d = surfer.yaw - game.camYaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  game.camYaw += d * (1 - Math.exp(-dt * 7));
}

function updateCameraXR(dt) {
  // rig yaw follows the board heading; the calibrated head maps onto the paddling eye point
  updateCamYaw(dt);
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

function begin() {
  audio.start();
  if (!game.started) {
    game.started = true;
    game.invulnerable = false;
    respawn(false);
    hud.toast('Scroll to paddle · A / D to steer · Space to pop up', 5);
  }
  game.paused = false;
  overlay.classList.add('hidden');
  pc.enabled = true;
  pc.requestLock();
}

startBtn.addEventListener('click', begin);
pc.onLockChange = (locked) => {
  if (!locked && game.started && !renderer.xr.isPresenting) {
    game.paused = true;
    pc.enabled = false;
    resumeTitle.textContent = 'Paused';
    startBtn.textContent = 'Resume';
    overlay.classList.remove('hidden');
  }
};

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
  hud.toast('Lie or kneel down, then press the trigger to calibrate. Paddle with your arms, stand up to surf.', 7);
});
renderer.xr.addEventListener('sessionend', () => {
  ocean.setQuality(quality, qualityName === 'high');
  bodyFrame.add(arms.group);
  rig.position.set(0, 0, 0);
  rig.rotation.set(0, 0, 0);
  game.paused = true;
  overlay.classList.remove('hidden');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  spray.setViewportHeight(renderer.domElement.height);
});
spray.setViewportHeight(renderer.domElement.height);
renderer.xr.addEventListener('sessionstart', () => spray.setViewportHeight(1700));

arms.onStroke = () => audio.splash(0.8);
xr.onStroke = () => audio.splash(1);

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
    surfer.crouch = 0.6;
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
  model.spawn = () => w; // keep the scene stable
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let fpsAcc = 0,
  fpsFrames = 0,
  fps = 0;
const NO_INPUT = { thrust: 0, turn: 0, steer: 0, leanX: 0, leanZ: 0, crouch: 0 };

function frame(time, xrFrame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const inXR = renderer.xr.isPresenting;
  if (game.onFrame) game.onFrame(dt);
  const running = !game.paused || inXR || !game.started;
  let inp = NO_INPUT;

  if (inXR) {
    inp = xr.update(dt, xrFrame, surfer.state);
    for (const e of xr.consumeEvents()) {
      if (e === 'recalibrate') {
        xr.calibrate();
        hud.toast('Calibrated paddling position', 2);
      } else if (e === 'reset') respawn(true);
      else if (e === 'popUp') surfer.popUp();
      else if (e === 'layDown') surfer.layDown();
      else if (e === 'toggleStand') surfer.state === STATE.PRONE ? surfer.popUp() : surfer.layDown();
    }
  } else if (game.started && !game.paused) {
    for (let n = pc.consumeStrokes(); n > 0; n--) arms.requestStroke();
    const lean = pc.steer;
    inp = { thrust: 0, turn: 0, steer: lean, leanX: lean, leanZ: pc.leanZ, crouch: 0 };
    for (const e of pc.consumeEvents()) {
      if (e === 'toggleStand') {
        if (surfer.state === STATE.PRONE) surfer.popUp();
        else surfer.layDown();
      } else if (e === 'reset') respawn(true);
    }
  }

  if (running) {
    model.update(dt);
    const armThrust = arms.update(dt, !inXR && surfer.state === STATE.PRONE && game.started && !game.paused);
    if (!inXR) inp = { ...inp, thrust: armThrust };
    surfer.update(dt, inp);
    if (game.started) updateGame(dt);
  } else arms.update(0, false);

  // teleport fade
  let fadeAlpha = 0;
  let fadeColor = 0x000000;
  if (game.teleport > 0) {
    const before = game.teleport;
    game.teleport -= dt;
    if (before > 0.7 && game.teleport <= 0.7) respawn(false);
    fadeAlpha = Math.max(0, 1 - Math.abs(game.teleport - 0.7) / 0.7);
  }
  if (surfer.state === STATE.WIPEOUT) {
    fadeColor = 0x2a8f88;
    fadeAlpha = Math.max(fadeAlpha, Math.min(0.85, surfer.stateTime * 0.9));
  }
  fadeMat.color.setHex(fadeColor);
  fadeMat.opacity = fadeAlpha;
  fade.visible = fadeAlpha > 0.001;

  updateBody(dt);
  arms.group.visible = !inXR && surfer.state === STATE.PRONE && game.standBlend < 0.05;
  if (inXR) updateCameraXR(dt);
  else updateCameraPC(dt);

  rig.updateMatrixWorld(true);
  camera.getWorldPosition(focus);
  if (inXR) {
    // centre detail on the head
    const xc = renderer.xr.getCamera();
    xc.getWorldPosition(focus);
  }
  ocean.update(focus);
  spray.update(running ? dt : 0, focus);

  // audio: roar from breaking sections near the listener
  let roar = 0;
  for (const w of model.waves) {
    if (!w.active || w.tau < 0) continue;
    const peelX = w.peakX + w.dir * WAVE.peelSpeed * w.tau;
    const dx = Math.max(0, Math.abs(focus.x - peelX) - 15);
    const dz = Math.abs(focus.z - w.crestZ0);
    roar += (w.H / 2.6) * 30 / (30 + dx + dz * 1.5);
  }
  audio.update(roar, surfer.speed, surfer.state === STATE.WIPEOUT);

  // HUD
  const labels = { prone: 'Paddling', popup: 'Popping up', standing: 'Surfing', wipeout: 'Wipeout!' };
  const nw = nextWaveInfo();
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
    dbg = `${fps.toFixed(0)} fps | x ${surfer.x.toFixed(1)} z ${surfer.z.toFixed(1)} | un ${s.un?.toFixed(2)} yb ${s.yb?.toFixed(2)} b ${s.b?.toFixed(2)} k ${s.kappa?.toFixed(2)} H ${s.H?.toFixed(2)} | v ${surfer.speed.toFixed(2)}`;
  }
  hud.update(
    dt,
    {
      visible: game.started && !game.paused,
      stateLabel: labels[surfer.state],
      speed: surfer.speed,
      waveLabel: nw,
      inTube: surfer.inTube,
      debug: dbg,
    },
    inXR,
  );

  renderer.render(scene, camera);
}

function nextWaveInfo() {
  if (surfer.state === STATE.WIPEOUT) return '';
  if (surfer.state !== STATE.PRONE) {
    const r = game.ride;
    return r ? `Ride ${r.time.toFixed(1)} s${r.tube > 0.1 ? ` · barrel ${r.tube.toFixed(1)} s` : ''}` : '';
  }
  if (surfer.catching) return 'Caught it! Pop up (Space)';
  let best = null;
  for (const w of model.waves) {
    if (!w.active) continue;
    const t = (surfer.z - w.crestZ0) / WAVE.speed;
    if (t > 0 && (!best || t < best.t)) best = { t, w };
  }
  if (!best) return '';
  if (best.t < 3) return 'Paddle! (scroll)';
  return `Next wave ${Math.ceil(best.t)} s · ${best.w.height.toFixed(1)} m ${waveLabelFor(best.w)}`;
}

renderer.setAnimationLoop(frame);

// test / automation hook
window.__surf = { THREE, renderer, scene, camera, model, surfer, game, ocean, pc, arms, STATE, respawn, begin };
document.body.classList.add('ready');
