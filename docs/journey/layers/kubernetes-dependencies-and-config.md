# Kubernetes Dependencies and Config

Last updated: 2026-08-06

## Purpose

This layer captures the Kubernetes-facing dependency graph and the config surface that the AKIRA platform needs to start cleanly in cluster form.

## Runtime dependency graph

- `akira-dashboard` -> `akira-orchestrator`
- `akira-orchestrator` -> `storagemcp-platform`, `agent-runtime`, `mcp-server-generic`
- `storagemcp-platform` -> no internal service dependency
- `agent-runtime` -> no internal service dependency
- `nats-jetstream` -> no internal service dependency
- observability tooling -> reads service logs and metrics from the services above

## Service matrix

| Service | Image | Port | Main job | Required config |
| --- | --- | --- | --- | --- |
| `akira-dashboard` | `akira-dashboard:latest` | `3000` | Browser UI, live task control, voice session, playback, replay | `ORCHESTRATOR_URL`, `PORT`, optional `OBSERVABILITY_LOG_DIR` |
| `akira-orchestrator` | `akira-orchestrator:latest` | `9000` | Task lifecycle, workflow control, model routing, SSE, monitoring digests | `STORAGE_URL`, `AGENT_RUNTIME_URL`, `MCP_SERVER_URL`, `PORT`, optional `MODEL_ROUTER_*`, `ELASTICSEARCH_URL`, `ELASTIC_LOG_INDEX_PATTERN`, `OBSERVABILITY_LOG_DIR` |
| `storagemcp-platform` | `storagemcp-platform:latest` | `9100` | Task/event/artifact persistence and purge APIs | `STORAGE_DATA_DIR`, `PORT`, optional `OBSERVABILITY_LOG_DIR` |
| `agent-runtime` | `akira-agent-runtime:latest` | `8081` | Bounded worker roles for source discovery, ranking, drafting, citations, show notes | `PORT` and any worker-specific runtime config you add later |
| `nats-jetstream` | `nats:2.10-alpine` | `4222`, `8222` | Event backbone | `-js` runtime argument |
| `mcp-server-generic` | sibling build | `8080` | Externalized data/tool plane | `MCP_SERVER_URL` from orchestrator |
| `prometheus` | `prom/prometheus:v2.54.1` | `9090` | Metrics scraping | `ops/observability/prometheus.yml` |
| `otel-collector` | `otel/opentelemetry-collector-contrib:0.108.0` | n/a | Log/metric collection bridge | `ops/observability/otel-collector.yaml`, mounted log directory |
| `elasticsearch` | `docker.elastic.co/elasticsearch/elasticsearch:8.15.0` | `9200` | Optional log index target | `discovery.type=single-node`, `xpack.security.enabled=false` in the starter profile |

## Config split

- Put non-secret values in `config/akira.yaml`; generated manifests include the runtime ConfigMap and service environment blocks.
- Put router credentials, basic auth secrets, tokens, and any external service keys in Secrets.
- Keep the dashboard pointed at the orchestrator, not directly at storage or workers.
- Keep the orchestrator responsible for storage, worker, router, and MCP wiring.

## Single config generation

The generated Kubernetes path is:

1. Edit `config/akira.yaml`.
2. Run `npm run k8s:generate`.
3. Inspect `k8s/generated/akira.yaml`.
4. Apply the generated manifest with `kubectl apply -f k8s/generated/akira.yaml`.

The generator currently emits namespace, runtime ConfigMap, disk storage PVC, Deployment, and Service objects for enabled services.

## Image setup flow

1. Build the service images from the repo root.
2. Tag them to match the manifests or your registry naming convention.
3. Load them into the local cluster or push them to the remote registry.
4. Run `npm run k8s:generate` and apply `k8s/generated/akira.yaml`.
5. Verify service health before turning on the observability profile.

## Current gaps

- Secret creation is still intentionally external so credentials do not get committed.
- The generated manifests should grow ingress, probes, resource requests, and production storage overlays next.
- The model-router config is dynamic at runtime, but Kubernetes should still get an initial env baseline for the first boot.
