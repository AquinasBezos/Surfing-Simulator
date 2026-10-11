# LINEUP

A first-person surfing game for the browser and Meta Quest, built with Three.js and WebXR.
Paddle into glassy turquoise waves, pop up, and race the peeling lip through the barrel, on your own or with friends in the same lineup.

- Clear, refractive water with sand, weed and caustics visible underneath, Fresnel sky reflections, sun glints, and light glowing through thin crests and the lip.
- Breaking waves are built procedurally on the GPU: a swell profile plus a curling lip that pitches, forms a barrel, and collapses into whitewater as the break peels along the wave. Gerstner swell runs underneath.
- Foam forms on the lip, where the lip lands, and on the broken whitewater, and is left behind on the water after the wave passes. Spray comes off the lip and the crest.
- The board, arms and hands stay visible when they dip under the surface, tinted by the water they're seen through.
- Duck dive under breaking waves. Underwater you get Snell's window, the seabed, light shafts and bubbles.
- Shortboard or longboard. On the longboard you walk to the nose to hang five, or to the tail for tight turns.
- You can crouch under the lip and spring off the top of the wave for an air. Snaps, cutbacks and tailslides come from flicking your view.
- Two control schemes: keyboard and mouse on PC, and body movement on Quest (paddle with your arms, stand up to pop up, lean to carve).
- Pick the wave size, from knee high to well overhead, or let it wander: sets build and fade over a few minutes. On small waves you can keep riding the whitewater after the wave breaks.
- Your surfer is a rigged, animated character (paddling, popping up, a surf stance that crouches and leans with you). Choose skin tone, hair colour and board colour; a turntable preview shows your look.
- Multiplayer: create or find a room, public or private with a passcode, and surf the same waves as up to seven other players, or join as a camera drone and film them from above. PC and Quest players can share a room.

There is no build step. Textures, terrain and sound are generated at start-up, and three.js (r169) loads from jsDelivr. The only files besides code are the surfer model (`assets/surfer.glb`) and the menu art in `assets/menu/`, which are screenshots of the game. Firebase and Trystero load only when you open Multiplayer.

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
| Other | `R` back to the lineup · `Esc` pause menu | `Y` pause menu · `B` back to the lineup · trigger: recalibrate |

These are the defaults. Every key and Quest button can be changed in **Controls and settings**, from the main menu or the pause screen. On PC, click a key and press the new one; mouse buttons work too. On Quest, pick a button for each action, either on the page or in VR from the headset's pause menu. If a key is already taken, the two actions swap, except where they can never clash: duck diving only happens while paddling and crouching only while standing, so both can stay on `Ctrl`. Scroll to paddle, mouse look, `Esc`, and the body movements on Quest stay fixed.

On Quest, kneel or lie down before you start, then press the trigger to calibrate your paddling height. `Y` opens a pause menu in the headset: resume, go back to the lineup, recalibrate, change the buttons and volume, or leave. Point at it with either controller and pull the trigger. If you don't have room, the thumbstick (forward to paddle, sideways to steer or lean) and `A`/`X` (pop up / lie down) work as a fallback.

On PC the game goes fullscreen and locks the keyboard when you start, so `Ctrl` combinations such as `Ctrl+W` reach the game instead of closing the tab. If that isn't available (e.g. Firefox), the browser asks before leaving the page, and `C` works instead of `Ctrl`. Fullscreen can be turned off in **Controls and settings**, which also has graphics quality, volume and mouse sensitivity.

### How to catch and ride a wave

1. Pick a board in the menu. The longboard paddles faster and catches waves earlier but turns slowly unless you step back.
2. The top-right of the HUD counts down to the next wave and says which way it breaks. Turn toward the beach and start paddling a few seconds before it reaches you. The bar under your speed shows your paddling effort: lazy scrolling won't get you onto the wave.
3. Keep paddling as the face lifts you. When the HUD says **Caught it!**, pop up straight away. If you stay lying down as the board noses over a steep or pitching face it pearls, and popping up once it's already near vertical is too late. Pop up before the wave is carrying you and you'll just sink back down.
4. Angle along the face in the direction the wave is breaking. Riding down the face builds speed; climbing toward the crest bleeds it off.
5. To get barrelled, slow down (`S`) just ahead of the breaking lip so it pitches over you, and crouch: the tube is only tall enough to stand in near its middle. Then trim forward (`W`) to escape before it collapses.
6. Crouch on the way up the face and release at the lip to hop off the top. Land with the board pointing where you're travelling.
7. If you're caught inside with a wave about to land on you, duck dive under it.
8. You wipe out if you get sucked up the face of a pitching section (over the falls), the lip lands on you or clips your head in the barrel, or the whitewater catches you while you're standing. Waves under 1.5 m don't have that power: there you can ride the whitewater all the way in.

### Waves and your surfer

The **Waves** setting is on the Singleplayer screen, in Create a room, in the room lobby, and on the pause screen. **Set height** picks a size from 0.6 m to 3.4 m, and each wave varies a few percent around it. **Random** lets the size drift between about 0.8 m and 3 m, building and fading over a few minutes, with no wave much bigger than the last. A change applies from the next wave, so the ones already rolling in keep their size. Small waves are relatively longer and gentler, more like mushy beginner waves, so they can still be caught at the game's fixed wave speed.

