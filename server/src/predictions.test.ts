import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getPredictionBand,
  isCorrectPrediction,
} from "./predictions";

test("prediction bands have adjacent, non-overlapping millisecond boundaries", () => {
  assert.equal(getPredictionBand(0), "UNDER_30_SECONDS");
  assert.equal(getPredictionBand(29_999), "UNDER_30_SECONDS");
  assert.equal(getPredictionBand(30_000), "30_TO_UNDER_60_SECONDS");
  assert.equal(getPredictionBand(59_999), "30_TO_UNDER_60_SECONDS");
  assert.equal(getPredictionBand(60_000), "60_TO_UNDER_90_SECONDS");
  assert.equal(getPredictionBand(89_999), "60_TO_UNDER_90_SECONDS");
  assert.equal(getPredictionBand(90_000), "90_TO_120_SECONDS");
  assert.equal(getPredictionBand(120_000), "90_TO_120_SECONDS");
  assert.equal(getPredictionBand(-1), undefined);
  assert.equal(getPredictionBand(120_001), undefined);
});

test("grades a single-player prediction from authoritative survival time", () => {
  assert.equal(
    isCorrectPrediction(
      { kind: "survival_band", band: "30_TO_UNDER_60_SECONDS" },
      [{ playerId: "123", survivalTimeMs: 30_000 }],
    ),
    true,
  );
  assert.equal(
    isCorrectPrediction(
      { kind: "survival_band", band: "UNDER_30_SECONDS" },
      [{ playerId: "123", survivalTimeMs: 30_000 }],
    ),
    false,
  );
});

test("multiplayer prediction accepts any player tied for longest survival", () => {
  const results = [
    { playerId: "123", survivalTimeMs: 60_000 },
    { playerId: "456", survivalTimeMs: 60_000 },
    { playerId: "789", survivalTimeMs: 30_000 },
  ];
  assert.equal(isCorrectPrediction({ kind: "longest_player", playerId: "123" }, results), true);
  assert.equal(isCorrectPrediction({ kind: "longest_player", playerId: "456" }, results), true);
  assert.equal(isCorrectPrediction({ kind: "longest_player", playerId: "789" }, results), false);
});
