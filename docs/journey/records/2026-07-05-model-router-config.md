# AKIRA Model Router Configuration Record

Date: 2026-07-05

## Trigger

The user asked for the LLM model to be dynamically configured instead of being hardcoded in the orchestrator.

## Decisions captured

- Add a first-class model router in the orchestrator.
- Make the router configurable by URL, auth mode, credentials, default model, and per-role/per-stage/per-task mappings.
- Keep local fallback routing when no remote router URL is configured.
- Expose the active router config through the orchestrator API so the dashboard can surface it.

## Code changed

- Added `services/orchestrator/model_router.py`.
- Wired the orchestrator to resolve model names through the router when recording usage.
- Added `GET /v1/model-router` and `PUT /v1/model-router`.
- Added a resolution probe endpoint for testing/router inspection.
- Added dashboard visibility for the active router config.

## Validation

- `python3 -m unittest discover -s services/orchestrator/tests`
- `node --test apps/dashboard/server.test.mjs`
- `node --check apps/dashboard/public/app.js`

## Deferred

- a separate persisted router config store
- a real external router service integration
- richer provider-specific fields such as temperature, max tokens, and response schemas
