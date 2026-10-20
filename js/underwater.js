// Seeing things under the water.
//
// The ocean is drawn opaque (its shader computes what lies beneath analytically), so the
// board, arms and hands would vanish the moment they dip under. To show them, every body
// mesh gets a child "through the water" copy drawn after the ocean, only on pixels where
// the ocean was the front-most surface (stencil) and the body lies behind it (depth
// GREATER). That copy is tinted by the water it is seen through and blended over the
// ocean with the transmitted (1 - Fresnel) fraction, so the existing water look is untouched.
//
// When the camera itself is under water (duck dives, wipeouts) the body materials fog by
// distance, a dome provides the seabed and deep-water colour, light shafts hang from the
// surface and bubbles rise.
import * as THREE from 'three';

export const waterUniforms = {
  uWaterY: { value: 0 }, // water height at uWaterP
  uWaterGrad: { value: new THREE.Vector2() }, // surface slope there (tangent plane)
  uWaterP: { value: new THREE.Vector2() },
  uCamUnder: { value: 0 },
  uUWTime: { value: 0 },
  uUWNoise: { value: null },
  uUWLight: { value: new THREE.Vector3(1, 1, 1) }, // overall light under the water (time of day)
  uUWAbsorb: { value: new THREE.Vector3(0.46, 0.088, 0.105) }, // the spot's water (per metre)
  uUWScatter: { value: new THREE.Vector3(0.009, 0.16, 0.15) },
  // with the camera under: the water around you (as the underwater dome draws it), so
  // anything far away fades into exactly the same colour
  uUWMid: { value: new THREE.Vector3(0.01, 0.12, 0.12) },
  uUWUp: { value: new THREE.Vector3(0.05, 0.36, 0.34) },
  uUWGlow: { value: new THREE.Vector3(0.12, 0.42, 0.38) },
  uUWSun: { value: new THREE.Vector3(0, -1, 0) },
  uUWDepth: { value: 0 },
  uUWFog: { value: 0.13 }, // how thick (per metre): how far you can see
};

const ABSORB = 'uUWAbsorb';
const SCATTER = 'uUWScatter';

const PARS = /* glsl */ `
uniform float uWaterY;
uniform vec2 uWaterGrad;
uniform vec2 uWaterP;
uniform float uCamUnder;
uniform float uUWTime;
uniform sampler2D uUWNoise;
uniform vec3 uUWLight;
uniform vec3 uUWAbsorb;
uniform vec3 uUWScatter;
uniform vec3 uUWMid;
uniform vec3 uUWUp;
uniform vec3 uUWGlow;
uniform vec3 uUWSun;
uniform float uUWDepth;
uniform float uUWFog;
varying vec3 vUWPos;
`;

const FRAG = /* glsl */ `
{
  float surfY = uWaterY + dot(uWaterGrad, vUWPos.xz - uWaterP);
  float depthW = surfY - vUWPos.y;
  #ifdef UW_PASS
    // stencil + depth already guarantee water is in front; on a concave face the tangent
    // plane can sit below the real surface, so never treat these pixels as dry
    depthW = max(depthW, 0.06);
  #endif
  #ifdef UW_UNDER_ONLY
  // (only seen through the water from under it: a river's land, where the water's surface is
  // far too curved for the tangent plane to say what's under it)
  if (uCamUnder > 0.5) {
  #else
  if (depthW > 0.0 || uCamUnder > 0.5) {
  #endif
    vec3 toCam = cameraPosition - vUWPos;
    float dCam = length(toCam);
    vec3 Vd = toCam / dCam;
    float path = uCamUnder > 0.5 ? dCam : max(depthW, 0.0) / max(abs(Vd.y), 0.25);
    float dl = max(depthW, 0.0);
    float ca = texture2D(uUWNoise, vUWPos.xz * 0.16 + vec2(uUWTime * 0.021, uUWTime * 0.013)).g;
    vec3 lit = gl_FragColor.rgb * exp(-${ABSORB} * dl * 1.2) * (dl > 0.0 ? 0.8 + ca * 1.1 : 1.0);
    if (uCamUnder > 0.5) {
      // fade into the water beyond, the same colour the dome shows in that direction
      vec3 dir = -Vd;
      vec3 bg = dir.y > 0.0 ? mix(uUWMid, uUWUp, pow(dir.y, 0.7)) : mix(uUWMid, uUWMid * vec3(0.3, 0.25, 0.33), pow(-dir.y, 0.6));
      bg = (bg * exp(-uUWDepth * 0.1) + uUWGlow * pow(max(dot(dir, -uUWSun), 0.0), 6.0) * 0.5) * uUWLight;
      gl_FragColor.rgb = mix(lit * exp(-${ABSORB} * path), bg, 1.0 - exp(-path * uUWFog));
    } else {
      gl_FragColor.rgb = lit * exp(-${ABSORB} * path) + ${SCATTER} * uUWLight * (1.0 - exp(-path * 0.32));
    }
    #ifdef UW_PASS
      vec3 Nw = normalize(vec3(-uWaterGrad.x, 1.0, -uWaterGrad.y));
      float F = 0.02 + 0.98 * pow(1.0 - abs(dot(Vd, Nw)), 5.0);
      gl_FragColor.a = (1.0 - F) * (0.62 + 0.38 * exp(-depthW * 0.9));
    #endif
  }
}
`;

