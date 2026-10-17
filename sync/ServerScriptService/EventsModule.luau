local ServerStorage = game:GetService("ServerStorage")
local TweenService = game:GetService("TweenService")

local Assets, Podium = ServerStorage:FindFirstChild("Assets"), workspace:FindFirstChild("Podium")

local DEFAULT_GRAVITY = workspace.Gravity
local COOLDOWNS = {basic = 0, complex = 30}

local BOMB_DROP_HEIGHT, BOMB_DROP_INTERVAL, BOMB_EDGE_PADDING = 40, 0.35, 1.5
local BOMB_WARNING_TIME, BOMB_FAILSAFE_TIME = 1, 5
local BOMB_BLAST_RADIUS, BOMB_DAMAGE = 3, 35
local BOULDER_SIZE, BOULDER_SPEED, BOULDER_DAMAGE, BOULDER_WARNING_TIME = 16, 30, 40, 1.5
local BOULDER_EDGE_GAP = 3
local INDICATOR_COLOR, INDICATOR_TRANSPARENCY = Color3.fromRGB(255, 40, 40), 0.6

local EVENTS = {
	bombs = {method = "Bombs", tier = "basic", params = {count = {default = 5, min = 1, max = 8}}},
	inverted_controls = {method = "InvertedControls", tier = "basic", params = {duration = {default = 8, min = 3, max = 15}}},
	low_gravity = {method = "LowGravity", tier = "basic", params = {duration = {default = 10, min = 3, max = 20}}},
	ink_screen = {method = "InkScreen", tier = "basic", params = {duration = {default = 5, min = 2, max = 10}}},

	giant_boulder = {method = "GiantBoulder", tier = "complex", params = {duration = {default = 30, min = 15, max = 45}}},
	floor_is_lava = {method = "FloorIsLava", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	shrinking_podium = {method = "ShrinkingPodium", tier = "complex", params = {}},
	tornado = {method = "Tornado", tier = "complex", params = {duration = {default = 15, min = 5, max = 30}}},
	tsunami = {method = "Tsunami", tier = "complex", params = {}},
	flood_escape = {method = "FloodEscape", tier = "complex", params = {}},
	obby_chase = {method = "ObbyChase", tier = "complex", params = {}},
	blob_fight = {method = "BlobFight", tier = "complex", params = {}},
}

local EventsModule = {}

local random = Random.new()
local lowGravityId = 0
local readyAt = {basic = 0, complex = 0}
local pendingThreads = {}

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

local function damageInRadius(position, radius, damage, damaged)
	for _, part in workspace:GetPartBoundsInRadius(position, radius, overlapParams) do
		local humanoid = part.Parent and part.Parent:FindFirstChildOfClass("Humanoid")
		if humanoid and not damaged[humanoid] then
			damaged[humanoid] = true
			humanoid:TakeDamage(damage)
		end
	end
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

	bomb.Anchored, bomb.CanCollide, bomb.CanTouch = false, true, true
	bomb.CustomPhysicalProperties = PhysicalProperties.new(1, 1, 0, 100, 100) -- no bounce, high grip so it stays where it lands
	bomb.CFrame = CFrame.new(target + Vector3.new(0, BOMB_DROP_HEIGHT, 0))
	bomb.Parent = EventObjects
	bomb:SetNetworkOwner(nil)

	local exploded = false
	local function tryExplode()
		if exploded or not bomb.Parent then
			return
		end
		exploded = true
		explode(bomb, indicator)
	end

	bomb.Touched:Connect(tryExplode)
	task.delay(BOMB_FAILSAFE_TIME, tryExplode) -- in case it never hits anything
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
		task.spawn(self[info.method], self, params)
	end

	return true, delay
end

function EventsModule:GetCooldown(tier)
	return math.max(0, (readyAt[tier] or 0) - os.clock())
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

	lowGravityId += 1
	workspace.Gravity = DEFAULT_GRAVITY
end

function EventsModule:Bombs(params)
	local tool = Assets and Assets:FindFirstChild("ClassicTimebomb")
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
	notBuilt("InvertedControls")
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

function EventsModule:InkScreen(params)
	notBuilt("InkScreen")
end

function EventsModule:FloorIsLava(params)
	notBuilt("FloorIsLava")
end

function EventsModule:ShrinkingPodium(params)
	notBuilt("ShrinkingPodium")
end

function EventsModule:Tornado(params)
	notBuilt("Tornado")
end

function EventsModule:Tsunami(params)
	notBuilt("Tsunami")
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
