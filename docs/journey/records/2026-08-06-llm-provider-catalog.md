# LLM Provider Catalog

## Trigger

The dashboard needed a way to configure LLM APIs and a preconfigured list of models so agents operate from those approved options after the config is posted.

## Decision

- Keep `/v1/model-router` as the runtime update surface.
- Add `providers` and `defaultProvider` to the model-router contract.
- Each provider carries an id, label, API URL, auth mode/header, default model, enabled flag, and model list.
- Route mappings may still use plain model names, or use `provider:model` when the provider must be explicit.
- Posted provider catalogs are enforced; uncataloged model choices fall back to a configured provider model with a warning.
- Legacy router-only configs remain permissive so old deployments do not break.

## Code Changes

- `services/orchestrator/model_router.py` now normalizes provider catalogs and returns provider/API/model metadata from route resolution.
- `apps/dashboard/public/app.js` exposes provider API/model JSON configuration in the Models page.
- `config/akira.yaml` and `scripts/generate-k8s.mjs` bootstrap provider catalog settings into Kubernetes env.

## Deferred

- Persist runtime model-router updates outside process memory.
- Add provider-specific live model discovery from upstream APIs.
- Execute direct LLM calls from the provider catalog once the worker/orchestrator boundary needs it.
