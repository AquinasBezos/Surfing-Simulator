-- Builds each surf spot's land as Roblox terrain, in Studio (edit time), from the same
-- height functions the game uses for the seabed (Land). Not part of the running game: the
-- terrain is saved in the place. Run from the command bar:
--   require(game.ServerStorage.LineupBuild.TerrainBuilder).build("margaret")
-- (and "teahupoo", "pool")
-- Progress is in ServerStorage.LineupBuild's "Progress" attribute.
--
-- The land's height is sampled on a coarse grid (it's mostly noise, slow to work out) and
-- interpolated for each voxel column; the top voxel's occupancy gives a smooth surface.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config, Land, Spots, S

-- (lib: the modules to build from; Studio's command bar caches what it has required, so
-- pass a fresh copy of the Lineup folder after changing them)
local function load(lib)
	lib = lib or Lineup
	Config = require(lib.Config)
	Land = require(lib.Land)
	Spots = require(lib.Spots)
	S = Config.SCALE
end
local VOX = 4 -- studs per voxel
local terrain = workspace.Terrain

local Builder = {}

local M = Enum.Material

local function progress(text)
	script.Parent:SetAttribute("Progress", text)
end

-- Height and material at (x, z) (metres, spot frame), from a coarse sampled grid.
local function makeSampler(landFn, x0, x1, z0, z1, step)
	local nx = math.ceil((x1 - x0) / step) + 1
	local nz = math.ceil((z1 - z0) / step) + 1
	local H = table.create(nx * nz, 0)
	local Vg = table.create(nx * nz, 0)
	local Sd = table.create(nx * nz, 0)
	local k = 0
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			k += 1
			local h, veg, s = landFn(x0 + i * step, z0 + j * step)
			H[k], Vg[k], Sd[k] = h, veg or 0, s or 0
		end
		if j % 20 == 0 then
			progress(("sampling %d%%"):format(math.floor(j / nz * 100)))
			task.wait()
		end
	end
	return function(x, z)
		local fx = math.clamp((x - x0) / step, 0, nx - 1.0001)
		local fz = math.clamp((z - z0) / step, 0, nz - 1.0001)
		local i, j = math.floor(fx), math.floor(fz)
		local u, v = fx - i, fz - j
		local a = j * nx + i + 1
		local b, c, d = a + 1, a + nx, a + nx + 1
		local function lerp(T)
			return (T[a] * (1 - u) + T[b] * u) * (1 - v) + (T[c] * (1 - u) + T[d] * u) * v
		end
		return lerp(H), lerp(Vg), lerp(Sd)
	end
end

-- Fill the terrain over [x0, x1] x [z0, z1] (metres) at the spot origin o (studs).
-- paint(x, z, h, slope, veg, s) -> Material
local function fill(o, sample, x0, x1, z0, z1, paint, minY)
	local cx0 = math.floor((o.X + x0 * S) / VOX)
	local cx1 = math.ceil((o.X + x1 * S) / VOX)
	local cz0 = math.floor((o.Z + z0 * S) / VOX)
	local cz1 = math.ceil((o.Z + z1 * S) / VOX)
	local CH = 48 -- voxel columns per chunk side
	local total = math.ceil((cx1 - cx0) / CH) * math.ceil((cz1 - cz0) / CH)
	local done = 0
	for bx = cx0, cx1 - 1, CH do
		for bz = cz0, cz1 - 1, CH do
			local nx = math.min(CH, cx1 - bx)
			local nz = math.min(CH, cz1 - bz)
			-- heights of the chunk's columns (studs) and their materials
			local hs, mats = {}, {}
			local lo, hi = math.huge, -math.huge
			for i = 1, nx do
				hs[i], mats[i] = {}, {}
				for k = 1, nz do
					local wx = ((bx + i - 1) * VOX + VOX / 2 - o.X) / S
					local wz = ((bz + k - 1) * VOX + VOX / 2 - o.Z) / S
					local h, veg, s = sample(wx, wz)
					local hx = sample(wx + 1.5, wz) - sample(wx - 1.5, wz)
					local hz = sample(wx, wz + 1.5) - sample(wx, wz - 1.5)
					local slope = math.sqrt(hx * hx + hz * hz) / 3
					local y = o.Y + h * S
					hs[i][k] = y
					mats[i][k] = paint(wx, wz, h, slope, veg, s)
					lo = math.min(lo, y)
					hi = math.max(hi, y)
				end
			end
			-- a shell a few voxels deep under the surface (deeper on slopes)
			local yb = math.floor((math.max(lo, o.Y + (minY or -30) * S) - 3 * VOX) / VOX)
			local yt = math.ceil((hi + VOX) / VOX)
			local ny = yt - yb
			if ny > 0 then
				local materials, occ = {}, {}
				for i = 1, nx do
					materials[i], occ[i] = {}, {}
					for y = 1, ny do
						materials[i][y], occ[i][y] = {}, {}
						local vy = (yb + y - 1) * VOX
						for k = 1, nz do
							local top = hs[i][k]
							local o_ = math.clamp((top - vy) / VOX, 0, 1)
							if o_ > 0 then
								materials[i][y][k] = mats[i][k]
								occ[i][y][k] = o_
							else
								materials[i][y][k] = M.Air
								occ[i][y][k] = 0
							end
						end
					end
				end
				local region = Region3.new(Vector3.new(bx * VOX, yb * VOX, bz * VOX), Vector3.new((bx + nx) * VOX, yt * VOX, (bz + nz) * VOX))
				terrain:WriteVoxels(region, VOX, materials, occ)
			end
			done += 1
			if done % 4 == 0 then
				progress(("terrain %d / %d"):format(done, total))
				task.wait()
			end
		end
	end
