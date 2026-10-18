import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { RequestHandler } from "express";
import { Pool, type PoolClient } from "pg";
import {
  createApp,
  getLongestSurvivorIds,
  getTimeBracket,
  normalizeSessionCode,
  watchRewardKeys
} from "./server.js";

async function withServer(
  app: ReturnType<typeof createApp>,
  testRequest: (baseUrl: string) => Promise<void>
) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const listenerAddress = server.address();
  if (!listenerAddress || typeof listenerAddress === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  const address: AddressInfo = listenerAddress;
  try {
    await testRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function mockPool(
  queryHandler: (sql: string, values?: unknown[]) => {
    rows: Array<Record<string, unknown>>;
    rowCount: number;
  }
): Pool {
  const query = async (sql: string, values?: unknown[]) => queryHandler(sql, values);
  const client = {
    query,
    release: () => undefined
  } as unknown as PoolClient;
  return {
    connect: async () => client,
    query
  } as unknown as Pool;
}

test("normalizes valid session codes to uppercase", () => {
  assert.equal(normalizeSessionCode("kwpz"), "KWPZ");
});

test("rejects session codes outside the four-letter alphabet", () => {
  for (const value of ["KWP", "KWPZZ", "KWIZ", "KWOZ", "1234", "", null, 1234]) {
    assert.equal(normalizeSessionCode(value), null);
  }
});

test("maps survival boundaries to exactly one prediction bracket", () => {
  assert.equal(getTimeBracket(0, false), "0:00 - 0:15");
  assert.equal(getTimeBracket(14.999, false), "0:00 - 0:15");
  assert.equal(getTimeBracket(15, false), "0:15 - 0:30");
  assert.equal(getTimeBracket(30, false), "0:30 - 0:45");
  assert.equal(getTimeBracket(45, false), "0:45 - 1:00");
  assert.equal(getTimeBracket(41, true), "0:45 - 1:00");
});

test("treats all players tied for the longest survival time as prediction winners", () => {
  assert.deepEqual(
    [...getLongestSurvivorIds([
      { playerId: "100", survivalSeconds: 59.5 },
      { playerId: "200", survivalSeconds: 60 },
      { playerId: "300", survivalSeconds: 60 }
    ])].sort(),
    ["200", "300"]
  );
});

test("preserves the health endpoint without opening a database connection", async () => {
  const pool = new Pool();
  await withServer(createApp(pool), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "crowd-control-backend"
    });
  });
  await pool.end();
});

