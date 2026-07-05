# AKIRA Command Center Session Record

Date: 2026-07-05

## Trigger

The dashboard needed to move from the earlier agent-listener shell to an AKIRA-branded command center inspired by the reference layout, while keeping the orchestration and monitoring story intact.

## Decisions captured

- Use a left-navigation command-center layout for AKIRA.
- Keep the dashboard REST-first and projection-driven.
- Surface live podcast playback, wake-word voice control, and STT command routing in the same shell.
- Expose orchestrator-derived dashboard overview data as a single aggregation endpoint.
- Keep system-monitoring digests visible but separate from the main content-task story.

## Code changed

- Reworked the dashboard HTML, CSS, and JS into an AKIRA command center.
- Added `/v1/dashboard/overview` to the orchestrator.
- Added overview filtering so monitoring tasks do not pollute the main workflow cards.
- Added tests for dashboard overview shape and dashboard shell rendering.

## Validation

- `python3 -m unittest discover -s services/orchestrator/tests`
- `node --test apps/dashboard/server.test.mjs`
- Live browser verification of the AKIRA dashboard rendering and overview bindings

## Deferred

- richer layer-by-layer markdown authoring automation
- deeper podcast transcript controls
- real Elastic-backed monitoring reads
- fuller voice permission and error-state handling
