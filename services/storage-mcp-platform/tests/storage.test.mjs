import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStorageService } from "../app.mjs";

async function createApp() {
  const dir = await mkdtemp(path.join(tmpdir(), "storage-mcp-test-"));
  const service = createStorageService({ dataDir: dir });
  await service.init();
  return {
    service,
    async close() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

test("storage service persists tasks, events, artifacts, and vectors", async () => {
  const app = await createApp();
  try {
    const task = await app.service.api.upsertTask("task_1", { state: "working", stage: "retrieve" });
    assert.equal(task.taskId, "task_1");

    await app.service.api.appendEvent({
      specversion: "1.0",
      id: "evt_1",
      source: "test",
      type: "machine",
      time: new Date().toISOString(),
      data: {
        task_id: "task_1",
        run_id: "run_1",
        event_seq: 1,
        state: "TASK_STATE_WORKING",
        audience: "machine"
      }
    });

    const events = await app.service.api.getTaskEvents("task_1");
    assert.equal(events.length, 1);

    await app.service.api.saveArtifact("task_1", "script", { title: "Draft script" });
    const artifacts = await app.service.api.listArtifacts("task_1");
    assert.equal(artifacts.length, 1);

    await app.service.api.upsertVectorItems("task_1", [{ id: "src1", text: "openai launches new research agent platform" }]);
    const vectorResults = await app.service.api.queryVectorItems("task_1", "research agent");
    assert.equal(vectorResults.items[0].id, "src1");
  } finally {
    await app.close();
  }
});
