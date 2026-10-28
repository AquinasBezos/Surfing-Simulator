--!native
-- The per-vertex work of the ocean (the wave maths of js/shaders/waveChunk.js and the
-- colour the fragment shader in js/ocean.js works out), run by the OceanWorker actors in
-- parallel, a strip of rows each. Everything a worker needs arrives in the frame message F
-- (built by Ocean:update), since actors don't share module state.
--
-- F: { C, R, xs, zs, co, waves = { { crestZ0, H, S, spill, sec = { H, b, kappa, steep, age,
--      Lf, Lb } } }, time, cam = {x, y, z}, spot, curl = {...}, wave = {...}, water, sun,
--      sky, origin, colour }

local Land = require(script.Parent.Land)
local WM = require(script.Parent.WaveModel)
local Config = require(script.Parent.Config)

local exp, sqrt, max, min, floor = math.exp, math.sqrt, math.max, math.min, math.floor
local sin, cos, atan2, pi, log = math.sin, math.cos, math.atan2, math.pi, math.log

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
local function hash2(x, z)
	local s = sin(x * 127.1 + z * 311.7) * 43758.5453
	return s - floor(s)
end
local function vnoise(x, z)
	local xi, zi = floor(x), floor(z)
	local fx, fz = x - xi, z - zi
	fx = fx * fx * (3 - 2 * fx)
	fz = fz * fz * (3 - 2 * fz)
	local a, b, c, d = hash2(xi, zi), hash2(xi + 1, zi), hash2(xi, zi + 1), hash2(xi + 1, zi + 1)
	return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
end

-- the swell components (static)
local SWELL = WM.WaveModel.new().swell

