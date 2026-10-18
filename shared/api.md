# Roblox ↔ backend API

The contract between the Roblox game server (`sync/ServerScriptService/BackendModule.luau`) and the backend (`backend/`). Change both sides in the same commit.

## Basics

- All requests and responses are JSON
- The game server sends `Authorization: Bearer <token>` on every request. The token is an Auth0 machine-to-machine access token the game gets itself (client credentials grant) and refreshes before it expires
  - Auth0 domain: `dev-m0jsbayhzkudzxmh.us.auth0.com`
  - Audience (API identifier): `https://api.crowdcontrol`
  - Verify it with `express-oauth2-jwt-bearer`: `auth({ issuerBaseURL: "https://dev-m0jsbayhzkudzxmh.us.auth0.com/", audience: "https://api.crowdcontrol" })` on every `/sessions` route
  - Accept only machine-to-machine tokens with the Auth0 `gty: "client-credentials"` claim
  - Missing or invalid token → `401`. The game drops its token and retries once with a fresh one, so don't return `401` for anything else (use `403` for "valid token, not allowed")
- Roblox can't reach `localhost`, so the backend needs a public **HTTPS** URL
- The game retries network errors, `429`, and `5xx` responses a couple of times. It never retries other `4xx` responses
- Roblox `/sessions` routes require a machine-to-machine token. Spectator `/api` routes require a user access token for the same API audience; the backend uses its verified Auth0 `sub` and rejects a supplied `auth0UserId` that does not match it.

## Session codes

- One Roblox server = one session. The **session ID is the 4-letter code** the Roblox server generates and shows on screen. Spectators type the same code into the web app to join
- Codes are 4 uppercase letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no `I` or `O`, so they can't be misread as `1` or `0`)
- The backend should treat codes as case-insensitive when spectators type them, but store them uppercase

## Spectator token accounting

- Spendable token balances are scoped to a session. A spectator starts a new session with 0 tokens, and any remaining balance is cleared when that session ends; balances do not carry between sessions.
- Persist a per-spectator, per-session ledger of token gains and losses, including rewards, purchases, and refunds, so the session's token activity can be reconstructed and restored after an accidental disconnect/rejoin.
- Record session-end balance clearing separately from tokens spent on purchases. Clearing a balance does not count toward lifetime tokens spent.
- Also retain each spectator's lifetime number of sessions joined and lifetime tokens spent across sessions. Count a spectator at most once per session, and update lifetime totals idempotently.
- Use durable writes and idempotency/unique constraints so retries, reconnects, and multiple tabs cannot duplicate token movements or lifetime totals.

## Routes

### `POST /sessions`: register a new session

Sent when the player presses Play on the main menu. A server can run several sessions in a row (each one ends with `POST /end`), and each gets a new code.

```json
{ "sessionId": "KWPZ", "jobId": "<game.JobId>", "placeId": 123456, "totalRounds": 5 }
```

- **201 Created** if the code was free. The response contains `{ "sessionId": "KWPZ", "sessionToken": "<server-only UUID>", "totalRounds": 5 }`
- A retry with the same active code, non-empty `jobId`, and `placeId` returns **201** for the existing session instead of creating a duplicate
- **409 Conflict** if an active session already uses that code. The game picks a new code and tries again (up to 5 times)

`jobId` is an empty string and `placeId` is `0` when testing in Studio without publishing.
The game keeps the returned `sessionToken` private and sends it in `X-Session-Token` on every subsequent request for that session. This prevents delayed requests from an ended session from affecting a later session that reuses the same 4-letter code.

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

Sent in batches every few seconds. `at` is a Unix timestamp in seconds (with decimals) from the Roblox server's clock. Batches are limited to 500 events. Unknown telemetry types are retained. When an event includes `eventId`, retries with the same session, type, and event ID are deduplicated.

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
  - `"active"`: the 1:00 round is running, spectators can buy events
  - `"results"`: round over, results are on the way
