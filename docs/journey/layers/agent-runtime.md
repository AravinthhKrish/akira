# Agent Runtime Subplan

Last updated: 2026-07-05

## Purpose

The agent runtime hosts bounded worker roles behind a stable service contract, letting orchestration stay explicit while still allowing specialized agent execution.

## Responsibilities

- expose role-based worker endpoints
- encapsulate reasoning/execution logic for narrow stages
- remain replaceable without changing dashboard or orchestration APIs

## Target worker roles

- source discovery
- normalization and deduplication
- ranking and clustering
- episode structure drafting
- sourced script drafting
- citation validation
- show-note generation

## Current implementation

- Kotlin/Spring scaffold in `services/agent-runtime/`
- HTTP role handlers implemented for the current bounded worker roles
- orchestrator currently uses local Python fallback logic when this runtime is absent
- `/health` and `/metrics` endpoints scaffolded
- structured-log console pattern scaffolded through Logback
- local Gradle wrapper added so the runtime can be verified in-repo with `./gradlew test`
- worker behavior currently covered by focused tests for dedupe, script drafting, and citation validation

## Near-term improvements

- replace Spring-local role logic with real Koog-backed execution
- define typed role request/response models per worker
- add contract tests between orchestrator and agent runtime
- add artifact/citation-aware worker outputs
- add better worker-level observability and failure semantics

## Guardrails

- Worker services do bounded work; they do not own task lifecycle.
- Role contracts should stay narrow enough to be testable and swappable.
