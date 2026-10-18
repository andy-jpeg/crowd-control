import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";
import { Pool, type PoolClient } from "pg";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const sessionCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const sessionTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const usernamePattern = /^[\p{L}\p{N}_-]{1,32}$/u;
const maxTelemetryEvents = 500;
const allowedFrontendOrigins = new Set(
  (process.env.FRONTEND_ORIGINS ?? "https://survivalofthe.fit,https://www.survivalofthe.fit")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
if (process.env.NODE_ENV !== "production") {
  allowedFrontendOrigins.add("http://localhost:5173");
  allowedFrontendOrigins.add("http://127.0.0.1:5173");
}
const complexEventIds = new Set([
  "giant_boulder",
  "floor_is_lava",
  "tornado",
  "blob_fight",
  "tsunami",
  "flood_escape",
  "shrinking_podium"
]);
const timeBrackets = new Set([
  "0:00 - 0:30",
  "0:30 - 1:00",
  "1:00 - 1:30",
  "1:30 - 2:00"
]);
const basicEventIds = new Set([
  "bombs",
  "spring_traps",
  "slime_puddles",
  "banana_peels",
  "inverted_controls",
  "low_gravity",
  "ink_screen"
]);
const lockedEventIds = new Set(["inverted_controls", "low_gravity", "ink_screen"]);
const roundStates = new Set(["lobby", "intermission", "active", "results", "sessionOver"]);

const requireRobloxAuth: RequestHandler = auth({
  issuerBaseURL: "https://dev-m0jsbayhzkudzxmh.us.auth0.com/",
  audience: "https://api.crowdcontrol"
});
const requireMachineToMachineToken: RequestHandler = (req, res, next) => {
  if (req.auth?.payload.gty !== "client-credentials") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};
const requireSpectatorAuth: RequestHandler = auth({
  issuerBaseURL: "https://dev-m0jsbayhzkudzxmh.us.auth0.com/",
  audience: "https://api.crowdcontrol"
});
const requireSpectatorToken: RequestHandler = (req, res, next) => {
  if (!req.auth?.payload.sub || req.auth.payload.gty === "client-credentials") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
};

type JsonObject = Record<string, unknown>;
type SessionRow = { id: string; session_token: string; status: "active" | "ended" };
type SpectatorSession = { id: string; current_round: number; total_rounds: number };
type ResultPlayer = { playerId: string; survivalSeconds: number };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSessionCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase();
  return sessionCodePattern.test(code) ? code : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readAuth0UserId(req: Request, supplied: unknown): string | null {
  const authenticatedId = req.auth?.payload.sub;
  if (typeof authenticatedId !== "string" || authenticatedId.length === 0) return null;
  if (supplied !== undefined && supplied !== authenticatedId) return null;
  return authenticatedId;
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return usernamePattern.test(username) ? username : null;
}

function resultPlayers(value: unknown): ResultPlayer[] | null {
  if (!Array.isArray(value)) return null;
  const players: ResultPlayer[] = [];
  for (const player of value) {
    if (!isJsonObject(player) || typeof player.playerId !== "string" ||
        player.playerId.length === 0 || typeof player.survivalSeconds !== "number" ||
        !Number.isFinite(player.survivalSeconds) || player.survivalSeconds < 0 ||
        player.survivalSeconds > 120) {
      return null;
    }
    players.push({ playerId: player.playerId, survivalSeconds: player.survivalSeconds });
  }
  return players;
}

export function getTimeBracket(survivalSeconds: number, survivedFullRound: boolean): string {
  if (survivedFullRound || survivalSeconds >= 90) return "1:30 - 2:00";
  if (survivalSeconds >= 60) return "1:00 - 1:30";
  if (survivalSeconds >= 30) return "0:30 - 1:00";
  return "0:00 - 0:30";
}

export function getLongestSurvivorIds(players: ResultPlayer[]): Set<string> {
  const longestTime = Math.max(...players.map((player) => player.survivalSeconds));
  return new Set(
    players
      .filter((player) => player.survivalSeconds === longestTime)
      .map((player) => player.playerId)
  );
}

async function getSpectatorSession(
  client: PoolClient,
  code: string
): Promise<SpectatorSession | null> {
  const result = await client.query<SpectatorSession>(
    `SELECT id, current_round, total_rounds FROM sessions
     WHERE session_code = $1 AND status = 'active'
     FOR SHARE`,
    [code]
  );
  return result.rows[0] ?? null;
}

async function getSpectatorProfileId(
  client: Pool | PoolClient,
  auth0UserId: string
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM spectator_profiles WHERE auth0_subject = $1",
    [auth0UserId]
  );
  return result.rows[0]?.id ?? null;
}

