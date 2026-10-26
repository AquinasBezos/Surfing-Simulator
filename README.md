# LINEUP

A first-person surfing game for the browser and Meta Quest, built with Three.js and WebXR.
Paddle into glassy waves, pop up, and race the peeling lip through the barrel, on your own or with friends in the same lineup.

- Four surf spots. **Margaret River**: peaky rights and lefts over sand and rock in clear green-blue water, with a beach, wooded hills and an island offshore. **Teahupo'o**: a heavy left that comes out of deep blue ocean onto a shallow coral reef and wraps round it. A wide section pitches all at once, the lip is thick and the barrel round and wide, with waves up to 6 m. Behind it are a turquoise lagoon, a palm-lined shore and steep green peaks, and the rest of the island fades into the haze across the bay. **Wave Pool**: a kite-shaped artificial lagoon in the English countryside with machine-made waves, a left and a right either side of a viewing pier. **Eisbach**: the standing river wave in Munich, under the Prinzregentenstrasse bridge, where you wait on the bank with your board and jump in.

- Clear, refractive water with sand, weed and caustics visible underneath, Fresnel sky reflections, sun glints, and light glowing through thin crests and the lip.
- Breaking waves are built procedurally on the GPU: a swell profile plus a curling lip that pitches, forms a barrel, and collapses into whitewater as the break peels along the wave. Gerstner swell runs underneath.
- Foam forms on the lip, where the lip lands, and on the broken whitewater, and is left behind on the water after the wave passes. Whitewater is lumpy and lit like real foam, with shadowed crevices, and gets rougher the bigger the wave. When a barrel's time is up it closes and squashes down into a mound of whitewater. Small waves don't barrel: they spill, with foam boiling over the crest and tumbling down the face. Spray comes off the lip and the crest, and white water sprays off the nose of your board as you drop in. On high graphics, paddling into a wave piles churned, bubbly water up along both rails in front of you, and turns throw a fan of spray off the tail that tears into streaks and drops (a hard carve a small one; a snap, cutback or tailslide a big one). Other surfers' turns throw it too.
- The board, arms and hands stay visible when they dip under the surface, tinted by the water they're seen through.
- Duck dive under breaking waves. Underwater you get Snell's window, the seabed (at Teahupo'o, the coral reef sloping away into the deep), light shafts and bubbles. In the ocean, a school of fish sometimes swims past (silvery baitfish at Margaret River, reef fish at Teahupo'o) and scatters if you get close.
- Shortboard or longboard. On the longboard you walk to the nose to hang five, or to the tail for tight turns. A longboard is too big to duck dive, so you turtle roll instead: grab the rails and roll over, hanging upside down under the board while the wave passes over. The view rolls with you, in a headset too.
- You can crouch under the lip and spring off the top of the wave for an air, and throw a backflip in it. Snaps, cutbacks and tailslides come from flicking your view.
- Four ways to play: keyboard and mouse, a game controller, touch on a phone or tablet (swipe to paddle, tilt to steer), and body movement on Quest (paddle with your arms, stand up to pop up, lean to carve).
- Pick the wave size, from knee high to well overhead, or let it wander: sets build and fade over a few minutes. On small waves you can keep riding the whitewater after the wave breaks.
- Your surfer is a rigged, animated character (paddling, popping up, a surf stance that crouches and leans with you). Choose skin tone, hair colour and board colour; a turntable preview shows your look. In first person you see that character's own arms: on PC and phones they paddle in smooth, flowing strokes, and in VR they follow your controllers.
- Tricks, hang fives and tens, airs and barrels pop up as early-2000s surf-mag stickers, and every ride ends with a score card (with a badge when you beat your best).
- Replays (singleplayer): pause and pick **Replay the last 30 s** to watch your last 30 seconds again from a drone you fly around yourself, with slow motion.
- Sit up on your board to wait for waves. Your head turns with your view, and on a wave your upper body twists to follow it, so other players can see where you're looking.
- Surf at midday or at sunset: a low gold sun with a long path of light across the water, a dusk sky in the reflections, backlit crests and dimmer, warmer light under water.
- Multiplayer: create or find a room, public or private with a passcode, and surf the same waves as up to seven other players, or join as a camera drone and film them from above. PC and Quest players can share a room. The room's leader can turn on collisions (experimental), so you bump into each other.

There is no build step. Textures, terrain and sound are generated at start-up, and three.js (r169) loads from jsDelivr. The only files besides code are the surfer model (`assets/surfer.glb`), the Eisbach (`assets/eisbach_wave_munich_draco.glb`, Draco-compressed and only downloaded when someone picks that spot; the decoder comes from jsDelivr), and the menu art in `assets/menu/` (including the location thumbnails), which are screenshots of the game. Firebase and Trystero load only when you open Multiplayer.

## Controls

In the menus, the arrow keys move between the cards, `Enter` picks one and `Esc` goes back. With a controller, the D-pad (or left stick) moves, `A` picks and `B` goes back. The prompts along the bottom show the buttons for whatever you last used, and can be clicked or tapped too.

| Action | PC | Meta Quest |
| :-- | :-- | :-- |
| Paddle | Scroll the mouse wheel; the faster you scroll, the faster you can paddle | Sweep your hands from front to back, low by your sides ("in the water"). Faster strokes, more speed. Hold the controllers however feels natural: thumbs up, or turned in with palms down and the grip squeezed |
| Steer while paddling | `A` / `D` | Paddle harder on one side (a stronger right stroke turns you left) |
| Sit up and wait | `S` while paddling; `W`, `Space` or start paddling to lie back down. `A` / `D` turn the board | Sit up slowly and stop partway (head 22–75 cm above your paddling height); lie back down to paddle. Thumbstick left / right turns the board |
| Duck dive (longboard: turtle roll) | Hold `Ctrl` (or `C`) while paddling; let go to surface | Squeeze the grip with your hand held still on the front of the board (a hand squeezing the grip as it sweeps past is still paddling) |
| Pop up | `Space` (press again to lie back down) | Stand up for real: head rises 35 cm above your calibrated paddling height |
| Surf (weight shift) | `A` / `D` carve, `W` / `S` lean forward (trim) or back (stall) | Lean your head and body (how much a lean counts is adjustable: see below) |
| Crouch | Hold `Ctrl` (or `C`); let go at the lip to spring into an air | Crouch for real; stand up fast at the lip to hop |
| Snap · cutback · tailslide | Hold `Shift` and flick the mouse left or right | Hold either grip and whip your head round |
| Backflip | Crouch with `Shift` held, spring up into the air, let go of `Shift` just after and flick the mouse up | The same with a grip, crouching for real, and look up sharply |
| Longboard | `W` / `S` walk toward the nose or the tail | Walk forward or back on the board |
| Look | Mouse (click the game to capture it) | Your head |
| Other | `R` back to the lineup · `Esc` pause menu | `Y` pause menu · `B` back to the lineup · trigger: recalibrate |

These are the defaults. Every key and Quest button can be changed in **Controls and settings**, from the main menu or the pause screen. On PC, click a key and press the new one; mouse buttons work too. On Quest, pick a button for each action, either on the page or in VR from the headset's pause menu. If a key is already taken, the two actions swap, except where they can never clash: duck diving only happens while paddling and crouching only while standing, so both can stay on `Ctrl`. Scroll to paddle, mouse look, `Esc`, and the body movements on Quest stay fixed.

**Leaning sensitivity** (Controls and settings → Meta Quest, or in the headset: pause → Controls and settings → Leaning sensitivity) sets how hard the board carves (side to side) and trims or stalls (forward and back) for how far you lean. Each direction has two settings. **Centre** is how much small movements count, and **max** is how quickly a bigger lean builds to a full turn. The defaults (0.55 and 1.3) make small wobbles gentler than the original straight response while a full lean still turns as hard. A graph shows how far the board tilts for each angle you lean; in the headset, a dot on it shows your own lean while you're standing.

On Quest, kneel or lie down before you start, then press the trigger to calibrate your paddling height. `Y` opens a pause menu in the headset: resume, go back to the lineup, recalibrate, change the buttons and volume, or leave. Point at it with either controller and pull the trigger. If you don't have room, the thumbstick (forward to paddle, sideways to steer or lean, held back to sit up, forward again to lie down) and `A`/`X` (pop up / lie down) work as a fallback.

Sitting up and popping up are told apart by speed: rise slowly and hold still for half a second to sit, spring up quickly to pop up. To catch a wave from sitting, lie back down and paddle. Sitting in the whitewater of a big wave wipes you out, the same as standing in it.

On PC the game goes fullscreen and locks the keyboard when you start, so `Ctrl` combinations such as `Ctrl+W` reach the game instead of closing the tab. If that isn't available (e.g. Firefox), the browser asks before leaving the page, and `C` works instead of `Ctrl`. Fullscreen can be turned off in **Controls and settings**, which also has graphics quality, volume and mouse sensitivity.

### Controller

Any controller the browser recognises works on PC (Xbox, PlayStation, Switch Pro and others, by the standard layout; buttons are named as on an Xbox pad). Press a button and the hints switch to it.

| Action | Controller (defaults) |
| :-- | :-- |
| Paddle | Pull `LT` for a left-arm stroke and `RT` for a right-arm stroke, again and again. Faster pulls are harder strokes, and a stronger right stroke turns you left |
| Steer, carve, trim, walk | Left stick (the same as `W` `A` `S` `D`) |
| Sit up / lie down | Pull the left stick back while paddling / push it forward |
| Stand up / lie down | `A` |
| Duck dive (longboard: turtle roll) / crouch | Hold `B` (duck dive while paddling, crouch while surfing) |
| Snap, cutback, tailslide | Hold `LB` or `RB` and flick the right stick: straight out and back for a tailslide, a short flick for a snap, held out for a cutback |
| Backflip | Crouch with `LB` or `RB` held, spring up into the air, let go just after and flick the right stick up |
| Look around | Right stick (the view drifts back to straight ahead when you let go) |
| Back to the lineup | `Y` |
| Pause menu | `Menu` (Start) |

Every button can be changed in **Controls and settings → Controller**: click a box and press the button you want. There's also a sensitivity curve with a graph for each stick axis (as for VR leaning), the look speed, and inverted look. With a controller you can fly the drone as the camera drone (left stick flies, right stick turns and tilts the camera, `RT` / `LT` climb and descend) or, set to FPV, in acro mode exactly as in VR.

### Phones and tablets

Hold the phone sideways (upright works too, with less of the wave in view). The layout fits any screen, whatever its size or shape, and keeps clear of notches and rounded corners. In fullscreen the game stays in landscape where the browser allows it.

There are two ways to play, and the game asks which you want the first time you play (it remembers; change it in **Controls and settings → Touch**): **Swipe and tilt**, or **Buttons**.

**Buttons:**

| Action | Touch |
| :-- | :-- |
| Steer and carve | The joystick at the bottom left: put your thumb down anywhere there and drag. Standing, push it forward and back to trim, stall or walk the longboard |
| Paddle | Paddle left and Paddle right at the bottom right: tap for a stroke with that arm, hold to keep stroking. Take turns with them |
| Duck dive (longboard: turtle roll) | Hold Duck dive while paddling |
| Sit up / lie down | Sit (it says Lie down while you're sitting) |
| Stand up | Stand up, at the bottom, once you're moving over 5 mph or a wave has you |
| Back to paddling | Paddle, at the bottom, while you're standing |
| Crouch, tricks | Crouch and Snap at the bottom right while you're standing (the moves are as below) |
| Look around | Drag anywhere that isn't a button or the joystick |

**Swipe and tilt:** where your finger first touches decides what it does until you lift it, so a paddle stroke that starts high on the right and runs down into the look area never turns the view.

| Action | Touch |
| :-- | :-- |
| Paddle | Swipe down beside the board: on the left for your left arm, high on the right for your right arm. Faster swipes are harder strokes |
| Steer and carve | Tilt the phone left and right (while paddling, too) |
| Trim, stall, walk the longboard | Tilt it forward and back. The way you hold it when you start, or resume, counts as level |
| Stand up | Swipe up on the board. Swipe down on it to go back to paddling |
| Duck dive (longboard: turtle roll) | While paddling, swipe down on the board and keep your finger on the screen; lift it to come up |
| Sit up | Tap the board while paddling; tap again to lie down |
| Look around | Drag in the bottom right quarter of the screen |
| Crouch | The Crouch button on the left while you're surfing (tap on, tap off) |
| Snap, cutback, tailslide | Hold Snap on the left and swipe sideways in the look area |
| Backflip | Tap Crouch, hold Snap, tap Crouch again to spring up, let go of Snap just after and swipe up quickly in the look area |
| Pause, back to the lineup, recalibrate the tilt | The buttons at the top left (◎ makes the way you're holding it now level) |

A guide to the touch zones shows for the first few seconds.

**Backflips.** In the air after springing up out of a crouch with your trick button (Snap) held, let go of it within about half a second of uncrouching and look up sharply (a flick of the mouse or the right stick, a quick swipe up, or a jerk of your head in VR) to throw yourself over backwards: you tuck down and grab the rail by the nose to take the board round with you (in the replay and to other players). A sharper look spins you faster. You need a good pop to get all the way round: land before you're nearly round and you wipe out. On PC and phones the view goes over with you; in a headset it stays level, for comfort. **Controls and settings → Touch** has sensitivity curves with graphs for the tilt, and the look sensitivity.

**If tilting steers the wrong way** (some tablets, such as iPads, report the screen turned 90° from how it really is):

1. Hold the device the way you play and tap ◎, or **Recalibrate tilt** on the pause screen. That makes the way you're holding it level. The game also works out which edge of the screen is up from gravity, so this alone fixes most tablets.
2. If it's still wrong, open **Controls and settings → Touch**. Tilt the device and watch the dot on the bubble level: it should move the way you tilt.
3. If the dot goes the wrong way, use **Tilt directions** (Turn 90°, 180°, Turn −90°) until it follows you. The choice is remembered. iPhones ask for permission to use the motion sensors the first time. Phones get the lighter graphics setting automatically. As a drone, drag on the left half to fly and on the right half to turn and tilt the camera; ▲ ▼ climb and descend.

### Replay

In singleplayer the game keeps the last 30 seconds. Pause (Esc, Menu on a controller, the pause button on a touch screen, or Y in the headset) and pick **Replay the last 30 s**. The game stops where you paused it, and the last 30 seconds play back: the same waves, you as the full character on your board, and the spray off your board. You fly the drone around it with the usual drone controls (FPV too, if you've chosen it for a controller or VR). The replay loops until you end it.

| | Keyboard | Controller | Touch | Meta Quest |
| :-- | :-- | :-- | :-- | :-- |
| Play / pause | `K` (or `P`) | `X` | The bar at the bottom | Headset menu |
| Skip 5 s back / forward | `J` / `L` | D-pad ◀ / ▶ | −5 / +5 on the bar, or tap the timeline | |
| Slow motion (1×, 0.5×, 0.25×) | `[` / `]` | D-pad ▼ / ▲ | The speed button | Headset menu |
| Restart | `R` | `Y` | ⏮ | Headset menu, or `B` |
| End the replay | Esc, then **End replay** | Menu, then **End replay** | **End** | Headset menu |

Ending the replay takes you back to the pause screen with everything exactly as you left it. (The replay keys only work if you haven't put a control on them; controller replay buttons likewise.)

### How to catch and ride a wave

1. Pick a board in the menu. The longboard paddles faster and catches waves earlier but turns slowly unless you step back.
2. The top-right of the HUD counts down to the next wave and says which way it breaks. Turn toward the beach and start paddling a few seconds before it reaches you. The bar under your speed shows your paddling effort: lazy scrolling won't get you onto the wave.
3. Keep paddling as the face lifts you. When the HUD says **Caught it!**, pop up straight away. If you stay lying down as the board noses over a steep or pitching face it pearls, and popping up once it's already near vertical is too late. Pop up before the wave is carrying you and you'll just sink back down.
4. Angle along the face in the direction the wave is breaking. Riding down the face builds speed; climbing toward the crest bleeds it off.
5. To get barrelled, slow down (`S`) just ahead of the breaking lip so it pitches over you, and crouch: the tube is only tall enough to stand in near its middle. Then trim forward (`W`) to escape before it collapses.
6. Crouch on the way up the face and release at the lip to hop off the top. Land with the board pointing where you're travelling.
7. If you're caught inside with a wave about to land on you, duck dive under it.
8. You wipe out if you get sucked up the face of a pitching section (over the falls), the lip lands on you or clips your head in the barrel, or the whitewater catches you while you're standing. Waves under 1.5 m don't have that power: there you can ride the whitewater all the way in.

### Location, time of day, waves and your surfer

**Location** is chosen on the Singleplayer screen, or when you create a room.

- **Margaret River** peaks in a slightly different place each time and breaks either way, so you get rights and lefts.
- **Teahupo'o** is only a left: the reef past the peak just closes out, so go left. It comes out of deep water and jacks up late on the edge of the reef. A wide section throws at once, so you take off under the lip and race it, and the breaking point peels fast round the curve of the reef toward the deep channel.
  - The barrel is bigger and rounder, and it lands further out in front.
  - The water draws off the reef in front of the wave, and in the deepest troughs the reef can show.
  - Wait in the deep water just off the reef edge, a little toward the channel.
  - Duck dive or wipe out and you'll see the coral beneath you. From the lineup, under water, the reef slopes up out of the blue, with spurs and grooves running down it.
  - Look left from the lineup (facing the island) to see the coast run away across the bay to the rest of the island.
- **Wave Pool** is an artificial lagoon with clear blue water.
  - The wave machine sits in a long silver housing at the narrow back end, and a pier runs from it down the middle to the clubhouse. The back edges are concrete walls, the front edges sandy beaches.
  - Every 12 s a wave runs toward the shore across both halves at once. It reaches the shallow shelf at the outer corners first, so it starts barrelling out there and peels in toward the pier as it comes to the shore. That makes a right on one side of the pier and a left on the other.
  - A deep trench runs along the pier, and the current in it carries you back out toward the lineup. Paddle out beside the pier to get back quickly.
  - Near the shore there's a big arch under the pier: paddle through it to surf the other side.
  - Waves are 0.8 m to 2 m, which is what a real wave machine makes. Kick out before the pier: ride into it and you wipe out.
- **Eisbach** is a river wave in a park in the middle of Munich. It doesn't travel: the river pours out from under the bridge, drops into a trough and stands up into a wave about a metre high, and the water runs through it at 4 to 5 m/s.
  - You start on the bank with your board under your arm, in first person. Walk along the banks (your movement keys, the left stick, the left of a touch screen, or the left thumbstick in a headset); `Shift`, or the stick pushed all the way, runs. You can't walk into the river.
  - At the edge beside the wave, jump in (`Space`, `A`, the **Jump in** button on a touch screen, `A` / `X` in a headset). You land standing on the face, facing up the river.
  - On a standing wave the slope pulls you up the river as hard as the water drags you down it, so you hold your place. Carve across it from wall to wall; lean back (`S`) to drop toward the foot of the wave, forward (`W`) to climb. Speeds and turns go by how fast the board moves through the water, not over the ground.
  - Ride over the top into the foam, wipe out, or slide off the bottom, and the river takes you away: you're back on the bank. The walls are close: hit one hard and you fall.
  - Near a bank, crouch and let go (as for an air) and you jump out over the wall and land on your feet on the bank.
  - **Back to the lineup** on the bank swaps to the other bank. In a headset, the right thumbstick turns you on the bank, and stand up before you jump in (it calibrates you standing).
  - The **Waves** setting is the wave's height, 0.6 m to 1.3 m (the river carries more or less water).

**Time of day** (Singleplayer screen, Create a room, and the singleplayer pause screen) switches between **Midday** and **Sunset**. At sunset the sun sits a few degrees above the horizon out to sea. At Margaret River and Teahupo'o the swell comes from the south-west, so the sun sets in the west, a little to the right as you look out. It's behind the waves as you paddle out, so it lays a long path of light across the water and shines through the crests and the lip. The sky, the reflections in the water, the fog, the sunlight on the surfers and the light under water all shift to dusk colours.

In multiplayer the location and the time of day belong to the room. They're set when it's created and are the same for everyone in it.

The **Waves** setting is on the Singleplayer screen, in Create a room, in the room lobby, and on the pause screen. **Set height** picks a size, and each wave varies a few percent around it: 0.6 m to 3.4 m at Margaret River, 1 m to 6 m at Teahupo'o, 0.8 m to 2 m in the Wave Pool. **Random** lets the size drift (about 0.8 m to 3 m at Margaret River, 1.8 m to 5.4 m at Teahupo'o, 0.9 m to 1.8 m in the pool), building and fading over a few minutes, with no wave much bigger than the last. Your choice is remembered for each location. A change applies from the next wave, so the ones already rolling in keep their size. Small waves are relatively longer and gentler, more like mushy beginner waves, so they can still be caught at the game's fixed wave speed.

**Your surfer** (Singleplayer screen and the room lobby) sets your skin tone, hair colour and board colour. You start with a random look, so everyone looks different, and it's remembered. Your first-person arms and board follow it, and other players see the full character.

## Multiplayer

1. Choose **Multiplayer**, then set your name and board. Your look and the wave size are set in the room lobby.
2. **Find a room** lists the open rooms and who's in them; type to search by name. Rooms marked 🔒 are private and ask for the passcode.
3. Or **Create a room**: give it a name and make it public, or private with a passcode of at least 3 characters. Then pick the location and the time of day, which are fixed for the room, and the wave size, which anyone can change later. The room list shows each room's location and time of day.
4. In the room, choose **Play on PC** or **Play in VR**. Everyone in the room gets the same waves at the same moment. Other surfers appear with name tags, and a feed shows who paddled out, got barrelled or wiped out. You can see where they're looking: their heads turn with their view while they paddle or sit, and their upper bodies twist with it on a wave. You can change your name, and anyone can change the room's wave size, from the pause menu.

### Collisions (experimental)

The room's leader can turn on **Collisions**, in the lobby or the pause menu (or the headset's pause menu). Then you bump into each other, paddling or surfing. The leader is whoever created the room. If they leave, it passes to whoever has been in the room longest, and the lobby marks who it is. Everyone else sees whether it's on.

- A gentle bump just pushes you apart. A hard one, at speed, knocks you off.
- **Lying down,** you're pushed along your board far more easily than sideways. It's shaped to glide forward, but sideways the rails, the fins and your body all have to shove water aside. A bump from behind pushes you along.
- **Sitting,** your legs hang down in the water and anchor you, so a bump hardly moves you. But the board pivots round you, so a knock at the nose swings you round.
- **Standing,** your feet are spread along the board, so a knock from the side unbalances you far more than one from in front or behind.
- **Lean into a bump** to brace against it: you're pushed less, and it takes a harder knock to throw you off. Lean away from it and you're pushed further and fall off more easily. You lean the way you steer: `A` / `D`, the controller's left stick, or tilting your phone (standing, that also carves you toward them). In a headset, lean your body; lying down or sitting, lean your head to the side.

Each player's game works out every bump from both surfers' positions, speeds, headings and leans, and moves only its own surfer, so both see the same bump. You each see the other a fraction of a second late, so sometimes only one game catches a bump. It then tells the other game, which takes its share of the same bump.

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

**FPV drone (VR or a controller).** In Controls and settings → Meta Quest or Controller (or the headset's settings), set the drone to **FPV drone** to fly like a racing drone in acro mode instead.
- **Sticks:** the left stick is throttle (up for more; it springs back to the middle, which hovers) and yaw. The right stick is pitch and roll.
- **Rate control:** the sticks set how fast it rotates, not its angle. Let go and it holds whatever attitude it's in, so you fly it like a real FPV quad: tilt, then add throttle to go.
- **Camera:** fixed in the nose, tilted up 25°, and it ignores your head, like goggles with no head tracking. That's intense in a headset, so take it easy at first.
- With keyboard and mouse or touch, the drone is always the camera drone.

### How it works

- The Firebase Realtime Database is only used to find rooms. Each player in a room writes one entry of about 100 bytes, `lineup/rooms/<room>/<player>`, with `onDisconnect().remove()`. The entry includes the room's location and time of day, so the room list can show them. A room is nothing more than its players' entries, so it disappears as soon as the last player leaves or closes the tab. There is no cleanup job and nothing is left behind.
- Players connect to each other directly over WebRTC using [Trystero](https://github.com/dmotz/trystero). Trystero uses the same database for the brief connection handshake and deletes those records itself. Positions and where each player is looking, events and clock sync all go peer-to-peer and never touch Firebase. A position update is packed into 52 bytes, and how often it goes depends on what you're doing: 15 times a second riding (or close to someone with collisions on), 10 paddling, 4 sitting still. In between, the others predict where you are, and pose you a little further behind the latest update when they come further apart, so you still move smoothly.
- Other players are shown where they are now, not where they were when their last update left: each update carries their velocity, so their position is predicted ahead and eased toward each new update. It also carries their height above the water, and their board is placed that far above your own copy of the wave, so it can't sink into the wave when an update is late.
- Waves aren't sent over the network at all. Each room has a random seed, a shared clock, a location and a wave-size setting, and every player generates the same sets from them. A player who joins takes the clock of whoever has been in the room longest. A change to the wave size carries the wave number it starts from, so everyone switches on the same wave.
- In a private room the passcode is the key Trystero encrypts the handshake with, so players without it can't connect. The room list stores only a short hash of it so that a wrong passcode is rejected straight away.

### Firebase free plan

The Spark plan allows 100 simultaneous connections, 1 GB of storage and 10 GB of downloads a month. LINEUP is built to stay well inside that:

- A browser connects to Firebase only while the Multiplayer menu is open or while it's in a room. Singleplayer never loads Firebase.
- Storage stays near zero: about 100 bytes per player currently in a room.
- Downloads are mostly the live room list while people are browsing (only changes are sent), plus a few KB of handshake per pair of players.
- The limit you'll reach first is the 100 simultaneous connections, i.e. about 100 people in multiplayer at once.

### Database rules

Test-mode rules expire after 30 days and leave the whole database open until then. Paste [database.rules.json](database.rules.json) into **Realtime Database → Rules** in the Firebase console. The rules allow only the room list, Trystero's handshake data and reading the relay login (see below), and limit each player entry to the fields and sizes the game writes. If you pasted them before locations were added, paste them again: with the old rules rooms still work, but the room list shows every room as Margaret River at midday. Players pick up the room's real location and time of day once they're connected.

To use your own Firebase project instead, create a Realtime Database, paste in the rules, and set `MULTIPLAYER.databaseURL` in `js/config.js`.

### If players can't connect

WebRTC connects players directly when it can, using public STUN servers to find a route. Strict NATs and many university, office and mobile networks block that, and then players in the same room can't see each other ("Couldn't connect to … one of your networks blocks direct connections"). The fix is a TURN relay, which passes the traffic through a server when a direct route fails. Players who can connect directly still do; only blocked connections use the relay. The lobby marks the players you're connected to through it with **relay**.

The game uses Metered's TURN relay (<https://dashboard.metered.ca/signup?tool=turnserver>; 20 GB of relay traffic a month free). The relay's data is metered, so players reached through it get fewer updates: 10 a second riding, 5 paddling, 2 sitting still. A pair of players going through the relay uses about 8 MB an hour on a typical session of waiting, paddling and riding (about 16 MB an hour riding the whole time), a quarter of what it used to. **Its username and password are not in this repository.** They're kept in the Firebase database at `lineup/turn`, which the rules let anyone read but nobody write except from the Firebase console, and the game reads them when you join a room. To set it up:

1. In the Metered dashboard, create a TURN credential and copy its username and password.
2. Paste the rules from [database.rules.json](database.rules.json) into **Realtime Database → Rules** and publish.
3. In **Realtime Database → Data**, add a child `turn` under `lineup` (add `lineup` first if it isn't there) whose value is the text `username:password`.

That's all: no code change and nothing to push. To change the login (for example if it's being misused), make a new credential in Metered, delete the old one, and edit that value.

Keeping the login out of the code means it isn't sitting in the repository for bots that scan GitHub for keys. It still isn't fully secret: a browser has to be given it to use the relay, so a determined player could find it in their browser's network tools. Without a server of your own, that can't be avoided. The most it can cost is your Metered allowance (and any balance you've topped up).

Other options in `js/config.js`: `MULTIPLAYER.turnHosts` lists the relay addresses (change them for another TURN provider), `turnCredentialsURL` takes any URL that returns a list of ICE servers (such as a small server of your own that hands out short-lived logins), and `turnServers` takes fixed servers (these are public, so only for ones that don't need protecting).

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
| `js/config.js` | Tunables: wave timing (and the active spot's wave), swell spectrum, sun, times of day, quality presets, board types, multiplayer settings |
| `js/spots.js` | The surf spots: how each one's wave breaks, the barrel shape, wave sizes, lineup, water colour |
| `js/wave.js` | Wave model: set lifecycle, peeling and collapse, swell, and the seeded wave schedule used in multiplayer rooms. Also the JS copy of the wave maths used by the physics and spray |
| `js/shaders/waveChunk.js` | GLSL copy of the wave maths (profile, curling lip, Gerstner swell). Must stay identical to `wave.js` |
| `js/ocean.js` | Water shader: refraction to the seabed, absorption and scattering, light through thin water, Fresnel reflection, foam, haze |
| `js/oceanGrid.js` | Adaptive ocean mesh. Row and column positions are recomputed every frame so vertices cluster at the camera, the crest and the breaking point |
| `js/surfer.js` | Board physics and the prone / pop-up / standing / wipeout state machine. Also paddling effort, duck dives, crouching and airs, longboard walking, and manoeuvres |
| `js/bump.js` | Collisions (multiplayer, experimental): where two boards touch, the impulse between them, and how each surfer takes it (pushed, turned or knocked off) |
| `js/underwater.js` | Shows the body through the water (a stencil-masked second pass), plus the underwater view: seabed dome, light shafts, bubbles |
| `js/input.js`, `js/xr.js` | PC input; Quest head/hand gesture input with calibration |
| `js/gamepad.js`, `js/touch.js` | Controller input (paddling strokes on the triggers, stick flicks for tricks, menu navigation); touch input (swipe zones, phone tilt, the on-screen buttons) |
| `js/lean.js` | Sensitivity curves for VR leaning, controller sticks and phone tilt, and their graphs |
| `js/body.js`, `js/board.js` | First-person arms: the paddle stroke (a smooth looped path for each hand) on PC and phones, and reaching for the controllers in VR; parametric shortboard and longboard |
| `js/fparms.js` | The character's own arms cut out of `assets/surfer.glb` into a separate skinned mesh, posed with two-bone IK |
| `js/sky.js` | Procedural HDR sky (rendered once into a cube map), midday and sunset |
| `js/terrain.js` | Each spot's land and seabed (and its GLSL copy for the water shader); Margaret River's beach, headland, island and trees |
| `js/teahupoo.js` | Teahupo'o: the reef (its edge follows the line where the wave breaks), lagoon, pass, mountains, the far side of the island, palms and houses, and the 3D reef seen under water |
| `js/eisbach.js` | The Eisbach: loads and Draco-decodes the model, and measures from it the ground you can walk on and the channel's walls (so the water and the surfer fit it); the banks for the drone and the surfer |
| `js/river.js` | A river's standing wave: its shape, how fast the water runs through it, the foam, what the surfing physics sees, and the water mesh and shader |
| `js/walker.js` | On foot: walking the river banks in first person (steps up, falls off ledges, never into the river) |
| `js/wavepool.js` | The Wave Pool: its floor (deep at the back, a shallow shelf along the break line, beaches, the trench by the pier), walls, the pier with its arch and the machine housing, clubhouse, cabins, canopies and fields, and keeping surfers off the walls and pier |
| `js/landkit.js` | Shared pieces for building land: noise, ridges, the land mesh |
| `js/spray.js`, `js/audio.js`, `js/hud.js`, `js/textures.js` | Spray particles, procedural sound, HUD, generated textures |
| `js/replay.js` | Singleplayer replays: the last 30 seconds of the waves and your surfer, recorded every frame (main.js plays them back) |
| `js/spraysheet.js` | High graphics: sheets of water off the board (the bow wave as you paddle in, the fan in a turn), and the streaking drops thrown with them |
| `assets/surfer.glb` | The surfer: 19-bone rig with Idle, Walk, Run, Surf and Paddle clips |
| `assets/menu/` | Menu art, rendered from the game with the debug views below |
| `database.rules.json` | Recommended Firebase Realtime Database rules |

### How the barrel works

Each vertex of the ocean grid has a rest position along the wave and a crest-relative coordinate `u`. A smooth asymmetric profile gives the unbroken wave. Physics uses this smooth surface, as the spec allows. It keeps the middle of the board on the surface. The board as it's drawn (and as replays and other players show it) is then turned about its middle, and lifted only if it has to be, so no part of it sits deeper than it would on flat water. That keeps the nose out of a hollow face.

Once a section starts breaking, points near the crest rotate around a tube centre in front of the face. The front of the wave becomes the inside of the tube and the back becomes the outer surface of the lip, so the mesh folds into a real overhang. The crest pitches first and the lower face follows.

Breaking starts at the peak and spreads along the wave at the peel speed. Each section pitches, stays an open barrel for a few seconds, then collapses into a lower, foamy bore.

### Debug URL parameters

- `?q=low` / `?q=high`: quality preset. Quest defaults to `low`.
- `?debug`: shows FPS and wave state for the board's position.
- `?board=shortboard|longboard`: choose the board (otherwise the last one picked in the menu).
- `?spot=margaret|teahupoo|pool|eisbach`: choose the location (not saved), e.g. with the preset scenes below.
- `?shot=lineup|barrel|shoulder|behind|paddle|duckdive|beach|boards`: jumps to a preset scene, skipping the menu. Add `&freeze` to stop time.
- Extra preset options: `&stand`, `&crouch=0..1`, `&dive=depth` (e.g. `&dive=1.1` to look around under water), `&foot=-1..1.2` (longboard stance), `&pitch=` / `&lookyaw=` (radians), `&tau=` (seconds since the wave started breaking; negative is before).
- `&bots=N`: puts N stand-in surfers around you, to check how other players look. They sit and look around, or paddle; `&botpose=prone|sit|stand` puts them all in one pose. Add `&bump` to bump into them as with collisions on (they stay put and don't feel it). `&wave2=z`: adds a second wave of the set with its crest at `z`. `&waveh=1.0`: the preset wave's height in metres.
- `?shot=barrel&freeze&cam=x,y,z,yawDeg,pitchDeg`: free spectator camera.
- `?relay`: multiplayer connections only go through the TURN relay (to test the relay set-up).
