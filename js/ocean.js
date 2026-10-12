// Ocean surface: adaptive grid + custom water shader (refraction through clear water onto
// a caustic-lit seabed, Fresnel sky reflection, sun glints, light transmission and
// sub-surface glow through thin crests and the barrel's lip, procedural foam). The seabed,
// what it looks like and the colour of the water belong to the surf spot.
import * as THREE from 'three';
import { OceanGrid } from './oceanGrid.js';
import { WAVE_GLSL, createWaveUniforms, writeSpotUniforms } from './shaders/waveChunk.js';
import { seabedGLSL } from './terrain.js';
import { SPOTS } from './spots.js';
import { SUN_DIR, SUN_COLOR } from './config.js';
import { markOceanStencil } from './underwater.js';

const VERT = /* glsl */ `
${WAVE_GLSL}
uniform sampler2D uGrid;
uniform vec3 uFocus;
uniform sampler2D uNoise;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;
varying vec2 vRest;

void main() {
  float x = texelFetch(uGrid, ivec2(int(position.x), 0), 0).r;
  float rz = texelFetch(uGrid, ivec2(int(position.y), 1), 0).r;
  vec4 info = vec4(60.0, 0.0, 0.0, 0.0);
  vec4 dummy = info;
  vec3 p = oceanPoint(x, rz, uFocus, info);
  float ex = 0.04 + 0.0015 * abs(x - uFocus.x);
  float ez = 0.012 + 0.0015 * abs(rz + crestOffset(x) - uFocus.z);
  vec3 px = oceanPoint(x + ex, rz, uFocus, dummy);
  vec3 pz = oceanPoint(x, rz + ez, uFocus, dummy);
  vec3 n = cross(pz - p, px - p);
  float ln = length(n);
  vNormal = ln > 1e-9 ? n / ln : vec3(0.0, 1.0, 0.0);
  // churned whitewater gets a lumpy surface
  float churn = clamp(info.y - 0.6, 0.0, 1.0);
  if (churn > 0.0) {
    float nz = textureLod(uNoise, vec2(x, p.z) * 0.045 + vec2(0.0, uTime * 0.05), 0.0).a;
    p += vNormal * churn * (nz - 0.35) * 0.35;
  }
  vWorld = p;
  vInfo = info;
  vRest = vec2(x, rz);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = (seabed) => /* glsl */ `
uniform float uTime;
uniform samplerCube uEnv;
uniform sampler2D uNormalTex;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;   // light from the open sky (blue at midday, dim violet at sunset)
uniform vec3 uUWLight;  // overall light under the water (white at midday)
uniform float uRipple;
uniform float uHQ;
uniform float uCamUnder;
uniform vec3 uAbsorb;   // per metre
uniform vec3 uScatter;  // in-scattered body colour
uniform vec3 uSSS;      // light through thin water
uniform vec3 uDeep;     // the water around you when you're under
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vInfo;
varying vec2 vRest;

${seabed}

#define ABSORB uAbsorb
#define SCATTER uScatter
#define SSS uSSS

float caustics(vec2 p) {
  float a = texture(uNoise, p * 0.16 + vec2(uTime * 0.021, uTime * 0.013)).g;
  if (uHQ < 0.5) return a * 1.2;
  float b = texture(uNoise, p * 0.13 + vec2(-uTime * 0.017, uTime * 0.025) + 0.5).g;
  return min(a, b) * 2.2 + (a + b) * 0.25;
}