function patch(material, pass2) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vUWPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvUWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${FRAG}`);
  };
  material.customProgramCacheKey = () => (pass2 ? 'uw2' : 'uw1');
  material.needsUpdate = true;
}

const throughCache = new Map();
function throughWaterMaterial(src) {
  let m = throughCache.get(src);
  if (m) return m;
  m = src.clone();
  m.defines = { ...(m.defines || {}), UW_PASS: '' };
  m.transparent = true;
  m.depthWrite = false;
  m.depthFunc = THREE.GreaterDepth;
  m.side = THREE.FrontSide;
  m.stencilWrite = true; // enables the stencil test
  m.stencilRef = 1;
  m.stencilFunc = THREE.EqualStencilFunc;
  m.stencilWriteMask = 0x00;
  m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp;
  patch(m, true);
  throughCache.set(src, m);
  return m;
}

// The fog only while the camera is under the water (a river's banks and bed).
export function addUnderwaterFogWhenUnder(material) {
  material.defines = { ...(material.defines || {}), UW_UNDER_ONLY: '' };
  patch(material, false);
  material.customProgramCacheKey = () => 'uw1u';
}

// Give every mesh under root a "seen through the water" copy and underwater fog.
// (Not skinned meshes: a plain copy wouldn't follow the skeleton. The first-person legs
// only show while you're standing, above the water.)
// Just the underwater fog (for things only seen from under the water, like a reef).
export function addUnderwaterFog(material) {
  patch(material, false);
}

export function addUnderwaterPass(root) {
  const meshes = [];
  root.traverse((o) => {
    // (skinned meshes only when marked uwSkinned, like the first-person arms: the copy shares
    // their skeleton)
    if (o.isMesh && (!o.isSkinnedMesh || o.userData.uwSkinned) && !o.userData.uw && !o.userData.uwClone) meshes.push(o);
  });
  for (const mesh of meshes) {
    mesh.userData.uw = true;
    const mat = mesh.material;
    if (!mat.userData.uwPatched) {
      mat.userData.uwPatched = true;
      patch(mat, false);
    }
    let copy;
    if (mesh.isSkinnedMesh) {
      copy = new THREE.SkinnedMesh(mesh.geometry, throughWaterMaterial(mat));
      copy.bind(mesh.skeleton, mesh.bindMatrix);
      copy.frustumCulled = false;
    } else copy = new THREE.Mesh(mesh.geometry, throughWaterMaterial(mat));
    copy.userData.uwClone = true;
    copy.renderOrder = 2;
    copy.raycast = () => {};
    mesh.add(copy);
  }
}

// Ocean writes stencil = 1 wherever it ends up the front-most surface.
export function markOceanStencil(material) {
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilWriteMask = 0xff;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;
}

// ------------------------------------------------------------------ underwater environment

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * p;
}`;

