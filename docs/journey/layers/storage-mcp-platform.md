# StorageMCP Platform Subplan

Last updated: 2026-07-05

## Purpose

The storage layer provides a platform-owned abstraction for persistence, artifacts, vector retrieval, and purge operations, with backend choice determined by deployment profile.

## Responsibilities

- persist tasks
- persist append-only event logs
- store final artifacts
- support vector-style upsert/query/delete
- expose purge operations
- report backend capabilities

## Current implementation

- Node service in `services/storage-mcp-platform/`
- concrete disk-backed default
- HTTP endpoints for tasks, events, artifacts, vectors, purge, and capabilities
- in-process API exposed for unit testing
- structured JSON service logs
- `/metrics` endpoint with task/event/artifact/vector counters

## Backend direction

- **disk**: implemented default for local-first usage
- **MongoDB**: planned persistence adapter
- **Weaviate**: planned vector backend adapter

## Near-term improvements

- formal adapter interface per backend
- consistent retention policies and lifecycle classes
- namespace separation for temporary retrieval corpora vs durable run records
- stronger artifact metadata and content typing
- backend-specific health reporting
- optional future observability record storage or audit export helpers

## Guardrails

- Storage remains a platform service first, not a free-form general-purpose agent toybox.
- Purge behavior should remove cached/vectorized transient data without silently destroying durable run history unless explicitly requested.
