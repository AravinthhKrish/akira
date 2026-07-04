# Observability Stack

This folder holds the local-first scaffolding for the structured logging and monitoring slice.

## Intended flow

1. Services emit structured JSON logs to stdout and a shared local log mirror directory.
2. A collector tails those records and forwards them to Elastic-style indices.
3. Prometheus scrapes `/metrics` from each service.
4. The orchestrator monitoring workflow reads health endpoints, metrics rollups, usage APIs, and log records to build monitoring podcast digests.

## Index families

- `akira-service-logs-*`
- `akira-monitoring-digests-*`

## Files

- `otel-collector.yaml`: log collection and export skeleton
- `prometheus.yml`: local scrape config for service metrics

The current codebase can work without running this stack, but these configs define the intended path toward the shared Elastic/metrics plane.

