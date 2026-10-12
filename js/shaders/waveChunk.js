// GLSL mirror of js/wave.js. Keep the two in sync.
import * as THREE from 'three';
import { WAVE, SWELL } from '../config.js';
import { CURL } from '../wave.js';

export function createWaveUniforms(model) {
  const u = {
    uTime: { value: 0 },
    uWaveA: { value: Array.from({ length: WAVE.slots }, () => new THREE.Vector4()) },
    uWaveB: { value: Array.from({ length: WAVE.slots }, () => new THREE.Vector4()) },
    uWaveP: { value: new THREE.Vector4() },
    uWaveQ: { value: new THREE.Vector4() },
    uWaveC: { value: new THREE.Vector4() },
    uWaveD: { value: new THREE.Vector4() },
    uWaveE: { value: new THREE.Vector4() },
    uWaveF: { value: new THREE.Vector4() },
    uSwellA: { value: model.swell.map((c) => new THREE.Vector4(c.dx, c.dz, c.amp, c.k)) },
    uSwellB: { value: model.swell.map((c) => new THREE.Vector4(c.horiz, c.omega, c.phase, c.lambda)) },
  };
  writeSpotUniforms(u);
  return u;
}

// The surf spot's wave (WAVE and CURL hold the spot being played).
export function writeSpotUniforms(u) {
  u.uWaveP.value.set(WAVE.peelSpeed, WAVE.backSpeed, WAVE.tThrow, WAVE.tTube);
  u.uWaveQ.value.set(WAVE.tCollapse, WAVE.curveK, WAVE.curveMax, WAVE.speed);
  u.uWaveC.value.set(CURL.rin, CURL.yc, CURL.ex, CURL.acoshYc);
  u.uWaveD.value.set(CURL.sweep, CURL.lfLo, CURL.lfHi, CURL.trough);
  u.uWaveE.value.set(WAVE.breakWidth, WAVE.backWidth, WAVE.peelFlat, WAVE.peelFall);
  u.uWaveF.value.set(WAVE.backFall, CURL.lbLo, CURL.lbHi, CURL.lip);
}

