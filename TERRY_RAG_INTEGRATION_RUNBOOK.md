# TrialLight x Terry RAG Integration Runbook

## Purpose

This runbook documents the current Terry donor integration status for TrialLight and the exact steps required to complete the later production cutover.

This document is intentionally split into:

1. Code-complete items already merged into the active repo
2. Dangerous remote steps that are still pending and must be executed deliberately later

This runbook does **not** mean the cutover has already happened.

## Architecture Decision

The merged v1.5 direction is:

- CRC web remains the active host application under the current root `src/`
- Patient app remains the active host application under `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/`
- `newest-crc-web/` is treated as a **donor**, not a second runtime
- Firebase becomes the operational runtime store
- Supabase remains the analytics / retrieval / review / guidance store

The key storage boundary is locked as:

- **Firebase**
  - auth
  - `users/{uid}`
  - alerts / messages
  - incident operational docs
  - protocol operational docs
  - app runtime state
- **Supabase**
  - ePRO review / release backend
  - guidance documents
  - vector embeddings
  - retrieval function `match_guidance_documents(...)`
  - dashboard / analytics-facing summary tables when possible

The RAG and retrieval data must remain in Supabase-facing paths. Guidance document chunks and embeddings must not be moved into Firebase.

## Current Code-Complete Status

The following have already been merged into the active repo:

### 1. Firebase target preparation

- CRC web Firebase config is now env-based in:
  - `src/firebase.jsx`
