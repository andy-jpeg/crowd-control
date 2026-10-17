import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from "express";
import {
  basicEvents,
  chooseFallbackComplexEvent,
  chooseWinningComplexEvent,
  complexEvents,
  type BasicEventId,
  type ComplexEventId,
} from "./catalog";
import {
  predictionBands,
  type SpectatorPrediction,
} from "./predictions";

const PRE_ROUND_MS = 15_000;
const ROUND_MS = 120_000;
const BASIC_EVENT_COST = 30;
const BASIC_EVENT_DURATION_MS = 10_000;
const MAX_SIMULATOR_BALANCE = 1_000_000;
const MAX_ROUNDS = 10;
const ROOM_CODE_LENGTH = 4;

type Phase = "pre_round" | "selection" | "active" | "closing" | "ended";
type CommandStatus = "pending" | "executed" | "completed" | "failed" | "expired";
type EndReason = "player_dead" | "all_players_dead" | "time_limit" | "session_abandoned";
type SelectionReason = "initial" | "retry" | "fallback";

interface CommandBase {
  id: number;
  commandId: string;
  roundId: string;
  expiresAt: string;
  status: CommandStatus;
}

interface ComplexCommand extends CommandBase {
  type: ComplexEventId;
  category: "complex";
  attemptNumber: number;
  selectionReason: SelectionReason;
}

interface BasicCommand extends CommandBase {
  type: BasicEventId;
  category: "basic";
  purchaseId: string;
  spectatorId: string;
  refunded: boolean;
  activatedAt?: string;
  activationEndsAt?: string;
}

type Command = ComplexCommand | BasicCommand;

interface PlayerResult {
  playerId: string;
  survivalTimeMs: number;
}

interface Round {
  id: string;
  number: number;
  phase: Phase;
  phaseEndsAt: number;
  activeStartedAt?: number;
  endReason?: EndReason;
  players: string[];
  deadPlayers: Set<string>;
  deathTimes: Map<string, string>;
  initialEvent?: ComplexEventId;
  selectedEvent?: ComplexEventId;
  attemptedEvents: Set<ComplexEventId>;
  attemptsByEvent: Map<ComplexEventId, number>;
  votes: Map<ComplexEventId, number>;
  ballots: Map<string, ComplexEventId>;
  predictions: Map<string, SpectatorPrediction>;
  selectionCommand?: ComplexCommand;
  results?: PlayerResult[];
}

interface Room {
  code: string;
  status: "open" | "closing" | "closed";
  rounds: Round[];
  commands: Command[];
  nextCursor: number;
  idempotency: Map<string, { fingerprint: string; response: unknown }>;
  purchaseKeys: Map<string, { fingerprint: string; commandId: string }>;
  balances: Map<string, number>;
}

export interface SimulatorOptions {
  serverToken: string;
  now?: () => number;
  random?: () => number;
  codeRandom?: () => number;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function error(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message, requestId: randomUUID() } });
}

function latestRound(room: Room): Round | undefined {
  return room.rounds.at(-1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPlayerIds(body: unknown): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.players) || body.players.length === 0) return undefined;
  const playerIds: string[] = [];
  for (const player of body.players) {
    if (
      !isRecord(player) ||
      typeof player.playerId !== "string" ||
      !/^[1-9]\d*$/.test(player.playerId) ||
      (player.username !== undefined &&
        (typeof player.username !== "string" || !player.username.trim()))
    ) {
      return undefined;
    }
    playerIds.push(player.playerId);
  }
  return new Set(playerIds).size === playerIds.length ? playerIds : undefined;
}

function enqueueComplexAttempt(
  room: Room,
  round: Round,
  event: ComplexEventId,
  reason: SelectionReason,
  now: number,
): void {
  const attemptNumber = (round.attemptsByEvent.get(event) ?? 0) + 1;
  round.attemptsByEvent.set(event, attemptNumber);
  round.attemptedEvents.add(event);
  round.selectedEvent = event;
  const command: ComplexCommand = {
    id: room.nextCursor++,
    commandId: randomUUID(),
    roundId: round.id,
    type: event,
    category: "complex",
    attemptNumber,
    selectionReason: reason,
    expiresAt: new Date(now + ROUND_MS).toISOString(),
    status: "pending",
  };
  round.selectionCommand = command;
  round.phase = "selection";
  room.commands.push(command);
}

