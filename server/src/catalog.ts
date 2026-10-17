export const basicEvents = [
  "BOMBS",
  "SPRING_TRAPS",
  "SLIME_PUDDLES",
  "BANANA_PEELS",
  "INVERTED_CONTROLS",
  "LOW_GRAVITY",
  "SQUID_SCREEN",
] as const;

export type BasicEventId = (typeof basicEvents)[number];

export const complexEvents = [
  "GIANT_BOULDER",
  "FLOOR_IS_LAVA",
  "TORNADO",
  "GIANT_BLOB_FIGHT",
  "TSUNAMI",
  "FLOOD_ESCAPE",
  "OBBY_CHASE",
  "SHRINKING_PODIUM",
] as const;

export type ComplexEventId = (typeof complexEvents)[number];

export function chooseComplexEvent(random: () => number = Math.random): ComplexEventId {
  return chooseFrom(complexEvents, random);
}

export function chooseWinningComplexEvent(
  votes: ReadonlyMap<ComplexEventId, number>,
  random: () => number = Math.random,
): ComplexEventId {
  if (votes.size === 0) return chooseComplexEvent(random);
  const highestVoteCount = Math.max(...votes.values());
  const winners = [...votes]
    .filter(([, count]) => count === highestVoteCount)
    .map(([event]) => event);
  return chooseFrom(winners, random);
}

export function chooseFallbackComplexEvent(
  votes: ReadonlyMap<ComplexEventId, number>,
  triedEvents: ReadonlySet<ComplexEventId>,
  random: () => number = Math.random,
): ComplexEventId {
  const untried = complexEvents.filter((event) => !triedEvents.has(event));
  if (untried.length === 0) {
    throw new Error("No untried complex events remain.");
  }
  const highestVoteCount = Math.max(...untried.map((event) => votes.get(event) ?? 0));
  const candidates = highestVoteCount > 0
    ? untried.filter((event) => (votes.get(event) ?? 0) === highestVoteCount)
    : untried;
  return chooseFrom(candidates, random);
}

function chooseFrom<T>(items: readonly T[], random: () => number): T {
  const value = random();
  const index = Number.isFinite(value)
    ? Math.min(items.length - 1, Math.max(0, Math.floor(value * items.length)))
    : 0;
  return items[index]!;
}
