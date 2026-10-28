-- Other players (after js/remote.js): each one's board and a surfer in a wetsuit, posed
-- for what they're doing (paddling, sitting, standing with their crouch and lean, wiped
-- out), with a name tag. Poses arrive ~10 times a second; between them the surfer is
-- predicted ahead from their velocity and eased toward each new update.
--
-- Pose packet (buffer, 50 bytes):
--   0 u8 spot  1 u8 state  2 u8 board  3 u8 crouch*255
--   4 f32 x, y, z (metres, spot frame)  16 f32 board rotation (YXZ euler)
--   28 f32 look yaw  32 f32 vx, vz  40 f32 time
--   44 u8 skin rgb, deck rgb

local Players = game:GetService("Players")

local Config = require(script.Parent.Config)
local Spots = require(script.Parent.Spots)
local Board = require(script.Parent.Board)

local S = Config.SCALE
local STATES = { "prone", "popup", "standing", "wipeout", "sitting" }
local BOARD_KINDS = { "shortboard", "longboard" }

local Remote = {}
Remote.__index = Remote

function Remote.pack(spotId, state, kind, crouch, pos, rot, lookYaw, vx, vz, t, skin, deck)
	local b = buffer.create(50)
	buffer.writeu8(b, 0, table.find(Spots.ORDER, spotId) or 1)
	buffer.writeu8(b, 1, table.find(STATES, state) or 1)
	buffer.writeu8(b, 2, table.find(BOARD_KINDS, kind) or 1)
	buffer.writeu8(b, 3, math.clamp(math.floor(crouch * 255), 0, 255))
	buffer.writef32(b, 4, pos.X)
	buffer.writef32(b, 8, pos.Y)
	buffer.writef32(b, 12, pos.Z)
	local rx, ry, rz = rot:ToEulerAnglesYXZ()
	buffer.writef32(b, 16, rx)
	buffer.writef32(b, 20, ry)
	buffer.writef32(b, 24, rz)
	buffer.writef32(b, 28, lookYaw)
	buffer.writef32(b, 32, vx)
	buffer.writef32(b, 36, vz)
	buffer.writef32(b, 40, t)
	local function c(o, col)
		buffer.writeu8(b, o, math.floor(col.R * 255))
		buffer.writeu8(b, o + 1, math.floor(col.G * 255))
		buffer.writeu8(b, o + 2, math.floor(col.B * 255))
	end
	c(44, skin)
	c(47, deck)
	return b
end

local function unpack(b)
	return {
		spot = Spots.ORDER[buffer.readu8(b, 0)],
		state = STATES[buffer.readu8(b, 1)] or "prone",
		kind = BOARD_KINDS[buffer.readu8(b, 2)] or "shortboard",
		crouch = buffer.readu8(b, 3) / 255,
		pos = Vector3.new(buffer.readf32(b, 4), buffer.readf32(b, 8), buffer.readf32(b, 12)),
		rot = CFrame.fromEulerAnglesYXZ(buffer.readf32(b, 16), buffer.readf32(b, 20), buffer.readf32(b, 24)),
		lookYaw = buffer.readf32(b, 28),
		vx = buffer.readf32(b, 32),
		vz = buffer.readf32(b, 36),
		t = buffer.readf32(b, 40),
		skin = Color3.fromRGB(buffer.readu8(b, 44), buffer.readu8(b, 45), buffer.readu8(b, 46)),
		deck = Color3.fromRGB(buffer.readu8(b, 47), buffer.readu8(b, 48), buffer.readu8(b, 49)),
	}
end

local function part(name, size, color, parent, shape)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size * S
	p.Color = color
	p.Material = Enum.Material.SmoothPlastic
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	if shape then
		p.Shape = shape
	end
	p.Parent = parent
	return p
end

