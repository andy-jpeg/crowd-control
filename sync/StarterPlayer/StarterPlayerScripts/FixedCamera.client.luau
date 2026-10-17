local RunService = game:GetService("RunService")

local cameraPosition, cameraOrientation = Vector3.new(-56.668, 121.263, -46.513), Vector3.new(-52.802, -179.73, 0)
local cameraCFrame = CFrame.new(cameraPosition) * CFrame.fromOrientation(math.rad(cameraOrientation.X), math.rad(cameraOrientation.Y), math.rad(cameraOrientation.Z))

RunService:BindToRenderStep("FixedCamera", Enum.RenderPriority.Camera.Value + 1, function() -- runs after the default camera so it can't override us
	local camera = workspace.CurrentCamera
	if not camera then
		return
	end

	camera.CameraType = Enum.CameraType.Scriptable
	camera.CFrame = cameraCFrame
	camera.FieldOfView = 50
end)
