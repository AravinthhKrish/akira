# Idea Workshop: AKIRA Multi-Agent Platform v1

This repository is the composition repo for a local-first, single-user multi-agent platform focused on a first workflow: turning a news topic into a sourced podcast script package while streaming human-friendly progress.

## What is implemented here

- `apps/dashboard`: Node-powered dashboard server and browser UI with:
  - task creation
  - live SSE status feed
  - replay view
  - speech synthesis playback
  - browser speech recognition with a wake-phrase command loop
  - WebSocket voice-control session that forwards commands to the orchestrator
  - operations overview for service health, model usage, and monitoring podcast digests
- `services/orchestrator`: Python orchestration service with:
  - explicit graph workflow
  - optional LangGraph seam with a no-dependency fallback runtime
  - REST task APIs
  - SSE machine/narrative event streaming
  - structured JSON service logs
  - Prometheus-style metrics endpoint
  - model-usage summary APIs
  - dynamic model router with URL/auth/credentials and per-role mapping
  - scheduled monitoring podcast digest generation
  - Elastic-preferred log reading with local log-mirror fallback
  - generated playable monitoring audio payloads
  - replay, interrupt, confirm, pause, resume, reprioritize hooks
  - HTTP seams for MCP data access, storage, and agent workers
- `services/storage-mcp-platform`: Node storage service with:
  - deployment-selectable backend contract
  - full disk-backed task/event/artifact persistence
  - vector-style upsert/query/delete on a disk index
  - structured JSON service logs
  - Prometheus-style metrics endpoint
  - retention/purge endpoints
  - capability discovery
- `services/agent-runtime`: Kotlin worker-runtime service with bounded role handlers for source discovery, ranking, drafting, citation validation, and show-note generation
- `ops/observability`: collector and metrics scrape scaffolding for Elastic/Prometheus-style observability
- `k8s`: starter manifests for dashboard, orchestrator, storage, and NATS
- `docker-compose.yml`: local composition including optional sibling-repo services

## Repo layout

```text
apps/
  dashboard/
docs/
  journey/
packages/
  contracts/
services/
  agent-runtime/
  orchestrator/
  storage-mcp-platform/
k8s/
scripts/
```

## Planning and journey docs

The running architecture/context record lives under `docs/journey/`.

- `docs/journey/master-plan.md`: current top-level product and system plan
- `docs/journey/records/`: dated context snapshots, prompt summaries, and iteration notes
- `docs/journey/layers/`: layer-by-layer subplans for dashboard, orchestrator, storage, agents, contracts, and ops

This directory is meant to grow with the project so the reasoning trail stays inside the repo rather than getting lost in chat history.

## Local verification snapshot

The current vertical slice has been exercised locally with:

- `python3 -m unittest discover -s services/orchestrator/tests`
- `node --test services/storage-mcp-platform/tests/storage.test.mjs apps/dashboard/server.test.mjs`
- `./gradlew test` from `services/agent-runtime/`

The latest dated verification note lives in `docs/journey/records/2026-07-05-local-verification.md`.

## Local development

Start the storage service:

```bash
npm run storage
```

Start the orchestrator:

```bash
python3 services/orchestrator/server.py
```

Start the dashboard:

```bash
npm run dashboard
```

Then open [http://localhost:3000](http://localhost:3000).

## Notes about external services

- `mcp-server-generic` is treated as a sibling dependency and can be wired in through `MCP_SERVER_URL`.
- `api-chat-app` informed the orchestration shape, but this repo is not tied to its domain model.
- The event model is JetStream-ready, but the runnable local slice persists canonical events through `storagemcp-platform` so the repo works without additional client libraries.
- Structured service logs also mirror locally under `data/observability/logs` so the monitoring digest workflow can read them in local-first mode before a full Elastic stack is running.
- Dynamic model routing is controlled by the orchestrator through `/v1/model-router` and `MODEL_ROUTER_*` environment variables when you want to point AKIRA at a real router endpoint with auth.
