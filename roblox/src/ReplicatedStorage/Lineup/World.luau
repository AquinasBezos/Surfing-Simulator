-- Light and sky for each time of day (after js/sky.js and TIMES_OF_DAY in js/config.js),
-- and the underwater look (js/underwater.js): the colour of the water around you, limited
-- visibility and a blur when the camera goes under.
--
-- The web game puts the sun out over the sea so the waves are backlit when you look out the
-- back. Roblox's sun follows ClockTime and GeographicLatitude; at latitude -22 these clock
-- times put it exactly where the web game's is in each spot's frame (+z toward the beach):
--   midday: ClockTime 14.1 (37 degrees up, out to sea and to the left)
--   sunset: ClockTime 6.4 (4.3 degrees up, out to sea and to the right)

local Lighting = game:GetService("Lighting")

local Config = require(script.Parent.Config)

local World = {}

local function ensure(class, name)
	local o = Lighting:FindFirstChild(name)
	if not o or o.ClassName ~= class then
		if o then
			o:Destroy()
		end
		o = Instance.new(class)
		o.Name = name
		o.Parent = Lighting
	end
	return o
end

local LOOK = {
	day = {
		clock = 14.1,
		brightness = 3.2,
		ambient = Color3.fromRGB(70, 80, 90),
		outdoor = Color3.fromRGB(140, 152, 164),
		exposure = 0,
		atmo = { Density = 0.14, Offset = 0, Color = Color3.fromRGB(199, 220, 240), Decay = Color3.fromRGB(106, 140, 175), Glare = 0.3, Haze = 0.4 },
		grade = { Brightness = 0.0, Contrast = 0.05, Saturation = 0, TintColor = Color3.fromRGB(255, 253, 248) },
		bloom = { Intensity = 0.6, Size = 26, Threshold = 1.6 },
		rays = { Intensity = 0.04, Spread = 0.6 },
		zenith = Color3.fromRGB(110, 150, 196),
		horizon = Color3.fromRGB(200, 215, 226),
		water = Color3.new(0.78, 0.8, 0.8), -- how brightly the water's body is lit
	},
	sunset = {
		clock = 6.4,
		brightness = 2.4,
		ambient = Color3.fromRGB(70, 52, 70),
		outdoor = Color3.fromRGB(150, 110, 130),
		exposure = 0.15,
		atmo = { Density = 0.2, Offset = 0.03, Color = Color3.fromRGB(255, 178, 130), Decay = Color3.fromRGB(122, 74, 112), Glare = 3, Haze = 1.2 },
		grade = { Brightness = 0.02, Contrast = 0.12, Saturation = 0.18, TintColor = Color3.fromRGB(255, 232, 214) },
		bloom = { Intensity = 0.9, Size = 34, Threshold = 1.3 },
		rays = { Intensity = 0.12, Spread = 0.8 },
		zenith = Color3.fromRGB(80, 80, 140),
		horizon = Color3.fromRGB(240, 160, 120),
		water = Color3.new(0.64, 0.52, 0.54),
	},
}
World.LOOK = LOOK

-- Graphics: "high" or "low". Low drops shadows, bloom and sun rays: they cost the GPU and the
-- render thread every frame for little on open water.
World.quality = "high"
function World.setQuality(q)
	World.quality = q
	if World.time then
		World.applyTime(World.time)
	end
end

function World.applyTime(name)
	local L = LOOK[name] or LOOK.day
	World.time = name
	local high = World.quality ~= "low"
	Lighting.GeographicLatitude = -22
	Lighting.ClockTime = L.clock
	Lighting.Brightness = L.brightness
	Lighting.Ambient = L.ambient
	Lighting.OutdoorAmbient = L.outdoor
	Lighting.ExposureCompensation = L.exposure
	Lighting.EnvironmentDiffuseScale = 1
	Lighting.EnvironmentSpecularScale = 0.6
	Lighting.GlobalShadows = high
	Lighting.ShadowSoftness = 0.2
	pcall(function()
		Lighting.Technology = Enum.Technology.Future
	end)
	local atmo = ensure("Atmosphere", "Atmosphere")
	for k, v in pairs(L.atmo) do
		atmo[k] = v
	end
	local sky = ensure("Sky", "Sky")
	sky.SunAngularSize = if name == "sunset" then 14 else 11
	sky.CelestialBodiesShown = true
	sky.StarCount = 0
	local cc = ensure("ColorCorrectionEffect", "Grade")
	for k, v in pairs(L.grade) do
		cc[k] = v
	end
	cc.Enabled = true
	local bloom = ensure("BloomEffect", "Bloom")
	for k, v in pairs(L.bloom) do
		bloom[k] = v
	end
	bloom.Enabled = high
	local rays = ensure("SunRaysEffect", "SunRays")
	for k, v in pairs(L.rays) do
		rays[k] = v
	end
	rays.Enabled = high
	-- underwater (off until the camera goes under)
	local uw = ensure("ColorCorrectionEffect", "Underwater")
	uw.Enabled = false
	local blur = ensure("BlurEffect", "UnderwaterBlur")
	blur.Size = 6
	blur.Enabled = false
	World.base = L
	return L
end

-- The sun's direction in the simulation frame, its colour and the sky colours, for the
-- water's shading (Ocean:setLight).
function World.light(name)
	local T = Config.TIMES_OF_DAY[name] or Config.TIMES_OF_DAY.day
	local L = LOOK[name] or LOOK.day
	return T.sunDir, T.sunColor, L.zenith, L.horizon, L.water
end

-- depth: how far under the surface the camera is (m, <= 0 above it); water: the spot's
-- water colours.
local underNow = false
function World.underwater(depth, water)
	local under = depth > 0
	local uw = Lighting:FindFirstChild("Underwater")
	local blur = Lighting:FindFirstChild("UnderwaterBlur")
	local atmo = Lighting:FindFirstChild("Atmosphere")
	if not uw or not World.base then
		return
	end
	if under ~= underNow then
		underNow = under
		uw.Enabled = under
		blur.Enabled = under
		if under then
			atmo.Density = 0.65
			atmo.Offset = 0
			atmo.Haze = 0
			atmo.Glare = 0
			atmo.Color = water.underwater
			atmo.Decay = water.deep
		else
			for k, v in pairs(World.base.atmo) do
				atmo[k] = v
			end
		end
	end
	if under then
		local k = math.clamp(depth / 3, 0, 1)
		uw.TintColor = water.underwater:Lerp(Color3.new(0.1, 0.25, 0.3), k * 0.4)
		uw.Brightness = -0.05 - 0.1 * k
		uw.Contrast = -0.1
		uw.Saturation = 0.1
	end
end

return World
