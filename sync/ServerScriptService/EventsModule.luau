local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")

local Assets, Podium = ServerStorage:FindFirstChild("Assets"), workspace:FindFirstChild("Podium")

local InvertControls = ReplicatedStorage:FindFirstChild("InvertControls")
local InkScreen = ReplicatedStorage:FindFirstChild("InkScreen")
local ShakeScreen = ReplicatedStorage:FindFirstChild("ShakeScreen")

local DEFAULT_GRAVITY = workspace.Gravity
local COOLDOWNS = {basic = 0, complex = 30}

local BOMB_DROP_HEIGHT, BOMB_DROP_INTERVAL, BOMB_EDGE_PADDING = 40, 0.35, 1.5
local BOMB_WARNING_TIME = 1
local BOMB_FALL_TIME = math.sqrt(2 * BOMB_DROP_HEIGHT / DEFAULT_GRAVITY) -- same fall time as normal gravity, even during low gravity
local BOMB_BLAST_RADIUS, BOMB_DAMAGE = 3, 35
local BOULDER_SIZE, BOULDER_SPEED, BOULDER_DAMAGE, BOULDER_WARNING_TIME = 16, 30, 40, 1.5
local BOULDER_EDGE_GAP, BOULDER_COUNT = 3, 3
local TSUNAMI_WARNING_TIME, TSUNAMI_SPEED, TSUNAMI_DAMAGE = 5, 40, 60
local TSUNAMI_START_GAP, TSUNAMI_EDGE_INSET, TSUNAMI_HOUSE_LINGER = 10, 8, 2
local TSUNAMI_SAFE_MARGIN = 2
local BANANA_EDGE_PADDING, BANANA_DESPAWN_DELAY = 2, 0.5
local SPRING_SIZE, SPRING_LAUNCH_SPEED, SPRING_PUSH_SPEED, SPRING_COOLDOWN = 4, 90, 15, 1.5
local SPRING_HEIGHT, SPRING_COIL_TURNS, SPRING_COIL_SEGMENTS = 1.8, 3, 12
local SPRING_SOUND_ID, SPRING_SOUND_VOLUME = "rbxassetid://109397400639910", 0.8 -- Classic Roblox Jump
local SLIME_WALKSPEED, SLIME_CHECK_HEIGHT, SLIME_CHECK_INTERVAL = 6, 4, 0.1
local TRAP_EDGE_PADDING, TRAP_LIFETIME = 2, 10
local SHRINK_WARNING_TIME, SHRINK_TIME, SHRINK_GROW_TIME, SHRINK_SCALE = 2, 5, 3, 0.6
local LAVA_WARNING_TIME, LAVA_DAMAGE_PER_SECOND, LAVA_CHECK_INTERVAL = 3, 25, 0.1
local LAVA_PLATFORM_COUNT, LAVA_PLATFORM_SIZE, LAVA_PLATFORM_HEIGHT, LAVA_EDGE_PADDING = 4, 6, 4, 2
local LAVA_RISE_TIME, LAVA_SINK_TIME, LAVA_WOBBLE_COUNT, LAVA_PLACEMENT_TRIES = 1, 1, 6, 10
local LAVA_COLOR, LAVA_PLATFORM_COLOR, LAVA_MATERIAL = Color3.fromRGB(255, 90, 20), Color3.fromRGB(90, 85, 80), Enum.Material.Neon
local LAVA_RAY_LENGTH = 4 -- how far below a player's root the podium can be and still burn them
local FLOOD_WARNING_TIME, FLOOD_RISE_SPEED, FLOOD_HOLD_TIME, FLOOD_DRAIN_TIME = 3, 1.6, 4, 3
local FLOOD_STEP_COUNT, FLOOD_STEP_HEIGHT, FLOOD_STEP_SIZE, FLOOD_STEP_ANGLE = 7, 3, 6, 70
local FLOOD_STAIR_RADIUS, FLOOD_EDGE_PADDING = 10, 1
local CAMERA_POSITION = Vector3.new(-56.668, 121.263, -46.513) -- matches FixedCamera, used to build the stairs on the side facing it
local FLOOD_PEAK_OFFSET, FLOOD_DAMAGE_PER_SECOND, FLOOD_CHECK_INTERVAL, FLOOD_MARGIN = 1.5, 20, 0.1, 12
local FLOOD_COLOR, FLOOD_STEP_COLOR, FLOOD_HIDDEN_LEVEL = Color3.fromRGB(40, 120, 255), Color3.fromRGB(120, 95, 70), -0.5
local TORNADO_DROP_HEIGHT, TORNADO_DROP_TIME, TORNADO_SPEED, TORNADO_SPIN_SPEED = 80, 2, 11, 6
local TORNADO_HIT_RADIUS, TORNADO_DAMAGE, TORNADO_HIT_COOLDOWN = 6, 20, 1
local TORNADO_FLING_SPEED, TORNADO_LIFT_SPEED, TORNADO_EDGE_PADDING = 25, 45, 2
local SLIME_DROP_HEIGHT, SLIME_DROP_TIME, SLIME_CHARGE_TIME, SLIME_REST_TIME = 80, 1.5, 1, 0.6
local SLIME_JUMP_HEIGHT, SLIME_JUMP_TIME, SLIME_CROUCH_DEPTH, SLIME_HIT_SCALE = 25, 1.2, 1.5, 0.9
local SLIME_DAMAGE, SLIME_KNOCKBACK_SPEED, SLIME_LIFT_SPEED, SLIME_EDGE_PADDING, SLIME_FACING_OFFSET = 35, 30, 30, 4, 0
local SLIME_TURN_SPEED = 6 -- radians per second while charging
local SLIME_MAX_HEALTH, SLIME_FADE_TIME, SLIME_HEALTH_COLOR = 150, 0.6, Color3.fromRGB(120, 220, 90)
local SWORD_DAMAGE, SWORD_COOLDOWN, SWORD_REACH, SWORD_MAX_HEIGHT = 10, 0.4, 5, 6
local PODIUM_SIZE, PODIUM_COLOR, PODIUM_MATERIAL = Podium and Podium.Size, Podium and Podium.Color, Podium and Podium.Material
local INDICATOR_COLOR, INDICATOR_TRANSPARENCY = Color3.fromRGB(255, 40, 40), 0.6
local BOMB_SHAKE, SLAM_SHAKE, BOULDER_SHAKE, TSUNAMI_SHAKE = 0.6, 1, 0.35, 0.5 -- degrees the screen shakes
local TORNADO_SHAKE, SHRINK_SHAKE, LAVA_SHAKE = 0.2, 0.3, 0.3
local BOMB_SHAKE_TIME, SLAM_SHAKE_TIME = 0.4, 0.5

