local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local HostSession = ReplicatedStorage:WaitForChild("HostSession")

local MainMenu = script.Parent
local Play, Logo = MainMenu.Play, MainMenu.Logo
local PlayerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local SWAY_ANGLE, SWAY_TIME, PULSE_SCALE, PULSE_TIME = 5, 2, 1.06, 1.4
local TRANSITION_COLOR, TRANSITION_TIME, LOADING_TIMEOUT = Color3.fromRGB(225, 158, 29), 0.6, 10
local GRID_SIZE, GRID_THICKNESS, GRID_COLOR, GRID_TRANSPARENCY = 40, 2, Color3.fromRGB(195, 93, 42), 0.78
local GRID_SPEED = GRID_SIZE / 3 -- one cell every 3 seconds, matching the website
local GRID_MARGIN = 3 -- extra cells on every side so an edge never drifts into view
local logoGoal1, logoGoal2 = {Rotation = SWAY_ANGLE}, {Scale = PULSE_SCALE}
local isStarting = false
local Cover, Grid, gridConnection = nil, nil, nil

local Transition = Instance.new("ScreenGui")
Transition.Name = "Transition"
Transition.IgnoreGuiInset, Transition.ResetOnSpawn = true, false
Transition.DisplayOrder = MainMenu.DisplayOrder - 1 -- behind the menu, so the logo (and the lobby UI) stay on top of the cover
Transition.DisplayOrder = 1
Transition.Parent = PlayerGui

local function animateLogo()
	local tweenInfo1 = TweenInfo.new(SWAY_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
	local tweenInfo2 = TweenInfo.new(PULSE_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)

	local UIScale = Instance.new("UIScale")
	UIScale.Parent = Logo
	Logo.Rotation = -SWAY_ANGLE -- start on one side so it sways evenly both ways

	local logoTween1 = TweenService:Create(Logo, tweenInfo1, logoGoal1)
	local logoTween2 = TweenService:Create(UIScale, tweenInfo2, logoGoal2)

	logoTween1:Play()
	logoTween2:Play()
end

local function getClickPosition(inputObject)
	if inputObject and inputObject.Position.Magnitude > 0 then
		return Vector2.new(inputObject.Position.X, inputObject.Position.Y) + GuiService:GetGuiInset() -- input positions start below the top bar
	end

	local inset = MainMenu.IgnoreGuiInset and Vector2.zero or GuiService:GetGuiInset()
	return Play.AbsolutePosition + Play.AbsoluteSize / 2 + inset
end

local function createLine(position, size)
	local Line = Instance.new("Frame")
	Line.Position, Line.Size = position, size
	Line.BackgroundColor3, Line.BackgroundTransparency, Line.BorderSizePixel = GRID_COLOR, GRID_TRANSPARENCY, 0
	Line.Parent = Grid
end

local function buildGridLines()
	Grid:ClearAllChildren()

	local screenSize = Transition.AbsoluteSize
	local columns = math.ceil(screenSize.X / GRID_SIZE) + GRID_MARGIN * 2
	local rows = math.ceil(screenSize.Y / GRID_SIZE) + GRID_MARGIN * 2
	Grid.Size = UDim2.fromOffset(columns * GRID_SIZE, rows * GRID_SIZE)

	for column = 0, columns do
		createLine(UDim2.fromOffset(column * GRID_SIZE, 0), UDim2.new(0, GRID_THICKNESS, 1, 0))
	end
	for row = 0, rows do
		createLine(UDim2.fromOffset(0, row * GRID_SIZE), UDim2.new(1, 0, 0, GRID_THICKNESS))
	end
end

local function startGrid()
	Grid = Instance.new("Frame")
	Grid.Name = "Grid"
	Grid.BackgroundTransparency, Grid.ZIndex = 1, 2
	buildGridLines()
	Grid.Parent = Transition

	local startTime = os.clock()
	gridConnection = RunService.RenderStepped:Connect(function()
		local offset = ((os.clock() - startTime) * GRID_SPEED) % GRID_SIZE - GRID_SIZE * GRID_MARGIN
		Grid.Position = UDim2.fromOffset(offset, offset)
	end)
end

local function stopGrid()
	if gridConnection then
		gridConnection:Disconnect()
		gridConnection = nil
	end
	if Grid then
		Grid:Destroy()
		Grid = nil
	end
end

local function coverScreen(position)
	local screenSize = Transition.AbsoluteSize
	local reach = 0
	for _, corner in {Vector2.zero, Vector2.new(screenSize.X, 0), Vector2.new(0, screenSize.Y), screenSize} do
		reach = math.max(reach, (corner - position).Magnitude)
	end

	Cover = Instance.new("Frame")
	Cover.Name = "Cover"
	Cover.AnchorPoint = Vector2.new(0.5, 0.5)
	Cover.Position, Cover.Size = UDim2.fromOffset(position.X, position.Y), UDim2.fromOffset(0, 0)
	Cover.BackgroundColor3, Cover.BorderSizePixel = TRANSITION_COLOR, 0

	local UICorner = Instance.new("UICorner")
	UICorner.CornerRadius = UDim.new(0.5, 0)
	UICorner.Parent = Cover
	Cover.Parent = Transition

	local tweenInfo = TweenInfo.new(TRANSITION_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In)

	local coverTween = TweenService:Create(Cover, tweenInfo, {Size = UDim2.fromOffset(reach * 2, reach * 2)}) -- big enough to reach the farthest corner
	coverTween:Play()

	coverTween.Completed:Connect(function(playbackState)
		if playbackState == Enum.PlaybackState.Completed and Cover and not Grid then
			startGrid()
		end
	end)
end

local function removeCover()
	stopGrid()
	if Cover then
		Cover:Destroy()
		Cover = nil
	end
end

local function updateMenu()
	local roundState = ReplicatedStorage:GetAttribute("RoundState")
	local inMenu, inLobby = roundState == nil or roundState == "menu", roundState == "lobby"

	MainMenu.Enabled = inMenu or inLobby -- the logo stays up over the cover through the lobby

	if inMenu then
		Play.Visible = not isStarting
		if not isStarting then
			removeCover()
		end
	elseif inLobby then
		Play.Visible = false
	else
		isStarting = false
		removeCover()
	end
end

Play.Activated:Connect(function(inputObject)
	if isStarting then
		return
	end
	isStarting = true

	Play.Visible = false
	coverScreen(getClickPosition(inputObject))
	HostSession:FireServer()

	task.delay(LOADING_TIMEOUT, function()
		local roundState = ReplicatedStorage:GetAttribute("RoundState")
		if isStarting and (roundState == nil or roundState == "menu") then -- the session never started, so give the menu back
			isStarting = false
			updateMenu()
		end
	end)
end)

Transition:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
	if Grid then -- the window or phone was resized, so make sure the grid still covers it
		buildGridLines()
	end
end)

ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateMenu)
updateMenu()
animateLogo()
