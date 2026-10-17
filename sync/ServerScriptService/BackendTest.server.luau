local ServerScriptService = game:GetService("ServerScriptService")

local Backend = require(ServerScriptService.Backend)
local EventsModule = require(ServerScriptService.EventsModule)

local POLL_INTERVAL = 3

local success, roomCode = Backend.createRoom()
if not success then
	warn("[BackendTest] createRoom failed")
	return
end

print("[BackendTest] room code: " .. roomCode)

Backend.queueTelemetry({type = "test", message = "backend test started"})

local lastEventId = 0

while true do
	task.wait(POLL_INTERVAL)

	local polled, events = Backend.pollEvents(roomCode, lastEventId)
	if polled then
		for _, event in events do
			print("[BackendTest] event " .. event.id .. ": " .. tostring(event.type))
			lastEventId = math.max(lastEventId, event.id)
			EventsModule:Run(event)
			Backend.queueTelemetry({type = "event_received", eventId = event.id})
		end
	end
end