function chooseFallbackEvent(round: Round, random: () => number): ComplexEventId {
  return chooseFallbackComplexEvent(round.votes, round.attemptedEvents, random);
}

function recordComplexFailure(
  room: Room,
  round: Round,
  failedEvent: ComplexEventId,
  now: number,
  random: () => number,
): void {
  const failedAttempts = round.attemptsByEvent.get(failedEvent) ?? 0;
  if (failedEvent === round.initialEvent && failedAttempts === 1) {
    enqueueComplexAttempt(room, round, failedEvent, "retry", now);
    return;
  }
  if (failedEvent === round.initialEvent && failedAttempts === 2) {
    const fallback = chooseFallbackEvent(round, random);
    enqueueComplexAttempt(room, round, fallback, "fallback", now);
    return;
  }
  enqueueComplexAttempt(room, round, failedEvent, "retry", now);
}

function advanceRoom(room: Room, now: number, random: () => number): void {
  const round = latestRound(room);
  if (!round || round.phase === "ended" || round.phase === "closing") return;

  for (const command of room.commands) {
    if (
      command.category === "basic" &&
      command.roundId === round.id &&
      command.status === "executed" &&
      command.activationEndsAt !== undefined &&
      now >= Date.parse(command.activationEndsAt)
    ) {
      command.status = "completed";
    }
  }

  if (round.phase === "pre_round" && now >= round.phaseEndsAt) {
    const event = chooseWinningComplexEvent(round.votes, random);
    round.initialEvent = event;
    enqueueComplexAttempt(room, round, event, "initial", now);
    return;
  }

  if (
    round.phase === "selection" &&
    round.selectionCommand?.status === "pending" &&
    now >= Date.parse(round.selectionCommand.expiresAt)
  ) {
    round.selectionCommand.status = "expired";
    return;
  }

  if (round.phase === "active" && now >= round.phaseEndsAt) {
    round.phase = "ended";
    round.endReason = "time_limit";
    expireRoundCommands(room, round);
  }
}

function expireRoundCommands(room: Room, round: Round): void {
  for (const command of room.commands) {
    if (command.roundId !== round.id) continue;
    if (command.status === "pending") command.status = "expired";
    if (command.status === "executed") command.status = "completed";
  }
}

function commandForRoblox(command: Command): Record<string, unknown> {
  const common = {
    id: command.id,
    commandId: command.commandId,
    roundId: command.roundId,
    type: command.type,
    category: command.category,
    expiresAt: command.expiresAt,
    status: command.status,
  };
  if (command.category === "complex") {
    return {
      ...common,
      attemptNumber: command.attemptNumber,
      selectionReason: command.selectionReason,
    };
  }
  return common;
}

