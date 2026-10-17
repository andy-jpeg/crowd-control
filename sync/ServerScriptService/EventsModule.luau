local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")

local Assets, Podium = ServerStorage:FindFirstChild("Assets"), workspace:FindFirstChild("Podium")

local InvertControls = ReplicatedStorage:FindFirstChild("InvertControls")
local InkScreen = ReplicatedStorage:FindFirstChild("InkScreen")

local DEFAULT_GRAVITY = workspace.Gravity
local COOLDOWNS = {basic = 0, complex = 30}

local BOMB_DROP_HEIGHT, BOMB_DROP_INTERVAL, BOMB_EDGE_PADDING = 40, 0.35, 1.5
local BOMB_WARNING_TIME = 1
local BOMB_FALL_TIME = math.sqrt(2 * BOMB_DROP_HEIGHT / DEFAULT_GRAVITY) -- same fall time as normal gravity, even during low gravity
local BOMB_BLAST_RADIUS, BOMB_DAMAGE = 3, 35
local BOULDER_SIZE, BOULDER_SPEED, BOULDER_DAMAGE, BOULDER_WARNING_TIME = 16, 30, 40, 1.5
local BOULDER_EDGE_GAP = 3
local TSUNAMI_WARNING_TIME, TSUNAMI_SPEED, TSUNAMI_DAMAGE = 5, 40, 60
local TSUNAMI_START_GAP, TSUNAMI_EDGE_INSET, TSUNAMI_HOUSE_LINGER = 10, 8, 2
local TSUNAMI_SAFE_MARGIN = 2
local BANANA_EDGE_PADDING, BANANA_DESPAWN_DELAY = 2, 0.5
local SPRING_SIZE, SPRING_LAUNCH_SPEED, SPRING_PUSH_SPEED, SPRING_COOLDOWN = 4, 90, 15, 1.5
local SPRING_HEIGHT, SPRING_COIL_TURNS, SPRING_COIL_SEGMENTS = 1.8, 3, 12
local SLIME_WALKSPEED, SLIME_CHECK_HEIGHT, SLIME_CHECK_INTERVAL = 6, 4, 0.1
local TRAP_EDGE_PADDING, TRAP_LIFETIME = 2, 10
local SHRINK_WARNING_TIME, SHRINK_TIME, SHRINK_GROW_TIME, SHRINK_SCALE = 2, 5, 3, 0.6
local PODIUM_SIZE, PODIUM_COLOR = Podium and Podium.Size, Podium and Podium.Color
local INDICATOR_COLOR, INDICATOR_TRANSPARENCY = Color3.fromRGB(255, 40, 40), 0.6