**Your surfer** (Singleplayer screen and the room lobby) sets your skin tone, hair colour and board colour. You start with a random look, so everyone looks different, and it's remembered. Your first-person arms and board follow it, and other players see the full character.

## Multiplayer

1. Choose **Multiplayer**, then set your name and board. Your look and the wave size are set in the room lobby.
2. **Find a room** lists the open rooms and who's in them; type to search by name. Rooms marked 🔒 are private and ask for the passcode.
3. Or **Create a room**: give it a name and make it public, or private with a passcode of at least 3 characters.
4. In the room, choose **Play on PC** or **Play in VR**. Everyone in the room gets the same waves at the same moment. Other surfers appear with name tags, and a feed shows who paddled out, got barrelled or wiped out. You can change your name, and anyone can change the room's wave size, from the pause menu.

### Join as drone

In the room lobby, pick **Join as drone** instead of Surfer to fly a camera drone over the waves and watch the others, from high above or skimming the water. It's a folding-arm drone like a DJI Mavic with the camera on a gimbal in its nose, so none of the drone is ever in your shot. The body tilts as it speeds up and turns, but the camera stays level. Fly into the water, the lip or the land and it splashes down and relaunches; you can fly through a barrel if you're good.

| | PC | Meta Quest |
| :-- | :-- | :-- |
| Fly forward, back, sideways | `W` `A` `S` `D` (your movement keys) | Right stick |
| Climb / descend | `Space` / `Ctrl` (your pop-up and crouch keys) | Left stick up / down |
| Turn | Mouse left / right | Left stick left / right |
| Tilt the camera | Mouse up / down | Look around |
| Go faster | Hold `Shift` (your trick key) | |
| Relaunch | `R` (your lineup key) | `B` (your lineup button) |

### How it works

- The Firebase Realtime Database is only used to find rooms. Each player in a room writes one entry of about 100 bytes, `lineup/rooms/<room>/<player>`, with `onDisconnect().remove()`. A room is nothing more than its players' entries, so it disappears as soon as the last player leaves or closes the tab. There is no cleanup job and nothing is left behind.
- Players connect to each other directly over WebRTC using [Trystero](https://github.com/dmotz/trystero). Trystero uses the same database for the brief connection handshake and deletes those records itself. Positions (15 times a second, 56 bytes each), events and clock sync all go peer-to-peer and never touch Firebase.
- Waves aren't sent over the network at all. Each room has a random seed, a shared clock and a wave-size setting, and every player generates the same sets from them. A player who joins takes the clock of whoever has been in the room longest. A change to the wave size carries the wave number it starts from, so everyone switches on the same wave.
- In a private room the passcode is the key Trystero encrypts the handshake with, so players without it can't connect. The room list stores only a short hash of it so that a wrong passcode is rejected straight away.

### Firebase free plan

The Spark plan allows 100 simultaneous connections, 1 GB of storage and 10 GB of downloads a month. LINEUP is built to stay well inside that:

- A browser connects to Firebase only while the Multiplayer menu is open or while it's in a room. Singleplayer never loads Firebase.
- Storage stays near zero: about 100 bytes per player currently in a room.
- Downloads are mostly the live room list while people are browsing (only changes are sent), plus a few KB of handshake per pair of players.
- The limit you'll reach first is the 100 simultaneous connections, i.e. about 100 people in multiplayer at once.

### Database rules

Test-mode rules expire after 30 days and leave the whole database open until then. Paste [database.rules.json](database.rules.json) into **Realtime Database → Rules** in the Firebase console. The rules allow only the room list and Trystero's handshake data, and limit each player entry to the fields and sizes the game writes.

To use your own Firebase project instead, create a Realtime Database, paste in the rules, and set `MULTIPLAYER.databaseURL` in `js/config.js`.

### If players can't connect

WebRTC connects players directly when it can, using public STUN servers to find a route. Strict NATs and many university, office and mobile networks block that, and then players in the same room can't see each other ("Couldn't connect to … one of your networks blocks direct connections"). The fix is a TURN relay, which passes the traffic through a server when a direct route fails. There are no reliable free relays that need no sign-up, so you need a (free) account:

1. Sign up for Metered's Open Relay at <https://dashboard.metered.ca/signup?tool=turnserver> (20 GB of relay traffic a month free; a pair of players going through the relay uses roughly 20 MB an hour, so that's about 1,000 hours).
2. Copy the TURN credentials URL from the dashboard. It looks like `https://yourapp.metered.live/api/v1/turn/credentials?apiKey=…`.
3. Paste it into `MULTIPLAYER.turnCredentialsURL` in `js/config.js`, and push.

The game fetches relay credentials from that URL when you open Multiplayer. Players who can connect directly still do; only blocked connections use the relay. The key is visible to anyone who reads the page, which is how Metered expects it to be used, but it means others could use up your monthly allowance.

