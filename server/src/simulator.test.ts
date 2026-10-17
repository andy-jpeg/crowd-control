import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Express } from "express";
import { basicEvents, complexEvents } from "./catalog";
import { createSimulatorApp } from "./simulator";

const token = "test-simulator-server-token-with-sufficient-length";
let app: Express;
let server: Server;
let baseUrl: string;
let now: number;
let nextRoomCode = 0;
const originalNodeEnv = process.env.NODE_ENV;
const originalSimulatorEnabled = process.env.SIMULATOR_ENABLED;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.SIMULATOR_ENABLED = "true";
  now = Date.parse("2026-10-17T12:00:00.000Z");
  app = createSimulatorApp({
    serverToken: token,
    now: () => now,
    random: () => 0,
    codeRandom: () => Math.floor(nextRoomCode++ / 4) / 26,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  if (originalSimulatorEnabled === undefined) delete process.env.SIMULATOR_ENABLED;
  else process.env.SIMULATOR_ENABLED = originalSimulatorEnabled;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() as T };
}

test("requires development mode and server credentials", () => {
  process.env.NODE_ENV = "production";
  assert.throws(() => createSimulatorApp({ serverToken: token }), /cannot run when NODE_ENV=production/);
  process.env.NODE_ENV = "test";
  assert.throws(() => createSimulatorApp({ serverToken: "short" }), /at least 24 characters/);
});

test("complex-event catalog matches the shared specification", () => {
  const sharedCatalog = readFileSync(join(__dirname, "../../shared/events.md"), "utf8");
  const documentedIds = [...sharedCatalog.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documentedIds.slice(-complexEvents.length), [...complexEvents]);
});

test("basic-event catalog matches the shared specification", () => {
  const sharedCatalog = readFileSync(join(__dirname, "../../shared/events.md"), "utf8");
  const documentedIds = [...sharedCatalog.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documentedIds.slice(0, basicEvents.length), [...basicEvents]);
});

test("preserves health path and protects room endpoints", async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", mode: "development-simulator" });

  const unauthorized = await fetch(`${baseUrl}/rooms`, { method: "POST", body: "{}" });
  assert.equal(unauthorized.status, 401);
});

test("simulates round lifecycle, deduplicates creation, and rejects stale result changes", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "room-1" },
    body: "{}",
  });
  assert.equal(room.status, 201);
  assert.equal(room.body.code, "AAAA");
  const duplicateRoom = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "room-1" },
    body: "{}",
  });
  assert.equal(duplicateRoom.status, 200);
  assert.deepEqual(duplicateRoom.body, room.body);

  const started = await call<{ roundId: string; phaseEndsAt: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "round-1" },
    body: JSON.stringify({ players: [{ playerId: "10001", username: "PlayerOne" }] }),
  });
  assert.equal(started.status, 201);
  const duplicateRound = await call(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "round-1" },
    body: JSON.stringify({ players: [{ playerId: "10001", username: "PlayerOne" }] }),
  });
  assert.equal(duplicateRound.status, 200);

  now += 15_000;
  const polled = await call<{
    events: Array<{ commandId: string; type: string }>;
    nextSince: number;
  }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`,
  );
  assert.equal(polled.status, 200);
  assert.equal(polled.body.events.length, 1);
  assert.equal(polled.body.events[0]?.type, "GIANT_BOULDER");

  const commandId = polled.body.events[0]!.commandId;
  const repeatedPoll = await call<{ events: Array<{ commandId: string }> }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=${polled.body.nextSince}`,
  );
  assert.equal(repeatedPoll.body.events[0]?.commandId, commandId);
  const ackPath = `/rooms/${room.body.code}/commands/${commandId}/acknowledgements`;
  const executed = await call(ackPath, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  assert.equal(executed.status, 200);
  const duplicateAck = await call(ackPath, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  assert.equal(duplicateAck.status, 200);

  const death = await call<{ roundEnded: boolean; endReason: string }>(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    { method: "POST", body: JSON.stringify({ playerId: "10001", diedAt: new Date(now).toISOString() }) },
  );
  assert.deepEqual(death.body, { roundEnded: true, endReason: "player_dead" });
  const duplicateDeath = await call(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    { method: "POST", body: JSON.stringify({ playerId: "10001", diedAt: new Date(now).toISOString() }) },
  );
  assert.deepEqual(duplicateDeath.body, death.body);

  const resultsPath = `/rooms/${room.body.code}/results`;
  const resultsBody = {
    roundId: started.body.roundId,
    endedAt: new Date(now).toISOString(),
    endReason: "player_dead",
    players: [{ playerId: "10001", survivalTimeMs: 0 }],
  };
  const results = await call(resultsPath, { method: "POST", body: JSON.stringify(resultsBody) });
  assert.equal(results.status, 200);
  const duplicateResults = await call(resultsPath, { method: "POST", body: JSON.stringify(resultsBody) });
  assert.equal(duplicateResults.status, 200);
  const conflictingResults = await call(resultsPath, {
    method: "POST",
    body: JSON.stringify({ ...resultsBody, players: [{ playerId: "10001", survivalTimeMs: 1 }] }),
  });
  assert.equal(conflictingResults.status, 409);
});

