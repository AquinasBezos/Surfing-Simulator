-- Input for every platform Roblox runs on (port of js/input.js, js/gamepad.js and the
-- "Buttons" layout of js/touch.js). All three are read at once; `device` follows whichever
-- was used last, for the on-screen hints.
--
-- PC (defaults as on the web):
--   Scroll wheel  paddle: the faster you scroll the harder you paddle
--   Mouse buttons a stroke with the left / right arm (like a controller's triggers)
--   A / D         steer while prone, carve while standing
--   W / S         trim / stall (shortboard) or walk to the nose / tail (longboard); while
--                 paddling, S sits you up to wait for a set and W lies you back down
--   Ctrl or C     duck dive while paddling, crouch while standing
--   Shift + flick hold Shift and flick the mouse sideways: snap, cutback or tailslide
--   Space         pop up (and lie back down)
--   R             back to the lineup        Tab / P  pause (Esc is Roblox's own menu)
-- Controller:
--   LT / RT strokes, left stick steer / carve / trim, A stand, B duck dive / crouch,
--   LB / RB + right stick flick tricks, right stick look, Y lineup, View (Back) pause.
-- Touch: a joystick, paddle buttons and the rest on screen (TouchControls in Hud).

local UserInputService = game:GetService("UserInputService")
local ContextActionService = game:GetService("ContextActionService")

local Input = {}
Input.__index = Input

local KEY = Enum.KeyCode
local BINDS = {
	forward = { KEY.W, KEY.Up },
	back = { KEY.S, KEY.Down },
	left = { KEY.A, KEY.Left },
	right = { KEY.D, KEY.Right },
	crouch = { KEY.LeftControl, KEY.RightControl, KEY.C },
	charge = { KEY.LeftShift, KEY.RightShift },
	popup = { KEY.Space },
	lineup = { KEY.R },
	pause = { KEY.Tab, KEY.P },
}

local function deadzone(v, dz)
	local m = v.Magnitude
	if m < dz then
		return Vector2.zero
	end
	return v.Unit * math.min(1, (m - dz) / (1 - dz))
end

function Input.new()
	local self = setmetatable({}, Input)
	self.keys = {}
	self.wheelAccum = 0
	self.scrollRate = 0
	self.lookX, self.lookY = 0, 0
	self.events = {}
	self.enabled = false
	self.device = if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled
		then "touch"
		elseif UserInputService.GamepadEnabled and not UserInputService.KeyboardEnabled then "pad"
		else "pc"
	self.onDevice = nil
	-- controller
	self.stick1 = Vector2.zero
	self.stick2 = Vector2.zero
	self.padButtons = {}
	self.trig = { [KEY.ButtonL2] = { v = 0, peak = 0, armed = true, t = 0 }, [KEY.ButtonR2] = { v = 0, peak = 0, armed = true, t = 0 } }
	-- touch (set by the on-screen controls)
	self.touch = { stick = Vector2.zero, crouch = false, duck = false, charge = false }
	self.touchLookX, self.touchLookY = 0, 0

	local function setDevice(d)
		if self.device ~= d then
			self.device = d
			if self.onDevice then
				self.onDevice(d)
			end
		end
	end

	local function has(action, code)
		for _, k in ipairs(BINDS[action]) do
			if k == code then
				return true
			end
		end
		return false
	end

	UserInputService.InputBegan:Connect(function(io, processed)
		local t = io.UserInputType
		if t == Enum.UserInputType.Keyboard then
			-- (Roblox takes Tab for its player list: pause on it anyway)
			if processed and not (has("pause", io.KeyCode) and not UserInputService:GetFocusedTextBox()) then
				return
			end
			setDevice("pc")
			if self.keys[io.KeyCode] then
				return
			end
			self.keys[io.KeyCode] = true
			if not self.enabled then
				if has("pause", io.KeyCode) then
					table.insert(self.events, "pause")
				end
				return
			end
			if has("popup", io.KeyCode) then
				table.insert(self.events, "toggleStand")
			end
			if has("lineup", io.KeyCode) then
				table.insert(self.events, "reset")
			end
			if has("back", io.KeyCode) then
				table.insert(self.events, "back")
			end
			if has("forward", io.KeyCode) then
				table.insert(self.events, "forward")
			end
			if has("pause", io.KeyCode) then
				table.insert(self.events, "pause")
			end
		elseif t == Enum.UserInputType.MouseButton1 or t == Enum.UserInputType.MouseButton2 then
			if processed or not self.enabled then
				return
			end
			setDevice("pc")
			table.insert(self.events, { stroke = if t == Enum.UserInputType.MouseButton1 then -1 else 1, strength = 0.8 })
		elseif t.Name:sub(1, 7) == "Gamepad" then
			setDevice("pad")
			self.padButtons[io.KeyCode] = true
			if processed then
				return
			end
			local k = io.KeyCode
			if k == KEY.ButtonSelect or (k == KEY.ButtonB and not self.enabled) then
				table.insert(self.events, "pause")
			end
			if not self.enabled then
				return
			end
			if k == KEY.ButtonA then
				table.insert(self.events, "toggleStand")
			elseif k == KEY.ButtonY then
				table.insert(self.events, "reset")
			end
		elseif t == Enum.UserInputType.Touch then
			setDevice("touch")
		end
	end)

	UserInputService.InputEnded:Connect(function(io)
		if io.UserInputType == Enum.UserInputType.Keyboard then
			self.keys[io.KeyCode] = nil
		elseif io.UserInputType.Name:sub(1, 7) == "Gamepad" then
			self.padButtons[io.KeyCode] = nil
			if io.KeyCode == KEY.Thumbstick1 then
				self.stick1 = Vector2.zero
			elseif io.KeyCode == KEY.Thumbstick2 then
				self.stick2 = Vector2.zero
			end
		end
	end)

	UserInputService.InputChanged:Connect(function(io, processed)
		local t = io.UserInputType
		if t == Enum.UserInputType.MouseWheel then
			if processed or not self.enabled then
				return
			end
			setDevice("pc")
			-- (a notch is about 100 px of browser scrolling)
			self.wheelAccum += math.min(math.abs(io.Position.Z) * 100, 400)
		elseif t == Enum.UserInputType.MouseMovement then
			if UserInputService.MouseBehavior == Enum.MouseBehavior.LockCenter then
				self.lookX += io.Delta.X
				self.lookY += io.Delta.Y
			end
		elseif t.Name:sub(1, 7) == "Gamepad" then
			local k = io.KeyCode
			if k == KEY.Thumbstick1 then
				self.stick1 = deadzone(Vector2.new(io.Position.X, io.Position.Y), 0.18)
				if self.stick1.Magnitude > 0 then
					setDevice("pad")
				end
			elseif k == KEY.Thumbstick2 then
				self.stick2 = deadzone(Vector2.new(io.Position.X, io.Position.Y), 0.15)
				if self.stick2.Magnitude > 0 then
					setDevice("pad")
				end
			elseif self.trig[k] then
				self.trig[k].v = io.Position.Z
			end
		end
	end)

	UserInputService.WindowFocusReleased:Connect(function()
		self.keys = {}
	end)
	return self
end

-- Capture the mouse for looking around (PC) and stop Roblox's default bindings that clash.
function Input:setEnabled(on)
	self.enabled = on
	if on and self.device ~= "touch" then
		UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter
		UserInputService.MouseIconEnabled = false
	else
		UserInputService.MouseBehavior = Enum.MouseBehavior.Default
		UserInputService.MouseIconEnabled = true
	end
	-- (keep the controller's thumbsticks and triggers away from the default camera and menus)
	if on then
		ContextActionService:BindActionAtPriority("LineupSink", function()
			return Enum.ContextActionResult.Sink
		end, false, 3000, KEY.ButtonL2, KEY.ButtonR2, KEY.ButtonL1, KEY.ButtonR1, KEY.Thumbstick2, KEY.ButtonSelect, KEY.Tab)
	else
		ContextActionService:UnbindAction("LineupSink")
	end
end

function Input:update(dt)
	if dt <= 0 then
		return
	end
	local inst = self.wheelAccum / dt
	self.wheelAccum = 0
	self.scrollRate += (inst - self.scrollRate) * (1 - math.exp(-dt / 0.35))
	-- triggers: a stroke each time one is pulled in, harder the faster it went
	for code, T in pairs(self.trig) do
		local rate = (T.v - (T.last or 0)) / dt
		T.last = T.v
		if T.armed then
			if rate > 0 then
				T.peak = math.max(T.peak * math.exp(-dt * 6), rate)
			end
			if T.v > 0.6 then
				table.insert(self.events, { stroke = if code == KEY.ButtonL2 then -1 else 1, strength = math.clamp(T.peak / 9, 0.25, 1) })
				T.armed = false
				T.peak = 0
			end
		elseif T.v < 0.3 then
			T.armed = true
		end
	end
end

-- 0..1 paddling effort from how fast the wheel is turning (~10 notches/s = flat out)
function Input:paddle()
	return math.clamp((self.scrollRate - 40) / 1050, 0, 1)
end

function Input:down(action)
	for _, k in ipairs(BINDS[action]) do
		if self.keys[k] then
			return true
		end
	end
	if action == "crouch" then
		return self.padButtons[KEY.ButtonB] == true or self.touch.crouch or self.touch.duck
	elseif action == "charge" then
		return self.padButtons[KEY.ButtonL1] == true or self.padButtons[KEY.ButtonR1] == true or self.touch.charge
	end
	return false
end

-- -1..1 steering / carving (+ right) and trim (+ forward), from keys, the left stick or the
-- touch joystick
function Input:steer()
	local k = (if self:down("right") then 1 else 0) - (if self:down("left") then 1 else 0)
	return math.clamp(k + self.stick1.X + self.touch.stick.X, -1, 1)
end
function Input:leanZ()
	local k = (if self:down("forward") then 1 else 0) - (if self:down("back") then 1 else 0)
	return math.clamp(k + self.stick1.Y - self.touch.stick.Y, -1, 1)
end

-- the look this frame: mouse pixels (lx, ly) and the right stick's rate (rad/s)
function Input:consumeLook()
	local lx, ly = self.lookX + self.touchLookX, self.lookY + self.touchLookY
	self.lookX, self.lookY, self.touchLookX, self.touchLookY = 0, 0, 0, 0
	return lx, ly, -self.stick2.X * 2.6, self.stick2.Y * 1.8
end

function Input:consumeEvents()
	local e = self.events
	self.events = {}
	return e
end

-- the controller's left stick pulled back / pushed forward while paddling: sit / lie down
function Input:padSit()
	return self.stick1.Y < -0.75, self.stick1.Y > 0.75
end

return Input
