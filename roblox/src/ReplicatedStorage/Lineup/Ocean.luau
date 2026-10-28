--!native
-- The ocean (after js/ocean.js and js/oceanGrid.js), done the way that suits Roblox:
--   * near the camera (within HALF metres), the real waves: an adaptive lattice whose rows
--     and columns cluster at the camera, the crest and the breaking point, deformed on the
--     CPU with the curling lip (OceanCore) by one OceanWorker actor per strip of rows, in
--     parallel. EditableMesh allows 20,000 triangles a mesh, so the strips are separate.
--   * the water is one translucent colour in Roblox's Glass material, which refracts the
--     seabed under it and reflects the sky; the whitewater is particles (Foam).
--   * beyond, the open sea is flat: four planes framing the patch, following the camera.
--     (A part can't be more than 2048 studs across, but a SpecialMesh can scale it further.)

local Config = require(script.Parent.Config)
local WM = require(script.Parent.WaveModel)

local WAVE = Config.WAVE
local CURL = WM.CURL
local S = Config.SCALE

local exp, sqrt, abs, max, min = math.exp, math.sqrt, math.abs, math.max, math.min

local HALF = 400 -- metres: the patch of real waves round the camera
local FAR = 12000 -- metres: how far the flat sea reaches

local function smoothstep(a, b, x)
	local t = (x - a) / (b - a)
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return t * t * (3 - 2 * t)
end

-- Find a scale so that marching lo -> hi with step scale*spacing(p) takes exactly n-1
-- steps, then march it into out[1..n]. (guess: last frame's scale, to start the search near.)
local function distribute(out, n, lo, hi, spacing, guess)
	local function fracSteps(scale)
		local p = lo
		for i = 0, 4 * n do
			local step = scale * spacing(p)
			if p + step >= hi then
				return i + (hi - p) / step
			end
			p += step
		end
		return 4 * n
	end
	local a, b = 0.02, 200
	if guess then
		a, b = guess * 0.8, guess * 1.25
		if fracSteps(a) < n - 1 then
			a = 0.02
		end
		if fracSteps(b) > n - 1 then
			b = 200
		end
	end
	for _ = 1, 20 do
		local m = sqrt(a * b)
		if fracSteps(m) > n - 1 then
			a = m
		else
			b = m
		end
	end
	local scale = sqrt(a * b)
	local p = lo
	out[1] = lo
	for i = 2, n do
		p += scale * spacing(p)
		out[i] = min(p, hi)
	end
	out[n] = hi
	return scale
end

local Ocean = {}
Ocean.__index = Ocean

-- Quality presets: columns, strips (actors), rows per strip, and how often it's redrawn
-- (every frame, or every other frame on low).
Ocean.QUALITY = {
	high = { cols = 84, strips = 4, rows = 32, every = 1 },
	low = { cols = 56, strips = 2, rows = 38, every = 2 },
}

-- model: WaveModel; opts: { quality, parent, origin (studs), spot, water }
function Ocean.new(model, opts)
	local self = setmetatable({}, Ocean)
	self.model = model
	local Q = Ocean.QUALITY[opts.quality or "high"]
	self.Q = Q
	local C = Q.cols
	local R = Q.strips * (Q.rows - 1) + 1
	self.C, self.R = C, R
	self.rowsPerStrip = Q.rows
	self.xs, self.zs, self.co = table.create(C, 0), table.create(R, 0), table.create(C, 0)
	self.origin = opts.origin or Vector3.zero
	self.spot = opts.spot or "margaret"
	self.frame = 0
	self.sec = {}
	for k = 1, WAVE.slots do
		self.sec[k] = { H = table.create(C, 0), b = table.create(C, 0), kappa = table.create(C, 0), steep = table.create(C, 0), age = table.create(C, 0), Lf = table.create(C, 0), Lb = table.create(C, 0) }
	end

	local folder = Instance.new("Folder")
	folder.Name = "Ocean"
	folder.Parent = opts.parent or workspace
	self.folder = folder

	-- the open sea: four planes framing the patch
	self.far = {}
	for i = 1, 4 do
		local p = Instance.new("Part")
		p.Name = "OpenSea"
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.Size = Vector3.new(1000, 0.2, 1000)
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.Brick
		m.Parent = p
		p.Parent = folder
		self.far[i] = { part = p, mesh = m }
	end
	self:setWater(opts.water)

	-- the waves near the camera, each strip in its own actor
	self.actors = {}
	local template = script.Parent:WaitForChild("OceanWorker")
	for s = 1, Q.strips do
		local actor = Instance.new("Actor")
		actor.Name = "Strip" .. s
		local w = template:Clone()
		w.Parent = actor
		actor.Parent = folder
		w.Enabled = true
		local r0 = (s - 1) * (Q.rows - 1) + 1
		table.insert(self.actors, actor)
		task.spawn(function()
			while not actor:GetAttribute("Ready") do
				task.wait()
			end
			actor:SendMessage("init", { C = C, r0 = r0, r1 = r0 + Q.rows - 1, R = R })
		end)
	end
	return self
end

function Ocean:ready()
	for _, a in ipairs(self.actors) do
		if not a:GetAttribute("Built") then
			return false
		end
	end
	return true
end

-- The water's look: water = a spot's water (Spots).
function Ocean:setWater(water)
	self.water = water
	self.look = {
		color = water.surface,
		material = Enum.Material.Glass,
		transparency = water.transparency,
		reflectance = 0.15,
	}
	-- (Studio tuning: LineupWaterMaterial / Transparency / Reflectance override the look)
	if game:GetService("RunService"):IsStudio() then
		local m = workspace:GetAttribute("LineupWaterMaterial")
		if m then
			self.look.material = Enum.Material[m]
		end
		self.look.transparency = workspace:GetAttribute("LineupWaterTransparency") or self.look.transparency
		self.look.reflectance = workspace:GetAttribute("LineupWaterReflectance") or self.look.reflectance
	end
	for _, f in ipairs(self.far) do
		-- (open water is deep: nothing to see through it)
		f.part.Color = water.open
		f.part.Material = Enum.Material.SmoothPlastic
		f.part.Reflectance = 0
	end
end

function Ocean:setSpot(id, origin, water)
	self.spot = id
	self.origin = origin
	self:setWater(water)
end

-- (kept for the old interface: the Glass water takes its light from Roblox's own lighting)
function Ocean:setLight() end

function Ocean:setVisible(v)
	self.folder.Parent = if v then self.folder.Parent else nil
end

-- Recompute the lattice for the camera at (camX, camZ) (simulation metres).
function Ocean:updateGrid(camX, camZ)
	local model = self.model
	local camRow = camZ - WM.crestOffset(camX)
	local cores, peels = {}, {}
	for _, w in ipairs(model.waves) do
		if not w.active or w.H < 0.15 then
			continue
		end
		local S_ = w.S
		local d = max(0, abs(camRow - w.crestZ0) - 3 * S_)
		table.insert(cores, { c = w.crestZ0, S = S_, k = 1 + d / 35 })
		if w.tau > -2 then
			local px, bx = WM.peelPoints(w)
			local near = 1 + d / 30
			table.insert(peels, { x = px, k = near })
			table.insert(peels, { x = bx, k = near * 1.5 })
			if WAVE.breakWidth > 0 then
				for f = 0.25, 0.75, 0.25 do
					table.insert(peels, { x = bx + (px - bx) * f, k = near * 1.5 })
				end
			end
		end
	end
	local nc, np = #cores, #peels
	local function rowSpacing(z)
		local s = 0.15 + 0.07 * abs(z - camRow)
		for q = 1, nc do
			local c = cores[q]
			local u = (z - c.c) / c.S
			local outCurl = max(0, -0.3 - u, u - 0.85)
			local outCore = max(0, -1.7 - u, u - 2.3)
			local sc = c.S * (0.03 + 0.02 * min(1, outCurl / 0.35)) * c.k + 0.06 * outCore * c.S
			if sc < s then
				s = sc
			end
		end
		return min(s, 60)
	end
	local function colSpacing(x)
		local s = 0.3 + 0.07 * abs(x - camX)
		for q = 1, np do
			local p = peels[q]
			local sp = (0.4 + 0.06 * abs(x - p.x)) * p.k
			if sp < s then
				s = sp
			end
		end
		return min(s, 60)
	end
	-- (rows are crest-aligned: the patch's rows reach a little further so its curved edge
	-- still covers the square the open sea frames)
	local far = max(abs(camX - HALF), abs(camX + HALF))
	local coMin = -min(WAVE.curveMax, WAVE.curveK * far * far)
	self._rs = distribute(self.zs, self.R, camZ - HALF, camZ + HALF - coMin, rowSpacing, self._rs)
	self._cs = distribute(self.xs, self.C, camX - HALF, camX + HALF, colSpacing, self._cs)
end

-- Place the open sea round the patch at (camX, camZ).
function Ocean:placeFar(camX, camZ)
	local o = self.origin
	-- (a little overlap, so there's no gap at the seam, and half a metre down: where the
	-- patch's curved rows run out over it, it's under the water, not a sheet in it)
	local h = HALF - 2
	local y = o.Y - 0.5 * S
	local rects = {
		{ camX - FAR, camX + FAR, camZ + h, camZ + FAR }, -- toward the beach
		{ camX - FAR, camX + FAR, camZ - FAR, camZ - h }, -- out to sea
		{ camX - FAR, camX - h, camZ - h, camZ + h }, -- left and right
		{ camX + h, camX + FAR, camZ - h, camZ + h },
	}
	for i, r in ipairs(rects) do
		local f = self.far[i]
		local sx, sz = (r[2] - r[1]) * S, (r[4] - r[3]) * S
		f.mesh.Scale = Vector3.new(sx / 1000, 1, sz / 1000)
		f.part.CFrame = CFrame.new(o.X + (r[1] + r[2]) / 2 * S, y, o.Z + (r[3] + r[4]) / 2 * S)
	end
end

-- The surface for the camera at (camX, camY, camZ) (simulation metres). lead: how far
-- ahead to work it out (s): the workers' result shows a frame later.
function Ocean:update(camX, camY, camZ, lead)
	self.frame += 1
	if self.dead then
		return
	end
	-- (low quality: redrawn every other frame, a frame further ahead)
	if self.frame % self.Q.every ~= 0 then
		return
	end
	lead = (lead or 0) * self.Q.every
	local model = self.model
	self:updateGrid(camX, camZ)
	self:placeFar(camX, camZ)
	local C = self.C
	local xs, co = self.xs, self.co
	for i = 1, C do
		local x = xs[i]
		co[i] = -min(WAVE.curveMax, WAVE.curveK * x * x)
	end
	-- per wave, per column: the section state (WaveModel:section, less a pool's walls)
	local lfLo, lfHi, lbLo, lbHi = CURL.lfLo, CURL.lfHi, CURL.lbLo, CURL.lbHi
	local waves = {}
	for k, w in ipairs(model.waves) do
		if not w.active or w.H < 0.01 then
			continue
		end
		local sec = self.sec[k]
		local sH, sb, sk, sst, sag, sLf, sLb = sec.H, sec.b, sec.kappa, sec.steep, sec.age, sec.Lf, sec.Lb
		local spill = 1 - smoothstep(WAVE.spill[1], WAVE.spill[2], w.H)
		local tT = WAVE.tTube * (1 - 0.7 * spill)
		local tC = WAVE.tCollapse * (1 - 0.3 * spill)
		local tau = w.tau + lead
		for i = 1, C do
			local x = xs[i]
			local side = if w.dir == 0 then w.peakX - abs(x) else (x - w.peakX) * w.dir
			local age
			if side >= 0 then
				age = tau - max(side - WAVE.breakWidth, 0) / WAVE.peelSpeed
			else
				age = tau - max(-side - WAVE.backWidth, 0) / WAVE.backSpeed
			end
			local e = if side >= 0 then max(side - WAVE.peelFlat, 0) / WAVE.peelFall else side / WAVE.backFall
			local env = exp(-e * e)
			local kappa = max(smoothstep(tT, tT + tC, age), w.collapseG)
			local H = w.H * env * (1 - 0.5 * kappa)
			sH[i] = H
			sk[i] = kappa
			sb[i] = smoothstep(0, WAVE.tThrow, age) * smoothstep(0.05, 0.3, H / w.S) * (1 - 0.65 * spill)
			local steep = w.steepG * (0.55 + 0.45 * exp(-max(-age, 0) / 5))
			sst[i] = steep
			sag[i] = age
			sLf[i] = lfLo + (lfHi - lfLo) * steep
			sLb[i] = lbLo + (lbHi - lbLo) * steep
		end
		table.insert(waves, { crestZ0 = w.crestZ0 + lead * WAVE.speed, H = w.H, S = w.S, spill = spill, sec = sec })
	end
	local F = {
		C = C,
		R = self.R,
		xs = xs,
		zs = self.zs,
		co = co,
		waves = waves,
		time = model.time + lead,
		cam = { camX, camY, camZ },
		half = HALF,
		curl = { rin = CURL.rin, yc = CURL.yc, ex = CURL.ex, sweep = CURL.sweep, acoshYc = CURL.acoshYc, trough = CURL.trough, lip = CURL.lip },
		wave = { tThrow = WAVE.tThrow, pool = WAVE.pool },
		origin = self.origin,
		look = self.look,
	}
	-- (every strip that's built: one still waiting for room mustn't hold up the rest)
	for _, a in ipairs(self.actors) do
		if a:GetAttribute("Built") then
			a:SendMessage("frame", F)
		end
	end
end

-- Let go of everything. The strips free their meshes first (an actor that's simply destroyed
-- keeps its mesh's share of the client's budget until it's collected, and the new ocean needs
-- it now); the folder goes once they have, or after a second at most.
function Ocean:destroy()
	self.dead = true
	for _, a in ipairs(self.actors) do
		a:SendMessage("destroy")
	end
	local folder, actors = self.folder, self.actors
	task.spawn(function()
		local t0 = os.clock()
		while os.clock() - t0 < 1 do
			local all = true
			for _, a in ipairs(actors) do
				if not a:GetAttribute("Freed") and a:GetAttribute("Built") then
					all = false
				end
			end
			if all then
				break
			end
			task.wait()
		end
		folder:Destroy()
	end)
end

-- Is a strip still waiting for room for its mesh?
function Ocean:waiting()
	for _, a in ipairs(self.actors) do
		if a:GetAttribute("Waiting") and not a:GetAttribute("Built") then
			return true
		end
	end
	return false
end

-- How many strips are drawing (for checks).
function Ocean:builtCount()
	local n = 0
	for _, a in ipairs(self.actors) do
		if a:GetAttribute("Built") then
			n += 1
		end
	end
	return n, #self.actors
end

return Ocean