end

-- Margaret River: a sandy beach with dunes and wooded hills, a forested headland, and an
-- offshore island.
local function smooth(a, b, x)
	local t = math.clamp((x - a) / (b - a), 0, 1)
	return t * t * (3 - 2 * t)
end

local function paintMargaret(x, z, h, slope, veg, s)
	if h < -0.6 then
		-- the seabed: sand with patches of weed and rock
		local n = Land.vnoise(x * 0.0042 + 11, z * 0.0042)
		if n > 0.68 then
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

-- ok(h, veg, s): whether a tree grows there (default: vegetated ground above 3 m)
local function trees(o, spotLand, count, seed, places, ok)
	ok = ok or function(h, veg)
		return veg >= 0.55 and h >= 3
	end
	local folder = workspace:FindFirstChild("LineupLand") or Instance.new("Folder")
	folder.Name = "LineupLand"
	folder.Parent = workspace
	local holder = Instance.new("Folder")
	holder.Name = "Trees_" .. spotLand
	local rng = Random.new(seed)
	local placed, tries = 0, 0
	local A = Color3.fromRGB(28, 51, 25)
	local B = Color3.fromRGB(52, 80, 42)
	while placed < count and tries < count * 40 do
		tries += 1
		local x, z = places(rng)
		local h, veg, s = Land[spotLand].land(x, z)
		if not ok(h, veg, s) then
			continue
		end
		local r = 3.5 + rng:NextNumber() ^ 1.5 * 6
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(r * 2, r * 2, r * 2) * S
		p.Material = M.Grass
		p.Color = A:Lerp(B, rng:NextNumber() * rng:NextNumber()):Lerp(Color3.new(0, 0, 0), rng:NextNumber() * 0.25)
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = true
		p.CFrame = CFrame.new(o + Vector3.new(x, h + 0.25 * r, z) * S)
		p.Parent = holder
		placed += 1
		-- squash it a little: canopies are wider than tall
		if rng:NextNumber() < 0.6 then
			p.Shape = Enum.PartType.Block
			local mesh = Instance.new("SpecialMesh")
			mesh.MeshType = Enum.MeshType.Sphere
			mesh.Scale = Vector3.new(1, 0.7 + rng:NextNumber() * 0.4, 1)
			mesh.Parent = p
		end
	end
	local old = folder:FindFirstChild(holder.Name)
	if old then
		old:Destroy()
	end
	holder.Parent = folder
	return placed
end

local function landFolder(name)
	local folder = workspace:FindFirstChild("LineupLand") or Instance.new("Folder")
	folder.Name = "LineupLand"
	folder.Parent = workspace
	local old = folder:FindFirstChild(name)
	if old then
		old:Destroy()
	end
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = folder
	return f
