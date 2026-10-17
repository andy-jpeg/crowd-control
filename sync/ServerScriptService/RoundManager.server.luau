local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local TextService = game:GetService("TextService")

local BackendModule = require(ServerScriptService.BackendModule)
local EventsModule = require(ServerScriptService.EventsModule)

local HostSession, StartGame = ReplicatedStorage:WaitForChild("HostSession"), ReplicatedStorage:WaitForChild("StartGame")
local ActionLog = ReplicatedStorage:WaitForChild("ActionLog")

local TOTAL_ROUNDS, ROUND_TIME = 5, 120
local INTERMISSION_TIME, RESULTS_TIME, SESSION_OVER_TIME = 15, 5, 10
local POLL_INTERVAL, CHECK_INTERVAL = 3, 0.1
local FALL_DEPTH = 20 -- studs below the podium top that count as falling off
local SPAWN_SPREAD, SPAWN_HEIGHT = 4, 3.5
local MAX_NAME_LENGTH, FALLBACK_NAME = 20, "A spectator"

local random = Random.new()
local roundState = "menu"
local currentRound = 0
local hostPlayer = nil
local lastEventId = 0
local queuedEvents = {}
local filteredNames = {}
local roundPlayers, survivalTimes = {}, {}

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
	ActionLog:FireAllClients(filterName(event.triggeredBy), EventsModule:GetDisplayName(event.type), delay)
end

local function runEvent(event)
	local ran, delay = EventsModule:Run(event)
	BackendModule.queueTelemetry({type = ran and "event_run" or "event_rejected", eventId = event.id, eventType = event.type, round = currentRound, delay = delay})

	if ran then
		task.spawn(announceEvent, event, delay) -- filtering yields, so don't hold up the event
	end
end

local function handleEvent(event)
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
		local player = remote.OnServerEvent:Wait()
		if isAllowed(player) then
			return player
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
	currentRound, lastEventId = 0, 0
	table.clear(queuedEvents)
	table.clear(filteredNames)

	local success, code = BackendModule.createSession()
	if success then
		print("[RoundManager] session started: " .. code)
	else
		warn("[RoundManager] couldn't create a session, playing offline")
	end

	ReplicatedStorage:SetAttribute("SessionCode", success and code or "")
end

local function runLobby()
	setState("lobby")
	reportState()

	waitForRequest(StartGame, canStart)
end

local function runIntermission(duration)
	setState("intermission", duration)
	reportState(duration)

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
	setState("results", RESULTS_TIME)
	reportState(RESULTS_TIME)

	task.spawn(BackendModule.sendResults, results)
	BackendModule.queueTelemetry({type = "round_end", round = currentRound, survivalSeconds = survivalSeconds})

	task.wait(RESULTS_TIME)
end

Players.CharacterAutoLoads = false -- the round loop decides when players respawn

Players.PlayerAdded:Connect(function(player)
	player:LoadCharacter()
end)

for _, player in Players:GetPlayers() do
	task.spawn(player.LoadCharacter, player)
end

task.spawn(function()
	while true do
		task.wait(POLL_INTERVAL)

		local code = BackendModule.getSessionCode()
		local polled, events = BackendModule.pollEvents(lastEventId)

		if polled and code == BackendModule.getSessionCode() then -- skip replies for a session that ended while we waited
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
	ReplicatedStorage:SetAttribute("HostUserId", hostPlayer.UserId)

	startSession()
	runLobby()

	for round = 1, TOTAL_ROUNDS do
		currentRound = round
		waitForPlayers()

		runIntermission(INTERMISSION_TIME)
		showResults(playRound())
	end

	setState("sessionOver", SESSION_OVER_TIME)
	BackendModule.endSession()
	task.wait(SESSION_OVER_TIME)
end
