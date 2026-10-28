-- Main menu and pause menu (after js/menu.js): pick a surf spot, your board, the waves and
-- the time of day, then paddle out. Every button is selectable, so a controller (D-pad /
-- left stick, A to pick, B to go back) works as well as the mouse and touch.

local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")
local UserInputService = game:GetService("UserInputService")

local Spots = require(script.Parent.Spots)
local Hud = require(script.Parent.Hud)

local new, label, corner, stroke = Hud.new_, Hud.label, Hud.corner, Hud.stroke
local INK, DIM, SKY, ACCENT, PANEL = Hud.INK, Hud.DIM, Hud.SKY, Hud.ACCENT, Hud.PANEL
local FONT, FONT_BOLD, FONT_HEAVY = Hud.FONT, Hud.FONT_BOLD, Hud.FONT_HEAVY

local IMAGES = {
	background = "rbxassetid://101156562474934",
	margaret = "rbxassetid://98952662489127",
	teahupoo = "rbxassetid://134923233386521",
	pool = "rbxassetid://123692582936590",
}

local CONTROLS = {
	pc = {
		{ "Paddle", "Scroll the mouse wheel (faster = harder), or click left / right for single strokes" },
		{ "Steer · carve", "A / D" },
		{ "Trim · stall", "W / S (longboard: walk to the nose / tail)" },
		{ "Sit up and wait", "S while paddling; W to lie back down" },
		{ "Pop up", "Space (again to lie down)" },
		{ "Duck dive · crouch", "Hold Ctrl or C" },
		{ "Snap · cutback · tailslide", "Hold Shift and flick the mouse sideways" },
		{ "Air", "Crouch up the face, let go at the lip" },
		{ "Back to the lineup · pause", "R · Tab" },
	},
	pad = {
		{ "Paddle", "Pull LT and RT in turn: left and right arm strokes" },
		{ "Steer · carve · trim", "Left stick" },
		{ "Sit up / lie down", "Left stick back / forward while paddling" },
		{ "Pop up", "A" },
		{ "Duck dive · crouch", "Hold B" },
		{ "Snap · cutback · tailslide", "Hold LB or RB and flick the right stick" },
		{ "Look around", "Right stick" },
		{ "Back to the lineup · pause", "Y · View" },
	},
	touch = {
		{ "Paddle", "Paddle left / right buttons: tap, or hold to keep stroking" },
		{ "Steer · carve · trim", "The joystick, bottom left" },
		{ "Pop up", "Stand up, once you're moving or a wave has you" },
		{ "Duck dive", "Hold Duck dive" },
		{ "Crouch · tricks", "Crouch, and hold Snap while you swipe sideways" },
		{ "Look around", "Drag anywhere else" },
	},
}

local Menu = {}
Menu.__index = Menu

local function button(props, onClick)
	local b = new("TextButton", {
		BackgroundColor3 = Color3.fromRGB(255, 255, 255),
		BackgroundTransparency = 0.92,
		FontFace = FONT_BOLD,
		TextColor3 = INK,
		TextSize = 18,
		AutoButtonColor = true,
		Selectable = true,
	}, { corner(10), stroke(Color3.new(1, 1, 1), 1, 0.82) })
	for k, v in pairs(props) do
		b[k] = v
	end
	b.Activated:Connect(onClick)
	return b
end

local function sectionTitle(text, order, parent)
	local l = label({ Size = UDim2.new(1, 0, 0, 20), Text = string.upper(text), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = DIM, TextSize = 14, FontFace = FONT_BOLD, LayoutOrder = order })
	l.Parent = parent
	return l
end

