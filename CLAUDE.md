# Crowd Control

A Roblox survival game where a live audience controls the chaos. One player tries to survive each round while spectators on a web app (phones, joined by QR code) bet on how long they'll last, spend tokens to trigger hazards, and submit wildcard suggestions that Gemini turns into real events.

Built for SwampHacks (Overall Prize + Entertainment & Creative Technology tracks).

## Folders

- `sync/`: the Roblox game, synced with Studio through Azul (folders map to services, like `sync/ServerScriptService/`). The Luau style guide is in `.claude/rules/luau.md` and loads automatically when working on `.luau` files
- `web/`: the spectator app (mobile-first)
- `server/`: the backend. Gemini, Auth0, Tiger Data, and the bridge to Roblox. One API, and every caller is authenticated through Auth0 (see Auth0 below)
- `shared/events.md`: the event format both halves agree on. The source of truth for every event type
- `shared/api.md`: the routes and JSON the Roblox server and the backend use to talk to each other

Work inside the folder the task belongs to. Don't change another folder unless the task requires it.

## Game rules

The source of truth for events, prices, and limits is `shared/events.md`. Summary:

- **Single player.** One player per session. Multiplayer is a nice-to-have, not part of the core build
- **Session:** 5 to 10 rounds. Anyone who joins mid-round waits until the next round starts
- **Round:** the player survives for up to 2:00. Before it starts, spectators bet on a survival bracket: 0:00-0:30, 0:30-1:00, 1:00-1:30, 1:30-2:00. Surviving the full 2:00 counts as the 1:30-2:00 bracket
- **Events:** basic events cost 30 tokens, complex events cost 80. Basic events have no per-round limit; complex events are limited to 1 per round, shared across all spectators. Basic events have no cooldown (spectators can spam them); complex events have a 30-second cooldown
- **Tokens (spectators only):** +50 for joining a session, +30 for each round they stay for, +50 for betting the correct bracket. The player doesn't earn or spend tokens

## How the pieces talk

- **Web → server:** spectator actions (bracket bets, token spends, wildcard suggestions)
- **Server → Roblox:** events to run, pushed through Open Cloud MessagingService (or polled by the game)
- **Roblox → server:** round results and gameplay events, sent through HttpService, logged to Tiger Data
- **Gemini:** turns wildcard suggestions into structured events using a JSON schema. It can only pick event types that exist in `shared/events.md`, with numbers clamped to their ranges, and the result still counts against the round's event limits. Gemini also writes the round recap

## Rules

### Events
- Adding or changing an event means updating three places in the same commit: `shared/events.md`, the Luau `EventRegistry` in `sync/`, and the Gemini schema in `server/`
- The Roblox side validates every incoming event and ignores anything malformed instead of erroring

### Content safety
- Never send a spectator's raw suggestion text into the game. The game only shows Gemini's title and announcer line, filtered through `TextService` before display
- Keep Gemini safety settings at their strictest thresholds

### Tokens
- Spectator tokens are points stored in Tiger Data. They have no real value, and there's no blockchain (Solana was dropped)
- Tokens live entirely on the web/server side. The game only ever receives "run event X", never anything about tokens or balances

### Auth0
- Spectators sign in with email only, using Auth0 passwordless (a one-time code or magic link). No passwords. They pick a username after their first sign-in
- A spectator account tracks total sessions joined and overall tokens spent
- Players don't create an account. Their Roblox identity is enough
- Sessions are created by the Roblox game server, not a person: when the player presses Play it generates a 4-letter code, registers it with the backend as the session ID (`shared/api.md`), then shows the code and QR in-game. The game server authenticates as an Auth0 machine-to-machine client, with its client secret in the experience's secrets store
- The moderator panel (approve wildcard suggestions, skip events) requires Auth0 login and the `moderator` role. The server checks permissions on every moderator endpoint, not just the UI

### Secrets
- Never commit keys or tokens. Real values go in `.env` (gitignored). Keep `.env.example` updated with blank values
- Never hardcode a key in a Roblox script. The game reads its Auth0 credentials (`auth0_basic`) from the experience's secrets store

### Files to leave out of git
- `.rbxl` / `.rbxlx` place files. The place lives in Roblox (group-owned, Team Create). Git tracks the scripts Azul syncs out
- `node_modules/`, build output, `.env`

## Priorities

A fun game with a smooth audience loop comes first. If time gets tight, cut in this order: advanced dashboard analytics, then multiplayer, then everything else.

Nice-to-haves, only once the core loop works: multiplayer, then additional complex events beyond the first few.

## Web and server conventions

The web pair adds `web/CLAUDE.md` and `server/CLAUDE.md` with their stack and style.