function isPgUniqueViolation(error: unknown): boolean {
  return isJsonObject(error) && error.code === "23505";
}

function readSessionIdentity(req: Request): { code: string; token: string } | null {
  const code = normalizeSessionCode(req.params.code);
  const token = req.get("X-Session-Token");
  if (!code || !token || !sessionTokenPattern.test(token)) return null;
  return { code, token };
}

async function findActiveSession(
  client: Pool | PoolClient,
  code: string,
  token: string
): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `SELECT id, session_token, status FROM sessions
     WHERE session_code = $1 AND session_token = $2 AND status = 'active'
     FOR SHARE`,
    [code, token]
  );
  return result.rows[0] ?? null;
}

async function findSession(
  client: Pool | PoolClient,
  code: string,
  token: string
): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `SELECT id, session_token, status FROM sessions
     WHERE session_code = $1 AND session_token = $2
     FOR UPDATE`,
    [code, token]
  );
  return result.rows[0] ?? null;
}

async function settleRoundPredictions(
  client: PoolClient,
  sessionId: string,
  roundNumber: number,
  body: JsonObject,
  players: ResultPlayer[] | undefined
) {
  const multiPlayerRound = players !== undefined && players.length > 1;
  const multiPlayerPlayers = multiPlayerRound ? players : [];
  const survivalSeconds = typeof body.survivalSeconds === "number"
    ? body.survivalSeconds
    : players?.[0]?.survivalSeconds;
  const survivedFullRound = body.survivedFullRound === true;
  const bracket = multiPlayerRound || survivalSeconds === undefined
    ? null
    : getTimeBracket(survivalSeconds, survivedFullRound);
  const longestPlayerIds = multiPlayerRound
    ? getLongestSurvivorIds(multiPlayerPlayers)
    : new Set<string>();

  const predictions = await client.query<{
    id: string;
    spectator_id: string;
    prediction_type: "time_bracket" | "player";
    predicted_value: string;
  }>(
    `SELECT id, spectator_id, prediction_type, predicted_value
     FROM spectator_predictions
     WHERE session_id = $1 AND round_number = $2 AND settled = false
     FOR UPDATE`,
    [sessionId, roundNumber]
  );

  for (const prediction of predictions.rows) {
    const won = prediction.prediction_type === "time_bracket"
      ? prediction.predicted_value === bracket
      : multiPlayerRound && longestPlayerIds.has(prediction.predicted_value);

    if (won) {
      const reward = await client.query(
        `INSERT INTO token_ledger (membership_id, delta, reason, idempotency_key)
         SELECT id, 50, 'prediction_reward', $3
         FROM session_memberships
         WHERE session_id = $1 AND spectator_id = $2
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          sessionId,
          prediction.spectator_id,
          `pred-reward:${sessionId}:${roundNumber}:${prediction.spectator_id}`
        ]
      );
      if (reward.rowCount !== 1) {
        const priorReward = await client.query(
          "SELECT 1 FROM token_ledger WHERE idempotency_key = $1",
          [`pred-reward:${sessionId}:${roundNumber}:${prediction.spectator_id}`]
        );
        if (!priorReward.rowCount) {
          throw new Error("Winning spectator has no session membership for prediction reward");
        }
      }
    }
    await client.query(
      `UPDATE spectator_predictions SET settled = true, won = $2 WHERE id = $1`,
      [prediction.id, won]
    );
  }
}


type WatchedSession = {
  id: string;
  current_round: number;
  round_state: string | null;
  round_ends_at: number | string | null;
};

const ROUND_SECONDS = 120;
const WATCH_REWARD_TOKENS = 30;
const WATCH_REWARD_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_REWARDS = 3; // at 0:30, 1:00 and 1:30 into the round

export function watchRewardKeys(session: WatchedSession, membershipId: string, nowSeconds: number) {
  if (session.round_state !== "active") return [];
  const round = session.current_round;
  const rewards = [{ reason: "round_reward", key: `round-reward:${session.id}:${round}:${membershipId}` }];
  if (session.round_ends_at !== null && session.round_ends_at !== undefined) {
    const remaining = Math.max(0, Number(session.round_ends_at) - nowSeconds);
    const intervals = Math.min(MAX_INTERVAL_REWARDS, Math.floor((ROUND_SECONDS - remaining) / WATCH_REWARD_INTERVAL_SECONDS));
    for (let interval = 1; interval <= intervals; interval++) {
      rewards.push({ reason: "interval_reward", key: `interval-reward:${session.id}:${round}:${interval}:${membershipId}` });
    }
  }
  return rewards;
}

async function grantWatchRewards(client: PoolClient, session: WatchedSession, membershipId: string) {
  const rewards = watchRewardKeys(session, membershipId, Date.now() / 1000);
  if (rewards.length === 0) return;
  // the idempotency keys make every reward pay out once, however often the spectator polls
  await client.query(
    `INSERT INTO token_ledger (membership_id, delta, reason, idempotency_key)
     SELECT $1::bigint, $2::bigint, reward.reason, reward.key
     FROM unnest($3::text[], $4::text[]) AS reward(reason, key)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [membershipId, WATCH_REWARD_TOKENS, rewards.map((reward) => reward.reason), rewards.map((reward) => reward.key)]
  );
}

export function createApp(
  pool: Pool,
  sessionAuth: RequestHandler = requireRobloxAuth,
  machineToMachineAuth: RequestHandler = requireMachineToMachineToken,
  spectatorAuth: RequestHandler = requireSpectatorAuth,
  spectatorTokenCheck: RequestHandler = requireSpectatorToken
) {
  const app = express();
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin && !allowedFrontendOrigins.has(origin)) {
      res.status(403).json({ error: "Origin is not allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_req, res) => {
    res.send("Crowd Control backend is running!");
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "crowd-control-backend"
    });
  });

  const sessions = express.Router();
  sessions.use(sessionAuth, machineToMachineAuth);

  sessions.post("/", async (req, res, next) => {
    const body: unknown = req.body;
    if (!isJsonObject(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    const sessionCode = normalizeSessionCode(body.sessionId);
    if (!sessionCode || typeof body.jobId !== "string" || body.jobId.length > 200 ||
        !isNonNegativeInteger(body.placeId)) {
      res.status(400).json({ error: "sessionId, jobId, or placeId is invalid" });
      return;
    }

    const rawTotalRounds = body.totalRounds ?? 5;
    if (!Number.isInteger(rawTotalRounds) || Number(rawTotalRounds) < 5 || Number(rawTotalRounds) > 10) {
      res.status(400).json({ error: "totalRounds must be an integer between 5 and 10" });
      return;
    }
    const totalRounds = Number(rawTotalRounds);

    const sessionToken = randomUUID();
    try {
      await pool.query(
        `INSERT INTO sessions (session_code, session_token, job_id, place_id, total_rounds)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionCode, sessionToken, body.jobId, body.placeId, totalRounds]
      );
      res.status(201).json({ sessionId: sessionCode, sessionToken, totalRounds });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        if (body.jobId !== "") {
          const existing = await pool.query(
            `SELECT job_id, place_id, session_token, total_rounds FROM sessions
             WHERE session_code = $1 AND status = 'active'`,
            [sessionCode]
          );
          if (existing.rows[0]?.job_id === body.jobId &&
              String(existing.rows[0]?.place_id) === String(body.placeId)) {
            res.status(201).json({
              sessionId: sessionCode,
              sessionToken: existing.rows[0].session_token,
              totalRounds: Number(existing.rows[0].total_rounds),
              duplicate: true
            });
            return;
          }
        }
        res.status(409).json({ error: "An active session already uses this code" });
        return;
      }
      next(error);
    }
  });

  sessions.get("/:code/events", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    const sinceRaw = req.query.since;
    const since = sinceRaw === undefined ? "0" : sinceRaw;
    if (!identity || typeof since !== "string" || !/^\d+$/.test(since) || !Number.isSafeInteger(Number(since))) {
      res.status(400).json({ error: "Session code or since cursor is invalid" });
      return;
    }

    try {
      const session = await findActiveSession(pool, identity.code, identity.token);
      if (!session) {
        res.status(404).json({ error: "Active session not found" });
        return;
      }
      const [eventsResult, spectatorsResult] = await Promise.all([
        pool.query(
          `SELECT id::double precision AS id, event_type AS type,
                  triggered_by AS "triggeredBy", params
           FROM event_commands
           WHERE session_id = $1 AND id > $2
           ORDER BY id ASC`,
          [session.id, since]
        ),
        pool.query<{ username: string; tokenBalance: string }>(
          `SELECT p.username, m.token_balance AS "tokenBalance"
           FROM session_memberships m
           JOIN spectator_profiles p ON p.id = m.spectator_id
           WHERE m.session_id = $1
           ORDER BY m.token_balance DESC, m.joined_at ASC`,
          [session.id]
        )
      ]);
      res.json({
        events: eventsResult.rows,
        spectators: spectatorsResult.rows.map((row) => ({
          username: row.username,
          tokenBalance: Number(row.tokenBalance)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  sessions.get("/:code/spectators", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    if (!identity) {
      res.status(400).json({ error: "Invalid session code or session token" });
      return;
    }
    try {
      const session = await findActiveSession(pool, identity.code, identity.token);
      if (!session) {
        res.status(404).json({ error: "Active session not found" });
        return;
      }
      const result = await pool.query<{ username: string; tokenBalance: string }>(
        `SELECT p.username, m.token_balance AS "tokenBalance"
         FROM session_memberships m
         JOIN spectator_profiles p ON p.id = m.spectator_id
         WHERE m.session_id = $1
         ORDER BY m.token_balance DESC, m.joined_at ASC`,
        [session.id]
      );
      res.json({
        spectators: result.rows.map((row) => ({
          username: row.username,
          tokenBalance: Number(row.tokenBalance)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  sessions.post("/:code/telemetry", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    const body: unknown = req.body;
    if (!identity || !isJsonObject(body) || !Array.isArray(body.events) ||
        body.events.length === 0 || body.events.length > maxTelemetryEvents) {
      res.status(400).json({ error: `Expected 1-${maxTelemetryEvents} telemetry events` });
      return;
    }

    const events = body.events;
    for (const event of events) {
      if (!isJsonObject(event) || typeof event.type !== "string" ||
          event.type.length === 0 || event.type.length > 100 ||
          typeof event.at !== "number" || !Number.isFinite(event.at) || event.at < 0 ||
          (event.eventId !== undefined && !isNonNegativeInteger(event.eventId))) {
        res.status(400).json({ error: "Each telemetry event needs a type and Unix timestamp" });
        return;
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await findActiveSession(client, identity.code, identity.token);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }

      let stored = 0;
      for (const event of events) {
        const result = await client.query(
          `INSERT INTO telemetry_events (session_id, event_type, event_id, occurred_at, payload)
           VALUES ($1, $2, $3, to_timestamp($4), $5::jsonb)
           ON CONFLICT (session_id, event_type, event_id)
             WHERE event_id IS NOT NULL
             DO NOTHING`,
          [session.id, event.type, event.eventId ?? null, event.at, JSON.stringify(event)]
        );
        stored += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      res.status(202).json({ accepted: events.length, stored });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] telemetry rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  sessions.post("/:code/round", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    const body: unknown = req.body;
    if (!identity || !isJsonObject(body) || !Number.isInteger(body.round) || Number(body.round) < 0) {
      res.status(400).json({ error: "Expected a valid session code and a round number (0 in the lobby)" });
      return;
    }
    if (body.state !== undefined && (typeof body.state !== "string" || !roundStates.has(body.state))) {
      res.status(400).json({ error: "state must be lobby, intermission, active, results, or sessionOver" });
      return;
    }
    if (body.endsAt !== undefined && body.endsAt !== null &&
        (typeof body.endsAt !== "number" || !Number.isFinite(body.endsAt) || body.endsAt <= 0)) {
      res.status(400).json({ error: "endsAt must be a Unix time in seconds" });
      return;
    }
    if (body.totalRounds !== undefined &&
        (!Number.isInteger(body.totalRounds) || Number(body.totalRounds) < 5 || Number(body.totalRounds) > 10)) {
      res.status(400).json({ error: "totalRounds must be an integer between 5 and 10" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await findActiveSession(client, identity.code, identity.token);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }

      await client.query(
        `UPDATE sessions
         SET current_round = GREATEST(current_round, $2),
             total_rounds = COALESCE($3, total_rounds),
             round_state = COALESCE($4, round_state),
             round_ends_at = CASE WHEN $4::text IS NULL THEN round_ends_at ELSE to_timestamp($5::double precision) END
         WHERE id = $1`,
        [session.id, body.round, body.totalRounds ?? null, body.state ?? null, body.endsAt ?? null]
      );
      await client.query("COMMIT");
      res.json({ ok: true, round: body.round, totalRounds: body.totalRounds });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] round state rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  sessions.post("/:code/results", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    const body: unknown = req.body;
    if (!identity || !isJsonObject(body) || !isPositiveInteger(body.round)) {
      res.status(400).json({ error: "Expected a valid session code and positive round number" });
      return;
    }
    const players = body.players === undefined ? undefined : resultPlayers(body.players);
    const hasPlayerResults = body.players !== undefined;
    if ((hasPlayerResults && (!players || players.length === 0)) ||
        (players && new Set(players.map((player) => player.playerId)).size !== players.length) ||
        (body.survivalSeconds !== undefined &&
          (typeof body.survivalSeconds !== "number" ||
           !Number.isFinite(body.survivalSeconds) ||
           body.survivalSeconds < 0 ||
           body.survivalSeconds > 120)) ||
        (body.survivedFullRound !== undefined && typeof body.survivedFullRound !== "boolean") ||
        ((!players || players.length < 2) && typeof body.survivalSeconds !== "number" &&
          !(players?.length === 1))) {
      res.status(400).json({ error: "Round results need valid survival times or multiple player results" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await findSession(client, identity.code, identity.token);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.status === "ended") {
        const existing = await client.query(
          `SELECT result = $3::jsonb AS same_result
           FROM round_results
           WHERE session_id = $1 AND round_number = $2`,
          [session.id, body.round, JSON.stringify(body)]
        );
        await client.query("COMMIT");
        if (existing.rows[0]?.same_result) {
          res.json({ ok: true, duplicate: true });
        } else if (existing.rowCount) {
          res.status(409).json({ error: "Different results were already recorded for this round" });
        } else {
          res.status(410).json({ error: "Session has ended" });
        }
        return;
      }
      const inserted = await client.query(
        `INSERT INTO round_results (session_id, round_number, result)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (session_id, round_number) DO NOTHING
         RETURNING id`,
        [session.id, body.round, JSON.stringify(body)]
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query(
          `SELECT result = $3::jsonb AS same_result
           FROM round_results
           WHERE session_id = $1 AND round_number = $2`,
          [session.id, body.round, JSON.stringify(body)]
        );
        await client.query("COMMIT");
        if (existing.rows[0]?.same_result) {
          res.json({ ok: true, duplicate: true });
        } else {
          res.status(409).json({ error: "Different results were already recorded for this round" });
        }
        return;
      }
      await settleRoundPredictions(
        client,
        session.id,
        body.round,
        body,
        players ?? undefined
      );
      await client.query(
        "UPDATE sessions SET current_round = GREATEST(current_round, $2) WHERE id = $1",
        [session.id, body.round + 1]
      );
      await client.query("COMMIT");
      res.status(201).json({ ok: true });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] result rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  sessions.post("/:code/end", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    if (!identity) {
      res.status(400).json({ error: "Invalid session code or session token" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<SessionRow>(
        `SELECT id, session_token, status FROM sessions
         WHERE session_code = $1 AND session_token = $2 AND status = 'active'
         FOR UPDATE`,
        [identity.code, identity.token]
      );
      const session = locked.rows[0];
      if (!session) {
        const ended = await client.query<SessionRow>(
          `SELECT id, session_token, status FROM sessions
           WHERE session_code = $1 AND session_token = $2 AND status = 'ended'
           ORDER BY ended_at DESC LIMIT 1
           FOR UPDATE`,
          [identity.code, identity.token]
        );
        await client.query("ROLLBACK");
        if (ended.rows[0]) {
          res.json({ ok: true, alreadyEnded: true });
        } else {
          res.status(404).json({ error: "Active session not found" });
        }
        return;
      }

      await client.query(
        `INSERT INTO token_ledger (membership_id, delta, reason, idempotency_key)
         SELECT id, -token_balance, 'session_reset',
                'session-reset:' || session_id::text || ':' || id::text
         FROM session_memberships
         WHERE session_id = $1 AND token_balance > 0
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [session.id]
      );
      await client.query(
        "UPDATE session_memberships SET token_balance = 0 WHERE session_id = $1",
        [session.id]
      );
      await client.query(
        "UPDATE event_commands SET status = 'expired' WHERE session_id = $1 AND status = 'pending'",
        [session.id]
      );
      await client.query("DELETE FROM event_locks WHERE session_id = $1", [session.id]);
      await client.query(
        "UPDATE sessions SET status = 'ended', ended_at = now() WHERE id = $1",
        [session.id]
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] session-end rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  const apiSessions = express.Router();
  apiSessions.use(spectatorAuth, spectatorTokenCheck);

  apiSessions.post("/:code/join", async (req, res, next) => {
    const code = normalizeSessionCode(req.params.code);
    const body: unknown = req.body;
    if (!code || !isJsonObject(body) || typeof body.auth0UserId !== "string") {
      res.status(400).json({ error: "Expected a valid session code and auth0UserId" });
      return;
    }
    const auth0UserId = readAuth0UserId(req, body.auth0UserId);
    const requestedUsername = body.username === undefined ? null : normalizeUsername(body.username);
    if (!auth0UserId) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }
    if (body.username !== undefined && requestedUsername === null) {
      res.status(400).json({ error: "username must be 1-32 letters, numbers, or underscores" });
      return;
    }

    const username = requestedUsername ?? `spectator_${randomUUID().slice(0, 8)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query<SpectatorSession>(
        `SELECT id, current_round, total_rounds FROM sessions
         WHERE session_code = $1 AND status = 'active'
         FOR SHARE`,
        [code]
      );
      const session = sessionResult.rows[0];
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }

      const profileResult = await client.query<{ id: string; username: string }>(
        `INSERT INTO spectator_profiles (auth0_subject, username)
         VALUES ($1, $2)
         ON CONFLICT (auth0_subject) DO UPDATE
           SET auth0_subject = EXCLUDED.auth0_subject
         RETURNING id, username`,
        [auth0UserId, username]
      );
      const profile = profileResult.rows[0];
      const membership = await client.query<{ id: string }>(
        `INSERT INTO session_memberships (session_id, spectator_id)
         VALUES ($1, $2)
         ON CONFLICT (session_id, spectator_id) DO NOTHING
         RETURNING id`,
        [session.id, profile.id]
      );
      if (membership.rowCount) {
        await client.query(
          `INSERT INTO token_ledger (membership_id, delta, reason, idempotency_key)
           VALUES ($1, 50, 'join_reward', $2)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [membership.rows[0].id, `join-reward:${session.id}:${profile.id}`]
        );
      }
      const balance = await client.query<{ token_balance: string }>(
        "SELECT token_balance FROM session_memberships WHERE session_id = $1 AND spectator_id = $2",
        [session.id, profile.id]
      );
      await client.query("COMMIT");
      res.json({
        sessionId: session.id,
        tokenBalance: Number(balance.rows[0].token_balance),
        username: profile.username,
        currentRound: session.current_round,
        totalRounds: Number(session.total_rounds ?? 5)
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] spectator join rollback failed", rollbackError);
      }
      if (isPgUniqueViolation(error)) {
        res.status(409).json({ error: "Username is already in use" });
        return;
      }
      next(error);
    } finally {
      client.release();
    }
  });

  apiSessions.get("/:code", async (req, res, next) => {
    const code = normalizeSessionCode(req.params.code);
    if (!code) {
      res.status(400).json({ error: "Invalid session code" });
      return;
    }
    const auth0UserId = typeof req.auth?.payload.sub === "string" ? req.auth.payload.sub : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await client.query<WatchedSession & { total_rounds: number; status: string }>(
        `SELECT id, current_round, total_rounds, status, round_state,
                EXTRACT(EPOCH FROM round_ends_at)::double precision AS round_ends_at
         FROM sessions
         WHERE session_code = $1 AND status = 'active'
         FOR SHARE`,
        [code]
      );
      const row = session.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }

      // Spectators earn tokens for watching: this route is polled every few seconds, so rewards are granted here
      let tokenBalance: number | null = null;
      let correctPredictions: number | null = null;
      if (auth0UserId) {
        const membership = await client.query<{ id: string }>(
          `SELECT m.id
           FROM session_memberships m
           JOIN spectator_profiles p ON p.id = m.spectator_id
           WHERE m.session_id = $1 AND p.auth0_subject = $2`,
          [row.id, auth0UserId]
        );
        const membershipId = membership.rows[0]?.id;
        if (membershipId) {
          await grantWatchRewards(client, row, membershipId);
          const stats = await client.query<{ token_balance: string; correct_predictions: string }>(
            `SELECT m.token_balance,
                    (SELECT count(*) FROM spectator_predictions sp
                     WHERE sp.session_id = m.session_id AND sp.spectator_id = m.spectator_id AND sp.won) AS correct_predictions
             FROM session_memberships m
             WHERE m.id = $1`,
            [membershipId]
          );
          tokenBalance = Number(stats.rows[0]?.token_balance ?? 0);
          correctPredictions = Number(stats.rows[0]?.correct_predictions ?? 0);
        }
      }
      await client.query("COMMIT");

      res.json({
        sessionId: row.id,
        currentRound: row.current_round,
        totalRounds: Number(row.total_rounds ?? 5),
        status: row.status,
        roundState: row.round_state ?? "lobby",
        endsAt: row.round_ends_at === null || row.round_ends_at === undefined ? null : Number(row.round_ends_at),
        serverTime: Date.now() / 1000,
        tokenBalance,
        correctPredictions
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] session status rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  apiSessions.post("/:code/vote", async (req, res, next) => {
    const code = normalizeSessionCode(req.params.code);
    const body: unknown = req.body;
    if (!code || !isJsonObject(body) || typeof body.auth0UserId !== "string" ||
        typeof body.eventId !== "string" || !complexEventIds.has(body.eventId) ||
        (body.roundNumber !== undefined && !isPositiveInteger(body.roundNumber))) {
      res.status(400).json({ error: "Invalid session vote request" });
      return;
    }
    const auth0UserId = readAuth0UserId(req, body.auth0UserId);
    if (!auth0UserId) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await getSpectatorSession(client, code);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }
      const roundNumber = body.roundNumber ?? session.current_round;
      if (roundNumber !== session.current_round) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Votes are only accepted for the current round" });
        return;
      }
      const spectatorId = await getSpectatorProfileId(client, auth0UserId);
      if (!spectatorId) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Spectator profile not found; join the session first" });
        return;
      }
      const membership = await client.query(
        "SELECT 1 FROM session_memberships WHERE session_id = $1 AND spectator_id = $2",
        [session.id, spectatorId]
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Join the session before voting" });
        return;
      }
      await client.query(
        `INSERT INTO spectator_votes (session_id, round_number, spectator_id, event_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, round_number, spectator_id)
         DO UPDATE SET event_id = EXCLUDED.event_id, voted_at = now()`,
        [session.id, roundNumber, spectatorId, body.eventId]
      );
      await client.query("COMMIT");
      res.json({ ok: true, eventId: body.eventId });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] spectator vote rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  apiSessions.post("/:code/predict", async (req, res, next) => {
    const code = normalizeSessionCode(req.params.code);
    const body: unknown = req.body;
    if (!code || !isJsonObject(body) || typeof body.auth0UserId !== "string" ||
        (body.type !== "time_bracket" && body.type !== "player") ||
        typeof body.value !== "string" || body.value.length === 0 || body.value.length > 128 ||
        (body.type === "time_bracket" && !timeBrackets.has(body.value)) ||
        (body.roundNumber !== undefined && !isPositiveInteger(body.roundNumber))) {
      res.status(400).json({ error: "Invalid prediction request" });
      return;
    }
    const auth0UserId = readAuth0UserId(req, body.auth0UserId);
    if (!auth0UserId) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await getSpectatorSession(client, code);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }
      const roundNumber = body.roundNumber ?? session.current_round;
      if (roundNumber !== session.current_round) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Predictions are only accepted for the current round" });
        return;
      }
      const spectatorId = await getSpectatorProfileId(client, auth0UserId);
      if (!spectatorId) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Spectator profile not found; join the session first" });
        return;
      }
      const membership = await client.query(
        "SELECT 1 FROM session_memberships WHERE session_id = $1 AND spectator_id = $2",
        [session.id, spectatorId]
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Join the session before predicting" });
        return;
      }
      await client.query(
        `INSERT INTO spectator_predictions
           (session_id, round_number, spectator_id, prediction_type, predicted_value)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, round_number, spectator_id)
         DO UPDATE SET prediction_type = EXCLUDED.prediction_type,
                       predicted_value = EXCLUDED.predicted_value,
                       settled = false,
                       won = NULL,
                       created_at = now()`,
        [session.id, roundNumber, spectatorId, body.type, body.value]
      );
      await client.query("COMMIT");
      res.json({ ok: true, prediction: { type: body.type, value: body.value } });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] spectator prediction rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  apiSessions.post("/:code/purchase", async (req, res, next) => {
    const code = normalizeSessionCode(req.params.code);
    const body: unknown = req.body;
    if (!code || !isJsonObject(body) || typeof body.auth0UserId !== "string" ||
        typeof body.eventType !== "string" || !basicEventIds.has(body.eventType)) {
      res.status(400).json({ error: "Invalid basic event purchase request" });
      return;
    }
    const auth0UserId = readAuth0UserId(req, body.auth0UserId);
    if (!auth0UserId) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const session = await getSpectatorSession(client, code);
      if (!session) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Active session not found" });
        return;
      }
      const spectator = await client.query<{ id: string; username: string; token_balance: string }>(
        `SELECT p.id, p.username, m.token_balance
         FROM spectator_profiles p
         JOIN session_memberships m ON m.spectator_id = p.id
         WHERE p.auth0_subject = $1 AND m.session_id = $2
         FOR UPDATE OF m`,
        [auth0UserId, session.id]
      );
      const profile = spectator.rows[0];
      if (!profile) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Join the session before purchasing an event" });
        return;
      }
      if (Number(profile.token_balance) < 30) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Insufficient tokens" });
        return;
      }

      const command = await client.query<{ id: string }>(
        `INSERT INTO event_commands (session_id, event_type, triggered_by, params, status)
         VALUES ($1, $2, $3, '{}'::jsonb, 'pending')
         RETURNING id`,
        [session.id, body.eventType, profile.username]
      );
      if (lockedEventIds.has(body.eventType)) {
        const lock = await client.query(
          `INSERT INTO event_locks (session_id, event_type, command_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (session_id, event_type) DO NOTHING
           RETURNING id`,
          [session.id, body.eventType, command.rows[0].id]
        );
        if (!lock.rowCount) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "Event is currently active or locked" });
          return;
        }
      }

      const idempotencyKey = `purchase:${session.id}:${profile.id}:${randomUUID()}`;
      const debit = await client.query(
        `INSERT INTO token_ledger (membership_id, delta, reason, idempotency_key)
         SELECT m.id, -30, 'purchase', $3
         FROM session_memberships m
         WHERE m.session_id = $1 AND m.spectator_id = $2 AND m.token_balance >= 30
         RETURNING id`,
        [session.id, profile.id, idempotencyKey]
      );
      if (!debit.rowCount) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Insufficient tokens" });
        return;
      }
      const balance = await client.query<{ token_balance: string }>(
        "SELECT token_balance FROM session_memberships WHERE session_id = $1 AND spectator_id = $2",
        [session.id, profile.id]
      );
      await client.query("COMMIT");
      res.json({
        ok: true,
        eventType: body.eventType,
        tokenBalance: Number(balance.rows[0].token_balance)
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[backend] basic event purchase rollback failed", rollbackError);
      }
      next(error);
    } finally {
      client.release();
    }
  });

  app.use("/api/sessions", apiSessions);

  const profiles = express.Router();
  profiles.use(spectatorAuth, spectatorTokenCheck);
  profiles.get("/me", async (req, res, next) => {
    const requestedId = req.query.auth0UserId ?? req.get("X-Auth0-User-Id");
    if (typeof requestedId !== "string" || !readAuth0UserId(req, requestedId)) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }
    try {
      const result = await pool.query(
        `SELECT auth0_subject AS "auth0UserId", username,
                total_sessions_joined AS "totalSessionsJoined",
                total_tokens_spent AS "totalTokensSpent", created_at AS "createdAt"
         FROM spectator_profiles WHERE auth0_subject = $1`,
        [requestedId]
      );
      if (!result.rowCount) {
        res.status(404).json({ error: "Spectator profile not found" });
        return;
      }
      const profile = result.rows[0];
      res.json({
        ...profile,
        totalSessionsJoined: Number(profile.totalSessionsJoined),
        totalTokensSpent: Number(profile.totalTokensSpent)
      });
    } catch (error) {
      next(error);
    }
  });

  profiles.patch("/me/username", async (req, res, next) => {
    const body: unknown = req.body;
    if (!isJsonObject(body) || typeof body.auth0UserId !== "string") {
      res.status(400).json({ error: "Expected auth0UserId and username" });
      return;
    }
    const auth0UserId = readAuth0UserId(req, body.auth0UserId);
    const username = normalizeUsername(body.username);
    if (!auth0UserId) {
      res.status(403).json({ error: "Authenticated user does not match auth0UserId" });
      return;
    }
    if (!username) {
      res.status(400).json({ error: "username must be 1-32 letters, numbers, or underscores" });
      return;
    }
    try {
      const result = await pool.query(
        `INSERT INTO spectator_profiles (auth0_subject, username)
         VALUES ($1, $2)
         ON CONFLICT (auth0_subject) DO UPDATE SET username = EXCLUDED.username
         RETURNING auth0_subject AS "auth0UserId", username,
                   total_sessions_joined AS "totalSessionsJoined",
                   total_tokens_spent AS "totalTokensSpent", created_at AS "createdAt"`,
        [auth0UserId, username]
      );
      const profile = result.rows[0];
      res.json({
        ...profile,
        totalSessionsJoined: Number(profile.totalSessionsJoined),
        totalTokensSpent: Number(profile.totalTokensSpent)
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        res.status(409).json({ error: "Username is already in use" });
        return;
      }
      next(error);
    }
  });
  app.use("/api/profile", profiles);

  app.use("/sessions", sessions);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isJsonObject(error) && error.type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON request body" });
      return;
    }
    if (isJsonObject(error) && (error.statusCode === 401 || error.status === 401)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (isJsonObject(error) && (error.statusCode === 403 || error.status === 403)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (isJsonObject(error) && error.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
      return;
    }
    console.error("[backend] request failed", error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function startServer() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before starting the backend");
  }
  const pool = new Pool({ connectionString });
  const app = createApp(pool);
  return app.listen(port, host, () => {
    console.log(`Backend running at http://${host}:${port}`);
  });
}

if (require.main === module) {
  void startServer().catch((error: unknown) => {
    console.error("[backend] startup failed", error);
    process.exitCode = 1;
  });
}
