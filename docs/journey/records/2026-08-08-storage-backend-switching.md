# 2026-08-08: Storage Backend Switching

## Trigger

AKIRA needed the storage service to switch between local disk, MongoDB, and Weaviate from configuration. Weaviate was requested as a vectorless client.

## Decision

- Keep `dependencies.db.backend` in `config/akira.yaml` as the primary switch.
- Accept `disk` and `local` for local-first persistence.
- Accept `mongodb` and `mongo` for MongoDB persistence.
- Accept `weaviate` for vector search while keeping task state, events, and artifacts on disk.
- Support hybrid storage with `documentBackend: mongodb` and `vectorBackend: weaviate`.
- Use Weaviate over HTTP directly, without the Weaviate JavaScript SDK and without explicit embedding vectors.
- Query Weaviate with BM25 text search over stored source text.

## Code Changes

- Added storage backend adapters:
  - disk document/vector adapter
  - MongoDB document/vector text adapter
- Weaviate vectorless HTTP/BM25 adapter
- Local Mac integration config for external MongoDB, Weaviate, Ollama, and generic MCP.
- Updated the storage service to delegate document operations and vector operations separately.
- Exposed backend capabilities with document backend, vector backend, and vector mode.
- Wired Docker Compose and Kubernetes generation to storage backend settings.
- Added optional `mongodb` dependency for Mongo-backed deployments.

## Configuration

Single config path:

```yaml
dependencies:
  db:
    backend: disk
```

MongoDB:

```yaml
dependencies:
  db:
    backend: mongodb
    mongodbUrl: mongodb://mongodb:27017
    mongodbDatabase: akira
    mongodbCollectionPrefix: storage
```

Weaviate:

```yaml
dependencies:
  db:
    backend: weaviate
    storageDataDir: /app/data/storage
    weaviateUrl: http://weaviate:8080
    weaviateClassName: AkiraStorageVectorItem
```

Local Mac hybrid profile:

```yaml
dependencies:
  db:
    backend: disk
    documentBackend: mongodb
    vectorBackend: weaviate
  llm:
    defaultProvider: ollama
```

## Validation

- Disk persistence test still covers tasks, events, artifacts, and vector text query.
- Local alias test verifies `backend: local` resolves to disk.
- Weaviate test uses a fake HTTP server surface to verify schema creation, upsert, BM25 query, and delete.
- Kubernetes generation tests verify the single config still drives service env and disk PVC creation.

## Deferred

- End-to-end integration tests against real MongoDB and Weaviate containers.
- Secret generation helpers for MongoDB and Weaviate credentials.
- A hybrid config that explicitly separates document backend and vector backend beyond the v1 single `backend` switch.
