local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")
local Ending = script.Parent

local SHOW_DELAY = 0.6 -- matches the cover transition
local POP_TIME, POP_STAGGER = 0.4, 0.08
local EXIT_TIME, EXIT_MARGIN, EXIT_LEAD = 0.45, 20, 0.1 -- leaves just before the menu comes back
local COUNTDOWN_FORMAT = "Back to menu in %d"
local ROW_HEIGHT, ROW_PADDING, HEADER_HEIGHT, PANEL_PADDING = 34, 6, 40, 12
local DEFAULT_ROUND_TIME = 60
local OUTLINE_INSET = 3 -- room for the 2px row outlines inside the lists
local SURFACE_COLOR, ROW_COLOR = Color3.fromRGB(237, 181, 76), Color3.fromRGB(225, 158, 29)
local BORDER_COLOR, TEXT_COLOR, MUTED_TEXT_COLOR = Color3.fromRGB(195, 93, 42), Color3.fromRGB(43, 22, 6), Color3.fromRGB(107, 58, 18)
local LIGHT_COLOR = Color3.fromRGB(255, 247, 232)
local NUNITO = Font.fromEnum(Enum.Font.Nunito).Family
local FONT = Font.new(NUNITO, Enum.FontWeight.Bold)

local popGoal = {Scale = 1}

local isShown = false
local showId = 0
local homePositions = {}

local function addCorner(parent, radius)
	local UICorner = Instance.new("UICorner")
	UICorner.CornerRadius = radius
	UICorner.Parent = parent
end

local function addStroke(parent, thickness)
	local UIStroke = Instance.new("UIStroke")
	UIStroke.Color, UIStroke.Thickness = BORDER_COLOR, thickness
	UIStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	UIStroke.Parent = parent
end

local function addTextStroke(parent, thickness)
	local UIStroke = Instance.new("UIStroke")
	UIStroke.Color, UIStroke.Thickness = BORDER_COLOR, thickness
	UIStroke.Parent = parent
end

local function useNunito(root, skip) -- swaps every text element to Nunito, keeping how bold it is
	for _, item in root:GetDescendants() do
		if (item:IsA("TextLabel") or item:IsA("TextButton") or item:IsA("TextBox")) and item ~= skip then
			item.FontFace = Font.new(NUNITO, item.FontFace.Weight, item.FontFace.Style)
		end
	end
end

local function padForOutlines(List) -- rows have outlines drawn just outside them, which the list would cut off
	if not List or List:FindFirstChildOfClass("UIPadding") then return end
	local UIPadding = Instance.new("UIPadding")
	for _, side in {"PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight"} do
		UIPadding[side] = UDim.new(0, OUTLINE_INSET)
	end
	UIPadding.Parent = List
end

local function createText(name, text, size, color, alignment)
	local Label = Instance.new("TextLabel")
	Label.Name = name
	Label.BackgroundTransparency = 1
	Label.FontFace, Label.TextSize, Label.TextColor3 = FONT, size, color
	Label.TextXAlignment = alignment or Enum.TextXAlignment.Left
	Label.TextTruncate = Enum.TextTruncate.AtEnd
	Label.Text = text
	return Label
end

local function buildHeadline(name, text, maxSize, position, height)
	local Label = createText(name, text, maxSize, LIGHT_COLOR, Enum.TextXAlignment.Center)
	Label.AnchorPoint = Vector2.new(0.5, 0)
	Label.Position, Label.Size = position, UDim2.new(0.7, 0, 0, height)
	Label.TextScaled = true

	local UITextSizeConstraint = Instance.new("UITextSizeConstraint")
	UITextSizeConstraint.MaxTextSize = maxSize
	UITextSizeConstraint.Parent = Label

	addTextStroke(Label, 3)
	Label.Parent = Ending
	return Label
end

local function buildPanel(name, title, anchorX, position)
	local Panel = Instance.new("Frame")
	Panel.Name = name
	Panel.AnchorPoint = Vector2.new(anchorX, 0.5)
	Panel.Position, Panel.Size = position, UDim2.fromScale(0.3, 0.52)
	Panel.BackgroundColor3, Panel.BorderSizePixel = SURFACE_COLOR, 0
	addCorner(Panel, UDim.new(0, 12))
	addStroke(Panel, 3)

	local UISizeConstraint = Instance.new("UISizeConstraint")
	UISizeConstraint.MinSize, UISizeConstraint.MaxSize = Vector2.new(220, 200), Vector2.new(380, 460)
	UISizeConstraint.Parent = Panel

	local Header = createText("Header", title, 24, TEXT_COLOR)
	Header.Position = UDim2.fromOffset(PANEL_PADDING, 6)
	Header.Size = UDim2.new(1, -PANEL_PADDING * 2, 0, HEADER_HEIGHT)
	Header.Parent = Panel

	local List = Instance.new("ScrollingFrame")
	List.Name = "List"
	List.Position = UDim2.fromOffset(PANEL_PADDING, HEADER_HEIGHT + 10)
	List.Size = UDim2.new(1, -PANEL_PADDING * 2, 1, -(HEADER_HEIGHT + 10 + PANEL_PADDING))
	List.BackgroundTransparency, List.BorderSizePixel = 1, 0
	List.ScrollBarThickness, List.ScrollBarImageColor3 = 6, BORDER_COLOR
	List.CanvasSize, List.AutomaticCanvasSize = UDim2.new(), Enum.AutomaticSize.Y
	List.Parent = Panel

	local UIListLayout = Instance.new("UIListLayout")
	UIListLayout.Padding = UDim.new(0, ROW_PADDING)
	UIListLayout.SortOrder = Enum.SortOrder.LayoutOrder
	UIListLayout.Parent = List

	Panel.Parent = Ending
	return Panel