Any URL that returns a list of ICE servers works, for example a small Cloudflare Worker that mints Cloudflare TURN credentials (1,000 GB a month free). Fixed TURN servers can go in `MULTIPLAYER.turnServers` instead.

To check the relay works, open the game with `?relay` on two devices and join the same room. That forces every connection through the relay, so if the two players see each other, it's working.

## Project layout

| File | What it does |
| :-- | :-- |
| `index.html`, `css/style.css` | Page shell, menus, HUD |
| `js/main.js` | Renderer, scene, camera rig, game flow (lineup, rides, wipeouts), multiplayer wiring, main loop |
| `js/menu.js` | Main menu, singleplayer and multiplayer screens (room browser, lobby, passcode prompt), settings and key bindings, pause |
| `js/bindings.js` | Remappable controls: actions, default keys and Quest buttons, labels, swapping clashes, saving |
| `js/vrmenu.js` | Pause menu inside the headset: a floating panel you point at with the controllers |
| `js/net.js` | Multiplayer networking: room list and presence in Firebase, Trystero peer connections, shared clock |
| `js/remote.js` | Other players: interpolated movement, their surfer (or drone), board colour, name tags |
| `js/character.js` | The rigged surfer from `assets/surfer.glb`: per-player clone and colours, Paddle / Surf clips, crouch and lean with leg IK |
| `js/preview.js` | Turntable preview of your surfer in the menus |
| `js/drone.js` | Camera drone: flight model, crash rules, and the quadcopter model |
| `js/config.js` | Tunables: wave sizes and timing, swell spectrum, sun, quality presets, board types, multiplayer settings |
| `js/wave.js` | Wave model: set lifecycle, peeling and collapse, swell, and the seeded wave schedule used in multiplayer rooms. Also the JS copy of the wave maths used by the physics and spray |
| `js/shaders/waveChunk.js` | GLSL copy of the wave maths (profile, curling lip, Gerstner swell). Must stay identical to `wave.js` |
| `js/ocean.js` | Water shader: refraction to the seabed, absorption and scattering, light through thin water, Fresnel reflection, foam, haze |
| `js/oceanGrid.js` | Adaptive ocean mesh. Row and column positions are recomputed every frame so vertices cluster at the camera, the crest and the breaking point |
| `js/surfer.js` | Board physics and the prone / pop-up / standing / wipeout state machine. Also paddling effort, duck dives, crouching and airs, longboard walking, and manoeuvres |
| `js/underwater.js` | Shows the body through the water (a stencil-masked second pass), plus the underwater view: seabed dome, light shafts, bubbles |
| `js/input.js`, `js/xr.js` | PC input; Quest head/hand gesture input with calibration |
| `js/body.js`, `js/board.js` | First-person arms (IK paddling), VR hands, parametric shortboard and longboard |
| `js/sky.js`, `js/terrain.js` | Procedural HDR sky (rendered once into a cube map), beach, headland, island, trees |
| `js/spray.js`, `js/audio.js`, `js/hud.js`, `js/textures.js` | Spray particles, procedural sound, HUD, generated textures |
| `assets/surfer.glb` | The surfer: 19-bone rig with Idle, Walk, Run, Surf and Paddle clips |
| `assets/menu/` | Menu art, rendered from the game with the debug views below |
| `database.rules.json` | Recommended Firebase Realtime Database rules |

### How the barrel works

Each vertex of the ocean grid has a rest position along the wave and a crest-relative coordinate `u`. A smooth asymmetric profile gives the unbroken wave. Physics uses this smooth surface, as the spec allows.

Once a section starts breaking, points near the crest rotate around a tube centre in front of the face. The front of the wave becomes the inside of the tube and the back becomes the outer surface of the lip, so the mesh folds into a real overhang. The crest pitches first and the lower face follows.

Breaking starts at the peak and spreads along the wave at the peel speed. Each section pitches, stays an open barrel for a few seconds, then collapses into a lower, foamy bore.

### Debug URL parameters

- `?q=low` / `?q=high`: quality preset. Quest defaults to `low`.
- `?debug`: shows FPS and wave state for the board's position.
- `?board=shortboard|longboard`: choose the board (otherwise the last one picked in the menu).
- `?shot=lineup|barrel|shoulder|behind|paddle|duckdive|beach|boards`: jumps to a preset scene, skipping the menu. Add `&freeze` to stop time.
- Extra preset options: `&stand`, `&crouch=0..1`, `&dive=depth` (e.g. `&dive=1.1` to look around under water), `&foot=-1..1.2` (longboard stance), `&pitch=` / `&lookyaw=` (radians), `&tau=` (seconds since the wave started breaking; negative is before).
- `&bots=N`: puts N stand-in surfers around you, to check how other players look. `&wave2=z`: adds a second wave of the set with its crest at `z`. `&waveh=1.0`: the preset wave's height in metres.
- `?shot=barrel&freeze&cam=x,y,z,yawDeg,pitchDeg`: free spectator camera.
- `?relay`: multiplayer connections only go through the TURN relay (to test the relay set-up).
