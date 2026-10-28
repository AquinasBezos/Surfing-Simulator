--!native
-- The land and the seabed of each surf spot (port of js/terrain.js and js/landkit.js), in
-- the spot's own frame (metres; x along the beach, z toward the beach). seabedY is used by
-- the water shading (how deep it is), the physics (washed up) and the terrain builder.

local abs, max, min, sqrt, floor, sin = math.abs, math.max, math.min, math.sqrt, math.floor, math.sin

local Land = {}

local function smoothstep(a, b, x)
	local t = (x - a) / (b - a)
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return t * t * (3 - 2 * t)
end
local function mix(a, b, t)
	return a + (b - a) * t
end
local function smax(a, b, k)
	local h = max(k - abs(a - b), 0) / k
	return max(a, b) + h * h * k * 0.25
end
local function segDist(x, z, a, b)
	local px, pz = x - a[1], z - a[2]
	local bx, bz = b[1] - a[1], b[2] - a[2]
	local t = max(0, min(1, (px * bx + pz * bz) / (bx * bx + bz * bz)))
	local dx, dz = px - bx * t, pz - bz * t
	return sqrt(dx * dx + dz * dz)
end
local function hash2(x, z)
	local s = sin(x * 127.1 + z * 311.7) * 43758.5453
	return s - floor(s)
end
local function vnoise(x, z)
	local xi, zi = floor(x), floor(z)
	local fx, fz = x - xi, z - zi
	fx = fx * fx * (3 - 2 * fx)
	fz = fz * fz * (3 - 2 * fz)
	local a, b, c, d = hash2(xi, zi), hash2(xi + 1, zi), hash2(xi, zi + 1), hash2(xi + 1, zi + 1)
	return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
end
local function fbm(x, z, oct)
	local s, a, f = 0, 0.5, 1
	for _ = 1, oct or 5 do
		s += a * vnoise(x * f, z * f)
		f *= 2.03
		a *= 0.5
	end
	return s
end
local function ridged(x, z, oct)
	local s, a, f, w = 0, 0.5, 1, 1
	for i = 0, (oct or 4) - 1 do
		local r = 1 - abs(2 * vnoise(x * f + i * 17.3, z * f - i * 9.1) - 1)
		r *= r
		s += a * r * w
		w = min(1, r * 1.6)
		f *= 2.1
		a *= 0.5
	end
	return s
end
Land.smoothstep, Land.mix, Land.smax, Land.segDist, Land.vnoise, Land.fbm, Land.ridged, Land.hash2 =
	smoothstep, mix, smax, segDist, vnoise, fbm, ridged, hash2

---------------------------------------------------------------- Margaret River
local HEAD_A = { 840, 330 }
local HEAD_B = { 1260, -620 }
local ISLAND = { -1750, -2950 }

local function mShoreZ(x)
	return 252 + 14 * sin(0.0037 * x) + 6 * sin(0.011 * x + 1.3)
end
local function headlandH(x, z)
	return 102 * (1 - segDist(x, z, HEAD_A, HEAD_B) / 240) - 30
end
local function islandH(x, z)
	local dx, dz = x - ISLAND[1], z - ISLAND[2]
	return 75 * (1 - sqrt(dx * dx + dz * dz) / 290) - 16
end

local function margaretSeabed(x, z)
	local d = mix(-16, -4.4, smoothstep(-320, -30, z))
	d = mix(d, -3.0, smoothstep(-30, 110, z))
	d = smax(d, (z - mShoreZ(x)) * 0.035, 1.5)
	d = smax(d, headlandH(x, z), 4)
	d = max(d, islandH(x, z))
	return d
end

