-- The server's part (after js/net.js). Waves aren't sent over the network at all: every
-- spot has a random seed and the server's clock, and every player generates the same sets
-- from them. A change to the wave size carries the wave number it starts from, so everyone
-- switches on the same wave. Players' poses and events (barrels, wipeouts) are relayed to
-- the others.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local Lineup = ReplicatedStorage:WaitForChild("Lineup")
local Config = require(Lineup.Config)
local Spots = require(Lineup.Spots)

-- you are the surfer: no avatar walking around
Players.CharacterAutoLoads = false

local net = Instance.new("Folder")
net.Name = "LineupNet"
local setWaves = Instance.new("RemoteEvent")
setWaves.Name = "SetWaves"
setWaves.Parent = net
local pose = Instance.new("UnreliableRemoteEvent")
pose.Name = "Pose"
pose.Parent = net
local feed = Instance.new("RemoteEvent")
feed.Name = "Feed"
feed.Parent = net
local leave = Instance.new("RemoteEvent")
leave.Name = "Leave"
leave.Parent = net

local epoch = math.floor(workspace:GetServerTimeNow())
net:SetAttribute("Epoch", epoch)
local rng = Random.new()
for _, id in ipairs(Spots.ORDER) do
	local spot = Spots[id]
	net:SetAttribute("Seed_" .. id, rng:NextInteger(1, 2 ^ 30))
	net:SetAttribute("Waves_" .. id, HttpService:JSONEncode({ mode = "set", height = spot.heights.default }))
end
net.Parent = ReplicatedStorage

-- A change applies from the next wave to appear; the ones already rolling in keep their size.
setWaves.OnServerEvent:Connect(function(player, spotId, mode, height)
	local spot = Spots[spotId]
	if not spot or (mode ~= "set" and mode ~= "random") or type(height) ~= "number" or height ~= height then
		return
	end
	height = math.clamp(height, spot.heights.min, spot.heights.max)
	local ok, cur = pcall(HttpService.JSONDecode, HttpService, net:GetAttribute("Waves_" .. spotId))
	if not ok then
		return
	end
	if cur.mode == mode and cur.height == height then
		return
	end
	local w = table.clone(spot.wave)
	local spacing = w.spacing or Config.WAVE.spacing
	local speed = Config.WAVE.speed
	local t = workspace:GetServerTimeNow() - epoch
	local kNow = math.floor(t / (spacing / speed))
	local nextCfg = { mode = mode, height = height, fromK = kNow + 1, prev = { mode = cur.mode, height = cur.height } }
	net:SetAttribute("Waves_" .. spotId, HttpService:JSONEncode(nextCfg))
	feed:FireAllClients({ k = "waves", name = player.DisplayName, spot = spotId, mode = mode, height = height })
end)

-- Poses: relayed to everyone else (each client only draws those at its own spot).
local last = {}
pose.OnServerEvent:Connect(function(player, data)
	if type(data) ~= "buffer" or buffer.len(data) > 96 then
		return
	end
	local now = os.clock()
	if last[player] and now - last[player] < 1 / 20 then
		return
	end
	last[player] = now
	for _, p in ipairs(Players:GetPlayers()) do
		if p ~= player then
			pose:FireClient(p, player.UserId, data)
		end
	end
end)

-- Events for the feed: "<name> got barrelled", wiped out, a hang ten...
local KINDS = { tube = true, wipeout = true, hang = true, air = true, backflip = true, ride = true, spot = true }
feed.OnServerEvent:Connect(function(player, e)
	if type(e) ~= "table" or not KINDS[e.k] then
		return
	end
	local out = { k = e.k, name = player.DisplayName, id = player.UserId }
	for _, key in ipairs({ "spot", "n", "time", "score", "reason" }) do
		local v = e[key]
		if type(v) == "number" or (type(v) == "string" and #v < 80) then
			out[key] = v
		end
	end
	for _, p in ipairs(Players:GetPlayers()) do
		if p ~= player then
			feed:FireClient(p, out)
		end
	end
end)

Players.PlayerRemoving:Connect(function(player)
	last[player] = nil
	leave:FireAllClients(player.UserId)
end)
