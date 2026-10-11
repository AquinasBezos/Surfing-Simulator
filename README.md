# Surfing Simulator

A first-person surfing game for the browser and Meta Quest, built with Three.js and WebXR.
Paddle into glassy turquoise waves, pop up, and race the peeling lip through the barrel.

- Clear, refractive water with sand, weed and caustics visible underneath, Fresnel sky reflections, sun glints, and light glowing through thin crests and the lip.
- Breaking waves are built procedurally on the GPU: a swell profile plus a curling lip that pitches, forms a barrel, and collapses into whitewater as the break peels along the wave. Gerstner swell runs underneath.
- Foam forms on the lip, where the lip lands, and on the broken whitewater, and is left behind on the water after the wave passes. Spray comes off the lip and the crest.
- The board, arms and hands stay visible when they dip under the surface, tinted by the water they're seen through.
- Duck dive under breaking waves. Underwater you get Snell's window, the seabed, light shafts and bubbles.
- Shortboard or longboard. On the longboard you walk to the nose to hang five, or to the tail for tight turns.
- You can crouch under the lip and spring off the top of the wave for an air. Snaps, cutbacks and tailslides come from flicking your view.
- Two control schemes: keyboard and mouse on PC, and body movement on Quest (paddle with your arms, stand up to pop up, lean to carve).

There is no build step and no binary assets. Textures, terrain and sound are all generated at start-up, and three.js (r169) loads from jsDelivr.

## Controls

| Action | PC | Meta Quest |
| :-- | :-- | :-- |
| Paddle | Scroll the mouse wheel; the faster you scroll, the faster you can paddle | Sweep your hands from front to back, low by your sides ("in the water"). Faster strokes, more speed |
| Steer while paddling | `A` / `D` | Paddle harder on one side (a stronger right stroke turns you left) |
| Duck dive | Hold `Ctrl` (or `C`) while paddling; let go to surface | Hold grip with your hand on the front of the board |
| Pop up | `Space` (press again to lie back down) | Stand up for real: head rises 35 cm above your calibrated paddling height |
| Surf (weight shift) | `A` / `D` carve, `W` / `S` lean forward (trim) or back (stall) | Lean your head and body |
| Crouch | Hold `Ctrl` (or `C`); let go at the lip to spring into an air | Crouch for real; stand up fast at the lip to hop |
| Snap · cutback · tailslide | Hold `Shift` and flick the mouse left or right | Hold either grip and whip your head round |
| Longboard | `W` / `S` walk toward the nose or the tail | Walk forward or back on the board |
| Look | Mouse (click the game to capture it) | Your head |
| Other | `R` back to the lineup · `Esc` pause | Trigger: recalibrate · `B` / `Y`: back to the lineup |

On Quest, kneel or lie down before you start, then press the trigger to calibrate your paddling height. If you don't have room, the thumbstick (forward to paddle, sideways to steer or lean) and `A`/`X` (pop up / lie down) work as a fallback.

On PC the game goes fullscreen and locks the keyboard when you start, so `Ctrl` combinations such as `Ctrl+W` reach the game instead of closing the tab. If that isn't available (e.g. Firefox), the browser asks before leaving the page, and `C` works instead of `Ctrl`.

### How to catch and ride a wave

1. Pick a board in the menu. The longboard paddles faster and catches waves earlier but turns slowly unless you step back.
2. The top-right of the HUD counts down to the next wave and says which way it breaks. Turn toward the beach and start paddling a few seconds before it reaches you. The bar under your speed shows your paddling effort: lazy scrolling won't get you onto the wave.
3. Keep paddling as the face lifts you. When the HUD says **Caught it!**, pop up straight away. If you stay lying down as the board noses over a steep or pitching face it pearls, and popping up once it's already near vertical is too late. Pop up before the wave is carrying you and you'll just sink back down.
4. Angle along the face in the direction the wave is breaking. Riding down the face builds speed; climbing toward the crest bleeds it off.
5. To get barrelled, slow down (`S`) just ahead of the breaking lip so it pitches over you, and crouch: the tube is only tall enough to stand in near its middle. Then trim forward (`W`) to escape before it collapses.
6. Crouch on the way up the face and release at the lip to hop off the top. Land with the board pointing where you're travelling.
7. If you're caught inside with a wave about to land on you, duck dive under it.
8. You wipe out if you get sucked up the face of a pitching section (over the falls), the lip lands on you or clips your head in the barrel, or the whitewater catches you while you're standing.

## Project layout

| File | What it does |
| :-- | :-- |
| `index.html`, `css/style.css` | Page shell, start/pause overlay, HUD |
| `js/main.js` | Renderer, scene, camera rig, game flow (lineup, rides, wipeouts), main loop |
| `js/config.js` | Tunables: wave sizes and timing, swell spectrum, sun, quality presets, board types |
| `js/wave.js` | Wave model: set lifecycle, peeling and collapse, swell. Also the JS copy of the wave maths used by the physics and spray |
| `js/shaders/waveChunk.js` | GLSL copy of the wave maths (profile, curling lip, Gerstner swell). Must stay identical to `wave.js` |
| `js/ocean.js` | Water shader: refraction to the seabed, absorption and scattering, light through thin water, Fresnel reflection, foam, haze |
| `js/oceanGrid.js` | Adaptive ocean mesh. Row and column positions are recomputed every frame so vertices cluster at the camera, the crest and the breaking point |
| `js/surfer.js` | Board physics and the prone / pop-up / standing / wipeout state machine. Also paddling effort, duck dives, crouching and airs, longboard walking, and manoeuvres |
| `js/underwater.js` | Shows the body through the water (a stencil-masked second pass), plus the underwater view: seabed dome, light shafts, bubbles |
| `js/input.js`, `js/xr.js` | PC input; Quest head/hand gesture input with calibration |
| `js/body.js`, `js/board.js` | First-person arms (IK paddling), VR hands, parametric shortboard and longboard |
| `js/sky.js`, `js/terrain.js` | Procedural HDR sky (rendered once into a cube map), beach, headland, island, trees |
| `js/spray.js`, `js/audio.js`, `js/hud.js`, `js/textures.js` | Spray particles, procedural sound, HUD, generated textures |

### How the barrel works

Each vertex of the ocean grid has a rest position along the wave and a crest-relative coordinate `u`. A smooth asymmetric profile gives the unbroken wave. Physics uses this smooth surface, as the spec allows.

Once a section starts breaking, points near the crest rotate around a tube centre in front of the face. The front of the wave becomes the inside of the tube and the back becomes the outer surface of the lip, so the mesh folds into a real overhang. The crest pitches first and the lower face follows.

Breaking starts at the peak and spreads along the wave at the peel speed. Each section pitches, stays an open barrel for a few seconds, then collapses into a lower, foamy bore.

### Debug URL parameters

- `?q=low` / `?q=high`: quality preset. Quest defaults to `low`.
- `?debug`: shows FPS and wave state for the board's position.
- `?board=shortboard|longboard`: choose the board (otherwise the last one picked in the menu).
- `?shot=lineup|barrel|shoulder|behind|paddle|duckdive|beach`: jumps to a preset scene. Add `&freeze` to stop time.
- Extra preset options: `&stand`, `&crouch=0..1`, `&dive=depth` (e.g. `&dive=1.1` to look around under water), `&foot=-1..1.2` (longboard stance), `&pitch=` / `&lookyaw=` (radians).
- `?shot=barrel&freeze&cam=x,y,z,yawDeg,pitchDeg`: free spectator camera.
