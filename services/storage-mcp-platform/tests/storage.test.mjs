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

async function createWeaviateApp() {
  const dir = await mkdtemp(path.join(tmpdir(), "storage-mcp-weaviate-test-"));
  const objects = new Map();
  let schemaCreated = false;
  const className = "AkiraTestVectorItem";
  const fetchCalls = [];
  const fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), method: options.method || "GET" });
    const resource = String(url).replace("http://weaviate.test", "");
    if (resource === `/v1/schema/${className}` && !schemaCreated) {
      return new Response("missing", { status: 404 });
    }
    if (resource === `/v1/schema/${className}`) {
      return Response.json({ class: className });
    }
    if (resource === "/v1/schema" && options.method === "POST") {
      schemaCreated = true;
      return Response.json({ class: className });
    }
    if (resource.startsWith(`/v1/objects/${className}/`) && options.method === "PUT") {
      const id = resource.split("/").pop();
      const body = JSON.parse(options.body);
      objects.set(id, { id, ...body.properties });
      return Response.json({ id });
    }
    if (resource.startsWith(`/v1/objects/${className}/`) && options.method === "DELETE") {
      const id = resource.split("/").pop();
      objects.delete(id);
      return new Response(null, { status: 204 });
    }
    if (resource === "/v1/graphql" && options.method === "POST") {
      const body = JSON.parse(options.body);
      const namespace = body.query.match(/valueText:\s*"([^"]+)"/)?.[1];
      const query = body.query.match(/bm25:\s*\{\s*query:\s*"([^"]+)"/)?.[1];
      const hits = [...objects.values()]
        .filter((item) => item.namespace === namespace)
        .filter((item) => !query || item.text.toLowerCase().includes("research") || item.text.toLowerCase().includes("agent"))
        .map((item) => ({
          itemId: item.itemId,
          text: item.text,
          metadataJson: item.metadataJson,
          updatedAt: item.updatedAt,
          _additional: { id: item.id, score: query ? 0.91 : 0 },
        }));
      return Response.json({ data: { Get: { [className]: hits } } });
    }
    return Response.json({ error: "unexpected fake weaviate request" }, { status: 500 });
  };
  const service = createStorageService({
    dataDir: dir,
    backend: "weaviate",
    weaviateUrl: "http://weaviate.test",
    weaviateClassName: className,
    fetch,
  });
  await service.init();
  return {
    service,
    fetchCalls,
    async close() {
      await service.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("storage service persists tasks, events, artifacts, and vectors", async () => {
  const app = await createApp();
  try {
    assert.equal(app.service.capabilities.defaultBackend, "disk");
    assert.equal(app.service.capabilities.documentBackend, "disk");
    assert.equal(app.service.capabilities.vectorBackend, "disk");

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

test("local backend alias uses disk persistence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "storage-mcp-local-test-"));
  const service = createStorageService({ dataDir: dir, backend: "local" });
  try {
    await service.init();
    assert.equal(service.capabilities.defaultBackend, "disk");
    assert.equal(service.capabilities.vectorMode, "disk-term-index");
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("weaviate backend keeps documents local and uses vectorless HTTP BM25 search", async () => {
  const app = await createWeaviateApp();
  try {
    assert.equal(app.service.capabilities.defaultBackend, "weaviate");
    assert.equal(app.service.capabilities.documentBackend, "disk");
    assert.equal(app.service.capabilities.vectorBackend, "weaviate");
    assert.equal(app.service.capabilities.hybrid, true);
    assert.equal(app.service.capabilities.vectorMode, "weaviate-bm25-vectorless-http");

    await app.service.api.upsertTask("task_2", { state: "working" });
    const task = await app.service.api.getTask("task_2");
    assert.equal(task.taskId, "task_2");

    await app.service.api.upsertVectorItems("task_2", [
      { id: "src1", text: "openai research agent orchestration", metadata: { source: "test" } },
    ]);
    const results = await app.service.api.queryVectorItems("task_2", "research agent", 3);
    assert.equal(results.items[0].id, "src1");
    assert.equal(results.items[0].metadata.source, "test");

    const deleted = await app.service.api.deleteVectorItems("task_2", ["src1"]);
    assert.equal(deleted.deleted, 1);
    assert.ok(app.fetchCalls.some((call) => call.url.endsWith("/v1/schema")));
  } finally {
    await app.close();
  }
});
