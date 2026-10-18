local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local HostSession = ReplicatedStorage:WaitForChild("HostSession")

local MainMenu = script.Parent
local Options = MainMenu:WaitForChild("Options")
local Play = Options:WaitForChild("Play")
local Logo = MainMenu:FindFirstChild("Logo")

local SWAY_ANGLE, SWAY_TIME, PULSE_SCALE, PULSE_TIME = 5, 2, 1.06, 1.4
local logoGoal1, logoGoal2 = {Rotation = SWAY_ANGLE}, {Scale = PULSE_SCALE}
local playText = Play.Text
local isStarting = false
local chosenRounds = 5
local MIN_ROUNDS, MAX_ROUNDS = 5, 10

-- Check for existing round selector or create a button in Options
local RoundsButton = Options:FindFirstChild("Rounds") or Options:FindFirstChild("RoundCount")
if not RoundsButton and Play:IsA("GuiObject") then
	local created = Instance.new("TextButton")
	created.Name = "Rounds"
	created.Size = UDim2.new(Play.Size.X.Scale, Play.Size.X.Offset, 0, 36)
	created.Position = UDim2.new(Play.Position.X.Scale, Play.Position.X.Offset, Play.Position.Y.Scale, Play.Position.Y.Offset - 42)
	created.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
	created.TextColor3 = Color3.fromRGB(248, 250, 252)
	created.Font = Enum.Font.GothamBold
	created.TextSize = 14
	created.AutoButtonColor = true
	created.Text = "Rounds: 5 (5-10)"

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = created

	created.Parent = Options
	RoundsButton = created
end

local function updateRoundsDisplay()
	if RoundsButton and (RoundsButton:IsA("TextButton") or RoundsButton:IsA("TextLabel")) then
		RoundsButton.Text = "Rounds: " .. chosenRounds .. " (5-10)"
	end
end

if RoundsButton and RoundsButton:IsA("GuiButton") then
	RoundsButton.Activated:Connect(function()
		if isStarting then
			return
		end
		chosenRounds = if chosenRounds >= MAX_ROUNDS then MIN_ROUNDS else (chosenRounds + 1)
		updateRoundsDisplay()
	end)
end

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

local function updateMenu()
	local roundState = ReplicatedStorage:GetAttribute("RoundState")
	MainMenu.Enabled = roundState == nil or roundState == "menu"

	if MainMenu.Enabled then
		isStarting = false
		Play.Text = playText
		updateRoundsDisplay()
	end
end

Play.Activated:Connect(function()
	if isStarting then
		return
	end
	isStarting = true

	Play.Text = "Starting (" .. chosenRounds .. " rounds)..."
	HostSession:FireServer(chosenRounds)
end)

ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateMenu)
updateMenu()
updateRoundsDisplay()
if Logo then
	animateLogo()
end
