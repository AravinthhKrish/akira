# Shared Contracts

The platform keeps two user-facing event lanes:

- `machine` events: canonical, append-only, replayable
- `narrative` events: humanized projections derived from machine events

The JSON schemas in this folder are transport-neutral and are meant to be shared across:

- dashboard UI
- orchestration service
- storage service
- Kotlin worker runtime

## Schemas

- `task-event.schema.json`: canonical task event envelope for machine and narrative streams
- `service-log.schema.json`: structured service log contract for stdout/file/Elastic shipping
- `monitoring-digest.schema.json`: structured backing record for system-monitoring podcast runs

## Core identifiers

- `taskId`: stable task identifier
- `runId`: orchestration run identifier
- `eventSeq`: monotonically increasing event order inside a task
- `narrativeSeq`: monotonically increasing narrative order inside a task

## Observability note

Service logs are expected to include:

- `dateTime`
- `serviceName`
- `logLevel`
- `threadName`
- `threadNumber`
- `className`
- `message`
- `context.traceId`
- `context.spanId`

Monitoring podcast digests are separate structured artifacts and should not replace canonical task events.

The monitoring digest audio payload may include inline base64 media metadata:

- `audio.mimeType`
- `audio.encoding`
- `audio.base64Data`