test("requires Auth0 bearer authentication on every Roblox session endpoint", async () => {
  const pool = new Pool();
  await withServer(createApp(pool), async (baseUrl) => {
    const routes: Array<[string, string]> = [
      ["POST", "/sessions"],
      ["GET", "/sessions/KWPZ/events?since=0"],
      ["POST", "/sessions/KWPZ/telemetry"],
      ["POST", "/sessions/KWPZ/results"],
      ["POST", "/sessions/KWPZ/end"]
    ];
    for (const [method, path] of routes) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path} should require a bearer token`);
    }
  });
  await pool.end();
});

test("rejects non-machine tokens even when upstream JWT verification succeeds", async () => {
  const pool = new Pool();
  const verifiedUserToken: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { gty: "authorization_code" },
      token: "verified-test-token"
    };
    next();
  };
  await withServer(createApp(pool, verifiedUserToken), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "KWPZ", jobId: "test", placeId: 1 })
    });
    assert.equal(response.status, 403);
  });
  await pool.end();
});

test("rejects invalid request shapes and missing session tokens before querying the database", async () => {
  const pool = new Pool();
  const allowRequests: RequestHandler = (_req, _res, next) => next();
  await withServer(createApp(pool, allowRequests, allowRequests), async (baseUrl) => {
    const requests: Array<[string, string, object?]> = [
      ["POST", "/sessions", {}],
      ["GET", "/sessions/KWPZ/events?since=-1"],
      ["POST", "/sessions/KWPZ/telemetry", { events: [] }],
      ["POST", "/sessions/KWPZ/results", { round: 0 }],
      ["POST", "/sessions/ABIO/end"],
      ["GET", "/sessions/KWPZ/events?since=0"],
      ["POST", "/sessions/KWPZ/telemetry", {
        events: [{ type: "test", at: 1792214400.25 }]
      }],
      ["POST", "/sessions/KWPZ/results", { round: 1 }],
      ["POST", "/sessions/KWPZ/end"]
    ];
    for (const [method, path, body] of requests) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      assert.equal(response.status, 400, `${method} ${path} should reject its invalid input`);
    }
  });
  await pool.end();
});

test("requires a spectator access token on all spectator endpoints", async () => {
  const pool = new Pool();
  await withServer(createApp(pool), async (baseUrl) => {
    const requests: Array<[string, string]> = [
      ["POST", "/api/sessions/KWPZ/join"],
      ["POST", "/api/sessions/KWPZ/vote"],
      ["POST", "/api/sessions/KWPZ/predict"],
      ["GET", "/api/profile/me?auth0UserId=auth0%7Ctest"],
      ["PATCH", "/api/profile/me/username"]
    ];
    for (const [method, path] of requests) {
      const response = await fetch(`${baseUrl}${path}`, { method });
      assert.equal(response.status, 401, `${method} ${path} should require a bearer token`);
    }
  });
  await pool.end();
});

test("validates spectator input and binds supplied Auth0 IDs to the verified subject", async () => {
  const pool = new Pool();
  const verifiedSpectator: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|test-user" },
      token: "verified-test-token"
    };
    next();
  };
  await withServer(
    createApp(pool, undefined, undefined, verifiedSpectator),
    async (baseUrl) => {
      const invalidRequests: Array<[string, string, object]> = [
        ["POST", "/api/sessions/KWPZ/join", {
          auth0UserId: "auth0|other-user",
          username: "player"
        }],
        ["POST", "/api/sessions/KWPZ/vote", {
          auth0UserId: "auth0|test-user",
          eventId: "not_a_complex_event"
        }],
        ["POST", "/api/sessions/KWPZ/predict", {
          auth0UserId: "auth0|test-user",
          type: "time_bracket",
          value: "0:30-1:00"
        }],
        ["PATCH", "/api/profile/me/username", {
          auth0UserId: "auth0|test-user",
          username: "bad username"
        }]
      ];
      for (const [method, path, body] of invalidRequests) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        assert.ok(
          response.status === 400 || response.status === 403,
          `${method} ${path} should reject invalid input without querying persistence`
        );
      }
      const mismatchedProfile = await fetch(
        `${baseUrl}/api/profile/me?auth0UserId=auth0%7Cother-user`
      );
      assert.equal(mismatchedProfile.status, 403);
    }
  );
  await pool.end();
});

test("joins a spectator once and grants the session-start tokens through the ledger", async () => {
  const rewardKeys: unknown[] = [];
  let membershipInsertCount = 0;
  let rewardInsertCount = 0;
  const pool = mockPool((sql, values) => {
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 2, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO spectator_profiles")) {
      return { rows: [{ id: "17", username: "crowd_user" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO session_memberships")) {
      membershipInsertCount += 1;
      return { rows: [{ id: "9" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO token_ledger")) {
      rewardInsertCount += 1;
      rewardKeys.push(values?.[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT token_balance")) {
      return { rows: [{ token_balance: "50" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const verifiedSpectator: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|crowd-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, undefined, undefined, verifiedSpectator),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/kwpz/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|crowd-user",
          username: "crowd_user"
        })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        sessionId: "31",
        tokenBalance: 50,
        username: "crowd_user",
        currentRound: 2,
        totalRounds: 5
      });
    }
  );
  assert.equal(membershipInsertCount, 1);
  assert.equal(rewardInsertCount, 1);
  assert.deepEqual(rewardKeys, ["join-reward:31:17"]);
});

test("serves and updates a profile bound to the verified Auth0 subject", async () => {
  const pool = mockPool((_sql, values) => ({
    rows: [{
      auth0UserId: "auth0|crowd-user",
      username: values?.[1] ?? "crowd_user",
      totalSessionsJoined: "3",
      totalTokensSpent: "90",
      createdAt: "2026-10-17T00:00:00.000Z"
    }],
    rowCount: 1
  }));
  const verifiedSpectator: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|crowd-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, undefined, undefined, verifiedSpectator),
    async (baseUrl) => {
      const profile = await fetch(
        `${baseUrl}/api/profile/me?auth0UserId=auth0%7Ccrowd-user`
      );
      assert.equal(profile.status, 200);
      const profileBody = await profile.json();
      assert.equal(profileBody.auth0UserId, "auth0|crowd-user");
      assert.equal(profileBody.totalSessionsJoined, 3);
      assert.equal(profileBody.totalTokensSpent, 90);

      const updated = await fetch(`${baseUrl}/api/profile/me/username`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|crowd-user",
          username: "new_name"
        })
      });
      assert.equal(updated.status, 200);
      const updatedBody = await updated.json();
      assert.equal(updatedBody.username, "new_name");
    }
  );
});

test("accepts complex-event votes and validated predictions for the current round", async () => {
  const statements: string[] = [];
  const pool = mockPool((sql) => {
    statements.push(sql);
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM spectator_profiles")) {
      return { rows: [{ id: "17" }], rowCount: 1 };
    }
    if (sql.includes("SELECT 1 FROM session_memberships")) {
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const verifiedSpectator: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|crowd-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, undefined, undefined, verifiedSpectator),
    async (baseUrl) => {
      const vote = await fetch(`${baseUrl}/api/sessions/KWPZ/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|crowd-user",
          eventId: "tsunami"
        })
      });
      assert.equal(vote.status, 200);
      assert.deepEqual(await vote.json(), { ok: true, eventId: "tsunami" });

      const prediction = await fetch(`${baseUrl}/api/sessions/KWPZ/predict`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|crowd-user",
          type: "time_bracket",
          value: "0:45 - 1:00"
        })
      });
      assert.equal(prediction.status, 200);
      assert.deepEqual(await prediction.json(), {
        ok: true,
        prediction: { type: "time_bracket", value: "0:45 - 1:00" }
      });

      const catalogEvent = await fetch(`${baseUrl}/api/sessions/KWPZ/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|crowd-user",
          eventId: "blob_fight"
        })
      });
      assert.equal(catalogEvent.status, 200);
    }
  );
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO spectator_votes")));
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO spectator_predictions")));
});

test("settles tied multiplayer predictions once and treats exact result retries idempotently", async () => {
  const statements: string[] = [];
  const predictionRewards: string[] = [];
  let resultStored = false;
  const pool = mockPool((sql, values) => {
    statements.push(sql);
    if (sql.includes("SELECT id, session_token, status FROM sessions")) {
      return { rows: [{ id: "31", session_token: "00000000-0000-4000-8000-000000000000", status: "active" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO round_results")) {
      if (resultStored) return { rows: [], rowCount: 0 };
      resultStored = true;
      return { rows: [{ id: "1" }], rowCount: 1 };
    }
    if (sql.includes("SELECT result =")) {
      return { rows: [{ same_result: true }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_predictions")) {
      return {
        rows: [
          { id: "1", spectator_id: "10", prediction_type: "player", predicted_value: "200", username: "andy" },
          { id: "2", spectator_id: "11", prediction_type: "player", predicted_value: "400", username: "kush" },
          { id: "3", spectator_id: "12", prediction_type: "player", predicted_value: "300", username: "diya" }
        ],
        rowCount: 3
      };
    }
    if (sql.includes("INSERT INTO token_ledger")) {
      predictionRewards.push(String(values?.[2]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const sessionToken = "00000000-0000-4000-8000-000000000000";
  const requestBody = {
    round: 1,
    players: [
      { playerId: "200", survivalSeconds: 60 },
      { playerId: "400", survivalSeconds: 60 },
      { playerId: "300", survivalSeconds: 59 }
    ]
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, allowAuth, allowAuth),
    async (baseUrl) => {
      const sendResult = () => fetch(`${baseUrl}/sessions/KWPZ/results`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Session-Token": sessionToken
        },
        body: JSON.stringify(requestBody)
      });
      const first = await sendResult();
      assert.equal(first.status, 201);
      assert.deepEqual(await first.json(), {
        ok: true,
        winners: [
          { username: "andy", type: "player" },
          { username: "kush", type: "player" }
        ]
      });

      const retry = await sendResult();
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), { ok: true, duplicate: true });
    }
  );
  assert.equal(predictionRewards.length, 2);
  assert.ok(predictionRewards.every((key) => key.startsWith("pred-reward:31:1:")));
  assert.equal(statements.filter((sql) => sql.includes("UPDATE spectator_predictions")).length, 3);
});

test("purchases a basic event transactionally and reserves its room-wide lock", async () => {
  const statements: string[] = [];
  const ledgerValues: unknown[][] = [];
  const pool = mockPool((sql, values) => {
    statements.push(sql);
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_profiles p")) {
      return {
        rows: [{ id: "17", username: "crowd_user", token_balance: "80" }],
        rowCount: 1
      };
    }
    if (sql.includes("INSERT INTO event_commands")) {
      return { rows: [{ id: "55" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO event_locks")) {
      return { rows: [{ id: "6" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO token_ledger")) {
      ledgerValues.push(values ?? []);
      return { rows: [{ id: "12" }], rowCount: 1 };
    }
    if (sql.includes("SELECT token_balance")) {
      return { rows: [{ token_balance: "50" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|test-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|test-user",
          eventType: "low_gravity"
        })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        eventType: "low_gravity",
        tokenBalance: 50
      });
    }
  );
  assert.ok(statements.includes("BEGIN"));
  assert.ok(statements.includes("COMMIT"));
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO event_locks")));
  assert.equal(ledgerValues[0]?.[0], "31");
  assert.equal(ledgerValues[0]?.[1], "17");
  assert.match(String(ledgerValues[0]?.[2]), /^purchase:31:17:/);
  assert.match(statements.find((sql) => sql.includes("INSERT INTO token_ledger")) ?? "", /-30, 'purchase'/);
});

test("does not create a command or charge tokens when purchase balance is insufficient", async () => {
  const statements: string[] = [];
  const pool = mockPool((sql) => {
    statements.push(sql);
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_profiles p")) {
      return {
        rows: [{ id: "17", username: "crowd_user", token_balance: "29" }],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|test-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|test-user",
          eventType: "bombs"
        })
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "Insufficient tokens" });
    }
  );
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO event_commands")), false);
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO token_ledger")), false);
});

test("rejects a locked duration event without charging or enqueueing the purchase", async () => {
  const statements: string[] = [];
  const pool = mockPool((sql) => {
    statements.push(sql);
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_profiles p")) {
      return {
        rows: [{ id: "17", username: "crowd_user", token_balance: "80" }],
        rowCount: 1
      };
    }
    if (sql.includes("INSERT INTO event_commands")) {
      return { rows: [{ id: "55" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO event_locks")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|test-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|test-user",
          eventType: "inverted_controls"
        })
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "Event is currently active or locked"
      });
    }
  );
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.some((sql) => sql.includes("INSERT INTO token_ledger")), false);
  assert.ok(statements.some((sql) => sql.includes("DELETE FROM event_locks") && sql.includes("interval '10 seconds'")));
});

test("allows purchasing a duration event after previous 10s lock has expired", async () => {
  const statements: string[] = [];
  const pool = mockPool((sql) => {
    statements.push(sql);
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5 }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_profiles p")) {
      return {
        rows: [{ id: "17", username: "crowd_user", token_balance: "80" }],
        rowCount: 1
      };
    }
    if (sql.includes("INSERT INTO event_commands")) {
      return { rows: [{ id: "55" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO event_locks")) {
      return { rows: [{ id: "9" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO token_ledger")) {
      return { rows: [{ id: "12" }], rowCount: 1 };
    }
    if (sql.includes("SELECT token_balance")) {
      return { rows: [{ token_balance: "50" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: "auth0|test-user" },
      token: "verified-test-token"
    };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ/purchase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          auth0UserId: "auth0|test-user",
          eventType: "ink_screen"
        })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        eventType: "ink_screen",
        tokenBalance: 50
      });
    }
  );
  assert.ok(statements.includes("COMMIT"));
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO event_locks") && sql.includes("interval '10 seconds'")));
});

test("validates totalRounds on session creation (min 5, max 10)", async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("INSERT INTO sessions")) {
      return { rows: [{ id: "1" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();

  await withServer(
    createApp(pool, allowAuth, allowAuth),
    async (baseUrl) => {
      // Rejects below 5
      const low = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "ABCD", jobId: "test-job", placeId: 1, totalRounds: 4 })
      });
      assert.equal(low.status, 400);

      // Rejects above 10
      const high = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "ABCD", jobId: "test-job", placeId: 1, totalRounds: 11 })
      });
      assert.equal(high.status, 400);

      // Accepts 7
      const valid = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "ABCD", jobId: "test-job", placeId: 1, totalRounds: 7 })
      });
      assert.equal(valid.status, 201);
      const data = await valid.json() as { totalRounds: number };
      assert.equal(data.totalRounds, 7);
    }
  );
});

test("updates round and totalRounds via POST /sessions/:code/round", async () => {
  const statements: string[] = [];
  const rewardValues: unknown[][] = [];
  const pool = mockPool((sql, values) => {
    statements.push(sql);
    if (sql.includes("SELECT id, session_token, status FROM sessions")) {
      return { rows: [{ id: "31", session_token: "00000000-0000-4000-8000-000000000001", status: "active" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO token_ledger") && sql.includes("'round_reward'")) {
      rewardValues.push(values ?? []);
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();

  await withServer(
    createApp(pool, allowAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": "00000000-0000-4000-8000-000000000001"
        },
        body: JSON.stringify({ round: 2, totalRounds: 8, state: "intermission" })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, round: 2, totalRounds: 8 });

      const retry = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": "00000000-0000-4000-8000-000000000001"
        },
        body: JSON.stringify({ round: 2, totalRounds: 8, state: "intermission" })
      });
      assert.equal(retry.status, 200);

      const lobby = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": "00000000-0000-4000-8000-000000000001"
        },
        body: JSON.stringify({ round: 0, totalRounds: 5, state: "lobby" })
      });
      assert.equal(lobby.status, 200);

      const badState = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-token": "00000000-0000-4000-8000-000000000001"
        },
        body: JSON.stringify({ round: 1, state: "dancing" })
      });
      assert.equal(badState.status, 400);
    }
  );
  assert.ok(statements.some((sql) => sql.includes("UPDATE sessions") && sql.includes("total_rounds") && sql.includes("round_state")));
  assert.equal(rewardValues.length, 2); // the lobby (round 0) pays nothing
  assert.deepEqual(rewardValues, [["31", 2], ["31", 2]]);
  assert.ok(statements.some((sql) =>
    sql.includes("'round_reward'") && sql.includes("ON CONFLICT (idempotency_key) DO NOTHING")
  ));
});

test("serves session details to spectators via GET /api/sessions/:code", async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("SELECT id, current_round, total_rounds, status, round_state")) {
      return { rows: [{ id: "31", current_round: 3, total_rounds: 7, status: "active", round_state: "active", round_ends_at: 1800000000.5 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = { header: {}, payload: { sub: "auth0|test" }, token: "test" };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ`, {
        headers: { authorization: "Bearer test" }
      });
      assert.equal(response.status, 200);
      const data = await response.json() as Record<string, unknown>;
      assert.equal(typeof data.serverTime, "number");
      delete data.serverTime;
      assert.deepEqual(data, {
        sessionId: "31",
        currentRound: 3,
        totalRounds: 7,
        status: "active",
        roundState: "active",
        endsAt: 1800000000.5,
        tokenBalance: null,
        correctPredictions: null,
        activeLocks: {}
      });
    }
  );
});