export const WAVE_GLSL = /* glsl */ `
#define WAVE_SLOTS ${WAVE.slots}
#define SWELL_N ${SWELL.length}
uniform float uTime;
uniform vec4 uWaveA[WAVE_SLOTS]; // crestZ0, peakX, dir, tau
uniform vec4 uWaveB[WAVE_SLOTS]; // H, S, steepG, collapseG
uniform vec4 uWaveP;             // peelSpeed, backSpeed, tThrow, tTube
uniform vec4 uWaveQ;             // tCollapse, curveK, curveMax, speed
uniform vec4 uWaveC;             // curl: tube radius, centre height, width stretch, acosh(1/sqrt(centre))
uniform vec4 uWaveD;             // lip sweep, face length (gentle, steep), trough
uniform vec4 uWaveE;             // first section width (peel side, other side), fade along the crest: flat, fall
uniform vec4 uWaveF;             // fade on the other side, back length (gentle, steep), lip thickness
uniform vec4 uSwellA[SWELL_N];   // dir.x, dir.z, amp, k
uniform vec4 uSwellB[SWELL_N];   // horiz, omega, phase, lambda

const float W_PI = 3.14159265;
#define RIN uWaveC.x
#define YC uWaveC.y
#define EX uWaveC.z
#define ACOSH_YC uWaveC.w
#define SWEEP uWaveD.x
const float YB0 = 0.45;

float sech2(float x) { float c = cosh(clamp(x, -40.0, 40.0)); return 1.0 / (c * c); }

float crestOffset(float x) { return -min(uWaveQ.z, uWaveQ.y * x * x); }

float baseProfile(float un, float steep, out float Lf, out float Lb) {
  Lf = mix(uWaveD.y, uWaveD.z, steep);
  Lb = mix(uWaveF.y, uWaveF.z, steep);
  float y;
  if (un >= 0.0) {
    float t = (un - 2.2 * Lf) / (1.3 * Lf);
    float d = (un - 1.7 * Lf) / (1.2 * Lf);
    y = sech2(un / Lf) - steep * smoothstep(0.0, Lf, un) * (0.13 * exp(-t * t) + uWaveD.w * exp(-d * d));
  } else {
    y = 0.8 * sech2(un / Lb) + 0.2 * sech2(un / (3.5 * Lb));
  }
  return y;
}

// Displacement of wave i at rest coords (x, rowZ). Returns (0, dy, dz).
// info: x = water thickness (m), y = foam, z = lip/curl weight, w = normalised height.
vec3 mainWave(int i, float x, float rowZ, inout vec4 info) {
  vec4 A = uWaveA[i];
  vec4 B = uWaveB[i];
  if (B.x < 0.01) return vec3(0.0);
  float S = B.y;
  float u = rowZ - A.x;
  float un = u / S;

  // along-crest section state
  float dx = x - A.y;
  float side = dx * A.z;
  float age = side >= 0.0 ? A.w - max(side - uWaveE.x, 0.0) / uWaveP.x : A.w - max(-side - uWaveE.y, 0.0) / uWaveP.y;

  // foam left behind sections that had already broken when this water passed the crest
  if (u < -1.2 * S) info.y += 0.6 * smoothstep(0.0, 2.0, age + u / uWaveQ.w) * exp(u / 70.0) * smoothstep(-1.2 * S, -3.5 * S, u) * smoothstep(0.0, 0.5, B.x);

  if (un < -16.0 || un > 7.0) return vec3(0.0);

  float e = side >= 0.0 ? max(side - uWaveE.z, 0.0) / uWaveE.w : side / uWaveF.x;
  float env = exp(-e * e);
  float kappa = max(smoothstep(uWaveP.w, uWaveP.w + uWaveQ.x, age), B.w);
  float H = B.x * env * (1.0 - 0.5 * kappa);
  float b = smoothstep(0.0, uWaveP.z, age) * smoothstep(0.05, 0.3, H / S);
  float steep = B.z * mix(0.55, 1.0, exp(-max(-age, 0.0) / 5.0));

  float Lf, Lb;
  float yb = baseProfile(un, steep, Lf, Lb);
  float zn = un;
  float yn = yb;
  float zc = Lf * ACOSH_YC + RIN * EX;
  float sF = un >= 0.0 ? clamp((yb - YC) / (1.0 - YC), 0.0, 1.0) : 0.0;
  float sB = un < 0.0 ? clamp((yb - YB0) / (1.0 - YB0), 0.0, 1.0) : 0.0;
  float s = max(sF, sB);
  float kr = 0.0;
  float lipThick = 0.04 + uWaveF.w * pow(1.0 - s, 1.5);
  if (s > 0.0 && b > 0.0) {
    float dz = (un - zc) / EX;
    float dy = yb - YC;
    float phiB = atan(dy, dz);
    float rB = sqrt(dz * dz + dy * dy);
    float phiT = W_PI - s * SWEEP;
    float rT = RIN * (1.0 + 0.22 * s * s);
    float wgt;
    if (un >= 0.0) {
      wgt = smoothstep(0.0, 0.35, s);
    } else {
      rT += lipThick;
      wgt = smoothstep(0.0, 0.55, s);
    }
    phiT = mix(phiB, phiT, wgt);
    rT = mix(rB, rT, wgt);
    float k = smoothstep(0.0, 1.0, b * 1.5 - (1.0 - s) * 0.5);
    kr = smoothstep(0.0, 1.0, b * 2.4 - (1.0 - s) * 0.9);
    float phi = mix(phiB, phiT, k);
    float r = mix(rB, rT, kr);
    zn = zc + EX * r * cos(phi);
    yn = YC + r * sin(phi);
  }

  // horizontal thickness of the water body at this height (for light transmission)
  float hb = clamp(yb, 0.0, 1.0);
  float body = hb > 0.02 ? (Lf + 1.3 * Lb) * acosh(1.0 / sqrt(clamp(hb, 0.02, 1.0))) * S : 60.0;
  float thick = mix(body, lipThick * S * 1.2, kr);
  info.x = min(info.x, thick);

  // foam: lip edge, exploding/collapsed whitewater
  float foam = smoothstep(0.55, 1.0, s) * kr * 0.7;
  foam += kappa * smoothstep(3.6, 1.0, un) * exp(-max(0.0, -un - 0.3) / (1.0 + 4.0 * kappa)) * 1.25;
  info.y += foam * smoothstep(0.0, 0.4, B.x);
  info.z = max(info.z, kr * step(0.001, s));
  info.w = max(info.w, clamp(yb, 0.0, 1.2) * smoothstep(0.1, 0.6, H / S));

  return vec3(0.0, yn * H, zn * S - u);
}

vec3 swell(vec2 p, float dist) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < SWELL_N; i++) {
    vec4 a = uSwellA[i];
    vec4 c = uSwellB[i];
    float f = 1.0 - smoothstep(c.w * 4.0, c.w * 9.0, dist);
    float th = a.w * dot(a.xy, p) - c.y * uTime + c.z;
    d.y += a.z * f * sin(th);
    d.xz += a.xy * (c.x * f * cos(th));
  }
  return d;
}

// World-space ocean point for rest coords (x, rowZ).
vec3 oceanPoint(float x, float rowZ, vec3 camPos, inout vec4 info) {
  float zr = rowZ + crestOffset(x);
  vec3 p = vec3(x, 0.0, zr);
  for (int i = 0; i < WAVE_SLOTS; i++) p += mainWave(i, x, rowZ, info);
  float dist = length(vec2(x, zr) - camPos.xz);
  p += swell(vec2(x, zr), dist);
  return p;
}
`;