- Patient app Firebase config is now env-based in:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/firebase.js`
- Root `.firebaserc` now points to:
  - `traillight-4750b` as the default project
  - `idp-authentication-7e8d7` as legacy

### 2. Supabase guidance schema

- New migration:
  - `supabase/migrations/20260409_guidance_documents_rag.sql`
- New schema objects:
  - `guidance_documents`
  - `match_guidance_documents(...)`
- Embedding dimensions are fixed to:
  - `4096`

### 3. CRC guidance frontend merge

- Current CRC chat host remains:
  - `src/components/GeminiChatbot.jsx`
- Terry-style routing / retrieval services are now integrated through:
  - `src/services/firebaseFunctionHttp.js`
  - `src/services/guidanceRouterService.js`
  - `src/services/guidanceRetrievalService.js`
  - `src/services/guidanceIngestionService.js`
- The active CRC guidance flow is now designed around:
  - route decision
  - retrieval / no-retrieval branching
  - server-backed guidance generation
  - bounded fallback reads only
- Existing read-storm protection remains mandatory.

### 4. Protocol guidance ingestion merge

- Active host remains:
  - `src/components/ProtocolManager.jsx`
- Upload / update flow now:
  - keeps existing protocol upload behavior
  - keeps dropout static-context extraction
  - also triggers guidance indexing
- Protocol docs now use guidance metadata fields such as:
  - `guidance_index_status`
  - `guidance_index_error`
  - `guidance_indexed_at`
  - `guidance_chunk_count`
  - `guidance_page_count`

### 5. Root Firebase Functions merge

- Active root backend package remains:
  - `functions/`
- Terry guidance features are merged into:
  - `functions/guidanceRuntime.js`
- Root exports are unified in:
  - `functions/index.js`
- Current single-package Functions contract includes:
  - `sideEffectGuidanceChat`
  - `sideEffectGuidanceChatHttp`
  - `classifyGuidanceRoute`
  - `classifyGuidanceRouteHttp`
  - `retrieveGuidanceContext`
  - `retrieveGuidanceContextHttp`
  - `ingestGuidanceDocument`
  - `deleteGuidanceDocumentChunks`
  - `deleteGuidanceDocumentChunksHttp`
  - `processPendingProtocolGuidanceIndex`
  - `suggestAppointmentDate`
  - `suggestAppointmentDateHttp`
  - existing `sendIncidentPushNotifications`

### 6. Appointment suggestion cutover

- Active host remains:
  - `src/services/appointmentService.js`
- Appointment AI suggestion is now designed to go through:
  - `suggestAppointmentDateHttp`
- Browser-side protocol PDF parsing for appointment suggestion has been removed from the active CRC path.

### 7. Local operational scripts now available

The active repo now includes local helper scripts to support later cutover work:

- CTCAE guidance bootstrap:
  - `scripts/guidance/upload-ctcae-and-index.mjs`
  - root shortcut:
    - `npm run guidance:bootstrap:ctcae`
- Firestore operational migration scaffold:
  - `functions/scripts/migrate-firestore-operational-data.mjs`
  - functions shortcut:
    - `npm run migrate:firestore`

These scripts were added to reduce later manual migration work.
They were **not** executed as part of the code-complete merge.

## What Has Not Been Executed Yet

The following are still pending and were **not** performed during the local code-complete merge:

- Supabase migration apply on the real remote project
- Guidance document bootstrap indexing
- Firebase Functions deploy
- Firebase Hosting switch
- Firebase Auth export / import preserving UIDs
- Firestore data migration
- Real traffic cutover to Terry Firebase

These are dangerous operational steps and must be run deliberately later.

## Current Known Blockers

The following blockers were identified during readiness checks:

- local source Firebase service account currently points to:
  - `idp-authentication-7e8d7`
- Terry Firebase service-account access is now available locally, but the current deployment principal still lacks the Firebase IAM needed for full live cutover:
  - Cloud Functions deploy currently fails on missing `iam.serviceAccounts.ActAs`
  - Firebase Hosting deploy currently fails with `403 The caller does not have permission`
- local root `functions/.env` has been filled to support the current Gemini live path, but full Terry retrieval/indexing is still blocked by missing external retrieval secrets, especially:
  - `SILICONFLOW_API_KEY`
  - any final production-approved retrieval/indexing secret bundle if the team wants SiliconFlow-backed grounded retrieval in this wave

This means the repo is code-complete and the Gemini live path is locally configured, but a full Terry RAG production deploy still depends on:

- Terry IAM sufficient for Functions / Hosting deploy
- the remaining retrieval/indexing secret bundle if grounded retrieval is meant to go live now
- patient-side protocol assignment and live-data completeness reaching a level that allows disengagement publish gates to pass

Latest live-cutover movement on the disengagement side:

- a curated patient-subject assignment sync has now written `16` reviewed `subject_id` values back into the TrialLight Firebase `users/{uid}` documents
- targeted verification shows the previously unmapped patients now fail on missing live operational timestamps rather than missing mapping
- this means subject mapping is no longer the dominant blocker; live data completeness is

## Required Environment Variables

### CRC web

Required env variables for the active CRC web:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_USE_FUNCTIONS_EMULATOR`
- `VITE_SIDE_EFFECT_GUIDANCE_PROVIDER`
- `VITE_SIDE_EFFECT_GUIDANCE_MODEL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- optional local fallback `VITE_GEMINI_API_KEY`

Expected Firebase target:

- `traillight-4750b`

### Patient app

Required env variables for the active patient app:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Expected Firebase target:

- `traillight-4750b`

### Root Firebase Functions

Required env variables / secrets for the merged root `functions/` package:

- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_CONTACT_EMAIL`
- `GEMINI_API_KEY`
- `SIDE_EFFECT_GUIDANCE_MODEL`
- `APPOINTMENT_GUIDANCE_MODEL`
- `GUIDANCE_ROUTER_MODEL`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_BASE_URL`
- `SILICONFLOW_EMBEDDING_MODEL`
- `SILICONFLOW_EMBEDDING_DIMENSIONS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Supabase Apply And Bootstrap Steps

These steps are still pending and should be executed later against the real Supabase project.

### Step 1. Apply guidance schema migration

Apply:

- `supabase/migrations/20260409_guidance_documents_rag.sql`

Expected result:

- `guidance_documents` table exists
- `match_guidance_documents(...)` exists
- vector dimension is `4096`

### Step 2. Re-index CTCAE canonical guidance

After the schema is live, bootstrap CTCAE guidance through the merged ingestion pipeline.

Expected result:

- CTCAE chunks are inserted into `guidance_documents`
- `source_type = 'ctcae'`

### Step 3. Re-index protocol PDFs

Existing uploaded protocol PDFs must be re-ingested under the new schema.

Expected result:

- protocol guidance chunks exist in `guidance_documents`
- protocol docs in Firestore move through:
  - `guidance_index_status = indexing`
  - then `guidance_index_status = ready`

