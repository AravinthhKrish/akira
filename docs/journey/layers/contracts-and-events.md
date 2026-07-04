# Contracts and Events Subplan

Last updated: 2026-07-05

## Purpose

Shared contracts keep the layers aligned, especially around replay, narrative projection, and task/event semantics.

## Responsibilities

- define canonical event shape
- define task/run/event identifiers
- preserve machine vs narrative separation
- keep transport-neutral payloads that work across storage, orchestrator, dashboard, and workers

## Current implementation

- `packages/contracts/task-event.schema.json`
- `packages/contracts/service-log.schema.json`
- `packages/contracts/monitoring-digest.schema.json`
- contract notes in `packages/contracts/README.md`
- current event model includes:
  - CloudEvents-like envelope fields
  - `task_id`, `run_id`, `event_seq`
  - machine vs narrative audience
  - stage, progress, message, artifact references
- current observability model includes:
  - structured service logs
  - monitoring digest backing records
  - trace/span context fields
  - inline playable monitoring audio payload metadata

## Near-term improvements

- split schemas for machine events, narrative events, task status, and artifact metadata
- add explicit control-command schemas for pause/resume/interrupt/reprioritize/summary
- add stricter validation and versioning rules
- add typed client helpers for Node, Python, and Kotlin

## Guardrails

- Machine events remain canonical.
- Narrative events must point back to or be derivable from machine truth.
- Contracts should evolve version-first rather than through silent field drift.
