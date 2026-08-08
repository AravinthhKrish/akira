# 2026-08-08: Dashboard Routing and Task Model Selection

## Trigger

The dashboard felt static: Home, Podcast, Agents, Tasks, and Alerts did not clearly move to dedicated views, and the task composer could not choose from configured LLM models. The deployment path also needed to remain centered on one configuration file.

## Decision

- Treat the sidebar as first-class dashboard tab navigation using URL hashes so each section can be selected, bookmarked, and restored.
- Keep model configuration owned by the model-router/provider catalog, but expose configured provider/model choices inside the task composer.
- Persist a task-level `modelPreference` snapshot when the task is created.
- Make task-level model choice override role, stage, and task-type mappings for that task.
- Keep `config/akira.yaml` as the single source for generated Kubernetes deployment and add direct deploy/undeploy npm commands.

## Code Changes

- Dashboard shell:
  - Sidebar buttons are now semantic tabs with active state and `aria-selected`.
  - Home, Podcast, Tasks, Agents, Models, and Alerts switch views and update the URL hash/title.
  - Summary cards and task actions deep-link into the right dashboard view.
- Task composer:
  - Loads `/api/model-router` before opening the modal.
  - Populates an LLM model dropdown from configured providers.
  - Posts `modelPreference` with the task request.
- Orchestrator:
  - Stores `modelPreference` on the task.
  - Sends the preference to local or remote model routing.
  - Routes task stages through the preferred provider/model when present.
- Ops/docs:
  - Added `deploy:k8s` and `undeploy:k8s` scripts around generated Kubernetes manifests.
  - README now points deployment to `config/akira.yaml` first.

## Validation

- Dashboard unit tests cover shell rendering and task payload model selection.
- Orchestrator tests cover task-level model override behavior and persistence.
- Browser smoke verified each sidebar tab switches to the intended view.
- Browser/API smoke created a news task with `openai:gpt-4.1` and confirmed model routing used `taskPreference`.

## Deferred

- Persisting a user-specific default task model selection.
- A richer model chooser with model capability descriptions and per-stage override previews.
- Production-grade credential storage for provider secrets beyond the current local-first configuration contract.
