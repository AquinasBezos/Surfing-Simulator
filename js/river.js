// The river at the Eisbach: a standing wave. Nothing moves along the river but the water:
// the surface keeps one shape while the water runs through it at 3 to 5 m/s.
//
// River coordinates (the model's): X downstream from the wave's centre, Z across (+ the east
// bank), Y up from the mean water level downstream. In the world the river runs toward -z
// (world x = Z, world z = -X), so the wave's face looks the way an ocean wave's face does
// (+z) and the surfing physics works as it is: on a standing wave you hold your place on the
// face because the slope pulls you upstream as hard as the water drags you downstream.
//
// Along the river: the fast, shallow inflow from under the bridge (0.15 m), its drop into the
// trough at the foot of the wave, the face up to the crest (about a metre above the trough),
// a foaming pile on top, the back running down into a train of smaller standing waves, and
// the slower water downstream (0 m).
import * as THREE from 'three';
import { markOceanStencil } from './underwater.js';

const GRAVITY = 9.81;
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// cubic Hermite between (x0, y0) with slope m0 and (x1, y1) with slope m1
function herm(x, x0, y0, m0, x1, y1, m1) {
  const h = x1 - x0,
    t = (x - x0) / h,
    t2 = t * t,
    t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

// the wave, for a wave height A (trough to crest, in the middle of the channel)
function shapeOf(A) {
  const L = 2.2 * (0.55 + 0.45 * A); // face length
  const xC = 0.7; // crest
  return {
    A,
    L,
    xC,
    xT: xC - L, // trough
    yT: -0.3 * A,
    back: 1.5 + 0.5 * A, // crest to the bottom of the back
    yUp: 0.15, // the inflow under the bridge
    xDrop: -3.5, // where the inflow starts down into the trough
    U0: 4.4, // inflow speed (m/s)
  };
}

export class River {
  // channel(X): [zMin, zMax], the channel's walls at X (river coordinates)
  constructor(channel, A = 1) {
    this.channel = channel;
    this.time = 0;
    this.wave = { id: 'eisbach', active: true, H: A, S: A, collapseG: 0, steepG: 1, crestZ0: 0, peakX: 0, dir: 0, tau: 0 };
    this.setHeight(A);
  }

  setHeight(A) {
    A = Math.min(1.4, Math.max(0.5, A || 1));
    if (this.P && this.P.A === A) return;
    this.P = shapeOf(A);
    this.wave.H = A;
    this.wave.S = A;
    this.wave.crestZ0 = -this.P.xC; // (world z of the crest)
    if (this.mesh) this.rebuild();
  }

  // how much of the wave there is across the channel: all of it in the middle, less against
  // the walls (the crest also bends a little downstream there)
  edge(X, Z) {
    const [z0, z1] = this.channel(X);
    const mid = (z0 + z1) / 2,
      half = (z1 - z0) / 2;
    return ss(half - 2.8, half, Math.abs(Z - mid));
  }

  // The wave across the channel at Z: { amp, xC, xT, yT } (the crest bends downstream and the
  // wave is lower against the walls)
  across(Z, X) {
    const P = this.P;
    const e = this.edge(X, Z);
    const amp = P.A * (1 - 0.74 * e);
    const xC = P.xC + 0.45 * e * P.A;
    return { e, amp, xC, xT: xC - P.L, yT: P.yT * (1 - 0.45 * e) };
  }

  // Surface height at X, Z (river coordinates): one smooth curve (Hermite segments meeting with
  // the same slope) from the inflow, over the drop, through the trough, up the face (steepest
  // two-thirds of the way up), over the crest, down the back, into the train of smaller waves.
  surface(X, Z) {
    const P = this.P;
    const { e, amp, xC, xT, yT } = this.across(Z, X);
    const y0 = P.yUp,
      y1 = P.yUp - 0.07;
    if (X < P.xDrop) return X < P.xDrop - 6 ? y0 : herm(X, P.xDrop - 6, y0, 0, P.xDrop, y1, -0.03);
    if (X < xT) return herm(X, P.xDrop, y1, -0.03, xT, yT, 0);
    const xM = xT + 0.62 * P.L,
      yM = yT + 0.52 * amp,
      mM = (1.5 * amp) / P.L;
    if (X < xM) return herm(X, xT, yT, 0, xM, yM, mM);
    const yC = yT + amp;
    if (X < xC) return herm(X, xM, yM, mM, xC, yC, 0);
    const yB = 0.05 * P.A;
    const xB = xC + P.back;
    if (X < xB) return herm(X, xC, yC, 0, xB, yB, 0);
    // the train of standing waves behind it, dying away downstream
    const d = X - xB;
    const train = 0.22 * P.A * (1 - 0.5 * e) * Math.exp(-d / 7) * (0.5 - 0.5 * Math.cos((2 * Math.PI * d) / 3.4));
    return yB * Math.exp(-(d * d) / 30) + train;
  }

  // how fast the surface water runs downstream (m/s) at X, with the surface at y there
  flow(X, Z, y) {
    const P = this.P;
    const xT = P.xC - P.L;
    if (X < P.xDrop) return P.U0;
    // speeding up over the drop; climbing the face costs it speed; slow behind the crest
    const U1 = P.U0 + 0.6;
    if (X < xT) return P.U0 + (U1 - P.U0) * ss(P.xDrop, xT, X);
    const yT = P.yT;
    const climb = Math.max(0, y - yT);
    const onFace = Math.sqrt(Math.max(U1 * U1 - 2 * GRAVITY * climb * 0.55, 2.2 * 2.2));
    const behind = 1.7 + 0.6 * Math.exp(-(X - P.xC) / 12);
    return onFace + (behind - onFace) * ss(P.xC - 0.1, P.xC + 0.6, X);
  }

  // whitewater on the surface (0..1): the foam pile on the crest and behind it, the churn
  // against the walls, foam trailing downstream
  foam(X, Z) {
    const P = this.P;
    const { e, xC } = this.across(Z, X);
    // a rolling white pile on the crest, feathering up the top of the face; broken whitewater
    // over the back with the green showing through, thinning out downstream
    const pile = ss(xC - 0.55, xC - 0.05, X) * (1 - ss(xC + 0.4, xC + 1.9, X));
    const back = 0.6 * ss(xC, xC + 0.8, X) * (1 - ss(xC + P.back, xC + P.back + 7, X));
    const trail = 0.38 * ss(xC, xC + 1.2, X) * Math.exp(-Math.max(0, X - xC) / 16);
    // churn against the walls, where the wave breaks on them (less on the face)
    const walls = 0.6 * ss(0.6, 1, e) * ss(P.xDrop - 1, P.xDrop + 1.5, X);
    // a white line where the inflow pours over the sill into the drop
    const sill = 0.35 * ss(P.xDrop - 0.8, P.xDrop, X) * (1 - ss(P.xDrop + 0.2, P.xDrop + 1.6, X));
    return Math.min(1, Math.max(pile, back, trail, walls, sill));
  }

  // ---------------------------------------------------------------- the physics' view
  // world <-> river
  heightAt(x, z) {
    return this.surface(-z, x);
  }

  inChannel(x, z, margin = 0) {
    const [z0, z1] = this.channel(-z);
    return x > z0 + margin && x < z1 - margin;
  }

  // As WaveModel.sample(): the surface, the water's velocity, and where you are on the wave
  // (un: from the crest toward the trough in wave heights; yb: how far up the face, 0..1)
  sample(x, z, out) {
    const P = this.P;
    const X = -z,
      Z = x;
    const y = this.surface(X, Z);
    const { xC, amp, yT } = this.across(Z, X);
    out.height = y;
    out.waterVz = -this.flow(X, Z, y); // (downstream is -z)
    out.river = true;
    out.wave = this.wave;
    out.u = xC - X;
    out.un = (xC - X) / P.A;
    out.yb = Math.min(1, Math.max(0, (y - yT) / amp));
    out.H = amp;
    out.S = P.A;
    out.b = 0; // (it doesn't pitch: no lip, no barrel)
    // the foam pile on top: ride up into it and it takes you down
    out.kappa = ss(xC - 0.22, xC - 0.02, X) * (1 - ss(xC + P.back, xC + P.back + 2, X));
    out.age = 0;
    out.steep = 1;
    return out;
  }

  // where you'd sit if you stood still in the middle (for jumping in): low on the face, where
  // the slope just holds you against the water
  restX() {
    return this.P.xC - this.P.L * 0.82;
  }

  // ---------------------------------------------------------------- the water you see
  // A mesh over the channel from under the bridge to the end of the model, dense around the
  // wave. It reaches past the walls under the banks (ground(X, Z): the model's ground there),
  // kept just below the ground, so the water always meets the bank, whatever shape the wall.
  // Its shape is fixed; the shader runs the water through it. Ripples and foam are carried by
  // `aTau`, the time the water takes to get to each row, so they move at the local speed and
  // bunch up where it slows, without smearing out as time goes on.
  build({ env, normalTex, noiseTex, rows, ground }) {
    this.rowsX = rows;
    this.ground = ground || (() => null);
    const COLS = 78;
    const n = rows.length * COLS;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.attr = { flow: new Float32Array(n), foam: new Float32Array(n), uvr: new Float32Array(n * 2), tau: new Float32Array(n), face: new Float32Array(n) };
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aFlow', new THREE.BufferAttribute(this.attr.flow, 1));
    geo.setAttribute('aFoam', new THREE.BufferAttribute(this.attr.foam, 1));
    geo.setAttribute('aRiver', new THREE.BufferAttribute(this.attr.uvr, 2));
    geo.setAttribute('aTau', new THREE.BufferAttribute(this.attr.tau, 1));
    geo.setAttribute('aFace', new THREE.BufferAttribute(this.attr.face, 1));
    const idx = [];
    for (let i = 0; i < rows.length - 1; i++)
      for (let j = 0; j < COLS - 1; j++) {
        const a = i * COLS + j,
          b = a + 1,
          c = a + COLS,
          d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    geo.setIndex(idx);
    this.cols = COLS;
    this.geo = geo;
    this.uniforms = {
      uTime: { value: 0 },
      uPhase: { value: new THREE.Vector4() }, // fract(time * the texture speeds): see update()
      uEnv: { value: env },
      uNormalTex: { value: normalTex },
      uNoise: { value: noiseTex },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(1, 1, 1) },
      uSkyAmb: { value: new THREE.Vector3(0.32, 0.48, 0.62) },
      uCamUnder: { value: 0 },
      uDeep: { value: new THREE.Vector3(0.03, 0.11, 0.095) },
      uShallow: { value: new THREE.Vector3(0.17, 0.42, 0.34) },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
    markOceanStencil(this.material); // (the board and your legs show through it, as with the sea)
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.rebuild();
    return this.mesh;
  }

  rebuild() {
    const rows = this.rowsX,
      C = this.cols;
    const { pos, attr } = this;
    const EXT = 2.2; // how far under the banks
    const IN = 0.22; // (the share of the columns under each bank)
    let k = 0;
    let tau = 0;
    for (let i = 0; i < rows.length; i++) {
      const X = rows[i];
      const [z0, z1] = this.channel(X);
      // the water's travel time to this row, along the middle of the channel
      if (i > 0) {
        const Xp = rows[i - 1],
          mid = (z0 + z1) / 2;
        const fa = this.flow(Xp, mid, this.surface(Xp, mid)),
          fb = this.flow(X, mid, this.surface(X, mid));
        tau += (X - Xp) * 0.5 * (1 / fa + 1 / fb);
      }
      for (let j = 0; j < C; j++) {
        const t = j / (C - 1);
        let Z;
        if (t < IN) Z = z0 - EXT * (1 - t / IN);
        else if (t > 1 - IN) Z = z1 + EXT * ((t - (1 - IN)) / IN);
        else {
          // across the channel: denser toward the walls, where the wave changes
          const u = (t - IN) / (1 - 2 * IN);
          const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
          Z = z0 + (z1 - z0) * (0.2 * u + 0.8 * s);
        }
        const Zc = Math.min(z1, Math.max(z0, Z));
        let y = this.surface(X, Zc);
        // Past the walls the water carries on level: where the bank climbs out of it (the
        // cobbled east bank) the bank hides it, so the water meets the wall wherever they cross.
        // Ground just below the water that stays low further out (the west bank's concrete
        // apron) would be flooded, so there the water is kept under it.
        if (Z < z0 - 0.02 || Z > z1 + 0.02) {
          const g = this.ground(X, Z);
          if (g !== null && g > -0.35 && g < y + 0.05) {
            const out = Z > z1 ? 1 : -1;
            let rises = false;
            for (let d = 0.25; d <= 1.01 && !rises; d += 0.25) {
              const gd = this.ground(X, Z + out * d);
              rises = gd !== null && gd > y + 0.04;
            }
            if (!rises) y = g - 0.06;
          }
        }
        pos[k * 3] = X;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = Z;
        attr.flow[k] = this.flow(X, Zc, y);
        attr.foam[k] = this.foam(X, Zc);
        attr.uvr[k * 2] = X;
        attr.uvr[k * 2 + 1] = Z;
        attr.tau[k] = tau;
        // how far up the face (0 at the trough, 1 at the crest): its colour
        const a = this.across(Zc, X);
        attr.face[k] = X > a.xT && X < a.xC + 0.6 ? Math.min(1, Math.max(0, (y - a.yT) / a.amp)) : 0;
        k++;
      }
    }
    for (const a of Object.values(this.geo.attributes)) a.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  update(dt, camUnder) {
    if (!this.uniforms) return;
    const t = this.time;
    // (the texture offsets wrap: in float, time times a speed loses its fractions after a while)
    const f = (v) => v - Math.floor(v);
    this.uniforms.uTime.value = f(t / 1000) * 1000;
    this.uniforms.uPhase.value.set(f(t * TEX[0]), f(t * TEX[1]), f(t * TEX[2]), f(t * TEX[3]));
    this.uniforms.uCamUnder.value = camUnder ? 1 : 0;
  }

  setLight(sunDir, sunColor, skyAmb) {
    if (!this.uniforms) return;
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSkyAmb.value.copy(skyAmb);
  }
}

// Texture repeats per second of the water's travel (the ripples, the fine and broad foam, the
// streaks along the face): at the inflow's 4.5 m/s, 0.12 .. 0.5 repeats per metre.
const TEX = [2.2, 4.8, 0.7, 1.1];

// The mesh lives in the model's frame (the Eisbach group turns it into the world).
const VERT = /* glsl */ `
attribute float aFlow;
attribute float aFoam;
attribute vec2 aRiver;
attribute float aTau;
attribute float aFace;
uniform float uTime;
uniform vec4 uPhase;
uniform sampler2D uNoise;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFlow;
varying float vFoam;
varying float vFace;
varying vec2 vRiver;
varying float vTau;
void main() {
  vec3 p = position;
  // the surface boils: lumps carried with the water, bigger where it's white
  float lump = texture2D(uNoise, vec2(aTau * ${TEX[2]} - uPhase.z, aRiver.y * 0.13)).a - 0.5;
  float boil = sin(aRiver.y * 2.3 - uTime * 4.1 + aTau * 9.0) * sin(aTau * 23.0 - uTime * 6.0);
  p.y += (0.05 * lump + 0.035 * boil * aFoam) * (0.3 + aFoam);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vFlow = aFlow;
  vFoam = aFoam;
  vFace = aFace;
  vRiver = aRiver;
  vTau = aTau;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uPhase;
uniform samplerCube uEnv;
uniform sampler2D uNormalTex;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform float uCamUnder;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFlow;
varying float vFoam;
varying float vFace;
varying vec2 vRiver;
varying float vTau;

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  bool below = !gl_FrontFacing;
  if (below) N = -N;
  // where the water is, in texture terms: x along the flow (by travel time), y across
  float ax = vTau, ay = vRiver.y;

  // ripples carried with the flow, stretched along it; long lines down the glassy face
  vec3 n1 = texture2D(uNormalTex, vec2(ax * ${TEX[0]} - uPhase.x, ay * 0.42)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, vec2(ax * ${TEX[1]} - uPhase.y + 0.37, ay * 0.9 + 0.21)).xyz * 2.0 - 1.0;
  float lines = texture2D(uNoise, vec2(ax * ${TEX[3]} - uPhase.w, ay * 2.6)).r - 0.5;
  vec2 rn = (n1.xy + n2.xy * 0.6) * (0.22 + 0.5 * vFoam) + vec2(0.0, lines * 0.35 * vFace);
  // (river x, z) to the world: x = z, z = -x
  N = normalize(N + vec3(rn.y, 0.0, -rn.x) * (below ? -1.0 : 1.0));

  // whitewater: lacy foam carried with the water, broad patches, bubbles; white on the crest
  // pile with grey hollows between the lumps
  float f1 = texture2D(uNoise, vec2(ax * ${TEX[1]} - uPhase.y, ay * 0.55)).r;
  float f2 = texture2D(uNoise, vec2(ax * ${TEX[1] * 2.2} - fract(uPhase.y * 2.2) + 0.3, ay * 1.25 + 0.4)).r;
  float f3 = texture2D(uNoise, vec2(ax * ${TEX[2]} - uPhase.z, ay * 0.18)).a;
  float lace = f1 * 0.55 + f2 * 0.45;
  float cover = vFoam;
  float foam = smoothstep(1.02 - cover * 0.9, 1.3 - cover * 0.9, lace * 0.75 + f3 * 0.35 + cover * 0.2);
  float shade = 0.6 + 0.4 * smoothstep(0.15, 0.7, lace * 0.6 + f3 * 0.4);

  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 L = normalize(uSunDir);
  vec3 col;
  if (below) {
    // from under the water: bright overhead, green all round
    vec3 up = uShallow * 1.6 + uSunColor * 0.12;
    col = mix(uDeep * 1.2, up, smoothstep(0.2, 0.9, NdV));
    col = mix(col, vec3(0.75, 0.85, 0.8) * shade, foam * 0.6);
  } else {
    // milky glacial green: darker in the trough, lighter and lit through near the top of the
    // face, where the water is thin and fast
    vec3 body = mix(uDeep, uShallow, 0.35 + 0.65 * vFace);
    float through = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 3.0) * (0.25 + vFace);
    body += uShallow * through * uSunColor * 0.3;
    // the glassy face shows the lines running down it
    body *= 1.0 + lines * 0.35 * vFace;
    body *= uSkyAmb * 1.3 + max(dot(N, L), 0.0) * uSunColor * 0.25;
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = textureCube(uEnv, R).rgb;
    col = mix(body, sky, fres * (1.0 - foam));
    // the sun's glints
    vec3 H = normalize(L + V);
    col += uSunColor * pow(max(dot(N, H), 0.0), 240.0) * (1.0 - foam) * 2.5;
    // whitewater, lit by the sun and the sky, a little see-through at its thin edges
    vec3 white = vec3(0.88, 0.92, 0.9) * shade * (uSkyAmb * 1.15 + max(dot(N, L) * 0.6 + 0.4, 0.0) * uSunColor * 0.55);
    col = mix(col, white, foam * (0.6 + 0.38 * smoothstep(0.4, 0.9, cover)));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
