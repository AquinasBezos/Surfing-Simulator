# LINEUP for Roblox

A Roblox port of the web game in this repository: first person on your board, paddle into
glassy waves, pop up, and race the peeling lip through the barrel. Playable with keyboard and
mouse, a controller (PC and console) and touch (phones and tablets). VR isn't ported.

## What's here

| Path (in Studio) | File | What it does |
| :-- | :-- | :-- |
| `ReplicatedStorage.Lineup.Config` | `src/ReplicatedStorage/Lineup/Config.luau` | Tunables (port of `js/config.js`) |
| `…Lineup.Spots` | `Spots.luau` | Margaret River, Teahupo'o, Wave Pool: waves, sizes, water colours |
| `…Lineup.WaveModel` | `WaveModel.luau` | The breaking-wave model (port of `js/wave.js`), on the server's seed and clock |
| `…Lineup.Surfer` | `Surfer.luau` | Board physics and the prone / pop-up / standing / wipeout state machine (port of `js/surfer.js`) |
| `…Lineup.Ocean`, `OceanCore`, `OceanWorker` | | The ocean: within 400 m of the camera, an adaptive lattice (`js/oceanGrid.js`) deformed on the CPU with the curling lip (`js/shaders/waveChunk.js`), one EditableMesh strip per Actor, worked out in parallel, in translucent Glass; beyond, flat open sea |
| `…Lineup.Foam` | | Whitewater as particles: the bore, foam left lying behind it, the lip's landing, spilling crests |
| `…Lineup.Land`, `Landscape` | | Each spot's seabed and land (`js/terrain.js`, `js/teahupoo.js`, `js/wavepool.js`); the distant land as a 3D skybox |
| `…Lineup.Board`, `Arms` | | Parametric boards (`js/board.js`); first-person paddling arms (`js/body.js`) |
| `…Lineup.Input`, `Hud`, `Menu` | | Keyboard and mouse, controller and touch; HUD, stickers, score card; menus |
| `…Lineup.World`, `Spray`, `Audio`, `Remote` | | Light and sky (midday, sunset), underwater; spray; sound; other players |
| `StarterPlayer.StarterPlayerScripts.Main` | `src/StarterPlayer/StarterPlayerScripts/Main.client.luau` | Game flow, camera and main loop (port of `js/main.js`) |
| `ServerScriptService.LineupServer` | `src/ServerScriptService/LineupServer.server.luau` | Wave seeds and clock, shared wave sizes, pose and event relay |
| `ServerStorage.LineupBuild.TerrainBuilder` | `src/ServerStorage/LineupBuild/TerrainBuilder.luau` | Edit-time: builds each spot's terrain, trees, palms, the pool's walls and pier |

The world is drawn at 1 stud to the metre; each spot sits at its own origin (Margaret River at
0, Teahupo'o at x = 30 000, the Wave Pool at x = -30 000).

## Controls

| Action | PC | Controller | Touch |
| :-- | :-- | :-- | :-- |
| Paddle | Scroll the mouse wheel (faster = harder), or click left / right for single strokes | Pull LT and RT in turn | Paddle left / right buttons (tap, or hold) |
| Steer · carve | A / D | Left stick | Joystick |
| Trim · stall (longboard: walk) | W / S | Left stick | Joystick |
| Sit up / lie down | S / W while paddling | Left stick back / forward | Sit |
| Pop up | Space | A | Stand up |
| Duck dive · crouch | Hold Ctrl or C | Hold B | Duck dive · Crouch |
| Snap · cutback · tailslide | Hold Shift, flick the mouse | Hold LB / RB, flick the right stick | Hold Snap, swipe |
| Look | Mouse | Right stick | Drag |
| Back to the lineup · pause | R · Tab or P | Y · View | Buttons top left |

Esc is Roblox's own menu, so pause is Tab / P.

## Working on it

The Luau sources here are the master copy. To push them into an open place:

1. `python roblox/serve.py` (serves `roblox/src` on `http://127.0.0.1:8765`)
2. Paste `roblox/sync.luau` into Studio's command bar. It turns HTTP on just for the sync.

`*.server.luau` become Scripts, `*.client.luau` LocalScripts, `*.worker.luau` client Scripts
(disabled; the ocean clones them into its actors), everything else ModuleScripts.

Terrain is built once, in Edit mode, and saved with the place:
`require(game.ServerStorage.LineupBuild.TerrainBuilder).build("margaret")` (and `"teahupoo"`,
`"pool"`).

Place settings it relies on: `Workspace.StreamingEnabled` off (there's no avatar to stream
around), `Players.CharacterAutoLoads` off (the server also sets it), and for the best look
`Lighting.Technology = Future` (scripts can't set it).

Studio-only test hooks (workspace attributes): `LineupAutoPlay`, `LineupSpot`, `LineupTime`,
`LineupBoard`, `LineupDevice`, `LineupQuality`, `LineupWaterMaterial` / `Transparency` /
`Reflectance`, `LineupCam` (`"x,y,z,yawDeg,pitchDeg"`, a free camera in
metres), `LineupTimeOffset`, `LineupTestPaddle` / `Steer` / `Lean` / `Event`.

## How it's done on Roblox

Roblox has no custom shaders and draws only so far out (less when it turns the graphics down),
so a few things are done differently from the web version:

- **Water.** One translucent colour in Roblox's Glass material, which refracts the real seabed
  terrain under it and reflects the sky; the seabed darkens with depth. The waves' shape is
  the web version's maths, but only within 400 m of the camera; beyond, the open sea is flat.
- **Whitewater** is particles (`Foam`): churning puffs on the bore, flat sheets of foam left on
  the water behind it, the explosion where the lip lands. The emitters move with the wave, so
  the foam trails behind it.
- **Distant land** is a 3D skybox, as in Source games (CS:GO, CS2): a miniature at a tenth of
  the size, placed every frame on the line from the camera to the real land, so it looks the
  same but is drawn ten times closer: always within the draw distance, and a single mesh. The
  land near the lineup is real terrain. (Something more than a tenth of the way to the land
  behind it, a surfer far ahead riding toward the beach say, can be hidden by the miniature.)
- An EditableMesh's vertices are drawn where they are in its part's frame (no recentring), and
  editable meshes share a small memory budget on each client: the boards are built first, and
  there's a plain fallback board if a mesh can't be made.
- **Graphics: Low** (pause menu; the default on phones): a smaller wave patch redrawn every other
  frame, fewer foam particles, no lip spray, no shadows, bloom or sun rays.
- Not ported: the Eisbach river wave, VR, replays and the camera drone, and the web version's
  rooms (a Roblox server is the room: everyone at the same spot rides the same waves, and
  anyone can change the wave size).
