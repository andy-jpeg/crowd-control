local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local StarterGui = game:GetService("StarterGui")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")
local EventLog = script.Parent
local ActionLog = ReplicatedStorage:WaitForChild("ActionLog")

local TITLE_FORMAT = '<font color="#C35D2A">%s</font> spawns in <b>%s</b>!'
local NAME_FORMAT = '<font color="#C35D2A">%s</font>'
local MAX_NAMES = 3 -- past this it says "& 2 others"
local WHISTLE_ID, WHISTLE_VOLUME = "rbxassetid://129649904589836", 1 -- plays when a round starts
local ALERT_SOUND_ID, ALERT_VOLUME, ALERT_GAP = "rbxassetid://130017098772572", 1, 0.15 -- same as the spectator join sound, at most one every 0.15s
local DAMAGE_COLOR, DAMAGE_EDGE, DAMAGE_FADE_TIME = Color3.fromRGB(200, 20, 20), 0.2, 0.6 -- DAMAGE_EDGE is how far in from each edge the red reaches
local DAMAGE_MIN_FLASH, DAMAGE_MAX_FLASH = 0.25, 0.75 -- how strong the flash gets, from a scratch up to losing half your health
local MAX_ENTRIES = 2 -- older cards leave early when more events pile up
local BASIC_TIME, COMPLEX_TIME, NOTICE_TIME = 4, 7, 5 -- how long a card stays up
local ENTER_TIME, EXIT_TIME = 0.35, 0.3
local MAX_DELAY = 60
local TIMER_TOP, TIMER_RIGHT, TIMER_WIDTH, TIMER_HEIGHT = 12, 16, 200, 70 -- top right, clear of the podium
local URGENT_TIME, URGENT_COLOR = 10, Color3.fromRGB(190, 40, 30) -- the last 10 seconds of a round turn red and pulse
local FEED_TOP, FEED_GAP, CARD_PADDING = 12, 8, 12
local SURFACE_COLOR, COMPLEX_COLOR = Color3.fromRGB(237, 181, 76), Color3.fromRGB(242, 195, 102)
local BORDER_COLOR, TEXT_COLOR, MUTED_TEXT_COLOR = Color3.fromRGB(195, 93, 42), Color3.fromRGB(43, 22, 6), Color3.fromRGB(107, 58, 18)
local NUNITO = Font.fromEnum(Enum.Font.Nunito).Family
local FONT = Font.new(NUNITO, Enum.FontWeight.Bold)

local popGoal, shrinkGoal = {Scale = 1}, {Scale = 0.9}
local pulseGoal1, pulseGoal2 = {Scale = 1.12}, {Scale = 1}

local entries = {}
local isTimerShown = false
local lastSecond = nil
local entryCount = 0
local lastAlertAt = 0

local AlertSound = Instance.new("Sound")
AlertSound.Name, AlertSound.SoundId, AlertSound.Volume = "AlertSound", ALERT_SOUND_ID, ALERT_VOLUME
AlertSound.Parent = SoundService

local function useNunito(root, skip) -- swaps every text element to Nunito, keeping how bold it is
	for _, item in root:GetDescendants() do
		if (item:IsA("TextLabel") or item:IsA("TextButton") or item:IsA("TextBox")) and item ~= skip then
			item.FontFace = Font.new(NUNITO, item.FontFace.Weight, item.FontFace.Style)
		end
	end
end

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

	local Title = createText("Title", 28, TEXT_COLOR)
	Title.LayoutOrder = 1
	Title.Parent = Template

	local Tip = createText("Tip", 17, MUTED_TEXT_COLOR)
	Tip.LayoutOrder = 2
	Tip.Parent = Template

	Template.Parent = EventLog
	return Template
end

local function buildTimer()
	local Timer = Instance.new("Frame")
	Timer.Name = "Timer"
	Timer.AnchorPoint = Vector2.new(1, 0)
	Timer.Position, Timer.Size = UDim2.new(1, -TIMER_RIGHT, 0, TIMER_TOP), UDim2.fromOffset(TIMER_WIDTH, TIMER_HEIGHT)
	Timer.BackgroundColor3, Timer.BorderSizePixel = SURFACE_COLOR, 0
	Timer.Visible = false

	local UICorner = Instance.new("UICorner")
	UICorner.CornerRadius = UDim.new(0, 14)
	UICorner.Parent = Timer

	local UIStroke = Instance.new("UIStroke")
	UIStroke.Color, UIStroke.Thickness = BORDER_COLOR, 3
	UIStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	UIStroke.Parent = Timer

	local Label = createText("Label", 16, MUTED_TEXT_COLOR)
	Label.AutomaticSize = Enum.AutomaticSize.None
	Label.Position, Label.Size = UDim2.fromOffset(0, 6), UDim2.new(1, 0, 0, 18)
	Label.Parent = Timer

	local Clock = createText("Clock", 38, TEXT_COLOR)
	Clock.AutomaticSize = Enum.AutomaticSize.None
	Clock.Position, Clock.Size = UDim2.fromOffset(0, 24), UDim2.new(1, 0, 0, 40)
	Clock.Parent = Timer

	Timer.Parent = EventLog
	return Timer