-- A surfer figure: parts in metres, posed by Remote.poseFigure.
local function makeFigure(parent, skin)
	local suit = Color3.fromRGB(24, 26, 30)
	local f = { model = Instance.new("Model") }
	f.model.Name = "Surfer"
	f.torso = part("Torso", Vector3.new(0.36, 0.55, 0.2), suit, f.model)
	f.hips = part("Hips", Vector3.new(0.34, 0.2, 0.2), suit, f.model)
	f.head = part("Head", Vector3.new(0.22, 0.24, 0.24), skin, f.model, Enum.PartType.Ball)
	f.hair = part("Hair", Vector3.new(0.23, 0.13, 0.25), Color3.fromRGB(70, 50, 30), f.model, Enum.PartType.Ball)
	for _, side in ipairs({ "L", "R" }) do
		f["upperArm" .. side] = part("UpperArm" .. side, Vector3.new(0.1, 0.1, 0.3), suit, f.model)
		f["foreArm" .. side] = part("ForeArm" .. side, Vector3.new(0.09, 0.09, 0.28), suit, f.model)
		f["hand" .. side] = part("Hand" .. side, Vector3.new(0.08, 0.04, 0.15), skin, f.model)
		f["thigh" .. side] = part("Thigh" .. side, Vector3.new(0.15, 0.15, 0.44), suit, f.model)
		f["shin" .. side] = part("Shin" .. side, Vector3.new(0.12, 0.12, 0.42), suit, f.model)
		f["foot" .. side] = part("Foot" .. side, Vector3.new(0.1, 0.07, 0.24), skin, f.model)
	end
	f.model.Parent = parent
	return f
end

-- a limb segment between two points (metres, in `frame`)
local function seg(p, frame, a, b, up)
	local pa, pb = frame * (a * S), frame * (b * S)
	p.CFrame = CFrame.lookAt((pa + pb) / 2, pb, frame:VectorToWorldSpace(up or Vector3.yAxis))
end

