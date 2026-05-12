# CRC Guidance Trace Stream V1

## Purpose

This document describes the V1 implementation of the CRC-side detailed reasoning trace for Side Effect Guidance.

The goal is to make the CRC-facing guidance flow reviewable without exposing raw private chain-of-thought.

V1 uses:
- Firebase Functions v2 HTTP streaming
- authenticated POST requests
- newline-delimited JSON (`application/x-ndjson`)
- patient-linked Firestore persistence after completion

It does **not** use:
- Firestore as the live transport
- WebSockets
- LangGraph
- patient-side rendering

## Runtime Scope

V1 is CRC-only in the UI.

The event schema is intentionally shared so patient-side rendering can reuse the same stream contract later with stricter filtering.

## Backend Entry Point

Streaming function:
- `sideEffectGuidanceTraceStreamHttp`

Source file:
- `functions/guidanceRuntime.js`

This endpoint:
1. validates Firebase-authenticated CRC access
2. accepts a patient-scoped or workspace-scoped guidance request
3. streams structured reasoning events in real time
4. generates the final grounded answer
5. persists a patient-linked trace if `patientUid` is present

## Frontend Integration

Main UI:
- `src/components/GeminiChatbot.jsx`

Streaming HTTP helper:
- `src/services/firebaseFunctionHttp.js`

Streaming service wrapper:
- `src/services/sideEffectGuidanceService.js`

Feature flag:
- `VITE_CRC_GUIDANCE_TRACE_STREAM`
- enabled by default unless explicitly set to `false`

## Live Transport Contract

Each streamed line is one JSON object.

Common fields:
- `type`
- `traceId`
- `sessionId`
- `patientUid`
- `subjectId`
- `timestamp`
- `seq`

Event types:
- `trace_event`
- `final_answer`
- `trace_complete`
- `trace_error`

## CRC Reasoning Sections

The CRC panel renders the streamed trace as five reviewable sections:

1. `Observed signals`
2. `Retrieved evidence`
3. `Risk interpretation`
4. `Why this action`
5. `What would change the recommendation`

The trace is a structured audit artifact, not raw model inner monologue.

## Source Excerpts

The `Retrieved evidence` sections may include short excerpts from:
- CTCAE grounding
- protocol grounding

Each excerpt includes:
- `sourceType`
- `documentTitle`
- `citationLabel`
- `excerptText`
- `relevanceReason`

Excerpts are intentionally short and review-oriented.

## Persistence Model

Patient-linked trace summary:
- `users/{patientUid}/guidance_traces/{traceId}`

Full event log:
- `users/{patientUid}/guidance_traces/{traceId}/events/{seq}`

The parent trace summary stores:
- `traceId`
- `sessionId`
- `patientUid`
- `subjectId`
- `crcUid`
- `crcDisplayName`
- `questionText`
- `finalAnswerText`
- `startedAt`
- `completedAt`
- `provider`
- `model`
- `sourceMask`
- `retrievalUsed`
- `protocolId`
- `protocolName`
- `incidentId`
- `sideEffectReportId`
- `saveVersion`
- `traceStatus`
- `displaySummary`
- `latestStepTitle`

V1 persistence rule:
- patient-scoped CRC guidance answers are persisted
- generic non-patient guidance answers are not persisted as patient-linked traces

## Firestore Cost / Read Storm Guardrails

V1 is designed to avoid Firestore storms:

- live reasoning is streamed over HTTP, not written step-by-step into Firestore
- event writes happen only after completion or failure
- CRC history queries are bounded with `limit(20)`
- full event detail is loaded only when one trace is opened
- no unbounded collection reads were added for this feature

## UI Behavior

CRC sees:
- a short collapsed `Thinking...` state
- an expandable reasoning panel while the answer is still running
- a saved reasoning panel attached to persisted patient-linked model answers
- a `Patient AI Guidance History` panel in docked patient workspace mode

The history panel is review-only and bounded to the active patient.

## Current Limitations

- V1 depends on the current Firebase Functions + Gemini runtime rather than a dedicated orchestration server.
- If Firestore rules block direct browser reads to `users/{patientUid}/guidance_traces/*`, the next fallback should be backend list/detail endpoints instead of expanding browser reads.
- Patient-side rendering is intentionally out of scope for V1.
- Raw private chain-of-thought is intentionally not exposed.

## Intended Next Step

After CRC-side validation:
- keep the event contract stable
- refine excerpt quality and action rationale wording
- later add a filtered patient-safe renderer on the patient surface if needed
