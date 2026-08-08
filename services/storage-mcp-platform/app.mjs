import { createServer as createHttpServer } from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeObservability } from "../../packages/observability/node.mjs";
import { createStorageBackends } from "./backends.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data/storage");

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export function createStorageService(options = {}) {
  const dataDir = path.resolve(options.dataDir || defaultDataDir);
  const observability = createNodeObservability({ serviceName: "storage-mcp-platform" });
  const backends = createStorageBackends({ ...options, dataDir });

  async function init() {
    await Promise.all(backends.stores.map((store) => store.init()));
  }

  async function upsertTask(taskId, task) {
    return backends.documentStore.upsertTask(taskId, task);
  }

  async function getTask(taskId) {
    return backends.documentStore.getTask(taskId);
  }

  async function listTasks() {
    return backends.documentStore.listTasks();
  }

  async function getTaskEvents(taskId, fromSeq = 0) {
    return backends.documentStore.getTaskEvents(taskId, fromSeq);
  }

  async function appendEvent(event) {
    return backends.documentStore.appendEvent(event);
  }

  async function saveArtifact(taskId, artifactId, artifact) {
    return backends.documentStore.saveArtifact(taskId, artifactId, artifact);
  }

  async function listArtifacts(taskId) {
    return backends.documentStore.listArtifacts(taskId);
  }

  async function upsertVectorItems(namespace, items) {
    return backends.vectorStore.upsertVectorItems(namespace, items);
  }

  async function queryVectorItems(namespace, query, limit = 5) {
    return backends.vectorStore.queryVectorItems(namespace, query, limit);
  }

  async function deleteVectorItems(namespace, ids = []) {
    return backends.vectorStore.deleteVectorItems(namespace, ids);
  }

  async function purgeTask(taskId, options = {}) {
    const include = {
      events: options.events !== false,
      artifacts: options.artifacts !== false,
      vectors: options.vectors !== false,
      task: options.task === true
    };
    await backends.documentStore.purgeTask(taskId, {
      ...include,
      vectors: backends.documentStore === backends.vectorStore ? include.vectors : false,
    });
    if (include.vectors && backends.documentStore !== backends.vectorStore) {
      await backends.vectorStore.deleteVectorItems(taskId, []);
    }
    return { taskId, include };
  }

  const routes = async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    observability.incCounter("akira_http_requests_total", 1, { service: "storage-mcp-platform", method: req.method, route: url.pathname });
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        void observability.log({
          logLevel: "INFO",
          className: "StorageService",
          message: "health requested",
          threadName: "storage.http",
          threadNumber: 10
        });
        return jsonResponse(res, 200, { ok: true, service: "storage-mcp-platform", backend: backends.activeBackend });
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        observability.setGauge("akira_storage_task_count", (await listTasks()).length, { service: "storage-mcp-platform" });
        const body = observability.renderMetrics();
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/capabilities") {
        return jsonResponse(res, 200, backends.capabilities);
      }

      if (req.method === "GET" && url.pathname === "/v1/tasks") {
        return jsonResponse(res, 200, { tasks: await listTasks() });
      }

      if (req.method === "PUT" && /^\/v1\/tasks\/[^/]+$/.test(url.pathname)) {
        const taskId = decodeURIComponent(url.pathname.split("/").pop());
        const body = await readJson(req);
        observability.incCounter("akira_storage_tasks_written_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await upsertTask(taskId, body));
      }

      if (req.method === "GET" && /^\/v1\/tasks\/[^/]+$/.test(url.pathname)) {
        const taskId = decodeURIComponent(url.pathname.split("/").pop());
        const task = await getTask(taskId);
        if (!task) {
          return jsonResponse(res, 404, { error: "task not found" });
        }
        return jsonResponse(res, 200, task);
      }

      if (req.method === "POST" && url.pathname === "/v1/events") {
        const body = await readJson(req);
        observability.incCounter("akira_storage_events_written_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await appendEvent(body));
      }

      if (req.method === "GET" && url.pathname === "/v1/events") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) {
          return jsonResponse(res, 400, { error: "taskId is required" });
        }
        const fromSeq = Number(url.searchParams.get("fromSeq") || 0);
        return jsonResponse(res, 200, {
          taskId,
          events: await getTaskEvents(taskId, fromSeq)
        });
      }

      if (req.method === "PUT" && /^\/v1\/artifacts\/[^/]+\/[^/]+$/.test(url.pathname)) {
        const [, , , taskId, artifactId] = url.pathname.split("/");
        const body = await readJson(req);
        observability.incCounter("akira_storage_artifacts_written_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await saveArtifact(taskId, artifactId, body));
      }

      if (req.method === "GET" && /^\/v1\/artifacts\/[^/]+$/.test(url.pathname)) {
        const taskId = decodeURIComponent(url.pathname.split("/").pop());
        return jsonResponse(res, 200, {
          taskId,
          artifacts: await listArtifacts(taskId)
        });
      }

      if (req.method === "POST" && url.pathname === "/v1/vector/upsert") {
        const body = await readJson(req);
        observability.incCounter("akira_storage_vector_upserts_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await upsertVectorItems(body.namespace, body.items || []));
      }

      if (req.method === "POST" && url.pathname === "/v1/vector/query") {
        const body = await readJson(req);
        observability.incCounter("akira_storage_vector_queries_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await queryVectorItems(body.namespace, body.query, body.limit));
      }

      if (req.method === "POST" && url.pathname === "/v1/vector/delete") {
        const body = await readJson(req);
        observability.incCounter("akira_storage_vector_deletes_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await deleteVectorItems(body.namespace, body.ids || []));
      }

      if (req.method === "POST" && url.pathname === "/v1/purge") {
        const body = await readJson(req);
        observability.incCounter("akira_storage_purge_total", 1, { service: "storage-mcp-platform" });
        return jsonResponse(res, 200, await purgeTask(body.taskId, body.include || {}));
      }

      jsonResponse(res, 404, { error: "not found" });
    } catch (error) {
      observability.incCounter("akira_http_errors_total", 1, { service: "storage-mcp-platform", method: req.method, route: url.pathname });
      void observability.log({
        logLevel: "ERROR",
        className: "StorageService",
        message: `request failed: ${error.message}`,
        threadName: "storage.http",
        threadNumber: 10
      });
      jsonResponse(res, 500, { error: error.message });
    }
  };

  return {
    dataDir,
    init,
    routes,
    api: {
      upsertTask,
      getTask,
      listTasks,
      appendEvent,
      getTaskEvents,
      saveArtifact,
      listArtifacts,
      upsertVectorItems,
      queryVectorItems,
      deleteVectorItems,
      purgeTask
    },
    capabilities: backends.capabilities,
    close: async () => {
      await Promise.all(backends.stores.map((store) => store.close?.()));
    },
    createServer() {
      return createHttpServer(routes);
    },
    async exists(filePath) {
      try {
        await stat(filePath);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") {
          return false;
        }
        throw error;
      }
    }
  };
}
