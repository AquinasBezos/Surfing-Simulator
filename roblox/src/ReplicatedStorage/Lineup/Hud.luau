-- The HUD (port of js/hud.js) and the on-screen touch controls (the "Buttons" layout of
-- js/touch.js): speed and paddling effort, the next wave, "Tubed!", early-2000s surf-mag
-- stickers for tricks, toasts, the score card after a ride, and the control hints.

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local Hud = {}
Hud.__index = Hud

local INK = Color3.fromRGB(238, 245, 248)
local DIM = Color3.fromRGB(190, 205, 212)
local SKY = Color3.fromRGB(143, 208, 238)
local ACCENT = Color3.fromRGB(25, 194, 180)
local PANEL = Color3.fromRGB(16, 23, 29)

local FONT = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.SemiBold)
local FONT_BOLD = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.ExtraBold)
local FONT_HEAVY = Font.new("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Bold)
Hud.FONT, Hud.FONT_BOLD, Hud.FONT_HEAVY = FONT, FONT_BOLD, FONT_HEAVY
Hud.INK, Hud.DIM, Hud.SKY, Hud.ACCENT, Hud.PANEL = INK, DIM, SKY, ACCENT, PANEL

local function new(class, props, children)
	local o = Instance.new(class)
	for k, v in pairs(props or {}) do
		o[k] = v
	end
	for _, c in ipairs(children or {}) do
		c.Parent = o
	end
	return o
end
Hud.new_ = new

local function corner(r)
	return new("UICorner", { CornerRadius = UDim.new(0, r or 10) })
end
local function stroke(c, t, tr)
	return new("UIStroke", { Color = c or Color3.new(0, 0, 0), Thickness = t or 1, Transparency = tr or 0.5 })
end
local function label(props)
	local p = {
		BackgroundTransparency = 1,
		FontFace = FONT,
		TextColor3 = INK,
		TextScaled = false,
		TextSize = 18,
		Text = "",
	}
	for k, v in pairs(props) do
		p[k] = v
	end
	return new("TextLabel", p)
end
Hud.label, Hud.corner, Hud.stroke = label, corner, stroke

function Hud.new()
	local self = setmetatable({}, Hud)
	local gui = new("ScreenGui", {
		Name = "LineupHud",
		ResetOnSpawn = false,
		IgnoreGuiInset = true,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		ScreenInsets = Enum.ScreenInsets.CoreUISafeInsets,
		Enabled = false,
	})
	self.gui = gui

	-- top left: what you're doing, speed, paddling effort, where you stand on a longboard
	local tl = new("Frame", {
		Name = "TopLeft",
		BackgroundColor3 = Color3.fromRGB(10, 20, 28),
		BackgroundTransparency = 0.62,
		Position = UDim2.new(0, 14, 0, 14),
		Size = UDim2.new(0, 190, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
	}, {
		corner(12),
		new("UIPadding", { PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 10), PaddingLeft = UDim.new(0, 12), PaddingRight = UDim.new(0, 12) }),
		new("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	tl.Parent = gui
	self.state = label({ Name = "State", Size = UDim2.new(1, 0, 0, 18), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = DIM, TextSize = 15, LayoutOrder = 1, Text = "Paddling" })
	self.state.Parent = tl
	self.speed = label({ Name = "Speed", Size = UDim2.new(1, 0, 0, 30), TextXAlignment = Enum.TextXAlignment.Left, FontFace = FONT_BOLD, TextSize = 28, LayoutOrder = 2, Text = "0 km/h" })
	self.speed.Parent = tl
	local bar = new("Frame", { Name = "Paddle", Size = UDim2.new(1, 0, 0, 6), BackgroundColor3 = Color3.new(1, 1, 1), BackgroundTransparency = 0.8, LayoutOrder = 3 }, { corner(3) })
	bar.Parent = tl
	self.paddleBar = new("Frame", { Size = UDim2.new(0, 0, 1, 0), BackgroundColor3 = SKY, BorderSizePixel = 0 }, { corner(3) })
	self.paddleBar.Parent = bar
	self.footRow = new("Frame", { Name = "Foot", Size = UDim2.new(1, 0, 0, 16), BackgroundTransparency = 1, LayoutOrder = 4, Visible = false })
	self.footRow.Parent = tl
	label({ Size = UDim2.new(0, 30, 1, 0), Text = "tail", TextSize = 13, TextColor3 = DIM, Parent = self.footRow })
	label({ Size = UDim2.new(0, 34, 1, 0), Position = UDim2.new(1, -34, 0, 0), Text = "nose", TextSize = 13, TextColor3 = DIM, Parent = self.footRow })
	local track = new("Frame", { Size = UDim2.new(1, -70, 0, 4), Position = UDim2.new(0, 34, 0.5, -2), BackgroundColor3 = Color3.new(1, 1, 1), BackgroundTransparency = 0.75 }, { corner(2) })
	track.Parent = self.footRow
	self.footDot = new("Frame", { Size = UDim2.new(0, 10, 0, 10), AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.5, 0), BackgroundColor3 = SKY }, { corner(5) })
	self.footDot.Parent = track

	-- top right: the next wave
	self.wave = label({
		Name = "Wave",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -14, 0, 14),
		Size = UDim2.new(0, 360, 0, 34),
		TextXAlignment = Enum.TextXAlignment.Right,
		TextSize = 20,
		FontFace = FONT_BOLD,
	})
	new("UIStroke", { Color = Color3.new(0, 0, 0), Transparency = 0.55, Thickness = 1.5, Parent = self.wave })
	self.wave.Parent = gui

	-- "Tubed!"
	self.tube = label({
		Name = "Tube",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.3, 0),
		Size = UDim2.new(0, 400, 0, 80),
		Text = "Tubed!",
		FontFace = FONT_HEAVY,
		TextSize = 64,
		TextColor3 = Color3.fromRGB(255, 240, 120),
		TextTransparency = 1,
		Rotation = -6,
	})
	self.tubeStroke = new("UIStroke", { Color = Color3.fromRGB(20, 40, 90), Thickness = 4, Transparency = 1, Parent = self.tube })
	self.tube.Parent = gui

	-- stickers, toasts, the ride card
	self.stickers = new("Frame", { Name = "Stickers", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, 0) })
	self.stickers.Parent = gui
	self.toastLabel = label({
		Name = "Toast",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -120),
		Size = UDim2.new(0, 0, 0, 40),
		AutomaticSize = Enum.AutomaticSize.X,
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 1,
		TextTransparency = 1,
		TextSize = 20,
	}, nil)
	new("UIPadding", { PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16), Parent = self.toastLabel })
	corner(10).Parent = self.toastLabel
	self.toastLabel.Parent = gui

	self.card = new("Frame", {
		Name = "RideCard",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(0.5, 0, 0.45, 0),
		Size = UDim2.new(0, 340, 0, 0),
		AutomaticSize = Enum.AutomaticSize.Y,
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.12,
		Visible = false,
	}, {
		corner(16),
		stroke(Color3.new(1, 1, 1), 1, 0.85),
		new("UIPadding", { PaddingTop = UDim.new(0, 16), PaddingBottom = UDim.new(0, 18), PaddingLeft = UDim.new(0, 20), PaddingRight = UDim.new(0, 20) }),
		new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	self.card.Parent = gui
	self.cardTitle = label({ Size = UDim2.new(1, 0, 0, 28), FontFace = FONT_BOLD, TextSize = 26, LayoutOrder = 1 })
	self.cardTitle.Parent = self.card
	self.cardScore = label({ Size = UDim2.new(1, 0, 0, 54), FontFace = FONT_HEAVY, TextSize = 52, TextColor3 = SKY, LayoutOrder = 2 })
	self.cardScore.Parent = self.card
	self.cardBest = label({ Size = UDim2.new(1, 0, 0, 22), FontFace = FONT_BOLD, TextSize = 18, TextColor3 = Color3.fromRGB(95, 224, 162), Text = "New best!", LayoutOrder = 3 })
	self.cardBest.Parent = self.card
	self.cardParts = label({ Size = UDim2.new(1, 0, 0, 0), AutomaticSize = Enum.AutomaticSize.Y, TextWrapped = true, TextColor3 = DIM, TextSize = 17, LayoutOrder = 4 })
	self.cardParts.Parent = self.card

	-- the control hints along the bottom
	self.hints = label({
		Name = "Hints",
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -10),
		Size = UDim2.new(1, -40, 0, 22),
		TextSize = 15,
		TextColor3 = DIM,
		TextTransparency = 0.1,
	})
	new("UIStroke", { Color = Color3.new(0, 0, 0), Transparency = 0.6, Thickness = 1, Parent = self.hints })
	self.hints.Parent = gui

	-- the players feed (multiplayer)
	self.feed = new("Frame", {
		Name = "Feed",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.new(1, -14, 0, 52),
		Size = UDim2.new(0, 320, 0, 160),
		BackgroundTransparency = 1,
	}, { new("UIListLayout", { Padding = UDim.new(0, 2), HorizontalAlignment = Enum.HorizontalAlignment.Right, SortOrder = Enum.SortOrder.LayoutOrder }) })
	self.feed.Parent = gui

	-- underwater / fade overlay
	self.fade = new("Frame", { Name = "Fade", Size = UDim2.new(1, 0, 1, 0), BackgroundColor3 = Color3.new(0, 0, 0), BackgroundTransparency = 1, ZIndex = 50 })
	self.fade.Parent = gui

	self.toastT = 0
	self.tubeT = 0
	self.feedN = 0
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	return self
end

function Hud:show(v)
	self.gui.Enabled = v
end

function Hud:setState(text)
	self.state.Text = text
end

function Hud:update(dt, info)
	self.speed.Text = ("%d km/h"):format(math.floor(info.speed * 3.6 + 0.5))
	self.paddleBar.Size = UDim2.new(math.clamp(info.effort, 0, 1), 0, 1, 0)
	self.paddleBar.Parent.Visible = info.prone
	self.footRow.Visible = info.foot ~= nil
	if info.foot then
		self.footDot.Position = UDim2.new(math.clamp((info.foot + 1) / 2.18, 0, 1), 0, 0.5, 0)
	end
	self.wave.Text = info.wave or ""
	-- Tubed!
	local target = if info.tube then 1 else 0
	self.tubeT += (target - self.tubeT) * math.min(1, dt * (if target > 0 then 10 else 3))
	self.tube.TextTransparency = 1 - self.tubeT
	self.tubeStroke.Transparency = 1 - self.tubeT
	self.tube.Size = UDim2.new(0, 400, 0, 80 + 12 * math.sin(os.clock() * 6) * self.tubeT)
	-- toast
	if self.toastT > 0 then
		self.toastT -= dt
		local a = math.clamp(self.toastT / 0.3, 0, 1)
		self.toastLabel.TextTransparency = 1 - a
		self.toastLabel.BackgroundTransparency = 1 - 0.75 * a
	end
end

function Hud:toast(text, dur)
	self.toastLabel.Text = text
	self.toastT = dur or 2.5
end

-- early-2000s surf-mag sticker: a slanted label with a fat outline and a drop shadow
local STICKER_COLORS = {
	{ Color3.fromRGB(255, 214, 10), Color3.fromRGB(230, 30, 90) },
	{ Color3.fromRGB(120, 230, 255), Color3.fromRGB(20, 40, 140) },
	{ Color3.fromRGB(255, 120, 60), Color3.fromRGB(30, 30, 30) },
	{ Color3.fromRGB(150, 255, 120), Color3.fromRGB(10, 90, 60) },
	{ Color3.fromRGB(255, 255, 255), Color3.fromRGB(230, 30, 90) },
}
function Hud:callout(text, sub)
	local c = STICKER_COLORS[math.random(#STICKER_COLORS)]
	local rot = math.random(-10, 10)
	local x = 0.5 + (math.random() - 0.5) * 0.3
	local y = 0.38 + (math.random() - 0.5) * 0.12
	local holder = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.new(x, 0, y, 0),
		Size = UDim2.new(0, 0, 0, 0),
		AutomaticSize = Enum.AutomaticSize.XY,
		BackgroundColor3 = c[2],
		Rotation = rot,
	}, {
		corner(8),
		new("UIStroke", { Color = Color3.new(1, 1, 1), Thickness = 4 }),
		new("UIPadding", { PaddingTop = UDim.new(0, 6), PaddingBottom = UDim.new(0, 8), PaddingLeft = UDim.new(0, 18), PaddingRight = UDim.new(0, 18) }),
		new("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	local scale = new("UIScale", { Scale = 0.2, Parent = holder })
	local main = label({ AutomaticSize = Enum.AutomaticSize.XY, Size = UDim2.new(), Text = string.upper(text), FontFace = FONT_HEAVY, TextSize = 46, TextColor3 = c[1], LayoutOrder = 1 })
	new("UIStroke", { Color = Color3.new(0, 0, 0), Thickness = 2.5, Parent = main })
	main.Parent = holder
	if sub then
		local s = label({ AutomaticSize = Enum.AutomaticSize.XY, Size = UDim2.new(), Text = sub, FontFace = FONT_BOLD, TextSize = 18, TextColor3 = INK, LayoutOrder = 2 })
		s.Parent = holder
	end
	holder.Parent = self.stickers
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	task.delay(1.9, function()
		local tw = TweenService:Create(scale, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Scale = 0 })
		tw:Play()
		tw.Completed:Wait()
		holder:Destroy()
	end)
end

function Hud:rideCard(title, score, parts, best)
	self.cardTitle.Text = title
	self.cardScore.Text = tostring(score)
	self.cardBest.Visible = best
	self.cardParts.Text = table.concat(parts, "  ·  ")
	self.card.Visible = true
	local id = {}
	self.cardId = id
	task.delay(4.5, function()
		if self.cardId == id then
			self.card.Visible = false
		end
	end)
end

function Hud:feedLine(text)
	self.feedN += 1
	local l = label({ Size = UDim2.new(1, 0, 0, 20), TextXAlignment = Enum.TextXAlignment.Right, TextSize = 16, Text = text, LayoutOrder = self.feedN })
	new("UIStroke", { Color = Color3.new(0, 0, 0), Transparency = 0.6, Parent = l })
	l.Parent = self.feed
	task.delay(6, function()
		l:Destroy()
	end)
end

function Hud:setHints(text)
	self.hints.Text = text
end

---------------------------------------------------------------- touch controls
-- Buttons that report presses as the keyboard and controller do: a joystick at the bottom
-- left (steer, carve, trim), paddle left / right at the bottom right (tap for a stroke, hold
-- to keep stroking), and the rest by what you're doing. Drag anywhere else to look around.
function Hud:buildTouch(input)
	local UIS = game:GetService("UserInputService")
	local frame = new("Frame", { Name = "Touch", BackgroundTransparency = 1, Size = UDim2.new(1, 0, 1, 0), Visible = false })
	frame.Parent = self.gui
	self.touchFrame = frame
	local T = input.touch

	-- joystick
	local base = new("Frame", {
		Name = "Stick",
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 30, 1, -40),
		Size = UDim2.new(0, 150, 0, 150),
		BackgroundColor3 = Color3.new(1, 1, 1),
		BackgroundTransparency = 0.85,
		Active = true,
	}, { corner(75), stroke(Color3.new(1, 1, 1), 2, 0.6) })
	base.Parent = frame
	local knob = new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(0.5, 0, 0.5, 0), Size = UDim2.new(0, 64, 0, 64), BackgroundColor3 = SKY, BackgroundTransparency = 0.2 }, { corner(32) })
	knob.Parent = base
	local stickInput = nil
	local function setStick(pos)
		local c = base.AbsolutePosition + base.AbsoluteSize / 2
		local d = (Vector2.new(pos.X, pos.Y) - c) / 60
		if d.Magnitude > 1 then
			d = d.Unit
		end
		T.stick = d
		knob.Position = UDim2.new(0.5, d.X * 60, 0.5, d.Y * 60)
	end
	base.InputBegan:Connect(function(io)
		if io.UserInputType == Enum.UserInputType.Touch and not stickInput then
			stickInput = io
			setStick(io.Position)
		end
	end)

	local buttons = {}
	local function button(name, text, pos, size, onDown, onUp)
		local b = new("TextButton", {
			Name = name,
			AnchorPoint = Vector2.new(0.5, 0.5),
			Position = pos,
			Size = size or UDim2.new(0, 84, 0, 84),
			BackgroundColor3 = Color3.fromRGB(10, 20, 28),
			BackgroundTransparency = 0.45,
			FontFace = FONT_BOLD,
			TextColor3 = INK,
			TextSize = 16,
			TextWrapped = true,
			Text = text,
			AutoButtonColor = false,
		}, { corner(42), stroke(Color3.new(1, 1, 1), 2, 0.55) })
		b.Parent = frame
		local held = nil
		b.InputBegan:Connect(function(io)
			if io.UserInputType == Enum.UserInputType.Touch or io.UserInputType == Enum.UserInputType.MouseButton1 then
				held = io
				b.BackgroundColor3 = ACCENT
				if onDown then
					onDown()
				end
			end
		end)
		b.InputEnded:Connect(function(io)
			if io == held then
				held = nil
				b.BackgroundColor3 = Color3.fromRGB(10, 20, 28)
				if onUp then
					onUp()
				end
			end
		end)
		buttons[name] = b
		return b
	end
	-- paddle buttons: tap for a stroke, hold to keep stroking
	local holdL, holdR = false, false
	button("PaddleL", "Paddle\nleft", UDim2.new(1, -200, 1, -80), UDim2.new(0, 96, 0, 96), function()
		holdL = true
		table.insert(input.events, { stroke = -1, strength = 0.85 })
	end, function()
		holdL = false
	end)
	button("PaddleR", "Paddle\nright", UDim2.new(1, -80, 1, -130), UDim2.new(0, 96, 0, 96), function()
		holdR = true
		table.insert(input.events, { stroke = 1, strength = 0.85 })
	end, function()
		holdR = false
	end)
	button("Duck", "Duck\ndive", UDim2.new(1, -80, 1, -250), nil, function()
		T.duck = true
	end, function()
		T.duck = false
	end)
	button("Sit", "Sit", UDim2.new(1, -200, 1, -200), UDim2.new(0, 70, 0, 70), function()
		table.insert(input.events, "touchSit")
	end)
	button("Stand", "Stand up", UDim2.new(0.5, 0, 1, -60), UDim2.new(0, 150, 0, 60), function()
		table.insert(input.events, "toggleStand")
	end)
	button("Crouch", "Crouch", UDim2.new(1, -80, 1, -130), UDim2.new(0, 96, 0, 96), function()
		T.crouch = true
	end, function()
		T.crouch = false
	end)
	button("Snap", "Snap", UDim2.new(1, -200, 1, -80), UDim2.new(0, 96, 0, 96), function()
		T.charge = true
	end, function()
		T.charge = false
	end)
	button("Lineup", "Lineup", UDim2.new(0, 60, 0, 120), UDim2.new(0, 96, 0, 40), function()
		table.insert(input.events, "reset")
	end)
	button("Pause", "II", UDim2.new(0, 60, 0, 170), UDim2.new(0, 48, 0, 40), function()
		table.insert(input.events, "pause")
	end)
	buttons.Lineup.Position = UDim2.new(0, 70, 0, 150)
	buttons.Pause.Position = UDim2.new(0, 150, 0, 150)
	self.touchButtons = buttons

	-- held paddle buttons keep stroking
	task.spawn(function()
		while true do
			task.wait(0.5)
			if holdL then
				table.insert(input.events, { stroke = -1, strength = 0.85 })
			end
			if holdR then
				table.insert(input.events, { stroke = 1, strength = 0.85 })
			end
		end
	end)

	-- look: any drag that didn't start on a control
	local lookInput, lastPos = nil, nil
	UIS.TouchStarted:Connect(function(io, processed)
		if processed or not frame.Visible then
			return
		end
		if not lookInput then
			lookInput = io
			lastPos = io.Position
		end
	end)
	UIS.TouchMoved:Connect(function(io)
		if io == stickInput then
			setStick(io.Position)
		elseif io == lookInput and lastPos then
			local d = io.Position - lastPos
			lastPos = io.Position
			input.touchLookX += d.X * 1.6
			input.touchLookY += d.Y * 1.6
		end
	end)
	UIS.TouchEnded:Connect(function(io)
		if io == stickInput then
			stickInput = nil
			T.stick = Vector2.zero
			knob.Position = UDim2.new(0.5, 0, 0.5, 0)
		elseif io == lookInput then
			lookInput = nil
		end
	end)
end

-- which touch buttons show, by what you're doing
function Hud:updateTouch(visible, mode, sitting, canStand)
	if not self.touchFrame then
		return
	end
	self.touchFrame.Visible = visible
	if not visible then
		return
	end
	local b = self.touchButtons
	local paddling = mode == "paddle"
	b.PaddleL.Visible = paddling
	b.PaddleR.Visible = paddling
	b.Duck.Visible = paddling and not sitting
	b.Sit.Visible = paddling
	b.Sit.Text = if sitting then "Lie\ndown" else "Sit"
	b.Stand.Visible = (paddling and canStand) or mode == "stand"
	b.Stand.Text = if mode == "stand" then "Paddle" else "Stand up"
	b.Crouch.Visible = mode == "stand"
	b.Snap.Visible = mode == "stand"
end

return Hud
