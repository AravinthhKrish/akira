# Master Plan

Last updated: 2026-07-05

## Goal

Build a local-first, single-user, AKIRA multi-agent platform whose first end-to-end workflow turns a news topic into a sourced podcast script package with live human-friendly progress streaming.

## Architecture spine

- **Dashboard**: Node-based control surface for task creation, live progress, replay, voice I/O, and artifact review
- **Orchestrator**: Python control plane with explicit workflow stages, resumable task state, REST APIs, and SSE replay
- **StorageMCP Platform**: internal storage abstraction with pluggable backends and a working disk-backed default
- **Agent Runtime**: Kotlin/Koog-aligned worker layer for bounded execution roles
- **MCP data plane**: sibling `mcp-server-generic` service for external data/tool access
- **Observability plane**: structured service logs, Prometheus-style metrics, usage APIs, monitoring digest workflow, and Elastic/collector scaffolding
- **Model routing plane**: dynamically configurable LLM model selection by URL/auth/credentials plus role, stage, and task-type overrides
- **Event backbone direction**: JetStream-compatible architecture, with local persistence currently handled by the storage service

## First workflow

1. accept a topic
2. retrieve sources
3. normalize and deduplicate
4. rank and cluster stories
5. draft episode structure
6. generate sourced script
7. validate citations
8. publish script package artifact

## Monitoring workflow

- collect structured service logs
- collect per-service health and metrics
- collect orchestrator model-usage summaries
- produce a scheduled system-monitoring podcast digest every 15 minutes
- keep an audio-first artifact plus a structured backing record

## Product constraints

- local-first
- single-user for v1
- REST-first task/status APIs
- SSE for progress streaming
- WebSocket only for live voice/control sessions
- citation-gated script output
- voice limited to session control, not irreversible execution
- structured logs must be portable across Node, Python, and Kotlin services
- observability data should converge on Elastic-style indices without replacing canonical task/event truth

## Current implementation status

- Composition repo scaffolded
- Dashboard implemented as an AKIRA command center with browser STT, wake-word parsing, speech synthesis playback, live podcast playback, and an overview aggregator
- Orchestrator implemented with explicit stage execution, replayable event emission, structured logs, metrics, model-usage APIs, dashboard overview aggregation, and monitoring digest generation
- Model routing now flows through a configurable router so model names are not hardcoded in stage execution
- Storage service implemented with disk-backed tasks, events, artifacts, vector-ish indexing, purge, structured logs, and metrics
- Kotlin agent runtime scaffolded with health/metrics endpoints and structured-log pattern
- Compose and Kubernetes starter manifests added
- Observability configs added for Prometheus and collector-to-Elastic routing

## Next likely phases

- replace worker fallbacks with real Kotlin/Koog agent implementations
- add true JetStream integration instead of storage-only local event persistence
- integrate real MCP news and feed retrieval paths
- improve artifact quality and structured citation rendering
- add stronger recovery and auth
- replace local log-mirror monitoring reads with a real Elastic-backed observability read path
