---
paths:
  - "sync/**/*.{luau,lua}"
---

# Roblox: Luau style guide

Write Luau the way the existing code in `sync/` is written. When in doubt, open a nearby script and match it.

## Script layout

Order the top of every script in three groups, separated by a blank line:

1. **Services**: always `game:GetService(...)`, never `game.ServiceName`
2. **Elements**: references to instances (RemoteEvents, UI objects, parts, sounds)
3. **Regular variables**: constants, reusable tween goals, state

Then event connections and functions below.

## Naming

- camelCase for locals, functions, tables, and tweens: `tweenInfo`, `screenGoal1`, `paperTween`
- Variables that reference an instance use the instance's exact name: `local Newspaper = script.Parent.Newspaper`
- Avoid numbers in names. Only use them to tell paired variants apart (`vignetteGoal1` / `vignetteGoal2`, `screenTween1` / `screenTween2`)

## Comments

- No comments by default. Code should be readable from names alone
- At most a short trailing comment on a line whose purpose isn't obvious

## Patterns

- Declare related values together on one line when they come as a pair: `local Screen, Vignette = script.Parent.Screen, script.Parent.Vignette`
- Define reusable tween goal tables at the top; build `TweenInfo` inside the function that uses it
- Default easing: `Enum.EasingStyle.Sine, Enum.EasingDirection.Out`
- Connect anonymous functions directly to events: `Remote.OnClientEvent:Connect(function(...) ... end)`
- Optional parameters fall back with `or`: `tweenTime or 1.4`
- Create tweens first, then a blank line, then play them together
- Use `task.wait()`, never `wait()`
- Indent with tabs

## Example

```lua
local TweenService = game:GetService("TweenService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local EventAnnounce = ReplicatedStorage.RemoteEvents.EventAnnounce

local Banner = script.Parent.Banner

local bannerGoal1, bannerGoal2 = {Position = UDim2.fromScale(0.5, 0.1)}, {Position = UDim2.fromScale(0.5, -0.2)}

EventAnnounce.OnClientEvent:Connect(function(title, holdTime)
	local tweenInfo = TweenInfo.new(0.6, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

	Banner.Title.Text = title

	local bannerTween1 = TweenService:Create(Banner, tweenInfo, bannerGoal1)
	bannerTween1:Play()
	bannerTween1.Completed:Wait()

	task.wait(holdTime or 3)

	local bannerTween2 = TweenService:Create(Banner, tweenInfo, bannerGoal2)
	bannerTween2:Play()
end)
```

## Game rules

- Every event the game can run is defined in the `EventRegistry` module and matches `shared/events.md`
- Validate incoming events against the registry: an unknown type, asset, or target gets ignored; numbers get clamped to their ranges
- Any text shown to players that didn't come from us (event titles, announcer lines, player names in banners) goes through `TextService:FilterStringAsync` first
- Animations, sounds, and images are uploaded under the team group, never a personal account

## Azul

- Scripts sync between Studio and `sync/` through Azul. The instance hierarchy lives in Studio
- Edit existing scripts as files here. Azul can't map a brand-new file to Studio ("No mapping found"), so a new Script, LocalScript, or ModuleScript has to be created in Studio first. Write the code, then tell the user exactly what to create in Studio (class, name, parent) before the file can sync
- Don't try to create non-script instances (ScreenGuis, Parts, RemoteEvents) by adding files either. Build UI in a ModuleScript, or ask the user to add the instance in Studio
