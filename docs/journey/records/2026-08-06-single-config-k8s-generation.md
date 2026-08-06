# 2026-08-06 Single Config Kubernetes Generation

## Trigger

The user asked for one configuration YAML where AKIRA dependencies such as APIs, databases, LLM routing, and optional infrastructure can be configured, with Kubernetes services generated from that file.

## Decisions captured

- Use `config/akira.yaml` as the source of truth for deploy-time service and dependency wiring.
- Generate Kubernetes manifests into `k8s/generated/akira.yaml` instead of hand-editing each service manifest.
- Keep secrets external by reference so credentials are not committed to the repo.
- Make service spawning driven by `services.<name>.enabled`.

## Code changed

- Added `config/akira.yaml` with platform, API, DB/storage, LLM, observability, and service image settings.
- Added `scripts/generate-k8s.mjs` to render namespace, ConfigMap, PVC, Deployment, and Service resources.
- Added `npm run k8s:generate` and `npm run test:k8s`.
- Added generator tests for dependency env wiring, disk PVC generation, and disabled service exclusion.
- Generated the first `k8s/generated/akira.yaml`.

## Deferred

- Ingress, probes, resource limits, and production storage overlays.
- First-class Secret generation or sealed-secret integration.
- Full Helm/Kustomize overlays if the single-file generator becomes too limiting.
