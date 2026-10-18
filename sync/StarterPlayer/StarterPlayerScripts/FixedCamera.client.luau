local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local ShakeScreen = ReplicatedStorage:WaitForChild("ShakeScreen")

local SHAKE_SPEED, SHAKE_FADE_TIME, MAX_SHAKE = 18, 0.4, 0.75 -- MAX_SHAKE is in degrees, so overlapping bombs don't get wild

local cameraPosition, cameraOrientation = Vector3.new(-56.668, 121.263, -46.513), Vector3.new(-52.802, -179.73, 0)
local cameraCFrame = CFrame.new(cameraPosition) * CFrame.fromOrientation(math.rad(cameraOrientation.X), math.rad(cameraOrientation.Y), math.rad(cameraOrientation.Z))

local shakes = {}

local function getShake()
	local now, strength = os.clock(), 0

	for index = #shakes, 1, -1 do
		local shake = shakes[index]
		local timeLeft = shake.endsAt - now

		if timeLeft <= 0 then
			table.remove(shakes, index)
		else
			strength += shake.strength * math.min(1, timeLeft / SHAKE_FADE_TIME) -- holds, then fades out at the end
		end
	end

	if strength <= 0 then
		return CFrame.identity
	end

	local time = now * SHAKE_SPEED
	local angle = math.rad(math.min(strength, MAX_SHAKE)) * 2 -- noise is about -0.5 to 0.5

	return CFrame.Angles(math.noise(time, 0.5) * angle, math.noise(time, 10.5) * angle, math.noise(time, 20.5) * angle / 2)
end

ShakeScreen.OnClientEvent:Connect(function(strength, duration)
	if duration <= 0 then
		table.clear(shakes)
		return
	end

	table.insert(shakes, {strength = strength, endsAt = os.clock() + duration})
end)

RunService:BindToRenderStep("FixedCamera", Enum.RenderPriority.Camera.Value + 1, function() -- runs after the default camera so it can't override us
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end

	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = cameraCFrame * getShake()
	camera.FieldOfView = 50
end)
