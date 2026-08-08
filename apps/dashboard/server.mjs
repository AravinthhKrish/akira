import { createHash, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createNodeObservability } from "../../packages/observability/node.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function proxyJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body,
  };
}

function encodeWsFrame(text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function decodeWsFrame(buffer) {
  const first = buffer[0];
  const opcode = first & 0x0f;
  if (opcode === 0x8) {
    return null;
  }
  const masked = (buffer[1] & 0x80) === 0x80;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) {
    offset += 4;
  }
  const payload = buffer.subarray(offset, offset + length);
  if (masked && mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }
  return payload.toString("utf-8");
}

function interpretCommand(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized.includes("akira")) {
    return null;
  }
  if (normalized.includes("pause")) return { action: "pause" };
  if (normalized.includes("resume")) return { action: "resume" };
  if (normalized.includes("interrupt") || normalized.includes("stop")) return { action: "interrupt" };
  if (normalized.includes("summary") || normalized.includes("status")) return { action: "summary" };
  if (normalized.includes("priority")) {
    const priority = normalized.includes("high") ? "high" : normalized.includes("low") ? "low" : "normal";
    return { action: "reprioritize", priority };
  }
  if (normalized.includes("start")) {
    const topic = text.replace(/akira/i, "").replace(/start/i, "").trim();
    return { action: "start", topic };
  }
  return { action: "summary" };
}

export { interpretCommand };

export function createDashboardServer(options = {}) {
  const orchestratorUrl = (options.orchestratorUrl || process.env.ORCHESTRATOR_URL || "http://127.0.0.1:9000").replace(/\/$/, "");
  const observability = createNodeObservability({ serviceName: "dashboard" });
  let activeVoiceSockets = 0;
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const staticPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const requestId = randomUUID();
    observability.incCounter("akira_http_requests_total", 1, { service: "dashboard", method: req.method, route: url.pathname });

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        void observability.log({
          logLevel: "INFO",
          className: "DashboardServer",
          message: "health requested",
          threadName: "dashboard.http",
          threadNumber: 10,
          context: { requestId }
        });
        return sendJson(res, 200, { ok: true, service: "dashboard" });
      }

      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        observability.setGauge("akira_dashboard_voice_connections", activeVoiceSockets, { service: "dashboard" });
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
        return res.end(observability.renderMetrics());
      }

      if (url.pathname.startsWith("/api/tasks/") && url.pathname.endsWith("/events")) {
        const upstream = await fetch(`${orchestratorUrl}/v1${url.pathname.slice(4)}${url.search}`, {
          headers: { "last-event-id": req.headers["last-event-id"] || "" },
        });
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive",
        });
        if (upstream.body) {
          Readable.fromWeb(upstream.body).pipe(res);
        } else {
          res.end();
        }
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const upstreamPath = `/v1${url.pathname.slice(4)}${url.search}`;
        const bodyChunks = [];
        for await (const chunk of req) {
          bodyChunks.push(chunk);
        }
        const payload = bodyChunks.length ? Buffer.concat(bodyChunks) : undefined;
        const upstream = await proxyJson(`${orchestratorUrl}${upstreamPath}`, {
          method: req.method,
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
          },
          body: payload,
        });
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        });
        res.end(upstream.body);
        return;
      }

      const filePath = path.join(publicDir, staticPath);
      const file = await readFile(filePath);
      res.writeHead(200, { "content-type": contentType(filePath) });
      res.end(file);
    } catch (error) {
      observability.incCounter("akira_http_errors_total", 1, { service: "dashboard", method: req.method, route: url.pathname });
      void observability.log({
        logLevel: "ERROR",
        className: "DashboardServer",
        message: `request failed: ${error.message}`,
        threadName: "dashboard.http",
        threadNumber: 10,
        context: { requestId }
      });
      sendJson(res, 500, { error: error.message });
    }
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws/voice") {
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n")
    );
    activeVoiceSockets += 1;
    observability.setGauge("akira_dashboard_voice_connections", activeVoiceSockets, { service: "dashboard" });
    void observability.log({
      logLevel: "INFO",
      className: "DashboardVoiceSocket",
      message: "voice websocket connected",
      threadName: "dashboard.voice",
      threadNumber: 20,
      context: { requestId: randomUUID() }
    });

    socket.on("data", async (buffer) => {
      observability.incCounter("akira_dashboard_voice_messages_total", 1, { service: "dashboard" });
      const decoded = decodeWsFrame(Buffer.from(buffer));
      if (!decoded) {
        socket.end();
        return;
      }
      try {
        const message = JSON.parse(decoded);
        const command = interpretCommand(message.text || "");
        if (!command) {
          socket.write(encodeWsFrame(JSON.stringify({ ok: true, ignored: true })));
          return;
        }

        let result;
        if (command.action === "start") {
          result = await fetch(`${orchestratorUrl}/v1/tasks`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ topic: command.topic || message.topic || "agent platform news" }),
          }).then((response) => response.json());
        } else {
          if (!message.taskId) {
            socket.write(encodeWsFrame(JSON.stringify({ ok: false, error: "taskId required for this command" })));
            return;
          }
          result = await fetch(`${orchestratorUrl}/v1/tasks/${message.taskId}/interrupt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          }).then((response) => response.json());
        }
        socket.write(encodeWsFrame(JSON.stringify({ ok: true, result })));
      } catch (error) {
        observability.incCounter("akira_http_errors_total", 1, { service: "dashboard", method: "WS", route: "/ws/voice" });
        socket.write(encodeWsFrame(JSON.stringify({ ok: false, error: error.message })));
      }
    });

    socket.on("close", () => {
      activeVoiceSockets = Math.max(0, activeVoiceSockets - 1);
      observability.setGauge("akira_dashboard_voice_connections", activeVoiceSockets, { service: "dashboard" });
    });
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createDashboardServer();
  server.listen(port, () => {
    const observability = createNodeObservability({ serviceName: "dashboard" });
    void observability.log({
      logLevel: "INFO",
      className: "DashboardServer",
      message: `dashboard listening on http://localhost:${port}`,
      threadName: "dashboard.main",
      threadNumber: 0
    });
  });
}
