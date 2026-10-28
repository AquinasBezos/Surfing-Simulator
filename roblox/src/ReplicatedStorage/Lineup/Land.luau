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

-- the terrain material at a point (TerrainBuilder paints with it, and the 3D skybox takes
-- its colours from it, so the two match where they meet)
local M = Enum.Material
local function margaretMaterial(x, z, h, slope, veg, s)
	if h < -0.6 then
		-- the seabed, seen through the water: sand with patches of weed, darker going deeper
		if h < -10 then
			return M.Mud
		end
		if vnoise(x * 0.0042 + 11, z * 0.0042) > 0.68 or h < -6 then
			return M.Ground
		end
		return M.Sand
	end
	if slope > 0.85 and h > 1 then
		return M.Rock
	end
	if veg > 0.55 then
		return M.LeafyGrass
	end
	if h > 4.5 and s > 45 then
		return M.Grass
	end
	return M.Sand
end

Land.margaret = {
	seabedY = margaretSeabed,
	land = margaretLand,
	color = margaretColor,
	material = margaretMaterial,
	bed = margaretBed,
	shoreZ = mShoreZ,
	-- the area the terrain covers (m): x range, z range (TerrainBuilder); it reaches out to
	-- sea far enough to put a seabed under all the see-through water near the lineup
	bounds = { -1000, 1000, -500, 700 },
	-- the rest, in the 3D skybox (Landscape): x range, z range, and its finest step, where it
	-- meets the terrain (one mesh: at its scale it has to fit in 2048 studs, and 20,000
	-- triangles)
	sky = { -3600, 3600, -3300, 2400, 15 },
	lineup = { 0, -5 },
	island = ISLAND,
	headland = { HEAD_A, HEAD_B },
}

