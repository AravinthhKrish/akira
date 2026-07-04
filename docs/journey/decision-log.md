# Decision Log

## 2026-07-05

- Chose `docs/journey/` as the persistent in-repo context area for plans, prompts, and subplans.
- Stored the current platform plan as a **master plan** plus **layer-specific subplans** rather than one oversized document.
- Kept the structure additive so future iterations can append context instead of replacing history.
- Treated the current implementation as a **vertical slice**, not a finished production stack.
- Standardized observability around structured JSON service logs, Prometheus-style metrics, and a collector-to-Elastic path.
- Kept Elastic as an observability/search sink rather than replacing canonical task/event storage.
- Put the first system-monitoring podcast workflow inside the orchestrator with a 15-minute audio-first digest artifact.
- Kept a dated in-repo verification trail so each layer records not just intent, but what was actually exercised locally.
- Finalized the platform name as `AKIRA` and aligned the wake word, docs, telemetry prefixes, and deployment naming with that choice.
