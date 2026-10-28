--!native
-- The per-vertex work of the ocean (the wave maths of js/shaders/waveChunk.js), run by the
-- OceanWorker actors in parallel, a strip of rows each. Everything a worker needs arrives
-- in the frame message F (built by Ocean:update), since actors don't share module state.
--
-- On Roblox the water is one translucent colour (Glass: it refracts the seabed and reflects
-- the sky itself) and the whitewater is particles (Foam), so all that's worked out here is
-- the shape: positions and normals. The waves fade out toward the edge of the patch round
-- the camera, where the flat open sea (Ocean's far planes) takes over.
--
-- F: { C, R, xs, zs, co, waves = { { crestZ0, H, S, spill, sec = { H, b, kappa, steep, age,
--      Lf, Lb } } }, time, cam = {x, y, z}, half, curl = {...}, wave = {...} }

local WM = require(script.Parent.WaveModel)
local Config = require(script.Parent.Config)

local exp, sqrt, max, min, abs = math.exp, math.sqrt, math.max, math.min, math.abs
local sin, cos, atan2, pi = math.sin, math.cos, math.atan2, math.pi

local Core = {}

local function smoothstep(a, b, x)
	local t = (x - a) / (b - a)
	t = if t < 0 then 0 elseif t > 1 then 1 else t
	return t * t * (3 - 2 * t)
end
local function clamp01(v)
	return if v < 0 then 0 elseif v > 1 then 1 else v
end
local function sech2(x)
	if x > 40 then
		x = 40
	elseif x < -40 then
		x = -40
	end
	local c = math.cosh(x)
	return 1 / (c * c)
end

-- the swell components (static)
local SWELL = WM.WaveModel.new().swell

-- Displaced positions of rows j0..j1 into P.PX / PY / PZ (row j0 first).
function Core.compute(F, j0, j1, P)
	local C = F.C
	local xs, zs, co = F.xs, F.zs, F.co
	local PX, PY, PZ = P.PX, P.PY, P.PZ
	local t = F.time
	local camX, camZ = F.cam[1], F.cam[3]
	local half = F.half
	local K = F.curl
	local rin, yc, ex, sweep, acoshYc, trough, lipK = K.rin, K.yc, K.ex, K.sweep, K.acoshYc, K.trough, K.lip
	local yb0 = 0.45
	local W = F.wave
	local tThrow = W.tThrow
	local pool = W.pool
	local waves = F.waves
	local nW = #waves
	local nSw = #SWELL
	local zc0 = rin * ex

	local idx = 0
	for j = j0, j1 do
		local rowZ = zs[j]
		for i = 1, C do
			idx += 1
			local x = xs[i]
			local zr = rowZ + co[i]
			-- (fading to flat water at the edge of the patch)
			local edge = smoothstep(half, half * 0.75, abs(x - camX)) * smoothstep(half, half * 0.75, abs(zr - camZ))
			local py, pz, px = 0, zr, x
			if edge > 0 then
				local poolM = 1
				if pool then
					local ax = abs(x)
					local inside = min(pool.back[1] * ax + pool.back[2] * zr - pool.back[3], pool.front[1] * ax + pool.front[2] * zr - pool.front[3])
					poolM = clamp01(inside / pool.fadeWall) * clamp01((ax - pool.pier) / pool.fadePier)
				end
				local dy, dz = 0, 0
				for q = 1, nW do
					local w = waves[q]
					local sec = w.sec
					local S = w.S
					local u = rowZ - w.crestZ0
					local un = u / S
					if un < -16 or un > 7 then
						continue
					end
					local H = sec.H[i] * poolM
					if H < 0.005 then
						continue
					end
					local age = sec.age[i]
					local b = sec.b[i]
					if pool then
						b = smoothstep(0, tThrow, age) * smoothstep(0.05, 0.3, H / S) * (1 - 0.65 * w.spill)
					end
					local kappa = sec.kappa[i]
					local steep = sec.steep[i]
					local Lf, Lb = sec.Lf[i], sec.Lb[i]
					local yb
					if un >= 0 then
						local tt = (un - 2.2 * Lf) / (1.3 * Lf)
						local dd = (un - 1.7 * Lf) / (1.2 * Lf)
						yb = sech2(un / Lf) - steep * smoothstep(0, Lf, un) * (0.13 * exp(-tt * tt) + trough * exp(-dd * dd))
					else
						yb = 0.8 * sech2(un / Lb) + 0.2 * sech2(un / (3.5 * Lb))
					end
					yb *= smoothstep(-16, -9, un) * (1 - smoothstep(4.5, 7, un))
					local zn, yn = un, yb
					local zc = Lf * acoshYc + zc0
					local sF = if un >= 0 then clamp01((yb - yc) / (1 - yc)) else 0
					local sB = if un < 0 then clamp01((yb - yb0) / (1 - yb0)) else 0
					local s = max(sF, sB)
					if s > 0 and b > 0 then
						local lipThick = 0.04 + lipK * (1 - s) ^ 1.5
						local ddz = (un - zc) / ex
						local ddy = yb - yc
						local phiB = atan2(ddy, ddz)
						local rB = sqrt(ddz * ddz + ddy * ddy)
						local phiT = pi - s * sweep
						local rT = rin * (1 + 0.22 * s * s)
						local wgt
						if un >= 0 then
							wgt = smoothstep(0, 0.35, s)
						else
							rT += lipThick
							wgt = smoothstep(0, 0.55, s)
						end
						phiT = phiB + (phiT - phiB) * wgt
						rT = rB + (rT - rB) * wgt
						local kk = smoothstep(0, 1, b * 1.5 - (1 - s) * 0.5)
						local kr = smoothstep(0, 1, b * 2.4 - (1 - s) * 0.9)
						local phi = phiB + (phiT - phiB) * kk
						local r = rB + (rT - rB) * kr
						zn = zc + ex * r * cos(phi)
						yn = (yc + r * sin(phi)) * (1 - 0.45 * kappa * wgt * kr)
					end
					dy += yn * H
					dz += zn * S - u
				end
				-- swell (fading out with distance from the camera)
				local dxc, dzc = x - camX, zr - camZ
				local dist = sqrt(dxc * dxc + dzc * dzc)
				local sx_, sz_ = 0, 0
				for c = 1, nSw do
					local sw = SWELL[c]
					local lam = sw.lambda
					if dist > lam * 9 then
						continue
					end
					local ff = 1 - smoothstep(lam * 4, lam * 9, dist)
					local th = sw.k * (sw.dx * x + sw.dz * zr) - sw.omega * t + sw.phase
					dy += sw.amp * ff * sin(th)
					local h = sw.horiz * ff * cos(th)
					sx_ += sw.dx * h
					sz_ += sw.dz * h
				end
				py = dy * edge
				pz = zr + (dz + sz_) * edge
				px = x + sx_ * edge
			end
			PX[idx], PY[idx], PZ[idx] = px, py, pz
		end
	end
end

-- Mesh values for rows r0..r1 (P holds rows jb..je, which take in one row either side):
-- positions (studs, relative to the camera's pivot) and normals.
function Core.shape(F, P, jb, je, r0, r1, pos, nrm)
	local C = F.C
	local PX, PY, PZ = P.PX, P.PY, P.PZ
	local S = Config.SCALE
	local cx, cz = F.cam[1] * S, F.cam[3] * S
	local k = 0
	for j = r0, r1 do
		local jm = max(j - 1, jb)
		local jp = min(j + 1, je)
		local rowBase = (j - jb) * C
		for i = 1, C do
			k += 1
			local id = rowBase + i
			pos[k] = Vector3.new(PX[id] * S - cx, PY[id] * S, PZ[id] * S - cz)
			-- normal from the lattice neighbours: cross(dP/drow, dP/dcol)
			local im = if i > 1 then id - 1 else id
			local ip = if i < C then id + 1 else id
			local a = (jp - jb) * C + i
			local b = (jm - jb) * C + i
			local zx, zy, zz = PX[a] - PX[b], PY[a] - PY[b], PZ[a] - PZ[b]
			local xx, xy, xz = PX[ip] - PX[im], PY[ip] - PY[im], PZ[ip] - PZ[im]
			local nx, ny, nz = zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx
			local ln = sqrt(nx * nx + ny * ny + nz * nz)
			nrm[k] = if ln > 1e-12 then Vector3.new(nx / ln, ny / ln, nz / ln) else Vector3.yAxis
		end
	end
end

return Core
