# Roblox ↔ backend API

The contract between the Roblox game server (`sync/ServerScriptService/BackendModule.luau`) and the backend (`backend/`). Change both sides in the same commit.

## Basics

- All requests and responses are JSON
- The game server sends `Authorization: Bearer <token>` on every request. The token is an Auth0 machine-to-machine access token the game gets itself (client credentials grant) and refreshes before it expires
  - Auth0 domain: `dev-m0jsbayhzkudzxmh.us.auth0.com`
  - Audience (API identifier): `https://api.crowdcontrol`
  - Verify it with `express-oauth2-jwt-bearer`: `auth({ issuerBaseURL: "https://dev-m0jsbayhzkudzxmh.us.auth0.com/", audience: "https://api.crowdcontrol" })` on every `/sessions` route
  - Missing or invalid token → `401`. The game drops its token and retries once with a fresh one, so don't return `401` for anything else (use `403` for "valid token, not allowed")
- Roblox can't reach `localhost`, so the backend needs a public **HTTPS** URL
- The game retries network errors, `429`, and `5xx` responses a couple of times. It never retries other `4xx` responses

## Session codes

- One Roblox server = one session. The **session ID is the 4-letter code** the Roblox server generates and shows on screen. Spectators type the same code into the web app to join
- Codes are 4 uppercase letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no `I` or `O`, so they can't be misread as `1` or `0`)
- The backend should treat codes as case-insensitive when spectators type them, but store them uppercase

## Routes

### `POST /sessions`: register a new session

Sent when the player presses Play on the main menu. A server can run several sessions in a row (each one ends with `POST /end`), and each gets a new code.

```json
{ "sessionId": "KWPZ", "jobId": "<game.JobId>", "placeId": 123456 }
```

- **201 Created** if the code was free. Body can be empty or echo `{ "sessionId": "KWPZ" }`
- **409 Conflict** if an active session already uses that code. The game picks a new code and tries again (up to 5 times)

`jobId` is an empty string and `placeId` is `0` when testing in Studio without publishing.

### `GET /sessions/:code/events?since=<id>`: poll for events to run

The game polls this every few seconds. Return every event for the session with `id` greater than `since`, oldest first.

```json
{
  "events": [
    { "id": 42, "type": "bombs", "triggeredBy": "username", "params": { "count": 3 } }
  ]
}
```

- `triggeredBy` is the spectator's username, shown in the game's action log ("andy placed Bombs!"). Keep usernames to 20 characters, letters, numbers, and underscores. The game also runs every name through Roblox's text filter before showing it, and shows "A spectator" if it's missing or the filter fails

Event types, params, prices, limits, and cooldowns are defined in `shared/events.md`. The backend enforces all of them before an event is added here.

### `POST /sessions/:code/telemetry`: gameplay events for Tiger Data

Sent in batches every few seconds. `at` is a Unix timestamp in seconds (with decimals) from the Roblox server's clock.

```json
{
  "events": [
    { "type": "event_received", "eventId": 42, "at": 1792214400.25 }
  ]
}
```

Telemetry types will grow as gameplay is built. Store unknown types as-is rather than rejecting them.

### `POST /sessions/:code/round`: round state changed

Sent by `RoundManager` every time the round state changes. Use it to open and close betting, reset the per-round complex event limit, and pay the +30 tokens per round.

```json
{ "round": 3, "totalRounds": 5, "state": "active", "endsAt": 1792214520.0 }
```

- `state` is one of:
  - `"lobby"`: the session was just created and spectators are joining. The host presses Start in the game when they're ready, so there's no `endsAt`
  - `"intermission"`: betting is open, the player is waiting on the podium
  - `"active"`: the 2:00 round is running, spectators can buy events
  - `"results"`: round over, results are on the way
- `endsAt` is the Unix time in seconds when this state ends, so the web app can show a countdown
- Intermissions are 15s. A round is 120s unless the player is eliminated early. Results show for 5s
- Only accept event purchases while `state` is `"active"`. If one slips in late, the game holds it and runs it at the start of the next round

### `POST /sessions/:code/results`: round results

Sent when a round ends. Used to settle bracket bets and pay out tokens.

```json
{ "round": 3, "survivalSeconds": 74.2, "survivedFullRound": false }
```

- `survivalSeconds` is rounded to 0.1s and capped at 120. With more than one player it's the longest survival
- Brackets: `0:00-0:30`, `0:30-1:00`, `1:00-1:30`, `1:30-2:00`. Surviving the full round (`survivedFullRound: true`) counts as the last bracket
- Falling off the podium counts as being eliminated

### `POST /sessions/:code/end`: session over

Sent when the Roblox server shuts down. Mark the session ended so its code can be reused and spectators see that the game is over.

## Status

- Roblox side: built in `BackendModule.luau` (mock mode is on until `BASE_URL` is set)
- Backend side: not built yet
- Round loop: built in `RoundManager.server.luau`
