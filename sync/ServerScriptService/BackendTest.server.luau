local ServerScriptService = game:GetService("ServerScriptService")

local BackendModule = require(ServerScriptService.BackendModule)
local EventsModule = require(ServerScriptService.EventsModule)

BackendModule.checkAuth()

local POLL_INTERVAL = 3

local success, sessionCode = BackendModule.createSession()
if not success then
	warn("[BackendTest] createSession failed")
	return
end

print("[BackendTest] session code: " .. sessionCode)

BackendModule.queueTelemetry({type = "test", message = "backend test started"})

local lastEventId = 0

while true do
	task.wait(POLL_INTERVAL)

	local polled, events = BackendModule.pollEvents(lastEventId)
	if polled then
		for _, event in events do
			print("[BackendTest] event " .. event.id .. ": " .. tostring(event.type))
			lastEventId = math.max(lastEventId, event.id)
			EventsModule:Run(event)
			BackendModule.queueTelemetry({type = "event_received", eventId = event.id})
		end
	end
end