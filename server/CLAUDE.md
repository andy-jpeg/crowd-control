# Server

## Stack

- Node.js 22, TypeScript, Express.
- `shared/events.md` is the canonical event catalog; `shared/api.md` is the reviewed API contract.
- Keep server credentials and Auth0 secrets on the backend. Do not add secrets to source control.

## Simulator boundary

- The Roblox simulator is development-only, in-memory, and must refuse to start when `NODE_ENV=production`.
- Run it only on loopback with `SIMULATOR_ENABLED=true` and a development-only `SIMULATOR_SERVER_TOKEN` of at least 24 characters. Never use a production credential.
- Do not alter deployment, systemd, Nginx, or the deployed `GET /health` implementation from this package.
- Simulator endpoints use separate development credentials and must not be treated as Auth0 or production authentication.
- Keep the simulator API contract-compatible; do not invent behavior for unresolved rules in the root specification.
- Persistence, Auth0, spectator web behavior, real Roblox integration, and production routes are out of scope for the simulator.
- Development-only vote, prediction, and balance controls support in-memory test spectators. The simulator also exercises basic-event purchases, event locks, command acknowledgements, and failure refunds. Production Auth0 validation, spectator identity/eligibility, rewards, and persistence are not implemented.

## Local run

From `server/`, install dependencies, copy `.env.example` to `.env`, set `SIMULATOR_ENABLED=true`, and set a local-only `SIMULATOR_SERVER_TOKEN` of at least 24 characters. Run `npm start` in one terminal and `npm run simulate` in another. The simulator client waits for the 15-second pre-round before exercising the Roblox round endpoints. Run `npm test` for the focused lifecycle and contract tests.
