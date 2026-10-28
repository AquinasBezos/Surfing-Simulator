--!native
-- Breaking-wave model (port of js/wave.js), shared by the ocean mesh (Ocean) and the
-- physics (Surfer). Coordinates (metres, in the spot's own frame):
--   x : along the beach            z : toward the beach (waves travel +z)
-- A surface point is addressed by its rest position (x, zr). Its crest-relative coordinate
-- is u = zr - crestOffset(x) - crestZ0.

local Config = require(script.Parent.Config)
local WAVE = Config.WAVE
local WAVE_HEIGHTS = Config.WAVE_HEIGHTS
local GRAVITY = Config.GRAVITY

local exp, sqrt, abs, max, min, floor = math.exp, math.sqrt, math.abs, math.max, math.min, math.floor
local sin, cos, atan2, pi = math.sin, math.cos, math.atan2, math.pi

local M = {}

local function clamp(v, a, b)
	return if v < a then a elseif v > b then b else v
end
local function mix(a, b, t)
	return a + (b - a) * t
end
local function smoothstep(a, b, x)
	local t = (x - a) / (b - a)
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return t * t * (3 - 2 * t)
end
local function sech2(x)
	if x > 40 then
		x = 40
	elseif x < -40 then
		x = -40
	end
	local c = math.cosh(x)
	return 1 / (c * c)
end
local function acosh(x)
	return math.log(x + sqrt(x * x - 1))
end
M.clamp, M.mix, M.smoothstep, M.sech2, M.acosh = clamp, mix, smoothstep, sech2, acosh

-- deterministic hash in [0, 1) of (seed, k): the same on every client
local function hash01(seed, k)
	return Random.new((seed * 7919 + k * 104729 + 1013904223) % 2147483647):NextNumber()
end
M.hash01 = hash01

function M.waveScale(height)
	return max(height, WAVE_HEIGHTS.minScale)
end

-- Height of wave number k for a heights setting { mode = "set" | "random", height }.
function M.waveHeight(seed, k, cfg, range)
	range = range or WAVE_HEIGHTS
	local jitter = 1 + 0.06 * (hash01(seed, k) * 2 - 1)
	if not cfg or cfg.mode ~= "random" then
		local h = if cfg and cfg.height then cfg.height else range.default
		return clamp(h, range.min, range.max) * jitter
	end
	local span = 12
	local i = floor(k / span)
	local f = k / span - i
	local a = hash01(seed + 0x51ed27, i)
	local b = hash01(seed + 0x51ed27, i + 1)
	local n = a + (b - a) * f * f * (3 - 2 * f)
	return mix(range.randomMin, range.randomMax, n) * jitter
end

-- Curl (barrel) shape, normalised by the wave scale: the spot's (see applySpotWave).
local CURL = {
	rin = 0.4,
	yc = 0.4,
	ex = 1.12,
	sweep = 3.92699,
	yb0 = 0.45,
	acoshYc = 1.03172,
	lfLo = 1.25,
	lfHi = 0.55,
	lbLo = 2.2,
	lbHi = 1.6,
	trough = 0,
	lip = 0.42,
	tip = 0,
	tipShift = 0,
}
M.CURL = CURL

local function lipTip(c)
	local zc = c.lfHi * c.acoshYc + c.rin * c.ex
	return zc + c.ex * (c.rin * 1.22 + 0.04) * cos(pi - c.sweep)
end
local TIP0 = lipTip(CURL)
CURL.tip = TIP0

local WAVE_BASE = table.clone(WAVE)

-- A pool is a kite: back corner (0, bz), side corners (+-sx, sz), front corner (0, fz), with
-- a pier along x = 0. Each edge as a line n . (|x|, z) = c with n pointing into the pool.
function M.poolEdges(P)
	local function edge(ax, az, bx, bz, cx, cz)
		local nx, nz = -(bz - az), bx - ax
		local l = sqrt(nx * nx + nz * nz)
		nx /= l
		nz /= l
		if nx * (cx - ax) + nz * (cz - az) < 0 then
			nx, nz = -nx, -nz
		end
		return { nx, nz, nx * ax + nz * az }
	end
	local mid = (P.bz + P.fz) / 2
	local out = table.clone(P)
	out.back = edge(0, P.bz, P.sx, P.sz, 0, mid)
	out.front = edge(P.sx, P.sz, 0, P.fz, 0, mid)
	return out
end

-- Make `spot` the one being played.
function M.applySpotWave(spot)
	local w = spot.wave
	for k in pairs(WAVE) do
		WAVE[k] = nil
	end
	for k, v in pairs(WAVE_BASE) do
		WAVE[k] = v
	end
	for k, v in pairs(w) do
		if k ~= "curl" then
			WAVE[k] = v
		end
	end
	if WAVE.pool then
		WAVE.pool = M.poolEdges(WAVE.pool)
	end
	for k, v in pairs(spot.heights) do
		WAVE_HEIGHTS[k] = v
	end
	local c = w.curl
	CURL.rin, CURL.yc, CURL.ex, CURL.sweep = c.rin, c.yc, c.ex, c.sweep
	CURL.acoshYc = acosh(1 / sqrt(c.yc))
	CURL.lfLo, CURL.lfHi = c.lf[1], c.lf[2]
	CURL.lbLo, CURL.lbHi = c.lb[1], c.lb[2]
	CURL.trough, CURL.lip = c.trough, c.lip
	CURL.tip = lipTip(CURL)
	CURL.tipShift = CURL.tip - TIP0
end

-- How far inside the pool's walls (m; negative outside). math.huge when there's no pool.
function M.poolInside(x, z, P)
	P = P or WAVE.pool
	if not P then
		return math.huge
	end
	local ax = abs(x)
	return min(P.back[1] * ax + P.back[2] * z - P.back[3], P.front[1] * ax + P.front[2] * z - P.front[3])
end

function M.poolMask(x, z)
	local P = WAVE.pool
	if not P then
		return 1
	end
	return clamp(M.poolInside(x, z, P) / P.fadeWall, 0, 1) * clamp((abs(x) - P.pier) / P.fadePier, 0, 1)
end

local function crestOffset(x)
	return -min(WAVE.curveMax, WAVE.curveK * x * x)
end
M.crestOffset = crestOffset

-- Normalised base (unbroken) profile. Returns normalised height, Lf, Lb.
local function baseProfile(un, steep)
	local Lf = mix(CURL.lfLo, CURL.lfHi, steep)
	local Lb = mix(CURL.lbLo, CURL.lbHi, steep)
	if un >= 0 then
		local t = (un - 2.2 * Lf) / (1.3 * Lf)
		local y = sech2(un / Lf) - 0.13 * steep * exp(-t * t) * smoothstep(0, Lf, un)
		if CURL.trough > 0 then
			local d = (un - 1.7 * Lf) / (1.2 * Lf)
			y -= CURL.trough * steep * exp(-d * d) * smoothstep(0, Lf, un)
		end
		return y, Lf, Lb
	end
	return 0.8 * sech2(un / Lb) + 0.2 * sech2(un / (3.5 * Lb)), Lf, Lb
end
M.baseProfile = baseProfile

local function peelSide(w, x)
	return if w.dir == 0 then w.peakX - abs(x) else (x - w.peakX) * w.dir
end
M.peelSide = peelSide

function M.profileWindow(un)
	return smoothstep(-16, -9, un) * (1 - smoothstep(4.5, 7, un))
end

local function sectionAge(tau, side)
	if side >= 0 then
		return tau - max(side - WAVE.breakWidth, 0) / WAVE.peelSpeed
	end
	return tau - max(-side - WAVE.backWidth, 0) / WAVE.backSpeed
end
M.sectionAge = sectionAge

-- Where the breaking point has got to on the peel side, and on the other side.
function M.peelPoints(w, tau)
	tau = tau or max(w.tau, 0)
	if w.dir == 0 then
		local x = max(0, w.peakX - WAVE.breakWidth - WAVE.peelSpeed * tau)
		return x, -x
	end
	local d = w.dir
	return w.peakX + d * (WAVE.breakWidth + WAVE.peelSpeed * tau), w.peakX - d * (WAVE.backWidth + WAVE.backSpeed * tau)
end

local WaveModel = {}
WaveModel.__index = WaveModel
M.WaveModel = WaveModel

function WaveModel.new()
	local self = setmetatable({}, WaveModel)
	self.time = 0
	self.waves = {}
	for i = 1, WAVE.slots do
		self.waves[i] = {
			slot = i,
			active = false,
			id = nil,
			crestZ0 = 0,
			peakX = 0,
			dir = 1,
			height = 2.5,
			tau = -1e3,
			H = 0,
			S = 2.5,
			steepG = 0,
			collapseG = 0,
			fade = 0,
		}
	end
	self.seed = 1
	self.clock = function()
		return 0
	end
	self.heights = { mode = "set", height = WAVE_HEIGHTS.default }
	self.onSpawn = nil
	self._sec = { H = 0, S = 1, b = 0, kappa = 0, steep = 0, age = 0, spill = 0 }
	self.swell = {}
	for i, c in ipairs(Config.SWELL) do
		local a = math.rad(c[1])
		local k = 2 * pi / c[2]
		self.swell[i] = {
			dx = sin(a),
			dz = cos(a),
			amp = c[3],
			k = k,
			lambda = c[2],
			horiz = c[4] * c[3],
			omega = sqrt(GRAVITY * k),
			phase = ((i - 1) * 2.399) % (2 * pi),
		}
	end
	return self
end

-- Waves are a pure function of (seed, shared time) so every client sees the same set.
-- clock(): the shared time in seconds; heights: { mode, height, fromK, prev } (from wave
-- fromK on; `prev` before it).
function WaveModel:setSchedule(seed, clock, heights)
	self.seed = seed
	self.clock = clock
	self.heights = heights or self.heights
	for _, w in ipairs(self.waves) do
		w.active = false
		w.id = nil
	end
	self:_applySchedule()
end

function WaveModel:setHeights(heights)
	self.heights = heights
end

function WaveModel:_derive(w)
	local c = w.crestZ0
	w.tau = (c - WAVE.breakZ) / WAVE.speed
	w.fade = smoothstep(WAVE.spawnZ, WAVE.spawnZ + 25, c) * (1 - smoothstep(WAVE.dieStartZ, WAVE.dieEndZ, c))
	local shoal = smoothstep(WAVE.shoalFrom, WAVE.breakZ, c)
	w.H = w.height * (WAVE.shoalBase + (1 - WAVE.shoalBase) * shoal) * w.fade
	w.steepG = smoothstep(WAVE.steepFrom, WAVE.breakZ - 4, c)
	w.collapseG = smoothstep(WAVE.dieStartZ - 25, WAVE.dieStartZ + 12, c)
end

function WaveModel:_applySchedule()
	local seed = self.seed
	local t = self.clock()
	self.time = t
	local P = WAVE.spacing / WAVE.speed
	local kNow = floor(t / P)
	local n = #self.waves
	for k = kNow, kNow - n + 1, -1 do
		local w = self.waves[(k % n) + 1]
		local crest = WAVE.spawnZ + WAVE.speed * (t - k * P)
		if crest > WAVE.dieEndZ then
			w.active = false
			continue
		end
		if w.id ~= k then
			local r = Random.new((seed * 31 + k * 2654435761) % 2147483647)
			w.id = k
			w.peakX = (r:NextNumber() * 2 - 1) * WAVE.peakSpread
			w.dir = if r:NextNumber() < 0.5 then 1 else -1
			if WAVE.dir ~= 0 then
				w.dir = WAVE.dir
			end
			if WAVE.mirror ~= 0 then
				w.peakX += WAVE.mirror
				w.dir = 0
			end
			local hs = self.heights
			local cfg = if hs and hs.prev and hs.fromK and k < hs.fromK then hs.prev else hs
			w.height = M.waveHeight(seed, k, cfg)
			w.S = M.waveScale(w.height)
			w.active = true
			w.crestZ0 = crest
			self:_derive(w)
			if self.onSpawn then
				self.onSpawn(w)
			end
		end
		w.active = true
		w.crestZ0 = crest
		self:_derive(w)
	end
end

function WaveModel:update(_dt)
	self:_applySchedule()
end

-- Along-crest state of wave w at x (and, in a pool, world z).
function WaveModel:section(w, x, z, out)
	out = out or self._sec
	local side = peelSide(w, x)
	local age = sectionAge(w.tau, side)
	local e = if side >= 0 then max(side - WAVE.peelFlat, 0) / WAVE.peelFall else side / WAVE.backFall
	local env = exp(-e * e)
	local spill = 1 - smoothstep(WAVE.spill[1], WAVE.spill[2], w.H)
	local tT = WAVE.tTube * (1 - 0.7 * spill)
	local kappa = max(smoothstep(tT, tT + WAVE.tCollapse * (1 - 0.3 * spill), age), w.collapseG)
	out.H = w.H * env * (1 - 0.5 * kappa) * M.poolMask(x, z or 0)
	out.S = w.S
	out.b = smoothstep(0, WAVE.tThrow, age) * smoothstep(0.05, 0.3, out.H / out.S) * (1 - 0.65 * spill)
	out.spill = spill
	out.kappa = kappa
	out.steep = w.steepG * mix(0.55, 1, exp(-max(-age, 0) / 5))
	out.age = age
	return out
end

-- Curl a normalised base point (un, yb) of a section with breaking amount b; as it
-- collapses (c 0 -> 1) the tube is squashed down into a low mound of whitewater.
-- Returns the curled normalised position zn, yn (and kr, s for shading).
local function curlNorm(un, yb, b, Lf, c)
	local zn, yn = un, yb
	local rin, yc, ex, sweep, yb0, acoshYc = CURL.rin, CURL.yc, CURL.ex, CURL.sweep, CURL.yb0, CURL.acoshYc
	local zc = Lf * acoshYc + rin * ex
	local sF = if un >= 0 then clamp((yb - yc) / (1 - yc), 0, 1) else 0
	local sB = if un < 0 then clamp((yb - yb0) / (1 - yb0), 0, 1) else 0
	local s = max(sF, sB)
	local kr = 0
	if s > 0 and b > 0 then
		local lipThick = 0.04 + CURL.lip * (1 - s) ^ 1.5
		local dz = (un - zc) / ex
		local dy = yb - yc
		local phiB = atan2(dy, dz)
		local rB = sqrt(dz * dz + dy * dy)
		local phiT = pi - s * sweep
		local rT = rin * (1 + 0.22 * s * s)
		local wgt
		if un >= 0 then
			wgt = smoothstep(0, 0.35, s)
		else
			rT += lipThick
			wgt = smoothstep(0, 0.55, s)
		end
		phiT = mix(phiB, phiT, wgt)
		rT = mix(rB, rT, wgt)
		local k = smoothstep(0, 1, b * 1.5 - (1 - s) * 0.5)
		kr = smoothstep(0, 1, b * 2.4 - (1 - s) * 0.9)
		local phi = mix(phiB, phiT, k)
		local r = mix(rB, rT, kr)
		zn = zc + ex * r * cos(phi)
		yn = (yc + r * sin(phi)) * (1 - 0.45 * (c or 0) * wgt * kr)
	end
	return zn, yn, kr, s
end
M.curlNorm = curlNorm

-- Height (world y) of the underside of the curling lip directly above world point (x, z),
-- ignoring anything below yMin. math.huge when no lip is overhead.
function WaveModel:tubeCeiling(w, x, z, yMin)
	local sc = self:section(w, x, z, {})
	if sc.b < 0.25 or sc.H < 0.6 then
		return math.huge
	end
	local S, H, b, steep = sc.S, sc.H, sc.b, sc.steep
	local target = (z - crestOffset(x) - w.crestZ0) / S
	local _, Lf = baseProfile(0, steep)
	local ufc = Lf * CURL.acoshYc
	local best = math.huge
	local pz, py = 0, 0
	local N = 40
	for i = 0, N do
		local un = ufc * (1 - i / N)
		local yb = baseProfile(un, steep)
		local zn, yn = curlNorm(un, yb, b, Lf, sc.kappa)
		if i > 0 and (pz - target) * (zn - target) <= 0 and pz ~= zn then
			local t = (target - pz) / (zn - pz)
			local y = (py + (yn - py) * t) * H
			if y > yMin and y < best then
				best = y
			end
		end
		pz, py = zn, yn
	end
	return best
end

-- Full displaced surface point of wave w (including the curl) for rest coords (x, rowZ).
function WaveModel:curlPoint(w, x, rowZ, out)
	out = out or {}
	local sc = self:section(w, x, rowZ + crestOffset(x), {})
	local S = sc.S
	local u = rowZ - w.crestZ0
	local un = u / S
	local yb, Lf = baseProfile(un, sc.steep)
	local zn, yn = curlNorm(un, yb, sc.b, Lf, sc.kappa)
	out.x = x
	out.y = yn * sc.H
	out.z = rowZ + crestOffset(x) + (zn * S - u)
	out.b, out.kappa, out.H, out.age = sc.b, sc.kappa, sc.H, sc.age
	return out
end

-- Gerstner swell displacement at rest position (x, z). dist = distance to camera for LOD.
function WaveModel:swellAt(x, z, t, dist)
	local ox, oy, oz = 0, 0, 0
	for _, c in ipairs(self.swell) do
		local f = 1 - smoothstep(c.lambda * 4, c.lambda * 9, dist)
		if f <= 0 then
			continue
		end
		local th = c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase
		local a = c.amp * f
		oy += a * sin(th)
		local h = c.horiz * f * cos(th)
		ox += c.dx * h
		oz += c.dz * h
	end
	return ox, oy, oz
end

-- Smooth (no curl) surface height used by the physics, with per-wave details written into
-- `out`: height, waterVz, and the dominant wave's wave/un/u/yb/H/S/b/kappa/age/steep.
-- (fromX, fromZ: where the search for the swell's sideways shift starts; steps: how many.)
function WaveModel:sample(x, z, out, fromX, fromZ, steps)
	steps = steps or 3
	local t = self.time
	local rx, rz = x, z
	if fromX then
		rx, rz = x - fromX, z - fromZ
	end
	local sx, sy, sz
	for _ = 1, steps do
		sx, sy, sz = self:swellAt(rx, rz, t, 0)
		rx, rz = x - sx, z - sz
	end
	sx, sy, sz = self:swellAt(rx, rz, t, 0)
	out.shiftX, out.shiftZ = sx, sz
	local h = sy
	local rowZ = rz - crestOffset(rx)
	local best, bestVal = nil, -1
	out.waterVz = 0
	local sc = self._sec
	for _, w in ipairs(self.waves) do
		if not w.active or w.H < 0.01 then
			continue
		end
		self:section(w, rx, rz, sc)
		local u = rowZ - w.crestZ0
		local un = u / sc.S
		if un < -16 or un > 7 then
			continue
		end
		local yb = baseProfile(un, sc.steep) * M.profileWindow(un)
		h += yb * sc.H
		local hn = sc.H / sc.S
		local orb = 0.75 * clamp(yb, 0, 1) ^ 2.2 * min(hn, 1) * (0.4 + 0.6 * sc.steep)
		local bore = sc.kappa * smoothstep(-0.6, 0.2, un) * smoothstep(2.6, 1.0, un) * min(hn * 1.6, 1)
		out.waterVz += WAVE.speed * max(orb, bore)
		local val = if abs(un) < 4 then 10 - abs(un) else yb
		if val > bestVal then
			bestVal = val
			best = w
			out.wave = w
			out.un, out.u, out.yb = un, u, yb
			out.H, out.S, out.b, out.kappa, out.age, out.steep = sc.H, sc.S, sc.b, sc.kappa, sc.age, sc.steep
		end
	end
	if not best then
		out.wave = nil
		out.un, out.u, out.yb, out.H, out.S, out.b, out.kappa, out.age, out.steep = 99, 999, 0, 0, 1, 0, 0, -99, 0
	end
	if WAVE.current then
		local C = WAVE.current
		out.waterVz -= C.speed * smoothstep(C.half, C.half * 0.35, abs(rx)) * smoothstep(0, 10, M.poolInside(rx, rz))
	end
	out.height = h
	return out
end

local _tmp = {}
function WaveModel:heightAt(x, z)
	return self:sample(x, z, _tmp).height
end

-- heightAt for a point near one whose swell shift (sx, sz) is known: the search can start
-- there and take fewer steps.
local _tmpN = {}
function WaveModel:heightNear(x, z, sx, sz, steps)
	return self:sample(x, z, _tmpN, sx, sz, steps or 1).height
end

return M