function requireIdempotencyKey(req: Request, res: Response): string | undefined {
  const key = req.header("Idempotency-Key")?.trim();
  if (!key || key.length > 200) {
    error(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
    return undefined;
  }
  return key;
}

function idempotent(
  room: Room,
  operation: string,
  key: string,
  payload: unknown,
  res: Response,
  action: () => { status: number; body: unknown },
): void {
  const id = `${operation}:${key}`;
  const fingerprint = stableJson(payload);
  const previous = room.idempotency.get(id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      error(res, 409, "IDEMPOTENCY_KEY_REUSED", "This key was already used with a different request.");
      return;
    }
    res.status(200).json(previous.response);
    return;
  }
  const outcome = action();
  if (outcome.status < 400) room.idempotency.set(id, { fingerprint, response: outcome.body });
  res.status(outcome.status).json(outcome.body);
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export function createSimulatorApp(options: SimulatorOptions): Express {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The development simulator cannot run when NODE_ENV=production.");
  }
  if (process.env.SIMULATOR_ENABLED !== "true") {
    throw new Error("Set SIMULATOR_ENABLED=true to run the development simulator.");
  }
  if (!options.serverToken || options.serverToken.length < 24) {
    throw new Error("SIMULATOR_SERVER_TOKEN must contain at least 24 characters.");
  }

  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const codeRandom = options.codeRandom ?? (() => randomInt(0, 26) / 26);
  const rooms = new Map<string, Room>();
  const roomCreateKeys = new Map<string, { fingerprint: string; response: unknown }>();
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", mode: "development-simulator" });
  });

  app.use((req, res, next) => {
    const authorization = req.header("Authorization");
    const expected = Buffer.from(`Bearer ${options.serverToken}`);
    const received = Buffer.from(authorization ?? "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      error(res, 401, "UNAUTHENTICATED", "Valid simulator server credentials are required.");
      return;
    }
    next();
  });

  app.post("/rooms", (req, res) => {
    const key = requireIdempotencyKey(req, res);
    if (!key) return;
    const previous = roomCreateKeys.get(key);
    if (previous) {
      if (previous.fingerprint !== stableJson(req.body)) {
        error(res, 409, "IDEMPOTENCY_KEY_REUSED", "This key was already used with a different request.");
        return;
      }
      res.status(200).json(previous.response);
      return;
    }

    let code = "";
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
        String.fromCharCode(65 + Math.floor(codeRandom() * 26)),
      ).join("");
    } while (rooms.has(code));

    const response = { code };
    rooms.set(code, {
      code,
      status: "open",
      rounds: [],
      commands: [],
      nextCursor: 1,
      idempotency: new Map(),
      purchaseKeys: new Map(),
      balances: new Map(),
    });
    roomCreateKeys.set(key, { fingerprint: stableJson(req.body), response });
    res.status(201).json(response);
  });

  app.post("/rooms/:code/close", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const key = requireIdempotencyKey(req, res);
    if (!key) return;
    if (!isRecord(req.body) ||
      (req.body.reason !== "all_players_left" && req.body.reason !== "server_stopped")) {
      error(res, 422, "INVALID_CLOSE_REASON", "Reason must be all_players_left or server_stopped.");
      return;
    }

    idempotent(room, "close-session", key, req.body, res, () => {
      if (room.status === "closed") {
        return {
          status: 200,
          body: { code: room.code, status: "closed", activeRoundId: null },
        };
      }
      const round = latestRound(room);
      if (room.status === "closing" && round?.phase === "closing") {
        return {
          status: 200,
          body: { code: room.code, status: "closing", activeRoundId: round.id },
        };
      }
      if (round?.phase === "active") {
        round.phase = "closing";
        round.endReason = "session_abandoned";
        room.status = "closing";
        expireRoundCommands(room, round);
        return {
          status: 200,
          body: { code: room.code, status: "closing", activeRoundId: round.id },
        };
      }
      if (round && round.phase !== "ended") {
        round.phase = "ended";
        expireRoundCommands(room, round);
      }
      room.status = "closed";
      return {
        status: 200,
        body: { code: room.code, status: "closed", activeRoundId: null },
      };
    });
  });

  app.post("/rooms/:code/rounds", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const key = requireIdempotencyKey(req, res);
    if (!key) return;
    const players = readPlayerIds(req.body);
    if (!players) {
      error(res, 422, "INVALID_PLAYERS", "Provide at least one player with a unique, non-empty player ID.");
      return;
    }

    idempotent(room, "create-round", key, req.body, res, () => {
      if (room.status !== "open") {
        return { status: 410, body: errorBody("SESSION_CLOSED", "The session is closing or closed.") };
      }
      const previousRound = latestRound(room);
      if (previousRound && previousRound.phase !== "ended") {
        return { status: 409, body: errorBody("ROUND_IN_PROGRESS", "The current round has not ended.") };
      }
      if (previousRound && !previousRound.results) {
        return { status: 409, body: errorBody("ROUND_RESULTS_REQUIRED", "Submit the current round results before starting another round.") };
      }
      if (room.rounds.length >= MAX_ROUNDS) {
        return { status: 409, body: errorBody("SESSION_ROUND_LIMIT", "This session already has 10 rounds.") };
      }
      const round: Round = {
        id: randomUUID(),
        number: room.rounds.length + 1,
        phase: "pre_round",
        phaseEndsAt: now() + PRE_ROUND_MS,
        players,
        deadPlayers: new Set(),
        deathTimes: new Map(),
        attemptedEvents: new Set(),
        attemptsByEvent: new Map(),
        votes: new Map(),
        ballots: new Map(),
        predictions: new Map(),
      };
      room.rounds.push(round);
      return {
        status: 201,
        body: {
          roundId: round.id,
          phase: round.phase,
          phaseEndsAt: new Date(round.phaseEndsAt).toISOString(),
        },
      };
    });
  });

  app.get("/simulator/rooms/:code/spectators/:spectatorId/balance", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const spectatorId = req.params.spectatorId.trim();
    if (!spectatorId || spectatorId.length > 128 || !room.balances.has(spectatorId)) {
      error(res, 404, "SIMULATOR_SPECTATOR_NOT_FOUND", "The simulated spectator balance does not exist.");
      return;
    }
    res.json({ spectatorId, balance: room.balances.get(spectatorId) });
  });

  app.put("/simulator/rooms/:code/spectators/:spectatorId/balance", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const spectatorId = req.params.spectatorId.trim();
    const tokens: unknown = req.body?.tokens;
    if (
      !spectatorId ||
      spectatorId.length > 128 ||
      typeof tokens !== "number" ||
      !Number.isSafeInteger(tokens) ||
      tokens < 0 ||
      tokens > MAX_SIMULATOR_BALANCE
    ) {
      error(res, 422, "INVALID_SIMULATOR_BALANCE", "Provide a spectatorId and an integer balance from 0 to 1000000.");
      return;
    }
    if (room.balances.has(spectatorId)) {
      error(res, 409, "SIMULATOR_BALANCE_ALREADY_SET", "A simulated spectator balance can only be seeded once.");
      return;
    }
    room.balances.set(spectatorId, tokens);
    res.status(201).json({ spectatorId, balance: tokens });
  });

  app.put("/simulator/rooms/:code/rounds/:roundId/votes", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    if (room.status !== "open") {
      error(res, 410, "SESSION_CLOSED", "The session is closing or closed.");
      return;
    }
    advanceRoom(room, now(), random);
    const round = latestRound(room);
    if (!round || round.id !== req.params.roundId) {
      error(res, 410, "STALE_ROUND", "The requested round is not current.");
      return;
    }
    if (round.phase !== "pre_round") {
      error(res, 409, "VOTE_LOCKED", "Pre-round voting is locked.");
      return;
    }
    const spectatorId = req.body?.spectatorId;
    const eventId: unknown = req.body?.eventId;
    if (
      typeof spectatorId !== "string" ||
      !spectatorId.trim() ||
      spectatorId.length > 128 ||
      typeof eventId !== "string" ||
      !complexEvents.includes(eventId as ComplexEventId)
    ) {
      error(res, 422, "INVALID_VOTE", "Provide a spectatorId and a valid complex event ID.");
      return;
    }

    const selectedEvent = eventId as ComplexEventId;
    const normalizedSpectatorId = spectatorId.trim();
    const previousVote = round.ballots.get(normalizedSpectatorId);
    if (previousVote !== selectedEvent) {
      if (previousVote) {
        const remaining = (round.votes.get(previousVote) ?? 1) - 1;
        if (remaining > 0) round.votes.set(previousVote, remaining);
        else round.votes.delete(previousVote);
      }
      round.ballots.set(normalizedSpectatorId, selectedEvent);
      round.votes.set(selectedEvent, (round.votes.get(selectedEvent) ?? 0) + 1);
    }
    res.json({
      roundId: round.id,
      spectatorId: normalizedSpectatorId,
      eventId: selectedEvent,
      voteCounts: Object.fromEntries(complexEvents.map((event) => [event, round.votes.get(event) ?? 0])),
    });
  });

  app.put("/simulator/rooms/:code/rounds/:roundId/predictions", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    if (room.status !== "open") {
      error(res, 410, "SESSION_CLOSED", "The session is closing or closed.");
      return;
    }
    advanceRoom(room, now(), random);
    const round = latestRound(room);
    if (!round || round.id !== req.params.roundId) {
      error(res, 410, "STALE_ROUND", "The requested round is not current.");
      return;
    }
    if (round.phase !== "pre_round") {
      error(res, 409, "PREDICTION_LOCKED", "Pre-round predictions are locked.");
      return;
    }
    const spectatorId = req.body?.spectatorId;
    if (typeof spectatorId !== "string" || !spectatorId.trim() || spectatorId.length > 128) {
      error(res, 422, "INVALID_PREDICTION", "Provide a valid spectatorId.");
      return;
    }

    let prediction: SpectatorPrediction;
    if (round.players.length === 1) {
      const band: unknown = req.body?.band;
      if (typeof band !== "string" || !predictionBands.includes(band as (typeof predictionBands)[number])) {
        error(res, 422, "INVALID_PREDICTION", "A single-player round requires a valid survival band.");
        return;
      }
      prediction = { kind: "survival_band", band: band as (typeof predictionBands)[number] };
    } else {
      const playerId: unknown = req.body?.playerId;
      if (typeof playerId !== "string" || !round.players.includes(playerId)) {
        error(res, 422, "INVALID_PREDICTION", "A multiplayer prediction must select a player in this round.");
        return;
      }
      prediction = { kind: "longest_player", playerId };
    }

    const normalizedSpectatorId = spectatorId.trim();
    round.predictions.set(normalizedSpectatorId, prediction);
    res.json({ roundId: round.id, spectatorId: normalizedSpectatorId, prediction });
  });

  app.post("/rooms/:code/rounds/:roundId/purchases", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const key = requireIdempotencyKey(req, res);
    if (!key) return;
    const spectatorIdValue: unknown = req.body?.spectatorId;
    const eventIdValue: unknown = req.body?.eventId;
    if (
      typeof spectatorIdValue !== "string" ||
      !spectatorIdValue.trim() ||
      spectatorIdValue.length > 128
    ) {
      error(res, 422, "INVALID_SPECTATOR", "Provide a valid simulator spectatorId.");
      return;
    }
    const spectatorId = spectatorIdValue.trim();
    const fingerprint = stableJson({
      roundId: req.params.roundId,
      spectatorId,
      eventId: eventIdValue,
    });
    const previous = room.purchaseKeys.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        error(res, 409, "IDEMPOTENCY_KEY_REUSED", "This key was already used with a different purchase.");
        return;
      }
      const command = room.commands.find((item): item is BasicCommand =>
        item.commandId === previous.commandId && item.category === "basic"
      );
      if (!command) {
        error(res, 500, "PURCHASE_RECORD_MISSING", "The simulator could not load the original purchase.");
        return;
      }
      res.json({
        purchaseId: command.purchaseId,
        commandId: command.commandId,
        eventId: command.type,
        status: command.status,
        balance: room.balances.get(command.spectatorId) ?? 0,
        refunded: command.refunded,
        ...(command.activatedAt ? { activatedAt: command.activatedAt } : {}),
        ...(command.activationEndsAt ? { activationEndsAt: command.activationEndsAt } : {}),
      });
      return;
    }
    const eventId = typeof eventIdValue === "string" ? eventIdValue : "";
    if (!basicEvents.includes(eventId as BasicEventId)) {
      error(res, 422, "INVALID_BASIC_EVENT", "Provide a valid basic event ID.");
      return;
    }

    advanceRoom(room, now(), random);
    const round = latestRound(room);
    if (!round || round.id !== req.params.roundId) {
      error(res, 410, "STALE_ROUND", "The requested round is not current.");
      return;
    }
    if (room.status !== "open" || round.phase !== "active") {
      error(res, round.phase === "ended" ? 410 : 409,
        round.phase === "ended" ? "STALE_ROUND" : "PURCHASES_NOT_OPEN",
        "Basic-event purchases are only available during active gameplay.");
      return;
    }
    if (!room.balances.has(spectatorId)) {
      error(res, 403, "SPECTATOR_NOT_FUNDED", "Seed a development-only spectator balance before purchasing.");
      return;
    }
    const balance = room.balances.get(spectatorId)!;
    if (balance < BASIC_EVENT_COST) {
      error(res, 409, "INSUFFICIENT_TOKENS", "The simulated spectator does not have enough tokens.");
      return;
    }
    const selectedEvent = eventId as BasicEventId;
    if (
      (selectedEvent === "INVERTED_CONTROLS" ||
        selectedEvent === "LOW_GRAVITY" ||
        selectedEvent === "SQUID_SCREEN") &&
      room.commands.some((command) =>
        command.category === "basic" &&
        command.roundId === round.id &&
        command.type === selectedEvent &&
        command.status !== "failed" &&
        command.status !== "completed"
      )
    ) {
      error(res, 409, "BASIC_EVENT_LOCKED", "This room-wide event is pending or active.");
      return;
    }

    const command: BasicCommand = {
      id: room.nextCursor++,
      commandId: randomUUID(),
      purchaseId: randomUUID(),
      roundId: round.id,
      type: selectedEvent,
      category: "basic",
      spectatorId,
      expiresAt: new Date(round.phaseEndsAt).toISOString(),
      status: "pending",
      refunded: false,
    };
    room.balances.set(spectatorId, balance - BASIC_EVENT_COST);
    room.commands.push(command);
    room.purchaseKeys.set(key, { fingerprint, commandId: command.commandId });
    res.status(201).json({
      purchaseId: command.purchaseId,
      commandId: command.commandId,
      eventId: command.type,
      status: command.status,
      balance: room.balances.get(spectatorId),
      refunded: command.refunded,
    });
  });

  app.get("/rooms/:code/events", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    if (room.status !== "open") {
      error(res, 410, "SESSION_CLOSED", "The session is closing or closed.");
      return;
    }
    const roundId = req.query.roundId;
    const since = req.query.since ?? "0";
    if (typeof roundId !== "string" || !/^(0|[1-9]\d*)$/.test(String(since))) {
      error(res, 400, "INVALID_POLL_CURSOR", "Provide roundId and a non-negative integer since cursor.");
      return;
    }
    advanceRoom(room, now(), random);
    const round = latestRound(room);
    if (!round || round.id !== roundId) {
      error(res, 410, "STALE_ROUND", "The requested round is not the current round.");
      return;
    }
    const cursor = Number(since);
    if (!Number.isSafeInteger(cursor)) {
      error(res, 400, "INVALID_POLL_CURSOR", "The since cursor must be a safe non-negative integer.");
      return;
    }
    const command = round.selectionCommand;
    const commands: Command[] = command &&
      (command.status === "pending" || command.status === "executed" || command.status === "expired")
      ? [command]
      : [];
    commands.push(...room.commands.filter((item) =>
      item.category === "basic" &&
      item.roundId === round.id &&
      (item.status === "pending" || item.status === "executed" || item.status === "expired")
    ));
    commands.sort((left, right) => left.id - right.id);
    const events = commands.map(commandForRoblox);
    res.json({
      events,
      nextSince: commands.reduce((latest, event) => Math.max(latest, event.id), cursor),
    });
  });

  app.post("/rooms/:code/commands/:commandId/acknowledgements", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const round = latestRound(room);
    if (!round || round.id !== req.body?.roundId) {
      error(res, 410, "STALE_ROUND", "The acknowledgement is for a stale round.");
      return;
    }
    advanceRoom(room, now(), random);
    const command = room.commands.find((item) => item.commandId === req.params.commandId);
    if (!command || command.roundId !== round.id) {
      error(res, 404, "COMMAND_NOT_FOUND", "The command does not exist in this round.");
      return;
    }
    const status: unknown = req.body?.status;
    if (status !== "executed" && status !== "completed" && status !== "failed") {
      error(res, 422, "INVALID_COMMAND_STATUS", "Acknowledgement status must be executed, completed, or failed.");
      return;
    }
    if (command.status === status) {
      res.json({ commandId: command.commandId, roundId: round.id, status: command.status });
      return;
    }
    const currentSelection = command.category === "complex" &&
      round.phase === "selection" &&
      command === round.selectionCommand;
    const canReconcileExpired = command.status === "expired" &&
      (currentSelection || command.category === "basic") &&
      (status === "executed" || status === "failed");
    if (
      command.status !== "pending" &&
      !(command.status === "executed" && status === "completed") &&
      !canReconcileExpired
    ) {
      error(res, 409, "COMMAND_STATE_CONFLICT", "The acknowledgement conflicts with the current command state.");
      return;
    }
    if (status === "executed") {
      if (command.category === "basic") {
        if (command.status === "pending" && (round.phase !== "active" || room.status !== "open")) {
          error(res, 409, "ROUND_NOT_READY", "A basic event can only execute during an active round.");
          return;
        }
        const activatedAtValue: unknown = req.body?.activatedAt;
        const activatedAt = typeof activatedAtValue === "string" ? Date.parse(activatedAtValue) : NaN;
        if (
          !Number.isFinite(activatedAt) ||
          round.activeStartedAt === undefined ||
          activatedAt < round.activeStartedAt ||
          activatedAt > now() ||
          activatedAt > round.phaseEndsAt
        ) {
          error(res, 422, "INVALID_ACTIVATION_TIME", "Provide an actual activation time within this active round.");
          return;
        }
        command.status = "executed";
        command.activatedAt = new Date(activatedAt).toISOString();
        command.activationEndsAt = new Date(
          Math.min(activatedAt + BASIC_EVENT_DURATION_MS, round.phaseEndsAt),
        ).toISOString();
        if (round.phase !== "active" || room.status !== "open") {
          command.status = "completed";
        }
      } else if (!currentSelection) {
        error(res, 409, "ROUND_NOT_READY", "The complex-event command cannot execute in the current phase.");
        return;
      } else {
        command.status = "executed";
        round.phase = "active";
        round.activeStartedAt = now();
        round.phaseEndsAt = round.activeStartedAt + ROUND_MS;
      }
    } else if (status === "completed") {
      if (command.category === "basic") {
        const activatedAt = command.activatedAt ? Date.parse(command.activatedAt) : 0;
        if (
          command.status !== "executed" ||
          (round.phase !== "ended" && round.phase !== "closing" && now() < activatedAt + BASIC_EVENT_DURATION_MS)
        ) {
          error(res, 409, "BASIC_EVENT_STILL_ACTIVE", "The basic event cannot complete before its 10-second activation ends.");
          return;
        }
        command.status = "completed";
      } else {
        if (round.phase !== "ended" && round.phase !== "closing") {
          error(res, 409, "ROUND_NOT_ENDED", "Complex events run until the round ends.");
          return;
        }
        command.status = "completed";
      }
    } else {
      command.status = "failed";
      if (command.category === "basic") {
        if (!command.refunded) {
          room.balances.set(
            command.spectatorId,
            (room.balances.get(command.spectatorId) ?? 0) + BASIC_EVENT_COST,
          );
          command.refunded = true;
        }
      } else {
        recordComplexFailure(room, round, command.type, now(), random);
      }
    }
    res.json({ commandId: command.commandId, roundId: round.id, status: command.status });
  });

  app.post("/rooms/:code/rounds/:roundId/deaths", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    advanceRoom(room, now(), random);
    const round = latestRound(room);
    const playerId = req.body?.playerId;
    const diedAt = req.body?.diedAt;
    if (!round || round.id !== req.params.roundId) {
      error(res, 410, "STALE_ROUND", "The requested round is not current.");
      return;
    }
    if (typeof diedAt !== "string" || !Number.isFinite(Date.parse(diedAt))) {
      error(res, 422, "INVALID_DEATH_TIME", "Provide a valid diedAt timestamp.");
      return;
    }
    if (typeof playerId !== "string" || !round.players.includes(playerId)) {
      error(res, 422, "PLAYER_NOT_IN_ROUND", "The player is not in this round's roster.");
      return;
    }
    if (round.deadPlayers.has(playerId)) {
      if (Date.parse(round.deathTimes.get(playerId)!) !== Date.parse(diedAt)) {
        error(res, 409, "DEATH_CONFLICT", "A different death time was already recorded for this player.");
        return;
      }
      res.json({
        roundEnded: round.phase === "ended",
        ...(round.phase === "ended" && round.endReason ? { endReason: round.endReason } : {}),
      });
      return;
    }
    if (round.phase !== "active") {
      error(res, round.phase === "ended" ? 410 : 409,
        round.phase === "ended" ? "STALE_ROUND" : "ROUND_NOT_ACTIVE",
        "Deaths can only be recorded during an active round.");
      return;
    }
    round.deadPlayers.add(playerId);
    round.deathTimes.set(playerId, new Date(Date.parse(diedAt)).toISOString());
    const allDead = round.deadPlayers.size === round.players.length;
    if (allDead) {
      round.phase = "ended";
      round.endReason = round.players.length === 1 ? "player_dead" : "all_players_dead";
      expireRoundCommands(room, round);
    }
    res.json({
      roundEnded: allDead,
      ...(allDead ? { endReason: round.endReason } : {}),
    });
  });

  app.post("/rooms/:code/results", (req, res) => {
    const room = rooms.get(req.params.code);
    if (!room) {
      error(res, 404, "ROOM_NOT_FOUND", "The room does not exist.");
      return;
    }
    const round = latestRound(room);
    if (!round || round.id !== req.body?.roundId) {
      error(res, 410, "STALE_ROUND", "The result is for a stale round.");
      return;
    }
    advanceRoom(room, now(), random);
    const abandoningRound = room.status === "closing" &&
      round.phase === "closing" &&
      round.endReason === "session_abandoned" &&
      round.activeStartedAt !== undefined;
    if ((!abandoningRound && round.phase !== "ended") || !round.endReason) {
      error(res, 409, "ROUND_NOT_ENDED", "Results can only be submitted after the round ends.");
      return;
    }
    const resultBody = isRecord(req.body) ? req.body : {};
    const { players, endReason, endedAt } = resultBody;
    if (
      endReason !== round.endReason ||
      typeof endedAt !== "string" ||
      !Number.isFinite(Date.parse(endedAt)) ||
      !Array.isArray(players) ||
      players.length !== round.players.length
    ) {
      error(res, 422, "INVALID_RESULTS", "Results must include the round roster and authoritative end reason.");
      return;
    }
    const byId = new Map<string, number>();
    for (const entry of players) {
      if (
        !isRecord(entry) ||
        typeof entry.playerId !== "string" ||
        !round.players.includes(entry.playerId) ||
        byId.has(entry.playerId) ||
        typeof entry.survivalTimeMs !== "number" ||
        !Number.isInteger(entry.survivalTimeMs) ||
        entry.survivalTimeMs < 0 ||
        entry.survivalTimeMs > ROUND_MS
      ) {
        error(res, 422, "INVALID_RESULTS", "Each roster player needs one survival time from 0 to 120000 milliseconds.");
        return;
      }
      byId.set(entry.playerId, entry.survivalTimeMs);
    }
    if (byId.size !== round.players.length) {
      error(res, 422, "INVALID_RESULTS", "Results must include every player in the round roster.");
      return;
    }
    const normalized = round.players.map((playerId) => ({
      playerId,
      survivalTimeMs: byId.get(playerId)!,
    }));
    if (round.results) {
      if (stableJson(round.results) !== stableJson(normalized)) {
        error(res, 409, "RESULTS_CONFLICT", "Different results were already recorded for this round.");
        return;
      }
      res.json({ roundId: round.id, status: "accepted" });
      return;
    }
    round.results = normalized;
    round.phase = "ended";
    expireRoundCommands(room, round);
    if (room.status === "closing" && round.endReason === "session_abandoned") {
      room.status = "closed";
    }
    res.json({ roundId: round.id, status: "accepted" });
  });

  const errors: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof SyntaxError) {
      error(res, 400, "INVALID_JSON", "Request body must be valid JSON.");
      return;
    }
    console.error("Simulator request failed:", err);
    error(res, 500, "INTERNAL_ERROR", "The simulator could not process the request.");
  };
  app.use(errors);
  return app;
}