---------------------------------------------------------------- Teahupo'o
-- (port of js/teahupoo.js) The wave comes out of deep ocean onto a shallow coral reef, which
-- bends round so the wave wraps as it peels left toward a deep channel (the pass). Inside the
-- reef a turquoise lagoon runs to a palm-lined shore under steep green peaks; to the left,
-- across a bay, the rest of the island fades into the haze.
do
	local W = { breakWidth = 13, backWidth = 5, peelSpeed = 7.3, backSpeed = 9, curveMax = 40, curveK = 0.0024 }
	local SPEED = 5.2
	local ISLE = { 4700, 4400 }
	local function clamp(v, a, b)
		return math.clamp(v, a, b)
	end
	local function breakLine(x)
		local t = if x >= 0 then max(x - W.breakWidth, 0) / W.peelSpeed else max(-x - W.backWidth, 0) / W.backSpeed
		return SPEED * t - min(W.curveMax, W.curveK * x * x)
	end
	local function reefEdge(x)
		local e = breakLine(clamp(x, -60, 135)) - 2 + 3.2 * sin(0.071 * x + 1.3) + 2 * sin(0.153 * x + 0.4) + 1.1 * sin(0.31 * x + 2.2)
		if x < -60 then
			e += min(70, 0.3 * (-60 - x))
		end
		local nxt = 62 + min(80, 0.0011 * (x - 330) * (x - 330)) + 0.85 * max(0, x - 950)
		e = mix(e, nxt, smoothstep(190, 245, x))
		local pass = smoothstep(130, 175, x) * (1 - smoothstep(205, 250, x))
		return mix(e, 470, pass)
	end
	local function shoreZ(x)
		return 640 + 30 * sin(0.0031 * x + 0.7) + 14 * sin(0.0093 * x + 2.1) + 0.9 * max(0, x - 900)
	end
	local function isleIn(x, z)
		local dx, dz = x - ISLE[1], z - ISLE[2]
		local a = math.atan2(dz, dx)
		return 2400 + 220 * sin(3 * a + 1) + 120 * sin(7 * a + 2.3) - sqrt(dx * dx + dz * dz)
	end
	local function seabedY(x, z)
		local d = z - reefEdge(x)
		local floor_ = mix(-38, -14, smoothstep(-60, 460, z))
		local y
		if d >= 0 then
			y = -2.5 - 0.7 * smoothstep(15, 110, d) - 2.4 * smoothstep(130, 330, d)
		else
			local e = sqrt(d * d + 9) - 3
			y = smax(floor_, -2.5 - 36 * (1 - math.exp(-e / 36)), 3)
		end
		y = smax(y, (z - shoreZ(x)) * 0.05, 1.5)
		return max(y, isleIn(x, z) * 0.05)
	end
	-- Peaks: one per cell of a jittered grid (u along the coast, v inland), each a pyramid
	-- with straight flanks and a softened top; where two meet they make a V-shaped valley.
	local function peakField(cellU, cellV, offV, height, salt)
		local cache = {}
		local function peak(i, j)
			local key = i * 4096 + j
			local p = cache[key]
			if not p then
				local r1, r2, r3 = hash2(i * 1.7 + salt, j * 2.3 + 11.1), hash2(i * 3.1 + 5.2, j * 0.7 + salt), hash2(i + 9.4 + salt, j * 5.3)
				local pu, pv = (i + 0.2 + 0.6 * r1) * cellU, (j + 0.25 + 0.5 * r2) * cellV + offV
				local H = height(pu, pv, r3)
				p = { pu = pu, pv = pv, H = H, R = min(H * (1.05 + 0.3 * r2), 1.95 * min(cellU, cellV)) }
				cache[key] = p
			end
			return p
		end
		return function(u, v)
			local ci, cj = floor(u / cellU), floor((v - offV) / cellV)
			local best = 0
			for j = cj - 2, cj + 2 do
				for i = ci - 2, ci + 2 do
					local p = peak(i, j)
					if p.H > 0 then
						local du, dv = u - p.pu, v - p.pv
						local d = sqrt(du * du + dv * dv)
						if d < p.R then
							local r0 = 0.04 * p.R
							local t = (sqrt(d * d + r0 * r0) - r0) / (sqrt(p.R * p.R + r0 * r0) - r0)
							local h = p.H * max(0, 1 - t)
							if h > best then
								best = h
							end
						end
					end
				end
			end
			return best
		end
	end
	local islandPeaks = peakField(1050, 950, 380, function(_pu, pv, r)
		return if pv < 300 then 0 else min(1350, 400 + 0.24 * pv) * (0.72 + 0.48 * r)
	end, 0.3)
	local islePeaks = peakField(1300, 1300, 0, function(pu, pv, r)
		local inside = isleIn(pu, pv)
		return if inside < 200 then 0 else min(1900, 300 + 0.6 * inside) * (0.7 + 0.5 * r)
	end, 7.7)
	-- height, how mountainous, how far inland, how ridged
	local function land(x, z)
		local base = seabedY(x, z)
		local h = base
		local s = z - shoreZ(x)
		local mtn, rid = 0, 0.5
		if s > 0 then
			local flat = 1.2 + 3.2 * smoothstep(15, 160, s) + 1.6 * fbm(x * 0.02, z * 0.02, 3) * smoothstep(10, 60, s)
			local cone = islandPeaks(x, s)
			local wx = x + 200 * (fbm(x * 0.0015, z * 0.0015, 3) - 0.5)
			local wz = z + 200 * (fbm(x * 0.0015 + 7.1, z * 0.0015, 3) - 0.5)
			rid = ridged(wx * 0.0032, wz * 0.0032, 3)
			local m = smoothstep(40, 300, s)
			local mt = m * (cone * (0.88 + 0.34 * (rid - 0.35)) + 60 * smoothstep(150, 900, s))
			h += flat * smoothstep(0, 25, s) + mt
			mtn = smoothstep(20, 300, cone) * m
		end
		local isle = isleIn(x, z)
		if isle > -400 then
			local cone = islePeaks(x, z)
			if cone > 0 then
				local r2 = ridged(x * 0.0022, z * 0.0022 + 1.7, 3)
				local hi = base + 2 + smoothstep(-100, 300, isle) * (cone * (0.88 + 0.34 * (r2 - 0.35)) + 80)
				if hi > h then
					h, rid = hi, r2
					mtn = max(mtn, smoothstep(20, 300, cone))
				end
			end
		end
		return h, mtn, s, rid
	end
	local SAND_WET, SAND_DRY = Color3.fromHex("7f7564"), Color3.fromHex("b6a888")
	local GARDEN = Color3.fromHex("5d8a35")
	local FOREST_DARK, FOREST, FOREST_LIGHT = Color3.fromHex("142f10"), Color3.fromHex("2b5a1c"), Color3.fromHex("548a2c")
	local ROCK = Color3.fromHex("57564a")
	local function scale(c, k)
		return Color3.new(min(c.R * k, 1), min(c.G * k, 1), min(c.B * k, 1))
	end
	local function color(x, z, h, slope, mtn, _s, rid)
		rid = rid or 0.5
		local n = fbm(x * 0.011, z * 0.011, 3)
		local n2 = fbm(x * 0.06, z * 0.06, 2)
		local c = SAND_WET:Lerp(SAND_DRY, smoothstep(0.2, 1.4, h))
		c = c:Lerp(GARDEN, smoothstep(1.6, 3.2, h))
		local f = FOREST_DARK:Lerp(FOREST, smoothstep(0.25, 0.65, n * 0.6 + rid * 0.6)):Lerp(FOREST_LIGHT, smoothstep(0.55, 0.85, rid) * 0.6)
		f = scale(f, mix(0.62, 1.08, smoothstep(0.15, 0.7, rid)) * mix(1, 0.75, smoothstep(0.8, 2.2, slope)))
		c = c:Lerp(f, smoothstep(4, 14, h) * (0.55 + 0.45 * (mtn or 0)))
		c = c:Lerp(ROCK, smoothstep(1.6, 2.8, slope) * 0.5 * smoothstep(30, 80, h))
		return scale(c, 0.86 + 0.26 * n2)
	end
	-- the bottom: coral on the reef, sand across the lagoon, rubble down the wall
	local function bed(x, z)
		local d = z - reefEdge(x)
		local broad = vnoise(x * 0.0046 + 0.21, z * 0.0046)
		local mottle = vnoise(x * 0.071, z * 0.071 + 0.63)
		local grain = vnoise(x * 0.13 + 0.37, z * 0.13)
		local cr, cg, cb = 0.5 + 0.2 * mottle, 0.4 + 0.12 * mottle, 0.33 + 0.08 * grain
		local sR, sG, sB = 0.7 * (0.85 + 0.3 * grain), 0.64 * (0.85 + 0.3 * grain), 0.48 * (0.85 + 0.3 * grain)
		local reef = smoothstep(-34, -8, d) * (1 - max(smoothstep(60, 260, d) * smoothstep(0.42, 0.62, broad + 0.25 * grain), smoothstep(0.56, 0.68, mottle + 0.15 * grain) * 0.7))
		local k = smoothstep(-20, 30, d) * 0.6 + 0.4 * smoothstep(0.5, 0.7, broad)
		local r, g, b = mix(0.32, sR, k), mix(0.3, sG, k), mix(0.26, sB, k)
		return mix(r, cr, reef), mix(g, cg, reef), mix(b, cb, reef)
	end
	local M = Enum.Material
	local function material(x, z, h, slope)
		if h < -0.5 then
			if h < -14 then
				return M.Basalt -- the deep water off the reef
			end
			local d = z - reefEdge(x)
			if d > -30 and d < 140 and vnoise(x * 0.07, z * 0.07) > 0.35 then
				return M.Limestone -- coral heads on the reef
			end
			return M.Sand
		end
		if slope > 1.4 and h > 20 then
			return M.Rock
		end
		if h > 4 then
			return M.LeafyGrass
		end
		if h > 1.6 then
			return M.Grass
		end
		return M.Sand
	end
	Land.teahupoo = {
		seabedY = seabedY,
		land = land,
		color = color,
		material = material,
		bed = bed,
		shoreZ = shoreZ,
		reefEdge = reefEdge,
		bounds = { -1000, 1200, -500, 900 },
		sky = { -4000, 4000, -300, 4400, 15 },
		lineup = { 9, -13 },
	}
