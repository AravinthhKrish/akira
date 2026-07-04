import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function sanitizeMetricName(name) {
  return String(name).replace(/[^a-zA-Z0-9_:]/g, "_");
}

function formatLabels(labels = {}) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries.map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`).join(",")}}`;
}

export function createNodeObservability(options = {}) {
  const serviceName = options.serviceName || "unknown-service";
  const environment = options.environment || process.env.NODE_ENV || "local";
  const logDir = path.resolve(options.logDir || process.env.OBSERVABILITY_LOG_DIR || "data/observability/logs");
  const metrics = {
    counters: new Map(),
    gauges: new Map(),
    startedAtMs: Date.now()
  };

  async function writeRecord(record) {
    await mkdir(logDir, { recursive: true });
    await appendFile(path.join(logDir, `${serviceName}.jsonl`), `${JSON.stringify(record)}\n`);
  }

  async function log({
    logLevel = "INFO",
    className = serviceName,
    message,
    threadName = "main",
    threadNumber = 0,
    context = {},
    indexType = "akira-service-logs",
    ...extra
  }) {
    const record = {
      dateTime: nowIso(),
      serviceName,
      logLevel,
      threadName,
      threadNumber,
      className,
      message,
      indexType,
      environment,
      context: {
        traceId: context.traceId || randomUUID().replace(/-/g, ""),
        spanId: context.spanId || randomUUID().replace(/-/g, "").slice(0, 16),
        ...context
      },
      ...extra
    };
    console.log(JSON.stringify(record));
    try {
      await writeRecord(record);
    } catch (error) {
      console.error(`failed to write structured log for ${serviceName}: ${error.message}`);
    }
    return record;
  }

  function incCounter(name, value = 1, labels = {}) {
    const key = `${sanitizeMetricName(name)}${JSON.stringify(labels)}`;
    const current = metrics.counters.get(key) || { name: sanitizeMetricName(name), labels, value: 0 };
    current.value += value;
    metrics.counters.set(key, current);
  }

  function setGauge(name, value, labels = {}) {
    const key = `${sanitizeMetricName(name)}${JSON.stringify(labels)}`;
    metrics.gauges.set(key, { name: sanitizeMetricName(name), labels, value });
  }

  function renderMetrics(extraLines = []) {
    const mem = process.memoryUsage();
    const lines = [
      `process_resident_memory_bytes ${mem.rss}`,
      `process_heap_total_bytes ${mem.heapTotal}`,
      `process_heap_used_bytes ${mem.heapUsed}`,
      `process_external_memory_bytes ${mem.external}`,
      `process_uptime_seconds ${Math.floor(process.uptime())}`,
      `service_started_timestamp_seconds ${Math.floor(metrics.startedAtMs / 1000)}`,
      `nodejs_event_loop_delay_placeholder 0`,
      `host_cpu_count ${os.cpus().length}`
    ];
    for (const counter of metrics.counters.values()) {
      lines.push(`${counter.name}${formatLabels(counter.labels)} ${counter.value}`);
    }
    for (const gauge of metrics.gauges.values()) {
      lines.push(`${gauge.name}${formatLabels(gauge.labels)} ${gauge.value}`);
    }
    return [...lines, ...extraLines].join("\n");
  }

  return {
    log,
    incCounter,
    setGauge,
    renderMetrics
  };
}
