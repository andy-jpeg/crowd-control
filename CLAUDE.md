# Crowd Control

A Roblox party game where a live audience controls the chaos. Players compete in short rounds while spectators on a web app (phones, joined by QR code) predict outcomes, spend tokens to trigger in-game events, and submit wildcard suggestions that Gemini turns into real events.

Built for SwampHacks (Overall Prize + Entertainment & Creative Technology tracks).

## Folders

- `sync/`: the Roblox game, synced with Studio through Azul (folders map to services, like `sync/ServerScriptService/`). The Luau style guide is in `.claude/rules/luau.md` and loads automatically when working on `.luau` files
- `web/`: the spectator app (mobile-first)
- `server/`: the backend. Gemini, Auth0, Solana, Tiger Data, and the bridge to Roblox. One API, and every caller is authenticated through Auth0 (see Auth0 below)
- `shared/events.md`: the event format both halves agree on. The source of truth for every event type

Work inside the folder the task belongs to. Don't change another folder unless the task requires it.

## How the pieces talk

- **Web → server:** spectator actions (votes, predictions, token spends, wildcard suggestions)
- **Server → Roblox:** events to run, pushed through Open Cloud MessagingService (or polled by the game)
- **Roblox → server:** round results and gameplay events, sent through HttpService, logged to Tiger Data
- **Gemini:** turns wildcard suggestions into structured events using a JSON schema. It can only pick event types, assets, and targets that exist in `shared/events.md`, with numbers clamped to their ranges

## Rules

### Events
- Adding or changing an event means updating three places in the same commit: `shared/events.md`, the Luau `EventRegistry` in `sync/`, and the Gemini schema in `server/`
- The Roblox side validates every incoming event and ignores anything malformed instead of erroring

### Content safety
- Never send a spectator's raw suggestion text into the game. The game only shows Gemini's title and announcer line, filtered through `TextService` before display
- Keep Gemini safety settings at their strictest thresholds

### Solana
- Devnet only. Tokens have no real value
- Tokens and wallets live entirely on the web/server side. The game only ever receives "run event X", never anything about tokens or wallets

### Auth0
- Spectators never need an account. They join a room with a code and get a guest session token
- Spectators can optionally sign in through Auth0 after a round to keep their tokens, stats, and a persistent devnet wallet. Signing in merges their guest session into the account
- Rooms are created by the Roblox game server, not a person: when a server starts it asks the backend for a room code, then shows the code and QR in-game. The game server authenticates as an Auth0 machine-to-machine client, with its client secret in the experience's secrets store
- The moderator panel (approve wildcard suggestions, skip events) requires Auth0 login and the `moderator` role. The server checks permissions on every moderator endpoint, not just the UI

### Secrets
- Never commit keys or tokens. Real values go in `.env` (gitignored). Keep `.env.example` updated with blank values
- Never hardcode a key in a Roblox script. The game reads its backend token from the experience's secrets store

### Files to leave out of git
- `.rbxl` / `.rbxlx` place files. The place lives in Roblox (group-owned, Team Create). Git tracks the scripts Azul syncs out
- `node_modules/`, build output, `.env`

## Priorities

A fun game with a smooth audience loop comes first. If time gets tight, cut in this order: Solana, then advanced dashboard analytics, then everything else.

## Web and server conventions

The web pair adds `web/CLAUDE.md` and `server/CLAUDE.md` with their stack and style.
