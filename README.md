# Surfing Simulator

A first-person surfing game for the browser and Meta Quest, built with Three.js and WebXR.
Paddle into glassy turquoise waves, pop up, and race the peeling lip through the barrel.

- Clear, refractive water with sand, weed and caustics visible underneath, Fresnel sky reflections, sun glints, and light glowing through thin crests and the lip.
- Breaking waves are built procedurally on the GPU: a swell profile plus a curling lip that pitches, forms a barrel, and collapses into whitewater as the break peels along the wave. Gerstner swell runs underneath.
- Foam forms on the lip, where the lip lands, and on the broken whitewater, and is left behind on the water after the wave passes. Spray comes off the lip and the crest.
- Two control schemes: keyboard and mouse on PC, and body movement on Quest (paddle with your arms, stand up to pop up, lean to carve).

There is no build step and no binary assets. Textures, terrain and sound are all generated at start-up, and three.js (r169) loads from jsDelivr.

## Play

### Host on GitHub Pages

1. Push this repository to GitHub.
2. Open **Settings → Pages**, set **Source** to *Deploy from a branch*, then pick `main` and `/ (root)`.
3. After a minute the game is live at `https://<your-user>.github.io/<repo-name>/`.

GitHub Pages is served over HTTPS, which WebXR requires. To play in VR, open that URL in the Meta Quest Browser.

### Run locally

ES modules need a web server, so opening `index.html` directly from disk will not work:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

`localhost` counts as a secure context, so the PC version works. A Quest needs the HTTPS URL (GitHub Pages, or a tunnel).

## Controls

| Action | PC | Meta Quest |
| :-- | :-- | :-- |
| Paddle | Scroll the mouse wheel continuously | Sweep your hands from front to back, low by your sides ("in the water") |
| Steer while paddling | `A` / `D` | Paddle harder on one side (a stronger right stroke turns you left) |
| Pop up | `Space` (press again to lie back down) | Stand up for real: head rises 35 cm above your calibrated paddling height |
| Surf (weight shift) | `W` `A` `S` `D`: lean forward, left, back, right | Lean your head and body |
| Look | Mouse (click the game to capture it) | Your head |
| Other | `R` back to the lineup · `Esc` pause | Trigger: recalibrate · Grip: back to the lineup |

On Quest, kneel or lie down before you start, then press the trigger to calibrate your paddling height. If you don't have room, the thumbstick (forward to paddle, sideways to steer or lean) and `A`/`X` (pop up / lie down) work as a fallback.

### How to catch and ride a wave

1. The top-right of the HUD counts down to the next wave and says which way it breaks. Turn toward the beach and start paddling a few seconds before it reaches you.
2. Keep paddling as the face lifts you. When the HUD says **Caught it!**, pop up.
3. Angle along the face in the direction the wave is breaking. Riding down the face builds speed; climbing toward the crest bleeds it off.
4. To get barrelled, slow down (`S`) just ahead of the breaking lip so it pitches over you, then trim forward (`W`) to escape before the barrel collapses.
5. You wipe out if you get sucked up the face of a pitching section (over the falls), the lip lands on you, or the whitewater catches you while you're standing.

## Project layout

| File | What it does |
| :-- | :-- |
| `index.html`, `css/style.css` | Page shell, start/pause overlay, HUD |
| `js/main.js` | Renderer, scene, camera rig, game flow (lineup, rides, wipeouts), main loop |
| `js/config.js` | Tunables: wave sizes and timing, swell spectrum, sun, quality presets |
| `js/wave.js` | Wave model: set lifecycle, peeling and collapse, swell. Also the JS copy of the wave maths used by the physics and spray |
| `js/shaders/waveChunk.js` | GLSL copy of the wave maths (profile, curling lip, Gerstner swell). Must stay identical to `wave.js` |
| `js/ocean.js` | Water shader: refraction to the seabed, absorption and scattering, light through thin water, Fresnel reflection, foam, haze |
| `js/oceanGrid.js` | Adaptive ocean mesh. Row and column positions are recomputed every frame so vertices cluster at the camera, the crest and the breaking point |
| `js/surfer.js` | Board physics and the prone / pop-up / standing / wipeout state machine |
| `js/input.js`, `js/xr.js` | PC input; Quest head/hand gesture input with calibration |
| `js/body.js`, `js/board.js` | First-person arms (IK paddling), VR hands, parametric surfboard |
| `js/sky.js`, `js/terrain.js` | Procedural HDR sky (rendered once into a cube map), beach, headland, island, trees |
| `js/spray.js`, `js/audio.js`, `js/hud.js`, `js/textures.js` | Spray particles, procedural sound, HUD, generated textures |

### How the barrel works

Each vertex of the ocean grid has a rest position along the wave and a crest-relative coordinate `u`. A smooth asymmetric profile gives the unbroken wave. Physics uses this smooth surface, as the spec allows.

Once a section starts breaking, points near the crest rotate around a tube centre in front of the face. The front of the wave becomes the inside of the tube and the back becomes the outer surface of the lip, so the mesh folds into a real overhang. The crest pitches first and the lower face follows.

Breaking starts at the peak and spreads along the wave at the peel speed. Each section pitches, stays an open barrel for a few seconds, then collapses into a lower, foamy bore.

### Debug URL parameters

- `?q=low` / `?q=high`: quality preset. Quest defaults to `low`.
- `?debug`: shows FPS and wave state for the board's position.
- `?shot=lineup|barrel|shoulder|behind|paddle|beach`: jumps to a preset scene. Add `&freeze` to stop time.
- `?shot=barrel&freeze&cam=x,y,z,yawDeg,pitchDeg`: free spectator camera.
