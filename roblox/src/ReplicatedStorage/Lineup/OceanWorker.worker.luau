--!native
-- One strip of the ocean, in its own Actor so the strips are worked out in parallel (see
-- Ocean). "init" builds the strip's mesh; each "frame" message works out its rows in
-- parallel, then writes them into the mesh.

local actor = script:GetActor()
if not actor then
	return
end

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local AssetService = game:GetService("AssetService")
local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config = require(Lineup.Config)
local Core = require(Lineup.OceanCore)
local Land = require(Lineup.Land)

local S = Config.SCALE
local strip = nil
local P = { PX = {}, PY = {}, PZ = {}, TH = {}, FO = {}, LI = {}, HF = {} }
local spotNow = nil

actor:BindToMessage("init", function(cfg)
	-- (one row into each neighbour: strips refreshed on different frames still meet)
	local C = cfg.C
	local r0, r1 = math.max(1, cfg.r0 - 1), math.min(cfg.R, cfg.r1 + 1)
	local em = AssetService:CreateEditableMesh()
	local n = (r1 - r0 + 1) * C
	local pos, nrm, cols = table.create(n), table.create(n), table.create(n)
	local k = 0
	for j = r0, r1 do
		for i = 1, C do
			k += 1
			-- (the initial layout spans a big box centred on the part, so its bounds always
			-- surround the camera, which the part follows)
			local corner = if k == 1 then -1000 elseif j == r1 and i == C then 1000 else 0
			pos[k] = Vector3.new(((i - 1) / (C - 1) - 0.5) * 2000, corner, ((j - r0) / math.max(1, r1 - r0) - 0.5) * 2000)
			nrm[k] = Vector3.yAxis
			cols[k] = Color3.new(0.05, 0.3, 0.3)
		end
	end
	local vIds = em:BatchAdd(Enum.MeshAttribute.Vertex, pos)
	-- (our own normals: cheaper for the engine than working them out itself every frame)
	local nIds = em:BatchAdd(Enum.MeshAttribute.Normal, nrm)
	local cIds = em:BatchAdd(Enum.MeshAttribute.Color, cols, table.create(n, 1))
	local faces, fN, fC = {}, {}, {}
	for j = 1, r1 - r0 do
		for i = 1, C - 1 do
			local a = (j - 1) * C + i
			local b, c = a + 1, a + C
			local d = c + 1
			table.insert(faces, em:AddTriangle(vIds[a], vIds[c], vIds[b]))
			table.insert(fN, { nIds[a], nIds[c], nIds[b] })
			table.insert(fC, { cIds[a], cIds[c], cIds[b] })
			table.insert(faces, em:AddTriangle(vIds[b], vIds[c], vIds[d]))
			table.insert(fN, { nIds[b], nIds[c], nIds[d] })
			table.insert(fC, { cIds[b], cIds[c], cIds[d] })
		end
	end
	em:BatchSetFaceAttributes(faces, fN)
	em:BatchSetFaceAttributes(faces, fC)
	-- (Precise: no levels of detail to rebuild every time the mesh changes)
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(em), {
		CollisionFidelity = Enum.CollisionFidelity.Box,
		RenderFidelity = Enum.RenderFidelity.Precise,
	})
	part.Name = "OceanStrip"
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	-- (unlit: the colours OceanCore works out, sky reflection and sunlight included, are what
	-- you see, as from the web version's water shader)
	part.Material = Enum.Material.Neon
	part.Reflectance = 0
	part.Color = Color3.new(1, 1, 1)
	part.Parent = actor
	strip = { em = em, part = part, vIds = vIds, nIds = nIds, cIds = cIds, pos = pos, nrm = nrm, cols = cols, C = C, r0 = r0, r1 = r1, R = cfg.R }
	actor:SetAttribute("Built", true)
end)

actor:BindToMessageParallel("frame", function(F)
	local st = strip
	if not st then
		return
	end
	if F.spot ~= spotNow then
		Land.set(F.spot)
		spotNow = F.spot
	end
	local t0 = os.clock()
	local jb, je = math.max(1, st.r0 - 1), math.min(F.R, st.r1 + 1)
	-- (colours every other frame, the strips taking turns)
	st.n = (st.n or 0) + 1
	F.colour = F.colour and (st.n + st.r0) % 2 == 0
	Core.compute(F, jb, je, P)
	Core.shade(F, P, jb, je, st.r0, st.r1, st.pos, st.nrm, st.cols)
	local t1 = os.clock()
	st.span = { t0, t1 }
	task.synchronize()
	if st.tn == 30 then
		actor:SetAttribute("Span", ("%.4f-%.4f"):format(st.span[1] % 100, st.span[2] % 100))
	end
	st.em:BatchSetValues(st.vIds, st.pos)
	st.em:BatchSetValues(st.nIds, st.nrm)
	if F.colour then
		st.em:BatchSetValues(st.cIds, st.cols)
	end
	-- (timings for tuning, averaged over a second)
	st.tc = (st.tc or 0) + (t1 - t0)
	st.tw = (st.tw or 0) + (os.clock() - t1)
	st.tn = (st.tn or 0) + 1
	if st.tn >= 60 then
		actor:SetAttribute("ComputeMs", math.floor(st.tc / st.tn * 1e4) / 10)
		actor:SetAttribute("WriteMs", math.floor(st.tw / st.tn * 1e4) / 10)
		st.tc, st.tw, st.tn = 0, 0, 0
	end
	local o = F.origin
	st.part.CFrame = CFrame.new(o.X + F.cam[1] * S, o.Y, o.Z + F.cam[3] * S)
	if F.visible ~= (st.part.Transparency == 0) then
		st.part.Transparency = if F.visible then 0 else 1
	end
end)

actor:SetAttribute("Ready", true)
