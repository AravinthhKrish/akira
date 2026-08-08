import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

function scoreText(item, queryTokens) {
  const tokens = item.tokens || tokenize(item.text);
  const overlap = tokens.filter((token) => queryTokens.includes(token)).length;
  return Number((overlap / Math.max(tokens.length || 1, queryTokens.length || 1)).toFixed(4));
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

export function normalizeStorageBackend(value) {
  const backend = String(value || "disk").trim().toLowerCase();
  if (backend === "local") return "disk";
  if (backend === "mongo") return "mongodb";
  if (["disk", "mongodb", "weaviate"].includes(backend)) return backend;
  throw new Error(`unsupported storage backend '${value}'. Use disk, local, mongodb, mongo, or weaviate.`);
}

export function createDiskBackend({ dataDir }) {
  const dirs = {
    tasks: path.join(dataDir, "tasks"),
    events: path.join(dataDir, "events"),
    artifacts: path.join(dataDir, "artifacts"),
    vectors: path.join(dataDir, "vectors"),
  };

  return {
    name: "disk",
    vectorMode: "disk-term-index",
    async init() {
      await Promise.all(Object.values(dirs).map((dir) => ensureDir(dir)));
    },
    async upsertTask(taskId, task) {
      const record = {
        ...task,
        taskId,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonFile(path.join(dirs.tasks, `${taskId}.json`), record);
      return record;
    },
    async getTask(taskId) {
      return readJsonFile(path.join(dirs.tasks, `${taskId}.json`));
    },
    async listTasks() {
      const files = await listJsonFiles(dirs.tasks);
      const tasks = await Promise.all(files.map((file) => readJsonFile(path.join(dirs.tasks, file))));
      return tasks.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async getTaskEvents(taskId, fromSeq = 0) {
      const filePath = path.join(dirs.events, `${taskId}.json`);
      const events = (await readJsonFile(filePath, [])) || [];
      return events.filter((event) => Number(event?.data?.event_seq || 0) >= Number(fromSeq || 0));
    },
    async appendEvent(event) {
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
    },
    async saveArtifact(taskId, artifactId, artifact) {
      const record = {
        ...artifact,
        taskId,
        artifactId,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonFile(path.join(dirs.artifacts, taskId, `${artifactId}.json`), record);
      return record;
    },
    async listArtifacts(taskId) {
      const artifactDir = path.join(dirs.artifacts, taskId);
      const files = await listJsonFiles(artifactDir);
      const artifacts = await Promise.all(files.map((file) => readJsonFile(path.join(artifactDir, file))));
      return artifacts.filter(Boolean).sort((a, b) => String(a.artifactId).localeCompare(String(b.artifactId)));
    },
    async upsertVectorItems(namespace, items) {
      const filePath = path.join(dirs.vectors, `${namespace}.json`);
      const current = (await readJsonFile(filePath, [])) || [];
      const byId = new Map(current.map((item) => [item.id, item]));
      for (const item of items) {
        const id = item.id || createId("vec");
        byId.set(id, {
          id,
          text: item.text || "",
          metadata: item.metadata || {},
          tokens: tokenize(item.text),
          updatedAt: new Date().toISOString(),
        });
      }
      const next = [...byId.values()];
      await writeJsonFile(filePath, next);
      return { namespace, count: next.length };
    },
    async queryVectorItems(namespace, query, limit = 5) {
      const filePath = path.join(dirs.vectors, `${namespace}.json`);
      const items = (await readJsonFile(filePath, [])) || [];
      const queryTokens = tokenize(query);
      const scored = items
        .map((item) => ({ ...item, score: scoreText(item, queryTokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { namespace, items: scored };
    },
    async deleteVectorItems(namespace, ids = []) {
      const filePath = path.join(dirs.vectors, `${namespace}.json`);
      const items = (await readJsonFile(filePath, [])) || [];
      const next = ids.length === 0 ? [] : items.filter((item) => !ids.includes(item.id));
      await writeJsonFile(filePath, next);
      return { namespace, deleted: ids.length === 0 ? items.length : ids.length };
    },
    async purgeTask(taskId, options = {}) {
      if (options.events !== false) {
        await rm(path.join(dirs.events, `${taskId}.json`), { force: true });
      }
      if (options.artifacts !== false) {
        await rm(path.join(dirs.artifacts, taskId), { recursive: true, force: true });
      }
      if (options.vectors !== false) {
        await rm(path.join(dirs.vectors, `${taskId}.json`), { force: true });
      }
      if (options.task === true) {
        await rm(path.join(dirs.tasks, `${taskId}.json`), { force: true });
      }
    },
    async close() {},
  };
}

export function createMongoBackend({ mongoUrl, database = "akira", collectionPrefix = "storage" }) {
  let client;
  let db;
  let collections;

  async function loadMongoClient() {
    try {
      return await import("mongodb");
    } catch (error) {
      throw new Error("MongoDB backend requires the optional 'mongodb' package. Run npm install or use the storage Docker image.");
    }
  }

  return {
    name: "mongodb",
    vectorMode: "mongodb-term-index",
    async init() {
      if (!mongoUrl) {
        throw new Error("MONGODB_URL is required when STORAGE_BACKEND=mongodb");
      }
      const { MongoClient } = await loadMongoClient();
      client = new MongoClient(mongoUrl);
      await client.connect();
      db = client.db(database);
      collections = {
        tasks: db.collection(`${collectionPrefix}_tasks`),
        events: db.collection(`${collectionPrefix}_events`),
        artifacts: db.collection(`${collectionPrefix}_artifacts`),
        vectors: db.collection(`${collectionPrefix}_vectors`),
      };
      await Promise.all([
        collections.tasks.createIndex({ taskId: 1 }, { unique: true }),
        collections.events.createIndex({ taskId: 1, eventId: 1 }, { unique: true }),
        collections.events.createIndex({ taskId: 1, seq: 1 }),
        collections.artifacts.createIndex({ taskId: 1, artifactId: 1 }, { unique: true }),
        collections.vectors.createIndex({ namespace: 1, itemId: 1 }, { unique: true }),
      ]);
    },
    async upsertTask(taskId, task) {
      const record = { ...task, taskId, updatedAt: new Date().toISOString() };
      await collections.tasks.updateOne({ taskId }, { $set: record }, { upsert: true });
      return record;
    },
    async getTask(taskId) {
      const doc = await collections.tasks.findOne({ taskId }, { projection: { _id: 0 } });
      return doc || null;
    },
    async listTasks() {
      return collections.tasks.find({}, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
    },
    async appendEvent(event) {
      const taskId = event?.data?.task_id;
      if (!taskId) {
        throw new Error("task_id is required in event.data");
      }
      await collections.events.updateOne(
        { taskId, eventId: event.id },
        { $setOnInsert: { taskId, eventId: event.id, seq: Number(event?.data?.event_seq || 0), event } },
        { upsert: true },
      );
      return event;
    },
    async getTaskEvents(taskId, fromSeq = 0) {
      const docs = await collections.events
        .find({ taskId, seq: { $gte: Number(fromSeq || 0) } }, { projection: { _id: 0, event: 1 } })
        .sort({ seq: 1 })
        .toArray();
      return docs.map((doc) => doc.event);
    },
    async saveArtifact(taskId, artifactId, artifact) {
      const record = { ...artifact, taskId, artifactId, updatedAt: new Date().toISOString() };
      await collections.artifacts.updateOne({ taskId, artifactId }, { $set: record }, { upsert: true });
      return record;
    },
    async listArtifacts(taskId) {
      return collections.artifacts.find({ taskId }, { projection: { _id: 0 } }).sort({ artifactId: 1 }).toArray();
    },
    async upsertVectorItems(namespace, items) {
      for (const item of items) {
        const itemId = item.id || createId("vec");
        await collections.vectors.updateOne(
          { namespace, itemId },
          {
            $set: {
              namespace,
              itemId,
              id: itemId,
              text: item.text || "",
              metadata: item.metadata || {},
              tokens: tokenize(item.text),
              updatedAt: new Date().toISOString(),
            },
          },
          { upsert: true },
        );
      }
      return { namespace, count: await collections.vectors.countDocuments({ namespace }) };
    },
    async queryVectorItems(namespace, query, limit = 5) {
      const queryTokens = tokenize(query);
      const docs = await collections.vectors.find({ namespace }, { projection: { _id: 0 } }).limit(5000).toArray();
      const items = docs
        .map((doc) => ({ id: doc.id || doc.itemId, text: doc.text || "", metadata: doc.metadata || {}, updatedAt: doc.updatedAt, score: scoreText(doc, queryTokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { namespace, items };
    },
    async deleteVectorItems(namespace, ids = []) {
      const filter = ids.length === 0 ? { namespace } : { namespace, itemId: { $in: ids } };
      const result = await collections.vectors.deleteMany(filter);
      return { namespace, deleted: result.deletedCount || 0 };
    },
    async purgeTask(taskId, options = {}) {
      await Promise.all([
        options.events !== false ? collections.events.deleteMany({ taskId }) : null,
        options.artifacts !== false ? collections.artifacts.deleteMany({ taskId }) : null,
        options.vectors !== false ? collections.vectors.deleteMany({ namespace: taskId }) : null,
        options.task === true ? collections.tasks.deleteOne({ taskId }) : null,
      ].filter(Boolean));
    },
    async close() {
      await client?.close();
    },
  };
}

function weaviateObjectId(namespace, id) {
  const hex = createHash("sha1").update(`${namespace}:${id}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function escapeGraphql(value) {
  return JSON.stringify(String(value ?? ""));
}

export function createWeaviateVectorBackend({ weaviateUrl, apiKey = "", className = "AkiraStorageVectorItem", fetchImpl = globalThis.fetch }) {
  if (!fetchImpl) {
    throw new Error("Weaviate backend requires a fetch implementation");
  }
  const baseUrl = String(weaviateUrl || "").replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };

  async function request(method, resource, body) {
    if (!baseUrl) {
      throw new Error("WEAVIATE_URL is required when STORAGE_BACKEND=weaviate");
    }
    const response = await fetchImpl(`${baseUrl}${resource}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Weaviate ${method} ${resource} failed with ${response.status}${text ? `: ${text}` : ""}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function queryByNamespace(namespace, fields = "itemId text metadataJson updatedAt _additional { id score }", limit = 10000) {
    const query = `{
      Get {
        ${className}(
          where: { path: ["namespace"], operator: Equal, valueText: ${escapeGraphql(namespace)} }
          limit: ${Number(limit || 10000)}
        ) { ${fields} }
      }
    }`;
    const payload = await request("POST", "/v1/graphql", { query });
    return payload?.data?.Get?.[className] || [];
  }

  return {
    name: "weaviate",
    vectorMode: "weaviate-bm25-vectorless-http",
    async init() {
      const existing = await request("GET", `/v1/schema/${encodeURIComponent(className)}`);
      if (existing) return;
      await request("POST", "/v1/schema", {
        class: className,
        description: "AKIRA storage vector-search items. Stored without explicit vectors; queried with BM25.",
        vectorizer: "none",
        properties: [
          { name: "namespace", dataType: ["text"] },
          { name: "itemId", dataType: ["text"] },
          { name: "text", dataType: ["text"] },
          { name: "metadataJson", dataType: ["text"] },
          { name: "updatedAt", dataType: ["date"] },
        ],
      });
    },
    async upsertVectorItems(namespace, items) {
      for (const item of items) {
        const itemId = item.id || createId("vec");
        await request("PUT", `/v1/objects/${encodeURIComponent(className)}/${weaviateObjectId(namespace, itemId)}`, {
          class: className,
          properties: {
            namespace,
            itemId,
            text: item.text || "",
            metadataJson: JSON.stringify(item.metadata || {}),
            updatedAt: new Date().toISOString(),
          },
        });
      }
      const existing = await queryByNamespace(namespace, "itemId", 10000);
      return { namespace, count: existing.length };
    },
    async queryVectorItems(namespace, query, limit = 5) {
      const graphQuery = `{
        Get {
          ${className}(
            where: { path: ["namespace"], operator: Equal, valueText: ${escapeGraphql(namespace)} }
            bm25: { query: ${escapeGraphql(query)}, properties: ["text"] }
            limit: ${Number(limit || 5)}
          ) {
            itemId
            text
            metadataJson
            updatedAt
            _additional { score }
          }
        }
      }`;
      const payload = await request("POST", "/v1/graphql", { query: graphQuery });
      const hits = payload?.data?.Get?.[className] || [];
      return {
        namespace,
        items: hits.map((hit) => ({
          id: hit.itemId,
          text: hit.text || "",
          metadata: hit.metadataJson ? JSON.parse(hit.metadataJson) : {},
          updatedAt: hit.updatedAt,
          score: Number(hit._additional?.score || 0),
        })),
      };
    },
    async deleteVectorItems(namespace, ids = []) {
      const objectIds = ids.length
        ? ids.map((id) => weaviateObjectId(namespace, id))
        : (await queryByNamespace(namespace, "_additional { id }", 10000)).map((item) => item._additional?.id).filter(Boolean);
      for (const id of objectIds) {
        await request("DELETE", `/v1/objects/${encodeURIComponent(className)}/${id}`);
      }
      return { namespace, deleted: objectIds.length };
    },
    async purgeTask(taskId, options = {}) {
      if (options.vectors !== false) {
        await this.deleteVectorItems(taskId, []);
      }
    },
    async close() {},
  };
}

export function createStorageBackends(options = {}) {
  const activeBackend = normalizeStorageBackend(options.backend || process.env.STORAGE_BACKEND || "disk");
  const requestedDocumentBackend = normalizeStorageBackend(
    options.documentBackend || process.env.STORAGE_DOCUMENT_BACKEND || (activeBackend === "mongodb" ? "mongodb" : "disk"),
  );
  const requestedVectorBackend = normalizeStorageBackend(
    options.vectorBackend || process.env.STORAGE_VECTOR_BACKEND || activeBackend,
  );
  const documentBackend = requestedDocumentBackend === "weaviate" ? "disk" : requestedDocumentBackend;
  const vectorBackend = requestedVectorBackend;
  const diskBackend = createDiskBackend({ dataDir: options.dataDir });
  const mongoUrl = options.mongoUrl || process.env.MONGODB_URL || process.env.MONGO_URL || "";
  const weaviateUrl = options.weaviateUrl || process.env.WEAVIATE_URL || "";
  const needsMongo = documentBackend === "mongodb" || vectorBackend === "mongodb";
  const needsWeaviate = vectorBackend === "weaviate";
  const mongoBackend = needsMongo
    ? createMongoBackend({
        mongoUrl,
        database: options.mongoDatabase || process.env.MONGODB_DATABASE || "akira",
        collectionPrefix: options.mongoCollectionPrefix || process.env.MONGODB_COLLECTION_PREFIX || "storage",
      })
    : null;
  const weaviateBackend = needsWeaviate
    ? createWeaviateVectorBackend({
        weaviateUrl,
        apiKey: options.weaviateApiKey || process.env.WEAVIATE_API_KEY || "",
        className: options.weaviateClassName || process.env.WEAVIATE_CLASS_NAME || "AkiraStorageVectorItem",
        fetchImpl: options.fetch,
      })
    : null;

  const documentStore = documentBackend === "mongodb" ? mongoBackend : diskBackend;
  const vectorStore = vectorBackend === "mongodb" ? mongoBackend : vectorBackend === "weaviate" ? weaviateBackend : diskBackend;

  return {
    activeBackend,
    documentStore,
    vectorStore,
    stores: [...new Set([documentStore, vectorStore])],
    capabilities: {
      defaultBackend: activeBackend,
      documentBackend: documentStore.name,
      vectorBackend: vectorStore.name,
      hybrid: documentStore.name !== vectorStore.name,
      backends: {
        disk: true,
        mongodb: Boolean(mongoUrl),
        mongo: Boolean(mongoUrl),
        weaviate: Boolean(weaviateUrl),
      },
      vectorMode: vectorStore.vectorMode,
    },
  };
}
