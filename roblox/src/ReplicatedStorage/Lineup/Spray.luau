-- Spray (after js/spray.js and js/spraysheet.js): spray blown off the lip and the crest as
-- a section pitches, the fan off your tail in a turn, white water off the nose as you drop
-- in, and bursts for wipeouts. (The whitewater itself is Foam.)

local Config = require(script.Parent.Config)
local WM = require(script.Parent.WaveModel)

local S = Config.SCALE
local LIP_EMITTERS = 10

local Spray = {}
Spray.__index = Spray

local function emitter(parent, props)
	local p = Instance.new("Part")
	p.Name = "SprayEmitter"
	p.Size = Vector3.new(0.2, 0.2, 0.2)
	p.Transparency = 1
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Parent = parent
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/smoke_main.dds"
	e.LightInfluence = 0.85
	e.LightEmission = 0.15
	e.Rate = 0
	e.EmissionDirection = Enum.NormalId.Top
	for k, v in pairs(props) do
		e[k] = v
	end
	e.Parent = p
	return p, e
end

local WHITE = ColorSequence.new(Color3.fromRGB(245, 250, 252))

function Spray.new(parent, quality)
	local self = setmetatable({}, Spray)
	self.low = quality == "low"
	local folder = Instance.new("Folder")
	folder.Name = "Spray"
	folder.Parent = parent
	self.lips = {}
	for i = 1, LIP_EMITTERS do
		local p, e = emitter(folder, {
			Color = WHITE,
			Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3 * S), NumberSequenceKeypoint.new(1, 1.6 * S) }),
			Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.35), NumberSequenceKeypoint.new(1, 1) }),
			Lifetime = NumberRange.new(0.8, 1.6),
			Speed = NumberRange.new(2 * S, 5 * S),
			SpreadAngle = Vector2.new(25, 40),
			Acceleration = Vector3.new(0, -4 * S, -1.5 * S),
			Drag = 1.5,
			Rotation = NumberRange.new(0, 360),
			RotSpeed = NumberRange.new(-40, 40),
		})
		self.lips[i] = { part = p, e = e }
	end
	-- the board: a fan off the tail in a turn, white water off the nose on the drop
	self.tail, self.tailE = emitter(folder, {
		Color = WHITE,
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.12 * S), NumberSequenceKeypoint.new(1, 0.5 * S) }),
		Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) }),
		Lifetime = NumberRange.new(0.4, 0.8),
		Speed = NumberRange.new(3 * S, 6 * S),
		SpreadAngle = Vector2.new(15, 35),
		Acceleration = Vector3.new(0, -9.8 * S, 0),
		Drag = 0.6,
		Rotation = NumberRange.new(0, 360),
	})
	self.nose, self.noseE = emitter(folder, {
		Color = WHITE,
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.1 * S), NumberSequenceKeypoint.new(1, 0.4 * S) }),
		Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.25), NumberSequenceKeypoint.new(1, 1) }),
		Lifetime = NumberRange.new(0.3, 0.6),
		Speed = NumberRange.new(1.5 * S, 3 * S),
		SpreadAngle = Vector2.new(50, 20),
		Acceleration = Vector3.new(0, -9.8 * S, 0),
		Drag = 0.5,
	})
	self.burstP, self.burstE = emitter(folder, {
		Color = WHITE,
		Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.3 * S), NumberSequenceKeypoint.new(1, 1.4 * S) }),
		Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.2), NumberSequenceKeypoint.new(1, 1) }),
		Lifetime = NumberRange.new(0.6, 1.2),
		Speed = NumberRange.new(2 * S, 5 * S),
		SpreadAngle = Vector2.new(70, 70),
		Acceleration = Vector3.new(0, -6 * S, 0),
		Drag = 1,
	})
	self.folder = folder
	self.origin = Vector3.zero
	self._cp = {}
	return self
end

function Spray:burst(posSim, size)
	self.burstP.Position = self.origin + posSim * S
	self.burstE:Emit(math.floor(30 * (size or 1)))
end

function Spray:update(dt, model, surfer, origin, camSim)
	self.origin = origin
	-- the lip: emitters spread along the breaking sections nearest the camera (none on low
	-- graphics)
	local used = 0
	for _, w in ipairs(if self.low then {} else model.waves) do
		if not w.active or w.H < 0.6 or w.tau < -0.5 then
			continue
		end
		local px, bx = WM.peelPoints(w)
		-- from the far breaking point back toward the camera along the crest
		local lo, hi = math.min(px, bx), math.max(px, bx)
		local x0 = math.clamp(camSim.X, lo - 20, hi + 20)
		for i = 1, 5 do
			if used >= LIP_EMITTERS then
				break
			end
			local x = x0 + (i - 3) * 6
			local sc = model:section(w, x, w.crestZ0, {})
			if sc.b < 0.3 or sc.H < 0.5 then
				continue
			end
			used += 1
			local L = self.lips[used]
			local p = model:curlPoint(w, x, w.crestZ0, self._cp)
			L.part.CFrame = CFrame.lookAt(origin + Vector3.new(p.x, p.y + 0.1, p.z) * S, origin + Vector3.new(p.x, p.y + 1, p.z - 1.2) * S)
				* CFrame.Angles(-math.pi / 2, 0, 0)
			L.e.Rate = 40 * sc.b * (1 - sc.kappa) * math.min(1, sc.H / 2)
		end
	end
	for i = used + 1, LIP_EMITTERS do
		self.lips[i].e.Rate = 0
	end

	-- the board
	local standing = surfer.state == "standing" and not surfer.air
	local speed = surfer:planeSpeed()
	local q = surfer.quat
	local L = surfer.board.length
	local tailPos = origin + (surfer.position + q * Vector3.new(0, 0, L * 0.45)) * S
	local turn = math.abs(surfer.yawRate) * math.clamp((speed - 3) / 5, 0, 1)
	local hard = surfer.move and 1 or 0
	local side = if surfer.yawRate > 0 then 1 else -1 -- turning left throws spray out to the right
	self.tail.CFrame = CFrame.lookAt(tailPos, tailPos + (q.RightVector * side * 0.8 + q.UpVector * 0.9 + q.LookVector * -0.3) * S)
		* CFrame.Angles(-math.pi / 2, 0, 0)
	self.tailE.Rate = if standing then math.clamp(turn * 60 + hard * 120, 0, 160) else 0
	local nosePos = origin + (surfer.position + q * Vector3.new(0, 0, -L * 0.45)) * S
	self.nose.CFrame = CFrame.lookAt(nosePos, nosePos + Vector3.new(0, 1, 0)) * CFrame.Angles(-math.pi / 2, 0, 0)
	local drop = math.clamp((surfer.effPitch - 0.35) / 0.4, 0, 1)
	local paddleIn = if surfer.catching then 0.6 else 0
	self.noseE.Rate = (drop * 80 + paddleIn * 30) * math.clamp(speed / 4, 0, 1)
end

return Spray
