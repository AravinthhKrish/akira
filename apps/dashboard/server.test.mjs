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
