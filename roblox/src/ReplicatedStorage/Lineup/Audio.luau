-- Sound (after js/audio.js, which synthesises it; here it's recorded): the sea all around,
-- the roar of breaking whitewater swelling as you get near it, the water rushing past the
-- board as you ride, splashes, strokes, whooshes for tricks, and muffled bubbles under water.

local SoundService = game:GetService("SoundService")

local WM = require(script.Parent.WaveModel)

local IDS = {
	calm = "rbxassetid://77187178830160", -- relaxing ocean waves (the lineup)
	surf = "rbxassetid://102792276036682", -- crashing waves (whitewater nearby)
	under = "rbxassetid://9120348216", -- underwater movement
	splash = "rbxassetid://9125703162",
	stroke = "rbxassetid://9125702803",
	whoosh = "rbxassetid://9126229267",
	plunge = "rbxassetid://9120348019",
}

local Audio = {}
Audio.__index = Audio

local function sound(name, id, vol, looped, parent)
	local s = Instance.new("Sound")
	s.Name = name
	s.SoundId = id
	s.Volume = vol
	s.Looped = looped
	s.Parent = parent
	return s
end

function Audio.new()
	local self = setmetatable({}, Audio)
	local group = Instance.new("SoundGroup")
	group.Name = "Lineup"
	group.Volume = 1
	group.Parent = SoundService
	local eq = Instance.new("EqualizerSoundEffect")
	eq.Name = "Muffle"
	eq.HighGain = 0
	eq.MidGain = 0
	eq.LowGain = 0
	eq.Enabled = false
	eq.Parent = group
	self.group = group
	self.eq = eq
	self.calm = sound("Calm", IDS.calm, 0, true, group)
	self.surf = sound("Surf", IDS.surf, 0, true, group)
	self.rush = sound("Rush", IDS.surf, 0, true, group)
	self.rush.PlaybackSpeed = 1.6
	self.under = sound("Under", IDS.under, 0, true, group)
	for _, s in ipairs({ self.calm, self.surf, self.rush, self.under }) do
		s.SoundGroup = group
	end
	self.oneShots = {}
	for _, n in ipairs({ "splash", "stroke", "whoosh", "plunge" }) do
		self.oneShots[n] = sound(n, IDS[n], 0.6, false, group)
		self.oneShots[n].SoundGroup = group
	end
	self.on = false
	self.levels = { calm = 0, surf = 0, rush = 0, under = 0 }
	return self
end

function Audio:ambient(on)
	self.on = on
	for _, s in ipairs({ self.calm, self.surf, self.rush, self.under }) do
		if on and not s.IsPlaying then
			s:Play()
		end
	end
end

local PITCH = { splash = 1, stroke = 1.35, whoosh = 1.1, plunge = 1, thud = 0.6 }
function Audio:play(name, vol)
	local base = if name == "thud" then "splash" else name
	local s = self.oneShots[base]
	if not s then
		return
	end
	local c = s:Clone()
	c.Volume = 0.6 * (vol or 1) * (if name == "thud" then 1.6 else 1)
	c.PlaybackSpeed = (PITCH[name] or 1) * (0.92 + math.random() * 0.16)
	c.Parent = self.group
	c:Play()
	c.Ended:Once(function()
		c:Destroy()
	end)
end

-- every frame: how near whitewater is, how fast you're going, and whether you're under
function Audio:update(dt, surfer, model, camSim)
	if not self.on then
		return
	end
	-- the loudest whitewater within earshot
	local roar = 0
	for _, w in ipairs(model.waves) do
		if w.active and w.H > 0.3 then
			local sc = model:section(w, camSim.X, camSim.Z, {})
			local u = camSim.Z - (w.crestZ0 + WM.crestOffset(camSim.X))
			local near = math.exp(-math.max(0, math.abs(u) - 4) / 25)
			roar = math.max(roar, math.max(sc.kappa, sc.b * 0.6) * near * math.min(1, w.H / 2))
		end
	end
	local under = surfer.diveDepth > 0.3 or surfer.turtle > 0.6 or surfer.state == "wipeout"
	local speed = surfer:planeSpeed()
	local riding = surfer.state == "standing" and not surfer.air
	local target = {
		calm = if under then 0.08 else 0.5,
		surf = (if under then 0.25 else 0.85) * roar,
		rush = if riding then math.clamp((speed - 2) / 8, 0, 1) * 0.35 else 0,
		under = if under then 0.6 else 0,
	}
	local k = 1 - math.exp(-dt * 4)
	for n, v in pairs(target) do
		self.levels[n] += (v - self.levels[n]) * k
		self[n].Volume = self.levels[n]
	end
	self.eq.Enabled = under
	if under then
		self.eq.HighGain = -30
		self.eq.MidGain = -12
	end
end

return Audio
