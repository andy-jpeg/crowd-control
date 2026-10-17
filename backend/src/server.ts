import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { auth } from "express-oauth2-jwt-bearer";
import { Pool, type PoolClient } from "pg";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const sessionCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const sessionTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxTelemetryEvents = 500;

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

type JsonObject = Record<string, unknown>;
type SessionRow = { id: string; session_token: string; status: "active" | "ended" };

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
     WHERE session_code = $1 AND session_token = $2 AND status = 'active'`,
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
     WHERE session_code = $1 AND session_token = $2`,
    [code, token]
  );
  return result.rows[0] ?? null;
}

export function createApp(
  pool: Pool,
  sessionAuth: RequestHandler = requireRobloxAuth,
  machineToMachineAuth: RequestHandler = requireMachineToMachineToken
) {
  const app = express();
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

    const sessionToken = randomUUID();
    try {
      await pool.query(
        `INSERT INTO sessions (session_code, session_token, job_id, place_id)
         VALUES ($1, $2, $3, $4)`,
        [sessionCode, sessionToken, body.jobId, body.placeId]
      );
      res.status(201).json({ sessionId: sessionCode, sessionToken });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        if (body.jobId !== "") {
          const existing = await pool.query(
            `SELECT job_id, place_id, session_token FROM sessions
             WHERE session_code = $1 AND status = 'active'`,
            [sessionCode]
          );
          if (existing.rows[0]?.job_id === body.jobId &&
              String(existing.rows[0]?.place_id) === String(body.placeId)) {
            res.status(201).json({
              sessionId: sessionCode,
              sessionToken: existing.rows[0].session_token,
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
      const result = await pool.query(
        `SELECT id::double precision AS id, event_type AS type,
                triggered_by AS "triggeredBy", params
         FROM event_commands
         WHERE session_id = $1 AND id > $2
         ORDER BY id ASC`,
        [session.id, since]
      );
      res.json({ events: result.rows });
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

  sessions.post("/:code/results", async (req, res, next) => {
    const identity = readSessionIdentity(req);
    const body: unknown = req.body;
    if (!identity || !isJsonObject(body) || !isPositiveInteger(body.round)) {
      res.status(400).json({ error: "Expected a valid session code and positive round number" });
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
