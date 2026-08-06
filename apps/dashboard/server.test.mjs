import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { interpretCommand, createDashboardServer } from "./server.mjs";

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    end(chunk) {
      if (chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      this.ended = true;
      return this;
    },
    write(chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };
}

function createMockRequest(method, url, body = []) {
  const req = Readable.from(body);
  req.method = method;
  req.url = url;
  req.headers = {};
  return req;
}

async function emitRequest(server, req) {
  const res = createMockResponse();
  server.emit("request", req, res);
  for (let i = 0; i < 20 && !res.ended; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return res;
}

test("dashboard voice command parsing recognizes wake-word actions", () => {
  assert.deepEqual(interpretCommand("AKIRA pause the task"), { action: "pause" });
  assert.deepEqual(interpretCommand("AKIRA priority high"), { action: "reprioritize", priority: "high" });
  assert.equal(interpretCommand("hello there"), null);
});

test("dashboard shell serves the AKIRA command center layout", async () => {
  const server = createDashboardServer({
    orchestratorUrl: "http://mock-orchestrator",
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith("/v1/dashboard/overview")) {
      return new Response(JSON.stringify({
        title: "AKIRA Command Center",
        subtitle: "Here’s what AKIRA has been up to.",
        cards: [],
        hero: { title: "Agent Podcast (Live)", status: "Ready", summary: "", task: null, events: [], audio: null },
        agents: [],
        tasks: [],
        updates: [],
        highlights: [],
        alerts: [],
        monitoring: { latestDigests: [], usage: { summary: {} }, health: {}, metrics: {} },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const rootResponse = await emitRequest(server, createMockRequest("GET", "/"));
    const homeHtml = Buffer.concat(rootResponse.chunks).toString("utf-8");
    assert.match(homeHtml, /AKIRA Command Center/);
    assert.match(homeHtml, /Podcast/);
    assert.match(homeHtml, /Agents/);
    assert.match(homeHtml, /Models/);

    const overviewResponse = await emitRequest(server, createMockRequest("GET", "/api/dashboard/overview"));
    assert.equal(overviewResponse.statusCode, 200);
    const overview = JSON.parse(Buffer.concat(overviewResponse.chunks).toString("utf-8"));
    assert.equal(overview.title, "AKIRA Command Center");
  } finally {
    global.fetch = originalFetch;
    server.close();
  }
});

test("news profile composer payload expands into task context and schedule", async () => {
  const originalDocument = global.document;
  global.document = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  try {
    const { buildNewsTaskPayload } = await import("./public/app.js");
    const payload = buildNewsTaskPayload(
      new Map([
        ["topic", "AKIRA launch"],
        ["focusKeywords", "voice, orchestration"],
        ["exclusions", "rumors"],
        ["entities", "AKIRA, MCP"],
        ["sourcePreferences", "official docs, reputable news"],
        ["freshnessWindowMinutes", "180"],
        ["refreshEveryMinutes", "45"],
        ["scheduleEnabled", "on"],
      ])
    );

    assert.equal(payload.type, "news-podcast");
    assert.equal(payload.topic, "AKIRA launch");
    assert.deepEqual(payload.newsContext.focusKeywords, ["voice", "orchestration"]);
    assert.deepEqual(payload.newsContext.entities, ["AKIRA", "MCP"]);
    assert.equal(payload.newsContext.freshnessWindowMinutes, 180);
    assert.equal(payload.newsSchedule.enabled, true);
    assert.equal(payload.newsSchedule.refreshEveryMinutes, 45);
  } finally {
    global.document = originalDocument;
  }
});

test("model router composer payload supports agent role mappings and credentials", async () => {
  const originalDocument = global.document;
  global.document = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  try {
    const { buildModelRouterPayload } = await import(`./public/app.js?model-router-test=${Date.now()}`);
    const payload = buildModelRouterPayload(
      new Map([
        ["url", "https://router.local/route"],
        ["authMode", "bearer"],
        ["authHeaderName", "Authorization"],
        ["defaultModel", "gpt-4.1-mini"],
        ["defaultProvider", "openai"],
        ["timeoutSeconds", "20"],
        ["bearerToken", "secret-token"],
        [
          "providers",
          JSON.stringify([
            {
              id: "openai",
              label: "OpenAI",
              url: "https://api.openai.test/v1/responses",
              authMode: "bearer",
              defaultModel: "gpt-4.1-mini",
              models: ["gpt-4.1-mini", "gpt-4.1"],
              credentials: { bearerToken: "provider-secret" },
            },
          ]),
        ],
        ["roleModels", "draft_script=gpt-4.1\ncitation_validator=gpt-4.1-mini # validator"],
        ["stageModels", "retrieve_sources=gpt-4.1-mini"],
        ["taskTypeModels", "news-podcast=gpt-4.1"],
      ])
    );

    assert.equal(payload.url, "https://router.local/route");
    assert.equal(payload.authMode, "bearer");
    assert.equal(payload.defaultModel, "gpt-4.1-mini");
    assert.equal(payload.defaultProvider, "openai");
    assert.equal(payload.timeoutSeconds, 20);
    assert.equal(payload.credentials.bearerToken, "secret-token");
    assert.equal(payload.credentials.headerValue, "secret-token");
    assert.deepEqual(payload.providers, [
      {
        id: "openai",
        label: "OpenAI",
        url: "https://api.openai.test/v1/responses",
        authMode: "bearer",
        authHeaderName: "Authorization",
        defaultModel: "gpt-4.1-mini",
        models: ["gpt-4.1-mini", "gpt-4.1"],
        enabled: true,
        credentials: { bearerToken: "provider-secret" },
      },
    ]);
    assert.deepEqual(payload.roleModels, {
      draft_script: "gpt-4.1",
      citation_validator: "gpt-4.1-mini",
    });
    assert.deepEqual(payload.stageModels, { retrieve_sources: "gpt-4.1-mini" });
    assert.deepEqual(payload.taskTypeModels, { "news-podcast": "gpt-4.1" });
  } finally {
    global.document = originalDocument;
  }
});

test("dashboard proxy exposes task list replay and interrupt APIs", async () => {
  const server = createDashboardServer({
    orchestratorUrl: "http://mock-orchestrator",
  });
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), method: options.method || "GET" });
    if (String(url).endsWith("/v1/tasks")) {
      return new Response(JSON.stringify({ tasks: [{ taskId: "task_1", topic: "AKIRA", status: "completed" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/tasks/task_1/replay")) {
      return new Response(JSON.stringify({ taskId: "task_1", events: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/tasks/task_1/interrupt")) {
      return new Response(JSON.stringify({ taskId: "task_1", control: { lastAction: "summary" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/model-router")) {
      return new Response(JSON.stringify({ defaultModel: "gpt-4.1", roleModels: { draft_script: "gpt-4.1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/v1/model-router/resolve?role=draft_script")) {
      return new Response(JSON.stringify({ model: "gpt-4.1", source: "role" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const listResponse = await emitRequest(server, createMockRequest("GET", "/api/tasks"));
    assert.equal(listResponse.statusCode, 200);
    assert.equal(JSON.parse(Buffer.concat(listResponse.chunks).toString("utf-8")).tasks[0].taskId, "task_1");

    const replayResponse = await emitRequest(server, createMockRequest("GET", "/api/tasks/task_1/replay"));
    assert.equal(replayResponse.statusCode, 200);
    assert.equal(JSON.parse(Buffer.concat(replayResponse.chunks).toString("utf-8")).taskId, "task_1");

    const interruptResponse = await emitRequest(
      server,
      createMockRequest("POST", "/api/tasks/task_1/interrupt", [Buffer.from(JSON.stringify({ action: "summary" }))])
    );
    assert.equal(interruptResponse.statusCode, 200);
    const routerResponse = await emitRequest(
      server,
      createMockRequest("POST", "/api/model-router", [Buffer.from(JSON.stringify({ roleModels: { draft_script: "gpt-4.1" } }))])
    );
    assert.equal(routerResponse.statusCode, 200);
    const resolveResponse = await emitRequest(server, createMockRequest("GET", "/api/model-router/resolve?role=draft_script"));
    assert.equal(resolveResponse.statusCode, 200);
    assert.deepEqual(seen.map((item) => `${item.method} ${new URL(item.url).pathname}`), [
      "GET /v1/tasks",
      "GET /v1/tasks/task_1/replay",
      "POST /v1/tasks/task_1/interrupt",
      "POST /v1/model-router",
      "GET /v1/model-router/resolve",
    ]);
  } finally {
    global.fetch = originalFetch;
    server.close();
  }
});
