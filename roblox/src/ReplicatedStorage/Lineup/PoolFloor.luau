-- The wave pool's floor (js/wavepool.js's basin) as a mesh: deep at the back, the shallow
-- shelf along the line where each wave breaks, the beaches at the front, the trench along
-- the pier. Voxel terrain can't hold it: its surface lands to within a couple of metres and
-- it can't follow the pool's diagonal walls, so the shelf broke the surface and the walls
-- grew rocks. Pale painted concrete in the deep, sand on the beaches.

local AssetService = game:GetService("AssetService")

local Config = require(script.Parent.Config)
local Land = require(script.Parent.Land)

local S = Config.SCALE
local STEP = 2.5 -- metres

local PoolFloor = {}

local current = nil

-- Build it at the spot's origin (studs) under parent; anything else drops it.
function PoolFloor.build(id, origin, parent)
	if current then
		-- (its mesh let go at once: the budget for editable meshes is small)
		current.part:Destroy()
		current.fixed:Destroy()
		current = nil
	end
	if id ~= "pool" then
		return
	end
	local L = Land.pool
	local P = L.corners
	local x0, x1 = -P.sx - 4, P.sx + 4
	local z0, z1 = P.bz - 4, P.fz + 4
	local nx = math.ceil((x1 - x0) / STEP) + 1
	local nz = math.ceil((z1 - z0) / STEP) + 1
	local em = AssetService:CreateEditableMesh()
	if not em then
		warn("[Lineup] no room for the pool's floor")
		return
	end
	local vid, cid, ins = {}, {}, {}
	for j = 0, nz - 1 do
		for i = 0, nx - 1 do
			local x, z = x0 + i * STEP, z0 + j * STEP
			local k = j * nx + i + 1
			ins[k] = L.inside(x, z)
			-- (a little way under the walls and the walkway, so no gap shows at the edge)
			local y = L.poolFloor(x, z)
			vid[k] = em:AddVertex(Vector3.new(x, y, z) * S)
			local r, g, b = L.bed(x, z)
			cid[k] = em:AddColor(Color3.new(r, g, b), 1)
		end
	end
	for j = 1, nz - 1 do
		for i = 1, nx - 1 do
			local a = (j - 1) * nx + i
			local b, c = a + 1, a + nx
			local d = c + 1
			if math.max(ins[a], ins[b], ins[c], ins[d]) > -3 then
				local f1 = em:AddTriangle(vid[a], vid[c], vid[b])
				em:SetFaceColors(f1, { cid[a], cid[c], cid[b] })
				local f2 = em:AddTriangle(vid[b], vid[c], vid[d])
				em:SetFaceColors(f2, { cid[b], cid[c], cid[d] })
			end
		end
	end
	local fixed = AssetService:CreateEditableMeshAsync(Content.fromObject(em), { FixedSize = true })
	em:Destroy()
	if not fixed then
		return
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(fixed), {
		CollisionFidelity = Enum.CollisionFidelity.Box,
		RenderFidelity = Enum.RenderFidelity.Precise,
	})
	part.Name = "PoolFloor"
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Material = Enum.Material.SmoothPlastic
	part.Color = Color3.new(1, 1, 1)
	-- (an editable mesh's vertices are drawn where they are in the part's frame)
	part.CFrame = CFrame.new(origin)
	part.Parent = parent
	current = { part = part, fixed = fixed }
end

return PoolFloor