local V = Vector3.new
-- Pose the figure on its board. frame: the board's frame (studs, at the board's origin);
-- t: time (for the paddle stroke and tumbling).
function Remote.poseFigure(f, frame, state, crouch, lookYaw, t)
	if state == "wipeout" then
		for _, p in ipairs(f.model:GetChildren()) do
			p.LocalTransparencyModifier = 1
		end
		return
	end
	for _, p in ipairs(f.model:GetChildren()) do
		p.LocalTransparencyModifier = 0
	end
	local function at(cf, size, pos, rot)
		return cf * CFrame.new(pos * S) * (rot or CFrame.identity)
	end
	if state == "prone" or state == "popup" then
		-- lying on the board, chest up, paddling
		local chest = V(0, 0.2, 0.05)
		f.torso.CFrame = at(frame, nil, chest, CFrame.Angles(-math.pi / 2 + 0.25, 0, 0))
		f.hips.CFrame = at(frame, nil, V(0, 0.13, 0.42), CFrame.Angles(-math.pi / 2, 0, 0))
		f.head.CFrame = at(frame, nil, V(0, 0.38, -0.3), CFrame.Angles(0, lookYaw * 0.6, 0))
		f.hair.CFrame = f.head.CFrame * CFrame.new(V(0, 0.06, 0.02) * S)
		for i, side in ipairs({ -1, 1 }) do
			local n = if side < 0 then "L" else "R"
			local ph = t * 1.6 + (i - 1) * math.pi
			local sh = V(0.2 * side, 0.25, -0.15)
			local hand = V(0.32 * side, 0.05 - 0.25 * math.max(0, math.sin(ph)), -0.15 - 0.35 * math.cos(ph))
			local el = (sh + hand) / 2 + V(0.12 * side, 0.12, 0)
			seg(f["upperArm" .. n], frame, sh, el)
			seg(f["foreArm" .. n], frame, el, hand)
			f["hand" .. n].CFrame = at(frame, nil, hand)
			local hip = V(0.1 * side, 0.12, 0.5)
			local knee = V(0.12 * side, 0.1, 0.92)
			local foot = V(0.13 * side, 0.18 + 0.1 * math.max(0, math.sin(t * 2 + i)), 1.3)
			seg(f["thigh" .. n], frame, hip, knee)
			seg(f["shin" .. n], frame, knee, foot)
			f["foot" .. n].CFrame = at(frame, nil, foot + V(0, 0, 0.08))
		end
	elseif state == "sitting" then
		-- sat astride the board, legs in the water
		f.hips.CFrame = at(frame, nil, V(0, 0.1, 0.25))
		f.torso.CFrame = at(frame, nil, V(0, 0.45, 0.25), CFrame.Angles(0, lookYaw * 0.4, 0))
		f.head.CFrame = at(frame, nil, V(0, 0.84, 0.25), CFrame.Angles(0, lookYaw * 0.8, 0))
		f.hair.CFrame = f.head.CFrame * CFrame.new(V(0, 0.06, 0.02) * S)
		for _, side in ipairs({ -1, 1 }) do
			local n = if side < 0 then "L" else "R"
			local sh = V(0.2 * side, 0.65, 0.25)
			local el = V(0.26 * side, 0.4, 0.2)
			local hand = V(0.22 * side, 0.14, 0.0)
			seg(f["upperArm" .. n], frame, sh, el)
			seg(f["foreArm" .. n], frame, el, hand)
			f["hand" .. n].CFrame = at(frame, nil, hand)
			local hip = V(0.12 * side, 0.08, 0.25)
			local knee = V(0.32 * side, -0.15, 0.0)
			local foot = V(0.3 * side, -0.55, 0.15 + 0.08 * math.sin(t * 1.3 + side))
			seg(f["thigh" .. n], frame, hip, knee)
			seg(f["shin" .. n], frame, knee, foot)
			f["foot" .. n].CFrame = at(frame, nil, foot)
		end
	else
		-- standing sideways on the board (regular: left foot forward), knees bent by the crouch
		local c = math.clamp(crouch, 0, 1)
		local hipY = 0.95 - 0.4 * c
		local body = CFrame.Angles(0, math.pi / 2, 0)
		f.hips.CFrame = at(frame, nil, V(0, hipY, 0.05)) * body
		f.torso.CFrame = at(frame, nil, V(0, hipY + 0.36 - 0.05 * c, 0.05 - 0.15 * c)) * body * CFrame.Angles(0, 0, 0.25 + 0.5 * c)
		f.head.CFrame = at(frame, nil, V(0, hipY + 0.78 - 0.18 * c, -0.05 - 0.28 * c), CFrame.Angles(0, lookYaw * 0.7, 0))
		f.hair.CFrame = f.head.CFrame * CFrame.new(V(0, 0.06, 0.02) * S)
		for _, side in ipairs({ -1, 1 }) do
			local n = if side < 0 then "L" else "R"
			-- arms out for balance, the front one leading
			local sh = V(0.0, hipY + 0.55 - 0.1 * c, 0.05 + 0.18 * side - 0.12 * c)
			local hand = V(0.18, hipY + 0.25, 0.05 + 0.6 * side)
			local el = (sh + hand) / 2 + V(0.05, 0.08, 0)
			seg(f["upperArm" .. n], frame, sh, el)
			seg(f["foreArm" .. n], frame, el, hand)
			f["hand" .. n].CFrame = at(frame, nil, hand)
			local foot = V(0, 0.07, 0.05 + 0.3 * side)
			local hip = V(0, hipY - 0.05, 0.05 + 0.1 * side)
			local knee = (hip + foot) / 2 + V(-0.12 - 0.15 * c, 0, 0.06 * side)
			seg(f["thigh" .. n], frame, hip, knee)
			seg(f["shin" .. n], frame, knee, foot)
			f["foot" .. n].CFrame = at(frame, nil, foot + V(0, 0, 0)) * CFrame.Angles(0, math.pi / 2, 0)
		end
	end