test("returns active event locks in GET /api/sessions/:code", async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("SELECT id, current_round, total_rounds, status, round_state")) {
      return { rows: [{ id: "31", current_round: 2, total_rounds: 5, status: "active", round_state: "active", round_ends_at: null }], rowCount: 1 };
    }
    if (sql.includes("FROM event_locks")) {
      return {
        rows: [
          { event_type: "inverted_controls", seconds_left: 8 },
          { event_type: "low_gravity", seconds_left: 4 }
        ],
        rowCount: 2
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = { header: {}, payload: { sub: "auth0|test" }, token: "test" };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ`, {
        headers: { authorization: "Bearer test" }
      });
      assert.equal(response.status, 200);
      const data = await response.json() as Record<string, unknown>;
      assert.deepEqual(data.activeLocks, {
        inverted_controls: 8,
        low_gravity: 4
      });
    }
  );
});

test("returns live spectator list and token balances when Roblox polls events", async () => {
  const pool = mockPool((sql) => {
    if (sql.includes("SELECT id, session_token, status FROM sessions")) {
      return { rows: [{ id: "31", session_token: "00000000-0000-4000-8000-000000000001", status: "active" }], rowCount: 1 };
    }
    if (sql.includes("FROM event_commands")) {
      return { rows: [{ id: 1, type: "bombs", triggeredBy: "kush", params: {} }], rowCount: 1 };
    }
    if (sql.includes("FROM session_memberships m")) {
      return {
        rows: [
          { username: "kush", tokenBalance: "80" },
          { username: "diya", tokenBalance: "50" }
        ],
        rowCount: 2
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();

  await withServer(
    createApp(pool, allowAuth, allowAuth),
    async (baseUrl) => {
      // Test GET /sessions/:code/events includes spectators
      const eventsRes = await fetch(`${baseUrl}/sessions/KWPZ/events?since=0`, {
        headers: { "x-session-token": "00000000-0000-4000-8000-000000000001" }
      });
      assert.equal(eventsRes.status, 200);
      const eventsData = await eventsRes.json() as {
        events: unknown[];
        spectators: { username: string; tokenBalance: number }[];
      };
      assert.equal(eventsData.events.length, 1);
      assert.deepEqual(eventsData.spectators, [
        { username: "kush", tokenBalance: 80 },
        { username: "diya", tokenBalance: 50 }
      ]);

      // Test GET /sessions/:code/spectators dedicated endpoint
      const spectatorsRes = await fetch(`${baseUrl}/sessions/KWPZ/spectators`, {
        headers: { "x-session-token": "00000000-0000-4000-8000-000000000001" }
      });
      assert.equal(spectatorsRes.status, 200);
      const spectatorsData = await spectatorsRes.json() as {
        spectators: { username: string; tokenBalance: number }[];
      };
      assert.deepEqual(spectatorsData.spectators, [
        { username: "kush", tokenBalance: 80 },
        { username: "diya", tokenBalance: 50 }
      ]);
    }
  );
});

test("pays watch rewards every 7s of an active round", () => {
  const session = { id: "31", current_round: 2, round_state: "active", round_ends_at: 1000 };
  assert.deepEqual(watchRewardKeys({ ...session, round_state: "intermission" }, "7", 900), []);

  assert.deepEqual(watchRewardKeys(session, "7", 1000 - 55), []); // 5s in, the round reward comes from /round

  const late = watchRewardKeys(session, "7", 1000 - 45); // 0:15 into the 1:00 round
  assert.deepEqual(late.map((reward) => reward.key), [
    "interval-reward:31:2:1:7",
    "interval-reward:31:2:2:7"
  ]);
  assert.equal(watchRewardKeys(session, "7", 2000).length, 8); // 0:07 through 0:56, never more
});

test("grants watch rewards and returns the balance to a joined spectator", async () => {
  const statements: string[] = [];
  const pool = mockPool((sql) => {
    statements.push(sql);
    if (sql.includes("SELECT id, current_round, total_rounds, status, round_state")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5, status: "active", round_state: "active", round_ends_at: Date.now() / 1000 + 20 }], rowCount: 1 }; // 0:40 into the round
    }
    if (sql.includes("SELECT m.id") && sql.includes("auth0_subject")) {
      return { rows: [{ id: "7" }], rowCount: 1 };
    }
    if (sql.includes("SELECT m.token_balance")) {
      return { rows: [{ token_balance: "140", correct_predictions: "1" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const allowAuth: RequestHandler = (_req, _res, next) => next();
  const spectatorAuth: RequestHandler = (req, _res, next) => {
    req.auth = { header: {}, payload: { sub: "auth0|test" }, token: "test" };
    next();
  };

  await withServer(
    createApp(pool, allowAuth, allowAuth, spectatorAuth, allowAuth),
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/KWPZ`, {
        headers: { authorization: "Bearer test" }
      });
      assert.equal(response.status, 200);
      const data = await response.json() as Record<string, unknown>;
      assert.equal(data.tokenBalance, 140);
      assert.equal(data.correctPredictions, 1);
    }
  );
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO token_ledger") && sql.includes("ON CONFLICT (idempotency_key) DO NOTHING")));
});

