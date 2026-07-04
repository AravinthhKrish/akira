# Deployment and Ops Subplan

Last updated: 2026-07-05

## Purpose

The ops layer makes the platform runnable locally today while keeping a clear path toward more durable multi-service deployment later.

## Responsibilities

- local composition
- service startup wiring
- environment contract documentation
- Kubernetes starter manifests
- smoke-test entry points

## Current implementation

- `docker-compose.yml` for local composition
- service Dockerfiles for dashboard, orchestrator, storage, and agent runtime
- Kubernetes starter manifests for dashboard, orchestrator, storage, and NATS
- `scripts/smoke.mjs` for end-to-end health and task smoke flow
- `ops/observability/` for Prometheus scrape config and collector-to-Elastic scaffolding
- shared local observability log mirror mounted through compose

## Near-term improvements

- add env example files and startup docs per service
- separate dev vs production compose profiles
- add persistence volumes and resource requests to manifests
- decide when JetStream becomes a hard runtime dependency instead of a direction
- decide when Prometheus and Elastic become required rather than optional profiles

## Guardrails

- Local-first usability remains the first operating mode.
- Compose should stay simple enough for one-machine iteration.
- Kubernetes manifests should reflect real service boundaries, not speculative complexity.
