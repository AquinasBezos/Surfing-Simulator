-- The distant land as vertex-coloured meshes (after js/landkit.js's land mesh). Roblox
-- draws terrain only so far out (less on lower graphics settings), and the hills behind the
-- beach, the headland and the island are a kilometre or more away; these coarse meshes sit
-- just under the terrain, so close by the terrain shows and far off they do.

local AssetService = game:GetService("AssetService")

local Config = require(script.Parent.Config)
local Land = require(script.Parent.Land)

local S = Config.SCALE
local SINK = 1.5 -- metres under the terrain

local Landscape = {}

local TILE = 2000 -- studs (a mesh can't be more than 2048 across)

local function grid(L, origin, x0, x1, z0, z1, step, parent)
	-- (big areas in tiles, sharing their edges)
	if (x1 - x0) * S > TILE or (z1 - z0) * S > TILE then
		-- (whole steps per tile, as many as fit)
		local span = math.floor(TILE / S / step) * step
		for a = x0, x1 - 1, span do
			for b = z0, z1 - 1, span do
				grid(L, origin, a, math.min(a + span, x1), b, math.min(b + span, z1), step, parent)
			end
		end
		return
	end
	local nx = math.ceil((x1 - x0) / step) + 1
	local nz = math.ceil((z1 - z0) / step) + 1
	local H = {}
	local em = AssetService:CreateEditableMesh()
	if not em then
		warn("[Lineup] no room for more of the distant land")
		return
	end
	local vid, cid = {}, {}
	local lo, hi = Vector3.one * math.huge, -Vector3.one * math.huge
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			local x, z = math.min(x0 + i * step, x1), math.min(z0 + j * step, z1)
			local h, veg, s, extra = L.land(x, z)
			local hx = L.land(x + step * 0.5, z) - L.land(x - step * 0.5, z)
			local hz = L.land(x, z + step * 0.5) - L.land(x, z - step * 0.5)
			local slope = math.sqrt(hx * hx + hz * hz) / step
			local k = j * nx + i + 1
			H[k] = h
			local p = Vector3.new(x * S, (h - SINK) * S, z * S)
			lo, hi = lo:Min(p), hi:Max(p)
			vid[k] = em:AddVertex(p)
			cid[k] = em:AddColor(L.color(x, z, h, slope, veg or 0, s or 0, extra), 1)
		end
		if j % 10 == 0 then
			task.wait()
		end
	end
	local n = 0
	for j = 1, nz - 1 do
		for i = 1, nx - 1 do
			local a = (j - 1) * nx + i
			local b, c = a + 1, a + nx
			local d = c + 1
			-- (only where there's land: under the sea the water and the terrain are enough)
			if math.max(H[a], H[b], H[c], H[d]) > 0.2 then
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
	-- (a fixed-size copy takes much less of the client's budget for editable meshes)
	local fixed = AssetService:CreateEditableMeshAsync(Content.fromObject(em), { FixedSize = true })
	em:Destroy()
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(fixed), {
		CollisionFidelity = Enum.CollisionFidelity.Box,
		RenderFidelity = Enum.RenderFidelity.Precise,
	})
	-- (the mesh is drawn centred on its bounds: put it back where its vertices say)
	part.Name = "FarLand"
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Material = Enum.Material.SmoothPlastic
	part.Color = Color3.new(1, 1, 1)
	part.CFrame = CFrame.new(origin + (lo + hi) / 2)
	part.Parent = parent
end

-- Build the distant land of spot `id`, dropping any other spot's (editable meshes share a
-- tight memory budget on the client, and the ocean comes first: ready() says when it's
-- built). Returns its folder.
local built = {}
function Landscape.build(id, origin, parent, ready)
	if built[id] then
		return built[id]
	end
	for other, f in pairs(built) do
		f:Destroy()
		built[other] = nil
	end
	local L = Land[id]
	local folder = Instance.new("Folder")
	folder.Name = "FarLand_" .. id
	folder.Parent = parent
	built[id] = folder
	while ready and not ready() do
		task.wait(0.1)
	end
	if built[id] ~= folder then
		return folder
	end
	if L and L.far then
		for _, g in ipairs(L.far) do
			if built[id] ~= folder then
				break -- (another spot was chosen meanwhile)
			end
			grid(L, origin, g[1], g[2], g[3], g[4], g[5], folder)
		end
	end
	return folder
end

return Landscape
