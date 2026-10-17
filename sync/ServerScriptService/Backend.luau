local HttpService = game:GetService("HttpService")

local BASE_URL = ""
local MOCK = true
local MOCK_EVENT_CHANCE = 0 -- chance per poll that mock mode sends a fake low_gravity event; 0 while testing events by hand
local AUTH0_DOMAIN, AUTH0_AUDIENCE = "dev-m0jsbayhzkudzxmh.us.auth0.com", "https://api.crowdcontrol"
local AUTH0_SECRET_NAME = "auth0_basic" -- base64 of clientId:clientSecret, in the experience secrets store
local TOKEN_REFRESH_MARGIN = 60 -- get a new token this many seconds before the old one expires
local CODE_ALPHABET, CODE_LENGTH, MAX_CODE_ATTEMPTS = "ABCDEFGHJKLMNPQRSTUVWXYZ", 4, 5 -- no I or O so codes can't be misread as 1 or 0
local MAX_RETRIES, RETRY_BACKOFF = 2, 0.5
local FLUSH_INTERVAL, MAX_QUEUE = 5, 200

local Backend = {}

local random = Random.new()
local accessToken, tokenExpiresAt, isFetchingToken = nil, 0, false
local sessionCode = nil
local telemetryQueue = {}
local isFlushing = false
local mockEventId = 0

local function trimQueue()
	while #telemetryQueue > MAX_QUEUE do
		table.remove(telemetryQueue, 1)
	end
end

local function fetchAccessToken()
	local success, response = pcall(function()
		return HttpService:RequestAsync({
			Url = "https://" .. AUTH0_DOMAIN .. "/oauth/token",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				Authorization = HttpService:GetSecret(AUTH0_SECRET_NAME):AddPrefix("Basic "),
			},
			Body = HttpService:JSONEncode({grant_type = "client_credentials", audience = AUTH0_AUDIENCE}),
		})
	end)

	if not success or not response.Success then
		warn("[Backend] Auth0 token request failed: " .. (success and response.StatusCode .. " " .. response.Body or tostring(response)))
		return nil
	end

	local data = HttpService:JSONDecode(response.Body)
	accessToken, tokenExpiresAt = data.access_token, os.time() + (data.expires_in or 0)

	return accessToken
end

local function getAccessToken()
	while isFetchingToken do -- another request is already getting a token, so wait for it instead of asking twice
		task.wait()
	end

	if accessToken and os.time() < tokenExpiresAt - TOKEN_REFRESH_MARGIN then
		return accessToken
	end

	isFetchingToken = true
	local token = fetchAccessToken()
	isFetchingToken = false

	return token
end