### Step 4. Verify retrieval

Verify both:

- CTCAE-only retrieval
- protocol-grounded retrieval

Expected result:

- `match_guidance_documents(...)` returns grounded chunks
- both routes work for CRC side-effect guidance

## Firebase Auth Migration Runbook

This section is still pending. It documents the expected sequence.

### Goal

Move from:

- `idp-authentication-7e8d7`

To:

- `traillight-4750b`

Without changing the canonical user identity.

### Required rule

UIDs must be preserved.

Do **not** recreate accounts manually if that would change UIDs, because the following operational links depend on stable identity:

- `users/{uid}`
- subcollections under patient docs
- alerts / messages
- protocol assignments
- ePRO mirrors
- incident references

### Planned sequence

1. Export current Firebase Auth users from legacy Firebase
2. Import them into `traillight-4750b`
3. Validate that imported users retain the same `uid`
4. Only then begin Firestore document migration

## Firestore Data Migration Checklist

The following collections and subcollections must be accounted for before cutover:

- `users`
- `protocols`
- `incident_records`
- `alerts`
- nested `messages`
- patient vitals subcollections
- patient appointments subcollections
- patient ePRO mirror subcollections
- patient side-effect report subcollections
- any protocol assignment references
- dropout mirror docs still used by CRC views

### Required migration rule

Document IDs must be preserved whenever they are used as foreign-key-like operational references.

### Validation checklist

After migration, verify:

- patient roster count matches
- protocol assignment count matches
- selected patient data still resolves correctly
- alerts and message threads still open correctly
- incident detail links still resolve correctly
- CRC-only dropout visibility remains CRC-only

## Cutover Sequence

The production cutover sequence is locked as:

1. Supabase guidance migration ready
2. Root Functions merged and deployable
3. Firebase Auth export/import preserving UIDs
4. Firestore data migration preserving document IDs
5. CRC web Firebase target switch
6. Patient app Firebase target switch
7. Hosting switch

Do not run CRC web on Terry Firebase while patient app stays on the old Firebase for an extended period.

At most, allow only a very short migration window.

## Regression Checklist After Cutover

### CRC web

- sign in succeeds for CRC accounts
- patient roster loads
- side-effect guidance works through router/retrieval path
- protocol guidance indexing status is visible
- appointment suggestion works through Functions
- Safety Inbox still works
- ePRO review / release still works
- dropout dashboard still remains CRC-only

### Patient app

- sign in succeeds
- registration/profile flow still works
- vitals logging works
- appointments work
- side-effect reporting works
- ePRO submission works
- alerts/messages work
- patient never sees dropout outputs

### Read-storm protections

After merge and cutover, re-verify:

- no unbounded Firestore query
- no global full-scan fan-out in front-end guidance
- all `onSnapshot` listeners are cleaned up
- no retry storm on permission-denied / quota-exceeded

## Local Validation Already Completed

The following local validations have already been completed during the code-complete merge:

- targeted CRC lint passes
- root `functions/` package parses under Node
- appointment service compiles with the new server-backed function path
- protocol manager compiles with guidance indexing hooks
- CRC guidance host compiles with routed retrieval flow

This means the repo is code-complete for the merge, but still not production-cutover complete.

## Current Final Status

As of this runbook version, the project status is:

- **Donor merge:** code-complete
- **Supabase guidance schema:** prepared in repo
- **Root Functions merge:** code-complete
- **Firebase target switch in config:** active in local env for CRC and patient
- **Patient Auth recovery / reset migration:** partially executed
- **Patient-side Terry cutover:** materially advanced, but not fully closed
- **Root Functions deploy:** completed to `traillight-4750b` using an owner-authorized Firebase CLI session
- **Firebase Hosting deploy:** completed to `traillight-4750b`
- **Published hosting endpoints:**
  - CRC: `https://triallight.web.app`
  - patient: `https://triallight-patient.web.app`
- **Current live AI/runtime path:** the Gemini-based root Functions runtime is now live
- **Full Terry retrieval/indexing:** deferred unless the remaining external retrieval secrets are provided

This runbook should be used as the later operational checklist when the team is ready to perform the dangerous remote migration steps.
