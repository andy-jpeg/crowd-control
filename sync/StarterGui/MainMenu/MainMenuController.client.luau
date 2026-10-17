local ReplicatedStorage = game:GetService("ReplicatedStorage")

local HostSession = ReplicatedStorage:WaitForChild("HostSession")

local MainMenu = script.Parent
local Play = MainMenu.Options.Play

local playText = Play.Text
local isStarting = false

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
