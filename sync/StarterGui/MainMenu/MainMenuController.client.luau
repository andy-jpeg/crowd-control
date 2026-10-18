local GuiService = game:GetService("GuiService")
local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local HostSession = ReplicatedStorage:WaitForChild("HostSession")

local player = Players.LocalPlayer
local MainMenu = script.Parent
local Play, Logo = MainMenu.Play, MainMenu.Logo
local PlayerGui = player:WaitForChild("PlayerGui")

local SWAY_ANGLE, SWAY_TIME, PULSE_SCALE, PULSE_TIME = 5, 2, 1.06, 1.4
local TRANSITION_COLOR, TRANSITION_TIME, LOADING_TIMEOUT = Color3.fromRGB(225, 158, 29), 0.6, 10
local GRID_SIZE, GRID_THICKNESS, GRID_COLOR, GRID_TRANSPARENCY = 40, 2, Color3.fromRGB(195, 93, 42), 0.78
local GRID_SPEED = GRID_SIZE / 3 -- one cell every 3 seconds, matching the website
local GRID_MARGIN = 3 -- extra cells on every side so an edge never drifts into view
local GRID_FADE_TIME = 0.2
local LOGO_EXIT_TIME, EXIT_MARGIN = 0.45, 20 -- matches the lobby's exit
local HOVER_SCALE, HOVER_TIME = 1.1, 0.15
local WOOSH_ID, WOOSH_VOLUME = "rbxassetid://100912899778737", 1.5 -- Sonic Mania Menu Woosh, it's quiet so it's above the usual 0.5
local BLUR_SIZE, BLUR_TIME = 10, 0.6 -- the game world behind the menu, the UI itself stays sharp
local logoGoal1, logoGoal2 = {Rotation = SWAY_ANGLE}, {Scale = PULSE_SCALE}
local uncoverGoal, fadeGoal = {Size = UDim2.fromOffset(0, 0)}, {BackgroundTransparency = 1}
local hoverGoal1, hoverGoal2 = {Scale = HOVER_SCALE}, {Scale = 1}
local blurGoal1, blurGoal2 = {Size = BLUR_SIZE}, {Size = 0}
local logoHome = Logo.Position
local isStarting, isEnding = false, false
local lastState = nil
local Cover, Grid, gridConnection = nil, nil, nil
local isBlurred = nil

local Transition = Instance.new("ScreenGui")
Transition.Name = "Transition"
Transition.IgnoreGuiInset, Transition.ResetOnSpawn = true, false
Transition.DisplayOrder = MainMenu.DisplayOrder - 1 -- behind the menu, so the logo (and the lobby UI) stay on top of the cover
Transition.DisplayOrder = 1
Transition.Parent = PlayerGui

local PlayScale = Instance.new("UIScale")
PlayScale.Parent = Play

local Woosh = Instance.new("Sound")
Woosh.Name, Woosh.SoundId, Woosh.Volume = "PlayWoosh", WOOSH_ID, WOOSH_VOLUME
Woosh.Parent = SoundService

local MenuBlur = Instance.new("BlurEffect")
MenuBlur.Name, MenuBlur.Size = "MenuBlur", 0
MenuBlur.Parent = Lighting -- made on the client, so only this player's view blurs

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

