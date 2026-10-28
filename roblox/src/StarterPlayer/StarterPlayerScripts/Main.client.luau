-- LINEUP for Roblox: the game flow, camera and main loop (port of js/main.js).
-- First person on your board: paddle into glassy waves, pop up, and race the peeling lip
-- through the barrel. Everyone at the same spot in a server surfs the same waves.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local UserInputService = game:GetService("UserInputService")
local StarterGui = game:GetService("StarterGui")

local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config = require(Lineup.Config)
local Spots = require(Lineup.Spots)
local WM = require(Lineup.WaveModel)
local Land = require(Lineup.Land)
local Surfer = require(Lineup.Surfer)
local Ocean = require(Lineup.Ocean)
local Board = require(Lineup.Board)
local Arms = require(Lineup.Arms)
local Input = require(Lineup.Input)
local Hud = require(Lineup.Hud)
local Menu = require(Lineup.Menu)
local World = require(Lineup.World)
local Remote = require(Lineup.Remote)
local Spray = require(Lineup.Spray)
local Audio = require(Lineup.Audio)
local Landscape = require(Lineup.Landscape)

local net = ReplicatedStorage:WaitForChild("LineupNet")
local player = Players.LocalPlayer
local camera = workspace.CurrentCamera

local S = Config.SCALE
local STATE = Surfer.STATE
local WAVE = Config.WAVE
local EYE = Config.EYE
local clamp, mix, smoothstep = WM.clamp, WM.mix, WM.smoothstep
local exp, sin, abs, max, min, pi = math.exp, math.sin, math.abs, math.max, math.min, math.pi

pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Health, false)
end)

