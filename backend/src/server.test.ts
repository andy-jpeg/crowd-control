import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { RequestHandler } from "express";
import { Pool } from "pg";
import { createApp, normalizeSessionCode } from "./server.js";

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

test("normalizes valid session codes to uppercase", () => {
  assert.equal(normalizeSessionCode("kwpz"), "KWPZ");
});

test("rejects session codes outside the four-letter alphabet", () => {
  for (const value of ["KWP", "KWPZZ", "KWIZ", "KWOZ", "1234", "", null, 1234]) {
    assert.equal(normalizeSessionCode(value), null);
  }
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