end

local Title = Ending:FindFirstChild("Title") or buildHeadline("Title", "Session Over", 64, UDim2.fromScale(0.5, 0.06), 72)
local Subtitle = Ending:FindFirstChild("Subtitle") or buildHeadline("Subtitle", "", 30, UDim2.new(0.5, 0, 0.06, 78), 36)
local RoundList = Ending:FindFirstChild("RoundList") or buildPanel("RoundList", "Rounds", 0, UDim2.new(0, 24, 0.56, 0))
local Stats = Ending:FindFirstChild("Stats") or buildPanel("Stats", "Stats", 1, UDim2.new(1, -24, 0.56, 0))
local Countdown = Ending:FindFirstChild("Countdown") or buildHeadline("Countdown", "", 26, UDim2.new(0.5, 0, 1, -60), 34)
local RoundRows, StatRows = RoundList:FindFirstChild("List", true), Stats:FindFirstChild("List", true)
padForOutlines(RoundRows)
padForOutlines(StatRows)

useNunito(Ending) -- covers anything you copied in from Studio

local popElements = {Title, Subtitle, RoundList, Stats, Countdown}
local exitGroups = {
	{direction = "top", elements = {Title, Subtitle}},
	{direction = "left", elements = {RoundList}},
	{direction = "right", elements = {Stats}},
	{direction = "bottom", elements = {Countdown}},
}
for _, group in exitGroups do
	for _, element in group.elements do
		homePositions[element] = element.Position
	end
end

local function getScale(element)
	local scale = element:FindFirstChildOfClass("UIScale")
	if not scale then
		scale = Instance.new("UIScale")
		scale.Parent = element
	end
	return scale
end