local EVENTS = {
	bombs = {method = "Bombs", tier = "basic", params = {count = {default = 5, min = 1, max = 8}}},
	inverted_controls = {method = "InvertedControls", tier = "basic", params = {duration = {default = 10, min = 3, max = 20}}},
	low_gravity = {method = "LowGravity", tier = "basic", params = {duration = {default = 10, min = 3, max = 20}}},
	ink_screen = {method = "InkScreen", tier = "basic", params = {duration = {default = 5, min = 2, max = 10}}},
	banana_peels = {method = "BananaPeels", tier = "basic", params = {count = {default = 3, min = 1, max = 5}}},
	spring_traps = {method = "SpringTraps", tier = "basic", params = {count = {default = 3, min = 1, max = 6}}},
	slime_puddles = {method = "SlimePuddles", tier = "basic", params = {count = {default = 3, min = 1, max = 5}}},

	giant_boulder = {method = "GiantBoulder", tier = "complex", params = {duration = {default = 30, min = 15, max = 45}}},
	floor_is_lava = {method = "FloorIsLava", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	shrinking_podium = {method = "ShrinkingPodium", tier = "complex", params = {duration = {default = 15, min = 5, max = 25}}},
	tornado = {method = "Tornado", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	tsunami = {method = "Tsunami", tier = "complex", params = {}},
	flood_escape = {method = "FloodEscape", tier = "complex", params = {}},
	obby_chase = {method = "ObbyChase", tier = "complex", params = {}},
	blob_fight = {method = "BlobFight", tier = "complex", params = {}},
}

local EventsModule = {}

local random = Random.new()
local lowGravityId, invertId, shrinkId = 0, 0, 0
local podiumTween = nil
local readyAt = {basic = 0, complex = 0}
local pendingThreads = {}
local slimePuddles, slowedHumanoids, slimeLoopRunning = {}, {}, false

local EventObjects = Instance.new("Folder")
EventObjects.Name = "EventObjects"
EventObjects.Parent = workspace

local overlapParams = OverlapParams.new()
overlapParams.FilterType = Enum.RaycastFilterType.Exclude
overlapParams.FilterDescendantsInstances = {EventObjects}

local function notBuilt(name)
	warn("[EventsModule] " .. name .. " isn't built yet")
end

local function getSurface()
	local cframe, size = Podium.CFrame, Podium.Size
	local surface = {}

	if Podium.Shape == Enum.PartType.Cylinder then
		surface.up, surface.axisA, surface.axisB = cframe.RightVector, cframe.UpVector, cframe.LookVector
		surface.halfHeight, surface.radius = size.X / 2, math.min(size.Y, size.Z) / 2
	else
		surface.up, surface.axisA, surface.axisB = cframe.UpVector, cframe.RightVector, cframe.LookVector
		surface.halfHeight, surface.halfA, surface.halfB = size.Y / 2, size.X / 2, size.Z / 2
	end

	if surface.up.Y < 0 then
		surface.up = -surface.up
	end
	surface.center = cframe.Position + surface.up * surface.halfHeight

	return surface
end

local function getDropPosition(margin)
	local surface = getSurface()
	local offsetA, offsetB

	if surface.radius then
		local radius = math.max(0, surface.radius - margin)
		local distance, angle = radius * math.sqrt(random:NextNumber()), random:NextNumber() * 2 * math.pi
		offsetA, offsetB = math.cos(angle) * distance, math.sin(angle) * distance
	else
		local maxA, maxB = math.max(0, surface.halfA - margin), math.max(0, surface.halfB - margin)
		offsetA, offsetB = random:NextNumber(-maxA, maxA), random:NextNumber(-maxB, maxB)
	end

	return surface.center + surface.axisA * offsetA + surface.axisB * offsetB
end

local function getRollPath(halfWidth)
	local surface = getSurface()
	local direction, side, halfLength, offset

	if surface.radius then
		local angle = random:NextNumber() * 2 * math.pi
		direction = surface.axisA * math.cos(angle) + surface.axisB * math.sin(angle)
		side = surface.up:Cross(direction)

		local maxOffset = math.max(0, surface.radius - halfWidth)
		offset = random:NextNumber(-maxOffset, maxOffset)
		halfLength = math.sqrt(surface.radius ^ 2 - offset ^ 2)
	else
		local alongA = random:NextNumber() < 0.5
		direction, side = alongA and surface.axisA or surface.axisB, alongA and surface.axisB or surface.axisA
		halfLength = alongA and surface.halfA or surface.halfB

		local maxOffset = math.max(0, (alongA and surface.halfB or surface.halfA) - halfWidth)
		offset = random:NextNumber(-maxOffset, maxOffset)
	end

	if random:NextNumber() < 0.5 then
		direction = -direction
	end

	local middle = surface.center + side * offset
	return middle - direction * halfLength, middle + direction * halfLength, direction, surface.up
end

local function styleIndicator(part)
	part.Color, part.Transparency, part.Material = INDICATOR_COLOR, INDICATOR_TRANSPARENCY, Enum.Material.Neon
	part.Anchored, part.CanCollide, part.CanTouch, part.CanQuery = true, false, false, false
	part.CastShadow = false
	part.Parent = EventObjects
end

local function damageHumanoids(parts, damage, damaged)
	for _, part in parts do
		local humanoid = part.Parent and part.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid and not damaged[humanoid] then
			damaged[humanoid] = true
			humanoid:TakeDamage(damage)
		end
	end
end

local function damageInRadius(position, radius, damage, damaged)
	damageHumanoids(workspace:GetPartBoundsInRadius(position, radius, overlapParams), damage, damaged)
end

local function createIndicator(position)
	local Indicator = Instance.new("Part")
	Indicator.Name = "BombIndicator"
	Indicator.Shape = Enum.PartType.Cylinder
	Indicator.Size = Vector3.new(0.2, BOMB_BLAST_RADIUS * 2, BOMB_BLAST_RADIUS * 2)
	Indicator.CFrame = CFrame.new(position + Vector3.new(0, 0.1, 0)) * CFrame.Angles(0, 0, math.pi / 2)
	styleIndicator(Indicator)

	return Indicator
end

local function explode(bomb, indicator)
	local explosion = Instance.new("Explosion")
	explosion.BlastRadius, explosion.BlastPressure = BOMB_BLAST_RADIUS, 0 -- no fling
	explosion.DestroyJointRadiusPercent = 0 -- no instant kill, damage is handled below
	explosion.ExplosionType = Enum.ExplosionType.NoCraters
	explosion.Position = bomb.Position

	local damaged = {}
	explosion.Hit:Connect(function(part)
		local humanoid = part.Parent and part.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid and not damaged[humanoid] then
			damaged[humanoid] = true
			humanoid:TakeDamage(BOMB_DAMAGE)
		end
	end)

	explosion.Parent = workspace

	local boomSound = Instance.new("Sound")
	boomSound.SoundId = "rbxasset://sounds/Rocket shot.wav"
	boomSound.Parent = bomb

	bomb.Anchored, bomb.CanCollide, bomb.CanTouch, bomb.Transparency = true, false, false, 1
	boomSound:Play()
	indicator:Destroy()

	task.delay(2, function()
		bomb:Destroy()
	end)
end

local function dropBomb(template, margin)
	local target = getDropPosition(margin)
	local indicator = createIndicator(target)

	task.wait(BOMB_WARNING_TIME)
	if not indicator.Parent then
		return
	end

	local bomb = template:Clone()
	bomb.Name = "Bomb"

	for _, child in bomb:GetChildren() do
		if child:IsA("TouchTransmitter") then
			child:Destroy()
		end
	end

	local landing = target + Vector3.new(0, bomb.Size.Y / 2, 0)

	bomb.Anchored, bomb.CanCollide, bomb.CanTouch = true, false, false
	bomb.CFrame = CFrame.new(landing + Vector3.new(0, BOMB_DROP_HEIGHT, 0))
	bomb.Parent = EventObjects

	local tweenInfo = TweenInfo.new(BOMB_FALL_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In) -- Quad In speeds up like a real fall

	local fallTween = TweenService:Create(bomb, tweenInfo, {CFrame = CFrame.new(landing)})
	fallTween:Play()

	task.wait(BOMB_FALL_TIME)

	if bomb.Parent then
		explode(bomb, indicator)
	end
end

local function rollBoulder()
	local radius = BOULDER_SIZE / 2
	local startPosition, endPosition, direction, up = getRollPath(radius)
	local middle = (startPosition + endPosition) / 2 + up * 0.1

	local offEdge = direction * (radius + BOULDER_EDGE_GAP) -- start and finish fully off the podium so players at the edge are safe
	local rollStart, rollEnd = startPosition - offEdge, endPosition + offEdge
	local rollLength = (rollEnd - rollStart).Magnitude

	local Path = Instance.new("Part")
	Path.Name = "BoulderPath"
	Path.Size = Vector3.new(BOULDER_SIZE, 0.2, rollLength)
	Path.CFrame = CFrame.lookAt(middle, middle + direction, up)
	styleIndicator(Path)

	local Boulder = Instance.new("Part")
	Boulder.Name = "Boulder"
	Boulder.Shape = Enum.PartType.Ball
	Boulder.Size = Vector3.one * BOULDER_SIZE
	Boulder.Material, Boulder.Color = Enum.Material.Slate, Color3.fromRGB(105, 100, 95)
	Boulder.Anchored, Boulder.CanCollide, Boulder.CanQuery = true, false, false
	Boulder.CFrame = CFrame.new(rollStart + up * radius)
	Boulder.Parent = EventObjects

	task.wait(BOULDER_WARNING_TIME)
	if not Boulder.Parent then
		return false
	end

	local progress = Instance.new("NumberValue")
	progress.Parent = Boulder

	local rollAxis, totalAngle = up:Cross(direction), rollLength / radius
	local damaged = {}

	progress.Changed:Connect(function(alpha)
		local position = rollStart:Lerp(rollEnd, alpha) + up * radius
		Boulder.CFrame = CFrame.fromAxisAngle(rollAxis, totalAngle * alpha) + position
		damageInRadius(position, radius, BOULDER_DAMAGE, damaged)
	end)

	local duration = rollLength / BOULDER_SPEED
	local tweenInfo = TweenInfo.new(duration, Enum.EasingStyle.Linear)

	local rollTween = TweenService:Create(progress, tweenInfo, {Value = 1})
	rollTween:Play()

	task.wait(duration)

	if not Boulder.Parent then
		return false
	end

	Boulder:Destroy()
	Path:Destroy()

	return true
end

local function getEdgePosition(inset)
	local surface = getSurface()
	local offsetA, offsetB

	if surface.radius then
		local angle, distance = random:NextNumber() * 2 * math.pi, math.max(0, surface.radius - inset)
		offsetA, offsetB = math.cos(angle) * distance, math.sin(angle) * distance
	else
		local maxA, maxB = math.max(0, surface.halfA - inset), math.max(0, surface.halfB - inset)
		local side = random:NextNumber() < 0.5 and -1 or 1

		if random:NextNumber() < 0.5 then
			offsetA, offsetB = random:NextNumber(-maxA, maxA), maxB * side
		else
			offsetA, offsetB = maxA * side, random:NextNumber(-maxB, maxB)
		end
	end

	return surface.center + surface.axisA * offsetA + surface.axisB * offsetB, surface.center
end

local function teleportToEdge(player)
	local character = player.Character
	if not character or not character:FindFirstChild("HumanoidRootPart") then
		return
	end

	local position, center = getEdgePosition(TSUNAMI_EDGE_INSET)
	position += Vector3.new(0, 3.5, 0)

	character:PivotTo(CFrame.lookAt(position, Vector3.new(center.X, position.Y, center.Z))) -- face the house
end

local function createAreaIndicator()
	local surface = getSurface()

	local Indicator = Instance.new("Part")
	Indicator.Name = "TsunamiIndicator"

	if surface.radius then
		Indicator.Shape = Enum.PartType.Cylinder
		Indicator.Size = Vector3.new(0.2, surface.radius * 2, surface.radius * 2)
		Indicator.CFrame = CFrame.new(surface.center + surface.up * 0.1) * CFrame.Angles(0, 0, math.pi / 2)
	else
		Indicator.Size = Vector3.new(surface.halfA * 2, 0.2, surface.halfB * 2)
		Indicator.CFrame = CFrame.fromMatrix(surface.center + surface.up * 0.1, surface.axisA, surface.up)
	end

	styleIndicator(Indicator)

	return Indicator
end

local function getSweepPath(depth)
	local surface = getSurface()
	local direction, halfLength

	if surface.radius then
		local angle = random:NextNumber() * 2 * math.pi
		direction, halfLength = surface.axisA * math.cos(angle) + surface.axisB * math.sin(angle), surface.radius
	else
		local alongA = random:NextNumber() < 0.5
		direction, halfLength = alongA and surface.axisA or surface.axisB, alongA and surface.halfA or surface.halfB
	end

	if random:NextNumber() < 0.5 then
		direction = -direction
	end
	direction = Vector3.new(direction.X, 0, direction.Z).Unit

	local startPosition = surface.center - direction * (halfLength + TSUNAMI_START_GAP)
	local endPosition = surface.center + direction * (halfLength + depth + TSUNAMI_START_GAP) -- far enough that the back of the wave clears the podium

	return startPosition, endPosition, direction
end

local function placeBanana(template)
	local margin = math.max(template.Size.X, template.Size.Z) / 2 + BANANA_EDGE_PADDING
	local position = getDropPosition(margin)

	local Banana = template:Clone()
	Banana.CFrame = CFrame.new(position + Vector3.new(0, Banana.Size.Y / 2, 0)) * CFrame.Angles(0, random:NextNumber() * 2 * math.pi, 0) * template.CFrame.Rotation
	Banana.Anchored, Banana.CanCollide, Banana.CanTouch, Banana.CanQuery = true, false, true, false
	Banana.Parent = EventObjects

	task.delay(TRAP_LIFETIME, function()
		Banana:Destroy()
	end)

	local slipped = false

	Banana.Touched:Connect(function(hit)
		local humanoid = hit.Parent and hit.Parent:FindFirstChildOfClass("Humanoid")
		if slipped or not humanoid then
			return
		end
		slipped = true

		humanoid.Sit = true

		task.delay(BANANA_DESPAWN_DELAY, function()
			Banana:Destroy()
		end)
	end)
end

local function launchCharacter(rootPart)
	local angle = random:NextNumber() * 2 * math.pi
	local push = Vector3.new(math.cos(angle), 0, math.sin(angle)) * SPRING_PUSH_SPEED

	local Attachment = Instance.new("Attachment")
	Attachment.Parent = rootPart

	local Launch = Instance.new("LinearVelocity") -- a constraint replicates to the player's client, unlike setting velocity on the server
	Launch.Attachment0 = Attachment
	Launch.VectorVelocity = push + Vector3.new(0, SPRING_LAUNCH_SPEED, 0)
	Launch.MaxForce = math.huge
	Launch.RelativeTo = Enum.ActuatorRelativeTo.World
	Launch.Parent = rootPart

	task.delay(0.15, function()
		Launch:Destroy()
		Attachment:Destroy()
	end)
end

local function placeSpring()
	local position = getDropPosition(SPRING_SIZE / 2 + TRAP_EDGE_PADDING)
	local coilRadius = SPRING_SIZE / 2 * 0.6
	local flat = CFrame.Angles(0, 0, math.pi / 2) -- cylinders lie on their side by default

	local Spring = Instance.new("Model")
	Spring.Name = "SpringTrap"

	local function addPart(name, shape, size, color, material)
		local Part = Instance.new("Part")
		Part.Name, Part.Shape, Part.Size = name, shape, size
		Part.Color, Part.Material = color, material
		Part.Anchored, Part.CanCollide, Part.CanTouch, Part.CanQuery = true, false, false, false
		Part.Parent = Spring

		return Part
	end

	local Base = addPart("Base", Enum.PartType.Cylinder, Vector3.new(0.4, SPRING_SIZE, SPRING_SIZE), Color3.fromRGB(60, 60, 65), Enum.Material.DiamondPlate)
	Base.CFrame = CFrame.new(position + Vector3.new(0, 0.2, 0)) * flat

	local coils = {}
	local coilCount = SPRING_COIL_TURNS * SPRING_COIL_SEGMENTS
	local segmentLength = 2 * math.pi * coilRadius / SPRING_COIL_SEGMENTS + 0.1

	for i = 0, coilCount - 1 do
		local Coil = addPart("Coil", Enum.PartType.Block, Vector3.new(0.25, 0.25, segmentLength), Color3.fromRGB(200, 200, 210), Enum.Material.Metal)
		table.insert(coils, {part = Coil, angle = i / SPRING_COIL_SEGMENTS * 2 * math.pi, height = i / coilCount * SPRING_HEIGHT})
	end

	local Pad = addPart("Pad", Enum.PartType.Cylinder, Vector3.new(0.4, SPRING_SIZE * 0.9, SPRING_SIZE * 0.9), Color3.fromRGB(248, 167, 34), Enum.Material.SmoothPlastic)
	Pad.CanTouch = true

	local function setCompression(scale)
		for _, coil in coils do
			local point = position + Vector3.new(math.cos(coil.angle) * coilRadius, 0.4 + coil.height * scale, math.sin(coil.angle) * coilRadius)
			local tangent = Vector3.new(-math.sin(coil.angle), 0, math.cos(coil.angle))
			coil.part.CFrame = CFrame.lookAt(point, point + tangent)
		end

		Pad.CFrame = CFrame.new(position + Vector3.new(0, 0.6 + SPRING_HEIGHT * scale, 0)) * flat
	end

	local Compression = Instance.new("NumberValue")
	Compression.Value = 1
	Compression.Parent = Spring
	Compression.Changed:Connect(setCompression)

	setCompression(1)
	Spring.Parent = EventObjects

	task.delay(TRAP_LIFETIME, function()
		Spring:Destroy()
	end)

	local squashInfo = TweenInfo.new(0.08, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	local bounceInfo = TweenInfo.new(0.6, Enum.EasingStyle.Elastic, Enum.EasingDirection.Out)
	local lastLaunch = {}

	Pad.Touched:Connect(function(hit)
		local character = hit.Parent
		local rootPart = character and character:FindFirstChild("HumanoidRootPart")
		if not rootPart or not character:FindFirstChildOfClass("Humanoid") then
			return
		end

		if os.clock() - (lastLaunch[character] or 0) < SPRING_COOLDOWN then
			return
		end
		lastLaunch[character] = os.clock()

		launchCharacter(rootPart)

		local squashTween = TweenService:Create(Compression, squashInfo, {Value = 0.35})
		squashTween:Play()

		task.wait(0.08)
		if not Spring.Parent then
			return
		end

		local bounceTween = TweenService:Create(Compression, bounceInfo, {Value = 1})
		bounceTween:Play()
	end)
end

local function updateSlime()
	local inSlime = {}

	for i = #slimePuddles, 1, -1 do
		local puddle = slimePuddles[i]

		if not puddle.part.Parent then
			table.remove(slimePuddles, i)
		else
			for _, part in workspace:GetPartBoundsInBox(puddle.box, puddle.size, overlapParams) do
				local humanoid = part.Parent and part.Parent:FindFirstChildOfClass("Humanoid")
				if humanoid then
					inSlime[humanoid] = true
				end
			end
		end
	end

	for humanoid, originalSpeed in slowedHumanoids do
		if not inSlime[humanoid] then
			humanoid.WalkSpeed = originalSpeed
			slowedHumanoids[humanoid] = nil
		end
	end

	for humanoid in inSlime do
		if not slowedHumanoids[humanoid] then
			slowedHumanoids[humanoid] = humanoid.WalkSpeed
			humanoid.WalkSpeed = SLIME_WALKSPEED
		end
	end
end

local function startSlimeLoop()
	if slimeLoopRunning then
		return
	end
	slimeLoopRunning = true

	task.spawn(function()
		while #slimePuddles > 0 or next(slowedHumanoids) do
			updateSlime()
			task.wait(SLIME_CHECK_INTERVAL)
		end

		slimeLoopRunning = false
	end)
end

local function placeSlimePuddle(template)
	local footprint = math.max(template.Size.X, template.Size.Z)
	local position = getDropPosition(footprint / 2 + TRAP_EDGE_PADDING)
	local yaw = CFrame.Angles(0, random:NextNumber() * 2 * math.pi, 0)

	local Puddle = template:Clone()
	Puddle.CFrame = CFrame.new(position + Vector3.new(0, Puddle.Size.Y / 2, 0)) * yaw * template.CFrame.Rotation
	Puddle.Anchored, Puddle.CanCollide, Puddle.CanTouch, Puddle.CanQuery = true, false, false, false
	Puddle.Parent = EventObjects

	task.delay(TRAP_LIFETIME, function()
		Puddle:Destroy()
	end)

	table.insert(slimePuddles, {
		part = Puddle,
		box = CFrame.new(position + Vector3.new(0, SLIME_CHECK_HEIGHT / 2, 0)) * yaw,
		size = Vector3.new(template.Size.X, SLIME_CHECK_HEIGHT, template.Size.Z),
	})

	startSlimeLoop()
end

local function getShrunkSize(scale)
	if Podium.Shape == Enum.PartType.Cylinder then -- a cylinder's length runs along X, so its top is the Y/Z circle
		return Vector3.new(PODIUM_SIZE.X, PODIUM_SIZE.Y * scale, PODIUM_SIZE.Z * scale)
	end

	return Vector3.new(PODIUM_SIZE.X * scale, PODIUM_SIZE.Y, PODIUM_SIZE.Z * scale)
end

local function playPodiumTween(tweenInfo, goal)
	if podiumTween then
		podiumTween:Cancel()
	end

	podiumTween = TweenService:Create(Podium, tweenInfo, goal)
	podiumTween:Play()
end

local function cleanParams(info, rawParams)
	local params = {}

	for name, spec in info.params do
		local value = type(rawParams) == "table" and rawParams[name] or nil
		params[name] = type(value) == "number" and math.clamp(value, spec.min, spec.max) or spec.default
	end

	return params
end

function EventsModule:Run(event)
	if type(event) ~= "table" or type(event.type) ~= "string" then
		warn("[EventsModule] ignored malformed event")
		return false
	end

	local info = EVENTS[event.type]
	if not info then
		warn("[EventsModule] ignored unknown event type: " .. event.type)
		return false
	end

	local params = cleanParams(info, event.params)

	local now = os.clock()
	local startAt = math.max(now, readyAt[info.tier])
	readyAt[info.tier] = startAt + COOLDOWNS[info.tier]

	local delay = startAt - now
	if delay > 0 then
		table.insert(pendingThreads, task.delay(delay, self[info.method], self, params))
	else
		table.insert(pendingThreads, task.spawn(self[info.method], self, params)) -- tracked so Reset can stop events still running
	end

	return true, delay
end

function EventsModule:GetCooldown(tier)
	return math.max(0, (readyAt[tier] or 0) - os.clock())
end

function EventsModule:GetPodiumTop()
	return Podium and getSurface().center or nil
end

function EventsModule:GetDisplayName(eventType)
	local info = EVENTS[eventType]
	return info and (string.gsub(info.method, "(%l)(%u)", "%1 %2")) or "an event" -- GiantBoulder -> Giant Boulder
end

function EventsModule:GetTier(eventType)
	local info = EVENTS[eventType]
	return info and info.tier or nil
end

function EventsModule:Reset()
	for _, thread in pendingThreads do
		pcall(task.cancel, thread)
	end
	table.clear(pendingThreads)
	readyAt.basic, readyAt.complex = 0, 0

	EventObjects:ClearAllChildren()
	updateSlime()

	lowGravityId += 1
	workspace.Gravity = DEFAULT_GRAVITY

	invertId += 1
	InvertControls:FireAllClients(false)

	InkScreen:FireAllClients(0)

	shrinkId += 1
	if podiumTween then
		podiumTween:Cancel()
	end
	if Podium then
		Podium.Size, Podium.Color = PODIUM_SIZE, PODIUM_COLOR
	end
end

function EventsModule:Bombs(params)
	local tool = Assets and Assets:FindFirstChild("Bomb")
	local template = tool and tool:FindFirstChild("Handle")
	if not template or not Podium then
		warn("[EventsModule] Bombs needs ServerStorage.Assets.ClassicTimebomb.Handle and workspace.Podium")
		return
	end

	local margin = math.max(template.Size.X, template.Size.Z) / 2 + BOMB_EDGE_PADDING

	for _ = 1, params.count do
		task.spawn(dropBomb, template, margin)
		task.wait(BOMB_DROP_INTERVAL)
	end
end

function EventsModule:GiantBoulder(params)
	if not Podium then
		warn("[EventsModule] GiantBoulder needs workspace.Podium")
		return
	end

	local endTime = os.clock() + params.duration

	while os.clock() < endTime do
		if not rollBoulder() then
			return
		end
	end
end

function EventsModule:InvertedControls(params)
	invertId += 1
	local thisId = invertId

	InvertControls:FireAllClients(true)

	task.wait(params.duration)

	if invertId == thisId then -- a newer InvertedControls owns the reset
		InvertControls:FireAllClients(false)
	end
end

function EventsModule:LowGravity(params)
	lowGravityId += 1
	local thisId = lowGravityId

	workspace.Gravity = DEFAULT_GRAVITY * 0.3

	task.wait(params.duration)

	if lowGravityId == thisId then -- a newer LowGravity owns the reset
		workspace.Gravity = DEFAULT_GRAVITY
	end
end

function EventsModule:BananaPeels(params)
	local template = Assets and Assets:FindFirstChild("Banana")
	if not template or not Podium then
		warn("[EventsModule] BananaPeels needs ServerStorage.Assets.Banana and workspace.Podium")
		return
	end

	for _ = 1, params.count do
		placeBanana(template)
	end
end

function EventsModule:SpringTraps(params)
	if not Podium then
		warn("[EventsModule] SpringTraps needs workspace.Podium")
		return
	end

	for _ = 1, params.count do
		placeSpring()
	end
end

function EventsModule:SlimePuddles(params)
	local template = Assets and Assets:FindFirstChild("SlimePuddle")
	if not template or not Podium then
		warn("[EventsModule] SlimePuddles needs ServerStorage.Assets.SlimePuddle and workspace.Podium")
		return
	end

	for _ = 1, params.count do
		placeSlimePuddle(template)
	end
end

function EventsModule:InkScreen(params)
	InkScreen:FireAllClients(params.duration)
end

function EventsModule:FloorIsLava(params)
	notBuilt("FloorIsLava")
end

function EventsModule:ShrinkingPodium(params)
	if not Podium then
		warn("[EventsModule] ShrinkingPodium needs workspace.Podium")
		return
	end

	shrinkId += 1
	local thisId = shrinkId

	local flashCount = math.max(1, math.floor(SHRINK_WARNING_TIME / 0.5))
	local tweenInfo1 = TweenInfo.new(0.25, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, flashCount - 1, true)
	playPodiumTween(tweenInfo1, {Color = INDICATOR_COLOR})

	task.wait(SHRINK_WARNING_TIME)
	if shrinkId ~= thisId then
		return
	end

	Podium.Color = PODIUM_COLOR

	local tweenInfo2 = TweenInfo.new(SHRINK_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut)
	playPodiumTween(tweenInfo2, {Size = getShrunkSize(SHRINK_SCALE)})

	task.wait(SHRINK_TIME + params.duration)
	if shrinkId ~= thisId then -- a newer ShrinkingPodium or Reset owns the podium now
		return
	end

	local tweenInfo3 = TweenInfo.new(SHRINK_GROW_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	playPodiumTween(tweenInfo3, {Size = PODIUM_SIZE})
end

function EventsModule:Tornado(params)
	notBuilt("Tornado")
end

function EventsModule:Tsunami(params)
	local houseTemplate = Assets and Assets:FindFirstChild("House")
	local tsunamiTemplate = Assets and Assets:FindFirstChild("Tsunami")
	if not houseTemplate or not tsunamiTemplate or not Podium then
		warn("[EventsModule] Tsunami needs ServerStorage.Assets.House, ServerStorage.Assets.Tsunami and workspace.Podium")
		return
	end

	local House = houseTemplate:Clone()
	for _, part in House:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = true
		end
	end
	House.Parent = EventObjects

	local Indicator = createAreaIndicator()

	for _, player in Players:GetPlayers() do
		teleportToEdge(player)
	end

	task.wait(TSUNAMI_WARNING_TIME)
	if not House.Parent then
		return
	end

	local height = tsunamiTemplate:GetPivot().Position.Y
	local startPosition, endPosition, direction = getSweepPath(tsunamiTemplate:GetExtentsSize().Z)
	startPosition, endPosition = Vector3.new(startPosition.X, height, startPosition.Z), Vector3.new(endPosition.X, height, endPosition.Z)

	local Tsunami = tsunamiTemplate:Clone()
	Tsunami:PivotTo(CFrame.lookAt(startPosition, startPosition + direction))
	Tsunami.Parent = EventObjects

	local waterParts, crestZ, crestHeight = {}, 0, -math.huge
	for _, part in Tsunami:GetDescendants() do
		if part:IsA("BasePart") and part ~= Tsunami.PrimaryPart then
			table.insert(waterParts, part)

			local localPosition = Tsunami:GetPivot():PointToObjectSpace(part.Position)
			if localPosition.Y > crestHeight then
				crestZ, crestHeight = localPosition.Z, localPosition.Y
			end
		end
	end

	local progress = Instance.new("NumberValue")
	progress.Parent = Tsunami

	local damaged = {}

	progress.Changed:Connect(function(alpha)
		local position = startPosition:Lerp(endPosition, alpha)
		Tsunami:PivotTo(CFrame.lookAt(position, position + direction))

		local pivot = Tsunami:GetPivot()

		for _, player in Players:GetPlayers() do
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			local rootPart = character and character:FindFirstChild("HumanoidRootPart")

			if humanoid and rootPart and pivot:PointToObjectSpace(rootPart.Position).Z > crestZ + TSUNAMI_SAFE_MARGIN then
				damaged[humanoid] = true -- the crest already passed them, so the trailing water can't hurt them anymore
			end
		end

		for _, waterPart in waterParts do
			damageHumanoids(workspace:GetPartsInPart(waterPart, overlapParams), TSUNAMI_DAMAGE, damaged)
		end
	end)

	local duration = (endPosition - startPosition).Magnitude / TSUNAMI_SPEED
	local tweenInfo = TweenInfo.new(duration, Enum.EasingStyle.Linear)

	local sweepTween = TweenService:Create(progress, tweenInfo, {Value = 1})
	sweepTween:Play()

	task.wait(duration)
	if not House.Parent then
		return
	end

	Tsunami:Destroy()
	Indicator:Destroy()

	task.wait(TSUNAMI_HOUSE_LINGER)

	if House.Parent then
		House:Destroy()
	end
end

function EventsModule:FloodEscape(params)
	notBuilt("FloodEscape")
end

function EventsModule:ObbyChase(params)
	notBuilt("ObbyChase")
end

function EventsModule:BlobFight(params)
	notBuilt("BlobFight")
end

for _, info in EVENTS do -- direct calls like EventsModule:Bombs() get the same defaults and clamping as Run
	local method = EventsModule[info.method]
	EventsModule[info.method] = function(self, params)
		return method(self, cleanParams(info, params))
	end
end

return EventsModule
