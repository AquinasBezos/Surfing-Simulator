-- First-person arms paddling (port of js/body.js; the arms are drawn here as a wetsuit
-- sleeve and a hand on a two-bone IK chain instead of the skinned character's arms).
--
-- Each stroke follows a smooth loop through the water and back over it: reach ahead and
-- catch, pull down and back beside the board, slice out at the hip, then swing forward with
-- the elbow high. update() returns the stroke pulse (power of the pulling arms, ~1 while
-- paddling continuously), which drives the board's thrust.

local Config = require(script.Parent.Config)

local S = Config.SCALE
local exp, sin, cos, pi, max, min = math.exp, math.sin, math.cos, math.pi, math.max, math.min

local function mix(a, b, t)
	return a + (b - a) * t
end

-- The stroke in the board's frame (x out to this arm's side, y up, z toward the tail), for
-- the right arm: { time, wrist, fingers, palm normal, elbow direction }
local V = Vector3.new
local KEYS = {
	{ 0.0, V(0.27, 0.0, -0.25), V(0.05, -0.45, -1), V(0, -1, 0.35), V(0.8, 0.55, 0.1) },
	{ 0.14, V(0.29, -0.15, -0.1), V(0.08, -1, -0.2), V(0, -0.25, 1), V(0.85, 0.5, 0) },
	{ 0.32, V(0.3, -0.22, 0.1), V(0.1, -1, 0.2), V(0, 0.1, 1), V(0.9, 0.45, -0.05) },
	{ 0.5, V(0.3, -0.13, 0.31), V(0.15, -0.7, 0.75), V(0, 0.3, 1), V(0.8, 0.6, -0.1) },
	{ 0.6, V(0.33, 0.06, 0.38), V(0.25, -0.3, 0.9), V(-1, 0, 0.1), V(0.6, 0.8, 0.1) },
	{ 0.76, V(0.4, 0.22, 0.2), V(0.25, -0.6, -0.5), V(-0.6, -0.6, 0), V(0.55, 0.85, 0.3) },
	{ 0.9, V(0.35, 0.16, -0.2), V(0.1, -0.35, -1), V(-0.2, -1, 0.2), V(0.75, 0.6, 0.2) },
}

-- periodic Catmull-Rom through the stroke's keys at phase p (0..1)
local function strokeAt(p)
	local n = #KEYS
	local i = n
	while i > 1 and KEYS[i][1] > p do
		i -= 1
	end
	local t0 = KEYS[i][1]
	local t1 = if i < n then KEYS[i + 1][1] else 1
	local u = (p - t0) / max(1e-6, t1 - t0)
	local u2, u3 = u * u, u * u * u
	local out = {}
	for c = 2, 5 do
		local P0 = KEYS[((i - 2) % n) + 1][c]
		local P1 = KEYS[i][c]
		local P2 = KEYS[(i % n) + 1][c]
		local P3 = KEYS[((i + 1) % n) + 1][c]
		out[c - 1] = P0 * (-0.5 * u3 + u2 - 0.5 * u) + P1 * (1.5 * u3 - 2.5 * u2 + 1) + P2 * (-1.5 * u3 + 2 * u2 + 0.5 * u) + P3 * (0.5 * u3 - 0.5 * u2)
	end
	return out
end

local function mirror(v, s)
	return Vector3.new(v.X * s, v.Y, v.Z)
end

local Arm = {}
Arm.__index = Arm

function Arm.new(side)
	local self = setmetatable({}, Arm)
	self.side = side
	self.phase = -1
	self.blend = 0
	self.dive = 0
	self.power = 1
	self.idleT = math.random() * 10
	self.shoulder = V(0.19 * side, 0.19, 0.3)
	self.wrist = V(0.31 * side, 0.02, -0.2)
	self.fingers = V(0, -0.3, -1)
	self.pole = V(side, 0.5, 0.3)
	return self
end

local function lerpV(a, b, t)
	return a + (b - a) * t
end

