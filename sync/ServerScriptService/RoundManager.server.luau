local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local TextService = game:GetService("TextService")

local BackendModule = require(ServerScriptService.BackendModule)
local EventsModule = require(ServerScriptService.EventsModule)

local HostSession, StartGame = ReplicatedStorage:WaitForChild("HostSession"), ReplicatedStorage:WaitForChild("StartGame")
local ActionLog = ReplicatedStorage:WaitForChild("ActionLog")

local TOTAL_ROUNDS, ROUND_TIME = 5, 60 -- the backend's ROUND_SECONDS and the website's timer match this
local MIN_ROUNDS, MAX_ROUNDS = 5, 10
local INTERMISSION_TIME, RESULTS_TIME, SESSION_OVER_TIME = 15, 5, 10
local POLL_INTERVAL, CHECK_INTERVAL = 3, 0.1
local FALL_DEPTH = 8 -- studs below the podium top that count as falling off
local SPAWN_SPREAD, SPAWN_HEIGHT, RESPAWN_DELAY = 4, 3.5, 3
local MAX_NAME_LENGTH, FALLBACK_NAME = 20, "A spectator"
local CROWD_TRIGGER, CROWD_NAME = "Spectators", "The crowd" -- voted complex events come from everyone

local random = Random.new()
local roundState = "menu"
local currentRound = 0
local hostPlayer = nil
local lastEventId = 0
local queuedEvents = {}
local filteredNames = {}
local roundPlayers, survivalTimes = {}, {}
local sessionRounds, eventCounts, eventsRun = {}, {}, 0 -- for the ending screen

local function setState(state, duration)
	roundState = state

	ReplicatedStorage:SetAttribute("RoundState", state)
	ReplicatedStorage:SetAttribute("Round", currentRound)
	ReplicatedStorage:SetAttribute("TotalRounds", TOTAL_ROUNDS)
	ReplicatedStorage:SetAttribute("StateEndsAt", duration and workspace:GetServerTimeNow() + duration or 0)
end

local function reportState(duration)
	task.spawn(BackendModule.sendRoundState, {
		round = currentRound,
		totalRounds = TOTAL_ROUNDS,
		state = roundState,
		endsAt = duration and workspace:GetServerTimeNow() + duration or nil,
	})
end

local function filterName(name)
	if type(name) ~= "string" or name == "" or not hostPlayer then
		return FALLBACK_NAME
	end
	if filteredNames[name] then
		return filteredNames[name]
	end

	local success, filtered = pcall(function()
		local result = TextService:FilterStringAsync(string.sub(name, 1, MAX_NAME_LENGTH), hostPlayer.UserId, Enum.TextFilterContext.PublicChat)
		return result:GetNonChatStringForBroadcastAsync()
	end)
	if not success then
		return FALLBACK_NAME
	end

	filteredNames[name] = filtered
	return filtered
end

local function announceEvent(event, delay)
	ActionLog:FireAllClients({
		name = event.triggeredBy == CROWD_TRIGGER and CROWD_NAME or filterName(event.triggeredBy),
		event = EventsModule:GetDisplayName(event.type),
		tier = EventsModule:GetTier(event.type),
		tip = EventsModule:GetTip(event.type),
		delay = delay, -- seconds until it actually starts (complex events wait out the cooldown)
	})
end

local function formatTime(seconds)
	return string.format("%d:%02d", seconds // 60, seconds % 60)
end

local function announceNotice(title, tip) -- round updates in the action log, alongside the events
	ActionLog:FireAllClients({tier = "notice", title = title, tip = tip})
end

local function runEvent(event)
	local ran, delay = EventsModule:Run(event)
	BackendModule.queueTelemetry({type = ran and "event_run" or "event_rejected", eventId = event.id, eventType = event.type, round = currentRound, delay = delay})

	if ran then
		eventsRun += 1
		if type(event.triggeredBy) == "string" then
			eventCounts[event.triggeredBy] = (eventCounts[event.triggeredBy] or 0) + 1
		end
		task.spawn(announceEvent, event, delay) -- filtering yields, so don't hold up the event
	end
end

local function handleEvent(event)
	print("[RoundManager] event " .. event.id .. ": " .. tostring(event.type) .. " from " .. tostring(event.triggeredBy) .. (roundState == "active" and "" or " (held until the round starts)"))

	if roundState == "active" then
		runEvent(event)
	else
		table.insert(queuedEvents, event) -- bought between rounds, so it runs when the next round starts
	end
end

local function getHumanoid(player)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")

	return humanoid and humanoid.Health > 0 and humanoid or nil
end

local function placeOnPodium(player)
	local character, top = player.Character, EventsModule:GetPodiumTop()
	if not character or not top then
		return
	end

	local offset = Vector3.new(random:NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD), SPAWN_HEIGHT, random:NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD))
	character:PivotTo(CFrame.new(top + offset))
