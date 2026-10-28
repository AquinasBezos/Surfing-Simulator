--!native
-- Ocean surface (port of js/ocean.js and js/oceanGrid.js). Roblox has no custom shaders,
-- so what the web version does on the GPU happens on the CPU each frame:
--   * an adaptive lattice (cols x rows) whose column x and row z positions are recomputed
--     every frame, so vertices cluster at the camera, the crest and the breaking point
--     (here, on the main thread: it's cheap);
--   * every vertex displaced by the breaking waves (profile + curling lip) and the swell,
--     and the water's look baked into vertex colours (OceanCore), worked out in parallel by
--     one OceanWorker actor per strip of rows. EditableMesh allows 20,000 triangles a mesh,
--     so the strips are separate meshes anyway.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(script.Parent.Config)
local WM = require(script.Parent.WaveModel)

local WAVE = Config.WAVE
local CURL = WM.CURL

local exp, sqrt, abs, max, min = math.exp, math.sqrt, math.abs, math.max, math.min

local WORLD_RADIUS = 5000

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

-- Quality presets: columns, strips (actors) and rows per strip. (The engine's cost of
-- taking the changed mesh each frame, about a microsecond a vertex, sets the budget.)
Ocean.QUALITY = {
	high = { cols = 100, strips = 6, rows = 34 },
	low = { cols = 76, strips = 4, rows = 33 },
}

-- model: WaveModel; opts: { quality, parent, water, origin (studs), spot }
function Ocean.new(model, opts)
	local self = setmetatable({}, Ocean)
	self.model = model
	local Q = Ocean.QUALITY[opts.quality or "high"]
	local C = Q.cols
	local R = Q.strips * (Q.rows - 1) + 1
	self.C, self.R = C, R
	self.rowsPerStrip = Q.rows
	self.xs, self.zs, self.co = table.create(C, 0), table.create(R, 0), table.create(C, 0)
	self.origin = opts.origin or Vector3.zero
	self.water = opts.water
	self.spot = opts.spot or "margaret"
	self.frame = 0
	-- (the strips write their colours every other frame, taking turns; on low quality only
	-- every other one of those)
	self.colorEvery = if opts.quality == "low" then 2 else 1
	self.visible = true
	self.sun = { -0.36, 0.6, -0.71 }
	self.sunCol = { 1, 0.95, 0.86 }
	self.amb = { 0.85, 0.85, 0.85 }
	self.sky = { { 0.25, 0.5, 0.78 }, { 0.75, 0.82, 0.89 } }
	self.sec = {}
	for k = 1, WAVE.slots do
		self.sec[k] = { H = table.create(C, 0), b = table.create(C, 0), kappa = table.create(C, 0), steep = table.create(C, 0), age = table.create(C, 0), Lf = table.create(C, 0), Lb = table.create(C, 0) }
	end

	-- the strips, each in its own actor
	local folder = Instance.new("Folder")
	folder.Name = "Ocean"
	folder.Parent = opts.parent or workspace
	self.folder = folder
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

function Ocean:setWater(water)
	self.water = water
end

function Ocean:setSpot(id, origin, water)
	self.spot = id
	self.origin = origin
	self.water = water
end

local function c3(c)
	return { c.R, c.G, c.B }
end

-- The water is drawn unlit (its colours are what you see), so it takes the light itself:
-- the sun's direction and colour, the sky's colours, and how bright the water's body is lit.
function Ocean:setLight(sunDir, sunColor, zenith, horizon, ambient)
	self.sun = { sunDir.X, sunDir.Y, sunDir.Z }
	self.sunCol = c3(sunColor)
	self.sky = { c3(zenith), c3(horizon) }
	self.amb = c3(ambient)
end

function Ocean:setVisible(v)
	self.visible = v
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
		local S = w.S
		local d = max(0, abs(camRow - w.crestZ0) - 3 * S)
		table.insert(cores, { c = w.crestZ0, S = S, k = 1 + d / 35 })
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
		local s = 0.1 + 0.06 * abs(z - camRow)
		for q = 1, nc do
			local c = cores[q]
			local u = (z - c.c) / c.S
			local outCurl = max(0, -0.3 - u, u - 0.85)
			local outCore = max(0, -1.7 - u, u - 2.3)
			local sc = c.S * (0.026 + 0.018 * min(1, outCurl / 0.35)) * c.k + 0.06 * outCore * c.S
			if sc < s then
				s = sc
			end
		end
		return min(s, 380)
	end
	local function colSpacing(x)
		local s = 0.25 + 0.06 * abs(x - camX)
		for q = 1, np do
			local p = peels[q]
			local sp = (0.35 + 0.055 * abs(x - p.x)) * p.k
			if sp < s then
				s = sp
			end
		end
		return min(s, 380)
	end
	self._rs = distribute(self.zs, self.R, -WORLD_RADIUS, WORLD_RADIUS, rowSpacing, self._rs)
	self._cs = distribute(self.xs, self.C, camX - WORLD_RADIUS, camX + WORLD_RADIUS, colSpacing, self._cs)
end

-- The whole surface, for the camera at (camX, camY, camZ) (simulation metres). lead: how
-- far ahead to work it out (s): the workers' result shows a frame later.
function Ocean:update(camX, camY, camZ, lead)
	if not self:ready() then
		return
	end
	local model = self.model
	self:updateGrid(camX, camZ)
	local C = self.C
	local xs, co = self.xs, self.co
	for i = 1, C do
		local x = xs[i]
		co[i] = -min(WAVE.curveMax, WAVE.curveK * x * x)
	end
	-- per wave, per column: the section state (WaveModel:section, less a pool's walls)
	local lfLo, lfHi, lbLo, lbHi = CURL.lfLo, CURL.lfHi, CURL.lbLo, CURL.lbHi
	local waves = {}
	local dtau = (lead or 0) * WAVE.speed
	for k, w in ipairs(model.waves) do
		if not w.active or w.H < 0.01 then
			continue
		end
		local sec = self.sec[k]
		local sH, sb, sk, sst, sag, sLf, sLb = sec.H, sec.b, sec.kappa, sec.steep, sec.age, sec.Lf, sec.Lb
		local spill = 1 - smoothstep(WAVE.spill[1], WAVE.spill[2], w.H)
		local tT = WAVE.tTube * (1 - 0.7 * spill)
		local tC = WAVE.tCollapse * (1 - 0.3 * spill)
		local tau = w.tau + (lead or 0)
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
		table.insert(waves, { crestZ0 = w.crestZ0 + dtau, H = w.H, S = w.S, spill = spill, sec = sec })
	end
	self.frame += 1
	local wa = self.water
	local F = {
		C = C,
		R = self.R,
		xs = xs,
		zs = self.zs,
		co = co,
		waves = waves,
		time = model.time + (lead or 0),
		cam = { camX, camY, camZ },
		spot = self.spot,
		curl = { rin = CURL.rin, yc = CURL.yc, ex = CURL.ex, sweep = CURL.sweep, acoshYc = CURL.acoshYc, trough = CURL.trough, lip = CURL.lip },
		wave = { tThrow = WAVE.tThrow, speed = WAVE.speed, pool = WAVE.pool },
		water = { deep = c3(wa.deep), shallow = c3(wa.shallow), glow = c3(wa.glow) },
		sun = self.sun,
		sunCol = self.sunCol,
		amb = self.amb,
		sky = self.sky,
		origin = self.origin,
		colour = (self.frame % self.colorEvery) == 0,
		visible = self.visible,
	}
	-- The strips near the camera are worked out every frame; the far ones (distant, mostly
	-- flat water) every third, taking turns: what the engine costs is per vertex changed.
	local camRow = camZ - WM.crestOffset(camX)
	local zs, rows = self.zs, self.rowsPerStrip
	for s, a in ipairs(self.actors) do
		local r0 = (s - 1) * (rows - 1) + 1
		local r1 = r0 + rows - 1
		local near = camRow > zs[r0] - 120 and camRow < zs[r1] + 120
		if near or (self.frame + s) % 3 == 0 then
			a:SendMessage("frame", F)
		end
	end
end

function Ocean:destroy()
	self.folder:Destroy()
end

return Ocean
