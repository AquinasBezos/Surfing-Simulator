// Procedural HDR sky rendered once into a cube map. The cube is used as the scene
// background, for water reflections and (via PMREM) as image-based light. Two looks:
// midday, and sunset (uSunset = 1): violet overhead, a gold glow along the horizon under a
// low orange sun, pink and dusky away from it, clouds lit from below.
import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunset;
varying vec3 vDir;

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float t = clamp(y, 0.0, 1.0);
  float sd = max(dot(d, uSunDir), 0.0);
  // how far round toward the sun this direction faces (0 away .. 1 toward)
  vec2 sh = normalize(uSunDir.xz);
  float az = dot(normalize(d.xz + 1e-5), sh) * 0.5 + 0.5;

  // midday
  vec3 zenith = vec3(0.028, 0.13, 0.52);
  vec3 mid = vec3(0.12, 0.33, 0.78);
  vec3 horizon = vec3(0.52, 0.68, 0.86);
  vec3 day = mix(horizon, mid, smoothstep(0.0, 0.25, pow(t, 0.8)));
  day = mix(day, zenith, smoothstep(0.2, 1.0, t));
  day += vec3(1.0, 0.9, 0.72) * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.55 + pow(sd, 600.0) * 3.0);
  day += vec3(1.0, 0.96, 0.88) * smoothstep(0.99955, 0.99972, sd) * 30.0;

  // sunset
  vec3 sZen = vec3(0.016, 0.026, 0.085);
  // away from the sun: a pink band low down under a deepening blue
  vec3 sMid = mix(vec3(0.07, 0.07, 0.2), vec3(0.36, 0.17, 0.2), pow(az, 2.0));
  vec3 sHor = mix(vec3(0.55, 0.3, 0.38), vec3(1.7, 0.66, 0.22), pow(az, 3.0));
  vec3 dusk = mix(sHor, sMid, smoothstep(0.0, 0.16, pow(t, 0.75)));
  dusk = mix(dusk, sZen, smoothstep(0.12, 0.8, t));
  dusk += vec3(1.6, 0.58, 0.18) * (pow(sd, 4.0) * 0.32 + pow(sd, 28.0) * 0.9 + pow(sd, 380.0) * 4.0);
  dusk += vec3(2.3, 1.05, 0.42) * smoothstep(0.99935, 0.99958, sd) * 20.0;

  vec3 horizonC = mix(horizon, sHor, uSunset);
  vec3 col = mix(day, dusk, uSunset);

  // low cumulus near the horizon
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.08);
    float n = fbm(cp * 1.15 + vec2(4.2, 1.3));
    float band = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.08, 0.38, y));
    float cov = smoothstep(0.58, 0.74, n) * band;
    float lit = smoothstep(0.55, 0.85, n);
    vec3 cloud = mix(vec3(0.62, 0.68, 0.78), vec3(1.25, 1.22, 1.15), lit);
    cloud += vec3(1.0, 0.9, 0.75) * pow(sd, 6.0) * 0.6;
    // at sunset: undersides lit gold toward the sun, grey-violet away from it
    vec3 duskCloud = mix(vec3(0.16, 0.1, 0.17), vec3(0.62, 0.3, 0.3), lit) * mix(0.7, 1.0, az);
    duskCloud += vec3(1.9, 0.75, 0.25) * (pow(az, 4.0) * 0.55 + pow(sd, 5.0) * 1.2) * (0.4 + 0.6 * lit);
    col = mix(col, mix(cloud, duskCloud, uSunset), cov * 0.92);
    // thin high wisps
    float wisp = smoothstep(0.62, 0.8, fbm(cp * vec2(0.35, 1.4) + 9.0)) * smoothstep(0.1, 0.4, y) * 0.18;
    col = mix(col, mix(vec3(1.0), vec3(1.1, 0.55, 0.45) * mix(0.35, 1.0, az), uSunset), wisp);
  }
  // below the horizon: distant ocean seen at a grazing angle
  if (y < 0.0) {
    vec3 sea = mix(vec3(0.025, 0.11, 0.15), vec3(0.03, 0.03, 0.06), uSunset);
    col = mix(horizonC * 0.82, sea, smoothstep(0.0, 0.2, -y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// sunset: 0 midday .. 1 sunset palette
export function createSky(renderer, sunDir, size, sunset = 0) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: new THREE.Vector3(...sunDir) }, uSunset: { value: sunset } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  const skyScene = new THREE.Scene();
  skyScene.add(mesh);

  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const cam = new THREE.CubeCamera(1, 1000, rt);
  cam.update(renderer, skyScene);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(rt.texture).texture;
  pmrem.dispose();
  mesh.geometry.dispose();
  mat.dispose();
  return { cube: rt.texture, env, dispose: () => (rt.dispose(), env.dispose()) };
}