local function setPlayHovered(isHovered)
	local tweenInfo = TweenInfo.new(HOVER_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

	local hoverTween = TweenService:Create(PlayScale, tweenInfo, isHovered and hoverGoal1 or hoverGoal2)

	hoverTween:Play()
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

	local MovingGrid = Grid
	local startTime = os.clock()
	gridConnection = RunService.RenderStepped:Connect(function()
		local offset = ((os.clock() - startTime) * GRID_SPEED) % GRID_SIZE - GRID_SIZE * GRID_MARGIN
		MovingGrid.Position = UDim2.fromOffset(offset, offset)
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

local function fadeGrid()
	if not Grid then return end
	local FadingGrid, fadingConnection = Grid, gridConnection
	Grid, gridConnection = nil, nil -- keeps drifting while it fades

	local tweenInfo = TweenInfo.new(GRID_FADE_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	for _, Line in FadingGrid:GetChildren() do
		TweenService:Create(Line, tweenInfo, fadeGoal):Play()
	end

	task.delay(GRID_FADE_TIME, function()
		fadingConnection:Disconnect()
		FadingGrid:Destroy()
	end)
end

local function getReach(position)
	local screenSize = Transition.AbsoluteSize
	local reach = 0
	for _, corner in {Vector2.zero, Vector2.new(screenSize.X, 0), Vector2.new(0, screenSize.Y), screenSize} do
		reach = math.max(reach, (corner - position).Magnitude)
	end
	return reach
end

local function coverScreen(position, onCovered)
	local reach = getReach(position)

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
		if playbackState ~= Enum.PlaybackState.Completed or not Cover then return end
		if onCovered then
			onCovered()
		elseif not Grid then
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

local function uncoverScreen(position) -- the start transition in reverse
	if not Cover then return end
	fadeGrid()

	local reach = getReach(position)
	local ClosingCover = Cover
	Cover = nil
	ClosingCover.Position, ClosingCover.Size = UDim2.fromOffset(position.X, position.Y), UDim2.fromOffset(reach * 2, reach * 2)

	local tweenInfo = TweenInfo.new(TRANSITION_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.In)

	local uncoverTween = TweenService:Create(ClosingCover, tweenInfo, uncoverGoal)

	uncoverTween:Play()
	uncoverTween.Completed:Connect(function()
		ClosingCover:Destroy()
	end)
end

local function getScreenCenter()
	return Transition.AbsoluteSize / 2
end

local function sendLogoAway()
	local top = Logo.AbsolutePosition.Y - MainMenu.AbsolutePosition.Y + Logo.AbsoluteSize.Y + EXIT_MARGIN

	local tweenInfo = TweenInfo.new(LOGO_EXIT_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.In)

	local exitTween = TweenService:Create(Logo, tweenInfo, {Position = logoHome - UDim2.fromOffset(0, top)})

	exitTween:Play()
end

local function setBlurred(shouldBlur)
	if isBlurred == shouldBlur then return end
	isBlurred = shouldBlur

	local tweenInfo = TweenInfo.new(BLUR_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	local blurTween = TweenService:Create(MenuBlur, tweenInfo, shouldBlur and blurGoal1 or blurGoal2)

	blurTween:Play()
end

local function updateMenu()
	local roundState = ReplicatedStorage:GetAttribute("RoundState")
	local inMenu, inLobby = roundState == nil or roundState == "menu", roundState == "lobby"
	setBlurred(inMenu) -- clears once the lobby starts, comes back when the session ends
	local wasPlaying = lastState ~= nil and lastState ~= "menu" and lastState ~= "lobby"
	lastState = roundState

	if inMenu and wasPlaying then -- the session ended: swap in the menu under the cover, then reveal it
		local function revealMenu()
			isEnding = false
			Logo.Position = logoHome
			MainMenu.Enabled, Play.Visible = true, true
			uncoverScreen(getScreenCenter())
		end

		if Cover then
			revealMenu() -- the ending screen already put the cover up
		else
			isEnding = true
			coverScreen(getScreenCenter(), revealMenu)
		end
		return
	elseif isEnding then
		return
	end

	MainMenu.Enabled = inMenu or inLobby -- the logo stays up over the cover through the lobby

	if inMenu then
		Play.Visible = not isStarting
		if not isStarting then
			removeCover()
		end
	elseif inLobby then
		Play.Visible = false
	elseif roundState == "sessionOver" then
		isStarting = false
		if not Cover then
			coverScreen(getScreenCenter()) -- the ending screen sits on the cover, like the lobby
		end
	else
		isStarting = false
		uncoverScreen(player:GetAttribute("UncoverPosition") or getScreenCenter())
		player:SetAttribute("UncoverPosition", nil)
	end
end

Play.Activated:Connect(function(inputObject)
	if isStarting then
		return
	end
	isStarting = true

	Woosh:Play()
	Play.Visible = false
	PlayScale.Scale = 1 -- so it isn't still enlarged when the menu comes back
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

Play.MouseEnter:Connect(function()
	if not isStarting then
		setPlayHovered(true)
	end
end)

Play.MouseLeave:Connect(function()
	if not isStarting then
		setPlayHovered(false)
	end
end)

Transition:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
	if Grid then -- the window or phone was resized, so make sure the grid still covers it
		buildGridLines()
	end
end)

player:GetAttributeChangedSignal("LeavingLobby"):Connect(function()
	if player:GetAttribute("LeavingLobby") then
		sendLogoAway()
	else
		Logo.Position = logoHome -- the start failed, so the lobby came back
	end
end)

ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateMenu)
updateMenu()
animateLogo()
