# 2026-07-20 AKIRA News Context + Recurring MCP Search

## Trigger

The user wanted the news agent to stop being topic-only and instead carry a reusable task context plus a schedule so each run can search news with more intent.

## Decisions captured

- Keep context task-scoped, but snapshot it onto the task for replay and audit.
- Keep the MCP news contract text-based for v1 and expand the task profile into a single search string inside the orchestrator.
- Use a recurring fixed interval rather than cron for the first scheduler.
- Keep high-risk control surface behavior in the UI/API, while the orchestrator owns the actual refresh loop.

## Code changed

- Extended orchestrator task creation to persist `newsContext`, `newsSchedule`, and the latest `newsQuery`.
- Added a background refresh loop that re-runs due contextual news tasks and emits replayable machine and narrative events.
- Added a contextual news profile composer to the dashboard with topic, keywords, exclusions, entities, source preferences, freshness, and refresh interval inputs.
- Added dashboard rendering for the saved profile, the expanded query, and recurring refresh metadata.
- Added tests for query expansion, schedule parsing, and replayable scheduled refresh behavior.

## Deferred

- Structured MCP tool parameters for news discovery.
- Saved profile management outside individual tasks.
- Cron-like or calendar-based schedule expressions.
- Agent runtime changes for bespoke contextual news workers.
