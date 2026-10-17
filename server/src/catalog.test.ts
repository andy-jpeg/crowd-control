import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseFallbackComplexEvent,
  chooseWinningComplexEvent,
} from "./catalog";

test("chooses a complex event with the most votes", () => {
  const votes = new Map([
    ["GIANT_BOULDER", 2],
    ["FLOOR_IS_LAVA", 3],
    ["TORNADO", 1],
  ] as const);
  assert.equal(chooseWinningComplexEvent(votes, () => 0), "FLOOR_IS_LAVA");
});

test("randomly resolves a tie for the most votes", () => {
  const votes = new Map([
    ["GIANT_BOULDER", 3],
    ["FLOOR_IS_LAVA", 1],
    ["TORNADO", 3],
  ] as const);
  assert.equal(chooseWinningComplexEvent(votes, () => 0.75), "TORNADO");
});

test("randomly chooses a complex event when there are no votes", () => {
  assert.equal(chooseWinningComplexEvent(new Map(), () => 0), "GIANT_BOULDER");
});

test("chooses the highest-voted untried complex event", () => {
  const votes = new Map([
    ["GIANT_BOULDER", 12],
    ["FLOOR_IS_LAVA", 7],
    ["TORNADO", 3],
  ] as const);
  const tried = new Set(["GIANT_BOULDER"] as const);
  assert.equal(chooseFallbackComplexEvent(votes, tried, () => 0), "FLOOR_IS_LAVA");
});

test("randomly resolves ties among highest-voted untried events", () => {
  const votes = new Map([
    ["GIANT_BOULDER", 12],
    ["FLOOR_IS_LAVA", 7],
    ["TORNADO", 7],
  ] as const);
  const tried = new Set(["GIANT_BOULDER"] as const);
  assert.equal(chooseFallbackComplexEvent(votes, tried, () => 0.75), "TORNADO");
});

test("randomly chooses an untried event if no untried event has votes", () => {
  const votes = new Map([["GIANT_BOULDER", 5]] as const);
  const tried = new Set(["GIANT_BOULDER"] as const);
  assert.equal(chooseFallbackComplexEvent(votes, tried, () => 0), "FLOOR_IS_LAVA");
});
