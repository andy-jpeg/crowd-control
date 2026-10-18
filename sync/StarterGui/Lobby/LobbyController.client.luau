local GuiService = game:GetService("GuiService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local player = Players.LocalPlayer
local Lobby = script.Parent
local Code = Lobby:WaitForChild("Code")
local CodeImage = Lobby:WaitForChild("CodeImage")
local Start = Lobby:FindFirstChild("Start") -- hooks up automatically once you add it
local StartGame = ReplicatedStorage:WaitForChild("StartGame")

local CODE_FORMAT = "%s"
local NUNITO = Font.fromEnum(Enum.Font.Nunito).Family
local FONT = Font.new(NUNITO, Enum.FontWeight.Bold) -- everything but the code label and spectator list uses Nunito
local LIST_FONT = Code.FontFace -- the spectator list keeps the code label's font
local NO_CODE = "Offline"
local SHOW_DELAY = 0.6 -- matches the menu's cover transition
local POP_TIME = 0.4
local POP_STAGGER = 0.08
local POP_SOUND_ID, POP_VOLUME, POP_PITCH_RANGE = "rbxassetid://8517153399", 1, 0.08 -- BApeptalk1, pitch varies a little so repeats don't sound copy-pasted
local POP_LIFETIME = 10
local EXIT_TIME, EXIT_MARGIN = 0.45, 20
local LEAVE_TIMEOUT = 5
local HOVER_SCALE, HOVER_TIME = 1.1, 0.15
local LOBBY_MUSIC_ID, ROUND_MUSIC_ID = "rbxassetid://1841647093", "rbxassetid://1837849285" -- Life in an Elevator, Night Vision
local MUSIC_VOLUME, MUSIC_FADE_TIME = 0.4, 1.5
local JOIN_SOUND_ID, JOIN_VOLUME = "rbxassetid://130017098772572", 1 -- Roblox GUI Notification High, when a spectator joins the lobby
local WOOSH_ID, WOOSH_VOLUME = "rbxassetid://100912899778737", 1.5 -- Sonic Mania Menu Woosh, it's quiet so it's above the usual 0.5
local START_SWAY_ANGLE, START_SWAY_TIME, START_PULSE_SCALE, START_PULSE_TIME = 2.5, 2.6, 1.035, 1.8 -- calmer than the logo (5, 2, 1.06, 1.4)
local EMPTY_TEXT = "Waiting for spectators...\nJoin at <u>survivalofthe.fit</u>" -- rich text, so the address is underlined
local MUSIC_LOAD_TIMEOUT = 10
local FALLBACK_NAME = "A spectator"
local OUTLINE_INSET = 3 -- room for the 2px row outlines inside the list
local ROW_HEIGHT, ROW_PADDING, HEADER_HEIGHT, LIST_PADDING = 34, 6, 40, 12
local SURFACE_COLOR, ROW_COLOR = Color3.fromRGB(237, 181, 76), Color3.fromRGB(225, 158, 29)
local BORDER_COLOR, TEXT_COLOR, MUTED_TEXT_COLOR = Color3.fromRGB(195, 93, 42), Color3.fromRGB(43, 22, 6), Color3.fromRGB(107, 58, 18)
local LIGHT_COLOR, MUTED_COLOR = Color3.fromRGB(255, 247, 232), Color3.fromRGB(185, 130, 42)
local MIN_ROUNDS, MAX_ROUNDS = 5, 10
local SLIDER_MIN_WIDTH, SLIDER_MAX_WIDTH, SLIDER_GAP = 200, 340, 14
local LABEL_HEIGHT, TRACK_HEIGHT, KNOB_SIZE, KNOB_PRESS_SCALE = 30, 14, 30, 1.15
local SLIDER_HEIGHT = LABEL_HEIGHT + KNOB_SIZE + 6
local SLIDER_TIME = 0.12
local ICON_IDS = {75794528952903, 75283171144013, 74155331991672, 92805238287290, 128506163637798, 135499271414263, 132980640218769, 125927225595333}
local ICON_SIZE, ICON_GAP, ICON_SPEED, BAR_HEIGHT = 110, 36, 60, 130 -- 60 pixels per second is one pixel a frame, so it never stutters
local MAX_SCROLL_STEP = 1 / 30 -- a lag spike won't make the bars jump
local ICON_BARS = {
	{name = "IconBar1", edge = "bottom", direction = -1}, -- -1 scrolls left, 1 scrolls right
	{name = "IconBar2", edge = "top", direction = 1, isReversed = true}, -- icons in the opposite order
}

local popGoal = {Scale = 1}
local startGoal1 = {Rotation = START_SWAY_ANGLE}
local hoverGoal1, hoverGoal2 = {Scale = HOVER_SCALE}, {Scale = 1}
local musicGoal1, musicGoal2 = {Volume = MUSIC_VOLUME}, {Volume = 0}
local knobGoal1, knobGoal2 = {Scale = KNOB_PRESS_SCALE}, {Scale = 1}

local isShown = false
local showId = 0
local isLeaving = false
local homePositions = {}
local knownNames = {}
local random = Random.new()
local chosenRounds = MIN_ROUNDS
local isDragging = false

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

local function isSkipped(item, skips)
	for _, skip in skips do
		if item == skip or item:IsDescendantOf(skip) then
			return true
		end
	end
	return false
end

local function useNunito(root, skips) -- swaps every text element to Nunito, keeping how bold it is
	for _, item in root:GetDescendants() do
		if (item:IsA("TextLabel") or item:IsA("TextButton") or item:IsA("TextBox")) and not isSkipped(item, skips) then
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

local function createText(name, text, size, color, alignment, font)
	local Label = Instance.new("TextLabel")
	Label.Name = name
	Label.BackgroundTransparency = 1
	Label.FontFace, Label.TextSize, Label.TextColor3 = font or FONT, size, color
	Label.TextXAlignment = alignment or Enum.TextXAlignment.Left
	Label.TextTruncate = Enum.TextTruncate.AtEnd
	Label.Text = text
	return Label
end

local function buildSpectators()
	local Spectators = Instance.new("Frame")
	Spectators.Name = "Spectators"
	Spectators.AnchorPoint = Vector2.new(1, 0.5)
	Spectators.Position = UDim2.new(1, -24, 0.5, 0)
	Spectators.Size = UDim2.fromScale(0.24, 0.6)
	Spectators.BackgroundColor3, Spectators.BorderSizePixel = SURFACE_COLOR, 0
	addCorner(Spectators, UDim.new(0, 12))
	addStroke(Spectators, 3)

	local UISizeConstraint = Instance.new("UISizeConstraint")
	UISizeConstraint.MinSize, UISizeConstraint.MaxSize = Vector2.new(200, 220), Vector2.new(320, 520)
	UISizeConstraint.Parent = Spectators

	local Header = createText("Header", "Spectators (0)", 24, TEXT_COLOR, nil, LIST_FONT)
	Header.Position = UDim2.fromOffset(LIST_PADDING, 6)
	Header.Size = UDim2.new(1, -LIST_PADDING * 2, 0, HEADER_HEIGHT)
	Header.Parent = Spectators

	local List = Instance.new("ScrollingFrame")
	List.Name = "List"
	List.Position = UDim2.fromOffset(LIST_PADDING, HEADER_HEIGHT + 10)
	List.Size = UDim2.new(1, -LIST_PADDING * 2, 1, -(HEADER_HEIGHT + 10 + LIST_PADDING))
	List.BackgroundTransparency, List.BorderSizePixel = 1, 0
	List.ScrollBarThickness, List.ScrollBarImageColor3 = 6, BORDER_COLOR
	List.CanvasSize, List.AutomaticCanvasSize = UDim2.new(), Enum.AutomaticSize.Y
	List.Parent = Spectators

	local UIListLayout = Instance.new("UIListLayout")
	UIListLayout.Padding = UDim.new(0, ROW_PADDING)
	UIListLayout.SortOrder = Enum.SortOrder.LayoutOrder
	UIListLayout.Parent = List

	local Empty = createText("Empty", EMPTY_TEXT, 18, MUTED_TEXT_COLOR, Enum.TextXAlignment.Center, LIST_FONT)
	Empty.Position = List.Position
	Empty.Size = UDim2.new(1, -LIST_PADDING * 2, 0, 60)
	Empty.TextWrapped, Empty.TextTruncate = true, Enum.TextTruncate.None
	Empty.Parent = Spectators

	Spectators.Parent = Lobby
	return Spectators
end

local function buildRounds()
	local Rounds = Instance.new("Frame")
	Rounds.Name = "Rounds"
	Rounds.AnchorPoint = Vector2.new(0.5, 0)
	Rounds.BackgroundTransparency = 1

	local RoundsLabel = createText("RoundsLabel", "Rounds: " .. MIN_ROUNDS, 26, LIGHT_COLOR, Enum.TextXAlignment.Center)
	RoundsLabel.Size = UDim2.new(1, 0, 0, LABEL_HEIGHT)
	RoundsLabel.Parent = Rounds

	local LabelStroke = Instance.new("UIStroke")
	LabelStroke.Color, LabelStroke.Thickness = BORDER_COLOR, 2.5
	LabelStroke.Parent = RoundsLabel

	local Track = Instance.new("Frame")
	Track.Name = "Track"
	Track.AnchorPoint = Vector2.new(0, 0.5)
	Track.Position = UDim2.new(0, KNOB_SIZE / 2, 0, LABEL_HEIGHT + 6 + KNOB_SIZE / 2)
	Track.Size = UDim2.new(1, -KNOB_SIZE, 0, TRACK_HEIGHT) -- inset so the knob stays inside at both ends
	Track.BackgroundColor3, Track.BorderSizePixel = MUTED_COLOR, 0
	addCorner(Track, UDim.new(1, 0))
	addStroke(Track, 3)
	Track.Parent = Rounds

	local Fill = Instance.new("Frame")
	Fill.Name = "Fill"
	Fill.BackgroundColor3, Fill.BorderSizePixel = BORDER_COLOR, 0
	addCorner(Fill, UDim.new(1, 0))
	Fill.Parent = Track

	for value = MIN_ROUNDS, MAX_ROUNDS do
		local Tick = Instance.new("Frame")
		Tick.Name = "Tick"
		Tick.AnchorPoint = Vector2.new(0.5, 0.5)
		Tick.Position = UDim2.fromScale((value - MIN_ROUNDS) / (MAX_ROUNDS - MIN_ROUNDS), 0.5)
		Tick.Size = UDim2.fromOffset(4, 4)
		Tick.BackgroundColor3, Tick.BackgroundTransparency, Tick.BorderSizePixel = LIGHT_COLOR, 0.3, 0
		addCorner(Tick, UDim.new(0.5, 0))
		Tick.Parent = Track
	end

	local Knob = Instance.new("Frame")
	Knob.Name = "Knob"
	Knob.AnchorPoint = Vector2.new(0.5, 0.5)
	Knob.Size = UDim2.fromOffset(KNOB_SIZE, KNOB_SIZE)
	Knob.BackgroundColor3, Knob.BorderSizePixel, Knob.ZIndex = LIGHT_COLOR, 0, 2
	addCorner(Knob, UDim.new(0.5, 0))
	addStroke(Knob, 3)
	Knob.Parent = Track

	local Hitbox = Instance.new("TextButton")
	Hitbox.Name = "Hitbox"
	Hitbox.Position = UDim2.fromOffset(0, LABEL_HEIGHT)
	Hitbox.Size = UDim2.new(1, 0, 0, KNOB_SIZE + 12)
	Hitbox.BackgroundTransparency, Hitbox.Text, Hitbox.AutoButtonColor, Hitbox.ZIndex = 1, "", false, 3 -- bigger than the track so it's easy to grab on mobile
	Hitbox.Parent = Rounds

	Rounds.Parent = Lobby
	return Rounds
end

local function buildIconBar(name, edge)
	local edgeY = edge == "top" and 0 or 1

	local IconBar = Instance.new("Frame")
	IconBar.Name = name
	IconBar.AnchorPoint = Vector2.new(0.5, edgeY)
	IconBar.Position = UDim2.fromScale(0.5, edgeY)
	IconBar.Size = UDim2.new(1, 0, 0, BAR_HEIGHT)
	IconBar.BackgroundTransparency, IconBar.BorderSizePixel, IconBar.ZIndex = 1, 0, 0 -- behind everything else in the lobby
	IconBar.ClipsDescendants = true

	local Icon = Instance.new("ImageLabel")
	Icon.Name = "Icon"
	Icon.AnchorPoint = Vector2.new(0, 0.5)
	Icon.Position = UDim2.fromScale(0, 0.5)
	Icon.Size = UDim2.fromOffset(ICON_SIZE, ICON_SIZE)
	Icon.BackgroundTransparency = 1
	Icon.ScaleType = Enum.ScaleType.Fit
	Icon.Visible = false -- the style template, every scrolling icon is a copy of it
	Icon.Parent = IconBar

	IconBar.Parent = Lobby
	return IconBar
end

local isCustomRounds = Lobby:FindFirstChild("Rounds") ~= nil -- a Rounds you placed in Studio keeps its own position
local Spectators = Lobby:FindFirstChild("Spectators") or buildSpectators()
local Rounds = Lobby:FindFirstChild("Rounds") or buildRounds()
local function findPart(parent, name)
	local part = parent:FindFirstChild(name, true) -- searches nested frames too, so custom layouts still work
	if not part then
		warn("[Lobby] " .. parent.Name .. " is missing " .. name)
	end
	return part
end

local OldIconBar = Lobby:FindFirstChild("IconBar")
if OldIconBar and not Lobby:FindFirstChild(ICON_BARS[1].name) then
	OldIconBar.Name = ICON_BARS[1].name -- a single IconBar copied in earlier becomes the bottom one
end

local iconBars = {}
for _, info in ICON_BARS do
	local IconBar = Lobby:FindFirstChild(info.name) or buildIconBar(info.name, info.edge)
	local OldStrip = IconBar:FindFirstChild("Strip")
	if OldStrip then
		OldStrip:Destroy() -- a bar copied from a test still has its scrolling icons, they get rebuilt from Icon
	end

	local ids = table.clone(ICON_IDS)
	if info.isReversed then
		for index = 1, #ids do
			ids[index] = ICON_IDS[#ICON_IDS - index + 1]
		end
	end

	table.insert(iconBars, {IconBar = IconBar, Template = findPart(IconBar, "Icon"), ids = ids, direction = info.direction, setWidth = 0, offset = 0})
end
local IconBar1, IconBar2 = iconBars[1].IconBar, iconBars[2].IconBar

local Header, List, Empty = findPart(Spectators, "Header"), findPart(Spectators, "List"), findPart(Spectators, "Empty")
padForOutlines(List)
if Empty then
	Empty.RichText, Empty.Text = true, EMPTY_TEXT -- also applies to an Empty you copied in from Studio
end
local RoundsLabel, Track, Fill, Knob = findPart(Rounds, "RoundsLabel"), findPart(Rounds, "Track"), findPart(Rounds, "Fill"), findPart(Rounds, "Knob")
local Hitbox = Rounds:FindFirstChild("Hitbox", true) or Track -- without a Hitbox, the track itself is the drag area
local KnobScale = Knob and (Knob:FindFirstChildOfClass("UIScale") or Instance.new("UIScale", Knob))

local function createMusic(name, soundId)
	local Music = Instance.new("Sound")
	Music.Name, Music.SoundId = name, soundId
	Music.Looped, Music.Volume = true, 0
	Music.Parent = SoundService -- made on the client, so only this player hears it
	return Music
end

local LobbyMusic = createMusic("LobbyMusic", LOBBY_MUSIC_ID)
local RoundMusic = createMusic("RoundMusic", ROUND_MUSIC_ID)

local PopSound = Instance.new("Sound")
PopSound.Name, PopSound.SoundId, PopSound.Volume = "PopSound", POP_SOUND_ID, POP_VOLUME
PopSound.Parent = SoundService

local JoinSound = Instance.new("Sound")
JoinSound.Name, JoinSound.SoundId, JoinSound.Volume = "JoinSound", JOIN_SOUND_ID, JOIN_VOLUME
JoinSound.Parent = SoundService

local Woosh = Instance.new("Sound")
Woosh.Name, Woosh.SoundId, Woosh.Volume = "StartWoosh", WOOSH_ID, WOOSH_VOLUME
Woosh.Parent = SoundService

for _, Music in {LobbyMusic, RoundMusic} do
	task.delay(MUSIC_LOAD_TIMEOUT, function()
		if not Music.IsLoaded then -- usually the audio's permissions: the game has to be allowed to use it
			warn("[Lobby] " .. Music.Name .. " (" .. Music.SoundId .. ") didn't load. Check that the audio is public or shared with this experience")
		end
	end)
end
local currentMusic = nil

useNunito(Lobby, {Code, Spectators}) -- the code label and spectator list keep their font

local popElements = {IconBar1, IconBar2, CodeImage, Code, Rounds, Spectators, Start}
local exitGroups = {
	{direction = "top", elements = {CodeImage, Code}},
	{direction = "right", elements = {Spectators}},
	{direction = "left", elements = {Rounds}},
	{direction = "bottom", elements = {Start}},
	{direction = "nearest", elements = {IconBar1}}, -- top or bottom, whichever edge you put it closer to
	{direction = "nearest", elements = {IconBar2}},
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

local function playPop() -- a copy each time, so pops that overlap don't cut each other off
	local Pop = PopSound:Clone()
	Pop.PlaybackSpeed = 1 + random:NextNumber(-POP_PITCH_RANGE, POP_PITCH_RANGE)
	Pop.Parent = SoundService
	Pop:Play()

	Pop.Ended:Once(function()
		Pop:Destroy()
	end)
	task.delay(POP_LIFETIME, function()
		if Pop.Parent then
			Pop:Destroy() -- in case it never loaded and Ended never fires
		end
	end)
end

local function popIn(element, delay)
	local info = TweenInfo.new(POP_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	local scale = getScale(element)
	scale.Scale = 0
	local tween = TweenService:Create(scale, info, popGoal)

	task.delay(delay or 0, function()
		tween:Play()
	end)
end

local function setRounds(value, instant)
	chosenRounds = value
	if RoundsLabel then
		RoundsLabel.Text = "Rounds: " .. value
	end
	if not (Knob and Fill) then return end

	local alpha = (value - MIN_ROUNDS) / (MAX_ROUNDS - MIN_ROUNDS)
	local goal1, goal2 = {Position = UDim2.fromScale(alpha, 0.5)}, {Size = UDim2.fromScale(alpha, 1)}
	if instant then
		Knob.Position, Fill.Size = goal1.Position, goal2.Size
		return
	end

	local tweenInfo = TweenInfo.new(SLIDER_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	local knobTween = TweenService:Create(Knob, tweenInfo, goal1)
	local fillTween = TweenService:Create(Fill, tweenInfo, goal2)

	knobTween:Play()
	fillTween:Play()
end

local function setPressed(isPressed)
	if not KnobScale then return end
	local tweenInfo = TweenInfo.new(SLIDER_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	local pressTween = TweenService:Create(KnobScale, tweenInfo, isPressed and knobGoal1 or knobGoal2)

	pressTween:Play()
end

local function updateFromInput(position)
	if not Track then return end
	local alpha = math.clamp((position.X - Track.AbsolutePosition.X) / Track.AbsoluteSize.X, 0, 1)
	local value = MIN_ROUNDS + math.round(alpha * (MAX_ROUNDS - MIN_ROUNDS))
	if value ~= chosenRounds then
		setRounds(value)
	end
end

local function placeRounds()
	if isCustomRounds then return end

	local codePosition, codeSize = CodeImage.AbsolutePosition - Lobby.AbsolutePosition, CodeImage.AbsoluteSize
	local top = codePosition.Y + codeSize.Y + SLIDER_GAP
	if top + SLIDER_HEIGHT > Lobby.AbsoluteSize.Y then
		top = codePosition.Y - SLIDER_GAP - SLIDER_HEIGHT -- no room under the code, so go above it
	end

	Rounds.Size = UDim2.fromOffset(math.clamp(codeSize.X, SLIDER_MIN_WIDTH, SLIDER_MAX_WIDTH), SLIDER_HEIGHT)
	Rounds.Position = UDim2.fromOffset(codePosition.X + codeSize.X / 2, top)
end

local function createRow(name, tokens, order)
	local Row = Instance.new("Frame")
	Row.Name = "Row"
	Row.Size = UDim2.new(1, -8, 0, ROW_HEIGHT) -- leaves room for the scroll bar
	Row.BackgroundColor3, Row.BorderSizePixel, Row.LayoutOrder = ROW_COLOR, 0, order
	addCorner(Row, UDim.new(0, 8))
	addStroke(Row, 2)

	local Name = createText("Name", name, 18, TEXT_COLOR) -- Nunito, the rest of the list keeps the code label's font
	Name.Position = UDim2.fromOffset(10, 0)
	Name.Size = UDim2.new(0.7, -10, 1, 0)
	Name.Parent = Row

	local Tokens = createText("Tokens", tostring(tokens), 16, MUTED_TEXT_COLOR, Enum.TextXAlignment.Right, LIST_FONT)
	Tokens.AnchorPoint = Vector2.new(1, 0)
	Tokens.Position = UDim2.new(1, -10, 0, 0)
	Tokens.Size = UDim2.new(0.3, 0, 1, 0)
	Tokens.Parent = Row

	Row.Parent = List
	return Row
end

local function getSpectators()
	local success, spectators = pcall(HttpService.JSONDecode, HttpService, ReplicatedStorage:GetAttribute("SpectatorList") or "[]")
	return (success and type(spectators) == "table") and spectators or {}
end

local function updateSpectators()
	if not (Header and List and Empty) then return end
	local spectators = getSpectators()
	local seenNames = {}
	local hasNewSpectator = false

	for _, child in List:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end

	for index, spectator in spectators do
		local entry = type(spectator) == "table" and spectator or {}
		local name = tostring(entry.username or FALLBACK_NAME)
		local Row = createRow(name, tonumber(entry.tokenBalance) or 0, index)
		if isShown and not knownNames[name] then
			popIn(Row) -- only new spectators pop in
			hasNewSpectator = true
		end
		seenNames[name] = true
	end

	knownNames = seenNames
	if hasNewSpectator then
		JoinSound.TimePosition = 0
		JoinSound:Play() -- once per update, even if a few people join at the same moment
	end
	Header.Text = "Spectators (" .. #spectators .. ")"
	Empty.Visible = #spectators == 0
end

local function getClickPosition(inputObject)
	if inputObject and inputObject.Position.Magnitude > 0 then
		return Vector2.new(inputObject.Position.X, inputObject.Position.Y) + GuiService:GetGuiInset() -- input positions start below the top bar
	end

	local inset = Lobby.IgnoreGuiInset and Vector2.zero or GuiService:GetGuiInset()
	return Start.AbsolutePosition + Start.AbsoluteSize / 2 + inset
end

local function placeStrip(bar) -- scrolling right starts a full set to the left, so the strip still covers the bar
	local offset = math.round(bar.offset) -- whole pixels, so every frame moves the same amount
	bar.Strip.Position = UDim2.fromOffset(bar.direction < 0 and -offset or offset - bar.setWidth, 0)
end

local function buildStrip(bar) -- enough copies of the icons to cover the bar, plus one so the loop never shows a gap
	local Template = bar.Template
	if not Template then return end
	local iconSize, barWidth = Template.AbsoluteSize, bar.IconBar.AbsoluteSize.X
	if iconSize.X <= 0 or barWidth <= 0 then return end -- not laid out yet, tries again once the bar has a size

	local step = math.round(iconSize.X + ICON_GAP) -- whole pixels so the loop point lines up exactly
	bar.setWidth = #ICON_IDS * step
	local copies = math.ceil(barWidth / bar.setWidth) + 1

	if bar.Strip then
		bar.Strip:Destroy()
	end
	local Strip = Instance.new("Frame")
	Strip.Name = "Strip"
	Strip.BackgroundTransparency = 1
	Strip.Size = UDim2.new(0, bar.setWidth * copies, 1, 0)

	for copy = 0, copies - 1 do
		for index, id in bar.ids do
			local ScrollingIcon = Template:Clone()
			ScrollingIcon.Name = "ScrollingIcon"
			ScrollingIcon.Image = "rbxassetid://" .. id
			ScrollingIcon.Position = UDim2.new(0, (copy * #ICON_IDS + index - 1) * step + ICON_GAP / 2, Template.Position.Y.Scale, Template.Position.Y.Offset)
			ScrollingIcon.Size = UDim2.fromOffset(iconSize.X, iconSize.Y)
			ScrollingIcon.Visible = true
			ScrollingIcon.Parent = Strip
		end
	end

	bar.Strip = Strip
	bar.offset %= bar.setWidth
	placeStrip(bar)
	Strip.Parent = bar.IconBar
end

local function buildStrips()
	for _, bar in iconBars do
		buildStrip(bar)
	end
end

local function getDirection(group)
	local element = group.elements[1]
	if group.direction ~= "nearest" or not element then
		return group.direction
	end

	local center = element.AbsolutePosition.Y - Lobby.AbsolutePosition.Y + element.AbsoluteSize.Y / 2
	return center > Lobby.AbsoluteSize.Y / 2 and "bottom" or "top"
end

local function getExitOffset(group)
	local screenSize = Lobby.AbsoluteSize
	local direction = getDirection(group)
	local distance = 0
	for _, element in group.elements do -- grouped elements travel the same distance so they stay together
		local position, size = element.AbsolutePosition - Lobby.AbsolutePosition, element.AbsoluteSize
		if direction == "top" then
			distance = math.max(distance, position.Y + size.Y)
		elseif direction == "bottom" then
			distance = math.max(distance, screenSize.Y - position.Y)
		elseif direction == "left" then
			distance = math.max(distance, position.X + size.X)
		else
			distance = math.max(distance, screenSize.X - position.X)
		end
	end

	distance += EXIT_MARGIN
	if direction == "top" then
		return UDim2.fromOffset(0, -distance)
	elseif direction == "bottom" then
		return UDim2.fromOffset(0, distance)
	elseif direction == "left" then
		return UDim2.fromOffset(-distance, 0)
	end
	return UDim2.fromOffset(distance, 0)
end

local function resetPositions()
	for element, position in homePositions do
		element.Position = position
	end
end

local function leaveLobby()
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

local function animateStart()
	local size = Start.Size
	local startGoal2 = {Size = UDim2.new(size.X.Scale * START_PULSE_SCALE, size.X.Offset * START_PULSE_SCALE, size.Y.Scale * START_PULSE_SCALE, size.Y.Offset * START_PULSE_SCALE)} -- pulses Size since its UIScale handles the pop in and hover

	local tweenInfo1 = TweenInfo.new(START_SWAY_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
	local tweenInfo2 = TweenInfo.new(START_PULSE_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)

	Start.Rotation = -START_SWAY_ANGLE -- start on one side so it sways evenly both ways

	local startTween1 = TweenService:Create(Start, tweenInfo1, startGoal1)
	local startTween2 = TweenService:Create(Start, tweenInfo2, startGoal2)

	startTween1:Play()
	startTween2:Play()
end

local function playMusic(Music) -- crossfades into Music, or into silence when it's nil
	if currentMusic == Music then return end
	local Previous = currentMusic
	currentMusic = Music

	local tweenInfo = TweenInfo.new(MUSIC_FADE_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	if Previous then
		local fadeOutTween = TweenService:Create(Previous, tweenInfo, musicGoal2)

		fadeOutTween:Play()
		fadeOutTween.Completed:Connect(function(playbackState)
			if playbackState == Enum.PlaybackState.Completed and currentMusic ~= Previous then
				Previous:Stop()
			end
		end)
	end

	if Music then
		if not Music.IsPlaying then
			Music.TimePosition = 0
			Music:Play()
		end
		local fadeInTween = TweenService:Create(Music, tweenInfo, musicGoal1)

		fadeInTween:Play()
	end
end

local function updateMusic()
	local roundState = ReplicatedStorage:GetAttribute("RoundState")
	if roundState == "lobby" then
		if not isLeaving then -- Start already switched to the round music
			playMusic(LobbyMusic)
		end
	elseif roundState == nil or roundState == "menu" then
		playMusic(LobbyMusic) -- the main menu shares the lobby track, so it keeps playing from Play into the lobby
	else
		playMusic(RoundMusic)
	end
end

local function updateCode()
	local code = ReplicatedStorage:GetAttribute("SessionCode")
	Code.Text = (code and code ~= "") and string.format(CODE_FORMAT, code) or NO_CODE
end

local function updateStart()
	local isHost = ReplicatedStorage:GetAttribute("HostUserId") == player.UserId
	Rounds.Visible = isHost -- only the host picks the round count
	if Start then
		Start.Visible = isHost
	end
end

local function updateLobby()
	local inLobby = ReplicatedStorage:GetAttribute("RoundState") == "lobby"
	if inLobby == isShown then return end
	isShown = inLobby
	showId += 1

	if not inLobby then
		Lobby.Enabled = false
		return
	end

	local id = showId
	isLeaving = false
	resetPositions()
	player:SetAttribute("LeavingLobby", false)
	updateCode()
	updateStart()
	updateSpectators()
	setRounds(MIN_ROUNDS, true)
	task.delay(SHOW_DELAY, function()
		if id ~= showId then return end -- left the lobby before the cover finished
		Lobby.Enabled = true
		placeRounds()
		buildStrips()
		playPop() -- once for the whole group, not per element
		for index, element in popElements do
			popIn(element, (index - 1) * POP_STAGGER)
		end
	end)
end

if Start then
	Start.Activated:Connect(function(inputObject)
		if isLeaving then return end
		isLeaving, isDragging = true, false
		Woosh:Play()
		player:SetAttribute("UncoverPosition", getClickPosition(inputObject)) -- the cover shrinks back into the Start button
		player:SetAttribute("LeavingLobby", true) -- the menu script sends the logo up too
		leaveLobby()
		playMusic(RoundMusic) -- fades in with the transition

		local id = showId
		task.delay(EXIT_TIME, function()
			StartGame:FireServer(chosenRounds)
		end)
		task.delay(EXIT_TIME + LEAVE_TIMEOUT, function()
			if id == showId and isShown and isLeaving then -- the game never started, so bring the lobby back
				isLeaving = false
				resetPositions()
				player:SetAttribute("LeavingLobby", false)
				playMusic(LobbyMusic)
				playPop() -- once for the whole group, not per element
				for index, element in popElements do
					popIn(element, (index - 1) * POP_STAGGER)
				end
			end
		end)
	end)
end

if Hitbox then
	Hitbox.InputBegan:Connect(function(inputObject)
		local inputType = inputObject.UserInputType
		if isLeaving or (inputType ~= Enum.UserInputType.MouseButton1 and inputType ~= Enum.UserInputType.Touch) then
			return
		end
		isDragging = true
		setPressed(true)
		updateFromInput(inputObject.Position)
	end)
end

UserInputService.InputChanged:Connect(function(inputObject)
	local inputType = inputObject.UserInputType
	if isDragging and (inputType == Enum.UserInputType.MouseMovement or inputType == Enum.UserInputType.Touch) then
		updateFromInput(inputObject.Position)
	end
end)

UserInputService.InputEnded:Connect(function(inputObject)
	local inputType = inputObject.UserInputType
	if isDragging and (inputType == Enum.UserInputType.MouseButton1 or inputType == Enum.UserInputType.Touch) then
		isDragging = false
		setPressed(false)
	end
end)

for _, signal in {CodeImage:GetPropertyChangedSignal("AbsolutePosition"), CodeImage:GetPropertyChangedSignal("AbsoluteSize"), Lobby:GetPropertyChangedSignal("AbsoluteSize")} do
	signal:Connect(placeRounds)
end

for _, bar in iconBars do
	bar.IconBar:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
		buildStrip(bar)
	end)
end
RunService.RenderStepped:Connect(function(deltaTime)
	if not Lobby.Enabled then return end
	local step = ICON_SPEED * math.min(deltaTime, MAX_SCROLL_STEP)
	for _, bar in iconBars do
		if bar.Strip and bar.setWidth > 0 then
			bar.offset = (bar.offset + step) % bar.setWidth -- one full set scrolled looks identical to the start, so it loops seamlessly
			placeStrip(bar)
		end
	end
end)

setRounds(MIN_ROUNDS, true)
Lobby.Enabled = false
ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateLobby)
ReplicatedStorage:GetAttributeChangedSignal("SessionCode"):Connect(updateCode)
ReplicatedStorage:GetAttributeChangedSignal("HostUserId"):Connect(updateStart)
ReplicatedStorage:GetAttributeChangedSignal("SpectatorList"):Connect(updateSpectators)
if Start then
	animateStart()

	local function setStartHovered(isHovered)
		if isLeaving or not isShown then return end -- don't fight the pop in or the exit

		local tweenInfo = TweenInfo.new(HOVER_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)

		local hoverTween = TweenService:Create(getScale(Start), tweenInfo, isHovered and hoverGoal1 or hoverGoal2)

		hoverTween:Play()
	end

	Start.MouseEnter:Connect(function()
		setStartHovered(true)
	end)
	Start.MouseLeave:Connect(function()
		setStartHovered(false)
	end)
end
ReplicatedStorage:GetAttributeChangedSignal("RoundState"):Connect(updateMusic)
updateSpectators()
updateLobby()
updateMusic()