function Arm:target(dt)
	local s = self.side
	self.idleT += dt
	local sway = sin(self.idleT * 0.9 + s) * 0.02
	local W = V(0.31 * s, 0.02 + sway * 0.4, -0.2 + sway)
	local F = V(0.12 * s, -0.3, -1)
	local P = V(0.8 * s, 0.5, 0.3)
	local Sh = V(0.19 * s, 0.19, 0.3)
	if self.blend > 0.001 then
		local k = strokeAt(max(0, if self.phase < 0 then 0.999 else self.phase))
		local b = self.blend
		W = lerpV(W, mirror(k[1], s), b)
		F = lerpV(F, mirror(k[2], s), b)
		P = lerpV(P, mirror(k[4], s), b)
		local ph = if self.phase < 0 then 1 else self.phase
		Sh += V(0, 0.015 * sin(2 * pi * ph) * b, (-0.045 * cos(2 * pi * ph) + 0.01) * b)
	end
	if self.dive > 0.001 then
		W = lerpV(W, V(0.21 * s, 0.08, -0.2), self.dive)
		F = lerpV(F, V(-0.3 * s, -1, -0.1), self.dive)
		P = lerpV(P, V(0.8 * s, 0.6, 0.2), self.dive)
	end
	local k = 1 - exp(-dt * 22)
	self.shoulder = lerpV(self.shoulder, Sh, k)
	self.wrist = lerpV(self.wrist, W, k)
	self.fingers = lerpV(self.fingers, F.Unit, k).Unit
	self.pole = lerpV(self.pole, P.Unit, k).Unit
end

local Arms = {}
Arms.__index = Arms

local UPPER, FORE = 0.3, 0.28

local function makePart(name, size, color, material, parent)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size * S
	p.Color = color
	p.Material = material
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Parent = parent
	return p
end

function Arms.new(parent)
	local self = setmetatable({}, Arms)
	self.right = Arm.new(1)
	self.left = Arm.new(-1)
	self.nextArm = self.left
	self.effort = 0
	self.manualEffort = 0
	self.manualAt = -9
	self.time = 0
	self.turn = 0
	self.onStroke = nil
	local model = Instance.new("Model")
	model.Name = "FirstPersonArms"
	local suit = Color3.fromRGB(22, 24, 28)
	self.skin = Color3.fromRGB(192, 132, 101)
	for _, a in ipairs({ self.left, self.right }) do
		a.upper = makePart("Upper", V(0.1, 0.1, UPPER), suit, Enum.Material.Rubber, model)
		a.fore = makePart("Fore", V(0.085, 0.085, FORE), suit, Enum.Material.Rubber, model)
		a.cuff = makePart("Wrist", V(0.06, 0.055, 0.05), self.skin, Enum.Material.SmoothPlastic, model)
		a.hand = makePart("Hand", V(0.085, 0.03, 0.17), self.skin, Enum.Material.SmoothPlastic, model)
		a.thumb = makePart("Thumb", V(0.025, 0.025, 0.07), self.skin, Enum.Material.SmoothPlastic, model)
		for _, p in ipairs({ a.upper, a.fore }) do
			local m = Instance.new("SpecialMesh")
			m.MeshType = Enum.MeshType.Sphere
			m.Parent = p
		end
		local hm = Instance.new("SpecialMesh")
		hm.MeshType = Enum.MeshType.Sphere
		hm.Parent = a.hand
	end
	model.Parent = parent
	self.model = model
	return self
end

function Arms:setSkin(c)
	self.skin = c
	for _, a in ipairs({ self.left, self.right }) do
		a.cuff.Color, a.hand.Color, a.thumb.Color = c, c, c
	end
end

function Arms:setVisible(v)
	for _, p in ipairs(self.model:GetChildren()) do
		p.LocalTransparencyModifier = if v then 0 else 1
	end
	self.visible = v
end

-- A stroke with one arm (side -1 left, +1 right), asked for by a trigger or a button.
function Arms:stroke(side, strength)
	local a = if side < 0 then self.left else self.right
	if a.phase >= 0 and a.phase < 0.6 then
		return false
	end
	a.phase = 0
	a.power = 0.55 + 0.6 * (strength or 1)
	self.manualAt = self.time
	self.manualEffort = min(1, self.manualEffort + 0.22 + 0.2 * (strength or 1))
	if self.onStroke then
		self.onStroke(side, strength)
	end
	return true
