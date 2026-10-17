local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local InvertControls, InkScreen = ReplicatedStorage:WaitForChild("InvertControls"), ReplicatedStorage:WaitForChild("InkScreen")

local LocalPlayer = Players.LocalPlayer
local PlayerGui = LocalPlayer:WaitForChild("PlayerGui")

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
local INK_START_SCALE, INK_IN_TIME, INK_OUT_TIME = 0.6, 0.35, 0.6

local inkGoal2 = {ImageTransparency = 1}

local isInverted = false
local inkId = 0

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

local function scaleSize(size, factor)
	return UDim2.new(size.X.Scale * factor, size.X.Offset * factor, size.Y.Scale * factor, size.Y.Offset * factor)
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

InkScreen.OnClientEvent:Connect(function(duration)
	inkId += 1
	local thisId = inkId

	local Splatter = PlayerGui:WaitForChild("Splatter")
	local InkStain = Splatter:WaitForChild("InkStain")

	if duration <= 0 then
		Splatter.Enabled = false
		return
	end

	if InkStain:GetAttribute("FullSize") == nil then -- remember the designed look before animating it, once per respawn
		InkStain:SetAttribute("FullSize", InkStain.Size)
		InkStain:SetAttribute("FullTransparency", InkStain.ImageTransparency)
	end

	local inkGoal1 = {Size = InkStain:GetAttribute("FullSize"), ImageTransparency = InkStain:GetAttribute("FullTransparency")}

	InkStain.Size, InkStain.ImageTransparency = scaleSize(inkGoal1.Size, INK_START_SCALE), 1
	Splatter.Enabled = true

	local tweenInfo1 = TweenInfo.new(INK_IN_TIME, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
	local inkTween1 = TweenService:Create(InkStain, tweenInfo1, inkGoal1)
	inkTween1:Play()

	task.wait(INK_IN_TIME + duration)
	if inkId ~= thisId then
		return
	end

	local tweenInfo2 = TweenInfo.new(INK_OUT_TIME, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)
	local inkTween2 = TweenService:Create(InkStain, tweenInfo2, inkGoal2)
	inkTween2:Play()
	inkTween2.Completed:Wait()

	if inkId == thisId then
		Splatter.Enabled = false
	end
end)