---------------------------------------------------------------- settings
local SKINS = { Color3.fromRGB(241, 194, 160), Color3.fromRGB(224, 172, 130), Color3.fromRGB(192, 132, 101), Color3.fromRGB(150, 98, 66), Color3.fromRGB(104, 66, 44) }
local DECKS = { nil, Color3.fromRGB(250, 214, 80), Color3.fromRGB(110, 200, 230), Color3.fromRGB(240, 120, 90), Color3.fromRGB(150, 220, 150) }
local settings = {
	spot = Spots.DEFAULT,
	board = "shortboard",
	time = "day",
	sensitivity = 1,
	invertY = false,
	waves = {},
	skin = SKINS[math.random(#SKINS)],
	deck = DECKS[math.random(#DECKS)],
}
for _, id in ipairs(Spots.ORDER) do
	settings.waves[id] = { mode = "set", height = Spots[id].heights.default }
end

---------------------------------------------------------------- the world
local model = WM.WaveModel.new()
local surfer = Surfer.new(model)
local epoch = net:GetAttribute("Epoch") or 0
local function clock()
	-- (Studio testing: LineupTimeOffset shifts the waves in time)
	return workspace:GetServerTimeNow() - epoch + (workspace:GetAttribute("LineupTimeOffset") or 0)
end

local folder = Instance.new("Folder")
folder.Name = "LineupClient"
folder.Parent = workspace

local spot = Spots[settings.spot]
-- (phones and tablets get the lighter ocean; the pause menu can change it)
settings.quality = if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then "low" else "high"
if RunService:IsStudio() and workspace:GetAttribute("LineupQuality") then
	settings.quality = workspace:GetAttribute("LineupQuality")
end
local ocean = Ocean.new(model, { quality = settings.quality, parent = folder, water = spot.water, origin = spot.origin, spot = spot.id })
local arms = Arms.new(folder)
arms:setSkin(settings.skin)
local remote = Remote.new(folder, model)
local spray = Spray.new(folder)
local audio = Audio.new()

local boardModel, placeBoard, boardKind, boardDeck = nil, nil, nil, nil
local function ensureBoard()
	if boardModel and boardKind == settings.board and boardDeck == settings.deck then
		return
	end
	if boardModel then
		boardModel:Destroy()
	end
	boardModel, placeBoard = Board.create(settings.board, settings.deck)
	boardKind, boardDeck = settings.board, settings.deck
	boardModel.Parent = folder
end

local hud = Hud.new()
local input = Input.new()
-- (Studio testing: LineupDevice = "pc" | "pad" | "touch" shows that device's controls)
if RunService:IsStudio() and workspace:GetAttribute("LineupDevice") then
	input.device = workspace:GetAttribute("LineupDevice")
end
hud:buildTouch(input)
local menu = Menu.new(settings)

---------------------------------------------------------------- game state
local game_ = {
	mode = "menu", -- menu | play | paused
	look = { yaw = 0, pitch = 0 },
	camYaw = nil,
	snapCam = true,
	moveFollow = 0,
	lookRate = 0,
	lookUpRate = 0,
	upCool = 0,
	flick = nil,
	lookIdle = 0,
	standBlend = 0,
	sitBlend = 0,
	ride = nil,
	best = 0,
	noseT = 0,
	noseCalled = 0,
	teleport = 0,
	missTimer = 0,
	poseT = 0,
	wasUnder = false,
}

local function wrap(a)
	return (a + pi) % (2 * pi) - pi
end

local function heightsFor(id)
	local ok, cfg = pcall(HttpService.JSONDecode, HttpService, net:GetAttribute("Waves_" .. id) or "")
	return if ok then cfg else { mode = "set", height = Spots[id].heights.default }
end

local waveConn = nil
local function applySpot(id)
	spot = Spots[id]
	WM.applySpotWave(spot)
	Land.set(id)
	model:setSchedule(net:GetAttribute("Seed_" .. id) or 1, clock, heightsFor(id))
	if waveConn then
		waveConn:Disconnect()
	end
	waveConn = net:GetAttributeChangedSignal("Waves_" .. id):Connect(function()
		local cfg = heightsFor(id)
		model:setHeights(cfg)
		settings.waves[id] = { mode = cfg.mode, height = cfg.height }
		menu:refresh()
	end)
	local cfg = heightsFor(id)
	settings.waves[id] = { mode = cfg.mode, height = cfg.height }
	ocean:setSpot(id, spot.origin, spot.water)
	remote:setSpot(id, spot.origin)
	task.spawn(Landscape.build, id, spot.origin, folder, function()
		return ocean:ready()
	end)
	-- (a pool's walls and pier keep you in the water)
	surfer.collide = Land[id] and Land[id].collide or nil
end

local function applyTime()
	World.applyTime(settings.time)
	ocean:setLight(World.light(settings.time))
end

---------------------------------------------------------------- the lineup
local function lineupSpot()
	local L = spot.lineup
	local w = nil
	for _, c in ipairs(model.waves) do
		if c.active and c.crestZ0 < L.z - 6 and (not w or c.crestZ0 > w.crestZ0) then
			w = c
		end
	end
	local x = if w then w.peakX + w.dir * L.side else 0
	if WAVE.mirror ~= 0 then
		local side = if surfer.x ~= 0 then math.sign(surfer.x) else (if math.random() < 0.5 then -1 else 1)
		x = side * ((if w then w.peakX else WAVE.mirror) - L.side)
	end
	return x, L.z, 0
end

local function respawn(fadeOut)
	if fadeOut then
		game_.teleport = 1.4
		return
	end
	local x, z, yaw = lineupSpot()
	surfer:reset(x + (math.random() * 2 - 1) * (if #Players:GetPlayers() > 1 then 6 else 0), z, yaw)
	game_.snapCam = true
	game_.look.yaw, game_.look.pitch = 0, 0
	game_.ride = nil
	game_.missTimer = 0
end

---------------------------------------------------------------- rides and events
local function sendFeed(e)
	e.spot = settings.spot
	net.Feed:FireServer(e)
end

local function startRide()
	game_.ride = { time = 0, top = 0, tube = 0, nose = 0, tricks = {}, called = false }
end

local function endRide(reason)
	local r = game_.ride
	game_.ride = nil
	if not r or r.time < 2 then
		return
	end
	local parts = { ("Ride %.1f s"):format(r.time), ("top %d km/h"):format(math.floor(r.top * 3.6 + 0.5)) }
	if r.tube > 0.3 then
		table.insert(parts, ("barrel %.1f s"):format(r.tube))
	end
	if r.nose > 0.3 then
		table.insert(parts, ("nose %.1f s"):format(r.nose))
	end
	local counts, flips = {}, 0
	for _, t in ipairs(r.tricks) do
		counts[t] = (counts[t] or 0) + 1
		if t == "backflip" then
			flips += 1
		end
	end
	for k, n in pairs(counts) do
		table.insert(parts, ("%d %s%s"):format(n, k, if n > 1 then "s" else ""))
	end
	local score = math.floor(r.time * 10 + r.top * 6 + r.tube * 60 + r.nose * 25 + #r.tricks * 40 + flips * 60 + 0.5)
	local best = score > game_.best
	if best then
		game_.best = score
	end
	local titles = { wipeout = "Ride over", kickout = "Nice kick-out!", closeout = "Closed out" }
	task.delay(if reason == "wipeout" then 3 else 0, function()
		hud:rideCard(titles[reason] or "Ride over", score, parts, best and score > 120)
	end)
	sendFeed({ k = "ride", time = math.floor(r.time * 10) / 10, score = score })
end

local TRICK_NAMES = { snap = "Snap", cutback = "Cutback", tailslide = "Tailslide" }
surfer.onEvent = function(kind, data)
	if kind == "wipeout" then
		endRide("wipeout")
		hud:toast("Wipeout · " .. data.reason, 3.2)
		audio:play("thud")
		spray:burst(surfer.position, 1.4)
		sendFeed({ k = "wipeout", reason = data.reason })
	elseif kind == "closeout" then
		endRide("closeout")
	elseif kind == "sink" then
		hud:toast(if data.waveNear then "Too early! Pop up once the wave is carrying you" else "Too slow to stand. Paddle to get moving again", 3)
	elseif kind == "maneuver" then
		hud:callout(TRICK_NAMES[data.kind], "+40")
		audio:play("whoosh")
		if game_.ride then
			table.insert(game_.ride.tricks, data.kind)
		end
	elseif kind == "air" then
		hud:callout("Air!", ("%.1f s · +40"):format(data.time))
		if game_.ride then
			table.insert(game_.ride.tricks, "air")
		end
		sendFeed({ k = "air" })
	elseif kind == "backflip" then
		hud:callout("Backflip!", "+100")
		audio:play("splash")
		if game_.ride then
			table.insert(game_.ride.tricks, "backflip")
		end
		sendFeed({ k = "backflip" })
	elseif kind == "takeoff" then
		audio:play("splash", 0.6)
	elseif kind == "duckdive" then
		audio:play("plunge")
	elseif kind == "surface" then
		audio:play("splash", 0.7)
	elseif kind == "state" and data.to == STATE.POPUP then
		audio:play("splash", 0.5)
	end
end

local function updateGame(dt)
	local s = surfer.s
	if surfer.riding and surfer.state == STATE.STANDING then
		if not game_.ride then
			startRide()
		end
		local r = game_.ride
		r.time += dt
		r.top = max(r.top, surfer:planeSpeed())
		if surfer.inTube then
			r.tube += dt
			if r.tube > 0.6 and not r.called then
				r.called = true
				sendFeed({ k = "tube" })
			end
		end
	elseif game_.ride and surfer.state == STATE.STANDING and not surfer.air then
		local behind = s.un < -0.7 or not s.wave or s.H < 0.6
		if behind then
			endRide(if s.un < -0.7 then "kickout" else "over")
		end
	elseif game_.ride and surfer.state == STATE.PRONE then
		endRide("over")
	end

	-- nose riding on the longboard
	local onNose = surfer.board.walk and surfer.state == STATE.STANDING and surfer.footPos > 0.88 and surfer:planeSpeed() > 3
	if onNose then
		game_.noseT += dt
		if game_.ride then
			game_.ride.nose += dt
		end
		if game_.noseT > 0.3 and game_.noseCalled < 1 then
			hud:callout("Hang five", "nose ride")
			sendFeed({ k = "hang", n = 5 })
			game_.noseCalled = 1
		end
		if surfer.footPos > 1.06 and game_.noseT > 0.6 and game_.noseCalled < 2 then
			hud:callout("Hang ten!", "toes over the nose")
			sendFeed({ k = "hang", n = 10 })
			game_.noseCalled = 2
		end
	elseif surfer.footPos < 0.6 then
		game_.noseT = 0
		game_.noseCalled = 0
	end

	-- wipeout -> back to the lineup
	if surfer.state == STATE.WIPEOUT and surfer.stateTime > 2.4 and game_.teleport <= 0 then
		respawn(true)
	end
	-- drifted inside or far away (or washed up on a beach) without a ride: paddle back out
	local inside = surfer.z > spot.inside.z or abs(surfer.x) > spot.inside.x or surfer.z < -260 or Land.seabedY(surfer.x, surfer.z) > -0.45
	local idle = surfer.state == STATE.PRONE and not surfer.riding
	if inside and idle and game_.teleport <= 0 then
		game_.missTimer += dt
		if game_.missTimer > 4 then
			hud:toast("Paddling back out to the lineup…", 2.5)
			respawn(true)
		end
	else
		game_.missTimer = 0
	end
end

local function waveLabelFor(w)
	if w.dir == 0 then
		return "left and right"
	end
	return if w.dir > 0 then "left" else "right"
end

local function popKey()
	return if input.device == "pad" then "A" elseif input.device == "touch" then "Stand up" else "Space"
end

local function nextWaveInfo()
	if surfer.state == STATE.WIPEOUT then
		return ""
	end
	if surfer.state ~= STATE.PRONE then
		local r = game_.ride
		if r then
			return ("Ride %.1f s"):format(r.time) .. (if r.tube > 0.1 then (" · barrel %.1f s"):format(r.tube) else "")
		end
		return ""
	end
	if surfer.diving then
		return "Release to surface"
	end
	if surfer.catching then
		return ("Caught it! Pop up (%s) before it goes vertical"):format(popKey())
	end
	local best, bt = nil, nil
	for _, w in ipairs(model.waves) do
		if w.active then
			local t = (surfer.z - w.crestZ0) / WAVE.speed
			if t > 0 and (not bt or t < bt) then
				best, bt = w, t
			end
		end
	end
	if not best then
		return ""
	end
	if bt < 3 then
		return if input.device == "pc" then "Paddle hard! (scroll fast)" else "Paddle hard!"
	end
	return ("Next wave %d s · %.1f m %s"):format(math.ceil(bt), best.height, waveLabelFor(best))
end

local HINTS = {
	pc = {
		paddle = "Scroll to paddle · A / D steer · Space pop up · S sit · Ctrl duck dive · R lineup · Tab pause",
		stand = "A / D carve · W / S trim / stall · Ctrl crouch · Shift + flick for tricks · Space lie down",
		sit = "A / D turn · W or scroll to lie down and paddle",
	},
	pad = {
		paddle = "LT / RT paddle · left stick steer · A pop up · B duck dive · stick back to sit · Y lineup",
		stand = "Left stick carve / trim · B crouch · LB / RB + right stick flick for tricks · A lie down",
		sit = "Left stick turns · push it forward to lie down",
	},
	touch = { paddle = "", stand = "", sit = "" },
}

---------------------------------------------------------------- camera
local function detectFlick(dt, lx, ly, gy)
	-- look turn speed (+ = left) while the trick button is held
	local rate = if dt > 0 then (-lx * 0.0024) / dt + gy else 0
	game_.lookRate += (rate - game_.lookRate) * (1 - exp(-dt / 0.03))
	local up = if dt > 0 then (-ly * 0.0024) / dt else 0
	game_.lookUpRate += (up - game_.lookUpRate) * (1 - exp(-dt / 0.03))
	game_.upCool = max(0, game_.upCool - dt)
	local sharp = if input.device == "touch" then 3 else 5
	if game_.lookUpRate > sharp and game_.upCool <= 0 and surfer.state == STATE.STANDING then
		surfer:flipUp((game_.lookUpRate / sharp) * 0.55)
		game_.upCool = 0.4
	end
	local f = game_.flick
	if f then
		f.t += dt
		f.sweep += (-lx * 0.0024 + gy * dt) * f.dir
		f.peak = max(f.peak, game_.lookRate * f.dir)
		if (f.t > 0.1 and game_.lookRate * f.dir < 1.5) or f.t > 0.45 then
			surfer:flick(f.dir, f.peak, f.sweep)
			game_.flick = nil
		end
	elseif input:down("charge") and surfer.state == STATE.STANDING and not surfer.move and abs(game_.lookRate) > 4 then
		game_.flick = { dir = math.sign(game_.lookRate), t = 0, sweep = 0, peak = 0 }
	end
end

-- The view follows the board heading with a little lag; during a manoeuvre the board swings
-- round under a fixed view, then the view eases back to straight ahead.
local function updateCamYaw(dt)
	if game_.camYaw == nil or game_.snapCam then
		game_.camYaw = surfer.yaw
		game_.snapCam = false
	end
	if surfer.move then
		game_.moveFollow = 0.6
	end
	if game_.moveFollow > 0 then
		local d = wrap(surfer.yaw - game_.camYaw)
		game_.camYaw += d
		game_.look.yaw = clamp(game_.look.yaw - d, -2.9, 2.9)
		if not surfer.move then
			game_.moveFollow -= dt
			game_.look.yaw *= exp(-dt * 5)
		end
		return
	end
	local d = wrap(surfer.yaw - game_.camYaw)
	game_.camYaw += d * (1 - exp(-dt * 7))
end

local function slerpIdentity(q, t)
	return CFrame.identity:Lerp(q, t)
end

local function updateCamera(dt)
	local lx, ly, gy, gp = input:consumeLook()
	local sens = settings.sensitivity
	lx *= sens
	ly *= sens * (if settings.invertY then -1 else 1)
	game_.look.yaw = clamp(game_.look.yaw - lx * 0.0024 + gy * dt, -2.9, 2.9)
	game_.look.pitch = clamp(game_.look.pitch - ly * 0.0024 - gp * dt * (if settings.invertY then -1 else 1), -1.35, 1.35)
	if lx ~= 0 or ly ~= 0 or gy ~= 0 or gp ~= 0 then
		game_.lookIdle = 0
	else
		game_.lookIdle += dt
	end
	-- with a controller or a touch screen the view drifts back to straight ahead
	if (input.device == "pad" or input.device == "touch") and game_.lookIdle > 1.2 and not game_.flick then
		local k = exp(-dt * 1.6)
		game_.look.yaw *= k
		game_.look.pitch *= k
	end
	detectFlick(dt, lx, ly, gy)
	if surfer.flip then
		game_.look.pitch *= exp(-dt * 5)
	end

	updateCamYaw(dt)
	local qYaw = CFrame.Angles(0, game_.camYaw, 0)
	local q = qYaw:Inverse() * surfer.quatBase
	local ex, _, ez = q:ToEulerAnglesYXZ()
	local b = smoothstep(0, 1, game_.standBlend)
	local sb = smoothstep(0, 1, game_.sitBlend)
	local eye = EYE.prone:Lerp(EYE.standing, b):Lerp(EYE.sitting, sb)
	eye += Vector3.new(surfer.leanX * 0.14 * b, -surfer.crouch * Config.CROUCH_DROP * b, -(surfer.leanZ * 0.12 + surfer.footPos) * b)
	eye = slerpIdentity(q, mix(mix(0.85, 0.3, b), 0.3, sb)) * eye
	local pitch = game_.look.pitch + ex * mix(mix(0.5, 0.22, b), 0.1, sb) + mix(mix(-0.05, -0.2 - 0.12 * surfer.crouch, b), -0.22, sb)
	local roll = ez * mix(0.3, 0.2, b)
	local turtle = surfer:turtleAngle()
	if turtle > 0 then
		eye = CFrame.fromAxisAngle(Vector3.zAxis, turtle) * eye
		roll += turtle
	end
	local yaw = game_.look.yaw
	if surfer.state == STATE.WIPEOUT then
		local t = surfer.stateTime
		eye -= Vector3.new(0, min(1.2, t * 1.4), 0)
		roll += sin(t * 3.1) * 1.2 * min(1, t)
		pitch += sin(t * 2.3) * 0.8 * min(1, t)
	end
	local rig = CFrame.new(spot.origin + surfer.position * S) * qYaw
	local local_ = CFrame.new(eye * S) * CFrame.fromEulerAnglesYXZ(pitch, yaw, roll)
	local flip = surfer:flipAngle()
	if flip ~= 0 then
		local_ = CFrame.fromAxisAngle(Vector3.xAxis, flip) * local_
	end
	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = rig * local_
	-- (Studio testing: LineupCam = "x,y,z,yawDeg,pitchDeg" in metres is a free camera)
	local free = RunService:IsStudio() and workspace:GetAttribute("LineupCam")
	if free then
		local v = string.split(free, ",")
		camera.CFrame = CFrame.new(spot.origin + Vector3.new(tonumber(v[1]), tonumber(v[2]), tonumber(v[3])) * S)
			* CFrame.fromEulerAnglesYXZ(math.rad(tonumber(v[5]) or 0), math.rad(tonumber(v[4]) or 0), 0)
	end
	-- (the camera in the spot's frame, in metres, for the ocean and the underwater check)
	return (camera.CFrame.Position - spot.origin) / S
end

---------------------------------------------------------------- flow
local function setPlaying(on)
	input:setEnabled(on)
	hud:show(on or game_.mode == "paused")
end

local function startGame()
	menu:showMain(false)
	applySpot(settings.spot)
	applyTime()
	surfer:setBoard(settings.board)
	ensureBoard()
	model:update(0)
	respawn(false)
	game_.mode = "play"
	setPlaying(true)
	hud:show(true)
	audio:ambient(true)
	sendFeed({ k = "spot" })
	local d = input.device
	if d == "pad" then
		hud:toast("Pull LT and RT in turn to paddle · left stick steers · A to stand up · pull the stick back to sit", 7)
	elseif d == "touch" then
		hud:toast("Tap Paddle left and right in turn to paddle · the joystick steers · Stand up appears once you're moving", 7)
	else
		hud:toast("Scroll to paddle (faster = harder) · A / D steer · Space to pop up · S sit up and wait", 6)
	end
end

local function pause()
	if game_.mode ~= "play" then
		return
	end
	game_.mode = "paused"
	setPlaying(false)
	menu:showPause(true)
end

local function resume()
	if game_.mode ~= "paused" then
		return
	end
	menu:showPause(false)
	game_.mode = "play"
	setPlaying(true)
end

local function quitToMenu()
	menu:showPause(false)
	game_.mode = "menu"
	setPlaying(false)
	hud:show(false)
	audio:ambient(false)
	menu:showMain(true)
end

menu.onPlay = startGame
menu.onResume = resume
menu.onLineup = function()
	resume()
	respawn(true)
end
menu.onQuit = quitToMenu
menu.onChange = function(what)
	if what == "time" then
		applyTime()
	elseif what == "quality" then
		-- a new ocean at the other quality (the old one's meshes go first: memory budget)
		ocean:destroy()
		ocean = Ocean.new(model, { quality = settings.quality, parent = folder, water = spot.water, origin = spot.origin, spot = spot.id })
		ocean:setLight(World.light(settings.time))
	elseif what == "waves" then
		local w = settings.waves[settings.spot]
		net.SetWaves:FireServer(settings.spot, w.mode, w.height)
	end
end
menu:setControls(input.device)
input.onDevice = function(d)
	menu:setControls(d)
end

-- other players
net.Pose.OnClientEvent:Connect(function(userId, data)
	remote:push(userId, data)
end)
net.Leave.OnClientEvent:Connect(function(userId)
	remote:remove(userId)
end)
net.Feed.OnClientEvent:Connect(function(e)
	local name = e.name or "Someone"
	if e.k == "waves" then
		hud:feedLine(("%s set the waves at %s to %s"):format(name, Spots[e.spot] and Spots[e.spot].name or "?", if e.mode == "random" then "random sets" else ("%.1f m"):format(e.height)))
		return
	end
	if e.spot ~= settings.spot then
		return
	end
	local text = ({
		tube = name .. " got barrelled!",
		wipeout = name .. " wiped out",
		air = name .. " boosted an air",
		backflip = name .. " landed a backflip!",
		hang = name .. " hung " .. tostring(e.n or 5),
		spot = name .. " paddled out",
		ride = ("%s rode %.1f s · %d points"):format(name, e.time or 0, e.score or 0),
	})[e.k]
	if text then
		hud:feedLine(text)
	end
end)

---------------------------------------------------------------- main loop
local function frame(dt)
	dt = min(dt, 1 / 20)
	input:update(dt)
	local playing = game_.mode == "play"
	local inp = { paddle = 0, pulse = 0, turn = 0, steer = 0, leanX = 0, leanZ = 0, walk = 0, crouch = 0, duck = false, charge = false }
	if playing then
		local steer = input:steer()
		local leanZ = input:leanZ()
		local prone = surfer.state == STATE.PRONE
		inp = {
			paddle = input:paddle(),
			pulse = 0,
			turn = 0,
			steer = steer,
			leanX = steer,
			leanZ = leanZ,
			walk = leanZ,
			walkTo = nil,
			crouch = if input:down("crouch") then 1 else 0,
			duck = input:down("crouch") and prone,
			charge = input:down("charge"),
		}
		for _, e in ipairs(input:consumeEvents()) do
			if type(e) == "table" then
				if e.stroke then
					if surfer.state == STATE.SITTING then
						surfer:layDown()
					end
					if surfer.state == STATE.PRONE and not surfer.diving then
						arms:stroke(e.stroke, e.strength)
					end
				end
			elseif e == "toggleStand" then
				if surfer.state == STATE.PRONE then
					surfer:popUp()
				else
					surfer:layDown()
				end
			elseif e == "reset" then
				respawn(true)
			elseif e == "pause" then
				pause()
			elseif e == "back" and surfer.state == STATE.PRONE then
				surfer:sit()
			elseif e == "forward" and surfer.state == STATE.SITTING then
				surfer:layDown()
			elseif e == "touchSit" then
				if surfer.state == STATE.SITTING then
					surfer:layDown()
				else
					surfer:sit()
				end
			end
		end
		-- (Studio testing: workspace attributes LineupTestPaddle / LineupTestSteer / LineupTestLean
		-- drive the controls, and LineupTestEvent sends one event)
		if RunService:IsStudio() then
			local tp = workspace:GetAttribute("LineupTestPaddle")
			if tp then
				inp.paddle = max(inp.paddle, tp)
			end
			local ts = workspace:GetAttribute("LineupTestSteer")
			if ts then
				inp.steer, inp.leanX = ts, ts
			end
			local tl = workspace:GetAttribute("LineupTestLean")
			if tl then
				inp.leanZ, inp.walk = tl, tl
			end
			local te = workspace:GetAttribute("LineupTestEvent")
			if te then
				workspace:SetAttribute("LineupTestEvent", nil)
				if te == "toggleStand" then
					if surfer.state == STATE.PRONE then
						surfer:popUp()
					else
						surfer:layDown()
					end
				elseif te == "reset" then
					respawn(false)
				end
			end
		end
		-- the controller's stick: back to sit, forward to lie down
		local sitPad, layPad = input:padSit()
		if input.device == "pad" then
			if sitPad and surfer.state == STATE.PRONE and arms.effort < 0.1 then
				surfer:sit()
			elseif layPad and surfer.state == STATE.SITTING then
				surfer:layDown()
			end
		end
		if surfer.state == STATE.SITTING and input:paddle() > 0.15 then
			surfer:layDown()
		end
	else
		for _, e in ipairs(input:consumeEvents()) do
			if e == "pause" then
				if game_.mode == "paused" then
					resume()
				end
			end
		end
	end

	if game_.mode ~= "menu" then
		local running = game_.mode == "play"
		-- (the waves keep coming while paused: they're the server's)
		model:update(dt)
		if running then
			local paddling = surfer.state == STATE.PRONE
			local pulse = arms:update(dt, paddling, inp.paddle, surfer.diving)
			inp.pulse = pulse
			inp.turn = arms.turn
			inp.paddle = max(inp.paddle, if arms:manual() then arms.manualEffort else 0)
			local ts = os.clock()
			surfer:update(dt, inp)
			game_.simT = os.clock() - ts
			updateGame(dt)
		else
			arms:update(0, false, 0, false)
			surfer:updatePose(dt)
		end

		-- the teleport fade back to the lineup
		if game_.teleport > 0 then
			local before = game_.teleport
			game_.teleport = max(0, game_.teleport - dt)
			if before > 0.7 and game_.teleport <= 0.7 then
				respawn(false)
			end
			hud.fade.BackgroundTransparency = 1 - (1 - abs(game_.teleport - 0.7) / 0.7)
		else
			hud.fade.BackgroundTransparency = 1
		end

		-- body blends
		local standingish = surfer.state == STATE.STANDING or surfer.state == STATE.POPUP
		local rate = if surfer.state == STATE.POPUP then 1 / 0.42 else 1 / 0.35
		game_.standBlend += clamp((if standingish then 1 else 0) - game_.standBlend, -rate * dt, rate * dt)
		game_.sitBlend += clamp((if surfer.state == STATE.SITTING then 1 else 0) - game_.sitBlend, -2 * dt, 2 * dt)

		-- the board and your arms
		local boardCF = CFrame.new(spot.origin + surfer.position * S) * surfer.quat
		if placeBoard then
			placeBoard(boardCF)
		end
		arms:setVisible(surfer.state == STATE.PRONE and game_.standBlend < 0.05 and game_.sitBlend < 0.05)
		arms:pose(boardCF, surfer.board.proneEyeZ - EYE.prone.Z)

		local camSim = updateCamera(dt)
		local t0 = os.clock()
		ocean:update(camSim.X, camSim.Y, camSim.Z, dt)
		local t1 = os.clock()
		spray:update(dt, model, surfer, spot.origin, camSim)
		remote:update(dt)
		-- (frame timings for tuning: see the LineupClient folder's attributes)
		game_.prof = game_.prof or { ocean = 0, sim = 0, n = 0 }
		local P = game_.prof
		P.ocean += t1 - t0
		P.sim += game_.simT or 0
		P.n += 1
		if P.n >= 60 then
			folder:SetAttribute("OceanMs", math.floor(P.ocean / P.n * 1e4) / 10)
			folder:SetAttribute("SimMs", math.floor(P.sim / P.n * 1e4) / 10)
			P.ocean, P.sim, P.n = 0, 0, 0
		end
		if RunService:IsStudio() then
			-- (what the surfer's doing, for tests)
			local s = surfer.s
			folder:SetAttribute("Surfer", ("%s spd=%.1f catching=%s riding=%s tube=%s un=%.2f H=%.1f x=%.1f z=%.1f yaw=%.2f wipe=%s"):format(
				surfer.state, surfer:planeSpeed(), tostring(surfer.catching), tostring(surfer.riding), tostring(surfer.inTube),
				s.un or 99, s.H or 0, surfer.x, surfer.z, surfer.yaw, surfer.wipeReason))
		end

		-- under the water?
		local surface = model:heightAt(camSim.X, camSim.Z)
		World.underwater(surface - camSim.Y, spot.water)
		audio:update(dt, surfer, model, camSim)

		-- HUD
		local stName = ({
			prone = if surfer.diving then (if surfer.turtle > 0 then "Turtle roll" else "Duck diving") else "Paddling",
			popup = "Popping up",
			standing = if surfer.inTube then "In the barrel!" elseif surfer.air then "Air!" else "Surfing",
			sitting = "Sitting · waiting for a set",
			wipeout = "Wipeout",
		})[surfer.state]
		hud:setState(stName)
		hud:update(dt, {
			speed = surfer:planeSpeed(),
			effort = arms.effort,
			prone = surfer.state == STATE.PRONE,
			foot = if surfer.board.walk and surfer.state == STATE.STANDING then surfer.footPos else nil,
			wave = nextWaveInfo(),
			tube = surfer.inTube,
		})
		local mode = if surfer.state == STATE.STANDING or surfer.state == STATE.POPUP then "stand" else "paddle"
		local canStand = surfer.catching or surfer:planeSpeed() > 2.2 or (surfer.s.wave ~= nil and surfer.s.un > -0.5 and surfer.s.un < 1.5 and surfer.s.H > 0.5)
		hud:updateTouch(input.device == "touch" and game_.mode == "play", mode, surfer.state == STATE.SITTING, canStand)
		local hints = HINTS[input.device] or HINTS.pc
		hud:setHints(if surfer.state == STATE.SITTING then hints.sit elseif mode == "stand" then hints.stand else hints.paddle)

		-- tell the others where you are (10 a second; 15 riding)
		game_.poseT -= dt
		if game_.poseT <= 0 then
			game_.poseT = if surfer.state == STATE.STANDING then 1 / 15 else 1 / 10
			net.Pose:FireServer(Remote.pack(
				settings.spot,
				surfer.state,
				settings.board,
				surfer:poseCrouch(),
				surfer.position,
				surfer.quat,
				game_.look.yaw,
				surfer.vx,
				surfer.vz,
				model.time,
				settings.skin,
				settings.deck or Color3.fromRGB(245, 244, 238)
			))
		end
	else
		-- the menu: a slow view of the lineup behind it
		model:update(dt)
		local t = os.clock() * 0.05
		local camSim = Vector3.new(30 * sin(t), 6, 40)
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.lookAt(spot.origin + camSim * S, spot.origin + Vector3.new(0, 1.5, -10) * S)
		ocean:update(camSim.X, camSim.Y, camSim.Z, dt)
		World.underwater(-1, spot.water)
	end
end

camera.FieldOfView = 72
applySpot(settings.spot)
applyTime()
ensureBoard()
surfer:setBoard(settings.board)
respawn(false)
menu:showMain(true)
RunService:BindToRenderStep("Lineup", Enum.RenderPriority.Camera.Value + 1, frame)

-- (testing in Studio: set workspace attribute LineupAutoPlay to skip the menu, and
-- LineupSpot / LineupTime to choose where and when)
if RunService:IsStudio() and workspace:GetAttribute("LineupAutoPlay") then
	settings.spot = workspace:GetAttribute("LineupSpot") or settings.spot
	settings.time = workspace:GetAttribute("LineupTime") or settings.time
	startGame()
end
