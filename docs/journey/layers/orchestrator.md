# Orchestrator Layer Subplan

Last updated: 2026-07-05

## Purpose

The orchestrator owns task lifecycle, workflow control, replay coordination, and controlled delegation to workers and external services.

## Responsibilities

- create and resume tasks
- execute the explicit workflow stages
- persist canonical machine events and derived narrative events
- expose REST task endpoints
- expose SSE event streaming and replay
- handle pause, resume, interrupt, summary, reprioritize, and confirm hooks
- expose model-usage telemetry APIs
- generate scheduled system-monitoring podcast digests
- collect health, metrics, and structured logs for monitoring windows

## Current workflow stages

1. `accept_request`
2. `retrieve_sources`
3. `normalize_dedupe`
4. `rank_cluster`
5. `draft_structure`
6. `generate_script`
7. `validate_citations`
8. `publish_artifact_package`

## Current implementation

- `services/orchestrator/server.py`
- `workflow.py` defines the stage spine and LangGraph-compatible seam
- `mcp_client.py` handles data-plane retrieval with simulated fallback
- `worker_client.py` handles worker execution with local fallback logic
- `storage_client.py` persists state through the storage service
- `observability.py` provides structured logging, metrics, and usage tracking
- monitoring digests are generated inside the orchestrator and stored as artifacts under monitoring tasks
- monitoring log reads prefer Elastic when configured, with local log-mirror fallback
- monitoring artifacts now include playable audio payload data
- `/v1/dashboard/overview` aggregates content-task, monitoring, agent, alert, and hero data for the dashboard
- overview generation filters monitoring tasks out of the main workflow story
- dashboard-oriented tests cover the aggregation endpoint and its edge cases
- model routing is dynamic through `services/orchestrator/model_router.py`
- router config supports URL, auth mode, bearer/basic/header credentials, default model, and per-role/per-stage/task-type mappings
- router config now includes a provider catalog with API URL, provider auth mode, preconfigured model list, default provider, and catalog enforcement for posted provider configs
- `/v1/model-router` exposes the active router config and update hook
- stage execution records the selected model in usage telemetry instead of relying on hardcoded literals
- news tasks now persist a reusable `newsContext` profile and recurring `newsSchedule` snapshot on the task
- source discovery expands that profile into a single MCP text query for `news.search_articles`
- a background refresh loop re-runs due contextual news tasks and emits replayable machine plus narrative refresh events

## Near-term improvements

- replace fallback worker logic with remote worker dependency by default
- introduce richer confirmation gates for risky future actions
- separate event publisher from in-process task executor
- add stronger error categories and retry policies per stage
- support richer structured trace propagation
- replace local structured-log reads with Elastic-backed monitoring queries
- persist router configuration separately if the live update surface becomes a shared operational need
- promote the news-context profile into a dedicated task editor API once the dashboard form stabilizes

## Guardrails

- The orchestrator owns flow control, not the dashboard.
- It can derive narrative events, but narrative output must remain sourced from machine events.
- Citation validation remains mandatory before artifact publication.
