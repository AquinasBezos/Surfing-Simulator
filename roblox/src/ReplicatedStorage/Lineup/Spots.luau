-- Surf spots (port of js/spots.js). Each one has its own wave (how and where it breaks,
-- the shape of the barrel), wave sizes, water colour and land. The game runs one spot at a
-- time: WaveModel.applySpotWave() copies a spot's wave into Config.WAVE / WAVE_HEIGHTS.
--
-- origin: where the spot's simulation frame sits in the Roblox world (studs). Every spot
-- lives in the same place, far apart, so players at different spots never meet.
--
-- water: surface / transparency = the Glass water's tint and how see-through it is, open =
-- the flat open sea beyond the waves, underwater = the water round you when you go under;
-- deep = the body of the water looking into it,
-- shallow = over a pale bottom, glow = light through thin water (crest, lip), bed = the
-- seabed colour seen through it.

local Spots = {}

Spots.margaret = {
	id = "margaret",
	name = "Margaret River",
	place = "Western Australia",
	blurb = "Peaky rights and lefts over sand and rock",
	origin = Vector3.new(0, 0, 0),
	wave = {
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
		peakSpread = 5,
		shoalFrom = -115,
		shoalBase = 0.5,
		steepFrom = -100,
		curl = { rin = 0.4, yc = 0.4, ex = 1.12, sweep = 3.92699, lf = { 1.25, 0.55 }, lb = { 2.2, 1.6 }, trough = 0, lip = 0.42 },
	},
	heights = { min = 0.6, max = 3.4, randomMin = 0.8, randomMax = 3.0, default = 2.5, small = 1.5, minScale = 2.2 },
	lineup = { z = -5, side = 4 },
	sunset = { 0.71, -0.71 },
	inside = { z = 45, x = 650 },
	water = {
		surface = Color3.fromRGB(46, 150, 138),
		transparency = 0.32,
		open = Color3.fromRGB(22, 86, 98),
		deep = Color3.fromRGB(16, 92, 88),
		shallow = Color3.fromRGB(48, 160, 142),
		glow = Color3.fromRGB(110, 220, 180),
		far = Color3.fromRGB(28, 88, 110),
		underwater = Color3.fromRGB(20, 110, 105),
	},
}

Spots.teahupoo = {
	id = "teahupoo",
	name = "Teahupo'o",
	place = "Tahiti",
	blurb = "A heavy left that wraps round a shallow reef",
	origin = Vector3.new(30000, 0, 0),
	wave = {
		peelSpeed = 7.3,
		backSpeed = 9,
		breakWidth = 13,
		backWidth = 5,
		tThrow = 1.05,
		tTube = 4.6,
		tCollapse = 1.4,
		curveK = 0.0024,
		curveMax = 40,
		peelFlat = 112,
		peelFall = 34,
		backFall = 26,
		dir = 1,
		peakSpread = 1.5,
		shoalFrom = -70,
		shoalBase = 0.42,
		steepFrom = -48,
		curl = { rin = 0.48, yc = 0.42, ex = 1.32, sweep = 3.98, lf = { 1.12, 0.5 }, lb = { 2.4, 1.8 }, trough = 0.1, lip = 0.62 },
	},
	heights = { min = 1.0, max = 6.0, randomMin = 1.8, randomMax = 5.4, default = 3.5, small = 1.5, minScale = 2.2 },
	lineup = { z = -13, side = 9 },
	sunset = { 0.71, -0.71 },
	inside = { z = 95, x = 650 },
	water = {
		surface = Color3.fromRGB(26, 104, 160),
		transparency = 0.3,
		open = Color3.fromRGB(10, 46, 98),
		deep = Color3.fromRGB(8, 52, 108),
		shallow = Color3.fromRGB(28, 128, 165),
		glow = Color3.fromRGB(80, 200, 225),
		far = Color3.fromRGB(14, 60, 120),
		underwater = Color3.fromRGB(12, 80, 140),
	},
}

-- The wave pool: a kite-shaped lagoon with the wave machine's housing at its narrow back
-- end and a pier down the middle to the clubhouse.
Spots.pool = {
	id = "pool",
	name = "Wave Pool",
	place = "Inland, England",
	blurb = "Machine-made lefts and rights either side of a pier",
	origin = Vector3.new(-30000, 0, 0),
	wave = {
		peelSpeed = 5.6,
		backSpeed = 6,
		breakWidth = 4,
		backWidth = 0,
		tThrow = 1.2,
		tTube = 3.0,
		tCollapse = 1.4,
		curveK = 0,
		curveMax = 0,
		peelFlat = 200,
		peelFall = 50,
		backFall = 6,
		dir = 0,
		mirror = 66,
		spill = { 0.6, 1.1 },
		peakSpread = 1.5,
		spawnZ = -105,
		breakZ = 0,
		dieStartZ = 80,
		dieEndZ = 108,
		spacing = 62,
		shoalFrom = -60,
		shoalBase = 0.55,
		steepFrom = -40,
		pool = { bz = -110, sx = 95, sz = 25, fz = 125, pier = 4, fadeWall = 7, fadePier = 6 },
		current = { speed = 0.9, half = 13 },
		curl = { rin = 0.5, yc = 0.46, ex = 1.15, sweep = 3.95, lf = { 1.1, 0.48 }, lb = { 1.9, 1.35 }, trough = 0.04, lip = 0.4 },
	},
	heights = { min = 0.8, max = 2.0, randomMin = 0.9, randomMax = 1.8, default = 1.4, small = 1.0, minScale = 1.8 },
	lineup = { z = -10, side = 7 },
	sunset = { 0.71, -0.71 },
	inside = { z = 1e9, x = 1e9 },
	-- (the waves are drawn within this many metres of the camera: the whole pool from anywhere
	-- in it, and no further)
	patch = 260,
	water = {
		surface = Color3.fromRGB(56, 160, 182),
		transparency = 0.35,
		-- beyond the waves: not open sea but the fields round about, flat to the horizon, just
		-- under the terrain's own
		open = Color3.fromRGB(104, 146, 68),
		openMaterial = Enum.Material.Grass,
		openHeight = 0.9,
		deep = Color3.fromRGB(14, 80, 108),
		shallow = Color3.fromRGB(40, 136, 158),
		glow = Color3.fromRGB(100, 210, 220),
		far = Color3.fromRGB(30, 110, 140),
		underwater = Color3.fromRGB(25, 120, 150),
	},
}

Spots.ORDER = { "margaret", "teahupoo", "pool" }
Spots.DEFAULT = "margaret"

return Spots
