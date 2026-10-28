-- The distant land as a 3D skybox, the way Source games (CS:GO, CS2) draw far-off scenery:
-- a miniature of it, built at scale K, that the camera sees exactly as it would the real
-- thing. Each frame the miniature is placed so that every point of it lies on the line from
-- the camera to where that point really is, K of the way there:
--     drawn = camera + (real - camera) * K
-- so it projects onto the same pixels, but sits K times closer: inside the distance Roblox
-- draws at on any graphics setting (it drops far-off terrain and parts when the frame rate
-- falls), clear of the fog, and small enough to be one mesh. The near land (the beach, the
-- reef, the pool) is real terrain; the miniature is everything outside it. Distance haze is
-- baked into its colours, since the real atmosphere hardly touches something so close.
--
-- (K is a tenth, not Source's sixteenth: anything nearer than K times the distance of the
-- land behind it, a surfer far off riding toward the beach say, is hidden by the miniature,
-- so it mustn't come too close. A tenth puts all of it within 70 to 400 studs: inside what
-- Roblox draws even when it turns the graphics down.)

local AssetService = game:GetService("AssetService")

local Config = require(script.Parent.Config)
local Land = require(script.Parent.Land)

local S = Config.SCALE
local K = 0.1

local Landscape = {}
Landscape.K = K

-- haze: the colour far land fades into, and how fast (per metre)
local HAZE = {
	day = { Color3.fromRGB(176, 198, 218), 0.00011 },
	sunset = { Color3.fromRGB(200, 140, 120), 0.00018 },
}

local current = nil -- { id, time, folder, parts = { { part } }, origin }