end

---------------------------------------------------------------- the wave pool
-- (port of js/wavepool.js) A kite-shaped lagoon in green English countryside, with the wave
-- machine's housing at the narrow back end and a pier down the middle to the clubhouse.
do
	local P0 = { bz = -110, sx = 95, sz = 25, fz = 125, pier = 4, fadeWall = 7, fadePier = 6 }
	local function edge(ax, az, bx, bz, cx, cz)
		local nx, nz = -(bz - az), bx - ax
		local l = sqrt(nx * nx + nz * nz)
		nx /= l
		nz /= l
		if nx * (cx - ax) + nz * (cz - az) < 0 then
			nx, nz = -nx, -nz
		end
		return { nx, nz, nx * ax + nz * az }
	end
	local mid = (P0.bz + P0.fz) / 2
	local BACK = edge(0, P0.bz, P0.sx, P0.sz, 0, mid)
	local FRONT = edge(P0.sx, P0.sz, 0, P0.fz, 0, mid)
	local DECK = 1.0
	local MIRROR, BREAKW, PEEL, SPEED = 66, 4, 5.6, 5.2
	local function inside(x, z)
		local ax = abs(x)
		return min(BACK[1] * ax + BACK[2] * z - BACK[3], FRONT[1] * ax + FRONT[2] * z - FRONT[3])
	end
	local function frontIn(ax, z)
		return FRONT[1] * ax + FRONT[2] * z - FRONT[3]
	end
	local function poolFloor(x, z)
		local ax = abs(x)
		local zb = SPEED * max(0, MIRROR - BREAKW - ax) / PEEL
		local y = mix(-3.2, -1.35, smoothstep(zb - 16, zb - 3, z))
		local f = frontIn(ax, z)
		y = mix(y, DECK - 0.15, 1 - smoothstep(0, 26, f))
		local trench = (1 - smoothstep(5, 14, ax)) * smoothstep(6, 16, f)
		return mix(y, -4.2, trench)
	end
	local function ground(x, z)
		local r = sqrt(x * x + (z - 10) ^ 2)
		local hills = smoothstep(260, 1100, r) * (32 * fbm(x * 0.0016 + 2.1, z * 0.0016, 3) + 80 * fbm(x * 0.0005 + 7.3, z * 0.0005 + 1.1, 3) - 40)
		return DECK - 0.05 + max(0, hills)
	end
	local function seabedY(x, z)
		return if inside(x, z) >= 0 then poolFloor(x, z) else ground(x, z)
	end
	-- the land: the walkway round the pool, then fields and hedges
	local function land(x, z)
		local ins = inside(x, z)
		if ins >= 0 then
			return poolFloor(x, z), 0, ins
		end
		return ground(x, z), 0, ins
	end
	local FIELDS = { "5f8f3a", "6f9a3f", "7aa547", "4f7f35", "8fa95a", "689444", "9aae62" }
	for i, h in ipairs(FIELDS) do
		FIELDS[i] = Color3.fromHex(h)
	end
	local HEDGE, PAVING, SAND = Color3.fromHex("2e4a22"), Color3.fromHex("b9b2a4"), Color3.fromHex("d8c79e")
	local function color(x, z, h, _slope, _veg, ins)
		if ins and ins > -10 then
			if ins >= 0 then
				return if frontIn(abs(x), z) < 26 then SAND else Color3.fromRGB(150, 175, 185)
			end
			return PAVING
		end
		local u, v = x * 0.94 + z * 0.34, -x * 0.34 + z * 0.94
		local wob = 6 * sin(v * 0.02 + 1.3) + 4 * sin(u * 0.031)
		local fu, fv = (u + wob) / 130, (v - wob) / 95
		local i, j = floor(fu), floor(fv)
		local e = min((fu - i) * 130, (1 - (fu - i)) * 130, (fv - j) * 95, (1 - (fv - j)) * 95)
		if e < 2.5 then
			return HEDGE
		end
		local c = FIELDS[floor(hash2(i * 1.3 + 0.7, j * 2.1 + 0.4) * #FIELDS) + 1]
		local n = 0.9 + 0.2 * vnoise(x * 0.05, z * 0.05)
		return Color3.new(min(c.R * n, 1), min(c.G * n, 1), min(c.B * n, 1))
	end
	-- pale painted concrete in panels, darker in the trench, sandy beaches
	local function bed(x, z)
		local y = seabedY(x, z)
		local sandy = smoothstep(-0.9, -0.3, y)
		local r, g, b = mix(0.42, 0.56, smoothstep(-2.6, -1.5, y)), mix(0.53, 0.6, smoothstep(-2.6, -1.5, y)), 0.6
		local t = smoothstep(3.4, 4.0, -y)
		r, g, b = mix(r, 0.33, t), mix(g, 0.44, t), mix(b, 0.53, t)
		return mix(r, 0.74, sandy), mix(g, 0.65, sandy), mix(b, 0.5, sandy)
	end
	-- the pier: half-width at z (0 where there's none), and the arch under it near the shore
	local PIER = { half = 2.4, deck = 2.0, housingHalf = 5, housingEnd = -38, housingTop = 7.6, platform = { 12, 40 }, platformHalf = 4.6, finish = P0.fz + 12 }
	local ARCH = { z = 82, half = 11, height = 3.1 }
	local function pierHalf(z)
		if z < P0.bz - 6 or z > PIER.finish then
			return 0
		end
		if z < PIER.housingEnd then
			return PIER.housingHalf
		end
		if z > PIER.platform[1] and z < PIER.platform[2] then
			return PIER.platformHalf
		end
		return PIER.half
	end
	-- Keep a surfer in the water: off the walls, the beaches and the pier (except through
	-- the arch). Returns how hard they hit something (m/s).
	local function collide(s)
		local hit = 0
		local sx = if s.x < 0 then -1 else 1
		for _, em in ipairs({ { BACK, 1.0 }, { FRONT, 4.0 } }) do
			local e, margin = em[1], em[2]
			local nx, nz = e[1] * sx, e[2]
			local d = e[1] * abs(s.x) + e[2] * s.z - e[3]
			if d < margin then
				s.x += nx * (margin - d)
				s.z += nz * (margin - d)
				local vn = s.vx * nx + s.vz * nz
				if vn < 0 then
					s.vx -= vn * nx
					s.vz -= vn * nz
					hit = max(hit, -vn)
				end
			end
		end
		local half = pierHalf(s.z)
		local through = abs(s.z - ARCH.z) < ARCH.half - 2.5
		if half > 0 and not through and abs(s.x) < half + 0.6 then
			local side = if s.x < 0 then -1 else 1
			s.x = side * (half + 0.6)
			if s.vx * side < 0 then
				hit = max(hit, -s.vx * side)
				s.vx = 0
			end
		end
		return hit
	end
	-- The terrain round the pool: none in the pool or under the walkway's edge (the pool's floor
	-- is a mesh, PoolFloor, and its edges straight slabs: voxels can't follow a diagonal wall),
	-- sunk a little under the rest of the walkway, then the fields.
	local function terrainHeight(x, z)
		local ins = inside(x, z)
		if ins > -2 then
			return -12, 0, ins
		elseif ins > -12 then
			return 0.6, 0, ins
		end
		return ground(x, z), 0, ins
	end
	local M = Enum.Material
	local function material(_x, _z, _h, _slope, _veg, ins)
		if ins and ins > -12 then
			return M.Pavement
		end
		return M.Grass
	end
	Land.pool = {
		seabedY = seabedY,
		land = land,
		terrainHeight = terrainHeight,
		color = color,
		material = material,
		poolFloor = poolFloor,
		edges = { back = BACK, front = FRONT },
		bed = bed,
		inside = inside,
		ground = ground,
		collide = collide,
		pier = PIER,
		arch = ARCH,
		corners = P0,
		deck = DECK,
		bounds = { -420, 420, -320, 420 },
		sky = { -2600, 2600, -2600, 2600, 25 },
		lineup = { 59, -10 },
	}
end

-- Where each spot's real terrain draws the land: within `near` = { x, z, radius } of the
-- lineup (Roblox always draws that far, on any graphics setting); the land further off is
-- in the 3D skybox (Landscape), the seabed is terrain everywhere it's built.
Land.margaret.near = { 0, -5, 330 }
Land.teahupoo.near = { 9, -13, 300 }
Land.pool.near = { 0, 20, 260 }

-- Every spot's trees, the same on every client and in the builder: { x, z, h, r, shade }.
-- (The builder makes the near ones as parts; the 3D skybox draws the rest.)
local treeCache = {}
function Land.trees(id)
	if treeCache[id] then
		return treeCache[id]
	end
	local L = Land[id]
	local list = {}
	local function grow(count, seed, places, ok)
		local rng = Random.new(seed)
		local placed, tries = 0, 0
		while placed < count and tries < count * 40 do
			tries += 1
			local x, z = places(rng)
			local h, veg, s = L.land(x, z)
			if ok(h, veg, s) then
				table.insert(list, { x = x, z = z, h = h, r = 3.5 + rng:NextNumber() ^ 1.5 * 6, shade = rng:NextNumber() })
				placed += 1
			end
		end
	end
	if id == "margaret" then
		local H, I = L.headland, L.island
		grow(1400, 4242, function(rng)
			local pick = rng:NextNumber()
			if pick < 0.35 then
				local t = rng:NextNumber()
				return H[1][1] + (H[2][1] - H[1][1]) * t + (rng:NextNumber() * 2 - 1) * 170, H[1][2] + (H[2][2] - H[1][2]) * t + (rng:NextNumber() * 2 - 1) * 170
			elseif pick < 0.45 then
				return I[1] + (rng:NextNumber() * 2 - 1) * 220, I[2] + (rng:NextNumber() * 2 - 1) * 220
			end
			local x = (rng:NextNumber() * 2 - 1) * 3000
			return x, L.shoreZ(x) + 72 + rng:NextNumber() ^ 1.4 * 1100
		end, function(h, veg)
			return veg >= 0.55 and h >= 3
		end)
	elseif id == "teahupoo" then
		-- rainforest up the slopes behind the shore
		grow(1200, 77, function(rng)
			local x = -2600 + rng:NextNumber() * 5600
			return x, L.shoreZ(x) + 60 + rng:NextNumber() * 500
		end, function(h)
			return h > 8
		end)
	elseif id == "pool" then
		-- hedgerow trees round the fields, well away from the pool
		grow(700, 5, function(rng)
			return -1400 + rng:NextNumber() * 2800, -1400 + rng:NextNumber() * 2800
		end, function(_h, _veg, ins)
			return ins < -25
		end)
	end
	treeCache[id] = list
	return list
end

Land.active = Land.margaret
function Land.set(id)
	Land.active = Land[id] or Land.margaret
end
function Land.seabedY(x, z)
	return Land.active.seabedY(x, z)
end

return Land
