--!native
-- Board physics and the prone / pop-up / standing / wipeout state machine (port of
-- js/surfer.js). Units are metres in the spot's frame; rotations are CFrames (rotation
-- only) where the web version used quaternions.
--
-- The board rides on the smooth (un-curled) wave surface. Gravity acts along the slope,
-- water drag acts relative to the moving water (orbital velocity on the wave face, the
-- push of whitewater), and the fins convert sideways slip into forward speed (carving).
-- On top of that: effort-based paddling, duck dives, crouching, leg-extension pops and
-- airs, walking on a longboard, and snap / cutback / tailslide manoeuvres.

local Config = require(script.Parent.Config)
local WaveModelM = require(script.Parent.WaveModel)
local Board = require(script.Parent.Board)

local GRAVITY = Config.GRAVITY
local WAVE = Config.WAVE
local WAVE_HEIGHTS = Config.WAVE_HEIGHTS
local BOARDS = Config.BOARDS
local CURL = WaveModelM.CURL

local clamp, mix, smoothstep = WaveModelM.clamp, WaveModelM.mix, WaveModelM.smoothstep
local exp, abs, max, min, sqrt, sin, cos, atan, pi = math.exp, math.abs, math.max, math.min, math.sqrt, math.sin, math.cos, math.atan, math.pi
local DEG = pi / 180

local STATE = { PRONE = "prone", POPUP = "popup", STANDING = "standing", WIPEOUT = "wipeout", SITTING = "sitting" }

local POPUP_TIME = 0.42
local XAXIS, ZAXIS = Vector3.xAxis, Vector3.zAxis

local function moveToward(v, t, d)
	return if v < t then min(t, v + d) else max(t, v - d)
end
local function sign(x)
	return if x > 0 then 1 elseif x < 0 then -1 else 0
end

-- where along the board (0 tail .. 1 nose) it's checked against the water as it's drawn
local RIDE_T = { 0.03, 0.2, 0.4, 0.6, 0.75, 0.87, 0.95, 1 }

-- Backflips (see js/surfer.js)
local FLIP_PIVOT = 0.8
local FLIP_RELEASE, FLIP_SPIN, FLIP_POP, FLIP_LAND = 0.45, 11, 2.2, 2 * pi - 0.6

-- The least change to the drawn board that keeps it out of the water: a turn about its
-- middle (phi, + nose up) and a lift (dy >= 0). Ternary search on a convex cost.
local RIDE_W, RIDE_PHI, RIDE_DY = 4, 0.9, 0.3
local function solveRide(need, k, n)
	local function lift(phi)
		local dy = 0
		for i = 1, n do
			dy = max(dy, need[i] - k[i] * phi)
		end
		return dy
	end
	local function cost(phi)
		local dy = lift(phi)
		return RIDE_W * dy + 20 * dy * dy + abs(phi) + 2 * phi * phi + (if dy > RIDE_DY then 100 * (dy - RIDE_DY) else 0)
	end
	local a, b = -RIDE_PHI, RIDE_PHI
	for _ = 1, 32 do
		local m1, m2 = a + (b - a) / 3, b - (b - a) / 3
		if cost(m1) < cost(m2) then
			b = m2
		else
			a = m1
		end
	end
	local phi = (a + b) / 2
	return phi, min(RIDE_DY, lift(phi))
end

local Surfer = {}
Surfer.__index = Surfer
Surfer.STATE = STATE
Surfer.FLIP_PIVOT = FLIP_PIVOT