local function popIn(element, delay)
	local tweenInfo = TweenInfo.new(POP_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	local scale = getScale(element)
	scale.Scale = 0
	local popTween = TweenService:Create(scale, tweenInfo, popGoal)

	task.delay(delay or 0, function()
		popTween:Play()
	end)
end

local function formatTime(seconds)
	seconds = math.floor(seconds)
	return string.format("%d:%02d", seconds // 60, seconds % 60)
end

local function clearRows(List)
	if List:IsA("ScrollingFrame") then
		List.CanvasPosition = Vector2.zero -- start at the top
	end
	for _, child in List:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end
end

local function createRow(List, label, value, order, progress)
	local baseZ = List.ZIndex + 1 -- always above the panel, even if the GUI layers by global ZIndex
	local Row = Instance.new("Frame")
	Row.Name = "Row"
	Row.ZIndex = baseZ
	Row.Size = UDim2.new(1, -8, 0, ROW_HEIGHT) -- leaves room for the scroll bar
	Row.BackgroundColor3, Row.BorderSizePixel, Row.LayoutOrder = ROW_COLOR, 0, order
	Row.ClipsDescendants = true
	addCorner(Row, UDim.new(0, 8))
	addStroke(Row, 2)

	if progress then
		local Progress = Instance.new("Frame")
		Progress.Name = "Progress"
		Progress.Size = UDim2.fromScale(math.clamp(progress, 0, 1), 1) -- how much of the round was survived
		Progress.BackgroundColor3, Progress.BackgroundTransparency, Progress.BorderSizePixel = BORDER_COLOR, 0.7, 0
		Progress.ZIndex = baseZ
		addCorner(Progress, UDim.new(0, 8))
		Progress.Parent = Row
	end

	local Label = createText("Label", label, 18, TEXT_COLOR)
	Label.Position = UDim2.fromOffset(10, 0)
	Label.Size = UDim2.new(0.6, -10, 1, 0)
	Label.ZIndex = baseZ + 1
	Label.Parent = Row

	local Value = createText("Value", value, 18, MUTED_TEXT_COLOR, Enum.TextXAlignment.Right)
	Value.AnchorPoint = Vector2.new(1, 0)
	Value.Position = UDim2.new(1, -10, 0, 0)
	Value.Size = UDim2.new(0.4, 0, 1, 0)
	Value.ZIndex = baseZ + 1
	Value.Parent = Row

	Row.Parent = List
end

local function getSummary()
	local success, summary = pcall(HttpService.JSONDecode, HttpService, ReplicatedStorage:GetAttribute("SessionSummary") or "")
	return (success and type(summary) == "table") and summary or {}
end

local function fillSummary()
	local summary = getSummary()
	local rounds = type(summary.rounds) == "table" and summary.rounds or {}
	local roundTime = tonumber(summary.roundTime) or DEFAULT_ROUND_TIME
	local fullRounds = tonumber(summary.fullRounds) or 0

	if #rounds > 0 and fullRounds == #rounds then
		Subtitle.Text = "You survived every round!"
	else
		Subtitle.Text = string.format("You survived %d of %d rounds", fullRounds, #rounds)
	end

	if RoundRows then
		clearRows(RoundRows)
		for index, seconds in rounds do
			createRow(RoundRows, "Round " .. index, formatTime(seconds), index, seconds / roundTime)
		end
	end

	if StatRows then
		local topSpectator = summary.topSpectator and string.format("%s (%d)", summary.topSpectator, tonumber(summary.topSpectatorEvents) or 0) or "None"
		clearRows(StatRows)
		for index, stat in {
			{"Total time", formatTime(tonumber(summary.totalSeconds) or 0)},
			{"Best round", formatTime(tonumber(summary.bestSeconds) or 0)},
			{"Events thrown", tostring(tonumber(summary.eventsRun) or 0)},
			{"Spectators", tostring(tonumber(summary.spectatorCount) or 0)},
			{"Top spectator", topSpectator},
		} do
			createRow(StatRows, stat[1], stat[2], index)
		end
	end
end

local function getExitOffset(group)
	local screenSize = Ending.AbsoluteSize
	local distance = 0
	for _, element in group.elements do -- grouped elements travel the same distance so they stay together
		local position, size = element.AbsolutePosition - Ending.AbsolutePosition, element.AbsoluteSize
		if group.direction == "top" then
			distance = math.max(distance, position.Y + size.Y)
		elseif group.direction == "bottom" then
			distance = math.max(distance, screenSize.Y - position.Y)
		elseif group.direction == "left" then
			distance = math.max(distance, position.X + size.X)
		else
			distance = math.max(distance, screenSize.X - position.X)
		end
	end

	distance += EXIT_MARGIN
	if group.direction == "top" then
		return UDim2.fromOffset(0, -distance)
	elseif group.direction == "bottom" then
		return UDim2.fromOffset(0, distance)
	elseif group.direction == "left" then
		return UDim2.fromOffset(-distance, 0)
	end
	return UDim2.fromOffset(distance, 0)
end

local function leaveEnding()
	local tweenInfo = TweenInfo.new(EXIT_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.In)

	local exitTweens = {}
	for _, group in exitGroups do
		local offset = getExitOffset(group)
		for _, element in group.elements do
			table.insert(exitTweens, TweenService:Create(element, tweenInfo, {Position = homePositions[element] + offset}))
		end
	end

	for _, tween in exitTweens do
		tween:Play()
	end
end

local function runCountdown(id)
	local shownAt = os.clock()
	local hasLeft = false
	while id == showId do
		local endsAt = ReplicatedStorage:GetAttribute("StateEndsAt") or 0 -- read every tick, never a stale value from the last phase
		local timeLeft = endsAt - workspace:GetServerTimeNow()
		Countdown.Text = string.format(COUNTDOWN_FORMAT, math.max(0, math.ceil(timeLeft)))

		local isSettled = os.clock() - shownAt >= SHOW_DELAY + POP_TIME + POP_STAGGER * #popElements -- everything has popped in
		if not hasLeft and isSettled and endsAt > 0 and timeLeft <= EXIT_TIME + EXIT_LEAD then
			hasLeft = true
			leaveEnding() -- slide out just before the menu comes back
		end
		if endsAt > 0 and timeLeft <= 0 then
			break
		end
		task.wait(0.1)
	end
end

local function updateEnding()
	local isOver = ReplicatedStorage:GetAttribute("RoundState") == "sessionOver"
	if isOver == isShown then return end
	isShown = isOver
	showId += 1

	if not isOver then
		Ending.Enabled = false
		return
	end

	local id = showId
	for element, position in homePositions do
		element.Position = position
	end
	fillSummary()
	task.spawn(runCountdown, id)

	task.delay(SHOW_DELAY, function()
		if id ~= showId then return end -- the cover is still growing until now
		Ending.Enabled = true
		for index, element in popElements do
			popIn(element, (index - 1) * POP_STAGGER)
		end
	end)

end

Ending.Enabled = false
Ending.ResetOnSpawn = false
Ending.DisplayOrder = math.max(Ending.DisplayOrder, 3) -- above the cover, like the lobby
ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateEnding)
ReplicatedStorage:GetAttributeChangedSignal("SessionSummary"):Connect(function()
	if isShown then
		fillSummary()
	end
end)
updateEnding()
