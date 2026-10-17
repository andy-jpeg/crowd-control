local HttpService = game:GetService("HttpService")

local BASE_URL = ""
local MOCK = true
local AUTH_SECRET_NAME = "backend_token" -- key in the experience secrets store
local MAX_RETRIES, RETRY_BACKOFF = 2, 0.5
local FLUSH_INTERVAL, MAX_QUEUE = 5, 200

local Backend = {}

local random = Random.new()
local authHeader = nil
local roomCode = nil
local telemetryQueue = {}
local isFlushing = false
local mockEventId = 0

local function trimQueue()
	while #telemetryQueue > MAX_QUEUE do
		table.remove(telemetryQueue, 1)
	end
end

local function getAuthHeader()
	if authHeader then
		return authHeader
	end

	local success, secret = pcall(function()
		return HttpService:GetSecret(AUTH_SECRET_NAME)
	end)
	if success then
		authHeader = secret:AddPrefix("Bearer ")
	else
		warn("[Backend] could not read secret " .. AUTH_SECRET_NAME .. ": " .. tostring(secret))
	end

	return authHeader
end

local function mockRoomCode()
	local letters = {}
	for i = 1, 4 do
		letters[i] = string.char(random:NextInteger(65, 90))
	end
	return table.concat(letters)
end

local function mockResponse(method, path)
	if method == "POST" and path == "/rooms" then
		return {code = mockRoomCode()}
	end

	if method == "GET" and string.match(path, "^/rooms/[^/]+/events") then
		local events = {}
		if random:NextNumber() < 0.3 then
			mockEventId += 1
			table.insert(events, {id = mockEventId, type = "low_gravity", triggeredBy = "mock", params = {duration = 10}})
		end
		return {events = events}
	end

	return {ok = true}
end

local function request(method, path, body)
	if MOCK then
		print("[Backend] (mock) " .. method .. " " .. path .. (body and " " .. HttpService:JSONEncode(body) or ""))
		return true, mockResponse(method, path)
	end

	local headers = {["Content-Type"] = "application/json", Authorization = getAuthHeader()}

	local lastError = nil
	for attempt = 1, MAX_RETRIES + 1 do
		local success, result = pcall(function()
			local response = HttpService:RequestAsync({
				Url = BASE_URL .. path,
				Method = method,
				Headers = headers,
				Body = body and HttpService:JSONEncode(body) or nil,
			})

			if not response.Success then
				error(response.StatusCode .. " " .. response.StatusMessage, 0)
			end

			return response.Body ~= "" and HttpService:JSONDecode(response.Body) or {}
		end)

		if success then
			return true, result
		end

		lastError = result
		if attempt <= MAX_RETRIES then
			task.wait(RETRY_BACKOFF * 2 ^ (attempt - 1))
		end
	end

	warn("[Backend] " .. method .. " " .. path .. " failed: " .. tostring(lastError))
	return false, lastError
end

function Backend.get(path)
	return request("GET", path)
end

function Backend.post(path, body)
	return request("POST", path, body or {})
end

function Backend.createRoom()
	local success, data = Backend.post("/rooms")
	if not success or type(data) ~= "table" or type(data.code) ~= "string" then
		return false, data
	end

	roomCode = data.code
	return true, roomCode
end

function Backend.pollEvents(code, sinceId)
	local path = "/rooms/" .. HttpService:UrlEncode(code) .. "/events?since=" .. HttpService:UrlEncode(tostring(sinceId or 0))
	local success, data = Backend.get(path)
	if not success or type(data) ~= "table" or type(data.events) ~= "table" then
		return false, {}
	end

	return true, data.events
end

function Backend.sendResults(code, results)
	return Backend.post("/rooms/" .. HttpService:UrlEncode(code) .. "/results", results)
end

function Backend.queueTelemetry(event)
	table.insert(telemetryQueue, event)
	trimQueue()
end

function Backend.flushTelemetry()
	if isFlushing or not roomCode or #telemetryQueue == 0 then
		return
	end
	isFlushing = true

	local batch = telemetryQueue
	telemetryQueue = {}

	local success = Backend.post("/rooms/" .. HttpService:UrlEncode(roomCode) .. "/telemetry", {events = batch})
	if not success then
		table.move(telemetryQueue, 1, #telemetryQueue, #batch + 1, batch) -- keep failed events ahead of newer ones
		telemetryQueue = batch
		trimQueue()
	end

	isFlushing = false
end

task.spawn(function()
	while true do
		task.wait(FLUSH_INTERVAL)
		Backend.flushTelemetry()
	end
end)

game:BindToClose(function()
	Backend.flushTelemetry()
end)

return Backend
