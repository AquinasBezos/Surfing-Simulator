// Surf spots. Each one has its own wave (how and where it breaks, the shape of the barrel),
// wave sizes, water colour, seabed and coastline. The game runs one spot at a time:
// applySpotWave() (wave.js) copies a spot's wave into the shared WAVE / WAVE_HEIGHTS values
// that the physics and the shaders read.
//
// Wave parameters (distances in metres, times in seconds; "normalised" = in units of the
// wave's horizontal scale, which is about its height):
//   peelSpeed / backSpeed   how fast the breaking point runs along the wave, each way
//   breakWidth / backWidth  how much of the wave pitches at once when it first breaks
//   tThrow, tTube, tCollapse  lip throw, open barrel, collapse into whitewater
//   curveK, curveMax        how far the crest bends back away from the peak
//   peelFlat, peelFall, backFall  where the wave fades out along the crest
//   dir                     0: peels either way; 1: always a left (toward +x)
//   peakSpread              how far the peak moves around between waves
//   shoalFrom, shoalBase    where the swell starts to jack up, and how small it is before
//   steepFrom               where the face starts to steepen
//   curl: rin, yc, ex, sweep  barrel radius, centre height, width stretch, lip rotation
//         lf / lb           face / back length [gentle, steep]
//         trough            water drawn off the reef in front of the wave
//         lip               lip thickness
export const SPOTS = {
  margaret: {
    id: 'margaret',
    name: 'Margaret River',
    place: 'Western Australia',
    blurb: 'Peaky rights and lefts over sand and rock',
    wave: {
      peelSpeed: 6.6,
      backSpeed: 2.4,
      breakWidth: 0,
      backWidth: 0,
      tThrow: 1.5,
      tTube: 3.6,
      tCollapse: 1.7,
      curveK: 0.00028,
      curveMax: 24,
      peelFlat: 40,
      peelFall: 260,
      backFall: 45,
      dir: 0,
      peakSpread: 5,
      shoalFrom: -115,
      shoalBase: 0.5,
      steepFrom: -100,
      curl: { rin: 0.4, yc: 0.4, ex: 1.12, sweep: 3.92699, lf: [1.25, 0.55], lb: [2.2, 1.6], trough: 0, lip: 0.42 },
    },
    heights: { min: 0.6, max: 3.4, randomMin: 0.8, randomMax: 3.0, default: 2.5, small: 1.5, minScale: 2.2 },
    lineup: { z: -5, side: 4 }, // where you wait: in front of the peak, a little toward the shoulder
    inside: { z: 45, x: 650 }, // drifted past here without a ride: paddle back out
    // clear, slightly green coastal water. absorb / scatter per metre; sss: light through
    // thin water; deep: the colour of the water around you under the surface; vis: how
    // quickly things fade into it under water (per metre)
    water: { absorb: [0.46, 0.088, 0.105], scatter: [0.004, 0.072, 0.066], sss: [0.05, 0.85, 0.62], uwScatter: [0.009, 0.16, 0.15], deep: [0.01, 0.12, 0.12], uwUp: [0.05, 0.36, 0.34], uwGlow: [0.12, 0.42, 0.38], shaft: [0.45, 0.95, 0.85], vis: 0.13 },
  },

  teahupoo: {
    id: 'teahupoo',
    name: "Teahupo'o",
    place: 'Tahiti',
    blurb: 'A heavy left that wraps round a shallow reef',
    wave: {
      // out of deep water onto a shallow reef: it jacks up late, a wide section pitches at
      // once, the lip is thick and the barrel round and wide. Only a left: the reef past the
      // peak just closes out.
      peelSpeed: 7.3,
      backSpeed: 9,
      breakWidth: 13,
      backWidth: 5,
      tThrow: 1.05,
      tTube: 4.6,
      tCollapse: 1.4,
      curveK: 0.0024,
      curveMax: 40,
      peelFlat: 112,
      peelFall: 34,
      backFall: 26,
      dir: 1,
      peakSpread: 1.5,
      shoalFrom: -70,
      shoalBase: 0.42,
      steepFrom: -48,
      curl: { rin: 0.48, yc: 0.42, ex: 1.32, sweep: 3.98, lf: [1.12, 0.5], lb: [2.4, 1.8], trough: 0.1, lip: 0.62 },
    },
    heights: { min: 1.0, max: 6.0, randomMin: 1.8, randomMax: 5.4, default: 3.5, small: 1.5, minScale: 2.2 },
    lineup: { z: -13, side: 9 },
    inside: { z: 95, x: 650 },
    // clear, deep-blue tropical ocean
    water: { absorb: [0.45, 0.07, 0.034], scatter: [0.003, 0.034, 0.088], sss: [0.06, 0.78, 0.95], uwScatter: [0.006, 0.09, 0.2], deep: [0.006, 0.06, 0.15], uwUp: [0.04, 0.3, 0.46], uwGlow: [0.1, 0.38, 0.52], shaft: [0.45, 0.85, 1.0], vis: 0.055 },
  },
};

export const SPOT_IDS = Object.keys(SPOTS);
export const DEFAULT_SPOT = 'margaret';
export const cleanSpot = (id) => (SPOTS[id] ? id : DEFAULT_SPOT);