end

function Arms:manual()
	return self.time - self.manualAt < 1.6
end

-- Returns the stroke pulse. active: paddling allowed; effort: the scroll wheel's 0..1.
function Arms:update(dt, active, effort, dive)
	self.time += dt
	self.manualEffort *= exp(-dt / 1.3)
	local manual = self:manual()
	self.effort = if active then (if manual then max(effort, self.manualEffort) else effort) else 0
	local strokeTime = mix(1.15, 0.52, self.effort)
	local pulse, turn = 0, 0
	for _, a in ipairs({ self.left, self.right }) do
		if a.phase >= 0 then
			a.phase += dt / strokeTime
			if a.phase < 0.55 then
				local p = (sin(pi * a.phase / 0.55) / 0.7) * (if manual then a.power else 1)
				pulse += p
				turn += a.side * p
			end
			if a.phase >= 1 then
				a.phase = -1
			end
		end
		local target = if a.phase >= 0 then 1 else 0
		a.blend += (target - a.blend) * min(1, dt * (if target > 0 then 12 else 4))
		a.dive += ((if dive then 1 else 0) - a.dive) * min(1, dt * 8)
	end
	self.turn = if manual and active and not dive then turn * 0.28 else 0
	if active and not dive and self.effort > 0.04 and not manual then
		local other = if self.nextArm == self.left then self.right else self.left
		if self.nextArm.phase < 0 and (other.phase < 0 or other.phase > 0.5) then
			self.nextArm.phase = 0
			if self.onStroke then
				self.onStroke(self.nextArm.side, self.effort)
			end
			self.nextArm = other
		end
	end
	if dt > 0 then
		self.left:target(dt)
		self.right:target(dt)
	end
	return if active and not dive then pulse else 0
end

function Arms:stroking()
	return self.left.phase >= 0 or self.right.phase >= 0
end

-- Draw the arms in `frame` (the board's frame, studs; offsetZ: how far the arms sit
-- toward the nose for this board).
local function segment(part, a, b, frame)
	local pa, pb = frame * (a * S), frame * (b * S)
	local mid = (pa + pb) / 2
	local len = (pb - pa).Magnitude
	part.Size = Vector3.new(part.Size.X, part.Size.Y, math.max(len, 0.01) + part.Size.X * 0.3)
	part.CFrame = CFrame.lookAt(mid, pb, frame.UpVector)
end

function Arms:pose(frame, offsetZ)
	if not self.visible then
		return
	end
	local off = V(0, 0, offsetZ or 0)
	for _, a in ipairs({ self.left, self.right }) do
		local sh = a.shoulder + off
		local wr = a.wrist + off
		-- two-bone IK: the elbow out toward the pole
		local d = wr - sh
		local L = d.Magnitude
		local dir = if L > 1e-6 then d / L else V(0, 0, -1)
		local reach = math.clamp(L, 0.05, UPPER + FORE - 0.002)
		local x = (UPPER * UPPER - FORE * FORE + reach * reach) / (2 * reach)
		local hgt = math.sqrt(math.max(UPPER * UPPER - x * x, 0))
		local pole = a.pole - dir * a.pole:Dot(dir)
		pole = if pole.Magnitude > 1e-6 then pole.Unit else V(0, 1, 0)
		local elbow = sh + dir * x + pole * hgt
		local wrist = sh + dir * reach
		segment(a.upper, sh, elbow, frame)
		segment(a.fore, elbow, wrist, frame)
		local fw = a.fingers
		local hand = wrist + fw * 0.09
		local up = (pole:Cross(fw)).Unit * a.side
		local hcf = CFrame.lookAt(frame * (hand * S), frame * ((hand + fw) * S), frame:VectorToWorldSpace(up))
		a.hand.CFrame = hcf
		a.cuff.CFrame = CFrame.lookAt(frame * ((wrist + fw * 0.01) * S), frame * ((wrist + fw) * S), frame:VectorToWorldSpace(up))
		a.thumb.CFrame = hcf * CFrame.new(Vector3.new(-0.045 * a.side, 0.01, -0.01) * S) * CFrame.Angles(0, 0.5 * a.side, 0)
	end
end

return Arms
