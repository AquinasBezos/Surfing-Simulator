// On foot: walking the river bank at the Eisbach in first person with your board under your
// arm, waiting for your go on the wave. The ground comes from the model (eisbach.js); you
// can step up kerbs and stairs but not walls, can drop off ledges, and can't walk into the
// river (you jump in instead).
const EYE = 1.6; // eye height
const STEP = 0.42; // highest step up
const RADIUS = 0.28; // how close to a wall you can get
const WALK = 1.5,
  RUN = 3.4; // m/s
const GRAVITY = 9.81;

export class Walker {
  constructor() {
    this.x = this.y = this.z = 0;
    this.yaw = 0; // heading (0 = looking toward -z), as the surfer's
    this.pitch = 0;
    this.vx = this.vz = this.vy = 0;
    this.speed = 0;
    this.bob = 0;
    this.onGround = true;
    this.eye = EYE;
  }

  // ground(x, z): the height you can stand on there, or null where you can't walk
  reset(x, z, yaw, ground) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = -0.12;
    this.vx = this.vz = this.vy = 0;
    this.speed = 0;
    this.y = ground(x, z) ?? 0;
    this.onGround = true;
  }

  get forward() {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  // inp: { fwd, right } (-1..1), run (bool). ground(x, z) as for reset.
  update(dt, inp, ground) {
    if (dt <= 0) return;
    const [fx, fz] = this.forward;
    const rx = -fz,
      rz = fx;
    let mx = fx * inp.fwd + rx * inp.right,
      mz = fz * inp.fwd + rz * inp.right;
    const m = Math.hypot(mx, mz);
    if (m > 1) {
      mx /= m;
      mz /= m;
    }
    const top = inp.run ? RUN : WALK;
    const k = 1 - Math.exp(-dt * (this.onGround ? 10 : 1.5));
    this.vx += (mx * top - this.vx) * k;
    this.vz += (mz * top - this.vz) * k;
    // try the move; along a wall, slide (one axis at a time)
    const can = (x, z) => {
      const g = ground(x, z);
      if (g === null || g - this.y > STEP) return false;
      // the body's width: no walking with your shoulder in a wall
      const s = Math.hypot(this.vx, this.vz) || 1;
      const g2 = ground(x + (this.vx / s) * RADIUS, z + (this.vz / s) * RADIUS);
      return g2 !== null && g2 - this.y <= STEP;
    };
    const nx = this.x + this.vx * dt,
      nz = this.z + this.vz * dt;
    if (can(nx, nz)) {
      this.x = nx;
      this.z = nz;
    } else if (can(nx, this.z)) {
      this.x = nx;
      this.vz = 0;
    } else if (can(this.x, nz)) {
      this.z = nz;
      this.vx = 0;
    } else this.vx = this.vz = 0;
    this.speed = Math.hypot(this.vx, this.vz);
    // stepping up, or falling off a ledge
    const g = ground(this.x, this.z) ?? this.y;
    if (g >= this.y - 0.05) {
      this.y += (g - this.y) * Math.min(1, dt * 18); // (up a step smoothly)
      this.vy = 0;
      this.onGround = true;
    } else {
      this.vy -= GRAVITY * dt;
      this.y = Math.max(g, this.y + this.vy * dt);
      this.onGround = this.y <= g + 1e-3;
      if (this.onGround) this.vy = 0;
    }
    // the head bobs a little as you walk
    this.bob += dt * this.speed * 4.2;
  }

  // where your eyes are (y): ground + eye height + a little bob
  eyeY() {
    return this.y + this.eye + Math.sin(this.bob * 2) * 0.025 * Math.min(1, this.speed / WALK);
  }
}