-- Grid coordinates from lo to hi that include b0 and b1 exactly: s0 apart next to them,
-- spreading out with distance from them; between them (under the near terrain) only a few.
local function axis(lo, hi, b0, b1, s0)
	local GROW = 0.05
	b0, b1 = math.clamp(b0, lo, hi), math.clamp(b1, lo, hi)
	-- below b0, down to lo
	local down = {}
	local p = b0
	while p > lo do
		table.insert(down, 1, p)
		p -= s0 + GROW * (b0 - p)
	end
	local out = { lo }
	for _, v in ipairs(down) do
		if v > out[#out] then
			table.insert(out, v)
		end
	end
	-- between them, a few
	local inner = math.max(1, math.ceil((b1 - b0) / 200))
	for q = 1, inner - 1 do
		table.insert(out, b0 + (b1 - b0) * q / inner)
	end
	-- from b1 up to hi
	p = b1
	while p < hi do
		if p > out[#out] then
			table.insert(out, p)
		end
		p += s0 + GROW * (p - b1)
	end
	if hi > out[#out] then
		table.insert(out, hi)
	end
	return out
end

-- Turn a built mesh into a part of the miniature (n: its triangles).
local function finish(me, em, n, name, material)
	if n == 0 then
		em:Destroy()
		return
	end
	-- (a fixed-size copy takes much less of the budget for editable meshes)
	local fixed = AssetService:CreateEditableMeshAsync(Content.fromObject(em), { FixedSize = true })
	em:Destroy()
	if not fixed or current ~= me then
		return false
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(fixed), {
		CollisionFidelity = Enum.CollisionFidelity.Box,
		RenderFidelity = Enum.RenderFidelity.Precise,
	})
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Material = material
	part.Color = Color3.new(1, 1, 1)
	part.Parent = me.folder
	-- (an editable mesh's vertices are drawn where they are in the part's frame: no recentring)
	table.insert(me.parts, { part = part, fixed = fixed })
	return true
end

-- Drop the miniature, letting its meshes go at once (their share of the client's budget for
-- editable meshes is wanted back: the ocean comes first).
function Landscape.clear()
	local cur = current
	current = nil
	if cur then
		for _, p in ipairs(cur.parts) do
			p.part:Destroy()
			p.fixed:Destroy()
		end
		cur.folder:Destroy()
	end
end

-- Build spot `id`'s far land for time of day `timeName`, replacing any other. ready(): the
-- ocean is built (editable meshes share a tight budget on the client; the ocean comes first).
function Landscape.build(id, origin, parent, ready, timeName)
	timeName = timeName or "day"
	if current and current.id == id and current.time == timeName then
		return
	end
	Landscape.clear()
	local L = Land[id]
	local folder = Instance.new("Folder")
	folder.Name = "SkyLand_" .. id
	folder.Parent = parent
	-- (a spot can set its own scale, and keep the miniature to part of the view: see Land)
	local K = L and L.skyK or K
	local keep = L and L.skyKeep or function()
		return true
	end
	local me = { id = id, time = timeName, folder = folder, parts = {}, origin = origin, K = K }
	current = me
	if not (L and L.sky) then
		return
	end
	while ready and not ready() do
		task.wait(0.1)
	end
	if current ~= me then
		return
	end
	local haze = HAZE[timeName] or HAZE.day
	local N = L.near
	local terrain = workspace.Terrain
	local lx, lz = L.lineup and L.lineup[1] or 0, L.lineup and L.lineup[2] or 0
	local function hazed(c, x, z)
		local d = math.sqrt((x - lx) ^ 2 + (z - lz) ^ 2)
		return c:Lerp(haze[1], 1 - math.exp(-d * haze[2]))
	end

	-- The land: true when it's built, false when there was no room for it at this step.
	local function landMesh(step)
		local x0, x1, z0, z1 = table.unpack(L.sky)
		-- Everything above the water further than N[3] from the lineup is drawn here (the real
		-- terrain draws the land within it, and the seabed). The grid is finest round that circle,
		-- spreading out with distance.
		local xs = axis(x0, x1, N[1] - N[3], N[1] + N[3], step)
		local zs = axis(z0, z1, N[2] - N[3], N[2] + N[3], step)
		local nx, nz = #xs, #zs
		local em = AssetService:CreateEditableMesh()
		if not em then
			return false
		end
		local H, inside, vid, cid = {}, {}, {}, {}
		for j = 1, nz do
			for i = 1, nx do
				local x, z = xs[i], zs[j]
				local h, veg, s, extra = L.land(x, z)
				local e = 3
				local hx = L.land(x + e, z) - L.land(x - e, z)
				local hz = L.land(x, z + e) - L.land(x, z - e)
				local slope = math.sqrt(hx * hx + hz * hz) / (2 * e)
				local k = (j - 1) * nx + i
				H[k] = h
				-- (within the near circle: drawn by the terrain)
				inside[k] = (x - N[1]) ^ 2 + (z - N[2]) ^ 2 <= N[3] * N[3] or not keep(x, z)
				vid[k] = em:AddVertex(Vector3.new(x, h, z) * S * K)
				-- half the colour of the terrain material that would be there (so it matches the
				-- terrain where they meet), half the web version's, then the haze
				local c = terrain:GetMaterialColor(L.material(x, z, h, slope, veg or 0, s or 0))
				c = c:Lerp(L.color(x, z, h, slope, veg or 0, s or 0, extra), 0.5)
				cid[k] = em:AddColor(hazed(c, x, z), 1)
			end
			if j % 6 == 0 then
				task.wait()
				if current ~= me then
					em:Destroy()
					return true
				end
			end
		end
		local n = 0
		for j = 1, nz - 1 do
			for i = 1, nx - 1 do
				local a = (j - 1) * nx + i
				local b, c = a + 1, a + nx
				local d = c + 1
				if math.max(H[a], H[b], H[c], H[d]) > 0.05 and not (inside[a] and inside[b] and inside[c] and inside[d]) and n < 19800 then
					local f1 = em:AddTriangle(vid[a], vid[c], vid[b])
					em:SetFaceColors(f1, { cid[a], cid[c], cid[b] })
					local f2 = em:AddTriangle(vid[b], vid[c], vid[d])
					em:SetFaceColors(f2, { cid[b], cid[c], cid[d] })
					n += 2
				end
			end
		end
		return finish(me, em, n, "SkyLand", Enum.Material.SmoothPlastic) ~= false
	end

	-- (editable meshes share a small memory budget on each client, smaller on some devices:
	-- if there's no room, a coarser grid)
	local step = L.sky[5]
	for _ = 1, 3 do
		if landMesh(step) then
			break
		end
		step *= 2
	end
	if current ~= me then
		return
	end

	-- The trees beyond the near circle, as low-poly blobs (an octahedron each, squashed:
	-- canopies are wider than tall); the near ones are parts (TerrainBuilder).
	local tm = AssetService:CreateEditableMesh()
	if not tm then
		return
	end
	local A, Bc = Color3.fromRGB(28, 51, 25), Color3.fromRGB(52, 80, 42)
	local nt = 0
	local DIRS = { Vector3.xAxis, -Vector3.xAxis, Vector3.zAxis, -Vector3.zAxis, Vector3.new(0, 0.85, 0), Vector3.new(0, -0.6, 0) }
	-- (the faces, as indices into DIRS: +x -x +z -z top bottom)
	local FACES = { { 5, 3, 1 }, { 5, 2, 3 }, { 5, 4, 2 }, { 5, 1, 4 }, { 6, 1, 3 }, { 6, 3, 2 }, { 6, 2, 4 }, { 6, 4, 1 } }
	for _, t in ipairs(Land.trees(id)) do
		if (t.x - N[1]) ^ 2 + (t.z - N[2]) ^ 2 <= N[3] * N[3] or not keep(t.x, t.z) or nt > 19000 then
			continue
		end
		local c = Vector3.new(t.x, t.h + 0.35 * t.r, t.z)
		local col = tm:AddColor(hazed(A:Lerp(Bc, t.shade * t.shade):Lerp(Color3.new(0, 0, 0), t.shade * 0.2), t.x, t.z), 1)
		local v = {}
		for q, dir in ipairs(DIRS) do
			v[q] = tm:AddVertex((c + dir * t.r) * S * K)
		end
		for _, f in ipairs(FACES) do
			local face = tm:AddTriangle(v[f[1]], v[f[2]], v[f[3]])
			tm:SetFaceColors(face, { col, col, col })
		end
		nt += 8
	end
	finish(me, tm, nt, "SkyTrees", Enum.Material.Grass)
end

-- Every frame, after the camera has moved: put the miniature where it projects right.
function Landscape.place(cameraPos)
	local cur = current
	if not cur then
		return
	end
	local base = cameraPos * (1 - cur.K) + cur.origin * cur.K
	for _, p in ipairs(cur.parts) do
		p.part.CFrame = CFrame.new(base)
	end
end

return Landscape