end

function Remote.new(parent, model)
	local self = setmetatable({}, Remote)
	self.parent = parent
	self.model = model
	self.others = {}
	self.spotId = nil
	self.origin = Vector3.zero
	return self
end

function Remote:setSpot(id, origin)
	self.spotId = id
	self.origin = origin
end

function Remote:push(userId, data)
	local p = unpack(data)
	local o = self.others[userId]
	if not o then
		o = { userId = userId }
		self.others[userId] = o
	end
	o.last = p
	o.recvAt = os.clock()
	if not o.pos then
		o.pos, o.rot = p.pos, p.rot
	end
end

function Remote:remove(userId)
	local o = self.others[userId]
	if o then
		if o.board then
			o.board:Destroy()
		end
		if o.figure then
			o.figure.model:Destroy()
		end
		self.others[userId] = nil
	end
end

function Remote:build(o)
	local p = o.last
	if o.board then
		o.board:Destroy()
		o.figure.model:Destroy()
	end
	local model, place = Board.create(p.kind, p.deck)
	model.Parent = self.parent
	o.board, o.place, o.kind, o.deck = model, place, p.kind, p.deck
	o.figure = makeFigure(self.parent, p.skin)
	local plr = Players:GetPlayerByUserId(o.userId)
	local tag = Instance.new("BillboardGui")
	tag.Size = UDim2.new(0, 160, 0, 26)
	tag.StudsOffsetWorldSpace = Vector3.new(0, 2.2 * S, 0)
	tag.AlwaysOnTop = true
	tag.MaxDistance = 400
	local l = Instance.new("TextLabel")
	l.Size = UDim2.new(1, 0, 1, 0)
	l.BackgroundTransparency = 1
	l.Text = if plr then plr.DisplayName else "Surfer"
	l.TextColor3 = Color3.new(1, 1, 1)
	l.TextStrokeTransparency = 0.4
	l.FontFace = Font.new("rbxasset://fonts/families/BuilderSans.json", Enum.FontWeight.Bold)
	l.TextSize = 16
	l.Parent = tag
	tag.Adornee = o.figure.torso
	tag.Parent = o.figure.model
end

function Remote:update(dt)
	local now = os.clock()
	for id, o in pairs(self.others) do
		local p = o.last
		local here = p.spot == self.spotId and now - o.recvAt < 5
		if not here then
			if o.board then
				o.board.Parent = nil
				o.figure.model.Parent = nil
			end
			if now - o.recvAt > 30 then
				self:remove(id)
			end
			continue
		end
		if not o.board or o.kind ~= p.kind or o.deck ~= p.deck then
			-- (building a board's mesh yields: off the render loop)
			if not o.building then
				o.building = true
				task.spawn(function()
					self:build(o)
					o.building = false
				end)
			end
			if not o.board then
				continue
			end
		end
		o.board.Parent = self.parent
		o.figure.model.Parent = self.parent
		-- predicted where they are now, eased toward
		local age = math.min(now - o.recvAt, 0.5)
		local target = p.pos + Vector3.new(p.vx * age, 0, p.vz * age)
		target = Vector3.new(target.X, self.model:heightAt(target.X, target.Z) + (p.pos.Y - self.model:heightAt(p.pos.X, p.pos.Z)), target.Z)
		local k = 1 - math.exp(-dt * 10)
		o.pos = o.pos:Lerp(target, k)
		o.rot = o.rot:Lerp(p.rot, k)
		local frame = CFrame.new(self.origin + o.pos * S) * o.rot
		if p.state == "wipeout" then
			frame = frame * CFrame.new(0, -1.2 * S, 0) * CFrame.Angles(now * 3, 0, now * 2)
		end
		o.place(frame)
		Remote.poseFigure(o.figure, frame, p.state, p.crouch, p.lookYaw, now)
	end
end

return Remote
