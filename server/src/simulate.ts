const baseUrl = `http://${process.env.SIMULATOR_HOST ?? "127.0.0.1"}:${process.env.SIMULATOR_PORT ?? 3000}`;
const token = process.env.SIMULATOR_SERVER_TOKEN;
const playerId = process.env.SIMULATOR_PLAYER_ID ?? "12345678";

if (!token) {
  throw new Error("Set SIMULATOR_SERVER_TOKEN before running the simulator client.");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json() as T | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const failure = body as { error?: { code?: string; message?: string } };
    throw new Error(`${response.status} ${failure.error?.code ?? "REQUEST_FAILED"}: ${failure.error?.message ?? "Simulator request failed."}`);
  }
  return body as T;
}

async function waitForPreRoundToEnd(deadline: string): Promise<void> {
  const delay = Date.parse(deadline) - Date.now();
  if (delay > 0) {
    console.log(`Waiting ${Math.ceil(delay / 1000)} seconds for the 15-second pre-round phase...`);
    await new Promise((resolve) => setTimeout(resolve, delay + 50));
  }
}

interface RoomResponse {
  code: string;
}

interface RoundResponse {
  roundId: string;
  phase: string;
  phaseEndsAt: string;
}

interface EventResponse {
  events: Array<{ id: number; commandId: string; roundId: string; type: string; status: string }>;
  nextSince: number;
}

async function main(): Promise<void> {
  const { code } = await request<RoomResponse>("/rooms", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: "{}",
  });
  const round = await request<RoundResponse>(`/rooms/${code}/rounds`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ players: [{ playerId, username: "SimPlayer" }] }),
  });
  console.log(`Room ${code}, round ${round.roundId}: ${round.phase}`);

  await waitForPreRoundToEnd(round.phaseEndsAt);
  const polled = await request<EventResponse>(
    `/rooms/${code}/events?roundId=${encodeURIComponent(round.roundId)}&since=0`,
  );
  const event = polled.events[0];
  if (!event) throw new Error("The complex-event selection command was not available.");
  console.log(`Selected complex event: ${event.type} (${event.commandId})`);

  await request(`/rooms/${code}/commands/${event.commandId}/acknowledgements`, {
    method: "POST",
    body: JSON.stringify({ roundId: round.roundId, status: "executed" }),
  });
  console.log("Acknowledged event execution; starting the 120-second survival timer.");

  const death = await request<{ roundEnded: boolean; endReason?: string }>(
    `/rooms/${code}/rounds/${round.roundId}/deaths`,
    { method: "POST", body: JSON.stringify({ playerId, diedAt: new Date().toISOString() }) },
  );
  if (!death.roundEnded) throw new Error("Single-player death did not end the simulated round.");

  await request(`/rooms/${code}/results`, {
    method: "POST",
    body: JSON.stringify({
      roundId: round.roundId,
      endedAt: new Date().toISOString(),
      endReason: death.endReason,
      players: [{ playerId, survivalTimeMs: 0 }],
    }),
  });
  console.log(`Round ended (${death.endReason}); authoritative result accepted.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