local function generateCode()
	local letters = {}
	for i = 1, CODE_LENGTH do
		local index = random:NextInteger(1, #CODE_ALPHABET)
		letters[i] = string.sub(CODE_ALPHABET, index, index)
	end

	return table.concat(letters)
end

local function sessionPath(route)
	return "/sessions/" .. HttpService:UrlEncode(sessionCode) .. route
end

local function mockResponse(method, path, body)
	if method == "POST" and path == "/sessions" then
		return 201, {sessionId = body.sessionId}
	end

	if method == "GET" and string.match(path, "^/sessions/[^/]+/events") then
		local events = {}
		if random:NextNumber() < MOCK_EVENT_CHANCE then
			mockEventId += 1
			table.insert(events, {id = mockEventId, type = "low_gravity", triggeredBy = "mock", params = {duration = 10}})
		end
		return 200, {events = events}
	end

	return 200, {ok = true}
end

local function shouldRetry(statusCode)
	return statusCode == nil or statusCode == 429 or statusCode >= 500 -- network errors and server hiccups, never client errors like 409
end

local function request(method, path, body)
	if MOCK then
		print("[Backend] (mock) " .. method .. " " .. path .. (body and " " .. HttpService:JSONEncode(body) or ""))
		local statusCode, data = mockResponse(method, path, body)
		return true, data, statusCode
	end

	local lastError, lastStatus = nil, nil
	for attempt = 1, MAX_RETRIES + 1 do
		local token = getAccessToken()
		if not token then
			return false, "no Auth0 token", nil
		end

		local headers = {["Content-Type"] = "application/json", Authorization = "Bearer " .. token}

		local sent, response = pcall(function()
			return HttpService:RequestAsync({
				Url = BASE_URL .. path,
				Method = method,
				Headers = headers,
				Body = body and HttpService:JSONEncode(body) or nil,
			})
		end)

		if sent and response.Success then
			local decoded, data = pcall(function()
				return response.Body ~= "" and HttpService:JSONDecode(response.Body) or {}
			end)
			return true, decoded and data or {}, response.StatusCode
		end

		lastStatus = sent and response.StatusCode or nil
		lastError = sent and (response.StatusCode .. " " .. response.StatusMessage) or response

		if lastStatus == 401 and attempt == 1 then -- token was rejected, so throw it away and retry once with a fresh one
			accessToken = nil
			continue
		end

		if not shouldRetry(lastStatus) then
			break
		end
		if attempt <= MAX_RETRIES then
			task.wait(RETRY_BACKOFF * 2 ^ (attempt - 1))
		end
	end

	warn("[Backend] " .. method .. " " .. path .. " failed: " .. tostring(lastError))
	return false, lastError, lastStatus
end

function Backend.get(path)
	return request("GET", path)
end

function Backend.post(path, body)
	return request("POST", path, body or {})
end

function Backend.createSession()
	for _ = 1, MAX_CODE_ATTEMPTS do
		local code = generateCode()
		local success, data, statusCode = Backend.post("/sessions", {
			sessionId = code,
			jobId = game.JobId,
			placeId = game.PlaceId,
		})

		if success then
			sessionCode = code
			return true, code
		end

		if statusCode ~= 409 then -- 409 means the code is already taken, so only then try another one
			return false, data
		end
	end

	warn("[Backend] couldn't find a free session code after " .. MAX_CODE_ATTEMPTS .. " tries")
	return false, nil
end

function Backend.checkAuth()
	local token = getAccessToken()
	if token then
		print("[Backend] Auth0 token OK, expires in " .. tokenExpiresAt - os.time() .. "s")
	else
		warn("[Backend] couldn't get an Auth0 token")
	end

	return token ~= nil
end

function Backend.getSessionCode()
	return sessionCode
end

function Backend.pollEvents(sinceId)
	if not sessionCode then
		return false, {}
	end

	local success, data = Backend.get(sessionPath("/events?since=" .. HttpService:UrlEncode(tostring(sinceId or 0))))
	if not success or type(data) ~= "table" or type(data.events) ~= "table" then
		return false, {}
	end

	return true, data.events
end

function Backend.sendResults(results)
	if not sessionCode then
		return false
	end

	return Backend.post(sessionPath("/results"), results)
end

function Backend.queueTelemetry(event)
	event.at = workspace:GetServerTimeNow()

	table.insert(telemetryQueue, event)
	trimQueue()
end

function Backend.flushTelemetry()
	if isFlushing or not sessionCode or #telemetryQueue == 0 then
		return
	end
	isFlushing = true

	local batch = telemetryQueue
	telemetryQueue = {}

	local success = Backend.post(sessionPath("/telemetry"), {events = batch})
	if not success then
		table.move(telemetryQueue, 1, #telemetryQueue, #batch + 1, batch) -- keep failed events ahead of newer ones
		telemetryQueue = batch
		trimQueue()
	end

	isFlushing = false
end

function Backend.endSession()
	if not sessionCode then
		return
	end

	Backend.flushTelemetry()
	Backend.post(sessionPath("/end"))
	sessionCode = nil
end

task.spawn(function()
	while true do
		task.wait(FLUSH_INTERVAL)
		Backend.flushTelemetry()
	end
end)

game:BindToClose(function()
	Backend.endSession()
end)

return Backend