const DOME_FRAG = /* glsl */ `
uniform float uCamDepth;
uniform float uBedDepth;
uniform vec3 uCamPos;
uniform vec3 uSunDir; // the sun's light under the water (already refracted)
uniform vec3 uLight;
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uMid;    // the spot's water colour around you...
uniform vec3 uUp;     // ...looking up toward the light...
uniform vec3 uGlow;   // ...and toward the sun
uniform vec3 uAbsorb;
uniform float uBedOn;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 deep = uMid * vec3(0.3, 0.25, 0.33);
  vec3 mid = uMid;
  vec3 up = uUp;
  vec3 col = d.y > 0.0 ? mix(mid, up, pow(d.y, 0.7)) : mix(mid, deep, pow(-d.y, 0.6));
  col *= exp(-uCamDepth * 0.1);
  col += uGlow * pow(max(dot(d, -uSunDir), 0.0), 6.0) * 0.5;
  if (d.y < -0.02 && uBedOn > 0.5) {
    float t = uBedDepth / -d.y;
    if (t < 90.0) {
      vec3 p = uCamPos + d * t;
      float s1 = texture2D(uNoise, p.xz * 0.021).b;
      float s2 = texture2D(uNoise, p.xz * 0.13 + 0.37).b;
      float patches = texture2D(uNoise, p.xz * 0.0042 + 0.11).a;
      vec3 sand = vec3(0.62, 0.5, 0.33) * (0.72 + 0.42 * s1) * (0.88 + 0.22 * s2);
      sand = mix(sand, vec3(0.17, 0.16, 0.09), smoothstep(0.56, 0.68, patches + 0.25 * s1) * 0.75);
      float ca = texture2D(uNoise, p.xz * 0.16 + vec2(uTime * 0.021, uTime * 0.013)).g;
      float cb = texture2D(uNoise, p.xz * 0.13 + vec2(-uTime * 0.017, uTime * 0.025) + 0.5).g;
      float caus = min(ca, cb) * 2.2 + (ca + cb) * 0.25;
      float bedD = uCamDepth + uBedDepth;
      vec3 light = (vec3(1.8, 1.72, 1.55) * (0.32 + caus * 0.9) + vec3(0.11, 0.17, 0.22)) * exp(-uAbsorb * bedD * 1.3);
      vec3 bed = sand * light;
      col = mix(col, bed * exp(-uAbsorb * t), exp(-t * 0.07));
    }
  }
  gl_FragColor = vec4(col * uLight, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHAFT_VERT = /* glsl */ `
uniform vec3 uCam;
uniform float uTop;
uniform vec3 uAxis;
uniform float uLen;
attribute vec4 aShaft;
varying vec2 vUv;
varying float vPhase;
varying float vDist;
void main() {
  // world-anchored shafts that wrap around the camera
  vec2 rel = mod(aShaft.xy - uCam.xz + 18.0, 36.0) - 18.0;
  vec3 base = vec3(uCam.x + rel.x, uTop, uCam.z + rel.y);
  vec3 p = base + uAxis * (position.y * uLen);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(uAxis, toCam));
  p += side * position.x * aShaft.z;
  vUv = position.xy;
  vPhase = aShaft.w;
  vDist = length(cameraPosition - p);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vPhase;
