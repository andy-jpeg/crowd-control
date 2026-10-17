local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local HostSession = ReplicatedStorage:WaitForChild("HostSession")

local MainMenu = script.Parent
local Play, Logo = MainMenu.Options.Play, MainMenu.Logo

local SWAY_ANGLE, SWAY_TIME, PULSE_SCALE, PULSE_TIME = 5, 2, 1.06, 1.4
local logoGoal1, logoGoal2 = {Rotation = SWAY_ANGLE}, {Scale = PULSE_SCALE}
local playText = Play.Text
local isStarting = false

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
	end
end

Play.Activated:Connect(function()
	if isStarting then
		return
	end
	isStarting = true

	Play.Text = "Starting..."
	HostSession:FireServer()
end)

ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateMenu)
updateMenu()
animateLogo()