-- Displaced positions and shading inputs of rows j0..j1 into the flat arrays of P (row
-- j0 first).
function Core.compute(F, j0, j1, P)
	local C = F.C
	local xs, zs, co = F.xs, F.zs, F.co
	local PX, PY, PZ, TH, FO, LI, HF = P.PX, P.PY, P.PZ, P.TH, P.FO, P.LI, P.HF
	local t = F.time
	local camX, camZ = F.cam[1], F.cam[3]
	local K = F.curl
	local rin, yc, ex, sweep, acoshYc, trough, lipK = K.rin, K.yc, K.ex, K.sweep, K.acoshYc, K.trough, K.lip
	local yb0 = 0.45
	local W = F.wave
	local tThrow, speed = W.tThrow, W.speed
	local pool = W.pool
	local waves = F.waves
	local nW = #waves
	local nSw = #SWELL
	local zc0 = rin * ex
	local tipK = ex * (rin * 1.22 + 0.04) * cos(pi - sweep)

	local idx = 0
	for j = j0, j1 do
		local rowZ = zs[j]
		for i = 1, C do
			idx += 1
			local x = xs[i]
			local zr = rowZ + co[i]
			local py, pz = 0, zr
			local thick, foam, lipW, hfW = 60, 0, 0, 0
			local poolM = 1
			if pool then
				local ax = math.abs(x)
				local inside = min(pool.back[1] * ax + pool.back[2] * zr - pool.back[3], pool.front[1] * ax + pool.front[2] * zr - pool.front[3])
				poolM = clamp01(inside / pool.fadeWall) * clamp01((ax - pool.pier) / pool.fadePier)
			end
			for q = 1, nW do
				local w = waves[q]
				local sec = w.sec
				local S = w.S
				local u = rowZ - w.crestZ0
				local age = sec.age[i]
				if u < -1.2 * S then
					foam += 0.6 * smoothstep(0, 2, age + u / speed) * exp(u / 70) * smoothstep(-1.2 * S, -3.5 * S, u) * smoothstep(0, 0.5, w.H)
				end
				local un = u / S
				if un < -16 or un > 7 then
					continue
				end
				local H = sec.H[i] * poolM
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
				local kr = 0
				local lipThick = 0.04 + lipK * (1 - s) ^ 1.5
				if s > 0 and b > 0 then
					local dz = (un - zc) / ex
					local dy = yb - yc
					local phiB = atan2(dy, dz)
					local rB = sqrt(dz * dz + dy * dy)
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
					kr = smoothstep(0, 1, b * 2.4 - (1 - s) * 0.9)
					local phi = phiB + (phiT - phiB) * kk
					local r = rB + (rT - rB) * kr
					zn = zc + ex * r * cos(phi)
					yn = (yc + r * sin(phi)) * (1 - 0.45 * kappa * wgt * kr)
				end
				-- horizontal thickness of the water body at this height (light through it)
				local hb = clamp01(yb)
				local body = 60
				if hb > 0.02 then
					local v = 1 / sqrt(hb)
					body = (Lf + 1.3 * Lb) * log(v + sqrt(v * v - 1)) * S
				end
				local th = body + (lipThick * S * 1.2 - body) * kr
				if th < thick then
					thick = th
				end
				-- foam: lip edge, exploding / collapsed whitewater, a spilling crest, the lip's landing
				local spill = w.spill
				local f = smoothstep(0.55, 1, s) * kr * 0.7
				local bore = kappa * smoothstep(3.6, 1.0, un) * exp(-max(0, -un - 0.3) / (1 + 4 * kappa * (1 - 0.5 * spill)))
				f += bore * 1.25
				local reach = 0.35 + 0.75 * min(max(age, 0), 1.6)
				local cap = spill * smoothstep(0, 0.5, age) * smoothstep(-1, -0.25, un) * (1 - smoothstep(reach - 0.5, reach, un))
				f += cap * 0.95
				local tip = zc + tipK
				local impact = b * (1 - kappa) * smoothstep(0.7, 1, b) * smoothstep(tip - 0.35, tip, un) * (1 - smoothstep(tip + 0.25, tip + 1.3, un))
				f += impact * 0.9
				foam += f * smoothstep(0, 0.4, w.H)
				if s > 0.001 and kr > lipW then
					lipW = kr
				end
				local hfv = min(max(yb, 0), 1.2) * smoothstep(0.1, 0.6, H / S)
				if hfv > hfW then
					hfW = hfv
				end
				-- churned whitewater: a lumpy, boiling surface, rougher the bigger the wave
				local white = max(bore, max(cap, impact * 0.6)) * H
				if white > 0.05 and H > 0.01 then
					local n1 = vnoise(x * 0.35, zr * 0.35 - t * 0.6)
					local n2 = vnoise(x * 1.1 + 7.3, zr * 1.1 + t * 0.9)
					yn += clamp01(foam - 0.6) * ((n1 - 0.4) + (n2 - 0.45) * 0.45) * min(max(0.14 + 0.24 * white, 0.14), 0.75) / H
				end
				py += yn * H
				pz += zn * S - u
			end
			-- swell (fading out with distance from the camera)
			local dxc, dzc = x - camX, zr - camZ
			local dist = sqrt(dxc * dxc + dzc * dzc)
			local px = x
			for c = 1, nSw do
				local sw = SWELL[c]
				local lam = sw.lambda
				if dist > lam * 9 then
					continue
				end
				local ff = 1 - smoothstep(lam * 4, lam * 9, dist)
				local th = sw.k * (sw.dx * x + sw.dz * zr) - sw.omega * t + sw.phase
				py += sw.amp * ff * sin(th)
				local h = sw.horiz * ff * cos(th)
				px += sw.dx * h
				pz += sw.dz * h
			end
			PX[idx], PY[idx], PZ[idx] = px, py, pz
			TH[idx], FO[idx], LI[idx], HF[idx] = thick, foam, lipW, hfW
		end
	end
end

