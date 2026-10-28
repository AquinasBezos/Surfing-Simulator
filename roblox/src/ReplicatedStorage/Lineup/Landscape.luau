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

local current = nil -- { id, time, folder, parts = { { part, centre } }, origin }

-- Build spot `id`'s far land for time of day `timeName`, replacing any other. ready(): the
-- ocean is built (editable meshes share a tight budget on the client; the ocean comes first).
function Landscape.build(id, origin, parent, ready, timeName)
	timeName = timeName or "day"
	if current and current.id == id and current.time == timeName then
		return
	end
	if current then
		current.folder:Destroy()
		current = nil
	end
	local L = Land[id]
	local folder = Instance.new("Folder")
	folder.Name = "SkyLand_" .. id
	folder.Parent = parent
	local me = { id = id, time = timeName, folder = folder, parts = {}, origin = origin }
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
	local B = L.bounds
	local x0, x1, z0, z1, step = table.unpack(L.sky)
	local nx = math.ceil((x1 - x0) / step) + 1
	local nz = math.ceil((z1 - z0) / step) + 1
	local em = AssetService:CreateEditableMesh()
	if not em then
		warn("[Lineup] no room for the distant land")
		return
	end
	local H, P, inside, vid, cid = {}, {}, {}, {}, {}
	local lx, lz = L.lineup and L.lineup[1] or 0, L.lineup and L.lineup[2] or 0
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			local x, z = math.min(x0 + i * step, x1), math.min(z0 + j * step, z1)
			local h, veg, s, extra = L.land(x, z)
			local hx = L.land(x + step * 0.5, z) - L.land(x - step * 0.5, z)
			local hz = L.land(x, z + step * 0.5) - L.land(x, z - step * 0.5)
			local slope = math.sqrt(hx * hx + hz * hz) / step
			local k = j * nx + i + 1
			H[k] = h
			-- (well inside the near terrain: drawn by the terrain)
			inside[k] = x > B[1] + step and x < B[2] - step and z > B[3] + step and z < B[4] - step
			local p = Vector3.new(x, h - 0.5, z) * S * K
			P[k] = p
			vid[k] = em:AddVertex(p)
			local c = L.color(x, z, h, slope, veg or 0, s or 0, extra)
			local d = math.sqrt((x - lx) ^ 2 + (z - lz) ^ 2)
			cid[k] = em:AddColor(c:Lerp(haze[1], 1 - math.exp(-d * haze[2])), 1)
		end
		if j % 8 == 0 then
			task.wait()
			if current ~= me then
				em:Destroy()
				return
			end
		end
	end
	local n = 0
	for j = 1, nz - 1 do
		for i = 1, nx - 1 do
			local a = (j - 1) * nx + i
			local b, c = a + 1, a + nx
			local d = c + 1
			if math.max(H[a], H[b], H[c], H[d]) > 0.3 and not (inside[a] and inside[b] and inside[c] and inside[d]) then
				local f1 = em:AddTriangle(vid[a], vid[c], vid[b])
				em:SetFaceColors(f1, { cid[a], cid[c], cid[b] })
				local f2 = em:AddTriangle(vid[b], vid[c], vid[d])
				em:SetFaceColors(f2, { cid[b], cid[c], cid[d] })
				n += 2
			end
		end
	end
	if n == 0 then
		em:Destroy()
		return
	end
	-- (a fixed-size copy takes much less of the budget for editable meshes)
	local fixed = AssetService:CreateEditableMeshAsync(Content.fromObject(em), { FixedSize = true })
	em:Destroy()
	if not fixed or current ~= me then
		return
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(fixed), {
		CollisionFidelity = Enum.CollisionFidelity.Box,
		RenderFidelity = Enum.RenderFidelity.Precise,
	})
	part.Name = "SkyLand"
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Material = Enum.Material.SmoothPlastic
	part.Color = Color3.new(1, 1, 1)
	part.Parent = folder
	-- (an editable mesh's vertices are drawn where they are in the part's frame: no recentring)
	table.insert(me.parts, { part = part, fixed = fixed })
end

-- Every frame, after the camera has moved: put the miniature where it projects right.
function Landscape.place(cameraPos)
	local cur = current
	if not cur then
		return
	end
	local base = cameraPos * (1 - K) + cur.origin * K
	for _, p in ipairs(cur.parts) do
		p.part.CFrame = CFrame.new(base)
	end
end

return Landscape
