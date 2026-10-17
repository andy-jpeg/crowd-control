# Events

The source of truth for every event the game can run. Adding or changing an event means updating three places in the same commit: this file, the Luau `EventRegistry` in `sync/`, and the Gemini schema in `server/`.

## Prices and limits

| Tier | Cost | Limit per round | Cooldown |
|---|---|---|---|
| Basic | 30 tokens | No limit | None |
| Complex | 80 tokens | 1 | 30 seconds |

- Basic events have no per-round limit. The complex limit is per round and shared across all spectators: once 1 complex event has fired, no more complex events that round
- A wildcard (Gemini) result counts against the same limits
- Basic events have no cooldown, so spectators can spam them. Complex events have a 30-second cooldown, shared across spectators: after a complex event starts, no other complex event can start for 30 seconds
- The server rejects an event during its tier's cooldown before charging tokens, and the spectator app shows the countdown on the button. As a safety net, the game queues any event that arrives during a cooldown and runs it once the cooldown ends, so paid events are never dropped
- The server enforces prices and limits. The game still validates every event and ignores anything it can't run

## Event message

What the server sends the game for each event to run:

```json
{
  "id": 42,
  "type": "low_gravity",
  "triggeredBy": "username",
  "params": {}
}
```

- `id`: increasing number per session, so the game can poll with `since=<last id>` and never run an event twice
- `type`: one of the IDs below. Unknown types are ignored
- `triggeredBy`: shown in-game ("Low Gravity, triggered by @username") after `TextService` filtering
- `params`: per-event settings. Numbers are clamped to the ranges below. Missing params use the default

For wildcard events, the server adds `title` and `announcer` strings written by Gemini. The game filters both through `TextService` before showing them and never sees the spectator's original text.

## Basic events

| ID | Name | What happens | Params (TBD by the Roblox pair) |
|---|---|---|---|
| `bombs` | Bombs | Bombs drop onto random spots on the podium, flash, then explode | `count` (1-8, default 5) |
| `inverted_controls` | Inverted Controls | W/S and A/D swap. Triggering it again while active restarts the timer | `duration` (3-20s, default 10) |
| `low_gravity` | Low Gravity | Gravity drops | `duration` |
| `ink_screen` | Squid Ink | An ink splat pops onto the player's screen (fades in while growing to full size), stays for the duration, then fades out. Triggering it again restarts the timer | `duration` (2-10s, default 10) |
| `banana_peels` | Banana Peels | Banana peels appear at random spots on the podium. Stepping on one makes the player fall over (sit), then that peel disappears. Untouched peels disappear after 10 seconds | `count` (1-5, default 3) |
| `spring_traps` | Spring Traps | Coiled springs appear on the podium. Stepping on one launches the player into the air with a small push in a random direction. Springs disappear after 10 seconds | `count` (1-6, default 3) |
| `slime_puddles` | Slime Puddles | Slime puddles appear on the podium and slow the player down while they stand in one. Puddles disappear after 10 seconds | `count` (1-5, default 3) |

## Complex events

| ID | Name | What happens | Params (TBD by the Roblox pair) |
|---|---|---|---|
| `giant_boulder` | Giant Boulder | Boulders roll across the podium one after another for the duration. Each appears at the edge with its path shown, then rolls straight across, damaging anyone it touches | `duration` (15-45s, default 30) |
| `floor_is_lava` | Floor Is Lava | 4 stone platforms rise out of the podium while it flashes orange for 3 seconds, then the podium turns to lava (25 damage per second while standing on it). Platforms wobble red and sink one at a time, always leaving one up. Afterward the podium goes back to normal and the last platform sinks | `duration` (5-30s, default 15) |
| `shrinking_podium` | Shrinking Podium | The podium flashes red for 2 seconds, shrinks to 40% of its width over 5 seconds, stays small for the duration, then grows back. Other events spawn on whatever size the podium is at the time | `duration` (5-25s, default 15) |
| `tornado` | Tornado | A red circle marks the podium's center while the tornado (`Assets.Tornado`) drops out of the sky onto it over 2 seconds. It then chases the closest player at 11 studs/s (slower than walking), staying on the podium. Touching it deals 20 damage and flings you away, at most once per second. When the duration ends it lifts back into the sky | `duration` (5-30s, default 15) |
| `tsunami` | Tsunami | A house appears in the middle of the podium, the player is teleported near the edge, and the whole podium turns red. After a short warning, a wave sweeps across. The only safe spot is the house roof | |
| `flood_escape` | Flood Escape | A tight spiral staircase of 7 wooden steps rises out of the podium, on the side facing the camera, while water appears around it. After 3 seconds the water rises (about 14 seconds to the top) and anyone whose head is underwater takes 20 damage per second. Only the top step keeps your head dry. The water holds for 4 seconds, then drains and the steps sink | |
| `obby_chase` | Obby Chase | An obby appears with something chasing the player | |
| `blob_fight` | Blob Fight | Boss fight. A giant slime (`Assets.Slime`, 150 HP with a health bar) drops onto the podium's center and every player gets a sword (`Assets.Sword`). The slime hops after the closest player: it pulses red and turns toward them for 1 second, jumps, and a red circle shows where it will land. Landing deals 35 damage and knocks players back. Swords deal 10 damage per swing when the slime is on the ground. The event only ends when the slime hits 0 HP (or the round ends); then it fades out and the swords are taken away | |

Built complex events: `giant_boulder`, `tsunami`, `shrinking_podium`, `floor_is_lava`, `flood_escape`, `tornado`, `blob_fight`. `obby_chase` is the only one left.

## Open items

- Fill in each event's params with ranges and defaults once the Roblox side builds it
- Routes and request formats between the game and the backend are in `shared/api.md`
