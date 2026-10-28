-- Whitewater as particles (the web version paints foam in its water shader; on Roblox the
-- water is one translucent colour and the foam is this): churning puffs along the broken
-- bore, flat sheets of foam left lying on the water behind it, the explosion where the lip
-- lands, and the boiling crest of a small wave spilling. A pool of emitters is handed out
-- each frame to the sections near the camera that need them most; as an emitter moves with
-- the wave, what it has already thrown stays behind, so the foam trails the bore as it does
-- on the sea.

local Config = require(script.Parent.Config)
local WM = require(script.Parent.WaveModel)

local S = Config.SCALE
local CURL = WM.CURL
local WAVE = Config.WAVE

local Foam = {}
Foam.__index = Foam

local TEX = "rbxasset://textures/particles/smoke_main.dds"
local WHITE = ColorSequence.new(Color3.fromRGB(246, 250, 252))
local NS, NK = NumberSequence.new, NumberSequenceKeypoint.new

local function emitter(parent, props)
	local e = Instance.new("ParticleEmitter")
	e.Texture = TEX
	e.Color = WHITE
	e.LightInfluence = 0.9
	e.LightEmission = 0.05
	e.Rate = 0
	e.Rotation = NumberRange.new(0, 360)
	for k, v in pairs(props) do
		e[k] = v
	end
	e.Parent = parent
	return e
end

-- quality: "high" or "low" (fewer emitters, sparser)
function Foam.new(parent, quality)
	local self = setmetatable({}, Foam)
	local low = quality == "low"
	self.low = low
	self.n = if low then 18 else 44
	self.step = if low then 9 else 5 -- metres between emitters along a wave
	local folder = Instance.new("Folder")
	folder.Name = "Foam"
	folder.Parent = parent
	self.folder = folder
	self.slots = {}
	for i = 1, self.n do
		local p = Instance.new("Part")
		p.Name = "FoamEmitter"
		p.Size = Vector3.new(1, 0.2, 1)
		p.Transparency = 1
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.Parent = folder
		local slot = { part = p }
		-- churning whitewater: puffs that boil up and sink back
		slot.churn = emitter(p, {
			Size = NS({ NK(0, 1.2 * S), NK(0.4, 2.6 * S), NK(1, 3.2 * S) }),
			Transparency = NS({ NK(0, 0.25), NK(0.6, 0.45), NK(1, 1) }),
			Lifetime = NumberRange.new(1.2, 2.2),
			Speed = NumberRange.new(0.6 * S, 2.2 * S),
			SpreadAngle = Vector2.new(70, 70),
			Acceleration = Vector3.new(0, -2.5 * S, 0),
			Drag = 1.2,
			RotSpeed = NumberRange.new(-30, 30),
			EmissionDirection = Enum.NormalId.Top,
		})
		-- foam lying on the water: flat sheets (they face the way they move: straight up)
		slot.sheet = emitter(p, {
			Size = NS({ NK(0, 2.5 * S), NK(1, 5 * S) }),
			Transparency = NS({ NK(0, 0.35), NK(0.7, 0.6), NK(1, 1) }),
			Lifetime = NumberRange.new(4, 7),
			Speed = NumberRange.new(0.01, 0.02),
			SpreadAngle = Vector2.new(0, 0),
			Orientation = Enum.ParticleOrientation.VelocityPerpendicular,
			EmissionDirection = Enum.NormalId.Top,
			RotSpeed = NumberRange.new(-6, 6),
		})
		self.slots[i] = slot
	end
	-- (the explosion where the lip lands: one emitter that bursts)
	return self
end

function Foam:destroy()
	self.folder:Destroy()
end

local _cp = {}

-- Every frame: hand the emitters out along the broken sections near the camera.
function Foam:update(dt, model, origin, camSim)
	local cands = {}
	local camX, camZ = camSim.X, camSim.Z
	for _, w in ipairs(model.waves) do
		if not w.active or w.H < 0.35 or w.tau < -1 then
			continue
		end
		local x0 = math.floor((camX - 160) / self.step) * self.step
		for x = x0, camX + 160, self.step do
			local crestZ = w.crestZ0 + WM.crestOffset(x)
			local sc = model:section(w, x, crestZ, {})
			if sc.H < 0.25 then
				continue
			end
			local d = math.sqrt((x - camX) ^ 2 + (crestZ - camZ) ^ 2)
			if d > 220 then
				continue
			end
			local spillAmt = sc.spill * math.clamp(sc.age, 0, 1)
			local churn = math.max(sc.kappa, spillAmt * 0.8)
			local lip = sc.b * (1 - sc.kappa) * math.clamp((sc.b - 0.6) / 0.4, 0, 1)
			local amt = math.max(churn, lip * 0.9)
			if amt < 0.08 then
				continue
			end
			-- where: the front of the bore (or the crest of a spilling wave), or where the lip lands
			local un
			if lip > churn then
				local zc = (CURL.lfLo + (CURL.lfHi - CURL.lfLo) * sc.steep) * CURL.acoshYc + CURL.rin * CURL.ex
				un = zc + CURL.ex * (CURL.rin * 1.22 + 0.04) * math.cos(math.pi - CURL.sweep)
			else
				un = if sc.kappa > 0.3 then 0.4 + 0.6 * sc.kappa else 0.05
			end
			table.insert(cands, { w = w, x = x, un = un, amt = amt, H = sc.H, S = sc.S, d = d, lip = lip > churn, kappa = sc.kappa })
		end
	end
	-- the nearest and strongest first
	table.sort(cands, function(a, b)
		return a.amt / (1 + a.d / 60) > b.amt / (1 + b.d / 60)
	end)
	local rateK = if self.low then 0.6 else 1
	for i, slot in ipairs(self.slots) do
		local c = cands[i]
		if not c then
			slot.churn.Rate = 0
			slot.sheet.Rate = 0
			continue
		end
		local row = c.w.crestZ0 + c.un * c.S
		local y = model:heightAt(c.x, row + WM.crestOffset(c.x))
		slot.part.Position = origin + Vector3.new(c.x, y + 0.2, row + WM.crestOffset(c.x)) * S
		local big = math.clamp(c.H / 2, 0.4, 1.6)
		slot.churn.Rate = c.amt * (if c.lip then 30 else 18) * big * rateK
		slot.churn.Size = NS({ NK(0, 1.1 * big * S), NK(0.4, 2.4 * big * S), NK(1, 3 * big * S) })
		slot.churn.Speed = NumberRange.new(0.5 * S, (if c.lip then 4 else 2) * big * S)
		-- sheets of foam left behind the bore
		slot.sheet.Rate = if c.lip then 0 else c.kappa * 3 * big * rateK
	end
end

return Foam
