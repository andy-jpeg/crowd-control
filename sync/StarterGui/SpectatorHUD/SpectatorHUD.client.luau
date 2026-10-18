local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Create or reuse ScreenGui
local screenGui = playerGui:FindFirstChild("SpectatorHUD")
if not screenGui then
	screenGui = Instance.new("ScreenGui")
	screenGui.Name = "SpectatorHUD"
	screenGui.ResetOnSpawn = false
	screenGui.DisplayOrder = 10
	screenGui.Parent = playerGui
end

-- Main container (top-right corner of screen)
local container = Instance.new("Frame")
container.Name = "Container"
container.Size = UDim2.new(0, 200, 0, 220)
container.Position = UDim2.new(1, -215, 0, 15)
container.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
container.BackgroundTransparency = 0.25
container.BorderSizePixel = 0
container.ClipsDescendants = true
container.Parent = screenGui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 10)
corner.Parent = container

local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(51, 65, 85)
stroke.Thickness = 1
stroke.Parent = container

-- Header Title
local header = Instance.new("TextLabel")
header.Name = "Header"
header.Size = UDim2.new(1, 0, 0, 32)
header.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
header.BackgroundTransparency = 0.2
header.TextColor3 = Color3.fromRGB(241, 245, 249)
header.Font = Enum.Font.GothamBold
header.TextSize = 13
header.Text = "Spectators (0)"
header.Parent = container

local headerCorner = Instance.new("UICorner")
headerCorner.CornerRadius = UDim.new(0, 10)
headerCorner.Parent = header

-- Scrolling Frame for spectator items
local scrollList = Instance.new("ScrollingFrame")
scrollList.Name = "List"
scrollList.Size = UDim2.new(1, -12, 1, -40)
scrollList.Position = UDim2.new(0, 6, 0, 36)
scrollList.BackgroundTransparency = 1
scrollList.BorderSizePixel = 0
scrollList.ScrollBarThickness = 3
scrollList.ScrollBarImageColor3 = Color3.fromRGB(100, 116, 139)
scrollList.CanvasSize = UDim2.new(0, 0, 0, 0)
scrollList.AutomaticCanvasSize = Enum.AutomaticSize.Y
scrollList.Parent = container

local listLayout = Instance.new("UIListLayout")
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Padding = UDim.new(0, 4)
listLayout.Parent = scrollList

local emptyLabel = Instance.new("TextLabel")
emptyLabel.Name = "Empty"
emptyLabel.Size = UDim2.new(1, 0, 0, 40)
emptyLabel.BackgroundTransparency = 1
emptyLabel.TextColor3 = Color3.fromRGB(148, 163, 184)
emptyLabel.Font = Enum.Font.Gotham
emptyLabel.TextSize = 12
emptyLabel.Text = "No spectators yet"
emptyLabel.Parent = scrollList

local function renderSpectators()
	local raw = ReplicatedStorage:GetAttribute("SpectatorList")
	local spectators = {}
	if type(raw) == "string" and raw ~= "" then
		pcall(function()
			spectators = HttpService:JSONDecode(raw)
		end)
	end

	local count = #spectators
	header.Text = "Spectators (" .. count .. ")"

	-- Clear old rows
	for _, child in scrollList:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end

	if count == 0 then
		emptyLabel.Visible = true
		return
	end
	emptyLabel.Visible = false

	for index, spectator in ipairs(spectators) do
		local row = Instance.new("Frame")
		row.Name = "Row_" .. index
		row.Size = UDim2.new(1, 0, 0, 24)
		row.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
		row.BackgroundTransparency = 0.5
		row.BorderSizePixel = 0
		row.LayoutOrder = index

		local rowCorner = Instance.new("UICorner")
		rowCorner.CornerRadius = UDim.new(0, 6)
		rowCorner.Parent = row

		local nameLabel = Instance.new("TextLabel")
		nameLabel.Name = "Name"
		nameLabel.Size = UDim2.new(1, -75, 1, 0)
		nameLabel.Position = UDim2.new(0, 6, 0, 0)
		nameLabel.BackgroundTransparency = 1
		nameLabel.TextColor3 = Color3.fromRGB(248, 250, 252)
		nameLabel.Font = Enum.Font.GothamSemibold
		nameLabel.TextSize = 12
		nameLabel.TextXAlignment = Enum.TextXAlignment.Left
		nameLabel.TextTruncate = Enum.TextTruncate.AtEnd
		nameLabel.Text = "@" .. tostring(spectator.username or "spectator")
		nameLabel.Parent = row

		local tokensLabel = Instance.new("TextLabel")
		tokensLabel.Name = "Tokens"
		tokensLabel.Size = UDim2.new(0, 65, 1, 0)
		tokensLabel.Position = UDim2.new(1, -71, 0, 0)
		tokensLabel.BackgroundTransparency = 1
		tokensLabel.TextColor3 = Color3.fromRGB(251, 191, 36) -- gold/yellow
		tokensLabel.Font = Enum.Font.GothamBold
		tokensLabel.TextSize = 11
		tokensLabel.TextXAlignment = Enum.TextXAlignment.Right
		tokensLabel.Text = tostring(spectator.tokenBalance or 0) .. " pts"
		tokensLabel.Parent = row

		row.Parent = scrollList
	end
end

local function updateVisibility()
	local roundState = ReplicatedStorage:GetAttribute("RoundState")
	-- Hide during main menu; show during lobby, intermission, active, results
	container.Visible = roundState ~= nil and roundState ~= "menu"
end

ReplicatedStorage:GetAttributeChangedSignal("SpectatorList"):Connect(renderSpectators)
ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateVisibility)

updateVisibility()
renderSpectators()