end

local function block(parent, name, size, cf, color, material, shape)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size * S
	p.CFrame = cf
	p.Color = color
	p.Material = material or M.SmoothPlastic
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	if shape then
		p.Shape = shape
	end
	p.Parent = parent
	return p
end

-- A palm: a leaning, slightly curved trunk and a crown of drooping fronds.
local function palm(parent, at, rng)
	local m = Instance.new("Model")
	m.Name = "Palm"
	local h = 8 + rng:NextNumber() * 7
	local lean = (rng:NextNumber() * 0.35 + 0.08) * (if rng:NextNumber() < 0.5 then -1 else 1)
	local yaw = rng:NextNumber() * math.pi * 2
	local base = CFrame.new(at) * CFrame.Angles(0, yaw, 0)
	local segs = 4
	local cf = base
	local trunk = Color3.fromRGB(120, 100, 75)
	for i = 1, segs do
		cf = cf * CFrame.Angles(0, 0, lean / segs * (0.6 + i * 0.25))
		local len = h / segs
		-- (a cylinder runs along its X: turned to stand up)
		local d = 0.38 - i * 0.04
		block(m, "Trunk", Vector3.new(len + 0.1, d, d), cf * CFrame.new(0, len * S / 2, 0) * CFrame.Angles(0, 0, math.pi / 2), trunk, M.Wood, Enum.PartType.Cylinder)
		cf = cf * CFrame.new(0, len * S, 0)
	end
	local leaf = Color3.fromRGB(58, 96, 40):Lerp(Color3.fromRGB(90, 120, 50), rng:NextNumber())
	for k = 1, 8 do
		local a = k / 8 * math.pi * 2 + rng:NextNumber() * 0.3
		local frond = cf * CFrame.Angles(0, a, 0) * CFrame.Angles(-0.45 - rng:NextNumber() * 0.4, 0, 0)
		block(m, "Frond", Vector3.new(0.9, 0.08, 4.2), frond * CFrame.new(0, 0, -2.0 * S), leaf, M.Grass)
	end
	m.Parent = parent
end

