--!native
-- Global tunables for the simulator (port of js/config.js). Units are metres, seconds,
-- radians. The simulation runs in metres; the world is drawn SCALE studs to the metre.

local AssetService = game:GetService("AssetService")

local Config = {}

-- A new editable mesh, or nil: none when the client's budget for them is spent, and none at
-- all in a published experience that doesn't allow them (Game Settings > Security > Allow
-- Mesh / Image APIs), Studio included once the place is published. There the mesh is made
-- but any edit of it throws, so one is tried; Config.meshBlocked says which it was.
function Config.editableMesh()
	local ok, em = pcall(AssetService.CreateEditableMesh, AssetService)
	if ok and em then
		local usable = pcall(function()
			em:RemoveVertex(em:AddVertex(Vector3.zero))
		end)
		if usable then
			return em
		end
		pcall(em.Destroy, em)
	end
	if not ok or em then
		Config.meshBlocked = true
	end
	return nil
end

-- studs per metre for everything drawn (physics stays in metres). One: the hills behind the
-- beach are a kilometre or two away, and Roblox only draws so many studs out.
Config.SCALE = 1

-- Breaking wave behaviour. The wave travels toward the beach (+z). The timing below is the
-- same everywhere; how the wave breaks belongs to the surf spot (Spots) and is copied in
-- here for the spot being played (WaveModel.applySpotWave).
Config.WAVE = {
	slots = 4, -- waves alive at once
	speed = 5.2, -- crest celerity
	spawnZ = -115, -- crest z when a wave appears
	breakZ = 0, -- crest z at which the peak starts to pitch
	dieStartZ = 82, -- the wave turns to whitewater and fades out here...
	dieEndZ = 118, -- ...and is gone here
	spacing = 118, -- distance between consecutive crests in a set
	peelSpeed = 6.6,
	backSpeed = 2.4,
	breakWidth = 0,
	backWidth = 0,
	tThrow = 1.5,
	tTube = 3.6,
	tCollapse = 1.7,
	curveK = 0.00028,
	curveMax = 24,
	peelFlat = 40,
	peelFall = 260,
	backFall = 45,
	dir = 0,
	mirror = 0,
	spill = { 1.0, 1.8 },
	peakSpread = 5,
	shoalFrom = -115,
	shoalBase = 0.5,
	steepFrom = -100,
	pool = nil,
	current = nil,
}

Config.WAVE_HEIGHTS = { min = 0.6, max = 3.4, randomMin = 0.8, randomMax = 3.0, default = 2.5, small = 1.5, minScale = 2.2 }

-- Gerstner swell components: {direction (deg, 0 = toward the beach), wavelength, amplitude, steepness}
Config.SWELL = {
	{ 0, 66, 0.2, 0.42 },
	{ 11, 43, 0.11, 0.42 },
	{ -17, 29, 0.065, 0.4 },
	{ 34, 17.5, 0.035, 0.36 },
	{ -41, 11.2, 0.022, 0.32 },
	{ 68, 7.4, 0.011, 0.3 },
	{ -63, 5.2, 0.0075, 0.26 },
	{ 108, 3.7, 0.0045, 0.22 },
}

Config.GRAVITY = 9.81

-- Times of day. sunDir is where the sun is in the simulation's frame (x along the beach, z
-- toward the beach): over the sea so the waves are backlit when you look out the back.
local function unit(x, y, z)
	local l = math.sqrt(x * x + y * y + z * z)
	return Vector3.new(x / l, y / l, z / l)
end
local function sunsetSun(tx, tz)
	local h = math.sqrt(tx * tx + tz * tz)
	local el = math.rad(4.3)
	return unit(tx / h * math.cos(el), math.sin(el), tz / h * math.cos(el))
end
Config.sunsetSun = sunsetSun

Config.TIMES_OF_DAY = {
	day = {
		sunDir = unit(-0.36, 0.6, -0.71),
		sunColor = Color3.new(1.0, 0.95, 0.86),
		ambient = Color3.fromRGB(122, 145, 168),
		outdoor = Color3.fromRGB(169, 200, 232),
		brightness = 3.2,
		fog = Color3.fromRGB(180, 203, 224),
		haze = 1.4,
		glare = 0.4,
		atmoColor = Color3.fromRGB(199, 220, 240),
		atmoDecay = Color3.fromRGB(106, 140, 175),
		skyAmb = Vector3.new(0.32, 0.48, 0.62),
		sunset = 0,
	},
	sunset = {
		sunDir = sunsetSun(0.71, -0.71),
		sunColor = Color3.new(1.0, 0.5, 0.24),
		ambient = Color3.fromRGB(95, 72, 96),
		outdoor = Color3.fromRGB(139, 111, 156),
		brightness = 2.2,
		fog = Color3.fromRGB(154, 108, 98),
		haze = 2.2,
		glare = 2.5,
		atmoColor = Color3.fromRGB(255, 170, 120),
		atmoDecay = Color3.fromRGB(120, 70, 110),
		skyAmb = Vector3.new(0.16, 0.13, 0.21),
		sunset = 1,
	},
}

Config.BOARD = { length = 1.86, width = 0.5 }

-- Board types. Distances along the board are measured from its centre, + toward the nose.
Config.BOARDS = {
	shortboard = {
		label = "Shortboard",
		length = 1.86,
		paddleTop = 2.5,
		paddleTau = 2.6,
		catchBoost = 1.0,
		turn = 1.0,
		planeLo = 1.8,
		planeHi = 4.0,
		proneEyeZ = 0.3,
		walk = false,
	},
	longboard = {
		label = "Longboard",
		length = 2.8,
		paddleTop = 3.0,
		paddleTau = 2.8,
		catchBoost = 1.35,
		turn = 0.6,
		planeLo = 1.2,
		planeHi = 3.2,
		proneEyeZ = 0.55,
		walk = true,
		footMin = -1.0,
		footMax = 1.18,
	},
}

-- First-person eye positions in the board frame (x right, y up, z toward the tail).
Config.EYE = {
	prone = Vector3.new(0, 0.34, 0.3),
	standing = Vector3.new(0, 1.32, 0.32),
	sitting = Vector3.new(0, 0.88, 0.2),
}

Config.CROUCH_DROP = 0.55

return Config
