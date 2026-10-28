--!native
-- One strip of the ocean near the camera, in its own Actor so the strips are worked out in
-- parallel (see Ocean). "init" builds the strip's mesh; each "frame" message works out its
-- rows in parallel, then writes them into the mesh.

local actor = script:GetActor()
if not actor then
	return
end

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local AssetService = game:GetService("AssetService")
local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config = require(Lineup.Config)
local Core = require(Lineup.OceanCore)

local S = Config.SCALE
local strip = nil
local P = { PX = {}, PY = {}, PZ = {} }

local dead = false

actor:BindToMessage("init", function(cfg)
	-- (one row into each neighbour, so the strips always meet)
	local C = cfg.C
	local r0, r1 = math.max(1, cfg.r0 - 1), math.min(cfg.R, cfg.r1 + 1)
	-- Editable meshes share a small memory budget on the client; just after the graphics
	-- setting changes, the old ocean's may not have been let go yet. No room: try again
	-- shortly, for as long as it takes (the strip is part of the sea).
	local em = Config.editableMesh()
	while not em do
		if Config.meshBlocked then
			-- (the experience doesn't allow editable meshes at all: waiting won't help)
			actor:SetAttribute("Blocked", true)
			return
		end
		actor:SetAttribute("Waiting", true)
		task.wait(0.25)
		if dead or not actor.Parent then
			return
		end
		em = Config.editableMesh()
	end
	actor:SetAttribute("Waiting", nil)
	local n = (r1 - r0 + 1) * C
	local pos, nrm = table.create(n), table.create(n)
	local k = 0
	for j = r0, r1 do
		for i = 1, C do
			k += 1
			-- (the initial layout spans a big box centred on the part, so its bounds always
			-- surround the camera, which the part follows)
			local corner = if k == 1 then -1000 elseif j == r1 and i == C then 1000 else 0
			pos[k] = Vector3.new(((i - 1) / (C - 1) - 0.5) * 2000, corner, ((j - r0) / math.max(1, r1 - r0) - 0.5) * 2000)
			nrm[k] = Vector3.yAxis
		end
	end
	local vIds = em:BatchAdd(Enum.MeshAttribute.Vertex, pos)
	local nIds = em:BatchAdd(Enum.MeshAttribute.Normal, nrm)
	local faces, fN = {}, {}
	for j = 1, r1 - r0 do
		for i = 1, C - 1 do
			local a = (j - 1) * C + i
			local b, c = a + 1, a + C
			local d = c + 1
			table.insert(faces, em:AddTriangle(vIds[a], vIds[c], vIds[b]))
			table.insert(fN, { nIds[a], nIds[c], nIds[b] })
			table.insert(faces, em:AddTriangle(vIds[b], vIds[c], vIds[d]))
			table.insert(fN, { nIds[b], nIds[c], nIds[d] })
		end
	end
	em:BatchSetFaceAttributes(faces, fN)
	-- (Precise: no levels of detail to rebuild every time the mesh changes)
	local part
	repeat
		local ok, p = pcall(AssetService.CreateMeshPartAsync, AssetService, Content.fromObject(em), {
			CollisionFidelity = Enum.CollisionFidelity.Box,
			RenderFidelity = Enum.RenderFidelity.Precise,
		})
		if ok then
			part = p
		else
			task.wait(0.25)
		end
		if dead or not actor.Parent then
			em:Destroy()
			return
		end
	until part
	part.Name = "OceanStrip"
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.Parent = actor
	strip = { em = em, part = part, vIds = vIds, nIds = nIds, pos = pos, nrm = nrm, r0 = r0, r1 = r1 }
	actor:SetAttribute("Built", true)
end)

-- The ocean's being replaced: let the mesh go now (destroying the actor alone leaves it
-- holding its share of the budget until it's collected).
actor:BindToMessage("destroy", function()
	dead = true
	local st = strip
	strip = nil
	if st then
		st.part:Destroy()
		st.em:Destroy()
	end
	actor:SetAttribute("Freed", true)
end)

actor:BindToMessageParallel("frame", function(F)
	local st = strip
	if not st then
		return
	end
	local jb, je = math.max(1, st.r0 - 1), math.min(F.R, st.r1 + 1)
	Core.compute(F, jb, je, P)
	Core.shape(F, P, jb, je, st.r0, st.r1, st.pos, st.nrm)
	task.synchronize()
	st.em:BatchSetValues(st.vIds, st.pos)
	st.em:BatchSetValues(st.nIds, st.nrm)
	local o = F.origin
	local part = st.part
	part.CFrame = CFrame.new(o.X + F.cam[1] * S, o.Y, o.Z + F.cam[3] * S)
	-- the water's look (Ocean.LOOK)
	local L = F.look
	if part.Color ~= L.color then
		part.Color = L.color
	end
	if part.Material ~= L.material then
		part.Material = L.material
	end
	if part.Transparency ~= L.transparency then
		part.Transparency = L.transparency
	end
	if part.Reflectance ~= L.reflectance then
		part.Reflectance = L.reflectance
	end
end)

actor:SetAttribute("Ready", true)