varying float vDist;
void main() {
  float edge = 1.0 - abs(vUv.x);
  edge *= edge;
  float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.6);
  float flick = 0.55 + 0.45 * sin(uTime * 0.7 + vPhase * 6.28) * sin(uTime * 1.3 + vPhase * 11.0);
  float a = edge * along * flick * uIntensity * smoothstep(0.6, 3.0, vDist) * exp(-vDist * 0.05);
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BUBBLE_VERT = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uScale;
varying float vLife;
varying float vDist;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.05), 64.0);
}`;

const BUBBLE_FRAG = /* glsl */ `
varying float vLife;
varying float vDist;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float ring = smoothstep(0.55, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float glint = smoothstep(0.35, 0.0, length(c - vec2(-0.35, -0.35)));
  float fade = smoothstep(0.0, 0.1, vLife) * smoothstep(1.0, 0.7, vLife) * exp(-vDist * 0.08);
  gl_FragColor = vec4(vec3(0.75, 0.97, 0.95) * 1.6, (ring * 0.7 + glint * 0.8 + 0.06) * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class UnderwaterEnv {
  constructor(noiseTex, sunDir, quality) {
    this.group = new THREE.Group();
    this.domeUniforms = {
      uCamDepth: { value: 0 },
      uBedDepth: { value: 4 },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, -1, 0) },
      uLight: { value: new THREE.Vector3(1, 1, 1) },
      uTime: { value: 0 },
      uNoise: { value: noiseTex },
      uMid: { value: new THREE.Vector3(0.01, 0.12, 0.12) },
      uUp: { value: new THREE.Vector3(0.05, 0.36, 0.34) },
      uGlow: { value: new THREE.Vector3(0.12, 0.42, 0.38) },
      uAbsorb: { value: new THREE.Vector3(0.46, 0.088, 0.105) },
      uBedOn: { value: 1 },
    };
    this.shaftBase = new THREE.Vector3(0.45, 0.95, 0.85);
    this.light = new THREE.Vector3(1, 1, 1);
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.domeUniforms, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // light shafts slanting down from the surface along the refracted sun direction
    const n = quality === 'low' ? 16 : 28;
    const pos = [],
      shaft = [],
      idx = [];
    for (let i = 0; i < n; i++) {
      const sx = (Math.random() * 2 - 1) * 18,
        sz = (Math.random() * 2 - 1) * 18;
      const w = 0.25 + Math.random() * 0.9,
        ph = Math.random();
      const b = i * 4;
      for (const [x, y] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
        pos.push(x, y, 0);
        shaft.push(sx, sz, w, ph);
      }
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('aShaft', new THREE.Float32BufferAttribute(shaft, 4));
    sg.setIndex(idx);
    this.shaftUniforms = {
      uCam: { value: new THREE.Vector3() },
      uTop: { value: 0 },
      uAxis: { value: new THREE.Vector3(0, -1, 0) },
      uLen: { value: 14 },
      uTime: { value: 0 },
      uIntensity: { value: 0.5 },
      uColor: { value: new THREE.Vector3(0.45, 0.95, 0.85) },
    };
    this.shafts = new THREE.Mesh(
      sg,
      new THREE.ShaderMaterial({
        uniforms: this.shaftUniforms,
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    this.group.add(this.shafts);

    // bubbles
    this.max = quality === 'low' ? 250 : 600;
    this.bp = new Float32Array(this.max * 3).fill(-1000);
    this.bv = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max).fill(2);
    this.dur = new Float32Array(this.max).fill(1);
    this.size = new Float32Array(this.max);
    this.cursor = 0;
    const bg = new THREE.BufferGeometry();
    this.bpAttr = new THREE.BufferAttribute(this.bp, 3).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('position', this.bpAttr);
    bg.setAttribute('aLife', this.lifeAttr);
    bg.setAttribute('aSize', this.sizeAttr);
    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.bubbles = new THREE.Points(bg, this.bubbleMat);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 5;
    this.group.add(this.bubbles);
    this.under = false;
    this.setSun(sunDir);
  }

  setViewportHeight(h) {
    this.bubbleMat.uniforms.uScale.value = h * 0.5;
  }

  // The sun as seen from under the water: refracted at the surface (Snell's law, so never
  // more than ~49 degrees from straight down), and the overall light level and tint.
  setSun(sunDir, light = [1, 1, 1]) {
    const [x, y, z] = sunDir;
    const h = Math.hypot(x, z) || 1;
    const sinT = Math.sqrt(Math.max(0, 1 - y * y)) / 1.333;
    const cosT = Math.sqrt(1 - sinT * sinT);
    const down = new THREE.Vector3((-x / h) * sinT, -cosT, (-z / h) * sinT); // the way the light travels
    this.domeUniforms.uSunDir.value.copy(down);
    waterUniforms.uUWSun.value.copy(down);
    this.shaftUniforms.uAxis.value.copy(down);
    this.domeUniforms.uLight.value.set(...light);
    this.light.set(...light);
    this.shaftUniforms.uColor.value.copy(this.shaftBase).multiply(this.light);
  }

  // The spot's water. seabed: the spot has a 3D seabed of its own (a reef), so the dome
  // shouldn't paint a flat sandy bottom under it.
  setWater(w, seabed = false) {
    const du = this.domeUniforms;
    du.uMid.value.set(...w.deep);
    du.uUp.value.set(...w.uwUp);
    du.uGlow.value.set(...w.uwGlow);
    du.uAbsorb.value.set(...w.absorb);
    du.uBedOn.value = seabed ? 0 : 1;
    waterUniforms.uUWMid.value.set(...w.deep);
    waterUniforms.uUWUp.value.set(...w.uwUp);
    waterUniforms.uUWGlow.value.set(...w.uwGlow);
    waterUniforms.uUWFog.value = w.vis;
    this.shaftBase.set(...w.shaft);
    this.shaftUniforms.uColor.value.copy(this.shaftBase).multiply(this.light);
    waterUniforms.uUWAbsorb.value.set(...w.absorb);
    waterUniforms.uUWScatter.value.set(...w.uwScatter);
  }

  clearBubbles() {
    this.life.fill(2);
    this.bp.fill(-1000);
    this.bubbles.visible = false;
  }

  bubble(x, y, z, vx, vy, vz, size, dur) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.bp[i * 3] = x;
    this.bp[i * 3 + 1] = y;
    this.bp[i * 3 + 2] = z;
    this.bv[i * 3] = vx;
    this.bv[i * 3 + 1] = vy;
    this.bv[i * 3 + 2] = vz;
    this.life[i] = 0;
    this.dur[i] = dur;
    this.size[i] = size;
  }

  burst(x, y, z, n, spread = 0.4, up = 0.6) {
    const R = Math.random;
    for (let i = 0; i < n; i++)
      this.bubble(x + (R() - 0.5) * spread, y + (R() - 0.5) * spread * 0.6, z + (R() - 0.5) * spread, (R() - 0.5) * 0.8, up * (0.3 + R()), (R() - 0.5) * 0.8, 0.008 + R() * R() * 0.035, 0.8 + R() * 1.4);
  }

  // waterY(x, z): surface height for popping bubbles
  update(dt, camPos, camUnder, camDepth, bedDepth, waterY, time) {
    this.under = camUnder;
    this.dome.visible = camUnder;
    this.shafts.visible = camUnder;
    this.dome.position.copy(camPos);
    const du = this.domeUniforms;
    du.uCamDepth.value = Math.max(0, camDepth);
    waterUniforms.uUWDepth.value = du.uCamDepth.value;
    du.uBedDepth.value = Math.max(0.3, bedDepth);
    du.uCamPos.value.copy(camPos);
    du.uTime.value = time;
    const su = this.shaftUniforms;
    su.uCam.value.copy(camPos);
    su.uTop.value = camPos.y + Math.max(0, camDepth);
    su.uTime.value = time;
    su.uIntensity.value = 0.45 * Math.exp(-Math.max(0, camDepth) * 0.15);

    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] > 1) continue;
      this.life[i] += dt / this.dur[i];
      const j = i * 3;
      // buoyancy with drag toward ~0.9 m/s rise, plus a little wobble
      this.bv[j + 1] += (0.9 - this.bv[j + 1]) * Math.min(1, dt * 2.5);
      this.bv[j] *= Math.exp(-dt * 2);
      this.bv[j + 2] *= Math.exp(-dt * 2);
      const wob = Math.sin(time * 9 + i) * 0.25;
      this.bp[j] += (this.bv[j] + wob) * dt;
      this.bp[j + 1] += this.bv[j + 1] * dt;
      this.bp[j + 2] += (this.bv[j + 2] + Math.cos(time * 7 + i) * 0.25) * dt;
      if (this.life[i] > 1 || this.bp[j + 1] > waterY(this.bp[j], this.bp[j + 2]) - 0.02) {
        this.life[i] = 2;
        this.bp[j + 1] = -1000;
      } else alive++;
    }
    this.bubbles.visible = alive > 0;
    this.bpAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
