// Procedural HDR sky rendered once into a cube map. The cube is used as the scene
// background, for water reflections and (via PMREM) as image-based light.
import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
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
  vec3 zenith = vec3(0.028, 0.13, 0.52);
  vec3 mid = vec3(0.12, 0.33, 0.78);
  vec3 horizon = vec3(0.52, 0.68, 0.86);
  float t = clamp(y, 0.0, 1.0);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, pow(t, 0.8)));
  col = mix(col, zenith, smoothstep(0.2, 1.0, t));

  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.9, 0.72) * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.55 + pow(sd, 600.0) * 3.0);
  col += vec3(1.0, 0.96, 0.88) * smoothstep(0.99955, 0.99972, sd) * 30.0;

  // low cumulus near the horizon
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.08);
    float n = fbm(cp * 1.15 + vec2(4.2, 1.3));
    float band = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.08, 0.38, y));
    float cov = smoothstep(0.58, 0.74, n) * band;
    float lit = smoothstep(0.55, 0.85, n);
    vec3 cloud = mix(vec3(0.62, 0.68, 0.78), vec3(1.25, 1.22, 1.15), lit);
    cloud += vec3(1.0, 0.9, 0.75) * pow(sd, 6.0) * 0.6;
    col = mix(col, cloud, cov * 0.92);
    // thin high wisps
    float wisp = smoothstep(0.62, 0.8, fbm(cp * vec2(0.35, 1.4) + 9.0)) * smoothstep(0.1, 0.4, y) * 0.18;
    col = mix(col, vec3(1.0), wisp);
  }
  // below the horizon: distant ocean seen at a grazing angle
  if (y < 0.0) {
    vec3 sea = vec3(0.025, 0.11, 0.15);
    col = mix(horizon * 0.82, sea, smoothstep(0.0, 0.2, -y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(renderer, sunDir, size) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: new THREE.Vector3(...sunDir) } },
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
  return { cube: rt.texture, env };
}
