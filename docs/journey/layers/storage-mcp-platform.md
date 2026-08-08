# StorageMCP Platform Subplan

Last updated: 2026-08-08

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
- adapter-based backend selection through `STORAGE_BACKEND`
- concrete disk-backed default, also selected by the `local` alias
- optional MongoDB backend for tasks, events, artifacts, and vector text records
- optional Weaviate backend for vectorless HTTP/BM25 vector search while task/event/artifact documents remain disk-backed
- optional hybrid routing through `STORAGE_DOCUMENT_BACKEND` and `STORAGE_VECTOR_BACKEND`
- HTTP endpoints for tasks, events, artifacts, vectors, purge, and capabilities
- in-process API exposed for unit testing
- structured JSON service logs
- `/metrics` endpoint with task/event/artifact/vector counters

## Backend direction

- **disk/local**: implemented default for local-first usage
- **MongoDB/mongo**: implemented document and vector text persistence adapter using the optional `mongodb` package
- **Weaviate**: implemented vectorless HTTP adapter for BM25 source search; document persistence remains disk-backed
- **MongoDB + Weaviate**: implemented hybrid mode for document persistence in MongoDB and vectorless source search in Weaviate

## Near-term improvements

- consistent retention policies and lifecycle classes
- namespace separation for temporary retrieval corpora vs durable run records
- stronger artifact metadata and content typing
- backend-specific health reporting
- optional future observability record storage or audit export helpers
- secret generation docs for MongoDB and Weaviate credentials

## Guardrails

- Storage remains a platform service first, not a free-form general-purpose agent toybox.
- Purge behavior should remove cached/vectorized transient data without silently destroying durable run history unless explicitly requested.
