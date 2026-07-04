import test from "node:test";
import assert from "node:assert/strict";
import { interpretCommand } from "./server.mjs";

test("dashboard voice command parsing recognizes wake-word actions", () => {
  assert.deepEqual(interpretCommand("AKIRA pause the task"), { action: "pause" });
  assert.deepEqual(interpretCommand("AKIRA priority high"), { action: "reprioritize", priority: "high" });
  assert.equal(interpretCommand("hello there"), null);
});
