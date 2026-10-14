// How leaning your body in VR steers the board: a response curve for each direction (side
// to side carves, forward and back trims and stalls).
//
// The input is how far your head has moved from your stance, as a fraction of FULL_LEAN.
// "Centre" is the sensitivity to small leans (the slope of the curve at the middle) and
// "max" the sensitivity to big ones (its slope from a full lean out): a low centre and a high
// max make small movements gentle while a bigger lean still turns as hard as ever. In
// between, the slope blends smoothly from one to the other, so the curve never flattens or
// kinks. Centre = max = 1 is the original straight line.

export const FULL_LEAN = 0.17; // m of head movement for a full lean at sensitivity 1
export const HEAD_HEIGHT = 1.45; // m: your head above your feet in a surfing stance (for the graph)
export const LEAN_DEFAULTS = { x: { centre: 0.55, max: 1.3 }, z: { centre: 0.55, max: 1.3 } };
export const LEAN_LIMITS = { centre: [0.2, 1.5], max: [0.5, 2.5] };
// what a full response does to the board, for the graphs
export const AXES = {
  x: { title: 'Side to side', what: 'carving', tilt: 24.1, tiltLabel: 'Board tilt' }, // roll: 0.42 rad
  z: { title: 'Forward and back', what: 'trim and stall', tilt: 3.4, tiltLabel: 'Nose up / down' }, // pitch: 0.06 rad
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function cleanLean(l) {
  const one = (a, d) => ({
    centre: Math.round(clamp(Number(a && a.centre) || d.centre, ...LEAN_LIMITS.centre) * 100) / 100,
    max: Math.round(clamp(Number(a && a.max) || d.max, ...LEAN_LIMITS.max) * 100) / 100,
  });
  return { x: one(l && l.x, LEAN_DEFAULTS.x), z: one(l && l.z, LEAN_DEFAULTS.z) };
}

// lean (fraction of a full lean, either sign) -> response, -1..1
export function leanCurve(x, { centre: c, max: m }) {
  const t = Math.abs(x);
  // slope blends from c to m along smoothstep(t) over the first full lean; integrated:
  const f = t <= 1 ? c * t + (m - c) * (t * t * t - (t * t * t * t) / 2) : (c + m) / 2 + m * (t - 1);
  return Math.sign(x) * Math.min(1, f);
}

// Draw the curve for one axis into a 2D canvas context, in the box (x, y, w, h): board tilt
// (degrees) against how far you lean (degrees, pivoting at your feet). The straight line is
// the original response; `marker` (a lean, fraction of FULL_LEAN) puts a dot on the curve.
export function drawLeanGraph(g, x, y, w, h, axis, curve, { scale = 1, marker = null, font = 'system-ui, sans-serif' } = {}) {
  const A = AXES[axis];
  const pad = { l: 46 * scale, r: 12 * scale, t: 14 * scale, b: 34 * scale };
  const gx = x + pad.l,
    gy = y + pad.t,
    gw = w - pad.l - pad.r,
    gh = h - pad.t - pad.b;
  const maxLeanDeg = 10;
  const leanToFrac = (deg) => (HEAD_HEIGHT * Math.sin((deg * Math.PI) / 180)) / FULL_LEAN;
  const px = (deg) => gx + (deg / maxLeanDeg) * gw;
  const py = (tilt) => gy + gh - (tilt / A.tilt) * gh;
  g.save();
  // grid
  g.lineWidth = 1 * scale;
  g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  g.fillStyle = 'rgba(226, 236, 241, 0.6)';
  g.font = `500 ${11 * scale}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let d = 0; d <= maxLeanDeg; d += 2) {
    g.beginPath();
    g.moveTo(px(d), gy);
    g.lineTo(px(d), gy + gh);
    g.stroke();
    g.fillText(`${d}°`, px(d), gy + gh + 5 * scale);
  }
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = (A.tilt * i) / steps;
    g.beginPath();
    g.moveTo(gx, py(t));
    g.lineTo(gx + gw, py(t));
    g.stroke();
    g.fillText(`${t < 10 ? t.toFixed(1) : Math.round(t)}°`, gx - 6 * scale, py(t));
  }
  // axis titles
  g.fillStyle = 'rgba(226, 236, 241, 0.45)';
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText('your lean', gx + gw / 2, y + h);
  g.save();
  g.translate(x + 9 * scale, gy + gh / 2);
  g.rotate(-Math.PI / 2);
  g.textBaseline = 'middle';
  g.fillText(A.tiltLabel, 0, 0);
  g.restore();
  // the original straight response, then this curve
  const line = (cv, style, width, dash) => {
    g.beginPath();
    g.setLineDash(dash.map((v) => v * scale));
    for (let i = 0; i <= 80; i++) {
      const d = (i / 80) * maxLeanDeg;
      const t = leanCurve(leanToFrac(d), cv) * A.tilt;
      if (i) g.lineTo(px(d), py(t));
      else g.moveTo(px(d), py(t));
    }
    g.strokeStyle = style;
    g.lineWidth = width * scale;
    g.stroke();
    g.setLineDash([]);
  };
  line({ centre: 1, max: 1 }, 'rgba(226, 236, 241, 0.35)', 1.5, [4, 4]);
  line(curve, '#8fd0ee', 2.5, []);
  if (marker !== null && Number.isFinite(marker)) {
    const lean = Math.min(maxLeanDeg, (Math.asin(Math.min(1, (Math.abs(marker) * FULL_LEAN) / HEAD_HEIGHT)) * 180) / Math.PI);
    const t = Math.abs(leanCurve(marker, curve)) * A.tilt;
    g.beginPath();
    g.arc(px(lean), py(t), 6 * scale, 0, Math.PI * 2);
    g.fillStyle = '#ffc94a';
    g.fill();
  }
  g.restore();
}