void main() {
  vec3 N = normalize(vNormal);
  bool under = !gl_FrontFacing;
  if (under) N = -N;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float bedY = seabedY(vWorld.xz);
  if (bedY > vWorld.y + 0.03) {
    if (bedY > -0.5) discard; // land: drawn by the terrain
    // a reef left bare as a big wave draws the water off it
    vec3 wet = bedColor(vWorld.xz) * (uSunColor * max(uSunDir.y, 0.0) * 0.28 + uSkyAmb * 0.9);
    gl_FragColor = vec4(wet, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  float depth = max(vWorld.y - bedY, 0.0);

  // ---- small-scale ripples (glassy conditions) ----
  float lod = 1.0 / (1.0 + dist * 0.035);
  // world-space UVs that also work on steep and overhanging water
  vec2 wuv = vec2(vWorld.x, vWorld.z + vWorld.y * 0.9);
  vec2 uv1 = wuv * 0.085 + vec2(uTime * 0.011, uTime * 0.019);
  vec2 uv2 = wuv * 0.29 + vec2(-uTime * 0.027, uTime * 0.016);
  vec3 n1 = texture(uNormalTex, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture(uNormalTex, uv2).xyz * 2.0 - 1.0;
  vec2 slope = (n1.xy * 0.7 + n2.xy * 0.22 * uHQ) * uRipple * lod;
  // streaks drawn up the face of steep water
  float steepW = smoothstep(0.25, 0.85, 1.0 - abs(N.y)) * smoothstep(0.1, 0.4, vInfo.w + vInfo.z) * uHQ;
  if (steepW > 0.0) {
    vec3 ns = texture(uNormalTex, vec2(vWorld.x * 0.32 + vWorld.z * 0.1, vWorld.y * 0.045 - uTime * 0.05)).xyz * 2.0 - 1.0;
    slope += ns.xy * steepW * 0.35 * lod;
  }
  float foamIn = clamp(vInfo.y, 0.0, 2.0);
  slope *= 1.0 + foamIn * 1.5;
  vec3 pert = vec3(slope.x, 0.0, slope.y);
  pert -= N * dot(N, pert);
  N = normalize(N + pert);

  if (under && uCamUnder > 0.5) {
    // Looking up at the surface from below: Snell's window onto the sky, total internal
    // reflection of the dark water outside it, foam glowing white, limited visibility.
    vec3 Tu = refract(-V, N, 1.333);
    // outside the window the surface mirrors the water below; ripples make it shimmer
    vec3 Rd = reflect(-V, N);
    vec3 below = mix(uDeep * 1.17, uDeep * 0.32, pow(clamp(-Rd.y, 0.0, 1.0), 0.6)) * uUWLight;
    vec3 ucol;
    if (dot(Tu, Tu) < 1e-4) {
      ucol = below;
    } else {
      float Fu = 0.02 + 0.98 * pow(1.0 - max(dot(V, N), 0.0), 5.0);
      vec3 skyC = textureLod(uEnv, Tu, 0.5).rgb;
      skyC += uSunColor * pow(max(dot(Tu, uSunDir), 0.0), 400.0) * 25.0;
      ucol = mix(skyC, below, Fu);
    }
    float fa = clamp(vInfo.y, 0.0, 1.6);
    vec2 fuvU = vec2(vWorld.x, vWorld.z + vWorld.y * 0.9);
    float fp = texture(uNoise, fuvU * 0.16 + vec2(0.0, -uTime * 0.03)).r * 0.6 + texture(uNoise, fuvU * 0.047 + 0.3).r * 0.4;
    float fm = smoothstep(1.0 - fa * 0.7, 1.15 - fa * 0.55, fp + 0.15) * min(fa * 1.4, 1.0);
    ucol = mix(ucol, vec3(0.75, 0.95, 0.95) * 1.4 * uUWLight, clamp(fm + smoothstep(1.0, 1.7, fa) * 0.7, 0.0, 1.0));
    ucol = mix(ucol, uDeep * uUWLight, 1.0 - exp(-dist * 0.085));
    gl_FragColor = vec4(ucol, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  if (under) F = NdV < 0.66 ? 1.0 : F; // total internal reflection seen from below

  vec3 R = reflect(-V, N);
  vec3 refl = textureLod(uEnv, R, 1.0 + 3.0 * (1.0 - lod) * 0.5).rgb;
  float RdL = max(dot(R, uSunDir), 0.0);
  vec3 spec = uSunColor * (pow(RdL, 1400.0) * 70.0 + pow(RdL, 180.0) * 1.6 + pow(RdL, 24.0) * 0.06);

  // ---- light through the water ----
  vec3 T = refract(-V, N, 0.75);
  if (dot(T, T) < 0.01) T = -V;
  float thick = vInfo.x;
  float hf = vInfo.w;
  float lip = vInfo.z;
  float tBed = T.y < -0.02 ? depth / -T.y : 1e4;
  float tExit = thick / max(length(T.xz), 0.25);
  float exitW = smoothstep(-0.45, 0.05, T.y) * smoothstep(0.12, 0.55, hf);
  exitW = max(exitW, lip * 0.6);
  exitW *= step(tExit, tBed);
  float tPath = mix(min(tBed, 120.0), tExit, exitW);

  vec3 bedP = vWorld + T * min(tBed, 250.0);
  vec3 sunDown = uSunColor * uSunDir.y;
  vec3 skyAmb = uSkyAmb;
  vec3 bedLight = (sunDown * (0.32 + caustics(bedP.xz) * smoothstep(14.0, 1.5, depth) * 0.9) + skyAmb * 0.35) * exp(-ABSORB * depth * 1.3);
  vec3 bedCol = bedColor(bedP.xz) * bedLight;
  vec3 through = textureLod(uEnv, normalize(mix(T, -V, 0.5)), 2.0).rgb;
  vec3 behind = mix(bedCol, through, exitW);
  vec3 trans = exp(-ABSORB * tPath);
  vec3 lightIn = sunDown * 0.8 + skyAmb;
  vec3 body = SCATTER * lightIn * (1.0 - exp(-tPath * 0.32)) * (0.8 + 0.9 * hf);
  vec3 water = behind * trans + body;

  // sun light scattered through thin water (crest, lip)
  float toward = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  float thin = exp(-thick * 0.45);
  water += SSS * uSunColor * thin * (0.12 + 1.1 * toward) * smoothstep(0.08, 0.7, hf + lip) * 0.55;

  vec3 col = mix(water, refl, F);

  // ---- foam ----
  float shore = smoothstep(0.55, 0.02, depth) * (0.55 + 0.45 * sin(uTime * 0.9 + vWorld.x * 0.07 + vWorld.z * 0.4));
  float foamAmt = clamp(foamIn + shore * 0.8 + bedFoam(vWorld.xz), 0.0, 1.6);
  vec2 fuv = vec2(vWorld.x, vWorld.z + vWorld.y * 0.9);
  float f1 = texture(uNoise, fuv * 0.16 + vec2(0.0, -uTime * 0.03)).r;
  float f2 = texture(uNoise, fuv * 0.047 + 0.3).r;
  float f3 = texture(uNoise, fuv * 0.021).a;
  // fine bubbles dominate up close so foam never turns into big flat splats
  float near = smoothstep(18.0, 3.0, dist) * step(0.001, foamAmt);
  float f0 = near > 0.0 ? texture(uNoise, fuv * 0.62 + vec2(uTime * 0.04, 0.0)).r : 0.0;
  float fpat = mix(f1 * 0.55 + f2 * 0.45, f0 * 0.6 + f1 * 0.4, near) + (f3 - 0.5) * 0.4;
  float foamMask = smoothstep(1.0 - foamAmt * 0.7, 1.15 - foamAmt * 0.55, fpat + 0.15) * min(foamAmt * 1.4, 1.0);
  foamMask = clamp(foamMask + smoothstep(1.0, 1.7, foamAmt) * 0.7, 0.0, 1.0);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 foamCol = vec3(0.9, 0.95, 0.97) * (uSunColor * (0.35 + 0.65 * diff) + skyAmb * 0.75);
  foamCol += SSS * thin * 0.25;
  col = mix(col, foamCol, foamMask);
  col += spec * (1.0 - foamMask) * (under ? 0.0 : 1.0);

  // ---- aerial perspective ----
  vec3 hzDir = normalize(vec3(-V.x, 0.015, -V.z));
  vec3 haze = textureLod(uEnv, hzDir, 3.0).rgb;
  col = mix(col, haze, 1.0 - exp(-dist * 0.00024));

  if (under) col = mix(col, uDeep * 1.7 * uUWLight, 0.35);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ocean {
  constructor(model, env, normalTex, noiseTex, quality) {
    this.model = model;
    this.grid = new OceanGrid(quality.cols, quality.rows);
    this.uniforms = {
      ...createWaveUniforms(model),
      uGrid: { value: this.grid.texture },
      uFocus: { value: new THREE.Vector3() },
      uEnv: { value: env },
      uNormalTex: { value: normalTex },
      uNoise: { value: noiseTex },
      uSunDir: { value: new THREE.Vector3(...SUN_DIR) },
      uSunColor: { value: new THREE.Vector3(...SUN_COLOR).multiplyScalar(3.2) },
      uSkyAmb: { value: new THREE.Vector3(0.32, 0.48, 0.62) },
      uUWLight: { value: new THREE.Vector3(1, 1, 1) },
      uRipple: { value: 0.14 },
      uHQ: { value: 1 },
      uCamUnder: { value: 0 },
      uAbsorb: { value: new THREE.Vector3() },
      uScatter: { value: new THREE.Vector3() },
      uSSS: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Vector3() },
      uReefTex: { value: null },
    };
    this.spot = 'margaret';
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG(seabedGLSL(this.spot)),
      side: THREE.DoubleSide,
    });
    this.setWater(SPOTS.margaret.water);
    markOceanStencil(this.material);
    this.mesh = new THREE.Mesh(this.grid.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setQuality(quality, hq) {
    const old = this.grid;
    this.grid = new OceanGrid(quality.cols, quality.rows);
    this.uniforms.uGrid.value = this.grid.texture;
    this.mesh.geometry = this.grid.geometry;
    this.uniforms.uHQ.value = hq ? 1 : 0;
    old.geometry.dispose();
    old.texture.dispose();
  }

  // A surf spot: its wave, seabed and water. reefTex: the coral texture, where there's a reef.
  setSpot(id, reefTex = null) {
    writeSpotUniforms(this.uniforms);
    this.setWater(SPOTS[id].water);
    this.uniforms.uReefTex.value = reefTex;
    if (id === this.spot) return;
    this.spot = id;
    this.material.fragmentShader = FRAG(seabedGLSL(id));
    this.material.needsUpdate = true;
  }

  setWater(w) {
    const u = this.uniforms;
    u.uAbsorb.value.set(...w.absorb);
    u.uScatter.value.set(...w.scatter);
    u.uSSS.value.set(...w.sss);
    u.uDeep.value.set(...w.deep);
  }

  update(focus) {
    this.model.writeUniforms(this.uniforms);
    this.uniforms.uFocus.value.copy(focus);
    this.grid.update(focus.x, focus.z, this.model);
  }
}
