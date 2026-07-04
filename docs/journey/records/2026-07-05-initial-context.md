# Initial Context Record

Date: 2026-07-05

## Prompt summary

The project started from the idea of building a multi-agent platform with an AKIRA-like feel:

- agent news
- agent email
- agent feeds
- agent ideas
- agent orchestra
- agent MCP
- agent skills
- agent podcast

The first serious scope was narrowed to a **news-to-podcast digest** workflow with:

- live dashboard
- audio output
- wake-word interaction
- speech-to-text task control
- REST status APIs
- replayable progress

## Grounding inputs

- `Agent Listener Orchestration for Humanized Multi-Agent Progress Streaming.pdf`
- sibling repo: `mcp-server-generic`
- sibling repo: `api-chat-app`

## Key decisions reached

- Use this repo as the composition/integration repo.
- Keep the first release local-first and single-user.
- Keep orchestration explicit-graph based.
- Let the dashboard be Node-based.
- Let orchestration be Python-based for now, shaped around LangGraph concepts.
- Treat Kotlin/Koog as the target worker-runtime layer.
- Make storage pluggable by deployment profile, with disk as the first concrete backend.
- Keep the machine event stream canonical and the narrative stream derived.

## What was implemented from that plan

- dashboard service and browser UI
- orchestration service
- storage service
- Kotlin worker scaffold
- contracts folder
- compose and Kubernetes manifests

## What is still deferred

- real Koog workers
- real broker-backed JetStream flow
- hardened auth model
- production-grade wake-word and STT pipeline
- deep integration with real external providers
