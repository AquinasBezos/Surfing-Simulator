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
							-- (Roblox puts the surface half a voxel above where occupancy counted
							-- from the voxel's bottom says: measured, 2 studs. So count from its middle.)
							local top = hs[i][k]
							local o_ = math.clamp((top - VOX / 2 - vy) / VOX, 0, 1)
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

-- The spot's trees near the lineup, as parts (Land.trees; the 3D skybox draws the rest).
local function trees(o, spotLand)
	local folder = workspace:FindFirstChild("LineupLand") or Instance.new("Folder")
	folder.Name = "LineupLand"
	folder.Parent = workspace
	local holder = Instance.new("Folder")
	holder.Name = "Trees_" .. spotLand
	local A = Color3.fromRGB(28, 51, 25)
	local B = Color3.fromRGB(52, 80, 42)
	local N = Land[spotLand].near
	local placed = 0
	for _, t in ipairs(Land.trees(spotLand)) do
		if math.sqrt((t.x - N[1]) ^ 2 + (t.z - N[2]) ^ 2) > N[3] then
			continue
		end
		local r = t.r
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Block
		p.Size = Vector3.new(r * 2, r * 1.7, r * 2) * S
		p.Material = M.Grass
		p.Color = A:Lerp(B, t.shade * t.shade):Lerp(Color3.new(0, 0, 0), t.shade * 0.2)
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = true
		p.CFrame = CFrame.new(o + Vector3.new(t.x, t.h + 0.25 * r, t.z) * S)
		-- (a squashed sphere: canopies are wider than tall)
		local mesh = Instance.new("SpecialMesh")
		mesh.MeshType = Enum.MeshType.Sphere
		mesh.Parent = p
		p.Parent = holder
		placed += 1
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

function Builder.build(id, lib)
	load(lib)
	id = id or "margaret"
	local spot = Spots[id]
	local o = spot.origin
	if id == "teahupoo" then
		-- the reef and the lagoon, the beach and the foot of the hills (the peaks are in the 3D
		-- skybox); rainforest up the slopes
		local L = Land.teahupoo
		progress("sampling")
		local B = L.bounds
		local sample = makeSampler(L.land, B[1], B[2], B[3], B[4], 5)
		fill(o, sample, B[1], B[2], B[3], B[4], L.material, -40)
		landFolder("teahupoo")
		local n = trees(o, "teahupoo")
		progress(("done: %d trees"):format(n))
		return
	elseif id == "pool" then
		-- The ground round the pool (none in the pool: its floor is a mesh, PoolFloor, made in
		-- the game; voxels can't follow its diagonal walls), straight concrete slabs along its
		-- edges for the walkway, the walls, the pier, the clubhouse.
		local L = Land.pool
		local P = L.corners
		progress("sampling")
		local sample = makeSampler(L.terrainHeight, -420, 420, -320, 420, 3)
		fill(o, sample, -420, 420, -320, 420, L.material, -14)
		local f = landFolder("pool")
		local concrete = Color3.fromRGB(196, 192, 184)
		-- the walkway: a slab along each edge, its inner side exactly on the edge
		local RING = 12
		for _, sx in ipairs({ -1, 1 }) do
			for _, e in ipairs({ { 0, P.bz, sx * P.sx, P.sz }, { sx * P.sx, P.sz, 0, P.fz } }) do
				local a = Vector3.new(e[1], 0, e[2])
				local b = Vector3.new(e[3], 0, e[4])
				local along = (b - a).Unit
				-- outward: away from the middle of the pool
				local out = Vector3.new(-along.Z, 0, along.X)
				local midPool = Vector3.new(0, 0, (P.bz + P.fz) / 2)
				if out:Dot(midPool - a) > 0 then
					out = -out
				end
				local len = (b - a).Magnitude + RING * 2
				local c = (a + b) / 2 + out * RING / 2
				local y0, y1 = L.deck - 2.5, L.deck + 0.05
				local cf = CFrame.lookAt(o + Vector3.new(c.X, (y0 + y1) / 2, c.Z) * S, o + Vector3.new(c.X + along.X, (y0 + y1) / 2, c.Z + along.Z) * S)
				block(f, "Walkway", Vector3.new(RING, y1 - y0, len), cf, Color3.fromRGB(205, 200, 190), M.Pavement)
			end
		end
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
		-- The arch: an opening exactly AR.z +- AR.half long, open from the floor to the underside
		-- of the bridge at AR.height (what Land.pool's collide lets you paddle through). The
		-- walkway climbs to the bridge on ramps and comes down the other side.
		local a0, a1 = AR.z - AR.half, AR.z + AR.half
		local RAMP = 12
		local bridge0, bridge1 = AR.height, AR.height + 0.5 -- the bridge slab
		pierBlock(PR.housingEnd, a0, PR.half, -4.5, PR.deck, concrete, M.Concrete)
		pierBlock(a1, PR.finish, PR.half, -4.5, PR.deck, concrete, M.Concrete)
		pierBlock(PR.platform[1], PR.platform[2], PR.platformHalf, -4.5, PR.deck, concrete, M.Concrete, "Platform")
		pierBlock(a0, a1, PR.half, bridge0, bridge1, concrete, M.Concrete, "Arch")
		local plank = Color3.fromRGB(150, 120, 90)
		local rail = Color3.fromRGB(230, 230, 235)
		-- a straight run of walkway from (z0, y0) to (z1, y1): planks on top, a rail each side
		local function walk(z0, y0, z1, y1, name)
			local a = o + Vector3.new(0, y0, z0) * S
			local b = o + Vector3.new(0, y1, z1) * S
			local len = (b - a).Magnitude
			local cf = CFrame.lookAt((a + b) / 2, b)
			block(f, name, Vector3.new(PR.half * 2 + 0.3, 0.15, len / S + 0.05), cf * CFrame.new(0, 0.075 * S, 0), plank, M.WoodPlanks)
			for _, sx in ipairs({ -1, 1 }) do
				block(f, "Rail", Vector3.new(0.08, 0.08, len / S), cf * CFrame.new(sx * PR.half * S, 1.05 * S, 0), rail, M.Metal)
			end
		end
		-- the ramps: solid concrete under the climbing walkway, on top of the pier's wall
		for _, sgn in ipairs({ -1, 1 }) do
			local zA = if sgn < 0 then a0 else a1
			local ramp = Instance.new("WedgePart")
			ramp.Size = Vector3.new(PR.half * 2, bridge1 - PR.deck, RAMP) * S
			-- (a wedge rises toward its +z face: turned so it rises toward the arch)
			ramp.CFrame = CFrame.new(o + Vector3.new(0, (PR.deck + bridge1) / 2, zA + sgn * RAMP / 2) * S) * CFrame.Angles(0, if sgn < 0 then 0 else math.pi, 0)
			ramp.Color = concrete
			ramp.Material = M.Concrete
			ramp.Anchored = true
			ramp.CanCollide = false
			ramp.CanQuery = false
			ramp.CanTouch = false
			ramp.Parent = f
		end
		walk(PR.housingEnd, PR.deck, a0 - RAMP, PR.deck, "Deck")
		walk(a0 - RAMP, PR.deck, a0, bridge1, "Deck")
		walk(a0, bridge1, a1, bridge1, "Deck")
		walk(a1, bridge1, a1 + RAMP, PR.deck, "Deck")
		walk(a1 + RAMP, PR.deck, PR.finish, PR.deck, "Deck")
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
		local n = trees(o, "pool")
		progress(("done: pool, %d trees"):format(n))
		return
	end
	if id == "margaret" then
		local L = Land.margaret
		-- near the lineup: the seabed under the see-through water, the beach, the dunes and the
		-- start of the hills (everything further off is in the 3D skybox: Landscape)
		local B = L.bounds
		progress("sampling")
		local sample = makeSampler(L.land, B[1], B[2], B[3], B[4], 5)
		fill(o, sample, B[1], B[2], B[3], B[4], L.material, -18)
		progress("trees")
		local n = trees(o, "margaret")
		progress(("done: %d trees"):format(n))
	end
end

return Builder