test("tallies complex-event votes and delivers winning event to Roblox poll", async () => {
  const queuedCommands: { id: number; event_type: string; triggered_by: string; params: unknown }[] = [];
  const votes: { spectator_id: string; round_number: number; event_id: string }[] = [];

  const pool = mockPool((sql, values) => {
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5, status: "active", session_token: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 };
    }
    if (sql.includes("SELECT id FROM spectator_profiles")) {
      const sub = values?.[0] as string;
      const id = sub === "auth0|user-2" ? "20" : "10";
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.includes("SELECT 1 FROM session_memberships")) {
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO spectator_votes")) {
      const [_, round, spectatorId, eventId] = values as [unknown, number, string, string];
      const existing = votes.find((v) => v.spectator_id === spectatorId && v.round_number === round);
      if (existing) {
        existing.event_id = eventId;
      } else {
        votes.push({ spectator_id: spectatorId, round_number: round, event_id: eventId });
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_votes")) {
      const counts: Record<string, number> = {};
      for (const v of votes) {
        counts[v.event_id] = (counts[v.event_id] || 0) + 1;
      }
      let topEvent = "";
      let maxCount = -1;
      for (const [evt, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          topEvent = evt;
        }
      }
      return { rows: topEvent ? [{ event_id: topEvent }] : [], rowCount: topEvent ? 1 : 0 };
    }
    if (sql.includes("DELETE FROM event_commands")) {
      queuedCommands.length = 0;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO event_commands")) {
      const [_, eventType] = values as [unknown, string];
      queuedCommands.push({ id: queuedCommands.length + 1, event_type: eventType, triggered_by: "Spectators", params: {} });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM event_commands")) {
      return {
        rows: queuedCommands.map((c) => ({
          id: c.id,
          type: c.event_type,
          triggeredBy: c.triggered_by,
          params: c.params
        })),
        rowCount: queuedCommands.length
      };
    }
    if (sql.includes("FROM session_memberships m")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  const allowRoblox: RequestHandler = (_req, _res, next) => next();
  let currentSub = "auth0|user-1";
  const dynamicSpectator: RequestHandler = (req, _res, next) => {
    req.auth = {
      header: {},
      payload: { sub: currentSub },
      token: "spectator-token"
    };
    next();
  };

  await withServer(
    createApp(pool, allowRoblox, allowRoblox, dynamicSpectator, allowRoblox),
    async (baseUrl) => {
      // User 1 votes for tsunami
      currentSub = "auth0|user-1";
      const vote1 = await fetch(`${baseUrl}/api/sessions/KWPZ/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth0UserId: "auth0|user-1", eventId: "tsunami", roundNumber: 1 })
      });
      assert.equal(vote1.status, 200);

      // User 2 votes for giant_boulder
      currentSub = "auth0|user-2";
      const vote2 = await fetch(`${baseUrl}/api/sessions/KWPZ/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth0UserId: "auth0|user-2", eventId: "giant_boulder", roundNumber: 1 })
      });
      assert.equal(vote2.status, 200);

      // User 1 changes vote to giant_boulder (giving giant_boulder 2 votes)
      currentSub = "auth0|user-1";
      const vote3 = await fetch(`${baseUrl}/api/sessions/KWPZ/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auth0UserId: "auth0|user-1", eventId: "giant_boulder", roundNumber: 1 })
      });
      assert.equal(vote3.status, 200);

      // Votes alone don't reach the game: Roblox picks up every new command right away, so queueing per vote would run several events
      const earlyPoll = await fetch(`${baseUrl}/sessions/KWPZ/events?since=0`, {
        headers: { "x-session-token": "00000000-0000-4000-8000-000000000001" }
      });
      const earlyData = await earlyPoll.json() as { events: unknown[] };
      assert.equal(earlyData.events.length, 0);

      // The round goes active (reported twice, like a retry): the winner is queued exactly once
      for (let report = 0; report < 2; report++) {
        const roundRes = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-token": "00000000-0000-4000-8000-000000000001" },
          body: JSON.stringify({ round: 1, totalRounds: 5, state: "active", endsAt: Date.now() / 1000 + 120 })
        });
        assert.equal(roundRes.status, 200);
      }

      // Roblox polls events
      const pollRes = await fetch(`${baseUrl}/sessions/KWPZ/events?since=0`, {
        headers: { "x-session-token": "00000000-0000-4000-8000-000000000001" }
      });
      assert.equal(pollRes.status, 200);
      const pollData = await pollRes.json() as { events: { type: string; triggeredBy: string }[] };
      // Exactly 1 winning complex event is queued
      assert.equal(pollData.events.length, 1);
      assert.equal(pollData.events[0].type, "giant_boulder");
      assert.equal(pollData.events[0].triggeredBy, "Spectators");
    }
  );
});

test("queues a random complex event fallback when no spectator votes are cast", async () => {
  const queuedCommands: { id: number; event_type: string; triggered_by: string; params: unknown }[] = [];

  const pool = mockPool((sql, values) => {
    if (sql.includes("FROM sessions")) {
      return { rows: [{ id: "31", current_round: 1, total_rounds: 5, status: "active", session_token: "00000000-0000-4000-8000-000000000001" }], rowCount: 1 };
    }
    if (sql.includes("FROM spectator_votes")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT 1 FROM event_commands")) {
      return { rows: queuedCommands.length > 0 ? [{ 1: 1 }] : [], rowCount: queuedCommands.length };
    }
    if (sql.includes("DELETE FROM event_commands")) {
      queuedCommands.length = 0;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO event_commands")) {
      const [_, eventType] = values as [unknown, string];
      queuedCommands.push({ id: queuedCommands.length + 1, event_type: eventType, triggered_by: "Spectators", params: {} });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM event_commands")) {
      return {
        rows: queuedCommands.map((c) => ({
          id: c.id,
          type: c.event_type,
          triggeredBy: c.triggered_by,
          params: c.params
        })),
        rowCount: queuedCommands.length
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const allowRoblox: RequestHandler = (_req, _res, next) => next();

  await withServer(
    createApp(pool, allowRoblox, allowRoblox, allowRoblox, allowRoblox),
    async (baseUrl) => {
      // The round goes active without any spectator voting
      const roundRes = await fetch(`${baseUrl}/sessions/KWPZ/round`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-token": "00000000-0000-4000-8000-000000000001" },
        body: JSON.stringify({ round: 1, totalRounds: 5, state: "active", endsAt: Date.now() / 1000 + 120 })
      });
      assert.equal(roundRes.status, 200);

      // Roblox polls events and receives a random complex event fallback
      const pollRes = await fetch(`${baseUrl}/sessions/KWPZ/events?since=0`, {
        headers: { "x-session-token": "00000000-0000-4000-8000-000000000001" }
      });
      assert.equal(pollRes.status, 200);
      const pollData = await pollRes.json() as { events: { type: string; triggeredBy: string }[] };
      assert.equal(pollData.events.length, 1);
      const expectedComplexEvents = [
        "giant_boulder", "floor_is_lava", "tornado", "blob_fight",
        "tsunami", "flood_escape", "shrinking_podium"
      ];
      assert.ok(expectedComplexEvents.includes(pollData.events[0].type));
      assert.equal(pollData.events[0].triggeredBy, "Spectators");
    }
  );
});

