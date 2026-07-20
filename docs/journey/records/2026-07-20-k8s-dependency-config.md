# 2026-07-20 Kubernetes Dependency + Config Matrix

## Trigger

The user asked for a clear dependency and configuration view for Kubernetes setup, especially how images and service wiring should be prepared for AKIRA.

## Decision

Added a dedicated Kubernetes layer note so the dependency graph, required environment variables, and image expectations live in the repo instead of staying in chat context.

## What changed

- Added `docs/journey/layers/kubernetes-dependencies-and-config.md`.
- Updated the journey index to include the new Kubernetes layer note.
- Documented the service-to-service dependency chain, required environment variables, and image names for the starter cluster.
- Called out the missing `agent-runtime` Kubernetes manifest as the main gap before a full cluster deploy.

## Deferred

- ConfigMap and Secret manifests for Kubernetes overlays.
- A first-class `k8s/agent-runtime.yaml`.
- Registry-specific image naming for production clusters.