- `round` is 0 in the lobby, then 1 through `totalRounds`. The session's current round never goes backward, so a late update can't undo the advance from `/results`
- `endsAt` is the Unix time in seconds when this state ends, so the web app can show a countdown. It's left out in the lobby
- The backend stores `state` and `endsAt` on the session (`round_state`, `round_ends_at`) and hands them to spectators through `GET /api/sessions/:code`
- Intermissions are 15s. A round is 60s unless the player is eliminated early. Results show for 5s
- Only accept event purchases while `state` is `"active"`. If one slips in late, the game holds it and runs it at the start of the next round

### `POST /sessions/:code/results`: round results

Sent when a round ends. Used to settle bracket bets and pay out tokens. The backend stores the authoritative result once per round.

```json
{ "round": 3, "survivalSeconds": 74.2, "survivedFullRound": false }
```

- `survivalSeconds` is rounded to 0.1s and capped at 60. With more than one player it's the longest survival
- Brackets: `0:00 - 0:15`, `0:15 - 0:30`, `0:30 - 0:45`, `0:45 - 1:00`. Surviving the full round (`survivedFullRound: true`) counts as the last bracket
- Falling off the podium counts as being eliminated
- An exact retry returns success without inserting a second result; a conflicting result for the same round returns **409**. Single-player results settle predictions against the non-overlapping time brackets; `survivedFullRound: true` selects the final bracket. Multiplayer results use `players: [{ "playerId": "...", "survivalSeconds": 74.2 }]`; every player tied for maximum survival time is a winning prediction. Each winning spectator receives 50 tokens exactly once in the same transaction as the result.

### `POST /sessions/:code/end`: session over

Sent when the Roblox server shuts down. Mark the session ended so its code can be reused and spectators see that the game is over. The operation is transactional: it clears session balances to 0, records each nonzero clearing in the token ledger as `session_reset` (not lifetime purchase spending), expires pending commands, and releases event locks. A retry with the same session token succeeds idempotently without affecting a later session that reuses the code.

## Status

- Roblox side: built in `BackendModule.luau`, including `X-Session-Token`. Mock mode stays on until the routes below are live
- `POST /sessions/:code/round` is built and stores the round state (needs migration `004_session_round_state.sql`)
- Backend routes and Tiger Data schema are implemented in `backend/`; set `DATABASE_URL` in the ignored local `backend/.env`, then run `npm run migrate` from `backend/` before starting the service
- Round loop: built in `RoundManager.server.luau`

## Spectator API

All spectator routes are under `/api` and require an Auth0 user access token. The `auth0UserId` in a request must match the verified token subject.

- `POST /api/sessions/:code/join` creates/loads the profile and membership, and awards the +50 session-start balance once per membership.
- `GET /api/sessions/:code` returns `{ sessionId, currentRound, totalRounds, status, roundState, endsAt, serverTime }`. `roundState` and `endsAt` are the game's latest report; `serverTime` is the backend's clock in Unix seconds so a phone with a wrong clock can still count down correctly. The web app polls this every 3s while a spectator is in a session, and a 404 means the game ended it.
  - For a joined spectator it also returns `tokenBalance` and `correctPredictions`, and pays watch rewards while the round is `active`: +30 every 7 seconds into it, 0:07 through 0:56 (`interval_reward` in the ledger, each with an idempotency key so polling never pays twice). The +30 round reward is paid to everyone in the session by `POST /sessions/:code/round` when a round (1 or later) is reported. Correct predictions pay +50 when `/results` settles them. The web app no longer adds tokens on its own; it shows the backend's balance.
- `POST /api/sessions/:code/vote` upserts the current-round complex-event vote. Votes are only recorded; the round's winner (most votes, earliest on a tie) is queued once, as `triggeredBy: "Spectators"`, when the game reports the round `active`. A vote that arrives after that queues the winner only if nothing was queued yet. Don't queue per vote: the game picks up every new command right away, so each one would run.
- `POST /api/sessions/:code/predict` upserts the current-round time-bracket or player prediction.
- `GET /api/profile/me?auth0UserId=<Auth0 sub>` returns profile and lifetime totals.
- `PATCH /api/profile/me/username` updates a unique username.

Votes and predictions require the spectator to have joined that session. Round numbers default to the session's current round; requests for a different round are rejected. The session's current round advances after a result is accepted.
