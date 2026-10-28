-- Builds each surf spot's land as Roblox terrain, in Studio (edit time), from the same
-- height functions the game uses for the seabed (Land). Not part of the running game: the
-- terrain is saved in the place. Run from the command bar:
--   require(game.ServerStorage.LineupBuild.TerrainBuilder).build("margaret")
-- Progress is in ServerStorage.LineupBuild's "Progress" attribute.
--
-- The land's height is sampled on a coarse grid (it's mostly noise, slow to work out) and
-- interpolated for each voxel column; the top voxel's occupancy gives a smooth surface.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config = require(Lineup.Config)
local Land = require(Lineup.Land)
local Spots = require(Lineup.Spots)

local S = Config.SCALE
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

local function trees(o, spotLand, count, seed, places)
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
		local h, veg = Land[spotLand].land(x, z)
		if veg < 0.55 or h < 3 then
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

function Builder.build(id)
	id = id or "margaret"
	local spot = Spots[id]
	local o = spot.origin
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
