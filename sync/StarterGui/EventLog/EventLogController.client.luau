local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")
local EventLog = script.Parent
local ActionLog = ReplicatedStorage:WaitForChild("ActionLog")
local Lobby = PlayerGui:WaitForChild("Lobby", 5)
local LobbyCode = Lobby and Lobby:FindFirstChild("Code")

local TITLE_FORMAT = '<font color="#C35D2A">%s</font> spawns in <b>%s</b>!'
local MAX_ENTRIES = 4 -- older cards leave early when more events pile up
local BASIC_TIME, COMPLEX_TIME, NOTICE_TIME = 4, 7, 5 -- how long a card stays up
local ENTER_TIME, EXIT_TIME = 0.35, 0.3
local MAX_DELAY = 60
local FEED_TOP, FEED_GAP, CARD_PADDING = 12, 8, 12
local SURFACE_COLOR, COMPLEX_COLOR = Color3.fromRGB(237, 181, 76), Color3.fromRGB(242, 195, 102)
local BORDER_COLOR, TEXT_COLOR, MUTED_TEXT_COLOR = Color3.fromRGB(195, 93, 42), Color3.fromRGB(43, 22, 6), Color3.fromRGB(107, 58, 18)
local FONT = LobbyCode and LobbyCode.FontFace or Font.fromEnum(Enum.Font.FredokaOne) -- same font as the lobby

local popGoal, shrinkGoal = {Scale = 1}, {Scale = 0.9}

local entries = {}
local entryCount = 0

local function createText(name, size, color)
	local Label = Instance.new("TextLabel")
	Label.Name = name
	Label.BackgroundTransparency = 1
	Label.Size, Label.AutomaticSize = UDim2.fromScale(1, 0), Enum.AutomaticSize.Y
	Label.FontFace, Label.TextSize, Label.TextColor3 = FONT, size, color
	Label.TextWrapped, Label.RichText = true, true
	return Label
end

local function buildFeed()
	local Feed = Instance.new("Frame")
	Feed.Name = "Feed"
	Feed.AnchorPoint = Vector2.new(0.5, 0)
	Feed.Position, Feed.Size = UDim2.new(0.5, 0, 0, FEED_TOP), UDim2.fromScale(0.42, 0.6)
	Feed.BackgroundTransparency = 1

	local UISizeConstraint = Instance.new("UISizeConstraint")
	UISizeConstraint.MinSize, UISizeConstraint.MaxSize = Vector2.new(280, 0), Vector2.new(560, math.huge)
	UISizeConstraint.Parent = Feed

	local UIListLayout = Instance.new("UIListLayout")
	UIListLayout.Padding = UDim.new(0, FEED_GAP)
	UIListLayout.SortOrder = Enum.SortOrder.LayoutOrder
	UIListLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
	UIListLayout.Parent = Feed

	Feed.Parent = EventLog
	return Feed
end

local function buildTemplate()
	local Template = Instance.new("Frame")
	Template.Name = "Template"
	Template.Size, Template.AutomaticSize = UDim2.fromScale(1, 0), Enum.AutomaticSize.Y
	Template.BackgroundColor3, Template.BorderSizePixel = SURFACE_COLOR, 0
	Template.Visible = false

	local UICorner = Instance.new("UICorner")
	UICorner.CornerRadius = UDim.new(0, 12)
	UICorner.Parent = Template

	local UIStroke = Instance.new("UIStroke")
	UIStroke.Color, UIStroke.Thickness = BORDER_COLOR, 3
	UIStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	UIStroke.Parent = Template

	local UIPadding = Instance.new("UIPadding")
	for _, side in {"PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight"} do
		UIPadding[side] = UDim.new(0, CARD_PADDING)
	end
	UIPadding.Parent = Template

	local UIListLayout = Instance.new("UIListLayout")
	UIListLayout.Padding = UDim.new(0, 2)
	UIListLayout.SortOrder = Enum.SortOrder.LayoutOrder
	UIListLayout.Parent = Template

	local Title = createText("Title", 22, TEXT_COLOR)
	Title.LayoutOrder = 1
	Title.Parent = Template

	local Tip = createText("Tip", 17, MUTED_TEXT_COLOR)
	Tip.LayoutOrder = 2
	Tip.Parent = Template

	Template.Parent = EventLog
	return Template
