// Response curves: how far you lean in VR, push a controller's stick or tilt a phone, and
// how much that does (the board carves side to side and trims or stalls forward and back;
// the right stick turns the view). One curve per axis, the same shape for all of them.
//
// The input is a fraction of a full input: for VR leaning, how far your head has moved from
// your stance as a fraction of FULL_LEAN; for a stick, how far it's pushed; for a phone, its
// tilt as a fraction of FULL_TILT.
// "Centre" is the sensitivity to small leans (the slope of the curve at the middle) and
// "max" the sensitivity to big ones (its slope from a full lean out): a low centre and a high
// max make small movements gentle while a bigger lean still turns as hard as ever. In
// between, the slope blends smoothly from one to the other, so the curve never flattens or
// kinks. Centre = max = 1 is the original straight line.

export const FULL_LEAN = 0.17; // m of head movement for a full lean at sensitivity 1
export const FULL_TILT = 25; // degrees of phone tilt for a full lean at sensitivity 1
export const HEAD_HEIGHT = 1.45; // m: your head above your feet in a surfing stance (for the graph)
export const LEAN_DEFAULTS = { x: { centre: 0.55, max: 1.3 }, z: { centre: 0.55, max: 1.3 } };
// controller sticks and phone tilt: full output at a full push / FULL_TILT ((centre + max) / 2 = 1)
export const PAD_DEFAULTS = { x: { centre: 0.6, max: 1.4 }, z: { centre: 0.6, max: 1.4 }, look: { centre: 0.45, max: 1.55 }, lookSpeed: 200, invertY: false };
// (turn: a correction to the tilt directions, in quarter turns of degrees, if they come out
// wrong on some device)
export const TILT_DEFAULTS = { x: { centre: 0.6, max: 1.4 }, z: { centre: 0.6, max: 1.4 }, look: 1, turn: 0 };
export const LEAN_LIMITS = { centre: [0.2, 1.5], max: [0.5, 2.5] };
// For the graphs: what the input is (its range and how it maps to a fraction of a full
// input) and what a full response does (board roll 0.42 rad, pitch 0.06 rad, or the view
// turning at your look speed).
const lean = (deg) => (HEAD_HEIGHT * Math.sin((deg * Math.PI) / 180)) / FULL_LEAN;
const pct = (v) => v / 100;
const tilt = (deg) => deg / FULL_TILT;
export const AXES = {
  x: { title: 'Side to side', what: 'carving', inMax: 10, inUnit: '°', inLabel: 'your lean', toFrac: lean, out: 24.1, outLabel: 'Board tilt', outUnit: '°' },
  z: { title: 'Forward and back', what: 'trim and stall', inMax: 10, inUnit: '°', inLabel: 'your lean', toFrac: lean, out: 3.4, outLabel: 'Nose up / down', outUnit: '°' },
  'pad.x': { title: 'Left stick, sideways', what: 'steering and carving', inMax: 100, inUnit: '%', inLabel: 'stick pushed', toFrac: pct, out: 24.1, outLabel: 'Board tilt', outUnit: '°' },
  'pad.z': { title: 'Left stick, up and down', what: 'trim and stall', inMax: 100, inUnit: '%', inLabel: 'stick pushed', toFrac: pct, out: 3.4, outLabel: 'Nose up / down', outUnit: '°' },
  'pad.look': { title: 'Right stick', what: 'looking around', inMax: 100, inUnit: '%', inLabel: 'stick pushed', toFrac: pct, out: 200, outLabel: 'Turn speed', outUnit: '°/s' },
  'tilt.x': { title: 'Tilt left and right', what: 'steering and carving', inMax: 35, inUnit: '°', inLabel: 'phone tilt', toFrac: tilt, out: 24.1, outLabel: 'Board tilt', outUnit: '°' },
  'tilt.z': { title: 'Tilt forward and back', what: 'trim, stall and walking', inMax: 35, inUnit: '°', inLabel: 'phone tilt', toFrac: tilt, out: 3.4, outLabel: 'Nose up / down', outUnit: '°' },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const cleanCurve = (a, d) => ({
  centre: Math.round(clamp(Number(a && a.centre) || d.centre, ...LEAN_LIMITS.centre) * 100) / 100,
  max: Math.round(clamp(Number(a && a.max) || d.max, ...LEAN_LIMITS.max) * 100) / 100,
});

export function cleanLean(l) {
  return { x: cleanCurve(l && l.x, LEAN_DEFAULTS.x), z: cleanCurve(l && l.z, LEAN_DEFAULTS.z) };
}

export function cleanPad(p) {
  const D = PAD_DEFAULTS;
  return { x: cleanCurve(p && p.x, D.x), z: cleanCurve(p && p.z, D.z), look: cleanCurve(p && p.look, D.look), lookSpeed: Math.round(clamp(Number(p && p.lookSpeed) || D.lookSpeed, 60, 400)), invertY: !!(p && p.invertY) };
}

export function cleanTilt(t) {
  const D = TILT_DEFAULTS;
  const tn = Number(t && t.turn);
  const turn = [0, 90, 180, 270].includes(tn) ? tn : 0;
  return { x: cleanCurve(t && t.x, D.x), z: cleanCurve(t && t.z, D.z), look: Math.round(clamp(Number(t && t.look) || D.look, 0.3, 3) * 100) / 100, turn };
}

// lean (fraction of a full lean, either sign) -> response, -1..1
export function leanCurve(x, { centre: c, max: m }) {
  const t = Math.abs(x);
  // slope blends from c to m along smoothstep(t) over the first full lean; integrated:
  const f = t <= 1 ? c * t + (m - c) * (t * t * t - (t * t * t * t) / 2) : (c + m) / 2 + m * (t - 1);
  return Math.sign(x) * Math.min(1, f);
}

// Draw the curve for one axis into a 2D canvas context, in the box (x, y, w, h): what it
// does against how far you lean / push / tilt (axis: a key of AXES). The straight line is a
// sensitivity of 1; `marker` (a fraction of a full input) puts a dot on the curve; `out`
// replaces the axis's full output (the look speed is a setting).
export function drawLeanGraph(g, x, y, w, h, axis, curve, { scale = 1, marker = null, font = 'system-ui, sans-serif', out = null } = {}) {
  const A = AXES[axis];
  const full = out || A.out;
  const pad = { l: 46 * scale, r: 12 * scale, t: 14 * scale, b: 34 * scale };
  const gx = x + pad.l,
    gy = y + pad.t,
    gw = w - pad.l - pad.r,
    gh = h - pad.t - pad.b;
  const px = (v) => gx + (v / A.inMax) * gw;
  const py = (o) => gy + gh - (o / full) * gh;
  const fmt = (o) => (o < 10 && o % 1 ? o.toFixed(1) : Math.round(o));
  g.save();
  // grid
  g.lineWidth = 1 * scale;
  g.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  g.fillStyle = 'rgba(226, 236, 241, 0.6)';
  g.font = `500 ${11 * scale}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const xStep = A.inMax / 5;
  for (let i = 0; i <= 5; i++) {
    const v = i * xStep;
    g.beginPath();
    g.moveTo(px(v), gy);
    g.lineTo(px(v), gy + gh);
    g.stroke();
    g.fillText(`${Math.round(v)}${A.inUnit}`, px(v), gy + gh + 5 * scale);
  }
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const o = (full * i) / steps;
    g.beginPath();
    g.moveTo(gx, py(o));
    g.lineTo(gx + gw, py(o));
    g.stroke();
    g.fillText(`${fmt(o)}${A.outUnit === '°' ? '°' : ''}`, gx - 6 * scale, py(o));
  }
  // axis titles
  g.fillStyle = 'rgba(226, 236, 241, 0.45)';
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText(A.inLabel, gx + gw / 2, y + h);
  g.save();
  g.translate(x + 9 * scale, gy + gh / 2);
  g.rotate(-Math.PI / 2);
  g.textBaseline = 'middle';
  g.fillText(A.outUnit === '°' ? A.outLabel : `${A.outLabel} (${A.outUnit})`, 0, 0);
  g.restore();
  // a straight response, then this curve
  const line = (cv, style, width, dash) => {
    g.beginPath();
    g.setLineDash(dash.map((v) => v * scale));
    for (let i = 0; i <= 80; i++) {
      const v = (i / 80) * A.inMax;
      const o = leanCurve(A.toFrac(v), cv) * full;
      if (i) g.lineTo(px(v), py(o));
      else g.moveTo(px(v), py(o));
    }
    g.strokeStyle = style;
    g.lineWidth = width * scale;
    g.stroke();
    g.setLineDash([]);
  };
  line({ centre: 1, max: 1 }, 'rgba(226, 236, 241, 0.35)', 1.5, [4, 4]);
  line(curve, '#8fd0ee', 2.5, []);
  if (marker !== null && Number.isFinite(marker)) {
    // (back from a fraction of a full input to the input's own units)
    let v = 0;
    for (let i = 0; i <= 200; i++) if (A.toFrac((i / 200) * A.inMax) <= Math.abs(marker)) v = (i / 200) * A.inMax;
    const o = Math.abs(leanCurve(marker, curve)) * full;
    g.beginPath();
    g.arc(px(v), py(o), 6 * scale, 0, Math.PI * 2);
    g.fillStyle = '#ffc94a';
    g.fill();
  }
  g.restore();
}