test("charges repeatable purchases once and keeps activation lifetimes independent", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-repeat-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-repeat-round" },
    body: JSON.stringify({ players: [{ playerId: "11001" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const selected = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  await call(`/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  const spectatorId = "repeat-buyer";
  const seeded = await call<{ balance: number }>(
    `/simulator/rooms/${room.body.code}/spectators/${spectatorId}/balance`,
    { method: "PUT", body: JSON.stringify({ tokens: 100 }) },
  );
  assert.deepEqual(seeded.body, { spectatorId, balance: 100 });

  const purchasePath = `/rooms/${room.body.code}/rounds/${started.body.roundId}/purchases`;
  const first = await call<{
    purchaseId: string;
    commandId: string;
    status: string;
    balance: number;
  }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "repeat-purchase-1" },
    body: JSON.stringify({ spectatorId, eventId: "BOMBS" }),
  });
  assert.equal(first.status, 201);
  assert.deepEqual(
    [first.body.status, first.body.balance],
    ["pending", 70],
  );
  const retry = await call<{
    purchaseId: string;
    commandId: string;
    balance: number;
  }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "repeat-purchase-1" },
    body: JSON.stringify({ spectatorId, eventId: "BOMBS" }),
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.purchaseId, first.body.purchaseId);
  assert.equal(retry.body.commandId, first.body.commandId);
  assert.equal(retry.body.balance, 70);
  const conflictingRetry = await call(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "repeat-purchase-1" },
    body: JSON.stringify({ spectatorId, eventId: "BANANA_PEELS" }),
  });
  assert.equal(conflictingRetry.status, 409);

  const second = await call<{ commandId: string; balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "repeat-purchase-2" },
    body: JSON.stringify({ spectatorId, eventId: "BOMBS" }),
  });
  assert.equal(second.status, 201);
  assert.notEqual(second.body.commandId, first.body.commandId);
  assert.equal(second.body.balance, 40);

  const commands = await call<{ events: Array<{
    commandId: string;
    type: string;
    category: string;
    status: string;
  }> }>(pollPath);
  assert.deepEqual(
    commands.body.events.filter((event) => event.category === "basic")
      .map((event) => [event.type, event.status]),
    [["BOMBS", "pending"], ["BOMBS", "pending"]],
  );
  const basicCommand = commands.body.events.find((event) => event.category === "basic")!;
  assert.equal("purchaseId" in basicCommand, false);
  assert.equal("spectatorId" in basicCommand, false);
  assert.equal("refunded" in basicCommand, false);
  const execute = (commandId: string) => call(
    `/rooms/${room.body.code}/commands/${commandId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({
        roundId: started.body.roundId,
        status: "executed",
        activatedAt: new Date(now).toISOString(),
      }),
    },
  );
  assert.equal((await execute(first.body.commandId)).status, 200);
  now += 5_000;
  assert.equal((await execute(second.body.commandId)).status, 200);
  now += 5_000;
  const afterFirstLifetime = await call<{ events: Array<{
    commandId: string;
    category: string;
    status: string;
  }> }>(pollPath);
  assert.deepEqual(
    afterFirstLifetime.body.events.filter((event) => event.category === "basic")
      .map(({ commandId, status }) => [commandId, status]),
    [[second.body.commandId, "executed"]],
  );
  now += 5_000;
  const afterSecondLifetime = await call<{ events: Array<{ category: string }> }>(pollPath);
  assert.equal(afterSecondLifetime.body.events.some((event) => event.category === "basic"), false);
});

test("locks only the purchased room-wide event and rejects simultaneous duplicate locks", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-lock-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-lock-round" },
    body: JSON.stringify({ players: [{ playerId: "11002" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const selected = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  await call(`/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  for (const spectatorId of ["lock-buyer-a", "lock-buyer-b"]) {
    const seeded = await call(
      `/simulator/rooms/${room.body.code}/spectators/${spectatorId}/balance`,
      { method: "PUT", body: JSON.stringify({ tokens: 90 }) },
    );
    assert.equal(seeded.status, 201);
  }
  const purchasePath = `/rooms/${room.body.code}/rounds/${started.body.roundId}/purchases`;
  const buy = (spectatorId: string, eventId: string, key: string) => call<{
    commandId: string;
    balance: number;
    error?: { code: string };
  }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ spectatorId, eventId }),
  });
  const concurrent = await Promise.all([
    buy("lock-buyer-a", "SQUID_SCREEN", "lock-a"),
    buy("lock-buyer-b", "SQUID_SCREEN", "lock-b"),
  ]);
  assert.deepEqual(concurrent.map((purchase) => purchase.status).sort(), [201, 409]);
  const accepted = concurrent.find((purchase) => purchase.status === 201)!;
  const rejected = concurrent.find((purchase) => purchase.status === 409)!;
  assert.equal(accepted.body.balance, 60);
  assert.equal(rejected.body.error?.code, "BASIC_EVENT_LOCKED");
  const balances = await Promise.all(["lock-buyer-a", "lock-buyer-b"].map((spectatorId) =>
    call<{ balance: number }>(`/simulator/rooms/${room.body.code}/spectators/${spectatorId}/balance`)
  ));
  assert.equal(balances[0]!.body.balance + balances[1]!.body.balance, 150);
  await call(
    `/simulator/rooms/${room.body.code}/spectators/lock-buyer-c/balance`,
    { method: "PUT", body: JSON.stringify({ tokens: 90 }) },
  );

  const otherType = await buy("lock-buyer-a", "LOW_GRAVITY", "other-event");
  assert.equal(otherType.status, 201);
  const blockedCommand = await call<{ events: Array<{
    commandId: string;
    category: string;
    type: string;
  }> }>(pollPath);
  const squidCommand = blockedCommand.body.events.find((event) =>
    event.category === "basic" && event.type === "SQUID_SCREEN"
  )!;
  await call(`/rooms/${room.body.code}/commands/${squidCommand.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({
      roundId: started.body.roundId,
      status: "executed",
      activatedAt: new Date(now).toISOString(),
    }),
  });
  const blockedWhilePending = await buy("lock-buyer-c", "SQUID_SCREEN", "lock-pending-retry");
  assert.equal(blockedWhilePending.status, 409);
  now += 9_999;
  const blockedWhileActive = await buy("lock-buyer-c", "SQUID_SCREEN", "lock-active-retry");
  assert.equal(blockedWhileActive.status, 409);
  now += 1;
  const unlocked = await buy("lock-buyer-c", "SQUID_SCREEN", "lock-pending-retry");
  assert.equal(unlocked.status, 201);
  assert.equal(unlocked.body.balance, 60);
});

test("refunds confirmed failures and expired unexecuted purchases exactly once", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-refund-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-refund-round" },
    body: JSON.stringify({ players: [{ playerId: "11003" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const selected = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  await call(`/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  const spectatorId = "refund-buyer";
  const balancePath = `/simulator/rooms/${room.body.code}/spectators/${spectatorId}/balance`;
  await call(balancePath, { method: "PUT", body: JSON.stringify({ tokens: 20 }) });
  const purchasePath = `/rooms/${room.body.code}/rounds/${started.body.roundId}/purchases`;
  const insufficient = await call<{ error: { code: string } }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "insufficient-purchase" },
    body: JSON.stringify({ spectatorId, eventId: "BOMBS" }),
  });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.body.error.code, "INSUFFICIENT_TOKENS");
  assert.equal((await call<{ balance: number }>(balancePath)).body.balance, 20);

  const funded = "refund-funded-buyer";
  const fundedBalancePath = `/simulator/rooms/${room.body.code}/spectators/${funded}/balance`;
  await call(fundedBalancePath, { method: "PUT", body: JSON.stringify({ tokens: 90 }) });
  const first = await call<{ commandId: string; balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "failed-purchase" },
    body: JSON.stringify({ spectatorId: funded, eventId: "LOW_GRAVITY" }),
  });
  assert.equal(first.body.balance, 60);
  const ackPath = `/rooms/${room.body.code}/commands/${first.body.commandId}/acknowledgements`;
  const failure = await call<{ status: string }>(ackPath, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }),
  });
  assert.equal(failure.body.status, "failed");
  const duplicateFailure = await call<{ status: string }>(ackPath, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }),
  });
  assert.equal(duplicateFailure.body.status, "failed");
  const replay = await call<{ status: string; balance: number; refunded: boolean }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "failed-purchase" },
    body: JSON.stringify({ spectatorId: funded, eventId: "LOW_GRAVITY" }),
  });
  assert.deepEqual(
    [replay.body.status, replay.body.balance, replay.body.refunded],
    ["failed", 90, true],
  );
  const afterFailure = await call<{ balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "retry-locked-event" },
    body: JSON.stringify({ spectatorId: funded, eventId: "LOW_GRAVITY" }),
  });
  assert.equal(afterFailure.status, 201);
  assert.equal(afterFailure.body.balance, 60);

  const expired = await call<{ commandId: string }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "expired-purchase" },
    body: JSON.stringify({ spectatorId: funded, eventId: "SQUID_SCREEN" }),
  });
  assert.equal(expired.body.commandId !== first.body.commandId, true);
  now += 120_000;
  const expiredCommands = await call<{ events: Array<{
    commandId: string;
    category: string;
    status: string;
  }> }>(pollPath);
  assert.deepEqual(
    expiredCommands.body.events.filter((event) => event.commandId === expired.body.commandId)
      .map((event) => event.status),
    ["expired"],
  );
  const reconciled = await call<{ status: string }>(
    `/rooms/${room.body.code}/commands/${expired.body.commandId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }),
    },
  );
  assert.equal(reconciled.body.status, "failed");
  const refundedReplay = await call<{ status: string; refunded: boolean; balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "expired-purchase" },
    body: JSON.stringify({ spectatorId: funded, eventId: "SQUID_SCREEN" }),
  });
  assert.deepEqual(
    [refundedReplay.body.status, refundedReplay.body.refunded, refundedReplay.body.balance],
    ["failed", true, 60],
  );
});

test("does not refund a basic event confirmed executed before round cleanup", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-executed-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-executed-round" },
    body: JSON.stringify({ players: [{ playerId: "11004" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const selected = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  await call(`/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });
  const spectatorId = "executed-buyer";
  const balancePath = `/simulator/rooms/${room.body.code}/spectators/${spectatorId}/balance`;
  await call(balancePath, { method: "PUT", body: JSON.stringify({ tokens: 60 }) });
  const purchasePath = `/rooms/${room.body.code}/rounds/${started.body.roundId}/purchases`;
  const purchased = await call<{ commandId: string; balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "executed-purchase" },
    body: JSON.stringify({ spectatorId, eventId: "BANANA_PEELS" }),
  });
  const executed = await call(`/rooms/${room.body.code}/commands/${purchased.body.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({
      roundId: started.body.roundId,
      status: "executed",
      activatedAt: new Date(now).toISOString(),
    }),
  });
  assert.equal(executed.status, 200);
  const death = await call<{ roundEnded: boolean }>(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    {
      method: "POST",
      body: JSON.stringify({
        playerId: "11004",
        diedAt: new Date(now).toISOString(),
      }),
    },
  );
  assert.equal(death.body.roundEnded, true);
  await call(`/rooms/${room.body.code}/results`, {
    method: "POST",
    body: JSON.stringify({
      roundId: started.body.roundId,
      endedAt: new Date(now).toISOString(),
      endReason: "player_dead",
      players: [{ playerId: "11004", survivalTimeMs: 0 }],
    }),
  });
  const replay = await call<{ status: string; refunded: boolean; balance: number }>(purchasePath, {
    method: "POST",
    headers: { "Idempotency-Key": "executed-purchase" },
    body: JSON.stringify({ spectatorId, eventId: "BANANA_PEELS" }),
  });
  assert.deepEqual(
    [replay.body.status, replay.body.refunded, replay.body.balance],
    ["completed", false, 30],
  );
  const nextRound = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "purchase-executed-next-round" },
    body: JSON.stringify({ players: [{ playerId: "11004" }] }),
  });
  const staleAck = await call(
    `/rooms/${room.body.code}/commands/${purchased.body.commandId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }),
    },
  );
  assert.equal(staleAck.status, 410);
  assert.notEqual(nextRound.body.roundId, started.body.roundId);
});

test("replaces pre-round votes and selects the event with the highest tally", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "vote-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "vote-round" },
    body: JSON.stringify({ players: [{ playerId: "10009" }] }),
  });
  const votePath = `/simulator/rooms/${room.body.code}/rounds/${started.body.roundId}/votes`;
  const vote = (spectatorId: string, eventId: string) =>
    call<{ voteCounts: Record<string, number> }>(votePath, {
      method: "PUT",
      body: JSON.stringify({ spectatorId, eventId }),
    });

  await vote("spectator-1", "GIANT_BOULDER");
  await vote("spectator-2", "GIANT_BOULDER");
  await vote("spectator-3", "FLOOR_IS_LAVA");
  await vote("spectator-4", "FLOOR_IS_LAVA");
  const edited = await vote("spectator-1", "FLOOR_IS_LAVA");
  assert.equal(edited.body.voteCounts.GIANT_BOULDER, 1);
  assert.equal(edited.body.voteCounts.FLOOR_IS_LAVA, 3);

  now += 15_000;
  const selected = await call<{ events: Array<{ type: string; selectionReason: string }> }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`,
  );
  assert.deepEqual(
    [selected.body.events[0]?.type, selected.body.events[0]?.selectionReason],
    ["FLOOR_IS_LAVA", "initial"],
  );

  const lateVote = await vote("spectator-5", "TORNADO");
  assert.equal(lateVote.status, 409);
});

test("stores editable single and multiplayer predictions until the pre-round lock", async () => {
  const singleRoom = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "single-prediction-room" },
    body: "{}",
  });
  const singleRound = await call<{ roundId: string }>(`/rooms/${singleRoom.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "single-prediction-round" },
    body: JSON.stringify({ players: [{ playerId: "10010" }] }),
  });
  const singlePath = `/simulator/rooms/${singleRoom.body.code}/rounds/${singleRound.body.roundId}/predictions`;
  const firstPrediction = await call<{ prediction: { band: string } }>(singlePath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "  prediction-user ", band: "UNDER_30_SECONDS" }),
  });
  assert.deepEqual(firstPrediction.body.prediction, {
    kind: "survival_band",
    band: "UNDER_30_SECONDS",
  });
  const editedPrediction = await call<{ spectatorId: string; prediction: { band: string } }>(singlePath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "prediction-user", band: "90_TO_120_SECONDS" }),
  });
  assert.equal(editedPrediction.body.spectatorId, "prediction-user");
  assert.equal(editedPrediction.body.prediction.band, "90_TO_120_SECONDS");
  const invalidMode = await call(singlePath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "prediction-user", playerId: "10010" }),
  });
  assert.equal(invalidMode.status, 422);

  now += 15_000;
  const lockedPrediction = await call(singlePath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "prediction-user", band: "UNDER_30_SECONDS" }),
  });
  assert.equal(lockedPrediction.status, 409);

  const multiplayerRoom = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "multi-prediction-room" },
    body: "{}",
  });
  const multiplayerRound = await call<{ roundId: string }>(
    `/rooms/${multiplayerRoom.body.code}/rounds`,
    {
      method: "POST",
      headers: { "Idempotency-Key": "multi-prediction-round" },
      body: JSON.stringify({ players: [{ playerId: "10011" }, { playerId: "10012" }] }),
    },
  );
  const multiplayerPath =
    `/simulator/rooms/${multiplayerRoom.body.code}/rounds/${multiplayerRound.body.roundId}/predictions`;
  const invalidBand = await call(multiplayerPath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "prediction-user", band: "UNDER_30_SECONDS" }),
  });
  assert.equal(invalidBand.status, 422);
  const playerPrediction = await call<{ prediction: { kind: string; playerId: string } }>(
    multiplayerPath,
    {
      method: "PUT",
      body: JSON.stringify({ spectatorId: "prediction-user", playerId: "10012" }),
    },
  );
  assert.deepEqual(playerPrediction.body.prediction, {
    kind: "longest_player",
    playerId: "10012",
  });
  const unknownPlayer = await call(multiplayerPath, {
    method: "PUT",
    body: JSON.stringify({ spectatorId: "prediction-user", playerId: "99999" }),
  });
  assert.equal(unknownPlayer.status, 422);
});

test("retries a failed complex event once, falls back, and retries the fallback until execution", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "retry-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "retry-round" },
    body: JSON.stringify({ players: [{ playerId: "10005" }] }),
  });
  const votePath = `/simulator/rooms/${room.body.code}/rounds/${started.body.roundId}/votes`;
  const castVote = (spectatorId: string, eventId: string) =>
    call(votePath, {
      method: "PUT",
      body: JSON.stringify({ spectatorId, eventId }),
    });
  await castVote("retry-voter-1", "GIANT_BOULDER");
  await castVote("retry-voter-2", "GIANT_BOULDER");
  await castVote("retry-voter-3", "GIANT_BOULDER");
  await castVote("retry-voter-4", "GIANT_BOULDER");
  await castVote("retry-voter-5", "GIANT_BOULDER");
  await castVote("retry-voter-6", "TORNADO");
  await castVote("retry-voter-7", "TORNADO");
  await castVote("retry-voter-8", "TORNADO");
  await castVote("retry-voter-9", "TORNADO");
  await castVote("retry-voter-10", "FLOOR_IS_LAVA");
  await castVote("retry-voter-11", "FLOOR_IS_LAVA");
  await castVote("retry-voter-12", "FLOOR_IS_LAVA");
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const first = await call<{ events: Array<{
    commandId: string;
    type: string;
    attemptNumber: number;
    selectionReason: string;
  }> }>(pollPath);
  assert.deepEqual(
    [first.body.events[0]?.type, first.body.events[0]?.attemptNumber, first.body.events[0]?.selectionReason],
    ["GIANT_BOULDER", 1, "initial"],
  );

  async function fail(commandId: string): Promise<void> {
    const response = await call(
      `/rooms/${room.body.code}/commands/${commandId}/acknowledgements`,
      { method: "POST", body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }) },
    );
    assert.equal(response.status, 200);
  }

  await fail(first.body.events[0]!.commandId);
  const retry = await call<{ events: Array<{
    commandId: string;
    type: string;
    attemptNumber: number;
    selectionReason: string;
  }> }>(pollPath);
  assert.deepEqual(
    [retry.body.events[0]?.type, retry.body.events[0]?.attemptNumber, retry.body.events[0]?.selectionReason],
    ["GIANT_BOULDER", 2, "retry"],
  );
  assert.notEqual(retry.body.events[0]?.commandId, first.body.events[0]?.commandId);
  await fail(first.body.events[0]!.commandId);
  const duplicateFailurePoll = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  assert.equal(duplicateFailurePoll.body.events[0]?.commandId, retry.body.events[0]?.commandId);

  await fail(retry.body.events[0]!.commandId);
  const fallback = await call<{ events: Array<{
    commandId: string;
    type: string;
    attemptNumber: number;
    selectionReason: string;
  }> }>(pollPath);
  assert.deepEqual(
    [fallback.body.events[0]?.type, fallback.body.events[0]?.attemptNumber, fallback.body.events[0]?.selectionReason],
    ["TORNADO", 1, "fallback"],
  );

  await fail(fallback.body.events[0]!.commandId);
  const fallbackRetry = await call<{ events: Array<{
    commandId: string;
    type: string;
    attemptNumber: number;
    selectionReason: string;
  }> }>(pollPath);
  assert.deepEqual(
    [
      fallbackRetry.body.events[0]?.type,
      fallbackRetry.body.events[0]?.attemptNumber,
      fallbackRetry.body.events[0]?.selectionReason,
    ],
    ["TORNADO", 2, "retry"],
  );
  const executed = await call(
    `/rooms/${room.body.code}/commands/${fallbackRetry.body.events[0]!.commandId}/acknowledgements`,
    { method: "POST", body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }) },
  );
  assert.equal(executed.status, 200);
});

test("reconciles an expired complex-event command before retrying", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "reconcile-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "reconcile-round" },
    body: JSON.stringify({ players: [{ playerId: "10006" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const first = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  const expiredAt = now + 120_000;
  now = expiredAt;
  const expired = await call<{ events: Array<{ commandId: string; status: string }> }>(pollPath);
  assert.equal(expired.body.events[0]?.commandId, first.body.events[0]?.commandId);
  assert.equal(expired.body.events[0]?.status, "expired");

  const reconciledFailure = await call(
    `/rooms/${room.body.code}/commands/${first.body.events[0]!.commandId}/acknowledgements`,
    { method: "POST", body: JSON.stringify({ roundId: started.body.roundId, status: "failed" }) },
  );
  assert.equal(reconciledFailure.status, 200);
  const retry = await call<{ events: Array<{ commandId: string; status: string; attemptNumber: number }> }>(pollPath);
  assert.notEqual(retry.body.events[0]?.commandId, first.body.events[0]?.commandId);
  assert.equal(retry.body.events[0]?.status, "pending");
  assert.equal(retry.body.events[0]?.attemptNumber, 2);
});

test("reconciles an expired command as executed without creating a retry", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "late-executed-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "late-executed-round" },
    body: JSON.stringify({ players: [{ playerId: "10008" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const first = await call<{ events: Array<{ commandId: string; type: string }> }>(pollPath);
  now += 120_000;
  const expired = await call<{ events: Array<{ status: string }> }>(pollPath);
  assert.equal(expired.body.events[0]?.status, "expired");

  const reconciled = await call(
    `/rooms/${room.body.code}/commands/${first.body.events[0]!.commandId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
    },
  );
  assert.equal(reconciled.status, 200);
  const duplicatePoll = await call<{ events: Array<{ commandId: string; type: string }> }>(pollPath);
  assert.deepEqual(duplicatePoll.body.events.map(({ commandId, type }) => ({ commandId, type })), [
    { commandId: first.body.events[0]?.commandId, type: first.body.events[0]?.type },
  ]);
});

test("ends a round at the server-side 120-second deadline", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "timeout-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "timeout-round" },
    body: JSON.stringify({ players: [{ playerId: "10002", username: "TimeoutPlayer" }] }),
  });
  now += 15_000;
  const polled = await call<{ events: Array<{ commandId: string }> }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`,
  );
  const commandId = polled.body.events[0]!.commandId;
  await call(`/rooms/${room.body.code}/commands/${commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });

  now += 120_000;
  const expiredPoll = await call<{ events: unknown[] }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=${polled.body.events[0] ? 1 : 0}`,
  );
  assert.deepEqual(expiredPoll.body.events, []);

  const result = await call<{ status: string }>(`/rooms/${room.body.code}/results`, {
    method: "POST",
    body: JSON.stringify({
      roundId: started.body.roundId,
      endedAt: new Date(now).toISOString(),
      endReason: "time_limit",
      players: [{ playerId: "10002", survivalTimeMs: 120_000 }],
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "accepted");
});

test("ends multiplayer rounds only after every player dies", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "multiplayer-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "multiplayer-round" },
    body: JSON.stringify({
      players: [
        { playerId: "10003", username: "PlayerA" },
        { playerId: "10004", username: "PlayerB" },
      ],
    }),
  });
  now += 15_000;
  const polled = await call<{ events: Array<{ commandId: string }> }>(
    `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`,
  );
  await call(`/rooms/${room.body.code}/commands/${polled.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });

  const diedAt = new Date(now).toISOString();
  const firstDeath = await call<{ roundEnded: boolean }>(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    { method: "POST", body: JSON.stringify({ playerId: "10003", diedAt }) },
  );
  assert.deepEqual(firstDeath.body, { roundEnded: false });
  const conflictingDeath = await call(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    {
      method: "POST",
      body: JSON.stringify({ playerId: "10003", diedAt: new Date(now + 1).toISOString() }),
    },
  );
  assert.equal(conflictingDeath.status, 409);

  const finalDeath = await call<{ roundEnded: boolean; endReason: string }>(
    `/rooms/${room.body.code}/rounds/${started.body.roundId}/deaths`,
    { method: "POST", body: JSON.stringify({ playerId: "10004", diedAt }) },
  );
  assert.deepEqual(finalDeath.body, { roundEnded: true, endReason: "all_players_dead" });

  const result = await call<{ status: string }>(`/rooms/${room.body.code}/results`, {
    method: "POST",
    body: JSON.stringify({
      roundId: started.body.roundId,
      endedAt: new Date(now).toISOString(),
      endReason: "all_players_dead",
      players: [
        { playerId: "10003", survivalTimeMs: 10_000 },
        { playerId: "10004", survivalTimeMs: 20_000 },
      ],
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "accepted");
});

test("closes an abandoned session and accepts partial results exactly once", async () => {
  const room = await call<{ code: string }>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-room" },
    body: "{}",
  });
  const started = await call<{ roundId: string }>(`/rooms/${room.body.code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-round" },
    body: JSON.stringify({ players: [{ playerId: "10007", username: "LeavingPlayer" }] }),
  });
  now += 15_000;
  const pollPath = `/rooms/${room.body.code}/events?roundId=${started.body.roundId}&since=0`;
  const selected = await call<{ events: Array<{ commandId: string }> }>(pollPath);
  await call(`/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: started.body.roundId, status: "executed" }),
  });

  now += 45_000;
  const closePath = `/rooms/${room.body.code}/close`;
  const closeBody = JSON.stringify({ reason: "all_players_left" });
  const closed = await call<{ code: string; status: string; activeRoundId: string }>(closePath, {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-close" },
    body: closeBody,
  });
  assert.deepEqual(closed.body, {
    code: room.body.code,
    status: "closing",
    activeRoundId: started.body.roundId,
  });
  const closeRetry = await call(closePath, {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-close" },
    body: closeBody,
  });
  assert.deepEqual(closeRetry.body, closed.body);
  const repeatedClose = await call(closePath, {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-close-new-key" },
    body: closeBody,
  });
  assert.deepEqual(repeatedClose.body, closed.body);
  const completion = await call(
    `/rooms/${room.body.code}/commands/${selected.body.events[0]!.commandId}/acknowledgements`,
    {
      method: "POST",
      body: JSON.stringify({ roundId: started.body.roundId, status: "completed" }),
    },
  );
  assert.equal(completion.status, 200);

  const rejectedNextRound = await call(
    `/rooms/${room.body.code}/rounds`,
    {
      method: "POST",
      headers: { "Idempotency-Key": "after-close-round" },
      body: JSON.stringify({ players: [{ playerId: "10007" }] }),
    },
  );
  assert.equal(rejectedNextRound.status, 410);

  const resultsPath = `/rooms/${room.body.code}/results`;
  const resultsBody = {
    roundId: started.body.roundId,
    endedAt: new Date(now).toISOString(),
    endReason: "session_abandoned",
    players: [{ playerId: "10007", survivalTimeMs: 45_000 }],
  };
  const result = await call<{ status: string }>(resultsPath, {
    method: "POST",
    body: JSON.stringify(resultsBody),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "accepted");
  const duplicateResult = await call(resultsPath, { method: "POST", body: JSON.stringify(resultsBody) });
  assert.equal(duplicateResult.status, 200);
  const afterClosed = await call(closePath, {
    method: "POST",
    headers: { "Idempotency-Key": "abandon-close-later" },
    body: closeBody,
  });
  assert.deepEqual(afterClosed.body, {
    code: room.body.code,
    status: "closed",
    activeRoundId: null,
  });
});
