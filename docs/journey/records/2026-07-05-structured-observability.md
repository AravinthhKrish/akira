# Structured Observability and Monitoring Record

Date: 2026-07-05

## Trigger

The platform needs:

- service-layer structured logs in JSON
- common observability storage aimed at Elastic
- service/app health and memory monitoring
- model-usage visibility from the orchestrator
- a system-monitoring podcast that turns telemetry into a periodic story

## Decisions captured

- Keep Elastic as the **observability sink**, not the canonical runtime store.
- Use structured JSON logs with:
  - `dateTime`
  - `serviceName`
  - `logLevel`
  - `threadName`
  - `threadNumber`
  - `className`
  - `message`
  - `context.traceId`
  - `context.spanId`
- Interpret thread fields as **logical execution-lane fields**.
- Expose per-service `/health` and `/metrics`.
- Expose orchestrator model-usage APIs for current and windowed views.
- Implement the first monitoring podcast as an **orchestrator-owned scheduled digest** with a default 15-minute window.
- Keep the monitoring artifact **audio-first**, but preserve a structured backing record.

## Code added or changed

- shared observability schemas under `packages/contracts/`
- Node observability helper under `packages/observability/`
- structured logging and metrics in dashboard and storage services
- structured logging, metrics, usage APIs, and monitoring digest flow in orchestrator
- Kotlin agent runtime health/metrics scaffolding and structured log pattern
- local observability stack configs under `ops/observability/`
- dashboard operations overview for service health, model usage, and monitoring podcast digest visibility
- compose updates for shared local log mirroring
- Kotlin agent runtime upgraded from echo scaffold to actual bounded role handlers aligned with the orchestrator contract

## Current local-first compromise

The monitoring digest currently prefers Elastic when configured, but falls back to the shared local structured-log mirror so the repo stays runnable without a full observability stack. Collector and scrape configs are included so the same shape can later flow into Elastic and Prometheus.

The monitoring artifact now carries a real playable audio payload:

- macOS `say` output when available
- tone-based WAV fallback when voice generation is unavailable

## Deferred next steps

- replace local log-file monitoring reads with Elastic queries
- add richer incident heuristics and thresholds
- add real TTS generation for monitoring podcast audio
- add authenticated usage/observability surfaces