end

local function watchCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid")

	humanoid.StateChanged:Connect(function(_, newState)
		if newState == Enum.HumanoidStateType.Swimming then -- touching the water around the podium is a fall
			humanoid.Health = 0
		end
	end)

	humanoid.Died:Connect(function()
		if roundState == "active" then -- dying mid-round means sitting out until the next intermission
			return
		end

		task.delay(RESPAWN_DELAY, function()
			if player.Parent and roundState ~= "active" and not getHumanoid(player) then
				player:LoadCharacter()
			end
		end)
	end)
end

local function setupPlayer(player)
	player.CharacterAdded:Connect(function(character)
		watchCharacter(player, character)
	end)

	if player.Character then
		task.spawn(watchCharacter, player, player.Character)
	end

	player:LoadCharacter()
end

local function getEliminationCause(player, podiumTop)
	if not player.Parent then
		return "left"
	end

	local humanoid = getHumanoid(player)
	if not humanoid then
		return "died"
	end

	local rootPart = humanoid.RootPart
	if podiumTop and rootPart and rootPart.Position.Y < podiumTop.Y - FALL_DEPTH then
		humanoid.Health = 0
		return "fell"
	end

	return nil
end

local function waitForRequest(remote, isAllowed)
	while true do
		local player, arg1 = remote.OnServerEvent:Wait()
		if isAllowed(player, arg1) then
			return player, arg1
		end
	end
end

local function canStart(player)
	return player == hostPlayer or not (hostPlayer and hostPlayer.Parent) -- anyone can start if the host left
end

local function waitForPlayers()
	while #Players:GetPlayers() == 0 do
		Players.PlayerAdded:Wait()
	end
end

local function startSession()
	currentRound, lastEventId, eventsRun = 0, 0, 0
	table.clear(queuedEvents)
	table.clear(filteredNames)
	table.clear(sessionRounds)
	table.clear(eventCounts)
	ReplicatedStorage:SetAttribute("SessionSummary", "")

	local success, code = BackendModule.createSession(TOTAL_ROUNDS)
	if success then
		print("[RoundManager] session started: " .. code .. " (" .. TOTAL_ROUNDS .. " rounds)")
	else
		warn("[RoundManager] couldn't create a session, playing offline")
	end

	ReplicatedStorage:SetAttribute("SessionCode", success and code or "")
	ReplicatedStorage:SetAttribute("SpectatorList", "[]")
	ReplicatedStorage:SetAttribute("SpectatorCount", 0)
end

local function buildSummary()
	local topName, topCount = nil, 0
	for name, count in eventCounts do
		if count > topCount then
			topName, topCount = name, count
		end
	end

	local totalSeconds, bestSeconds, fullRounds = 0, 0, 0
	for _, seconds in sessionRounds do
		totalSeconds += seconds
		bestSeconds = math.max(bestSeconds, seconds)
		if seconds >= ROUND_TIME then
			fullRounds += 1
		end
	end

	return {
		rounds = sessionRounds,
		roundTime = ROUND_TIME,
		totalSeconds = totalSeconds,
		bestSeconds = bestSeconds,
		fullRounds = fullRounds,
		eventsRun = eventsRun,
		spectatorCount = ReplicatedStorage:GetAttribute("SpectatorCount") or 0,
		topSpectator = topName and filterName(topName) or nil,
		topSpectatorEvents = topCount,
	}
end

local function runLobby()
	setState("lobby")
	reportState()

	local _, chosenRounds = waitForRequest(StartGame, canStart)
	if type(chosenRounds) == "number" and chosenRounds == chosenRounds then -- the host picks the round count in the lobby
		TOTAL_ROUNDS = math.clamp(math.floor(chosenRounds), MIN_ROUNDS, MAX_ROUNDS)
	end
	ReplicatedStorage:SetAttribute("TotalRounds", TOTAL_ROUNDS)
	print("[RoundManager] starting " .. TOTAL_ROUNDS .. " rounds")
end

local function runIntermission(duration)
	setState("intermission", duration)
	reportState(duration)
	announceNotice(string.format("Round %d of %d starts in %ds", currentRound, TOTAL_ROUNDS, duration), "Spectators are voting on a big event!")

	for _, player in Players:GetPlayers() do
		task.spawn(function()
			if not getHumanoid(player) then
				player:LoadCharacter()
			end
			placeOnPodium(player)
		end)
	end

	task.wait(duration)
end