-- the land: height, and how much is vegetated (0..1), and how far inland (m)
local function margaretLand(x, z)
	local h = margaretSeabed(x, z)
	local s = z - mShoreZ(x)
	local veg = 0
	local inland = smoothstep(18, 60, s)
	if inland > 0 then
		local dunes = 3.2 * smoothstep(30, 80, s) + 1.6 * fbm(x * 0.02, z * 0.02, 3) * inland
		local hills = max(0, s - 110) * 0.05 + 70 * smoothstep(250, 1400, s) * fbm(x * 0.0018 + 3.1, z * 0.0018, 4)
		local canopy = 3.5 * fbm(x * 0.09, z * 0.09, 3) * smoothstep(70, 120, s)
		h += (dunes + hills + canopy) * inland
		veg = max(veg, smoothstep(62, 95, s + 25 * (fbm(x * 0.01, z * 0.01, 2) - 0.5)))
	end
	local hd = headlandH(x, z)
	if hd > 0 then
		local r = smoothstep(2, 20, hd)
		h += r * (14 * (fbm(x * 0.008, z * 0.008, 4) - 0.35) + 4 * fbm(x * 0.07, z * 0.07, 3))
		veg = max(veg, smoothstep(6, 16, hd + 8 * (fbm(x * 0.03, z * 0.03, 2) - 0.5)))
	end
	local il = islandH(x, z)
	if il > 0 then
		local r = smoothstep(2, 15, il)
		h += r * 9 * (fbm(x * 0.012, z * 0.012, 4) - 0.3)
		veg = max(veg, smoothstep(10, 22, il))
	end
	return h, veg, s
end

-- the colour of the bottom seen through the water: sand with weed patches
local SAND = Color3.new(0.62, 0.5, 0.33)
local function margaretBed(x, z)
	local n = vnoise(x * 0.021, z * 0.021)
	local patches = vnoise(x * 0.0042 + 11, z * 0.0042)
	local weed = smoothstep(0.56, 0.68, patches + 0.25 * n) * 0.75
	local b = 0.72 + 0.42 * n
	return SAND.R * b * (1 - weed) + 0.17 * weed, SAND.G * b * (1 - weed) + 0.16 * weed, SAND.B * b * (1 - weed) + 0.09 * weed
end

-- the land's colour (as js/terrain.js paints it): wet and dry sand, grass on the dunes,
-- forest, rock on the steep bits
local SAND_DRY, SAND_WET = Color3.fromHex("e3cfa4"), Color3.fromHex("ad9670")
local VEG_A, VEG_B = Color3.fromHex("1c3319"), Color3.fromHex("34502a")
local ROCK, GRASS = Color3.fromHex("6f675e"), Color3.fromHex("7f8a52")
local function margaretColor(x, z, h, slope, veg, s)
	local n = fbm(x * 0.05, z * 0.05, 3)
	local c = SAND_WET:Lerp(SAND_DRY, smoothstep(0.1, 0.9, h))
	c = c:Lerp(GRASS, smoothstep(3.5, 6, h) * smoothstep(40, 80, s) * 0.6)
	c = c:Lerp(VEG_A:Lerp(VEG_B, n), veg * (1 - smoothstep(0.75, 1.1, slope)))
	c = c:Lerp(ROCK, smoothstep(0.55, 0.95, slope) * smoothstep(0.5, 3, h))
	local k = 0.88 + 0.24 * n
	return Color3.new(math.min(c.R * k, 1), math.min(c.G * k, 1), math.min(c.B * k, 1))
end

Land.margaret = {
	seabedY = margaretSeabed,
	land = margaretLand,
	color = margaretColor,
	bed = margaretBed,
	shoreZ = mShoreZ,
	-- the area the terrain covers (m): x range, z range (see TerrainBuilder)
	bounds = { -2400, 2400, -900, 1800 },
	-- the distant land, as meshes (Landscape): { x0, x1, z0, z1, step }
	far = { { -2400, 2400, 230, 1800, 45 }, { 600, 1500, -900, 300, 36 }, { -2080, -1420, -3280, -2620, 45 } },
	island = ISLAND,
	headland = { HEAD_A, HEAD_B },
}

Land.active = Land.margaret
function Land.set(id)
	Land.active = Land[id] or Land.margaret
end
function Land.seabedY(x, z)
	return Land.active.seabedY(x, z)
end

return Land