function Builder.build(id, lib)
	load(lib)
	id = id or "margaret"
	local spot = Spots[id]
	local o = spot.origin
	if id == "teahupoo" then
		local L = Land.teahupoo
		local function paint(x, z, h, slope, _mtn, s)
			if h < -0.5 then
				local d = z - L.reefEdge(x)
				if d > -30 and d < 140 and Land.vnoise(x * 0.07, z * 0.07) > 0.35 then
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
		progress("sampling")
		local B = L.bounds
		local sample = makeSampler(L.land, B[1], B[2], B[3], B[4], 5)
		fill(o, sample, B[1], B[2], B[3], B[4], paint, -40)
		-- palms along the shore, houses among them, rainforest up the slopes
		progress("palms")
		local f = landFolder("teahupoo")
		local rng = Random.new(9001)
		local placed = 0
		for _ = 1, 4000 do
			if placed >= 260 then
				break
			end
			local x = -1400 + rng:NextNumber() * 3400
			local s = 4 + rng:NextNumber() ^ 1.4 * 110
			local z = L.shoreZ(x) + s
			local h = L.land(x, z)
			if h > 0.8 and h < 14 then
				palm(f, o + Vector3.new(x, h - 0.2, z) * S, rng)
				placed += 1
			end
		end
		for _ = 1, 26 do
			local x = -900 + rng:NextNumber() * 2200
			local z = L.shoreZ(x) + 25 + rng:NextNumber() * 60
			local h = L.land(x, z)
			if h > 1 and h < 10 then
				local w, d = 6 + rng:NextNumber() * 5, 5 + rng:NextNumber() * 4
				local cf = CFrame.new(o + Vector3.new(x, h + 1.4, z) * S) * CFrame.Angles(0, rng:NextNumber() * 0.6 - 0.3, 0)
				local walls = ({ Color3.fromRGB(235, 228, 210), Color3.fromRGB(210, 230, 225), Color3.fromRGB(240, 215, 190) })[rng:NextInteger(1, 3)]
				block(f, "House", Vector3.new(w, 2.8, d), cf, walls, M.Plaster)
				local roof = block(f, "Roof", Vector3.new(w + 1, 1.6, d + 1), cf * CFrame.new(0, 2.2 * S, 0), Color3.fromRGB(150, 70, 50), M.ClayRoofTiles)
				local wedge = Instance.new("SpecialMesh")
				wedge.MeshType = Enum.MeshType.Wedge
				wedge.Parent = roof
			end
		end
		local n = trees(o, "teahupoo", 900, 77, function(r)
			local x = -1500 + r:NextNumber() * 3600
			return x, L.shoreZ(x) + 60 + r:NextNumber() * 330
		end, function(h)
			return h > 8
		end)
		progress(("done: %d palms, %d trees"):format(placed, n))
		return
	elseif id == "pool" then
		local L = Land.pool
		local P = L.corners
		local function paint(x, z, h, _slope, _veg, ins)
			if ins >= 0 then
				return if h > -0.3 then M.Sand else M.Concrete
			end
			if ins > -10 then
				return M.Pavement
			end
			return M.Grass
		end
		progress("sampling")
		local sample = makeSampler(L.land, -420, 420, -320, 420, 3)
		fill(o, sample, -420, 420, -320, 420, paint, -6)
		local f = landFolder("pool")
		local concrete = Color3.fromRGB(196, 192, 184)
		-- the back walls: concrete, from the floor to the walkway
		for _, sx in ipairs({ -1, 1 }) do
			local a = Vector3.new(0, 0, P.bz)
			local b = Vector3.new(sx * P.sx, 0, P.sz)
			local mid = (a + b) / 2
			local len = (b - a).Magnitude
			local cf = CFrame.lookAt(o + Vector3.new(mid.X, L.deck - 2.6, mid.Z) * S, o + Vector3.new(b.X, L.deck - 2.6, b.Z) * S)
			block(f, "Wall", Vector3.new(1.2, 7.2, len + 2), cf, concrete, M.Concrete)
		end
		-- the pier: the machine's long silver housing at the back, then a walkway on a wall,
		-- the platform, and an arch near the shore to paddle under
		local PR, AR = L.pier, L.arch
		local function pierBlock(z0, z1, half, y0, y1, color, mat, name)
			block(f, name or "Pier", Vector3.new(half * 2, y1 - y0, z1 - z0), CFrame.new(o + Vector3.new(0, (y0 + y1) / 2, (z0 + z1) / 2) * S), color, mat)
		end
		pierBlock(P.bz - 6, PR.housingEnd, PR.housingHalf, -4.5, PR.housingTop, Color3.fromRGB(200, 205, 210), M.DiamondPlate, "Housing")
		pierBlock(P.bz - 6, PR.housingEnd, PR.housingHalf + 0.3, PR.housingTop, PR.housingTop + 0.4, Color3.fromRGB(70, 75, 80), M.Metal, "HousingRoof")
		local a0, a1 = AR.z - AR.half, AR.z + AR.half
		pierBlock(PR.housingEnd, a0, PR.half, -4.5, PR.deck, concrete, M.Concrete)
		pierBlock(a1, PR.finish, PR.half, -4.5, PR.deck, concrete, M.Concrete)
		pierBlock(PR.platform[1], PR.platform[2], PR.platformHalf, -4.5, PR.deck, concrete, M.Concrete, "Platform")
		-- the arch: a bridge over the gap, with ramps up to it
		pierBlock(a0, a1, PR.half, AR.height + 0.2, AR.height + 0.7, concrete, M.Concrete, "Arch")
		for _, sgn in ipairs({ -1, 1 }) do
			local zA = if sgn < 0 then a0 else a1
			local ramp = Instance.new("WedgePart")
			ramp.Size = Vector3.new(PR.half * 2, AR.height + 0.7 - PR.deck, 12) * S
			ramp.CFrame = CFrame.new(o + Vector3.new(0, (PR.deck + AR.height + 0.7) / 2, zA + sgn * 6) * S) * CFrame.Angles(0, if sgn < 0 then 0 else math.pi, 0)
			ramp.Color = concrete
			ramp.Material = M.Concrete
			ramp.Anchored = true
			ramp.CanCollide = false
			ramp.Parent = f
		end
		-- the walkway's planks and rails along the pier
		pierBlock(PR.housingEnd, PR.finish, PR.half + 0.15, PR.deck, PR.deck + 0.15, Color3.fromRGB(150, 120, 90), M.WoodPlanks, "Deck")
		for _, sx in ipairs({ -1, 1 }) do
			block(f, "Rail", Vector3.new(0.08, 0.08, PR.finish - PR.housingEnd), CFrame.new(o + Vector3.new(sx * PR.half, PR.deck + 1.05, (PR.housingEnd + PR.finish) / 2) * S), Color3.fromRGB(230, 230, 235), M.Metal)
		end
		-- the clubhouse on the shore, with a terrace
		local cb = CFrame.new(o + Vector3.new(16, L.deck + 4, 143) * S)
		block(f, "Clubhouse", Vector3.new(60, 8, 26), cb, Color3.fromRGB(235, 236, 232), M.Plaster)
		block(f, "Glass", Vector3.new(58, 5, 0.3), cb * CFrame.new(0, -0.5 * S, -13.1 * S), Color3.fromRGB(90, 130, 150), M.Glass).Transparency = 0.3
		block(f, "Roof", Vector3.new(64, 0.8, 30), cb * CFrame.new(0, 4.4 * S, 0), Color3.fromRGB(60, 62, 66), M.Metal)
		-- cabins and parasols along the beaches
		local rng = Random.new(31)
		for k = 1, 14 do
			local sx = if k % 2 == 0 then 1 else -1
			local t = 0.15 + rng:NextNumber() * 0.7
			local x = sx * (P.sx + (0 - P.sx) * t)
			local z = P.sz + (P.fz - P.sz) * t + 18
			local cf = CFrame.new(o + Vector3.new(x, L.deck + 1.3, z) * S)
			block(f, "Cabin", Vector3.new(3, 2.6, 3), cf, ({ Color3.fromRGB(80, 160, 200), Color3.fromRGB(240, 200, 70), Color3.fromRGB(230, 110, 90) })[k % 3 + 1], M.WoodPlanks)
		end
		local n = trees(o, "pool", 500, 5, function(r)
			local a = r:NextNumber() * math.pi * 2
			local d = 200 + r:NextNumber() ^ 0.7 * 900
			return math.cos(a) * d, math.sin(a) * d
		end, function(_h, _veg, ins)
			-- (hedgerow trees, well away from the pool)
			return ins < -25
		end)
		progress(("done: pool, %d trees"):format(n))
		return
	end
	if id == "margaret" then
		local L = Land.margaret
		-- the bay: seabed under the lineup, the beach, dunes and hills behind
		progress("sampling")
		local sample = makeSampler(L.land, -2400, 2400, -160, 1800, 6)
		fill(o, sample, -2400, 2400, -160, 1800, paintMargaret, -18)
		-- the headland (it reaches out to sea at z = -620)
		local head = makeSampler(L.land, 600, 1500, -900, -160, 6)
		fill(o, head, 600, 1500, -900, -160, paintMargaret, -6)
		-- the island offshore
		local I = L.island
		local isl = makeSampler(L.land, I[1] - 330, I[1] + 330, I[2] - 330, I[2] + 330, 8)
		fill(o, isl, I[1] - 330, I[1] + 330, I[2] - 330, I[2] + 330, paintMargaret, -2)
		progress("trees")
		local H = L.headland
		local n = trees(o, "margaret", 1100, 4242, function(rng)
			local pick = rng:NextNumber()
			if pick < 0.45 then
				local t = rng:NextNumber()
				return H[1][1] + (H[2][1] - H[1][1]) * t + (rng:NextNumber() * 2 - 1) * 170, H[1][2] + (H[2][2] - H[1][2]) * t + (rng:NextNumber() * 2 - 1) * 170
			elseif pick < 0.55 then
				return I[1] + (rng:NextNumber() * 2 - 1) * 220, I[2] + (rng:NextNumber() * 2 - 1) * 220
			end
			local x = (rng:NextNumber() * 2 - 1) * 2200
			return x, L.shoreZ(x) + 72 + rng:NextNumber() ^ 1.6 * 700
		end)
		progress(("done: %d trees"):format(n))
	end
end

return Builder
