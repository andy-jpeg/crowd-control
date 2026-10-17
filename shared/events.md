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

- `id`: increasing number per room, so the game can poll with `since=<last id>` and never run an event twice
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
| `ink_screen` | Squid Ink | Ink splats block the player's screen | `duration` |
| `banana_peels` | Banana Peels | Banana peels appear at random spots on the podium. Stepping on one makes the player fall over (sit), then that peel disappears. Untouched peels disappear after 10 seconds | `count` (1-5, default 3) |
| `spring_traps` | Spring Traps | Coiled springs appear on the podium. Stepping on one launches the player into the air with a small push in a random direction. Springs disappear after 10 seconds | `count` (1-6, default 3) |
| `slime_puddles` | Slime Puddles | Slime puddles appear on the podium and slow the player down while they stand in one. Puddles disappear after 10 seconds | `count` (1-5, default 3) |

## Complex events

| ID | Name | What happens | Params (TBD by the Roblox pair) |
|---|---|---|---|
| `giant_boulder` | Giant Boulder | Boulders roll across the podium one after another for the duration. Each appears at the edge with its path shown, then rolls straight across, damaging anyone it touches | `duration` (15-45s, default 30) |
| `floor_is_lava` | Floor Is Lava | Floor tiles turn to lava | `duration` |
| `shrinking_podium` | Shrinking Podium | The podium shrinks over time | |
| `tornado` | Tornado | A tornado sweeps the arena | `duration` |
| `tsunami` | Tsunami | A house appears in the middle of the podium, the player is teleported near the edge, and the whole podium turns red. After a short warning, a wave sweeps across. The only safe spot is the house roof | |
| `flood_escape` | Flood Escape | Water rises and the player has to climb | |
| `obby_chase` | Obby Chase | An obby appears with something chasing the player | |
| `blob_fight` | Blob Fight | A giant blob spawns and the player fights it with a sword | |

Build order for complex events: `giant_boulder` is built. `floor_is_lava` and `shrinking_podium` next, since they reuse the existing podium. The rest are stretch goals.

## Open items

- Fill in each event's params with ranges and defaults once the Roblox side builds it
- Confirm the server-to-game delivery method (polling `GET /rooms/:code/events?since=<id>` vs. pushing) with the backend