local EVENTS = {
	bombs = {method = "Bombs", name = "Bombs", tier = "basic", params = {count = {default = 5, min = 1, max = 8}}},
	inverted_controls = {method = "InvertedControls", name = "Inverted Controls", tier = "basic", params = {duration = {default = 10, min = 3, max = 20}}},
	low_gravity = {method = "LowGravity", name = "Low Gravity", tier = "basic", params = {duration = {default = 10, min = 3, max = 20}}},
	ink_screen = {method = "InkScreen", name = "Squid Screen", tier = "basic", params = {duration = {default = 10, min = 2, max = 10}}},
	banana_peels = {method = "BananaPeels", name = "Banana Peels", tier = "basic", params = {count = {default = 3, min = 1, max = 5}}},
	spring_traps = {method = "SpringTraps", name = "Spring Traps", tier = "basic", params = {count = {default = 3, min = 1, max = 6}}},
	slime_puddles = {method = "SlimePuddles", name = "Slime Puddles", tier = "basic", params = {count = {default = 3, min = 1, max = 5}}},

	giant_boulder = {method = "GiantBoulder", name = "Giant Boulder", tip = "Dodge the rolling boulders!", tier = "complex", params = {duration = {default = 30, min = 15, max = 45}}},
	floor_is_lava = {method = "FloorIsLava", name = "Floor Is Lava", tip = "Jump onto a platform before the floor burns!", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	shrinking_podium = {method = "ShrinkingPodium", name = "Shrinking Podium", tip = "Stay near the center!", tier = "complex", params = {duration = {default = 15, min = 5, max = 25}}},
	tornado = {method = "Tornado", name = "Tornado", tip = "Keep moving, it chases the closest player!", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	tsunami = {method = "Tsunami", name = "Tsunami", tip = "Hide inside the house!", tier = "complex", params = {}},
	flood_escape = {method = "FloodEscape", name = "Flood Escape", tip = "Get to higher ground!", tier = "complex", params = {}},
	blob_fight = {method = "BlobFight", name = "Blob Fight", tip = "Grab your sword and slay the slime!", tier = "complex", params = {}},
}

local EventsModule = {}

local random = Random.new()
local lowGravityId, invertId, shrinkId, lavaId, floodId, tornadoId, slimeId = 0, 0, 0, 0, 0, 0, 0
local podiumTween, lavaTween = nil, nil
local readyAt = {basic = 0, complex = 0}
local pendingThreads = {}
local slimePuddles, slowedHumanoids, slimeLoopRunning = {}, {}, false

if not ShakeScreen then
	ShakeScreen = Instance.new("RemoteEvent")
	ShakeScreen.Name = "ShakeScreen"
	ShakeScreen.Parent = ReplicatedStorage
end

local EventObjects = Instance.new("Folder")
EventObjects.Name = "EventObjects"
EventObjects.Parent = workspace

local overlapParams = OverlapParams.new()
overlapParams.FilterType = Enum.RaycastFilterType.Exclude
overlapParams.FilterDescendantsInstances = {EventObjects}

local lavaRayParams = RaycastParams.new()
lavaRayParams.FilterType = Enum.RaycastFilterType.Include
lavaRayParams.FilterDescendantsInstances = {Podium}

local function shakeScreen(strength, duration) -- FixedCamera on each client does the shaking
	ShakeScreen:FireAllClients(strength, duration)
end

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
	shakeScreen(BOMB_SHAKE, BOMB_SHAKE_TIME)

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
	shakeScreen(BOULDER_SHAKE, duration)

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

local function launchCharacter(rootPart, velocity)
	local angle = random:NextNumber() * 2 * math.pi
	local push = Vector3.new(math.cos(angle), 0, math.sin(angle)) * SPRING_PUSH_SPEED

	local Attachment = Instance.new("Attachment")
	Attachment.Parent = rootPart

	local Launch = Instance.new("LinearVelocity") -- a constraint replicates to the player's client, unlike setting velocity on the server
	Launch.Attachment0 = Attachment
	Launch.VectorVelocity = velocity or push + Vector3.new(0, SPRING_LAUNCH_SPEED, 0)
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

	local JumpSound = Instance.new("Sound")
	JumpSound.Name = "JumpSound"
	JumpSound.SoundId, JumpSound.Volume = SPRING_SOUND_ID, SPRING_SOUND_VOLUME
	JumpSound.Parent = Pad -- plays from the spring, so it's louder the closer you are

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
		JumpSound.TimePosition = 0
		JumpSound:Play()

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

local function getPlatformPositions(count, margin)
	local positions = {}

	for _ = 1, count do
		local best, bestDistance = nil, -1

		for _ = 1, LAVA_PLACEMENT_TRIES do -- keep the candidate farthest from the others so platforms spread out
			local position = getDropPosition(margin)
			local nearest = math.huge
			for _, other in positions do
				nearest = math.min(nearest, (position - other).Magnitude)
			end

			if nearest > bestDistance then
				best, bestDistance = position, nearest
			end
		end

		table.insert(positions, best)
	end

	return positions
end

local function createLavaPlatform(position, surface)
	local Platform = Instance.new("Part")
	Platform.Name = "LavaPlatform"
	Platform.Size = Vector3.new(LAVA_PLATFORM_SIZE, LAVA_PLATFORM_HEIGHT, LAVA_PLATFORM_SIZE)
	Platform.Material, Platform.Color = Enum.Material.Slate, LAVA_PLATFORM_COLOR
	Platform.Anchored = true
	Platform.CFrame = CFrame.fromMatrix(position - surface.up * (LAVA_PLATFORM_HEIGHT / 2), surface.axisA, surface.up) -- starts hidden inside the podium
	Platform.Parent = EventObjects

	return Platform
end

local function sinkPlatform(Platform, up, shouldWobble)
	if not Platform.Parent then
		return
	end

	local restCFrame = Platform.CFrame

	if shouldWobble then
		Platform.Color = INDICATOR_COLOR

		local tweenInfo1 = TweenInfo.new(0.08, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, LAVA_WOBBLE_COUNT - 1, true)
		TweenService:Create(Platform, tweenInfo1, {CFrame = restCFrame * CFrame.Angles(0, 0, math.rad(4))}):Play()

		task.wait(0.16 * LAVA_WOBBLE_COUNT)
		if not Platform.Parent then
			return
		end
	end

	local tweenInfo2 = TweenInfo.new(LAVA_SINK_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	TweenService:Create(Platform, tweenInfo2, {CFrame = restCFrame - up * LAVA_PLATFORM_HEIGHT}):Play()

	task.wait(LAVA_SINK_TIME)
	Platform:Destroy()
end

local function burnPlayers(thisId, endTime)
	while lavaId == thisId and os.clock() < endTime do
		for _, player in Players:GetPlayers() do
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			local rootPart = humanoid and humanoid.RootPart

			if humanoid and humanoid.Health > 0 and rootPart and humanoid.FloorMaterial ~= Enum.Material.Air -- mid-jump or on a platform is safe
				and workspace:Raycast(rootPart.Position, Vector3.new(0, -LAVA_RAY_LENGTH, 0), lavaRayParams) then
				humanoid:TakeDamage(LAVA_DAMAGE_PER_SECOND * LAVA_CHECK_INTERVAL)
			end
		end

		task.wait(LAVA_CHECK_INTERVAL)
	end
end

local function createFloodSteps(surface)
	local steps = {}
	local podiumRadius = surface.radius or math.min(surface.halfA, surface.halfB)

	local toCamera = CAMERA_POSITION - surface.center
	toCamera -= surface.up * toCamera:Dot(surface.up)
	local cameraAngle = toCamera.Magnitude > 0.01 and math.atan2(toCamera:Dot(surface.axisB), toCamera:Dot(surface.axisA)) or 0
	local towardCamera = surface.axisA * math.cos(cameraAngle) + surface.axisB * math.sin(cameraAngle)

	local stairOffset = math.max(0, podiumRadius - FLOOD_STAIR_RADIUS - FLOOD_STEP_SIZE / 2 - FLOOD_EDGE_PADDING)
	local stairCenter = surface.center + towardCamera * stairOffset
	local startAngle = cameraAngle - math.rad(FLOOD_STEP_ANGLE) * (FLOOD_STEP_COUNT - 1) -- the top step ends up closest to the camera
	local tweenInfo = TweenInfo.new(0.6, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

	for index = 1, FLOOD_STEP_COUNT do
		local angle = startAngle + math.rad(FLOOD_STEP_ANGLE) * (index - 1)
		local position = stairCenter + (surface.axisA * math.cos(angle) + surface.axisB * math.sin(angle)) * FLOOD_STAIR_RADIUS

		local Step = Instance.new("Part")
		Step.Name = "FloodStep"
		Step.Size = Vector3.new(FLOOD_STEP_SIZE, 1, FLOOD_STEP_SIZE)
		Step.Material, Step.Color = Enum.Material.WoodPlanks, FLOOD_STEP_COLOR
		Step.Anchored = true
		Step.CFrame = CFrame.fromMatrix(position - surface.up * 0.5, surface.axisA, surface.up) -- starts flush with the podium
		Step.Parent = EventObjects
		table.insert(steps, Step)

		local goal = {CFrame = Step.CFrame + surface.up * (index * FLOOD_STEP_HEIGHT)}
		task.delay((index - 1) * 0.1, function()
			if Step.Parent then
				TweenService:Create(Step, tweenInfo, goal):Play()
			end
		end)
	end

	return steps
end

local function createFloodWater(surface)
	local podiumRadius = surface.radius or math.max(surface.halfA, surface.halfB)

	local Water = Instance.new("Part")
	Water.Name = "FloodWater"
	Water.Material, Water.Color, Water.Transparency = Enum.Material.SmoothPlastic, FLOOD_COLOR, 0.35
	Water.Anchored, Water.CanCollide, Water.CanTouch, Water.CanQuery = true, false, false, false
	Water.CastShadow = false
	Water.Parent = EventObjects

	return Water, (podiumRadius + FLOOD_MARGIN) * 2
end

local function setWaterLevel(Water, surface, footprint, level)
	local depth = math.max(0.1, surface.halfHeight * 2 + level) -- from the podium's bottom up to the water line
	Water.Size = Vector3.new(footprint, depth, footprint)
	Water.CFrame = CFrame.fromMatrix(surface.center + surface.up * (level - depth / 2), surface.axisA, surface.up)
end

local function drownPlayers(thisId, surface, level)
	while floodId == thisId and level.Parent do
		local waterLine = surface.center + surface.up * level.Value

		for _, player in Players:GetPlayers() do
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			local Head = character and character:FindFirstChild("Head")

			if humanoid and humanoid.Health > 0 and Head and (Head.Position - waterLine):Dot(surface.up) < 0 then
				humanoid:TakeDamage(FLOOD_DAMAGE_PER_SECOND * FLOOD_CHECK_INTERVAL)
			end
		end

		task.wait(FLOOD_CHECK_INTERVAL)
	end
end

local function clampToPodium(position, surface, margin)
	local offset = position - surface.center
	local a, b = offset:Dot(surface.axisA), offset:Dot(surface.axisB)

	if surface.radius then
		local maxDistance = math.max(0, surface.radius - margin)
		local distance = math.sqrt(a * a + b * b)
		if distance > maxDistance then
			a, b = a / distance * maxDistance, b / distance * maxDistance
		end
	else
		local maxA, maxB = math.max(0, surface.halfA - margin), math.max(0, surface.halfB - margin)
		a, b = math.clamp(a, -maxA, maxA), math.clamp(b, -maxB, maxB)
	end

	return surface.center + surface.axisA * a + surface.axisB * b
end

local function getFlatOffset(from, to, up)
	local offset = to - from
	return offset - up * offset:Dot(up), offset:Dot(up)
end

local function findClosestRoot(position, up)
	local closest, closestDistance = nil, math.huge

	for _, player in Players:GetPlayers() do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local rootPart = humanoid and humanoid.Health > 0 and humanoid.RootPart

		if rootPart then
			local distance = getFlatOffset(position, rootPart.Position, up).Magnitude
			if distance < closestDistance then
				closest, closestDistance = rootPart, distance
			end
		end
	end

	return closest
end

local function hitTornadoTargets(position, surface, lastHit)
	for _, player in Players:GetPlayers() do
		local character = player.Character
		local humanoid = character and character:FindFirstChildOfClass("Humanoid")
		local rootPart = humanoid and humanoid.Health > 0 and humanoid.RootPart

		if rootPart then
			local flat, height = getFlatOffset(position, rootPart.Position, surface.up)

			if flat.Magnitude <= TORNADO_HIT_RADIUS and height > -2 and os.clock() - (lastHit[humanoid] or 0) >= TORNADO_HIT_COOLDOWN then
				lastHit[humanoid] = os.clock()
				humanoid:TakeDamage(TORNADO_DAMAGE)

				local away = flat.Magnitude > 0.1 and flat.Unit or surface.axisA
				launchCharacter(rootPart, away * TORNADO_FLING_SPEED + surface.up * TORNADO_LIFT_SPEED)
			end
		end
	end
end

local function createCircleIndicator(position, surface, radius, name)
	local Indicator = Instance.new("Part")
	Indicator.Name = name
	Indicator.Shape = Enum.PartType.Cylinder
	Indicator.Size = Vector3.new(0.2, radius * 2, radius * 2)
	Indicator.CFrame = CFrame.fromMatrix(position + surface.up * 0.1, surface.up, surface.axisA) -- a cylinder's length runs along X
	styleIndicator(Indicator)

	return Indicator
end

local function prepareModel(Model)
	for _, part in Model:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored, part.CanCollide, part.CanTouch, part.CanQuery = true, false, false, false
		end
	end
end

local function removeEventTools()
	for _, player in Players:GetPlayers() do
		for _, container in {player:FindFirstChildOfClass("Backpack"), player.Character} do
			for _, tool in container:GetChildren() do
				if tool:IsA("Tool") and tool:GetAttribute("EventTool") then
					tool:Destroy()
				end
			end
		end
	end
end

local function giveEventTool(player, template, onActivated)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local Backpack = player:FindFirstChildOfClass("Backpack")
	if not humanoid or humanoid.Health <= 0 or not Backpack then
		return
	end

	local Tool = template:Clone()
	Tool:SetAttribute("EventTool", true) -- so cleanup only removes tools that events handed out
	Tool.CanBeDropped = false
	Tool.Parent = Backpack
	humanoid:EquipTool(Tool)

	Tool.Activated:Connect(function()
		onActivated(player, Tool)
	end)
end

local function createHealthBar(Adornee, offset)
	local HealthBar = Instance.new("BillboardGui")
	HealthBar.Name = "HealthBar"
	HealthBar.Size = UDim2.fromScale(12, 1.2)
	HealthBar.StudsOffsetWorldSpace = offset
	HealthBar.AlwaysOnTop, HealthBar.LightInfluence = true, 0
	HealthBar.Adornee = Adornee

	local Background = Instance.new("Frame")
	Background.Size = UDim2.fromScale(1, 1)
	Background.BackgroundColor3, Background.BorderSizePixel = Color3.fromRGB(30, 30, 30), 0
	Background.Parent = HealthBar

	local Fill = Instance.new("Frame")
	Fill.Name = "Fill"
	Fill.Size = UDim2.fromScale(1, 1)
	Fill.BackgroundColor3, Fill.BorderSizePixel = SLIME_HEALTH_COLOR, 0
	Fill.Parent = Background

	for _, frame in {Background, Fill} do
		local UICorner = Instance.new("UICorner")
		UICorner.CornerRadius = UDim.new(0.5, 0)
		UICorner.Parent = frame
	end

	HealthBar.Parent = Adornee

	return HealthBar, Fill
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
	if not info then return "an event" end
	return info.name or (string.gsub(info.method, "(%l)(%u)", "%1 %2")) -- GiantBoulder -> Giant Boulder
end

function EventsModule:GetTip(eventType) -- what the player should do, shown under complex events in the action log
	local info = EVENTS[eventType]
	return info and info.tip or nil
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
	shakeScreen(0, 0)

	shrinkId += 1
	if podiumTween then
		podiumTween:Cancel()
	end

	lavaId += 1
	if lavaTween then
		lavaTween:Cancel()
	end

	floodId += 1
	tornadoId += 1
	slimeId += 1
	removeEventTools()

	if Podium then
		Podium.Size, Podium.Color, Podium.Material = PODIUM_SIZE, PODIUM_COLOR, PODIUM_MATERIAL
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
		local remaining, stopped = BOULDER_COUNT, false

		for _ = 1, BOULDER_COUNT do
			task.spawn(function()
				if not rollBoulder() then
					stopped = true
				end
				remaining -= 1
			end)
		end

		repeat
			task.wait()
		until remaining == 0

		if stopped then
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
	if not Podium then
		warn("[EventsModule] FloorIsLava needs workspace.Podium")
		return
	end

	lavaId += 1
	local thisId = lavaId

	local surface = getSurface()
	local margin = LAVA_PLATFORM_SIZE / 2 + LAVA_EDGE_PADDING
	local platforms = {}

	local tweenInfo1 = TweenInfo.new(LAVA_RISE_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	for _, position in getPlatformPositions(LAVA_PLATFORM_COUNT, margin) do
		local Platform = createLavaPlatform(position, surface)
		table.insert(platforms, Platform)

		TweenService:Create(Platform, tweenInfo1, {CFrame = Platform.CFrame + surface.up * LAVA_PLATFORM_HEIGHT}):Play()
	end

	shakeScreen(LAVA_SHAKE, LAVA_RISE_TIME)

	local flashCount = math.max(1, math.floor(LAVA_WARNING_TIME / 0.5))
	local tweenInfo2 = TweenInfo.new(0.25, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, flashCount - 1, true)
	lavaTween = TweenService:Create(Podium, tweenInfo2, {Color = LAVA_COLOR})
	lavaTween:Play()

	task.wait(LAVA_WARNING_TIME)
	if lavaId ~= thisId then
		return
	end

	lavaTween:Cancel() -- the flash ends by fading back to the old color, which would undo the lava color
	Podium.Color, Podium.Material = LAVA_COLOR, LAVA_MATERIAL

	local endTime = os.clock() + params.duration
	task.spawn(burnPlayers, thisId, endTime)

	local sinkInterval = params.duration / #platforms
	for index = 1, #platforms - 1 do -- the last platform stays up so there's always somewhere safe
		task.wait(sinkInterval)
		if lavaId ~= thisId then
			return
		end

		task.spawn(sinkPlatform, platforms[index], surface.up, true)
	end

	task.wait(math.max(0, endTime - os.clock()))
	if lavaId ~= thisId then -- a newer FloorIsLava or Reset owns the podium now
		return
	end

	Podium.Color, Podium.Material = PODIUM_COLOR, PODIUM_MATERIAL

	for _, Platform in platforms do
		task.spawn(sinkPlatform, Platform, surface.up, false)
	end
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
	shakeScreen(SHRINK_SHAKE, SHRINK_TIME)

	task.wait(SHRINK_TIME + params.duration)
	if shrinkId ~= thisId then -- a newer ShrinkingPodium or Reset owns the podium now
		return
	end

	local tweenInfo3 = TweenInfo.new(SHRINK_GROW_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	playPodiumTween(tweenInfo3, {Size = PODIUM_SIZE})
	shakeScreen(SHRINK_SHAKE, SHRINK_GROW_TIME)
end

function EventsModule:Tornado(params)
	local template = Assets and Assets:FindFirstChild("Tornado")
	if not template or not Podium then
		warn("[EventsModule] Tornado needs ServerStorage.Assets.Tornado and workspace.Podium")
		return
	end

	tornadoId += 1
	local thisId = tornadoId

	local surface = getSurface()
	local up = surface.up

	local Tornado = template:Clone()
	prepareModel(Tornado)

	local templatePivot = template:GetPivot()
	local boxCFrame, boxSize = template:GetBoundingBox()
	local bottomOffset = templatePivot.Position.Y - (boxCFrame.Position.Y - boxSize.Y / 2) -- so the funnel's tip touches the podium
	local position, spin = surface.center, 0

	local function place(height)
		Tornado:PivotTo(CFrame.new(position + up * (bottomOffset + height)) * CFrame.fromAxisAngle(up, spin) * templatePivot.Rotation)
	end

	local Indicator = createCircleIndicator(surface.center, surface, TORNADO_HIT_RADIUS, "TornadoIndicator")

	place(TORNADO_DROP_HEIGHT)
	Tornado.Parent = EventObjects

	local dropStart = os.clock()
	repeat
		local deltaTime = RunService.Heartbeat:Wait()
		if tornadoId ~= thisId or not Tornado.Parent then
			return
		end

		local alpha = math.min(1, (os.clock() - dropStart) / TORNADO_DROP_TIME)
		spin += TORNADO_SPIN_SPEED * deltaTime
		place(TORNADO_DROP_HEIGHT * (1 - TweenService:GetValue(alpha, Enum.EasingStyle.Quad, Enum.EasingDirection.In)))
	until alpha >= 1

	Indicator:Destroy()
	for _, sound in Tornado:GetDescendants() do
		if sound:IsA("Sound") then
			sound:Play()
		end
	end

	local lastHit = {}
	local endTime = os.clock() + params.duration
	shakeScreen(TORNADO_SHAKE, params.duration)

	while os.clock() < endTime do
		local deltaTime = RunService.Heartbeat:Wait()
		if tornadoId ~= thisId or not Tornado.Parent then
			return
		end

		surface = getSurface()
		local rootPart = findClosestRoot(position, up)

		if rootPart then
			local target = clampToPodium(rootPart.Position, surface, TORNADO_EDGE_PADDING)
			local offset = getFlatOffset(position, target, up)
			local step = math.min(offset.Magnitude, TORNADO_SPEED * deltaTime)

			if step > 0.01 then
				position += offset.Unit * step
			end
		end

		position = clampToPodium(position, surface, TORNADO_EDGE_PADDING)
		spin += TORNADO_SPIN_SPEED * deltaTime
		place(0)

		hitTornadoTargets(position, surface, lastHit)
	end

	local riseStart = os.clock()
	repeat
		local deltaTime = RunService.Heartbeat:Wait()
		if tornadoId ~= thisId or not Tornado.Parent then
			return
		end

		local alpha = math.min(1, (os.clock() - riseStart) / TORNADO_DROP_TIME)
		spin += TORNADO_SPIN_SPEED * deltaTime
		place(TORNADO_DROP_HEIGHT * TweenService:GetValue(alpha, Enum.EasingStyle.Quad, Enum.EasingDirection.In))
	until alpha >= 1

	Tornado:Destroy()
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
	shakeScreen(TSUNAMI_SHAKE, duration)

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
	if not Podium then
		warn("[EventsModule] FloodEscape needs workspace.Podium")
		return
	end

	floodId += 1
	local thisId = floodId

	local surface = getSurface()
	local steps = createFloodSteps(surface)
	local Water, footprint = createFloodWater(surface)

	local Indicator = createAreaIndicator()
	Indicator.Name = "FloodIndicator"

	local flashCount = math.max(1, math.floor(FLOOD_WARNING_TIME / 0.5))
	local tweenInfo1 = TweenInfo.new(0.25, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, flashCount - 1, true)
	TweenService:Create(Indicator, tweenInfo1, {Transparency = 1}):Play()

	local level = Instance.new("NumberValue")
	level.Value = FLOOD_HIDDEN_LEVEL
	level.Parent = Water

	setWaterLevel(Water, surface, footprint, level.Value)
	level.Changed:Connect(function(value)
		setWaterLevel(Water, surface, footprint, value)
	end)

	task.wait(FLOOD_WARNING_TIME)
	Indicator:Destroy()
	if floodId ~= thisId or not Water.Parent then
		return
	end

	task.spawn(drownPlayers, thisId, surface, level)

	local peak = FLOOD_STEP_COUNT * FLOOD_STEP_HEIGHT + FLOOD_PEAK_OFFSET -- only the top step keeps your head above water
	local riseTime = peak / FLOOD_RISE_SPEED

	local tweenInfo2 = TweenInfo.new(riseTime, Enum.EasingStyle.Linear)
	TweenService:Create(level, tweenInfo2, {Value = peak}):Play()

	task.wait(riseTime + FLOOD_HOLD_TIME)
	if floodId ~= thisId or not Water.Parent then
		return
	end

	local tweenInfo3 = TweenInfo.new(FLOOD_DRAIN_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	TweenService:Create(level, tweenInfo3, {Value = FLOOD_HIDDEN_LEVEL}):Play()

	for index, Step in steps do
		if Step.Parent then
			TweenService:Create(Step, tweenInfo3, {CFrame = Step.CFrame - surface.up * (index * FLOOD_STEP_HEIGHT)}):Play()
		end
	end

	task.wait(FLOOD_DRAIN_TIME)
	if floodId ~= thisId then
		return
	end

	Water:Destroy()
	for _, Step in steps do
		Step:Destroy()
	end
end

function EventsModule:ObbyChase(params)
	notBuilt("ObbyChase")
end

function EventsModule:BlobFight(params)
	local template, swordTemplate = Assets and Assets:FindFirstChild("Slime"), Assets and Assets:FindFirstChild("Sword")
	if not template or not swordTemplate or not Podium then
		warn("[EventsModule] BlobFight needs ServerStorage.Assets.Slime, ServerStorage.Assets.Sword and workspace.Podium")
		return
	end

	slimeId += 1
	local thisId = slimeId

	local surface = getSurface()
	local up = surface.up

	local Slime = template:Clone()
	prepareModel(Slime)

	local templatePivot = template:GetPivot()
	local boxCFrame, boxSize = template:GetBoundingBox()
	local bottomOffset = templatePivot.Position.Y - (boxCFrame.Position.Y - boxSize.Y / 2)
	local bodyRadius = math.max(boxSize.X, boxSize.Z) / 2
	local hitRadius, hitHeight = bodyRadius * SLIME_HIT_SCALE, boxSize.Y

	local Highlight = Instance.new("Highlight")
	Highlight.FillColor, Highlight.OutlineColor = INDICATOR_COLOR, INDICATOR_COLOR
	Highlight.FillTransparency, Highlight.OutlineTransparency = 1, 1
	Highlight.DepthMode = Enum.HighlightDepthMode.Occluded
	Highlight.Parent = Slime

	local templateBody = template:FindFirstChildWhichIsA("BasePart", true)
	local barOffset = Vector3.new(0, boxCFrame.Position.Y + boxSize.Y / 2 - templateBody.Position.Y + 3, 0)
	local _, HealthFill = createHealthBar(Slime:FindFirstChildWhichIsA("BasePart", true), barOffset)

	local position, yaw, height = surface.center, 0, 0
	local health = SLIME_MAX_HEALTH
	local lastSwing = {}

	local function place(newHeight)
		height = newHeight
		Slime:PivotTo(CFrame.new(position + up * (bottomOffset + height)) * CFrame.fromAxisAngle(up, yaw) * templatePivot.Rotation)
	end

	local function isCurrent()
		return slimeId == thisId and Slime.Parent ~= nil
	end

	local function moveTo(target, startHeight, endHeight, duration, arcHeight, easingStyle, easingDirection)
		local start, startTime = position, os.clock()

		repeat
			RunService.Heartbeat:Wait()
			if not isCurrent() then
				return false
			end

			local alpha = math.min(1, (os.clock() - startTime) / duration)
			local eased = TweenService:GetValue(alpha, easingStyle or Enum.EasingStyle.Linear, easingDirection or Enum.EasingDirection.InOut)

			position = start:Lerp(target, alpha)
			place(startHeight + (endHeight - startHeight) * eased + arcHeight * 4 * alpha * (1 - alpha))
		until alpha >= 1

		return true
	end

	local function slam()
		shakeScreen(SLAM_SHAKE, SLAM_SHAKE_TIME)

		for _, player in Players:GetPlayers() do
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			local rootPart = humanoid and humanoid.Health > 0 and humanoid.RootPart

			if rootPart then
				local flat, rootHeight = getFlatOffset(position, rootPart.Position, up)

				if flat.Magnitude <= hitRadius and rootHeight < hitHeight then
					humanoid:TakeDamage(SLIME_DAMAGE)

					local away = flat.Magnitude > 0.1 and flat.Unit or surface.axisA
					launchCharacter(rootPart, away * SLIME_KNOCKBACK_SPEED + up * SLIME_LIFT_SPEED)
				end
			end
		end
	end

	local function swing(player, Sword)
		if health <= 0 or os.clock() - (lastSwing[player] or 0) < SWORD_COOLDOWN then
			return
		end
		lastSwing[player] = os.clock()

		local animation = Instance.new("StringValue") -- the default Animate script plays a slash when it sees this
		animation.Name, animation.Value = "toolanim", "Slash"
		animation.Parent = Sword

		local Handle = Sword:FindFirstChild("Handle")
		local SwordLunge = Handle and Handle:FindFirstChild("SwordLunge")
		if SwordLunge then
			SwordLunge:Play()
		end

		local character = player.Character
		local rootPart = character and character:FindFirstChild("HumanoidRootPart")
		if not rootPart or height > SWORD_MAX_HEIGHT or getFlatOffset(position, rootPart.Position, up).Magnitude > bodyRadius + SWORD_REACH then
			return
		end

		health = math.max(0, health - SWORD_DAMAGE)
		TweenService:Create(HealthFill, TweenInfo.new(0.2, Enum.EasingStyle.Sine, Enum.EasingDirection.Out), {Size = UDim2.fromScale(health / SLIME_MAX_HEALTH, 1)}):Play()

		Highlight.FillColor, Highlight.FillTransparency = Color3.new(1, 1, 1), 0.3
		TweenService:Create(Highlight, TweenInfo.new(0.2, Enum.EasingStyle.Sine, Enum.EasingDirection.Out), {FillTransparency = 1}):Play()
		task.delay(0.2, function()
			Highlight.FillColor = INDICATOR_COLOR
		end)
	end

	local Indicator = createCircleIndicator(position, surface, hitRadius, "SlimeIndicator")
	place(SLIME_DROP_HEIGHT)
	Slime.Parent = EventObjects

	for _, player in Players:GetPlayers() do
		giveEventTool(player, swordTemplate, swing)
	end

	if not moveTo(position, SLIME_DROP_HEIGHT, 0, SLIME_DROP_TIME, 0, Enum.EasingStyle.Quad, Enum.EasingDirection.In) then
		return
	end
	Indicator:Destroy()
	slam()

	while health > 0 do
		task.wait(SLIME_REST_TIME)
		if not isCurrent() then
			return
		end
		if health <= 0 then
			break
		end

		local tweenInfo = TweenInfo.new(SLIME_CHARGE_TIME / 2, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, 0, true) -- one slow pulse
		TweenService:Create(Highlight, tweenInfo, {FillTransparency = 0.4}):Play()

		local chargeEnd = os.clock() + SLIME_CHARGE_TIME
		repeat
			local deltaTime = RunService.Heartbeat:Wait()
			if not isCurrent() then
				return
			end

			local rootPart = findClosestRoot(position, up)
			local direction = rootPart and getFlatOffset(position, rootPart.Position, up)

			if direction and direction.Magnitude > 0.1 then
				local goal = math.atan2(-direction.X, -direction.Z) + math.rad(SLIME_FACING_OFFSET)
				local difference = (goal - yaw + math.pi) % (2 * math.pi) - math.pi -- turn the short way around
				yaw += math.clamp(difference, -SLIME_TURN_SPEED * deltaTime, SLIME_TURN_SPEED * deltaTime)
			end

			place(-SLIME_CROUCH_DEPTH) -- squat down before the jump
		until os.clock() >= chargeEnd or health <= 0
		Highlight.FillTransparency = 1

		if health <= 0 then
			break
		end

		surface = getSurface()
		local rootPart = findClosestRoot(position, up)
		local target = clampToPodium(rootPart and rootPart.Position or surface.center, surface, SLIME_EDGE_PADDING)

		local direction = getFlatOffset(position, target, up)
		if direction.Magnitude > 0.1 then
			yaw = math.atan2(-direction.X, -direction.Z) + math.rad(SLIME_FACING_OFFSET) -- face where it's jumping
		end

		local Landing = createCircleIndicator(target, surface, hitRadius, "SlimeIndicator")
		if not moveTo(target, -SLIME_CROUCH_DEPTH, 0, SLIME_JUMP_TIME, SLIME_JUMP_HEIGHT) then
			return
		end
		Landing:Destroy()
		slam()
	end

	if not isCurrent() then
		return
	end

	place(0)
	local tweenInfo = TweenInfo.new(SLIME_FADE_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)
	for _, part in Slime:GetDescendants() do
		if part:IsA("BasePart") then
			TweenService:Create(part, tweenInfo, {Transparency = 1}):Play()
		end
	end

	task.wait(SLIME_FADE_TIME)
	if slimeId == thisId then
		Slime:Destroy()
		removeEventTools()
	end
end

for _, info in EVENTS do -- direct calls like EventsModule:Bombs() get the same defaults and clamping as Run
	local method = EventsModule[info.method]
	EventsModule[info.method] = function(self, params)
		return method(self, cleanParams(info, params))
	end
end

return EventsModule