-- Mesh values for rows r0..r1 (P holds rows jb..je, which take in one row either side):
-- positions (studs, relative to the camera's pivot), normals and, if F.colour, colours.
function Core.shade(F, P, jb, je, r0, r1, pos, nrm, cols)
	local C = F.C
	local PX, PY, PZ, TH, FO, LI, HF = P.PX, P.PY, P.PZ, P.TH, P.FO, P.LI, P.HF
	local S = Config.SCALE
	local camX, camY, camZ = F.cam[1], F.cam[2], F.cam[3]
	local cx, cz = camX * S, camZ * S
	local t = F.time
	local doColor = F.colour
	local wa = F.water
	local dR, dG, dB = wa.deep[1], wa.deep[2], wa.deep[3]
	local sR, sG, sB = wa.shallow[1], wa.shallow[2], wa.shallow[3]
	local gR, gG, gB = wa.glow[1], wa.glow[2], wa.glow[3]
	local zen, hor = F.sky[1], F.sky[2]
	local sunX, sunY, sunZ = F.sun[1], F.sun[2], F.sun[3]
	-- the light: the sun's colour (glints, light through the water) and how bright the
	-- water's body is lit (the ocean is drawn unlit: these colours are what you see)
	local lR, lG, lB = F.sunCol[1], F.sunCol[2], F.sunCol[3]
	local aR, aG, aB = F.amb[1], F.amb[2], F.amb[3]
	local seabed = Land.active.seabedY
	local bedColor = Land.active.bed
	local k = 0
	for j = r0, r1 do
		local jm = max(j - 1, jb)
		local jp = min(j + 1, je)
		local rowBase = (j - jb) * C
		for i = 1, C do
			k += 1
			local id = rowBase + i
			local x, y, z = PX[id], PY[id], PZ[id]
			-- (under the land the water is simply below the ground, which hides it)
			local bedY = seabed(x, z)
			pos[k] = Vector3.new(x * S - cx, y * S, z * S - cz)
			-- normal from the lattice neighbours: cross(dP/drow, dP/dcol)
			local im = if i > 1 then id - 1 else id
			local ip = if i < C then id + 1 else id
			local a = (jp - jb) * C + i
			local b = (jm - jb) * C + i
			local zx, zy, zz = PX[a] - PX[b], PY[a] - PY[b], PZ[a] - PZ[b]
			local xx, xy, xz = PX[ip] - PX[im], PY[ip] - PY[im], PZ[ip] - PZ[im]
			local nx, ny, nz = zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx
			local ln = sqrt(nx * nx + ny * ny + nz * nz)
			if ln > 1e-12 then
				nx, ny, nz = nx / ln, ny / ln, nz / ln
			else
				nx, ny, nz = 0, 1, 0
			end
			nrm[k] = Vector3.new(nx, ny, nz)
			if not doColor then
				continue
			end
			local vx, vy, vz = camX - x, camY - y, camZ - z
			local dist = sqrt(vx * vx + vy * vy + vz * vz)
			vx, vy, vz = vx / dist, vy / dist, vz / dist
			local under = (nx * vx + ny * vy + nz * vz) < 0
			local thick, foam, lip, hf = TH[id], FO[id], LI[id], HF[id]
			local r, g, bl
			if under then
				-- the underside: the inside of the lip, or the surface seen from below, lit
				-- through the water
				local thin = exp(-thick * 0.35)
				r = (sR * 0.75 + gR * thin * 0.55) * aR
				g = (sG * 0.8 + gG * thin * 0.55) * aG
				bl = (sB * 0.85 + gB * thin * 0.55) * aB
			else
				local depth = max(y - bedY, 0)
				-- small ripples tilt the surface (the web version's normal map): glassy, not a mirror
				local rx = (vnoise(x * 0.6 + t * 0.25, z * 0.6) - 0.5) * 0.5 + (vnoise(x * 2.1, z * 2.1 + t * 0.6) - 0.5) * 0.25
				local rz = (vnoise(x * 0.6 + 5.2, z * 0.6 - t * 0.3) - 0.5) * 0.5 + (vnoise(x * 2.1 + 3.3, z * 2.1 - t * 0.5) - 0.5) * 0.25
				local qx, qy, qz = nx + rx, ny, nz + rz
				local ql = sqrt(qx * qx + qy * qy + qz * qz)
				qx, qy, qz = qx / ql, qy / ql, qz / ql
				local ndv = max(qx * vx + qy * vy + qz * vz, 0)
				-- the seabed through the water: clear in the shallows, gone on the face
				local seeBed = exp(-depth * 0.13) * (1 - smoothstep(0.08, 0.5, hf)) * (1 - min(dist / 220, 1)) * (0.45 + 0.55 * ndv)
				local br, bg, bb = bedColor(x, z)
				local caust = 0.8 + 0.5 * vnoise(x * 0.9 + t * 0.4, z * 0.9 - t * 0.3) * vnoise(x * 1.3 - t * 0.3, z * 1.3 + 2.1)
				br, bg, bb = br * caust * (0.25 + 0.75 * sR), bg * caust * (0.45 + 0.55 * sG), bb * caust * (0.45 + 0.55 * sB)
				-- the body: light scattered back out of the water. Looking steeply down into deep
				-- water it's the deep colour; across a wave's face, or into it, the lighter one.
				local lift = smoothstep(0.05, 0.75, hf)
				local dk = (1 - exp(-depth * 0.09)) * sqrt(ndv) * (1 - lift)
				-- (and a touch darker low on a big face, where the water is thick)
				dk = max(dk, 0.45 * lift * (1 - smoothstep(0.3, 0.8, hf)) * smoothstep(0.5, 2.5, depth))
				r = sR + (dR - sR) * dk
				g = sG + (dG - sG) * dk
				bl = sB + (dB - sB) * dk
				r += (br - r) * seeBed
				g += (bg - g) * seeBed
				bl += (bb - bl) * seeBed
				r, g, bl = r * aR, g * aG, bl * aB
				-- sunlight through thin water (the crest, the lip), strongest looking into the sun
				local toward = max(-(vx * sunX + vy * sunY + vz * sunZ), 0)
				toward = toward * toward * toward
				local thin = exp(-thick * 0.45)
				local gl = thin * (0.15 + 1.1 * toward) * smoothstep(0.08, 0.7, hf + lip) * 0.45
				r += gR * gl * lR
				g += gG * gl * lG
				bl += gB * gl * lB
				-- Fresnel: the sky reflected at grazing angles
				-- (less on a wave's face: the sky it would mirror is mostly the wave itself)
				local F_ = min(0.02 + 0.98 * (1 - ndv) ^ 5, 0.5) * (1 - 0.6 * lift)
				local ry = 2 * ndv * qy - vy
				local sk = clamp01(ry * 2.2)
				local kr, kg, kb = hor[1] + (zen[1] - hor[1]) * sk, hor[2] + (zen[2] - hor[2]) * sk, hor[3] + (zen[3] - hor[3]) * sk
				kr, kg, kb = kr * 0.88, kg * 0.9, kb * 0.92
				r += (kr - r) * F_
				g += (kg - g) * F_
				bl += (kb - bl) * F_
				-- the sun glinting off the ripples
				local rdx, rdy, rdz = 2 * ndv * qx - vx, 2 * ndv * qy - vy, 2 * ndv * qz - vz
				local rs = max(rdx * sunX + rdy * sunY + rdz * sunZ, 0)
				local glint = (rs ^ 180 * 2.2 + rs ^ 24 * 0.12) * (1 - min(foam, 1))
				r += lR * glint
				g += lG * glint
				bl += lB * glint
			end
			-- foam: lumpy, lit by the sun, shadowed in its crevices
			if foam > 0.02 then
				local fa = min(foam, 1.6)
				local fp = vnoise(x * 0.45, z * 0.45 - t * 0.12) * 0.6 + vnoise(x * 0.14 + 3.1, z * 0.14) * 0.4
				local mask = smoothstep(1 - fa * 0.7, 1.15 - fa * 0.55, fp + 0.15) * min(fa * 1.4, 1)
				mask = min(mask + smoothstep(1, 1.7, fa) * 0.7, 1)
				local lit = 0.55 + 0.45 * max(nx * sunX + ny * sunY + nz * sunZ, 0)
				local shade = (0.72 + 0.28 * fp) * lit
				local fr, fg, fb = 0.92 * shade * (lR * 0.6 + aR * 0.4), 0.96 * shade * (lG * 0.6 + aG * 0.4), 0.98 * shade * (lB * 0.6 + aB * 0.4)
				r += (fr - r) * mask
				g += (fg - g) * mask
				bl += (fb - bl) * mask
			end
			-- shore wash
			if bedY > y - 0.6 and bedY < y + 0.05 then
				local sh = smoothstep(0.55, 0.02, y - bedY) * (0.55 + 0.45 * sin(t * 0.9 + x * 0.07 + z * 0.4))
				r += (0.9 - r) * sh * 0.6
				g += (0.92 - g) * sh * 0.6
				bl += (0.9 - bl) * sh * 0.6
			end
			-- aerial perspective (the water is drawn unlit, which the atmosphere doesn't fog)
			local hz = 1 - exp(-dist * 0.00045)
			r += (hor[1] - r) * hz
			g += (hor[2] - g) * hz
			bl += (hor[3] - bl) * hz
			cols[k] = Color3.new(min(r, 1), min(g, 1), min(bl, 1))
		end
	end
end

return Core
