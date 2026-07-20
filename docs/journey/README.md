# Journey Docs

This directory keeps the planning trail for the platform inside the repository so future work can build on real prior context instead of reconstructing intent from memory.

## Structure

```text
docs/journey/
├── master-plan.md
├── decision-log.md
├── records/
│   └── 2026-07-05-initial-context.md
│   └── 2026-07-05-structured-observability.md
│   └── 2026-07-05-local-verification.md
│   └── 2026-07-05-akira-command-center.md
│   └── 2026-07-05-model-router-config.md
│   └── 2026-07-20-k8s-dependency-config.md
│   └── 2026-07-20-news-context-recurring-search.md
└── layers/
    ├── dashboard.md
    ├── orchestrator.md
    ├── storage-mcp-platform.md
    ├── agent-runtime.md
    ├── contracts-and-events.md
    ├── deployment-and-ops.md
    └── kubernetes-dependencies-and-config.md
```

## How to use this

- Update `master-plan.md` when the overall platform direction changes.
- Add a new file under `records/` for each significant design session, implementation phase, or prompt cluster.
- Update the relevant file under `layers/` whenever one subsystem changes shape, gains responsibilities, or needs a new subplan.
- Add short dated bullets instead of rewriting history when possible.

## Recommended update pattern

For a new iteration, record:

1. what prompt or product request triggered the change
2. what decision was made
3. what code changed
4. what is still intentionally deferred
