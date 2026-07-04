import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeObservability } from "../../packages/observability/node.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data/storage");

function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

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

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const text = await readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((entry) => entry.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function createStorageService(options = {}) {
  const dataDir = path.resolve(options.dataDir || defaultDataDir);
  const observability = createNodeObservability({ serviceName: "storage-mcp-platform" });
  const configuredBackends = {
    disk: true,
    mongo: Boolean(options.mongoUrl || process.env.MONGO_URL),
    weaviate: Boolean(options.weaviateUrl || process.env.WEAVIATE_URL)
  };

  const dirs = {
    tasks: path.join(dataDir, "tasks"),
    events: path.join(dataDir, "events"),
    artifacts: path.join(dataDir, "artifacts"),
    vectors: path.join(dataDir, "vectors")
  };

  async function init() {
    await Promise.all(Object.values(dirs).map((dir) => ensureDir(dir)));
  }

  async function upsertTask(taskId, task) {
    const record = {
      ...task,
      taskId,
      updatedAt: new Date().toISOString()
    };
    await writeJsonFile(path.join(dirs.tasks, `${taskId}.json`), record);
    return record;
  }

  async function getTask(taskId) {
    return readJsonFile(path.join(dirs.tasks, `${taskId}.json`));
  }

  async function listTasks() {
    const files = await listJsonFiles(dirs.tasks);
    const tasks = await Promise.all(
      files.map((file) => readJsonFile(path.join(dirs.tasks, file)))
    );
    return tasks.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getTaskEvents(taskId, fromSeq = 0) {
    const filePath = path.join(dirs.events, `${taskId}.json`);
    const events = (await readJsonFile(filePath, [])) || [];
    return events.filter((event) => Number(event?.data?.event_seq || 0) >= Number(fromSeq || 0));
  }

  async function appendEvent(event) {
    const taskId = event?.data?.task_id;
    if (!taskId) {
      throw new Error("task_id is required in event.data");
    }
    const filePath = path.join(dirs.events, `${taskId}.json`);
    const events = (await readJsonFile(filePath, [])) || [];
    if (!events.some((existing) => existing.id === event.id)) {
      events.push(event);
      events.sort((a, b) => Number(a?.data?.event_seq || 0) - Number(b?.data?.event_seq || 0));
      await writeJsonFile(filePath, events);
    }
    return event;
  }

  async function saveArtifact(taskId, artifactId, artifact) {
    const record = {
      ...artifact,
      taskId,
      artifactId,
      updatedAt: new Date().toISOString()
    };
    await writeJsonFile(path.join(dirs.artifacts, taskId, `${artifactId}.json`), record);
    return record;
  }

  async function listArtifacts(taskId) {
    const artifactDir = path.join(dirs.artifacts, taskId);
    const files = await listJsonFiles(artifactDir);
    const artifacts = await Promise.all(
      files.map((file) => readJsonFile(path.join(artifactDir, file)))
    );
    return artifacts.filter(Boolean).sort((a, b) => String(a.artifactId).localeCompare(String(b.artifactId)));
  }

  async function upsertVectorItems(namespace, items) {
    const filePath = path.join(dirs.vectors, `${namespace}.json`);
    const current = (await readJsonFile(filePath, [])) || [];
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of items) {
      byId.set(item.id || createId("vec"), {
        id: item.id || createId("vec"),
        text: item.text || "",
        metadata: item.metadata || {},
        tokens: tokenize(item.text),
        updatedAt: new Date().toISOString()
      });
    }
    const next = [...byId.values()];
    await writeJsonFile(filePath, next);
    return { namespace, count: next.length };
  }

  async function queryVectorItems(namespace, query, limit = 5) {
    const filePath = path.join(dirs.vectors, `${namespace}.json`);
    const items = (await readJsonFile(filePath, [])) || [];
    const queryTokens = tokenize(query);
    const scored = items
      .map((item) => {
        const overlap = item.tokens.filter((token) => queryTokens.includes(token)).length;
        const score = overlap / Math.max(item.tokens.length || 1, queryTokens.length || 1);
        return { ...item, score: Number(score.toFixed(4)) };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { namespace, items: scored };
  }

  async function deleteVectorItems(namespace, ids = []) {
    const filePath = path.join(dirs.vectors, `${namespace}.json`);
    const items = (await readJsonFile(filePath, [])) || [];
    const next = ids.length === 0 ? [] : items.filter((item) => !ids.includes(item.id));
    await writeJsonFile(filePath, next);
    return { namespace, deleted: ids.length === 0 ? items.length : ids.length };
  }

  async function purgeTask(taskId, options = {}) {
    const include = {
      events: options.events !== false,
      artifacts: options.artifacts !== false,
      vectors: options.vectors !== false,
      task: options.task === true
    };
    if (include.events) {
      await rm(path.join(dirs.events, `${taskId}.json`), { force: true });
    }
    if (include.artifacts) {
      await rm(path.join(dirs.artifacts, taskId), { recursive: true, force: true });
    }
    if (include.vectors) {
      await rm(path.join(dirs.vectors, `${taskId}.json`), { force: true });
    }
    if (include.task) {
      await rm(path.join(dirs.tasks, `${taskId}.json`), { force: true });
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
        return jsonResponse(res, 200, { ok: true, service: "storage-mcp-platform" });
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        observability.setGauge("akira_storage_task_count", (await listTasks()).length, { service: "storage-mcp-platform" });
        const body = observability.renderMetrics();
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/capabilities") {
        return jsonResponse(res, 200, {
          defaultBackend: "disk",
          backends: configuredBackends,
          vectorMode: "disk-term-index"
        });
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
