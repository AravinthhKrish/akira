# Agent Runtime

This directory is the Kotlin/Koog-aligned worker runtime scaffold for pluggable agent services.

## Intended responsibility

- expose stable HTTP contracts for bounded worker roles
- keep domain-specific reasoning in dedicated workers
- stay separate from orchestration state ownership

## Current roles

- `source_discovery`
- `normalize_dedupe`
- `rank_cluster`
- `draft_structure`
- `draft_script`
- `citation_validator`
- `show_notes`

## Runtime relationship

The runnable local slice in this repo uses Python fallback handlers when no worker runtime is running. This scaffold exists so the HTTP contract is already pinned down and can be replaced by a real Kotlin/Koog implementation without changing the dashboard or orchestrator APIs.

The current Spring service now implements the same bounded role behavior as the Python fallback path, so when the runtime is available the orchestrator can use it as a real remote worker service rather than a pure placeholder.
