-- Pulls roblox/src into the open place. Serve roblox/src over HTTP first:
--   python roblox/serve.py
-- then paste this into Studio's command bar. Paths map to instances:
--   ReplicatedStorage/Lineup/Config.luau                  -> ModuleScript
--   ServerScriptService/LineupServer.server.luau          -> Script
--   StarterPlayer/StarterPlayerScripts/Main.client.luau   -> LocalScript
local HttpService = game:GetService("HttpService")
local BASE = "http://127.0.0.1:8765/"
local was = HttpService.HttpEnabled
HttpService.HttpEnabled = true
local ok, err = pcall(function()
	local index = HttpService:GetAsync(BASE .. "index.txt", true)
	local n = 0
	for path in index:gmatch("[^\r\n]+") do
		local parts = string.split(path, "/")
		local parent = game:GetService(parts[1])
		for i = 2, #parts - 1 do
			local f = parent:FindFirstChild(parts[i])
			if not f then
				f = Instance.new("Folder")
				f.Name = parts[i]
				f.Parent = parent
			end
			parent = f
		end
		local file = parts[#parts]
		local name, class = file:match("^(.-)%.server%.luau$"), "Script"
		local worker = false
		if not name then
			name, class = file:match("^(.-)%.client%.luau$"), "LocalScript"
		end
		if not name then
			-- an actor's script: a client Script, off until it's cloned into its Actor
			name, class = file:match("^(.-)%.worker%.luau$"), "Script"
			worker = name ~= nil
		end
		if not name then
			name, class = file:match("^(.-)%.luau$"), "ModuleScript"
		end
		local src = HttpService:GetAsync(BASE .. path, true)
		local inst = parent:FindFirstChild(name)
		if inst and inst.ClassName ~= class then
			inst:Destroy()
			inst = nil
		end
		if not inst then
			inst = Instance.new(class)
			inst.Name = name
			inst.Parent = parent
		end
		inst.Source = src
		if worker then
			inst.RunContext = Enum.RunContext.Client
			inst.Enabled = false
		end
		n += 1
	end
	print(("[sync] %d scripts"):format(n))
end)
HttpService.HttpEnabled = was
assert(ok, err)
