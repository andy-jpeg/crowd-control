export const predictionBands = [
  "UNDER_30_SECONDS",
  "30_TO_UNDER_60_SECONDS",
  "60_TO_UNDER_90_SECONDS",
  "90_TO_120_SECONDS",
] as const;

export type PredictionBand = (typeof predictionBands)[number];

export type SpectatorPrediction =
  | { kind: "survival_band"; band: PredictionBand }
  | { kind: "longest_player"; playerId: string };

export interface PlayerSurvivalResult {
  playerId: string;
  survivalTimeMs: number;
}

export function getPredictionBand(survivalTimeMs: number): PredictionBand | undefined {
  if (!Number.isInteger(survivalTimeMs) || survivalTimeMs < 0 || survivalTimeMs > 120_000) {
    return undefined;
  }
  if (survivalTimeMs < 30_000) return "UNDER_30_SECONDS";
  if (survivalTimeMs < 60_000) return "30_TO_UNDER_60_SECONDS";
  if (survivalTimeMs < 90_000) return "60_TO_UNDER_90_SECONDS";
  return "90_TO_120_SECONDS";
}

export function isCorrectPrediction(
  prediction: SpectatorPrediction,
  results: readonly PlayerSurvivalResult[],
): boolean {
  if (prediction.kind === "survival_band") {
    return results.length === 1 &&
      getPredictionBand(results[0]!.survivalTimeMs) === prediction.band;
  }
  if (results.length < 2) return false;
  const longestTime = Math.max(...results.map(({ survivalTimeMs }) => survivalTimeMs));
  return results.some(
    ({ playerId, survivalTimeMs }) =>
      playerId === prediction.playerId && survivalTimeMs === longestTime,
  );
}
