# Dashboard Layer Subplan

Last updated: 2026-07-05

## Purpose

The dashboard is the human control surface for the platform. It should make the system feel observable, steerable, and conversational without becoming the system of record.

## Responsibilities

- create tasks
- show current task state and progress
- stream machine and narrative events
- replay prior task events
- show final script package artifacts
- provide wake-word driven speech-to-text controls
- speak narrative updates through browser audio

## Current implementation

- Node server in `apps/dashboard/server.mjs`
- browser UI in `apps/dashboard/public/`
- REST proxy to orchestrator
- SSE passthrough for live task events
- local WebSocket endpoint for voice session command routing
- browser `SpeechRecognition` / `webkitSpeechRecognition` integration
- browser `speechSynthesis` playback for narrative events
- structured JSON service logs
- `/metrics` endpoint with request and voice-session counters
- operations overview panel for service health, memory/error summaries, model usage, and monitoring digests
- AKIRA command-center shell with summary cards, task browser, podcast hero, agents, and alerts views
- `/api/dashboard/overview` wiring to the orchestrator aggregation endpoint
- live progress controls for new task, summary, replay, voice, and audio toggle actions

## Near-term improvements

- richer task list and historical run browser
- source/citation drill-down UI
- better empty-state handling for monitoring-only windows
- better replay filtering between machine and narrative events
- explicit microphone permission and failure states
- transport/auth hardening for WebSocket voice sessions
- richer monitoring digest browsing and playback controls

## Guardrails

- The dashboard must never become the canonical task state owner.
- Voice control stays limited to session control and summary requests.
- Narrative playback remains a projection of durable events, not a separate truth source.