function Surfer.new(model)
	local self = setmetatable({}, Surfer)
	self.model = model
	self.board = BOARDS.shortboard
	self.boardType = "shortboard"
	self.x, self.y, self.z = 0, 0, -5
	self.vx, self.vy, self.vz = 0, 0, 0
	self.yaw = 0 -- forward = (-sin yaw, -cos yaw)
	self.state = STATE.PRONE
	self.stateTime = 0
	self.leanX, self.leanZ = 0, 0
	self.braceX, self.braceZ = 0, 0
	self.knockX, self.knockZ = 0, 0
	self.crouch = 0
	self.legCrouch, self.stanceCrouch = 0, 0
	self.footPos = 0
	self.charge = 0
	self.move = nil
	self.roll, self.pitch = 0, 0
	self.yawRate = 0
	self.paddleEffort = 0
	self.air = false
	self.airTime = 0
	self.popVel = 0
	self.diving = false
	self.diveDepth, self.diveRate, self.diveT, self.diveCool = 0, 0, 0, 0
	self.turtle, self.turtleT = 0, 0
	self.flip, self.flipArm = nil, nil
	self.flipRest, self.flipGrab = 0, 0
	self.upFlickT, self.upFlickPower = 9, 0
	self.quatBase = CFrame.identity
	self.quat = CFrame.identity
	self.effPitch, self.ledgePitch = 0, 0
	self.ride = { tilt = 0, lift = 0 }
	self.pearlT, self.lipT = 0, 0
	self.ceiling = math.huge
	self.normal = Vector3.yAxis
	self.normalBoard = Vector3.yAxis
	self.position = Vector3.zero
	self.flipShift = Vector3.zero
	self.s = {}
	self.wipeReason = ""
	self.inTube = false
	self.riding = false
	self.catching = false
	self.onWhitewater = false
	self.onEvent = nil
	self.collide = nil
	self.tumble = 0
	self.lastStroke = 9
	self._slow = 0
	self._gx, self._gz = 0, 0
	self.crouchHeld = false
	self.snapHeld = false
	self._need, self._k, self._hs = table.create(#RIDE_T, 0), table.create(#RIDE_T, 0), table.create(#RIDE_T, 0)
	return self
end

function Surfer:setBoard(kind)
	self.board = BOARDS[kind] or BOARDS.shortboard
	self.boardType = if BOARDS[kind] then kind else "shortboard"
	self.footPos = 0
end

function Surfer:speed()
	return sqrt(self.vx * self.vx + self.vz * self.vz)
end
-- how fast the board moves through the water (the sea: over the ground, as tuned)
function Surfer:planeSpeed()
	return sqrt(self.vx * self.vx + self.vz * self.vz)
end
function Surfer:forward()
	return -sin(self.yaw), -cos(self.yaw)
end

function Surfer:emit(kind, data)
	if self.onEvent then
		self.onEvent(kind, data or {})
	end
end

function Surfer:reset(x, z, yaw)
	self.x, self.z = x, z
	self.vx, self.vy, self.vz = 0, 0, 0
	self.yaw = yaw
	self.yawRate = 0
	self.leanX, self.leanZ, self.crouch, self.footPos, self.charge = 0, 0, 0, 0, 0
	self.braceX, self.braceZ, self.knockX, self.knockZ = 0, 0, 0, 0
	self.legCrouch, self.stanceCrouch = 0, 0
	self.roll, self.pitch = 0, 0
	self.tumble = 0
	self.move = nil
	self.air = false
	self.airTime = 0
	self.popVel = 0
	self.diving = false
	self.diveDepth, self.diveRate = 0, 0
	self.turtle = 0
	self.flip, self.flipArm = nil, nil
	self.flipRest, self.flipGrab = 0, 0
	self.pearlT, self.lipT = 0, 0
	self.ledgePitch = 0
	self.paddleEffort = 0
	self:setState(STATE.PRONE)
	self.stateTime = 0
	self.inTube = false
	self.riding = false
	self.model:sample(x, z, self.s)
	self.y = self.s.height
	self.normal = Vector3.yAxis
	self.normalBoard = Vector3.yAxis
	self:updatePose(1)
end

function Surfer:setState(st)
	if self.state == st then
		return
	end
	local prev = self.state
	self.state = st
	self.stateTime = 0
	self.pearlT = 0
	if st ~= STATE.STANDING then
		self.move = nil
	end
	self:emit("state", { from = prev, to = st })
end

function Surfer:popUp()
	if self.state == STATE.PRONE and not self.diving then
		self:setState(STATE.POPUP)
	end
end

function Surfer:layDown()
	local st = self.state
	if (st == STATE.STANDING or st == STATE.POPUP or st == STATE.SITTING) and not self.air then
		self:setState(STATE.PRONE)
	end
end

function Surfer:sit()
	if self.state == STATE.PRONE and not self.diving and not self.air then
		self:setState(STATE.SITTING)
	end
end

function Surfer:wipeout(reason)
	if self.state == STATE.WIPEOUT then
		return
	end
	self.wipeReason = reason
	self.air = false
	self.diving = false
	self.knockX, self.knockZ = 0, 0
	self.flip, self.flipArm = nil, nil
	self:setState(STATE.WIPEOUT)
	self:emit("wipeout", { reason = reason })
end

-- Bumped by another surfer: a change of speed along the board (+ forward), across it
-- (+ right) and a spin (rad/s, + left).
function Surfer:bumped(dvLong, dvLat, dYaw)
	if self.state == STATE.WIPEOUT then
		return
	end
	local fx, fz = self:forward()
	self.vx += fx * dvLong
	self.vz += fz * dvLong
	self.knockX += -fz * dvLat
	self.knockZ += fx * dvLat
	if not self.move then
		self.yawRate += clamp(dYaw, -6, 6)
	end
end

function Surfer:flipUp(power)
	self.upFlickT = 0
	self.upFlickPower = power or 1
end

function Surfer:poseCrouch()
	local g = self.flipGrab
	return if g > 0 then self.crouch + (1 - self.crouch) * min(1, g * 2) + g else self.crouch
end

function Surfer:flipAngle()
	return if self.flip then self.flip.angle else self.flipRest
end

function Surfer:turtleAngle()
	local t = self.turtle
	return pi * t * t * (3 - 2 * t)
end

-- A quick look turn while charged: snap, cutback or tailslide toward dir (+1 left, -1
-- right). omega: peak turn speed (rad/s), sweep: how far the look turned.
function Surfer:flick(dir, omega, sweep)
	if self.state ~= STATE.STANDING or self.air or self.move or self.charge < 0.15 or self:planeSpeed() < 3 then
		return nil
	end
	local same = self.yawRate * dir
	local kind, theta, dur, slide, loss = nil, 0, 0, 0, 0
	if omega > 10 or (omega > 6.5 and same > 1.0) then
		kind = "tailslide"
		theta = clamp(1.25 + 0.07 * omega, 1.4, 2.3)
		dur, slide, loss = 0.28, 0.5, 0.1
	elseif sweep > 1.3 then
		kind = "cutback"
		theta = clamp(2.3 + 0.35 * (sweep - 1.3), 2.3, 3.0)
		dur, loss = 0.9, 0.16
	else
		kind = "snap"
		theta = clamp(0.6 + 0.09 * omega + 0.35 * sweep, 0.75, 1.7)
		dur, loss = 0.3, 0.08
	end
	theta *= mix(0.6, 1, self.charge) * (if self.board.walk then 0.85 else 1)
	self.move = { kind = kind, dir = dir, theta = theta, dur = dur, slide = slide, loss = loss, t = 0, yaw0 = self.yaw }
	self.charge = 0
	self:emit("maneuver", { kind = kind, dir = dir })
	return kind
end

-- input: { paddle, pulse, turn, steer, leanX, leanZ, walk, walkTo, crouch, duck, charge }
function Surfer:update(dt, input)
	local steps = max(1, math.ceil(dt / (1 / 120)))
	local h = dt / steps
	for _ = 1, steps do
		self:step(h, input)
	end
	self:updatePose(dt)
end

function Surfer:step(h, inp)
	local model = self.model
	local s = model:sample(self.x, self.z, self.s)
	local B = self.board
	self.stateTime += h
	if self.state == STATE.POPUP and self.stateTime > POPUP_TIME then
		self:setState(STATE.STANDING)
	end

	-- surface gradient (finite differences on the smooth surface, near the known swell shift)
	local e = 0.06
	local sx, sz = s.shiftX, s.shiftZ
	local hx = (model:heightNear(self.x + e, self.z, sx, sz, 1) - model:heightNear(self.x - e, self.z, sx, sz, 1)) / (2 * e)
	local hz = (model:heightNear(self.x, self.z + e, sx, sz, 1) - model:heightNear(self.x, self.z - e, sx, sz, 1)) / (2 * e)
	self._gx, self._gz = hx, hz

	local st = self.state
	local standing = st == STATE.STANDING
	local prone = st == STATE.PRONE or st == STATE.POPUP
	local sitting = st == STATE.SITTING

	-- stance
	local k = 1 - exp(-h * (if standing then 7 else 4))
	self.leanX += ((if standing and not self.move then inp.leanX else 0) - self.leanX) * k
	self.leanZ += ((if standing and not B.walk then inp.leanZ else 0) - self.leanZ) * k
	if standing and B.walk then
		if inp.walkTo then
			self.footPos += (clamp(inp.walkTo, B.footMin, B.footMax) - self.footPos) * (1 - exp(-h * 8))
		else
			self.footPos = clamp(self.footPos + (inp.walk or 0) * 0.8 * h, B.footMin, B.footMax)
		end
	elseif not standing then
		self.footPos = moveToward(self.footPos, 0, h * 2)
	end
	local kb = 1 - exp(-h * 7)
	self.braceX += ((if st == STATE.WIPEOUT then 0 else inp.leanX or 0) - self.braceX) * kb
	self.braceZ += ((if standing and not B.walk then inp.leanZ or 0 else 0) - self.braceZ) * kb
	self.charge = if standing and inp.charge then min(1, self.charge + h / 0.45) else max(0, self.charge - h * 4)
	local prevLeg = self.legCrouch
	self.legCrouch = prevLeg + ((if standing then inp.crouch or 0 else 0) - prevLeg) * (1 - exp(-h * 11))
	local ext = max(0, (prevLeg - self.legCrouch) / h)
	local stance = if standing then max(0.45 * self.charge, if self.move then 0.45 else 0, max(-self.leanZ, 0) * 0.5) else 0
	self.stanceCrouch += (stance - self.stanceCrouch) * (1 - exp(-h * 6))
	self.crouch = max(self.legCrouch, self.stanceCrouch)

	if st == STATE.WIPEOUT then
		-- tumbling in the whitewater: carried by the water, no control
		local kk = 1 - exp(-h * 2.5)
		self.vx += (0 - self.vx) * kk
		self.vz += (s.waterVz * 0.9 - self.vz) * kk
		self.x += self.vx * h
		self.z += self.vz * h
		self.tumble += h
		self.diveDepth = moveToward(self.diveDepth, 0, h)
		self.y = s.height - min(1.4, self.tumble * 1.5)
		return
	end

	self:updateDive(h, inp)
	local deep = self.diveDepth > 0.35 or self.turtle > 0.8
	local wvz = s.waterVz * exp(-self.diveDepth * 1.4) * (1 - 0.6 * self.turtle)

	-- forces
	local g2 = hx * hx + hz * hz
	local relSp = sqrt(self.vx * self.vx + (self.vz - wvz) ^ 2)
	local plane = if standing
		then mix(0.45, 1, smoothstep(B.planeLo - 0.3, B.planeHi, relSp))
		else mix(0.2, 1, smoothstep(1.1, 3.0, relSp))
	if sitting then
		plane = 0.12
	end
	if standing and ext > 0.5 then
		plane *= 1 + min(0.7, ext * 0.12)
	end
	if self.diving then
		plane *= 1 - smoothstep(0.1, 0.6, self.diveDepth)
	end
	local ax = (-GRAVITY * hx * plane) / (1 + g2)
	local az = (-GRAVITY * hz * plane) / (1 + g2)
	local fx, fz = self:forward()
	local rx, rz = -fz, fx
	local slope = sqrt(g2)

	-- paddling: effort sets the speed you can paddle at, each stroke pushes toward it
	local thrust = 0
	local vfw = self.vx * fx + (self.vz - wvz) * fz
	local effort = if st == STATE.PRONE and not self.diving then clamp(inp.paddle or 0, 0, 1) else 0
	self.paddleEffort += (effort - self.paddleEffort) * (1 - exp(-h * 3))
	if effort > 0.02 then
		local vTop = B.paddleTop * mix(0.35, 1, effort)
		local v = max(vfw, 0)
		local lin = mix(0.38, 0.2, smoothstep(2.2, 4.5, v))
		local drag = lin * v + 0.11 * v * v
		thrust = (inp.pulse or 0) * max(0, drag + (vTop - v) / B.paddleTau) * smoothstep(vTop + 0.5, vTop - 0.05, v)
	end
	if thrust > 0.25 then
		self.lastStroke = 0
	else
		self.lastStroke += h
	end
	if standing and self.leanZ > 0.1 and slope > 0.1 and self:planeSpeed() > 2 then
		thrust += 1.1 * self.leanZ * min(1, slope * 3)
	end
	ax += fx * thrust
	az += fz * thrust

	-- catching: a paddler stroking on the steep part of the face, pointed at the beach, gets
	-- picked up by the wave and accelerated toward its speed
	self.catching = false
	if prone and not self.diving and self.lastStroke < 0.7 and s.wave and s.H > 0.6 and s.un > 0.05 and s.un < 1.5 and slope > 0.16 and fz > 0.35 then
		local pull = 2.4 * B.catchBoost * mix(0.45, 1, self.paddleEffort) * smoothstep(0.16, 0.45, slope) * smoothstep(0.35, 0.8, fz)
		az += max(0, WAVE.speed * 0.95 - self.vz) * pull
		self.catching = true
	end

	if not self.air then
		self.vx += ax * h
		self.vz += az * h
		-- drag relative to the water
		local rvx, rvz = self.vx, self.vz - wvz
		local vf = rvx * fx + rvz * fz
		local vl = rvx * rx + rvz * rz
		local sp = sqrt(vf * vf + vl * vl)
		local m = self.move
		local sliding = m and m.kind == "tailslide" and m.t < m.dur + m.slide
		if standing then
			local planing = smoothstep(B.planeLo, B.planeHi, sp)
			local lin = mix(0.65, 0.07, planing)
			local quad = 0.042
			lin *= 1 - 0.3 * max(self.leanZ, 0)
			lin += 1.6 * max(-self.leanZ, 0) * planing -- stall
			lin += 0.07 * abs(self.yawRate) * planing -- carving costs a little speed
			if B.walk then
				lin *= 1 - 0.3 * smoothstep(0.2, 1.0, self.footPos)
				lin += 0.9 * smoothstep(0.3, 1.0, -self.footPos) * planing
			end
			quad += 0.05 * smoothstep(8.5, 12, sp)
			vf -= (lin * vf + quad * vf * abs(vf)) * h
			if sliding then
				vl *= exp(-h * 1.25)
			else
				local vl2 = vl * exp(-h * 7.5)
				local sg = if vf < 0 then -1 else 1
				vf += sg * (abs(vl) - abs(vl2)) * (if m then 0.7 else 0.82)
				vl = vl2
			end
		else
			local lin = mix(0.38, 0.2, smoothstep(2.2, 4.5, sp)) + (if self.diving then 0.8 else 0) + (if sitting then 1.4 else 0)
			local quad = 0.11
			vf -= (lin * vf + quad * vf * abs(vf)) * h
			local vl2 = vl * exp(-h * 2.6)
			local sg = if vf < 0 then -1 else 1
			vf += sg * (abs(vl) - abs(vl2)) * 0.3
			vl = vl2
		end
		self.vx = vf * fx + vl * rx
		self.vz = vf * fz + vl * rz + wvz
	end

	-- steering
	local speed = self:planeSpeed()
	if self.move then
		local m = self.move
		m.t += h
		local p = min(1, m.t / m.dur)
		local ease = 1 - (1 - p) ^ 3
		local yaw = m.yaw0 + m.dir * m.theta * ease
		self.yawRate = (yaw - self.yaw) / h
		self.yaw = yaw
		if m.t >= m.dur + m.slide then
			local f = 1 - m.loss
			self.vx *= f
			self.vz = wvz + (self.vz - wvz) * f
			self.move = nil
			self.yawRate *= 0.2
		end
	elseif standing then
		local turn = B.turn
		if B.walk then
			turn *= mix(1, 0.35, smoothstep(0.2, 1.0, self.footPos)) * mix(1, 2.1, smoothstep(0.2, 0.9, -self.footPos))
		end
		local target = if self.air then 0 else -self.leanX * min(2.8, 0.55 + 0.3 * speed) * turn
		self.yawRate += (target - self.yawRate) * (1 - exp(-h * 6))
	elseif prone then
		local target = (-(inp.steer or 0) * 1.25) / (1 + 0.18 * speed) + (inp.turn or 0)
		self.yawRate += (target - self.yawRate) * (1 - exp(-h * 5))
	elseif sitting then
		self.yawRate += (-(inp.steer or 0) * 0.75 - self.yawRate) * (1 - exp(-h * 3))
	end
	if not self.move then
		self.yaw += self.yawRate * h
	end

	self.x += self.vx * h
	self.z += self.vz * h
	if self.knockX ~= 0 or self.knockZ ~= 0 then
		self.x += self.knockX * h
		self.z += self.knockZ * h
		local kd = exp(-h * (if standing then 5 elseif sitting then 3 else 2.6))
		self.knockX *= kd
		self.knockZ *= kd
		if abs(self.knockX) + abs(self.knockZ) < 1e-3 then
			self.knockX, self.knockZ = 0, 0
		end
	end
	if self.collide then
		local hit = self.collide(self)
		if hit > 3.5 and self.state == STATE.STANDING then
			return self:wipeout("Ran into the wall")
		end
	end

	self.snapHeld = not not inp.charge
	local crouchIn = standing and (inp.crouch or 0) > 0.5
	if self.crouchHeld and not crouchIn and self.snapHeld and not self.air then
		self.flipArm = { t = 0, release = nil }
	end
	self.crouchHeld = crouchIn
	self:updateVertical(h, s, ext)
	if self.state == STATE.WIPEOUT then
		return
	end
	self:updateFlip(h, inp)
	self:updatePitch(h, hx, hz, slope, fx, fz, s)
	if not self.air then
		self:checkRules(s, h, deep)
	end
end

-- Duck dive: hold to push the board under, release to float back up. On a longboard the
-- same input turtle rolls instead.
function Surfer:updateDive(h, inp)
	local can = self.state == STATE.PRONE and not self.air
	local want = can and not not inp.duck
	local prev = self.diveDepth
	self.diveCool = max(0, self.diveCool - h)
	if self.board.walk or self.turtle > 0 then
		if want and not self.diving and self.diveCool <= 0 and self.board.walk then
			self.diving = true
			self.turtleT = 0
			self:emit("duckdive", { turtle = true })
		end
		if self.diving then
			self.turtleT += h
			local hold = want and self.turtleT < 4
			self.turtle = moveToward(self.turtle, if hold then 1 else 0, (if hold then 1 / 0.55 else 1 / 0.65) * h)
			if not can or (not hold and self.turtle <= 0.001) then
				self.diving = false
				self.diveCool = 0.5
				self:emit("surface")
			end
		else
			self.turtle = moveToward(self.turtle, 0, h / 0.65)
		end
		self.diveDepth = moveToward(self.diveDepth, 0, 1.5 * h)
		self.diveRate = (self.diveDepth - prev) / h
		return
	end
	if want and not self.diving and self.diveCool <= 0 then
		self.diving = true
		self.diveT = 0
		self:emit("duckdive")
	end
	if self.diving then
		self.diveT += h
		local hold = want and self.diveT < 3.2
		local target = if hold then 0.95 + 0.25 * min(self:speed(), 2.4) else 0
		self.diveDepth = moveToward(self.diveDepth, target, (if target > self.diveDepth then 2.4 else 1.5) * h)
		if not can or (not hold and self.diveDepth <= 0.001) then
			self.diving = false
			self.diveCool = 0.5
			self:emit("surface")
		end
	else
		self.diveDepth = moveToward(self.diveDepth, 0, 1.5 * h)
	end
	self.diveRate = (self.diveDepth - prev) / h
end

-- Vertical motion: glued to the surface until the surface drops away faster than gravity
-- (cresting the lip at speed) or a leg extension pops the board up, then ballistic.
function Surfer:updateVertical(h, s, ext)
	local target = s.height - self.diveDepth - (if self.state == STATE.SITTING then 0.07 else 0) - 0.12 * self.turtle
	local standing = self.state == STATE.STANDING
	if not self.air then
		local vySurf = (target - self.y) / h
		local launch = nil
		if standing then
			if ext > 1.2 then
				self.popVel = max(self.popVel, min(2.4, ext * 0.42) * mix(0.35, 1, smoothstep(2, 7, self:planeSpeed())))
			else
				if self.popVel > 0.6 then
					launch = vySurf + self.popVel
				end
				self.popVel = 0
			end
			local aReq = (vySurf - self.vy) / h
			local nearTop = s.wave and (s.yb > 0.82 or s.un < -0.1)
			local turning = self.move or self.charge > 0.1
			if launch == nil and not turning and nearTop and self.vy > 3.5 and aReq < -GRAVITY * 2.6 then
				launch = min(self.vy, 4.5) * 0.55
			end
		else
			self.popVel = 0
		end
		if launch ~= nil and launch > vySurf + 0.3 then
			self.air = true
			self.airTime = 0
			self.vy = launch
			self.y += self.vy * h
			if self.move then
				self.move = nil
				self.yawRate = 0
			end
			self.flip = nil
			self:emit("takeoff")
		else
			self.y = target
			self.vy = vySurf
		end
	else
		self.vy -= GRAVITY * h
		self.y += self.vy * h
		self.airTime += h
		if self.y <= target then
			self:land(target)
		end
	end
end

function Surfer:updateFlip(h, inp)
	self.upFlickT += h
	local A = self.flipArm
	if A then
		A.t += h
		if not inp.charge and A.release == nil then
			A.release = A.t
		end
		if (A.release ~= nil and A.release > FLIP_RELEASE) or (A.release == nil and A.t > FLIP_RELEASE) or (not self.air and A.t > 1) then
			self.flipArm = nil
		end
	end
	if not self.air then
		return
	end
	if self.flipArm and not self.flip then
		if self.flipArm.release ~= nil and self.upFlickT < 0.3 then
			self.flip = { angle = 0, rate = FLIP_SPIN * clamp(self.upFlickPower, 0.8, 1.25), done = false }
			self.flipArm = nil
			self.vy += FLIP_POP
			self:emit("flipstart")
		end
	end
	local F = self.flip
	if F and not F.done then
		F.angle = min(2 * pi, F.angle + F.rate * h)
		F.done = F.angle >= 2 * pi
	end
end

function Surfer:land(target)
	self.air = false
	self.y = target
	local flip = self.flip
	self.flip, self.flipArm = nil, nil
	if flip then
		if flip.angle < FLIP_LAND then
			return self:wipeout("Under-rotated the backflip")
		end
		self.flipRest = flip.angle - 2 * pi
		self:emit("backflip")
	end
	local fx, fz = self:forward()
	local sp = sqrt(self.vx * self.vx + self.vz * self.vz)
	local align = if sp > 0.5 then (self.vx * fx + self.vz * fz) / sp else 1
	local n = Vector3.new(-self._gx, 1, -self._gz).Unit
	local impact = -(self.vx * n.X + self.vy * n.Y + self.vz * n.Z)
	local t = self.airTime
	self.airTime = 0
	if t > 0.35 and (align < 0.3 or impact > 10) then
		return self:wipeout(if align < 0.3 then "Landed sideways" else "Too big a drop: botched the landing")
	end
	local f = 1 - min(0.35, max(0, impact) * 0.03)
	self.vx *= f
	self.vz *= f
	if t > 0.35 then
		self:emit("air", { time = t })
	end
end

-- How steeply the nose points down. A pitching lip turns the face toward vertical.
function Surfer:updatePitch(h, hx, hz, slope, fx, fz, s)
	local fall = -(hx * fx + hz * fz)
	local ang = atan(max(0, fall))
	local surface = ang
	if s.wave and slope > 0.05 then
		local ledge = s.b * (1 - s.kappa) * smoothstep(-0.3, 0.1, s.un) * smoothstep(1.25, 0.75, s.un)
		local align = max(0, fall / slope)
		ang += (pi / 2 - ang) * ledge * align
	end
	self.effPitch += (ang - self.effPitch) * (1 - exp(-h * 12))
	self.ledgePitch += (ang - surface - self.ledgePitch) * (1 - exp(-h * 12))
end

function Surfer:checkRules(s, h, deep)
	local st = self.state
	local big = s.wave and s.H > 0.45
	self.inTube = false
	self.ceiling = math.huge
	-- standing without enough speed to plane: sink back to prone
	if st == STATE.STANDING and self:planeSpeed() < 1.2 and self.stateTime > 1.0 then
		self._slow += h
		if self._slow > 1.2 then
			self._slow = 0
			self:setState(STATE.PRONE)
			self:emit("sink", { waveNear = big and abs(s.un) < 4 })
			return
		end
	else
		self._slow = 0
	end

	-- nose-dive: lying down as the board goes vertical, or popping up too late
	local ang = self.effPitch
	local limit, why = math.huge, ""
	if st == STATE.PRONE and not self.diving then
		limit, why = 52 * DEG, "Pearled! Pop up before the board goes vertical"
	elseif st == STATE.POPUP then
		limit, why = 41 * DEG, "Too late! Pearled on the take-off"
	elseif st == STATE.STANDING and self.board.walk and self.footPos > 0.85 then
		limit, why = 42 * DEG, "Nose-dived off the nose"
	end
	if ang > limit then
		self.pearlT += h
		if self.pearlT > (if st == STATE.POPUP then 0.1 else 0.18) then
			return self:wipeout(why)
		end
	else
		self.pearlT = 0
	end

	if not big then
		self.riding = false
		return
	end
	local un = s.un
	local tip = CURL.tipShift
	local small = s.H < WAVE_HEIGHTS.small
	if not deep then
		if s.H > 1.0 and s.yb > 0.8 and s.b > 0.3 and un > -0.3 and un < 0.65 then
			return self:wipeout("Over the falls!")
		end
		if not small and s.b > 0.55 and un > 1.2 + tip and un < 1.75 + tip and s.kappa < 0.95 then
			return self:wipeout("Smashed by the lip!")
		end
	end
	self.onWhitewater = false
	if st == STATE.STANDING then
		if s.wave.collapseG > 0.3 then
			self.riding = false
			self:setState(STATE.PRONE)
			self:emit("closeout")
			return
		end
		if s.kappa > 0.5 and un > -0.3 and un < 2.4 + tip then
			if not small then
				return self:wipeout("Caught inside the whitewater")
			end
			self.onWhitewater = true
		end
		if not small and s.b > 0.25 and un > 0.2 and un < 1.7 + tip then
			local c = self.model:tubeCeiling(s.wave, self.x, self.z, self.y + 0.35)
			self.ceiling = c - self.y
			local head = mix(1.8, 1.05, self.crouch)
			if self.ceiling < head then
				self.lipT += h
				if self.lipT > 0.08 then
					return self:wipeout("Clipped by the lip! Crouch under it")
				end
			else
				self.lipT = 0
			end
		else
			self.lipT = 0
		end
		self.inTube = s.b > 0.6 and s.kappa < 0.35 and un > 0.38 and un < 1.25 + tip and s.H > 1.2
		self.riding = un > -0.7 and un < 3 and self:planeSpeed() > 2.2
	else
		self.riding = false
		if st == STATE.SITTING and not small and s.kappa > 0.5 and un > -0.3 and un < 2.0 + tip then
			return self:wipeout("Caught inside the whitewater")
		end
	end
end

-- The board's frame on a surface with normal `up`, facing the way it's heading.
function Surfer:frameOn(up)
	local fwd = Vector3.new(-sin(self.yaw), 0, -cos(self.yaw))
	fwd = (fwd - up * fwd:Dot(up)).Unit
	local right = fwd:Cross(up).Unit
	return CFrame.fromMatrix(Vector3.zero, right, up, -fwd)
end

local function lerpUnit(a, b, t)
	local v = a + (b - a) * t
	return if v.Magnitude > 1e-6 then v.Unit else b
end

function Surfer:updatePose(dt)
	local n = if self.air then Vector3.yAxis else Vector3.new(-self._gx, 1, -self._gz).Unit
	self.normal = lerpUnit(self.normal, n, 1 - exp(-dt * (if self.air then 3 else 10)))
	self.normalBoard = lerpUnit(self.normalBoard, n, 1 - exp(-dt * (if self.air then 3 else 30)))
	self.flipRest *= exp(-dt * 14)
	if abs(self.flipRest) < 1e-3 then
		self.flipRest = 0
	end
	local grabTo = if self.flip and self.flip.angle < 2 * pi - 0.7 then 1 else 0
	self.flipGrab += (grabTo - self.flipGrab) * (1 - exp(-dt * (if grabTo > 0 then 14 else 7)))
	if self.flipGrab < 1e-3 then
		self.flipGrab = 0
	end
	self.position = Vector3.new(self.x, self.y, self.z)

	-- rail lean, trim, dives and ledges
	local st = self.state
	local standing = st == STATE.STANDING
	local targetRoll = if standing then -self.leanX * 0.42 elseif st == STATE.WIPEOUT then sin(self.tumble * 5) * 1.2 else -self.yawRate * 0.05
	if self.move then
		targetRoll = self.move.dir * (if self.move.kind == "tailslide" then 0.2 else 0.6)
	end
	local targetPitch = if standing then -self.leanZ * 0.06 elseif st == STATE.PRONE then 0.035 elseif st == STATE.SITTING then 0.2 else 0
	if standing and self.board.walk then
		targetPitch -= 0.06 * smoothstep(0.3, 1.1, self.footPos) - 0.07 * smoothstep(0.3, 1.0, -self.footPos)
	end
	targetPitch -= max(0, self.ledgePitch) * 0.8
	if self.diving or self.diveDepth > 0 then
		targetPitch -= clamp(self.diveRate * 0.22, -0.35, 0.45)
	end
	if self.air then
		targetPitch += clamp(self.vy * 0.04, -0.25, 0.2)
	end
	self.roll += (targetRoll - self.roll) * (1 - exp(-dt * 8))
	self.pitch += (targetPitch - self.pitch) * (1 - exp(-dt * 6))
	local q = CFrame.fromEulerAnglesYXZ(self.pitch, 0, self.roll)

	self.quatBase = self:frameOn(self.normal) * q
	self.quat = self:frameOn(self.normalBoard) * q
	self.ride.tilt, self.ride.lift = 0, 0
	local flip = self:flipAngle()
	if not self.diving and self.turtle == 0 and st ~= STATE.WIPEOUT and flip == 0 then
		self:rideOnWater()
	end
	if self.turtle > 0 then
		self.quat = self.quat * CFrame.fromAxisAngle(ZAXIS, self:turtleAngle())
	end
	self.flipShift = Vector3.zero
	if flip ~= 0 then
		local fu = self.quat * Vector3.new(0, FLIP_PIVOT, 0)
		self.quat = self.quat * CFrame.fromAxisAngle(XAXIS, flip)
		self.flipShift = fu - self.quat * Vector3.new(0, FLIP_PIVOT, 0)
		self.position += self.flipShift
	end
end

-- The board resting on the water along its length, not just at its middle (see
-- js/surfer.js): turned about its middle and, where it has to be, lifted, so no part of it
-- is deeper than on flat water. Only the drawn board moves; the physics isn't touched.
function Surfer:rideOnWater()
	local n = #RIDE_T
	local need, k, hs = self._need, self._k, self._hs
	local L = self.board.length
	local M = self.model
	local sx, sz = self.s.shiftX or 0, self.s.shiftZ or 0
	local kind = self.boardType
	local function station(i)
		local t = RIDE_T[i]
		return self.position + self.quat * Vector3.new(0, Board.bottom(kind, t), -(t - 0.5) * L)
	end
	for round = 0, 2 do
		local worst = 0
		for i = 1, n do
			local t = RIDE_T[i]
			local b = Board.bottom(kind, t)
			local p = station(i)
			local allowed = max(0, -b) + (if t >= 0.6 then 0.004 else 0.03 + 0.05 * max(0, L - 1.86))
			hs[i] = M:heightNear(p.X, p.Z, sx, sz, 1)
			need[i] = hs[i] - allowed - p.Y
			if need[i] > worst then
				worst = need[i]
			end
		end
		if worst < (if round > 0 then 0.002 else 1e-4) then
			break
		end
		if round == 0 then
			local ru = self.quat.UpVector
			local rzv = -self.quat.LookVector
			for i = 1, n do
				local t = RIDE_T[i]
				local b = Board.bottom(kind, t)
				local s = (t - 0.5) * L
				local vx = s * ru.X + b * rzv.X
				local vz = s * ru.Z + b * rzv.Z
				local vh = sqrt(vx * vx + vz * vz)
				local sl = 0
				if vh > 1e-4 then
					local p = station(i)
					sl = ((M:heightNear(p.X + vx / vh * 0.05, p.Z + vz / vh * 0.05, sx, sz, 0) - hs[i]) / 0.05) * vh
				end
				k[i] = s * ru.Y + b * rzv.Y - sl
			end
		end
		local phi, dy = solveRide(need, k, n)
		phi = clamp(phi, -RIDE_PHI - self.ride.tilt, RIDE_PHI - self.ride.tilt)
		dy = min(dy, RIDE_DY - self.ride.lift)
		if abs(phi) < 1e-5 and dy < 1e-5 then
			break
		end
		self.quat = self.quat * CFrame.fromAxisAngle(XAXIS, phi)
		self.position += Vector3.new(0, dy, 0)
		self.ride.tilt += phi
		self.ride.lift += dy
	end
end

return Surfer