local function playRound()
	table.clear(roundPlayers)
	table.clear(survivalTimes)

	for _, player in Players:GetPlayers() do
		if not getHumanoid(player) then -- fell off or died during intermission
			player:LoadCharacter()
		end

		if getHumanoid(player) then
			roundPlayers[player] = true
			placeOnPodium(player)
		end
	end

	local startedAt = os.clock()
	setState("active", ROUND_TIME)
	reportState(ROUND_TIME)
	announceNotice(string.format("Round %d has started!", currentRound), "Survive for " .. formatTime(ROUND_TIME) .. "!")
	BackendModule.queueTelemetry({type = "round_start", round = currentRound})

	local queued = queuedEvents
	queuedEvents = {}
	for _, event in queued do
		runEvent(event)
	end

	local elapsed = 0
	repeat
		task.wait(CHECK_INTERVAL)
		elapsed = math.min(os.clock() - startedAt, ROUND_TIME)

		local podiumTop, anyAlive = EventsModule:GetPodiumTop(), false
		for player in roundPlayers do
			if survivalTimes[player] then
				continue
			end

			local cause = getEliminationCause(player, podiumTop)
			if cause then
				survivalTimes[player] = elapsed
				BackendModule.queueTelemetry({type = "player_eliminated", round = currentRound, userId = player.UserId, cause = cause, survivalSeconds = elapsed})
			else
				anyAlive = true
			end
		end
	until not anyAlive or elapsed >= ROUND_TIME

	local longest = 0
	for player in roundPlayers do
		longest = math.max(longest, survivalTimes[player] or ROUND_TIME)
	end

	return math.floor(longest * 10 + 0.5) / 10
end

local function showResults(survivalSeconds)
	EventsModule:Reset()

	local results = {round = currentRound, survivalSeconds = survivalSeconds, survivedFullRound = survivalSeconds >= ROUND_TIME}

	ReplicatedStorage:SetAttribute("LastSurvivalSeconds", survivalSeconds)
	table.insert(sessionRounds, survivalSeconds)
	setState("results", RESULTS_TIME)
	reportState(RESULTS_TIME)

	task.spawn(BackendModule.sendResults, results)
	BackendModule.queueTelemetry({type = "round_end", round = currentRound, survivalSeconds = survivalSeconds})

	task.wait(RESULTS_TIME)
end

Players.CharacterAutoLoads = false -- the round loop decides when players respawn

Players.PlayerAdded:Connect(setupPlayer)

for _, player in Players:GetPlayers() do
	task.spawn(setupPlayer, player)
end

task.spawn(function()
	while true do
		task.wait(POLL_INTERVAL)

		local code = BackendModule.getSessionCode()
		local polled, events, spectators = BackendModule.pollEvents(lastEventId)

		if polled and code == BackendModule.getSessionCode() then -- skip replies for a session that ended while we waited
			if type(spectators) == "table" then
				local list = {}
				for _, spectator in spectators do
					if type(spectator) == "table" then
						table.insert(list, {username = filterName(spectator.username), tokenBalance = tonumber(spectator.tokenBalance) or 0}) -- names are typed on the website, so they go through the filter
					end
				end
				if code == BackendModule.getSessionCode() then
					if #list ~= ReplicatedStorage:GetAttribute("SpectatorCount") then
						print("[RoundManager] spectators in " .. code .. ": " .. #list)
					end
					ReplicatedStorage:SetAttribute("SpectatorList", HttpService:JSONEncode(list))
					ReplicatedStorage:SetAttribute("SpectatorCount", #list)
				end
			end

			for _, event in events do
				if type(event) == "table" and type(event.id) == "number" and event.id > lastEventId then
					lastEventId = event.id
					handleEvent(event)
				end
			end
		end
	end
end)

while true do
	setState("menu")
	ReplicatedStorage:SetAttribute("SessionCode", "")

	hostPlayer = waitForRequest(HostSession, function()
		return true
	end)
	TOTAL_ROUNDS = MIN_ROUNDS -- the real count comes in with StartGame
	ReplicatedStorage:SetAttribute("TotalRounds", TOTAL_ROUNDS)
	ReplicatedStorage:SetAttribute("HostUserId", hostPlayer.UserId)

	startSession()
	runLobby()

	for round = 1, TOTAL_ROUNDS do
		currentRound = round
		waitForPlayers()

		runIntermission(INTERMISSION_TIME)
		showResults(playRound())
	end

	ReplicatedStorage:SetAttribute("SessionSummary", HttpService:JSONEncode(buildSummary())) -- set before the state so the ending screen has it right away
	setState("sessionOver", SESSION_OVER_TIME)
	BackendModule.endSession()
	task.wait(SESSION_OVER_TIME)
end
