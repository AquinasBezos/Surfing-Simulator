-- Parametric surfboards (port of js/board.js): outline, rocker, foil and rails. Nose points
-- along local -z, the deck is at roughly y = +0.035 with the origin on the water line.
-- Shapes are in metres; createBoard builds the mesh at Config.SCALE studs to the metre.

local AssetService = game:GetService("AssetService")
local Config = require(script.Parent.Config)

local Board = {}

local SHAPES = {
	shortboard = {
		outline = {
			{ 0.0, 0.135 },
			{ 0.04, 0.17 },
			{ 0.12, 0.205 },
			{ 0.25, 0.235 },
			{ 0.45, 0.25 },
			{ 0.62, 0.24 },
			{ 0.76, 0.205 },
			{ 0.86, 0.16 },
			{ 0.93, 0.105 },
			{ 0.975, 0.055 },
			{ 1.0, 0.0 },
		},
		tailRocker = 0.045,
		noseRocker = 0.125,
		thick = 0.064,
		fins = { { 0.16, 0.6, 0.05, 1 }, { -0.16, 0.6, -0.05, 1 }, { 0, 0.78, 0, 1 } },
	},
	longboard = {
		outline = {
			{ 0.0, 0.17 },
			{ 0.04, 0.215 },
			{ 0.14, 0.255 },
			{ 0.3, 0.282 },
			{ 0.5, 0.292 },
			{ 0.7, 0.288 },
			{ 0.84, 0.268 },
			{ 0.92, 0.238 },
			{ 0.965, 0.19 },
			{ 0.988, 0.12 },
			{ 1.0, 0.0 },
		},
		tailRocker = 0.05,
		noseRocker = 0.11,
		thick = 0.078,
		fins = { { 0, 1.18, 0, 1.9 } },
	},
}