end

local Timer = EventLog:FindFirstChild("Timer") or buildTimer() -- copy your own Timer in from a test to restyle it
local TimerLabel, Clock = Timer:FindFirstChild("Label", true), Timer:FindFirstChild("Clock", true)
local ClockColor = Clock and Clock.TextColor3
local TimerScale = Timer:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
TimerScale.Parent = Timer
local ClockScale = Clock and (Clock:FindFirstChildOfClass("UIScale") or Instance.new("UIScale"))
if ClockScale then
	ClockScale.Parent = Clock
end

local Feed = EventLog:FindFirstChild("Feed") or buildFeed()
local Template = EventLog:FindFirstChild("Template") or buildTemplate() -- copy your own Template in from a test to restyle the cards
Template.Visible = false
useNunito(EventLog) -- covers a Timer or Template you copied in from Studio

local function escape(text) -- names and event titles go inside rich text
	return (string.gsub(tostring(text), "[&<>]", {["&"] = "&amp;", ["<"] = "&lt;", [">"] = "&gt;"}))
end

local function joinNames(names) -- "a", "a & b", "a, b & c", each name in orange like "[name] spawns in"
	local shown = {}
	for index = 1, math.min(#names, MAX_NAMES) do
		shown[index] = string.format(NAME_FORMAT, escape(names[index]))
	end

	local extra = #names - #shown
	if extra > 0 then
		table.insert(shown, extra == 1 and "1 other" or extra .. " others")
	end
	if #shown == 1 then
		return shown[1]
	end

	return table.concat(shown, ", ", 1, #shown - 1) .. " &amp; " .. shown[#shown]
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
			local names = type(payload.names) == "table" and #payload.names > 0 and joinNames(payload.names) .. " " or ""
			Title.Text = "<b>" .. names .. escape(payload.title or "") .. "</b>" -- round updates are plain text, not "[name] spawns in"
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

	if os.clock() - lastAlertAt >= ALERT_GAP then -- a burst of events plays one sound, not a pile of them
		lastAlertAt = os.clock()
		AlertSound.TimePosition = 0
		AlertSound:Play()
	end

	while #entries > MAX_ENTRIES do -- too many at once, so the oldest steps aside
		removeEntry(entries[1])
	end

	task.delay(isComplex and COMPLEX_TIME or isNotice and NOTICE_TIME or BASIC_TIME, removeEntry, entry)
end

local function formatTime(seconds)
	seconds = math.max(0, math.floor(seconds))
	return string.format("%d:%02d", seconds // 60, seconds % 60)
end

local function getTimerText(state) -- what the timer says in each part of the round, or nil to hide it
	local round, total = ReplicatedStorage:GetAttribute("Round") or 0, ReplicatedStorage:GetAttribute("TotalRounds") or 0
	if state == "active" then
		return string.format("Round %d/%d", round, total), nil
	elseif state == "intermission" then
		return string.format("Round %d starts in", round), nil
	elseif state == "results" then
		return "You survived", formatTime(ReplicatedStorage:GetAttribute("LastSurvivalSeconds") or 0)
	end
	return nil
end

local function pulse(scale)
	local tweenInfo1 = TweenInfo.new(0.12, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)
	local tweenInfo2 = TweenInfo.new(0.35, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	local growTween = TweenService:Create(scale, tweenInfo1, pulseGoal1)
	local settleTween = TweenService:Create(scale, tweenInfo2, pulseGoal2)

	growTween:Play()
	growTween.Completed:Once(function()
		settleTween:Play()
	end)
end

local function updateTimer()
	local state = ReplicatedStorage:GetAttribute("RoundState")
	local label, fixedClock = getTimerText(state)

	local shouldShow = label ~= nil
	if shouldShow ~= isTimerShown then
		isTimerShown = shouldShow
		Timer.Visible = shouldShow
		if shouldShow then
			TimerScale.Scale = 0
			local tweenInfo = TweenInfo.new(ENTER_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

			local popTween = TweenService:Create(TimerScale, tweenInfo, popGoal)

			popTween:Play()
		end
	end
	if not shouldShow then
		lastSecond = nil
		return
	end

	local endsAt = ReplicatedStorage:GetAttribute("StateEndsAt") or 0
	local left = endsAt > 0 and math.max(0, math.ceil(endsAt - workspace:GetServerTimeNow())) or 0 -- the server's clock, so every player sees the same time
	if TimerLabel then
		TimerLabel.Text = label
	end
	if not Clock then return end
	Clock.Text = fixedClock or formatTime(left)

	local isUrgent = state == "active" and left > 0 and left <= URGENT_TIME
	Clock.TextColor3 = isUrgent and URGENT_COLOR or ClockColor
	if isUrgent and left ~= lastSecond and ClockScale then
		pulse(ClockScale) -- one pulse per second in the last 10
	end
	lastSecond = left
end

RunService.Heartbeat:Connect(updateTimer)

local Whistle = Instance.new("Sound")
Whistle.Name, Whistle.SoundId, Whistle.Volume = "RoundWhistle", WHISTLE_ID, WHISTLE_VOLUME
Whistle.Parent = SoundService -- made on the client, so it plays at full volume wherever the camera is

ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(function()
	if ReplicatedStorage:GetAttribute("RoundState") == "active" then
		Whistle.TimePosition = 0
		Whistle:Play()
	end
end)

task.spawn(function() -- hide Roblox's health bar, it sits where the timer is
	for _ = 1, 10 do
		if pcall(StarterGui.SetCoreGuiEnabled, StarterGui, Enum.CoreGuiType.Health, false) then
			return
		end
		task.wait(0.5) -- the core UI can still be loading right after joining
	end
end)

local OldFlash = PlayerGui:FindFirstChild("DamageFlash")
if OldFlash then
	OldFlash:Destroy() -- this script restarted, so don't stack a second one
end

local DamageFlash = Instance.new("ScreenGui") -- Roblox's own red flash went away with the health bar, so this replaces it
DamageFlash.Name = "DamageFlash"
DamageFlash.IgnoreGuiInset, DamageFlash.ResetOnSpawn = true, false
DamageFlash.DisplayOrder = 0 -- under the alerts, timer and menus
DamageFlash.Parent = PlayerGui

local damageEdges = {}
for _, side in {
	{name = "Top", size = UDim2.fromScale(1, DAMAGE_EDGE), position = UDim2.fromScale(0, 0), rotation = 90},
	{name = "Bottom", size = UDim2.fromScale(1, DAMAGE_EDGE), position = UDim2.fromScale(0, 1 - DAMAGE_EDGE), rotation = -90},
	{name = "Left", size = UDim2.fromScale(DAMAGE_EDGE, 1), position = UDim2.fromScale(0, 0), rotation = 0},
	{name = "Right", size = UDim2.fromScale(DAMAGE_EDGE, 1), position = UDim2.fromScale(1 - DAMAGE_EDGE, 0), rotation = 180},
} do
	local Edge = Instance.new("Frame")
	Edge.Name = side.name
	Edge.Size, Edge.Position = side.size, side.position
	Edge.BackgroundColor3, Edge.BackgroundTransparency, Edge.BorderSizePixel = DAMAGE_COLOR, 1, 0

	local UIGradient = Instance.new("UIGradient")
	UIGradient.Rotation = side.rotation -- solid at the screen edge, fading out toward the middle
	UIGradient.Transparency = NumberSequence.new({NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(1, 1)})
	UIGradient.Parent = Edge

	Edge.Parent = DamageFlash
	table.insert(damageEdges, Edge)
end

local function flashDamage(amount, maxHealth)
	local strength = math.clamp(amount / math.max(maxHealth, 1) * 2, 0, 1) -- half your health in one hit is the strongest flash
	local transparency = 1 - (DAMAGE_MIN_FLASH + (DAMAGE_MAX_FLASH - DAMAGE_MIN_FLASH) * strength)

	local tweenInfo = TweenInfo.new(DAMAGE_FADE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

	for _, Edge in damageEdges do
		Edge.BackgroundTransparency = math.min(Edge.BackgroundTransparency, transparency) -- a second hit mid-fade never makes it dimmer
		local fadeTween = TweenService:Create(Edge, tweenInfo, {BackgroundTransparency = 1})

		fadeTween:Play()
	end
end

local function watchHealth(character)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if not humanoid then return end

	local lastHealth = humanoid.Health
	humanoid.HealthChanged:Connect(function(health)
		if health < lastHealth then
			flashDamage(lastHealth - health, humanoid.MaxHealth)
		end
		lastHealth = health
	end)
end

player.CharacterAdded:Connect(watchHealth)
if player.Character then
	task.spawn(watchHealth, player.Character)
end

ActionLog.OnClientEvent:Connect(function(payload)
	if type(payload) ~= "table" then return end
	local delay = math.clamp(tonumber(payload.delay) or 0, 0, MAX_DELAY)
	task.delay(delay, addEntry, payload) -- show it when the event actually starts
end)

EventLog.ResetOnSpawn = false
EventLog.DisplayOrder = math.max(EventLog.DisplayOrder, 4) -- above the cover and the lobby
