local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local InvertControls = ReplicatedStorage:WaitForChild("InvertControls")

local LocalPlayer = Players.LocalPlayer

local KEY_DIRECTIONS = {
	[Enum.KeyCode.W] = Vector3.new(0, 0, -1),
	[Enum.KeyCode.Up] = Vector3.new(0, 0, -1),
	[Enum.KeyCode.S] = Vector3.new(0, 0, 1),
	[Enum.KeyCode.Down] = Vector3.new(0, 0, 1),
	[Enum.KeyCode.A] = Vector3.new(-1, 0, 0),
	[Enum.KeyCode.Left] = Vector3.new(-1, 0, 0),
	[Enum.KeyCode.D] = Vector3.new(1, 0, 0),
	[Enum.KeyCode.Right] = Vector3.new(1, 0, 0),
}

local isInverted = false

local function moveInverted()
	if UserInputService:GetFocusedTextBox() then
		return
	end

	local direction = Vector3.zero
	for keyCode, keyDirection in KEY_DIRECTIONS do
		if UserInputService:IsKeyDown(keyCode) then
			direction += keyDirection
		end
	end

	if direction.Magnitude > 0 then
		direction = direction.Unit
	end

	LocalPlayer:Move(-direction, true)
end

InvertControls.OnClientEvent:Connect(function(inverted)
	if inverted == isInverted then
		return
	end
	isInverted = inverted

	if inverted then
		RunService:BindToRenderStep("InvertedControls", Enum.RenderPriority.Input.Value + 1, moveInverted) -- runs right after the default controls, so this move wins
	else
		RunService:UnbindFromRenderStep("InvertedControls")
	end
end)