local function outlineAt(tbl, t)
	for i = 1, #tbl - 1 do
		local t0, w0 = tbl[i][1], tbl[i][2]
		local t1, w1 = tbl[i + 1][1], tbl[i + 1][2]
		if t <= t1 then
			local p0 = tbl[math.max(i - 1, 1)][2]
			local p3 = tbl[math.min(i + 2, #tbl)][2]
			local s = (t - t0) / (t1 - t0)
			local s2, s3 = s * s, s * s * s
			-- Catmull-Rom
			return 0.5 * (2 * w0 + (-p0 + w1) * s + (2 * p0 - 5 * w0 + 4 * w1 - p3) * s2 + (-p0 + 3 * w0 - 3 * w1 + p3) * s3)
		end
	end
	return 0
end

local function rockerOf(spec, t)
	local tail = if t < 0.3 then spec.tailRocker * (1 - t / 0.3) ^ 2 else 0
	local nose = if t > 0.55 then spec.noseRocker * ((t - 0.55) / 0.45) ^ 2.1 else 0
	return tail + nose
end
local function thicknessOf(spec, t)
	return 0.016 + (spec.thick - 0.016) * math.sin(math.pi * math.min(1, 0.04 + t * 0.94)) ^ 0.62
end

-- The bottom of a board on its centre line at t (0 tail .. 1 nose), in the board's frame.
function Board.bottom(kind, t)
	local spec = SHAPES[kind] or SHAPES.shortboard
	return -thicknessOf(spec, t) * 0.38 + rockerOf(spec, t) - 0.025
end

function Board.railHalfWidth(kind, t)
	return math.max(outlineAt((SHAPES[kind] or SHAPES.shortboard).outline, math.clamp(t, 0, 1)), 0)
end

-- A plain board (an elongated ellipsoid and a fin), for when there's no room left for an
-- editable mesh. Same interface as Board.create.
function Board.simple(kind, deck, L)
	local S = Config.SCALE
	local spec = SHAPES[kind] or SHAPES.shortboard
	local w = 0
	for _, p in ipairs(spec.outline) do
		w = math.max(w, 2 * p[2])
	end
	local model = Instance.new("Model")
	model.Name = "Board"
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(0.1, 0.1, 0.1)
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.Parent = model
	model.PrimaryPart = root
	local hull = Instance.new("Part")
	hull.Name = "Hull"
	hull.Size = Vector3.new(w, spec.thick, L) * S
	hull.Color = deck
	hull.Material = Enum.Material.SmoothPlastic
	hull.Anchored = true
	hull.CanCollide = false
	hull.CanQuery = false
	hull.CanTouch = false
	hull.CastShadow = false
	local mesh = Instance.new("SpecialMesh")
	mesh.MeshType = Enum.MeshType.Sphere
	mesh.Parent = hull
	hull.Parent = model
	model:SetAttribute("Length", L)
	model:SetAttribute("Kind", kind)
	local off = CFrame.new(0, 0.005 * S, 0)
	return model, function(cf)
		root.CFrame = cf
		hull.CFrame = cf * off
	end
end

-- A board model: the hull (deck colour + a stringer and rails in the classic finish) and
-- its fins, welded to a root part at the board's origin. Returns the Model (PrimaryPart =
-- root). color: deck colour, or nil for the classic white.
function Board.create(kind, color)
	local S = Config.SCALE
	local spec = SHAPES[kind] or SHAPES.shortboard
	local L = (Config.BOARDS[kind] or Config.BOARDS.shortboard).length
	local NL = if kind == "longboard" then 48 else 40
	local NA = 20
	local deck = color or Color3.fromRGB(245, 244, 238)
	local bottomCol = Color3.fromRGB(235, 236, 232)

	local em = Config.editableMesh()
	if not em then
		-- (no room left for editable meshes on this device: a plainer board)
		return Board.simple(kind, deck, L)
	end
	local ids, pts = {}, {}
	for i = 0, NL do
		pts[i] = {}
		local s = i / NL
		local t = 0.5 - 0.5 * math.cos(math.pi * s)
		local hw = math.max(outlineAt(spec.outline, t), 0.002)
		local th = thicknessOf(spec, t)
		local r = rockerOf(spec, t)
		local z = (0.5 - t) * L
		ids[i] = {}
		for j = 0, NA - 1 do
			local a = j / NA * math.pi * 2
			local c, sn = math.cos(a), math.sin(a)
			local x = hw * math.sign(c) * math.abs(c) ^ 0.42
			local yTop = th * 0.62 * math.abs(sn) ^ 0.55
			local yBot = -th * 0.38 * math.abs(sn) ^ 0.28
			local y = (if sn >= 0 then yTop else yBot) + r - 0.025
			local p = Vector3.new(x, y, z) * S
			ids[i][j] = em:AddVertex(p)
			pts[i][j] = p
		end
	end
	-- smooth outward normals: along the board (toward the nose) x around the ring
	local nids = {}
	for i = 0, NL do
		nids[i] = {}
		for j = 0, NA - 1 do
			local along = pts[math.min(i + 1, NL)][j] - pts[math.max(i - 1, 0)][j]
			local around = pts[i][(j + 1) % NA] - pts[i][(j - 1) % NA]
			local n = along:Cross(around)
			if n.Magnitude < 1e-9 then
				-- (the tip of the nose or tail, where the ring shrinks to a point)
				n = if i == 0 then Vector3.zAxis else -Vector3.zAxis
			end
			nids[i][j] = em:AddNormal(n.Unit)
		end
	end
	-- (the ring is too coarse for the web version's painted stringer: the deck is one colour)
	local function colourAt(_i, j)
		local sn = math.sin(j / NA * math.pi * 2)
		return if sn >= 0 then deck else bottomCol
	end
	local faces = {}
	local fcols = {}
	for i = 0, NL - 1 do
		for j = 0, NA - 1 do
			local j2 = (j + 1) % NA
			local a, b, c, d = ids[i][j], ids[i][j2], ids[i + 1][j], ids[i + 1][j2]
			local na, nb, nc, nd = nids[i][j], nids[i][j2], nids[i + 1][j], nids[i + 1][j2]
			local f1 = em:AddTriangle(a, c, b)
			em:SetFaceNormals(f1, { na, nc, nb })
			table.insert(faces, f1)
			table.insert(fcols, colourAt(i, j))
			local f2 = em:AddTriangle(b, c, d)
			em:SetFaceNormals(f2, { nb, nc, nd })
			table.insert(faces, f2)
			table.insert(fcols, colourAt(i, j))
		end
	end
	-- flat colour per face (its own colour IDs so the stringer stays crisp)
	for k, f in ipairs(faces) do
		local cid = em:AddColor(fcols[k], 1)
		em:SetFaceColors(f, { cid, cid, cid })
	end
	-- (a fixed-size copy takes much less of the client's budget for editable meshes)
	local fixed = AssetService:CreateEditableMeshAsync(Content.fromObject(em), { FixedSize = true })
	em:Destroy()
	if not fixed then
		return Board.simple(kind, deck, L)
	end
	local hull = AssetService:CreateMeshPartAsync(Content.fromObject(fixed), { CollisionFidelity = Enum.CollisionFidelity.Box })
	hull.Name = "Hull"
	hull.Material = Enum.Material.SmoothPlastic
	hull.Reflectance = 0.05
	hull.Color = Color3.new(1, 1, 1)
	hull.Anchored = true
	hull.CanCollide = false
	hull.CanQuery = false
	hull.CanTouch = false
	hull.CastShadow = false

	local model = Instance.new("Model")
	model.Name = "Board"
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(0.1, 0.1, 0.1)
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Parent = model
	model.PrimaryPart = root
	-- (an editable mesh's vertices are drawn where they are in the part's frame)
	local offset = CFrame.identity
	hull.Parent = model
	model:SetAttribute("Length", L)
	local parts = { { hull, offset } }
	for _, f in ipairs(spec.fins) do
		local fx, fz, toe, size = f[1], f[2], f[3], f[4]
		local fin = Instance.new("WedgePart")
		fin.Name = "Fin"
		fin.Size = Vector3.new(0.008, 0.11 * size, 0.11 * size) * S
		fin.Color = Color3.fromRGB(26, 26, 26)
		fin.Material = Enum.Material.SmoothPlastic
		fin.Anchored = true
		fin.CanCollide = false
		fin.CanQuery = false
		fin.CanTouch = false
		local tt = 0.5 - fz / L
		local off = CFrame.new(Vector3.new(fx, rockerOf(spec, tt) - 0.04 - 0.055 * size, fz) * S)
			* CFrame.Angles(0, toe, 0)
			* CFrame.Angles(math.pi, 0, 0)
		fin.Parent = model
		table.insert(parts, { fin, off })
	end
	model:SetAttribute("Kind", kind)
	-- place every piece relative to the root
	local function place(cf)
		root.CFrame = cf
		for _, p in ipairs(parts) do
			p[1].CFrame = cf * p[2]
		end
	end
	return model, place
end

return Board