end

local Feed = EventLog:FindFirstChild("Feed") or buildFeed()
local Template = EventLog:FindFirstChild("Template") or buildTemplate() -- copy your own Template in from a test to restyle the cards
Template.Visible = false

local function escape(text) -- names and event titles go inside rich text
	return (string.gsub(tostring(text), "[&<>]", {["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;"}))
end

local function getFadeTargets(Entry) -- every transparency the card uses, so it can fade as one piece
	local targets = {}
	for _, item in {Entry, table.unpack(Entry:GetDescendants())} do
		local goal = {}
		if item:IsA("GuiObject") then
			goal.BackgroundTransparency = item.BackgroundTransparency
		end
		if item:IsA("TextLabel") then
			goal.TextTransparency = item.TextTransparency
		elseif item:IsA("ImageLabel") or item:IsA("ImageButton") then
			goal.ImageTransparency = item.ImageTransparency
		elseif item:IsA("UIStroke") then
			goal.Transparency = item.Transparency
		end
		if next(goal) then
			table.insert(targets, {item = item, shown = goal})
		end
	end
	return targets
end

local function setHidden(targets)
	for _, target in targets do
		for property in target.shown do
			target.item[property] = 1
		end
	end
end

local function fade(targets, tweenInfo, isShowing)
	for _, target in targets do
		local goal = {}
		for property, value in target.shown do
			goal[property] = isShowing and value or 1
		end
		TweenService:Create(target.item, tweenInfo, goal):Play()
	end
end

local function removeEntry(entry)
	local index = table.find(entries, entry)
	if not index then return end
	table.remove(entries, index)

	local tweenInfo = TweenInfo.new(EXIT_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.In)

	local shrinkTween = TweenService:Create(entry.scale, tweenInfo, shrinkGoal)

	shrinkTween:Play()
	fade(entry.targets, tweenInfo, false)
	task.delay(EXIT_TIME, function()
		entry.frame:Destroy()
	end)
end

local function addEntry(payload)
	local isComplex, isNotice = payload.tier == "complex", payload.tier == "notice"
	local tip = (isComplex or isNotice) and payload.tip or nil

	local Entry = Template:Clone()
	Entry.Name, Entry.Visible = "Entry", true
	entryCount += 1
	Entry.LayoutOrder = -entryCount -- newest on top
	if isComplex and Entry.BackgroundColor3 == SURFACE_COLOR then
		Entry.BackgroundColor3 = COMPLEX_COLOR -- a little brighter so big events stand out
	end

	local Title, Tip = Entry:FindFirstChild("Title", true), Entry:FindFirstChild("Tip", true)
	if Title then
		if isNotice then
			Title.Text = "<b>" .. escape(payload.title or "") .. "</b>" -- round updates are plain text, not "[name] spawns in"
		else
			Title.Text = string.format(TITLE_FORMAT, escape(payload.name or "A spectator"), escape(payload.event or "an event"))
		end
	end
	if Tip then
		Tip.Text = tip and escape(tip) or ""
		Tip.Visible = tip ~= nil
	end

	local scale = Entry:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
	scale.Scale = 0.6
	scale.Parent = Entry

	local entry = {frame = Entry, scale = scale, targets = getFadeTargets(Entry)}
	setHidden(entry.targets)
	Entry.Parent = Feed
	table.insert(entries, entry)

	local tweenInfo1 = TweenInfo.new(ENTER_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	local tweenInfo2 = TweenInfo.new(ENTER_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	local popTween = TweenService:Create(scale, tweenInfo1, popGoal)

	popTween:Play()
	fade(entry.targets, tweenInfo2, true)

	while #entries > MAX_ENTRIES do -- too many at once, so the oldest steps aside
		removeEntry(entries[1])
	end

	task.delay(isComplex and COMPLEX_TIME or isNotice and NOTICE_TIME or BASIC_TIME, removeEntry, entry)
end

ActionLog.OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then return end
	local delay = math.clamp(tonumber(payload.delay) or 0, 0, MAX_DELAY)
	task.delay(delay, addEntry, payload) -- show it when the event actually starts
end)

EventLog.ResetOnSpawn = false
EventLog.DisplayOrder = math.max(EventLog.DisplayOrder, 4) -- above the cover and the lobby