function Menu.new(settings)
	local self = setmetatable({}, Menu)
	self.settings = settings
	self.onPlay = nil
	self.onResume = nil
	self.onLineup = nil
	self.onQuit = nil
	self.onChange = nil

	local gui = new("ScreenGui", {
		Name = "LineupMenu",
		ResetOnSpawn = false,
		IgnoreGuiInset = true,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		DisplayOrder = 5,
	})
	self.gui = gui

	------------------------------------------------------------ main menu
	local main = new("ImageLabel", {
		Name = "Main",
		Size = UDim2.new(1, 0, 1, 0),
		Image = IMAGES.background,
		ScaleType = Enum.ScaleType.Crop,
		BackgroundColor3 = Color3.fromRGB(27, 34, 40),
	})
	main.Parent = gui
	self.main = main
	new("Frame", {
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundColor3 = Color3.fromRGB(8, 16, 22),
		BackgroundTransparency = 0.45,
		Parent = main,
	})
	local scroll = new("ScrollingFrame", {
		Name = "Scroll",
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundTransparency = 1,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		ScrollBarThickness = 6,
		ScrollingDirection = Enum.ScrollingDirection.Y,
		Selectable = false,
	}, {
		new("UIListLayout", { Padding = UDim.new(0, 14), HorizontalAlignment = Enum.HorizontalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }),
		new("UIPadding", { PaddingTop = UDim.new(0, 28), PaddingBottom = UDim.new(0, 40), PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16) }),
	})
	scroll.Parent = main

	local title = label({ Size = UDim2.new(1, 0, 0, 84), Text = "LINEUP", FontFace = FONT_HEAVY, TextSize = 84, LayoutOrder = 1 })
	new("UIStroke", { Color = Color3.fromRGB(10, 30, 40), Thickness = 3, Transparency = 0.4, Parent = title })
	title.Parent = scroll
	label({ Size = UDim2.new(1, 0, 0, 22), Text = "Paddle into glassy waves, pop up, and race the peeling lip through the barrel.", TextColor3 = DIM, TextSize = 18, TextWrapped = true, LayoutOrder = 2, Parent = scroll })

	local panel = new("Frame", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.2,
		LayoutOrder = 3,
	}, {
		new("UISizeConstraint", { MaxSize = Vector2.new(860, math.huge) }),
		corner(16),
		stroke(Color3.new(1, 1, 1), 1, 0.86),
		new("UIPadding", { PaddingTop = UDim.new(0, 16), PaddingBottom = UDim.new(0, 18), PaddingLeft = UDim.new(0, 18), PaddingRight = UDim.new(0, 18) }),
		new("UIListLayout", { Padding = UDim.new(0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	panel.Parent = scroll

	-- spots
	sectionTitle("Location", 1, panel)
	local spotRow = new("Frame", { Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = 2 }, {
		new("UIGridLayout", { CellSize = UDim2.new(0.333, -8, 0, 150), CellPadding = UDim2.new(0, 10, 0, 10), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	spotRow.Parent = panel
	self.spotCards = {}
	for i, id in ipairs(Spots.ORDER) do
		local spot = Spots[id]
		local card = new("ImageButton", {
			Name = id,
			Image = IMAGES[id],
			ScaleType = Enum.ScaleType.Crop,
			BackgroundColor3 = Color3.fromRGB(30, 40, 48),
			LayoutOrder = i,
			Selectable = true,
		}, { corner(12) })
		local sel = stroke(SKY, 3, 1)
		sel.Parent = card
		local shade = new("Frame", {
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.new(0, 0, 1, 0),
			Size = UDim2.new(1, 0, 0, 52),
			BackgroundColor3 = Color3.new(0, 0, 0),
			BackgroundTransparency = 0.35,
		}, { corner(12) })
		shade.Parent = card
		label({ Position = UDim2.new(0, 10, 0, 4), Size = UDim2.new(1, -20, 0, 22), Text = spot.name, FontFace = FONT_BOLD, TextSize = 19, TextXAlignment = Enum.TextXAlignment.Left, Parent = shade })
		label({ Position = UDim2.new(0, 10, 0, 26), Size = UDim2.new(1, -20, 0, 18), Text = spot.place, TextColor3 = DIM, TextSize = 14, TextXAlignment = Enum.TextXAlignment.Left, Parent = shade })
		card.Activated:Connect(function()
			self.settings.spot = id
			self:refresh()
		end)
		card.Parent = spotRow
		self.spotCards[id] = sel
	end
	self.blurb = label({ Size = UDim2.new(1, 0, 0, 20), TextColor3 = DIM, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, LayoutOrder = 3 })
	self.blurb.Parent = panel

	-- options: board, waves, time of day
	local function choiceRow(name, order, choices, get, set)
		local row = new("Frame", { Size = UDim2.new(1, 0, 0, 44), BackgroundTransparency = 1, LayoutOrder = order }, {
			new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), VerticalAlignment = Enum.VerticalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }),
		})
		label({ Size = UDim2.new(0, 110, 1, 0), Text = name, TextXAlignment = Enum.TextXAlignment.Left, FontFace = FONT_BOLD, TextSize = 18, LayoutOrder = 0, Parent = row })
		local btns = {}
		for i, c in ipairs(choices) do
			local b = button({ Size = UDim2.new(0, 130, 0, 40), Text = c[2], LayoutOrder = i }, function()
				set(c[1])
				self:refresh()
			end)
			b.Parent = row
			btns[c[1]] = b
		end
		row.Parent = panel
		table.insert(self.rows, function()
			for k, b in pairs(btns) do
				local on = get() == k
				b.BackgroundColor3 = if on then SKY else Color3.new(1, 1, 1)
				b.BackgroundTransparency = if on then 0.05 else 0.92
				b.TextColor3 = if on then Color3.fromRGB(10, 30, 40) else INK
			end
		end)
		return row
	end
	self.rows = {}
	sectionTitle("Your session", 4, panel)
	choiceRow("Board", 5, { { "shortboard", "Shortboard" }, { "longboard", "Longboard" } }, function()
		return self.settings.board
	end, function(v)
		self.settings.board = v
	end)
	choiceRow("Time", 6, { { "day", "Midday" }, { "sunset", "Sunset" } }, function()
		return self.settings.time
	end, function(v)
		self.settings.time = v
	end)
	self.wavesRow = self:wavesControl(panel, 7)

	self.play = button({
		Size = UDim2.new(1, 0, 0, 58),
		Text = "Paddle out",
		FontFace = FONT_HEAVY,
		TextSize = 30,
		BackgroundColor3 = ACCENT,
		BackgroundTransparency = 0,
		LayoutOrder = 9,
	}, function()
		if self.onPlay then
			self.onPlay()
		end
	end)
	self.play.Parent = panel

	-- the controls for whatever you're using
	local ctl = new("Frame", {
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.3,
		LayoutOrder = 4,
	}, {
		new("UISizeConstraint", { MaxSize = Vector2.new(860, math.huge) }),
		corner(16),
		new("UIPadding", { PaddingTop = UDim.new(0, 14), PaddingBottom = UDim.new(0, 14), PaddingLeft = UDim.new(0, 18), PaddingRight = UDim.new(0, 18) }),
		new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	ctl.Parent = scroll
	self.controls = ctl
	label({
		Size = UDim2.new(1, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		TextWrapped = true,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextColor3 = DIM,
		TextSize = 15,
		LayoutOrder = 99,
		Text = "How to catch a wave: the top right counts down to the next one. Face the beach and paddle hard a few seconds before it reaches you. When it says Caught it!, pop up straight away, then angle along the face the way it's breaking. Slow down just ahead of the lip and crouch to get barrelled.",
		Parent = ctl,
	})

	------------------------------------------------------------ pause menu
	local pause = new("Frame", {
		Name = "Pause",
		Size = UDim2.new(1, 0, 1, 0),
		BackgroundColor3 = Color3.fromRGB(8, 16, 22),
		BackgroundTransparency = 0.4,
		Visible = false,
	})
	pause.Parent = gui
	self.pause = pause
	local pp = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.5, 0),
		Size = UDim2.new(0, 420, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.1,
	}, {
		corner(16),
		stroke(Color3.new(1, 1, 1), 1, 0.86),
		new("UISizeConstraint", { MaxSize = Vector2.new(math.huge, 700) }),
		new("UIPadding", { PaddingTop = UDim.new(0, 16), PaddingBottom = UDim.new(0, 16), PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16) }),
		new("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	pp.Parent = pause
	label({ Size = UDim2.new(1, 0, 0, 40), Text = "Paused", FontFace = FONT_HEAVY, TextSize = 36, LayoutOrder = 0, Parent = pp })
	self.resume = button({ Size = UDim2.new(1, 0, 0, 48), Text = "Resume", BackgroundColor3 = ACCENT, BackgroundTransparency = 0, LayoutOrder = 1 }, function()
		if self.onResume then
			self.onResume()
		end
	end)
	self.resume.Parent = pp
	button({ Size = UDim2.new(1, 0, 0, 44), Text = "Back to the lineup", LayoutOrder = 2 }, function()
		if self.onLineup then
			self.onLineup()
		end
	end).Parent = pp
	self.pauseWaves = self:wavesControl(pp, 3)
	local timeBtn
	timeBtn = button({ Size = UDim2.new(1, 0, 0, 44), Text = "", LayoutOrder = 4 }, function()
		self.settings.time = if self.settings.time == "day" then "sunset" else "day"
		if self.onChange then
			self.onChange("time")
		end
		self:refresh()
	end)
	timeBtn.Parent = pp
	self.timeBtn = timeBtn
	local sensBtn
	sensBtn = button({ Size = UDim2.new(1, 0, 0, 44), Text = "", LayoutOrder = 5 }, function()
		local steps = { 0.5, 0.75, 1, 1.5, 2 }
		local i = table.find(steps, self.settings.sensitivity) or 3
		self.settings.sensitivity = steps[i % #steps + 1]
		self:refresh()
	end)
	sensBtn.Parent = pp
	self.sensBtn = sensBtn
	local invBtn
	invBtn = button({ Size = UDim2.new(1, 0, 0, 44), Text = "", LayoutOrder = 6 }, function()
		self.settings.invertY = not self.settings.invertY
		self:refresh()
	end)
	invBtn.Parent = pp
	self.invBtn = invBtn
	local gfxBtn
	gfxBtn = button({ Size = UDim2.new(1, 0, 0, 44), Text = "", LayoutOrder = 7 }, function()
		self.settings.quality = if self.settings.quality == "high" then "low" else "high"
		if self.onChange then
			self.onChange("quality")
		end
		self:refresh()
	end)
	gfxBtn.Parent = pp
	self.gfxBtn = gfxBtn
	button({ Size = UDim2.new(1, 0, 0, 44), Text = "Change spot or board", LayoutOrder = 8 }, function()
		if self.onQuit then
			self.onQuit()
		end
	end).Parent = pp

	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	self:refresh()
	return self
end

-- the waves setting: a size you pick, or Random (sets build and fade)
function Menu:wavesControl(parent, order)
	local row = new("Frame", { Size = UDim2.new(1, 0, 0, 44), BackgroundTransparency = 1, LayoutOrder = order }, {
		new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), VerticalAlignment = Enum.VerticalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	label({ Size = UDim2.new(0, 110, 1, 0), Text = "Waves", TextXAlignment = Enum.TextXAlignment.Left, FontFace = FONT_BOLD, TextSize = 18, LayoutOrder = 0, Parent = row })
	local function change(d)
		local spot = Spots[self.settings.spot]
		local w = self.settings.waves[self.settings.spot]
		w.mode = "set"
		w.height = math.clamp(math.floor((w.height + d) * 10 + 0.5) / 10, spot.heights.min, spot.heights.max)
		if self.onChange then
			self.onChange("waves")
		end
		self:refresh()
	end
	button({ Size = UDim2.new(0, 44, 0, 40), Text = "−", TextSize = 26, LayoutOrder = 1 }, function()
		change(-0.2)
	end).Parent = row
	local value = label({ Size = UDim2.new(0, 90, 1, 0), FontFace = FONT_BOLD, TextSize = 20, LayoutOrder = 2 })
	value.Parent = row
	button({ Size = UDim2.new(0, 44, 0, 40), Text = "+", TextSize = 26, LayoutOrder = 3 }, function()
		change(0.2)
	end).Parent = row
	local rnd = button({ Size = UDim2.new(0, 110, 0, 40), Text = "Random", LayoutOrder = 4 }, function()
		local w = self.settings.waves[self.settings.spot]
		w.mode = if w.mode == "random" then "set" else "random"
		if self.onChange then
			self.onChange("waves")
		end
		self:refresh()
	end)
	rnd.Parent = row
	row.Parent = parent
	table.insert(self.rows, function()
		local w = self.settings.waves[self.settings.spot]
		local random = w.mode == "random"
		value.Text = if random then "sets" else ("%.1f m"):format(w.height)
		value.TextColor3 = if random then DIM else INK
		rnd.BackgroundColor3 = if random then SKY else Color3.new(1, 1, 1)
		rnd.BackgroundTransparency = if random then 0.05 else 0.92
		rnd.TextColor3 = if random then Color3.fromRGB(10, 30, 40) else INK
	end)
	return row
end

function Menu:refresh()
	for id, sel in pairs(self.spotCards) do
		sel.Transparency = if id == self.settings.spot then 0 else 1
	end
	self.blurb.Text = Spots[self.settings.spot].blurb
	for _, f in ipairs(self.rows) do
		f()
	end
	self.timeBtn.Text = "Time of day: " .. (if self.settings.time == "day" then "Midday" else "Sunset")
	self.sensBtn.Text = ("Look sensitivity: %.2gx"):format(self.settings.sensitivity)
	self.invBtn.Text = "Invert look: " .. (if self.settings.invertY then "On" else "Off")
	self.gfxBtn.Text = "Graphics: " .. (if self.settings.quality == "high" then "High" else "Low (faster)")
end

function Menu:setControls(device)
	for _, c in ipairs(self.controls:GetChildren()) do
		if c:GetAttribute("ControlRow") then
			c:Destroy()
		end
	end
	for i, row in ipairs(CONTROLS[device] or CONTROLS.pc) do
		local f = new("Frame", { Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, BackgroundTransparency = 1, LayoutOrder = i })
		f:SetAttribute("ControlRow", true)
		label({ Size = UDim2.new(0.36, 0, 0, 20), Text = row[1], FontFace = FONT_BOLD, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, Parent = f })
		label({ Position = UDim2.new(0.36, 0, 0, 0), Size = UDim2.new(0.64, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextWrapped = true, Text = row[2], TextColor3 = DIM, TextSize = 16, TextXAlignment = Enum.TextXAlignment.Left, Parent = f })
		f.Parent = self.controls
	end
end

function Menu:showMain(v)
	self.main.Visible = v
	if v then
		self:refresh()
		if UserInputService.GamepadEnabled then
			GuiService.SelectedObject = self.play
		end
	end
end

function Menu:showPause(v)
	self.pause.Visible = v
	if v then
		self:refresh()
		if UserInputService.GamepadEnabled then
			GuiService.SelectedObject = self.resume
		end
	elseif GuiService.SelectedObject and GuiService.SelectedObject:IsDescendantOf(self.gui) then
		GuiService.SelectedObject = nil
	end
end

return Menu
