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

## Near-term improvements

- replace fallback worker logic with remote worker dependency by default
- introduce richer confirmation gates for risky future actions
- separate event publisher from in-process task executor
- add stronger error categories and retry policies per stage
- support richer structured trace propagation
- replace local structured-log reads with Elastic-backed monitoring queries

## Guardrails

- The orchestrator owns flow control, not the dashboard.
- It can derive narrative events, but narrative output must remain sourced from machine events.
- Citation validation remains mandatory before artifact publication.
