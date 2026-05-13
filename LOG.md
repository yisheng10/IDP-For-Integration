# TrialLight Project Log

## Last Updated
- Date: 2026-05-13
- Workspace: `D:\IDP For Integration`

## Current Objective
- Stabilize TrialLight v1 for internal teammate testing across the CRC website and patient app.
- Keep the workspace as an integration layer across the CRC web app, patient app, ePRO service, and dropout backend.

## Overall Status
- CRC website: active and under heavy integration.
- Patient app: active and usable for core testing flows.
- ePRO service: active and connected to the patient app flow.
- Dropout backend: active locally through Python 3.12 tooling, but still a separate repository/runtime.
- Production cloud functions: partially blocked by Firebase plan limitations.

## Completed Work
### Dropout QA Live-History Seed Script
- Added `functions/scripts/seed-dropout-qa-live-history.mjs` for Patient Disengagement Prediction QA setup.
- The script is intentionally budget-safe:
  - it performs zero Firestore reads
  - it never scans users or collections
  - it only writes deterministic documents for an explicit `--uid`
  - it defaults to dry-run and requires `--apply` before any Firestore writes happen
- Added `npm --prefix functions run seed:dropout-qa-live-history` as the local entrypoint.
- Supported QA scenarios are `low`, `medium`, and `high`, with 5-14 days of targeted vitals, ePRO submissions, appointments, adverse event reports, incidents, and CRC follow-up thread data.
- Verification:
  - `node --check functions\scripts\seed-dropout-qa-live-history.mjs` passed
  - `npm.cmd --prefix functions run seed:dropout-qa-live-history -- --uid=QA_TEST_UID --scenario=high --days=7` passed as dry-run and planned 19 writes with `Firestore reads: 0`
- Applied the QA seed script to 10 explicitly supplied patient UIDs for tomorrow's dropout prediction testing:
  - 3 low-risk scenario patients
  - 4 medium-risk scenario patients
  - 3 high-risk scenario patients
- The apply run committed 193 deterministic Firestore writes and the script reported `Firestore reads performed by this script: 0` for every patient.
- Re-ran the same 10 QA seed jobs against the active Firebase project `traillight-4750b` after confirming an earlier local seed had accidentally used a retired service account for another project.
- Hardened `functions/scripts/seed-dropout-qa-live-history.mjs` so it now:
  - refuses application-default credentials
  - requires explicit service-account input
  - hard-fails unless the credential `project_id` is exactly `traillight-4750b`
- Extended `functions/scripts/seed-dropout-qa-live-history.mjs` with a QA-only `--patch-protocol-anchor` mode.
  - This keeps the QA patient's `protocolAssignedAt` aligned with the seeded 7-day live-history window.
  - It does not weaken the production disengagement scoring threshold or change the live publisher anchor contract for real patients.
- Re-applied the 10 explicit QA patient seeds with the protocol-anchor patch against `traillight-4750b`:
  - 3 low-risk scenario patients at 20 writes each
  - 4 medium-risk scenario patients at 21 writes each
  - 3 high-risk scenario patients at 20 writes each
  - total writes: `204`
  - total reported Firestore reads: `0`
- Removed the retired Firebase project alias from root `.firebaserc`.
- Verified the old `secrets/firebase-service-account.json` runtime path no longer exists in the workspace, so no legacy service-account file remained at that original location.
- Updated deprecated reference Firebase config files to point at `traillight-4750b` instead of the retired pre-cutover project:
  - `Patient_web_v2/Code/src/firebase.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/Code/src/firebase.js`
- Updated the Terry integration runbook so active operational guidance now treats `traillight-4750b` as the only Firebase runtime project.
- Updated the dropout explainability mirror contract and CRC UI honest reporting:
  - `dropout_predictions_explainability/current` payloads now include `mirror_status`, `blocked_reasons`, `source_coverage`, `source_errors`, and `missing_required_sections`
  - publish logs and dashboard summary now include ready/partial/blocked mirror counts
  - live source read errors are carried into patient-level mirror docs instead of being silently treated as empty data
  - CRC `Patient Disengagement Prediction` no longer uses legacy snapshot fields as a fake explainability mirror fallback
  - switching between patients now clears the previous explainability payload immediately, so the CRC panel no longer briefly shows another patient's mirror
  - missing `mirror_status` no longer gets silently treated as `ready`
  - global fallback snapshot rows now label themselves as fallback data instead of looking like ordinary patient-window rows
  - legacy snapshot sections are explicitly labeled as legacy operational context rather than dedicated explainability content
  - explainability mirror payloads now also expose anchor/history diagnostics:
    - `anchor_date`
    - `anchor_date_source`
    - `recent_window_start`
    - `history_day_count`
    - `global_final_day_index`
    - `usable_live_history`
    - `protocol_assigned_at`
    - `patient_static_context_source`
    - `protocol_static_context_source`
- Investigated a later manual workflow run that showed `0 scored patients` even though the QA seed had already landed correctly in `traillight-4750b`.
  - Verified with exact Firestore reads that the seeded QA patient docs, `protocolAssignedAt`, vitals, ePRO submissions, incidents, alerts, and alert messages were present in the active Firebase project.
  - Verified that the affected QA patients still had valid `role=patient`, `subject_id`, and matching `dropout_trial_id` / protocol-linked trial IDs.
  - Root cause: the publish CLI only parsed `--firebase-uids` as comma-separated text. If a manual GitHub Actions run pasted newline- or space-separated UIDs, the workflow treated the whole block as one invalid target UID and filtered out every patient.
  - Hardened `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` to accept comma-, space-, or newline-separated UID input and to log the parsed target UID count plus a preview of the resolved list.
  - Updated `.github/workflows/dropout-precompute.yml` so the manual-dispatch input description now explicitly says commas, spaces, or new lines are accepted.
- Fixed the GitHub Actions dropout publish workspace verification by force-adding the required Candidate 024 scoring artifact to the external dropout repository branch:
  - `deploy_assets/checkpoints_candidate_024/artifacts_stage_3_29_single.pkl`
  - commit `e753685` on `yisheng10/Patient-Dropout-Prediction:codex/candidate-024-disengagement-hardening`
- Did not add or publish subject registry CSV files; patient/subject registry data remains excluded from this repair.
  - missing mirror docs now display `Explainability mirror has not been published for this patient.`
- Updated `.github/workflows/dropout-precompute.yml` so the workflow checkout for `yisheng10/Patient-Dropout-Prediction` uses the pushed `codex/candidate-024-disengagement-hardening` branch during QA validation.
- Relaxed the workflow file verification so it no longer requires the subject context registry CSV to be committed into GitHub. The live publisher already treats that registry as optional and can continue using Firestore patient/protocol context without uploading subject-level registry data.
- Verification:
  - `python -m py_compile Patient-Dropout-Prediction\src\crc_integration_contracts.py Patient-Dropout-Prediction\src\explainability_summary.py Patient-Dropout-Prediction\src\publish_dropout_snapshots.py` passed
  - `npm.cmd run build:crc` passed

### Shared Gemini Key Pool Rotation For Official Online Backends
- Added a private Supabase key registry table in `supabase/migrations/20260513_gemini_key_registry.sql`.
- Implemented Firebase Functions key-pool rotation in:
  - `functions/geminiKeyRegistry.js`
  - `functions/guidanceRuntime.js`
- Implemented Supabase ePRO key-pool rotation in:
  - `supabase/functions/_shared/geminiKeyRegistry.ts`
  - `supabase/functions/_shared/eproShared.ts`
- Rotation now follows the agreed production policy:
  - `429 / quota / rate-limit` -> mark key as `reached_limit` until the next Kuala Lumpur day reset (`00:05`)
  - leaked / invalid / permission-denied style failures -> mark key as `disabled`
  - transient service failures can rotate to the next key without permanently disabling the current one
- Scope is limited to the official online backends:
  - Firebase guidance runtime for CRC website and patient guidance backend
  - Supabase ePRO questionnaire generation runtime
- Future key replacement is now intended to happen directly in the Supabase private registry table instead of forcing a redeploy just to swap one exhausted key.
- Added low-capacity warning logs when the active shared key pool drops below 3 usable keys.
- Installed `Deno 2.7.14` into the local Windows user environment to support Supabase Edge tooling and future `deno check` / debugging work.
- Applied the registry SQL to the live Supabase project `fygkqituefwldmglijvy` using the exact migration only, instead of pushing all pending migrations.
- Seeded the first production Gemini key batch into the live private registry table with 9 active keys across:
  - `Yi sheng`
  - `jian hong`
- Expanded the live private Gemini key registry with an additional 14 active keys across:
  - `li qiu`
  - `liqiuFriend`
- Expanded the live private Gemini key registry again with an additional 2 active keys across:
  - `terry`
- Verified the live registry count after expansion:
  - total keys: `28`
  - active: `28`
  - reached_limit: `0`
  - disabled: `0`
- Deployed the updated Firebase guidance functions to project `traillight-4750b`:
  - `sideEffectGuidanceChat`
  - `sideEffectGuidanceChatHttp`
  - `sideEffectGuidanceTraceStreamHttp`
  - `classifyGuidanceRoute`
  - `classifyGuidanceRouteHttp`
  - `suggestAppointmentDate`
  - `suggestAppointmentDateHttp`
- Deployed the updated Supabase ePRO functions to project `fygkqituefwldmglijvy`:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`
- Verified the live registry now contains the seeded key labels only (no raw key logging) and all 9 entries were active immediately after seeding.

### ePRO Protocol Questionnaire Anchor Recovery
- Confirmed the live dropout prediction adapter currently consumes `pain_score` and `anxiety_score` from ePRO submissions, while `stress` is not yet a formal dropout feature.
- Confirmed protocol-specific baseline generation was working, but shared anchor questions were no longer guaranteed once Gemini generated protocol-specific questionnaires.
- Added a shared ePRO anchor-question post-processing step in `supabase/functions/_shared/eproShared.ts` so every protocol-specific baseline now preserves:
  - `How would you rate your pain today? (0-10)`
  - `How would you rate your anxiety today? (0-10)`
  - `How would you rate your stress today? (0-10)`
- Implemented the anchor insertion at the shared runtime layer instead of the patient UI, so:
  - trial-level review rows
  - patient-level review rows
  - daily survey delivery
  - submission-time answer summarization
  all stay on the same questionnaire shape.
- Deployed the updated shared ePRO runtime to Supabase project `fygkqituefwldmglijvy`:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`

### Patient Disengagement Prediction Final Hardening
- Split strict disengagement upload into two separate layers:
  - phase parsing still recognizes raw labels such as `3`, `Phase 3`, and `Phase III`
  - phase admission now enforces the whitelist `early phase 1`, `phase 1`, and `phase 2`
- Tightened strict upload policy so `phase 3` and `phase 4` are rejected by default unless a one-time audited override is explicitly supplied.
- Replaced the old visible manual override selector with a hidden `Advanced exception` path:
  - normal upload keeps no visible override control
  - exception upload is one-time only
  - exception targets are limited to `phase 0`, `phase 1`, and `phase 2`
  - the operator must type `ALLOW EXCEPTION` before the upload is allowed
- Kept backend override audit data in Firestore while removing all manual override disclosure from the normal CRC UI:
  - no visible `Manual phase override` pill
  - no visible extracted-vs-resolved phase explanation
- Added automatic disengagement dataset-trial binding after strict upload:
  - the server scans extracted PDF text for `NCT...` identifiers
  - it auto-configures `dropout_trial_id` only when exactly one supported trial is found
  - zero-match and multi-match cases now remain unbound with explicit status metadata
- Added a callable migration path for already-uploaded protocols:
  - `Save template` now re-runs strict dataset-trial auto-binding from the stored PDF when the protocol has ready static context but no saved disengagement trial ID yet
  - this prevents previously uploaded strict-ready protocols from staying permanently stuck in a generic unconfigured state
- Reworked protocol template status presentation so disengagement setup is no longer collapsed into a vague `Not configured` state.
- Tightened protocol-to-patient assignment rules so `Assign to selected patient` is disabled unless the protocol is fully configured for disengagement:
  - strict static context ready
  - supported dataset trial ID configured
  - canonical subject pool verified
- Added stale mapping cleanup so trial-pool changes now automatically clear old patient `Subject ID` values instead of keeping invalid cross-trial mappings.
- Applied the same stale `Subject ID` cleanup in backend protocol-to-patient sync, so protocol trial binding changes do not leave old subject mappings behind.
- Deleting a protocol assignment now also clears patient `Subject ID` values instead of leaving stale mappings after the template disappears.
- Separated guidance indexing failures from disengagement upload success messaging so a guidance retry problem no longer looks like a dropout static-context failure.

### Patient Disengagement Prediction Strict-Mode Repair
- Fixed the CRC `Patient Disengagement Prediction` runtime crash caused by stale detail-panel variables still referencing:
  - `explanationSignals`
  - `missingInputs`
  - `dataQualityFlags`
  The panel now uses the current explainability data structure and no longer crashes on page load.
- Replaced the old browser-side disengagement static-context extraction path with a strict server-side callable flow:
  - `functions/protocolStaticContextRuntime.js`
  - `src/services/protocolStaticContextService.js`
- The new strict upload flow now works as:
  - browser uploads the PDF into a temporary staging path
  - Firebase Function downloads the PDF bytes server-side
  - server extracts PDF text
  - server calls Gemini
  - server validates a complete `dropout_static_context`
  - only then does the server create or update the `protocols/{id}` document
- Removed the old degraded behavior where protocol upload could succeed with a disengagement warning even when static-context extraction had fallen back or failed.
- Added strict protocol static-context state handling so the frontend now treats:
  - `ready` as usable
  - `extracting` / `pending` as not ready
  - `error` and legacy `fallback_only` as failed and ineligible for disengagement prediction
- Tightened protocol-template trial binding so `Optional disengagement dataset trial ID` can still stay visible and editable, but save is now blocked whenever:
  - strict protocol static context is not `ready`
  - the trial ID is unsupported
  - the canonical subject pool is unavailable
- Tightened patient `Subject ID` behavior so the field remains visible, but selection is now disabled whenever the assigned protocol has not finished strict server-side static-context extraction.
- Updated the patient coordination workspace so the mapping note now explicitly reflects strict protocol readiness rather than only trial-ID support.
- Tightened the Firebase Functions protocol-trial binding runtime so backend validation now also blocks disengagement trial binding unless protocol `extraction_status === "ready"`.
- Tightened the live dropout publish chain so protocols whose extraction status is not `ready` are now treated as missing required protocol static context and skipped from publish eligibility.
- Converted the existing protocol static-context backfill script to strict mode only:
  - it no longer writes `fallback_only`
  - successful re-extraction writes `ready`
  - failed re-extraction writes `error`
- Local validation passed after the strict-mode changes:
  - `npm.cmd run build:crc`
  - `node --check functions/protocolStaticContextRuntime.js`
  - `node --check functions/index.js`
  - `node --check functions/dropoutRegistryRuntime.js`
  - `python -m py_compile Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  - `python -m py_compile Patient-Dropout-Prediction/src/live_data_adapter.py`

### Patient Disengagement Prediction Rebuild
- Reworked disengagement trial binding so CRC can still see and edit:
  - patient `Subject ID`
  - protocol `Optional disengagement dataset trial ID`
  while removing the old dependency on manual trial-ID guessing and manual GitHub Action subject-pool recovery.
- Added a generated supported-trial seed and frontend metadata layer:
  - `functions/generated/dropoutTrialRegistrySeed.json`
  - `src/generated/dropoutTrialSupportMetadata.json`
  - `scripts/generate_dropout_trial_registry.py`
- Added a backend-owned dropout trial registry runtime:
  - `functions/dropoutRegistryRuntime.js`
  - `functions/index.js`
- Added Firebase Functions to:
  - verify a supported disengagement trial ID
  - sync its canonical `TL-SXXXXX` subject pool into Firestore
  - bind a protocol template to a verified trial
  - refresh configured trial registries on a schedule
- Rebuilt the CRC protocol-template flow so `Optional disengagement dataset trial ID` now:
  - stays visible and editable
  - shows inline configuration state
  - shows helper metadata such as pool size, model version, and verification time
  - blocks save inline when the trial ID is unknown, unsupported, or not ready
- Rebuilt the CRC patient mapping flow so `Subject ID` now:
  - stays visible and editable
  - only loads options from the verified current-trial registry pool
  - auto-hydrates missing registry data through Firebase Functions
  - no longer depends on the mirrored Supabase subject pool being manually refreshed first
- Updated disengagement mapping validation to enforce:
  - same-trial subject selection only
  - unique subject assignment across patients
  - explicit inline errors for duplicate, cross-trial, unsupported-trial, and not-configured states
- Reworked live dropout publish so the publisher now:
  - self-heals configured Firestore `dropout_trial_registry` entries before publish
  - syncs only the currently configured trial pools instead of blindly depending on manual subject-pool recovery
  - reports unsupported trial IDs explicitly in mapping diagnostics
  - treats `no eligible mapped patients` as a configuration skip instead of a hard runtime crash
- Reframed early disengagement output in CRC so day 1-2 patients now read as:
  - `Collecting data`
  - `Data not sufficient yet`
  instead of looking like broken or fake low-risk predictions
- Verified locally that the rebuilt path is syntactically sound:
  - `npm.cmd run build:crc`
  - `node --check functions/dropoutRegistryRuntime.js`
  - `python -m py_compile Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`

### Subject ID Governance And Dropout Publish Integrity
- Tightened CRC subject mapping behavior so `Subject ID` is now treated as a controlled canonical bridge instead of a free-form selection.
- Updated the CRC patient configuration panel to surface:
  - current protocol name
  - current `dropout_trial_id`
  - mapping status: `Mapped`, `Unmapped`, or `Invalid mapping`
- Clarified the UI helper copy so CRC users now see that:
  - `TL-SXXXXX` values come from the canonical dropout subject registry
  - they are not random IDs
  - they do not affect patient login or general profile management
- Added an explicit empty-subject-pool warning in CRC patient configuration so the Subject ID field now explains whether:
  - the current protocol is missing `dropout_trial_id`, or
  - the selected trial currently has no mirrored canonical subject pool
- Stopped loading the entire canonical subject pool when the selected protocol has no configured `dropout_trial_id`; the Subject ID dropdown now only loads the current trial pool.
- Added active-patient mapping validation in CRC coordination mode so duplicate, cross-trial, or missing-trial mappings are surfaced immediately as invalid configuration.
- Persisted `dropout_trial_id` onto the patient record when CRC saves a protocol assignment, so downstream dropout publishing can resolve trial-aligned mapping more reliably.
- Updated live dropout publish integrity rules so the publisher now:
  - excludes duplicate subject mappings from scoring eligibility
  - excludes cross-trial subject mappings from scoring eligibility
  - excludes mappings that have no resolved protocol `dropout_trial_id`
  - tracks `eligible_mapped_patient_count` explicitly in publish diagnostics
- Changed dropout publish gates so required success-rate gates now use only the eligible mapped population as the denominator instead of all scanned patient docs.
- Added a separate warning-only `mapped_subject_coverage_rate` gate so missing or invalid mappings are still visible without automatically blocking valid mapped patients from publishing.

### CRC Safety And Patient Deletion Cleanup
- Replaced the CRC `Delete patient` flow with a server-side hard purge path instead of a browser-side single-doc delete.
- Added privileged Firebase Functions admin actions for:
  - global CRC urgent-incident counting
  - patient hard purge with shared `incident_records` cleanup
- Locked the hard purge behavior to:
  - recursively remove the patient `users/{uid}` tree
  - scrub or delete linked `incident_records` depending on whether the incident is shared with other patients
  - attempt Firebase Auth user deletion after Firestore purge
- Updated the CRC client delete flow so the UI:
  - still requires typing `DELETE`
  - now warns that roster, safety, guidance, ePRO, prediction, and related runtime data will be purged
  - surfaces backend warnings if Auth cleanup partially fails
- Removed extra `Trial assignment` explanatory copy in `Patient configuration` without changing assignment logic.
- Kept `Safety` split into `Open`, `Resolved`, and `History`.
- Changed the top-right `Urgent` button so its count is now based on a dedicated global CRC urgent-summary backend path instead of the current-CRC-only client filter.
- Kept the `Urgent` click behavior unchanged:
  - it still routes to `Safety > Open`
  - it does not apply an urgent-only filter on entry
- Deployed the new live Firebase Functions to `traillight-4750b`:
  - `purgePatientRecord`
  - `fetchCrcUrgentIncidentSummary`
- Fixed the first live `purgePatientRecord` runtime failure caused by using the Firestore Admin `DocumentSnapshot.exists` property as a function, then redeployed the corrected function.

### Dropout Extreme Audit And Deploy Hardening
- Upgraded the dropout training path so future candidate runs retain mandatory training-dynamics artifacts:
  - `training_summary.json`
  - `epoch_history.csv`
  - TensorBoard event logs
- Confirmed the frozen `honest_v3_official` runs already retain `training_summary.json` with epoch-by-epoch `epoch_history`, then wired those real frozen-run dynamics into the report figure pipeline instead of treating them as unavailable.
- Extended the official audit runner to generate additional deploy/report-grade artifacts:
  - subgroup-specific source-level SHAP outputs
  - SHAP stability across challenger seeds
  - calibration stability audit
  - transformer split-level calibration summary
- Re-ran the full official extreme audit on the CUDA environment and refreshed:
  - `Patient-Dropout-Prediction/audit/official_model_extreme_audit/`
  - `Patient-Dropout-Prediction/report_figures/patient_dropout/`
- Expanded the report figure package from 16 to 20 figures, adding:
  - official training dynamics
  - calibration stability evidence
  - subgroup-specific source-level TreeSHAP
  - source-level SHAP stability across seeds
- Added a deploy-facing publish gate layer to the live publisher so publish summaries now evaluate:
  - score-generation success rate
  - usable static-context coverage
  - sufficient live-history coverage
  - symptom-source coverage
  - limited-confidence rate
- Configured the publisher to block unsafe live publish on failed required gates and to surface limited-coverage mode explicitly instead of silently publishing as full-strength.
- Added deployment and promotion guidance docs for the dropout module:
  - `Patient-Dropout-Prediction/DUAL_ENGINE_EXPLAINABILITY_NOTE.md`
  - `Patient-Dropout-Prediction/DEPLOY_READINESS.md`
  - `Patient-Dropout-Prediction/CANDIDATE_PROMOTION_POLICY.md`
- Added a structured candidate-search entrypoint:
  - `Patient-Dropout-Prediction/src/run_candidate_search.py`
- Refreshed dropout truth-source docs so they now explicitly mention:
  - mandatory training dynamics
  - shadow explainer positioning
  - deploy gating expectations
  - continued `pre-testing` / `not real-world validated` positioning

### Dropout Model Rebuild
- Rebuilt the dropout backend around a single-model `stage_3_29_single` contract.
- Removed the old staged strategy from the active training/inference path:
  - `stage_3_6`
  - `stage_7_29`
  - `stage_30_plus`
- Locked the new scoring policy to:
  - score only day 3 to day 29
  - treat day 1 to day 2 as `insufficient history`
  - predict 7-day disengagement risk
- Replaced unrealistic dynamic placeholders such as `med_status` and `task_ratio` with TrialLight-style operational signals:
  - vitals activity and abnormal-vitals counts
  - ePRO recency and completion state
  - appointment adherence and missed-visit signals
  - CRC follow-up responsiveness
  - side-effect reporting and emergency-event counts
- Rewrote the dropout synthetic generator so it now emits:
  - patient-day operational signals
  - `disengagement_event_today`
  - `is_disengaged`
  - `label_disengagement_7d`
- Reworked the dropout training pipeline to support:
  - one fixed 7-day lookback window
  - one fixed 7-day prediction horizon
  - patient-level and trial-level split strategies
  - recall-first model selection using `precision at recall >= 0.80`
  - logistic-regression baseline comparison
  - feature-group ablation entrypoints
- Updated dropout inference, batch inference, adapter, and evaluation files so they align with the new single-model contract.
- Added minimum consistency handling for `insufficient history` routing in the inference path.
- Targeted syntax validation passed for the rewritten dropout files via `py_compile`.
- End-to-end runtime training smoke test is still blocked in the current Codex environment because the available Python runtimes here do not have the required project packages installed.

### Dropout Hybrid Real-Trial Rebuild
- Replaced the previous pure-synthetic dropout generator with a hybrid generator grounded in:
  - `merged_allphases_X_dedup.csv`
  - `merged_allphases_Y_dedup.csv`
- Locked dropout training around real trial metadata priors:
  - `trial_phase`
  - `condition_family`
  - `criteria_complexity`
  - `enrollment`
  - `trial_dropout_prior`
  - intervention-profile flags
- Removed the old frequency-bucket `condition_cat` direction and replaced it with an explicit clinical-family mapping derived from `condition_browse/mesh_term` with fallback to `condition`.
- Reworked the generator to retain latent patient archetypes and MNAR behavior, while replacing unrealistic observed placeholders with TrialLight-style operational signals:
  - vitals completion ratios
  - ePRO completion ratios
  - appointment adherence
  - CRC follow-up responsiveness
  - side-effect burden
  - symptom burden composite
- Added structured burden features for:
  - `pain_score_*`
  - `anxiety_score_*`
  - `ctcae_grade_*`
- Introduced a canonical CTCAE-grade proxy path so the training contract can use numeric `ctcae_grade_*` features even while the product surface still operationally emits `mild / moderate / serious`.
- Changed the synthetic schedule logic from global fixed cadence to trial-conditioned cadence priors for:
  - vitals
  - ePRO
  - appointments
- Tightened synthetic realism:
  - `dist_km` is now capped to realistic ranges
  - `criteria_complexity` now comes from eligibility line count instead of raw text length
  - caregiver support is now conditionally sampled instead of flat random
- Updated training, feature-pipeline, adapter, inference-helper, batch-inference, and evaluation code so the new hybrid schema is internally consistent.
- Post-change syntax validation passed again for the updated dropout code via `py_compile`.

### Workspace Governance
- Added root workspace governance and phased planning documents.
- Locked the v1 product boundary:
  - CRC website is CRC-only.
  - patient mobile app is patient-only.
  - ePRO remains a separate service used by the patient app.
  - dropout prediction remains CRC-only.

### CRC Website
- Reworked the CRC shell toward a cleaner dashboard layout.
- Added section-based CRC workflows for:
  - Dashboard
  - Patients
  - Safety Inbox
  - Study Coordination
  - Resources
- Renamed CRC AI workspace from `AI Copilot` to `Side Effect Guidance`.
- Promoted `Patient Dropout Prediction` as a core CRC intelligence module directly under `Side Effect Guidance`.
- Added CRC-side safety inbox and grouped incident handling.

### Patient App
- Preserved patient-only surface boundaries.
- Integrated native ePRO access.
- Added patient vital logging with automatic abnormal-value escalation.
- Shifted side-effect intake toward AI-assisted symptom guidance and audit-preserved chat flows.

### Safety And Incident Flow
- Added structured incident records for side effects and emergencies.
- Added protocol-aware escalation handling.
- Preserved emergency positioning as support/documentation, not replacement for direct emergency phone escalation.

### AI Guidance
- Local CRC `Side Effect Guidance` was cut over from local Ollama dependency to a Firebase callable flow designed for Gemini.
- Local emulator testing confirmed CRC guidance can return Gemini output in local development.
- Provider abstraction direction is in place so qwen can be restored later without redesigning the CRC UI.
- Added patient-side detailed reasoning trace support by switching the patient app's primary Side Effect Guidance path from browser-direct Gemini to the shared Firebase Functions streaming contract.
- Extended the active guidance runtime so `sideEffectGuidanceTraceStreamHttp` now supports patient-scoped authenticated streaming with `traceAudience: "patient"` and patient-safe trace wording.
- Added patient-side NDJSON streaming support and a dedicated guidance service adapter:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/firebaseFunctionHttp.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/sideEffectGuidanceService.js`
- Upgraded patient `GeminiChatbot.js` so patient guidance now:
  - shows live expandable reasoning trace before the final answer
  - attaches persisted trace references to saved AI answer bubbles
  - keeps the old browser path only as fallback behind config
- Patient trace persistence now reuses the patient-linked audit structure under:
  - `users/{patientUid}/guidance_traces/{traceId}`
  - `users/{patientUid}/guidance_traces/{traceId}/events/{eventId}`
  with patient-specific audience/origin metadata instead of CRC-only records.
- Updated the patient app config defaults to prefer backend guidance streaming:
  - `EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_PROVIDER=firebase-callable`
  - `EXPO_PUBLIC_PATIENT_GUIDANCE_TRACE_STREAM=true`
- Local validation completed for the patient trace implementation:
  - `node --check functions/guidanceRuntime.js`
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
  - `npm --prefix MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2 run export:web`
- No patient-side live deploy was executed in this step; remote Functions/Hosting rollout remains a separate dangerous operation.
- Deployed the updated shared streaming function to Firebase production:
  - `functions:sideEffectGuidanceTraceStreamHttp`
  - project: `traillight-4750b`
- Deferred patient Hosting deploy on purpose so the patient-side trace can be reviewed before public rollout.
- Completed a patient web smoke check at the build/output level after the function deploy:
  - confirmed patient web export still succeeds
  - confirmed the exported bundle contains the patient trace UI strings:
    - `Live reasoning trace`
    - `Detailed reasoning trace`
    - `Save status pending`
  - confirmed the exported bundle calls the shared streaming endpoint:
    - `sideEffectGuidanceTraceStreamHttp`
- Browser-driven local smoke interaction was not completed inside Codex because the local page-opening step hit the current app execution limit; bundle-level verification was used as the safe fallback in this session.
- Fixed a patient-side trace auth alignment bug in `GeminiChatbot.js`:
  - patient streaming requests now prefer `auth.currentUser.uid` over only trusting the `PatientHome` prop value
  - this reduces false `permission-denied` failures where the patient trace request UID and the live Firebase auth UID could diverge
- Re-ran patient web export after the auth UID alignment patch and confirmed the bundle still builds successfully.
- Hardened the backend patient trace auth path in `functions/guidanceRuntime.js`:
  - patient trace requests no longer fail immediately when the client-supplied `patientUid` differs from the authenticated token uid
  - the backend now treats the authenticated Firebase uid as canonical for patient trace persistence and patient-scoped trace reads
- Re-deployed `functions:sideEffectGuidanceTraceStreamHttp` after the patient auth hardening patch so the remote streaming path now uses the canonical authenticated patient uid.
- Further relaxed patient trace auth fallback handling in `functions/guidanceRuntime.js`:
  - patient trace now falls back to a token-derived patient profile if the Firestore profile is missing or temporarily unreadable
  - patient path no longer hard-fails only because the stored `role` field is inconsistent with the authenticated patient session
- Added WhatsApp-style message timestamps to the patient `GeminiChatbot.js` message bubbles using the same time-formatting rule as the CRC Side Effect Guidance panel.
- Re-ran:
  - `node --check functions/guidanceRuntime.js`
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
  - `npm --prefix MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2 run export:web`
- Re-deployed `functions:sideEffectGuidanceTraceStreamHttp` again after the patient auth fallback hardening so the latest remote patient streaming path includes the relaxed profile handling.
- Improved CRC-side trace UX in `src/components/GeminiChatbot.jsx`:
  - persisted CRC guidance messages now pre-hydrate the just-streamed trace events into the local trace detail cache
  - this avoids the immediate post-answer state where the saved trace showed `Saved` but still rendered `Trace details are loading or were not available`
- Rebuilt the CRC web app after the trace cache hydration patch:
  - `npm run build:crc`
  - build passed successfully

### Dropout Backend
- Standardized local runtime around Python 3.12.
- Added self-check/startup guidance for the dropout backend.
- Preserved separate repository/runtime ownership for the model service.

### Shareable Teammate Testing Deployment
- Converted Firebase Hosting planning from a single site to a two-link model:
  - CRC website on `triallight`
  - patient web on `triallight-patient`
- Added deploy-oriented build scripts for CRC web and patient web static export.
- Prepared the patient app for static web export as a shareable browser link.
- Hardened ePRO and dropout services for public deployment:
  - env-driven `PORT`
  - deploy-friendly host binding
  - origin allowlist based CORS
- Added deployment assets and docs for Firebase multi-site hosting and Render-based backend publishing.

### No-Render Final Architecture Preparation
- Added a no-Render preparation guide centered on Firebase + Supabase.
- Added a Supabase migration baseline for:
  - `epro_subject_state`
  - `dropout_predictions`
- Added a GitHub Actions template for future daily dropout precompute publishing.
- Marked the Render deployment guide as a legacy transition reference rather than the preferred final path.

## Current Blockers
- Firebase cloud functions are not fully deployable to production on the current project plan because the Firebase project still needs Blaze features for function deployment.
- As a result:
  - hosted CRC `Side Effect Guidance` is not yet fully live through production functions
  - production browser push automation is not yet fully live
- Local development remains the source of truth for full Gemini guidance testing.

## Repository Snapshot
### Root Repository
- Remote: `origin -> https://github.com/yisheng10/IDP-For-Integration.git`
- Status: not clean yet
- Reason:
  - CRC website layout and Gemini integration changes are still uncommitted
  - new service adapter file is still untracked
  - nested app/model folders are tracked as gitlink entries from the root repository

### Patient App Repository
- Status: clean at the moment
- Note:
  - tracked in the root repository as a gitlink entry
  - no remote is currently configured inside the nested repository

### Dropout Backend Repository
- Status: not clean yet
- Reason:
  - repository is ahead by one local commit
  - `LOG.md` is currently deleted in that repository working tree
- Note:
  - tracked in the root repository as a gitlink entry
  - has its own remote: `https://github.com/yisheng10/Patient-Dropout-Prediction.git`

## Repository Structure Risk
- The root repository currently contains gitlink entries for the patient app and dropout backend, but the root workspace does not have a `.gitmodules` file.
- This means the root repository is not yet a clean, standard submodule setup.
- Pushing only the root repository may not be enough for another machine or teammate to reproduce the full workspace correctly.

## What Still Needs Validation
- Full teammate UAT on the CRC website
- Full teammate UAT on the patient app
- Production-side Gemini guidance after cloud function deployment is unblocked
- Production browser push after function deployment is unblocked

## Recommended Next Steps
1. Clean the remaining git state in the root repository and dropout backend repository.
2. Decide whether the deleted dropout `LOG.md` should be restored or intentionally removed in a new commit.
3. Run one final pass of local end-to-end testing across:
   - CRC login and workspace navigation
   - patient signup/login
   - ePRO submission
   - vital logging
   - side effect escalation
   - CRC `Side Effect Guidance`
   - dropout panel rendering
4. Commit and push only after both the root repository and dropout backend repository are clean and intentional.

## Notes
- Do not commit real secrets such as `functions/.env`.
- The current hosted web UI may be newer than the currently deployed production functions.
- Local `localhost` testing is still the most complete environment for v1 verification.

### Dropout Training Observability
- Added terminal-friendly progress output to the dropout hybrid generator:
  - real trial metadata load start
  - planned trial/patient counts
  - periodic per-trial progress checkpoints
  - CSV write start
  - sanity report write start
  - final dataset summary
- Added terminal-friendly progress output to dropout training:
  - dataset load and split summary
  - cache load/build summary
  - train/test window counts
  - per-epoch loss and validation metrics
  - best-checkpoint announcements
  - logistic baseline progress
  - feature ablation progress
  - checkpoint / artifacts / summary output paths
- Verified the updated `data_generator.py` and `train.py` with `py_compile`.

### Dropout Local Debug Run
- Because the original `.venv312` Python launcher was broken, installed dropout training dependencies into a local project folder:
  - `Patient-Dropout-Prediction/.py314_packages`
- Confirmed that full-trial generator execution on all `30090` merged trials is too large for practical local iteration:
  - reached roughly `7750` trials in 30 minutes before timeout
- Generated a bounded debug dataset instead:
  - source: real `merged_allphases_X/Y`
  - `max_trials = 1000`
  - output: `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000.csv`
  - rows: `938268`
  - patients: `26063`
  - trials: `1000`
  - positive rows: `39599`
- Ran single-model local training on the debug dataset with a pragmatic CPU-friendly setup:
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
- Best transformer result from the debug run:
  - `p_at_r80 = 0.3155`
  - `pr_auc = 0.4873`
  - `alert_frac_at_r80 = 0.1423`
  - `roc_auc = 0.9393`
- Logistic baseline on the same split:
  - `p_at_r80 = 0.3137`
  - `pr_auc = 0.4857`
  - `alert_frac_at_r80 = 0.1427`
- Feature ablation baseline findings on the same debug dataset:
  - removing `vitals` hurt the most
  - removing `epro` caused a moderate drop
  - removing `pain_anxiety` caused a small but real drop
  - removing `side_effects` caused only a very small drop in the current setup
- Current interpretation:
  - the model is learning mostly from adherence / activity signals
  - vitals are currently the strongest family
  - ePRO contributes useful signal
  - pain/anxiety are helping, but not yet strongly enough
  - side-effect burden is probably underpowered relative to the current label definition

### Dropout CUDA Enablement
- Added a separate CUDA-specific local dependency layer without overwriting the CPU package folder:
  - `Patient-Dropout-Prediction/.py314_packages_cuda`
- Installed `torch 2.11.0+cu128` into the CUDA package layer.
- Verified local GPU runtime:
  - `torch.cuda.is_available() = True`
  - device = `NVIDIA GeForce RTX 4060 Laptop GPU`
- Confirmed that the repeated log lines observed during local runs were terminal-render duplication caused by resizing the terminal window, not repeated model execution.
- Ran the same debug training configuration on CUDA:
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- CUDA debug run result:
  - `p_at_r80 = 0.3174`
  - `pr_auc = 0.4913`
  - `alert_frac_at_r80 = 0.1413`
  - `roc_auc = 0.9397`
- Local CUDA artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v2__SSpatient__FGfull__2026-03-29T05-12-47+00-00/`

### Dropout Symptom-Focused Rebuild (v3)
- Implemented the symptom-focused improvement pass in the active dropout backend:
  - `Patient-Dropout-Prediction/src/data_generator.py`
  - `Patient-Dropout-Prediction/src/feature_pipeline.py`
  - `Patient-Dropout-Prediction/src/train.py`
  - `Patient-Dropout-Prediction/src/predict.py`
- Upgraded the feature contract from `triallight_hybrid_v2` to:
  - `feature_version = triallight_hybrid_v3_symptom_focus`
- Upgraded the label contract from hard disengagement only to:
  - `label_version = disengagement_7d_v2_symptom_assisted`
- Kept the single-model setup unchanged:
  - `stage_3_29_single`
  - `history_window_days = 7`
  - `prediction_horizon_days = 7`
  - `min_scoring_day = 3`
- Reworked the hybrid generator to strengthen symptom dynamics without reverting to a pure synthetic trial setup:
  - added explicit symptom flare / aftershock states
  - made high `pain_score` and high `ctcae_grade` degrade later activity, vitals completion, ePRO completion, and CRC responsiveness
  - preserved anxiety as an optional missing-aware branch
  - kept real-trial grounding from `merged_allphases_X_dedup.csv` and `merged_allphases_Y_dedup.csv`
- Added new symptom-focused derived features:
  - `high_pain_burden_7d`
  - `high_anxiety_burden_7d`
  - `high_ctcae_burden_14d`
  - `symptom_persistence_7d`
  - `symptom_engagement_collision_7d`
- Reweighted `symptom_burden_composite_14d` to emphasize symptom burden directly:
  - CTCAE weight `0.40`
  - pain weight `0.35`
  - anxiety weight `0.25`
  - anxiety missingness now renormalizes available weights instead of forcing anxiety to zero
- Changed the positive-label mechanism:
  - kept the previous hard disengagement rule
  - added a symptom-assisted trigger for high symptom burden plus moderate participation decline
  - severe symptoms alone still do not force a positive label
- Verified the updated dropout source files with `py_compile`.

### Dropout Symptom-Focused Debug Dataset
- Generated a new bounded debug dataset without overwriting the earlier `debug1000` outputs:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v3symptom.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v3symptom__sanity.json`
- Dataset characteristics:
  - rows: `938268`
  - patients: `26063`
  - trials: `1000`
  - positive rows: `123015`
- Compared with the previous `debug1000` dataset, the symptom-assisted label greatly increased positive coverage.

### Dropout Symptom-Focused CUDA Run
- Ran the v3 symptom-focused dataset on the same lightweight CUDA loop for apples-to-apples comparison:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v3symptom.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- Best transformer result:
  - `p_at_r80 = 0.6390`
  - `pr_auc = 0.7583`
  - `alert_frac_at_r80 = 0.6710`
  - `roc_auc = 0.7255`
- Logistic baseline on the same dataset:
  - `p_at_r80 = 0.6295`
  - `pr_auc = 0.7492`
  - `alert_frac_at_r80 = 0.6811`
  - `roc_auc = 0.7166`
- Local training artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T06-08-09+00-00/`

### Dropout Symptom-Focused Ablation Readout
- Ran the v3 feature-group ablation suite on the new symptom-focused dataset.
- Full v3 transformer reference point:
  - `p_at_r80 = 0.6390`
  - `pr_auc = 0.7583`
  - `alert_frac_at_r80 = 0.6710`
- Key ablation results:
  - without `side_effects`:
    - `p_at_r80 = 0.6125`
    - `pr_auc = 0.7397`
    - `alert_frac_at_r80 = 0.7013`
  - without `pain_anxiety`:
    - `p_at_r80 = 0.6268`
    - `pr_auc = 0.7473`
    - `alert_frac_at_r80 = 0.6870`
- Interpretation:
  - the symptom-focused rebuild succeeded in making symptom features matter materially
  - `side_effects` now provide a meaningful lift
  - `pain/anxiety` now provide a real lift instead of a negligible one
  - however, the symptom-assisted label is currently too permissive and drives an impractically high alert burden
- Next optimization direction:
  - keep the new symptom features
  - tighten the symptom-assisted trigger rather than adding even more symptom fields immediately

### Dropout Objective-Backsolve Tightening Pass
- Implemented the first objective-backsolve round without changing the transformer architecture:
  - kept `feature_version = triallight_hybrid_v3_symptom_focus`
  - upgraded the training label to `disengagement_7d_v3_tightened_symptom_assisted`
  - added internal diagnostics:
    - `trigger_primary_rule`
    - `trigger_symptom_assisted_rule`
    - `symptom_assisted_slip_score`
    - `strong_engagement_shield`
- Tightened the symptom-assisted label logic:
  - `primary_rule` unchanged
  - `symptom_assisted_rule` now requires stronger slip structure
  - strong engagement now explicitly blocks symptom-assisted positives
- Added a symptom-heavy-but-engaged generator path:
  - caregiver / resilient patients can stay engaged during flare episodes
  - flare penalties were softened
  - flare / aftershock duration was reduced
- Extended training-time diagnostics:
  - row-level label mix
  - event-level primary vs symptom-assisted trigger share
  - train/test window positive rate

### Dropout Tightening Pass V1
- Generated a first tightened debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight.csv`
- First tightened generator/training result:
  - dataset row positives still too high for the desired operating regime
  - event trigger mix remained too dominated by `symptom_assisted_rule`
  - CUDA result:
    - `p_at_r80 = 0.5090`
    - `pr_auc = 0.6210`
    - `alert_frac_at_r80 = 0.6097`
- Interpretation:
  - the model kept useful symptom lift
  - but the label was still too permissive
  - another tightening pass was needed before moving to threshold/loss work

### Dropout Tightening Pass V2
- Applied a second tightening pass focused on:
  - requiring persistent symptom burden for symptom-assisted positives
  - broadening the strong-engagement shield
  - reducing symptom-assisted activation from activity-only slip patterns
- Generated the second tightened debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight2.csv`
  - sanity report:
    - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight2__sanity.json`
- Generator-side label diagnostics improved materially:
  - `row_positive_rate = 0.126569`
  - `row_symptom_trigger_rate = 0.060526`
  - `row_shield_rate = 0.177732`
  - `event_rows_from_primary_share = 0.295821`
  - `event_rows_from_symptom_assisted_share = 0.705576`
- This was a meaningful improvement over the earlier tightened pass, where symptom-assisted events still dominated much more heavily.

### Dropout Tightening Pass V2 CUDA Result
- Ran CUDA training on the second tightened dataset:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v31tight2.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- Final tightened V2 transformer result:
  - `p_at_r80 = 0.3875`
  - `pr_auc = 0.5587`
  - `alert_frac_at_r80 = 0.4926`
  - `roc_auc = 0.7800`
- Window label mix after the second tightening pass:
  - `train_positive_rate = 0.2433`
  - `test_positive_rate = 0.2385`
- Tightened V2 artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T07-50-25+00-00/`

### Dropout Tightening Pass V2 Ablation Readout
- Tightened V2 ablation results on the same dataset showed:
  - removing `side_effects` dropped performance clearly:
    - `p_at_r80 = 0.3660`
    - `pr_auc = 0.5315`
  - removing `pain_anxiety` caused only a very small change:
    - `p_at_r80 = 0.3863`
    - `pr_auc = 0.5655`
- Interpretation:
  - `side_effects` are now a real contributor
  - `pain/anxiety` still are not yet carrying enough distinct predictive value
  - the second tightening pass successfully pulled the dataset much closer to an operational regime
  - but the model still misses the target operating objective:
    - `p_at_r80` is close to `0.40` but still below it
    - `pr_auc` is above the target floor
    - `alert_frac_at_r80` is still far above the desired `<= 0.25`
- Next recommended step:
  - keep the tightened label
  - move to the next phase:
    - harder symptom-heavy negative construction
    - hard-negative oversampling
    - then only if needed, loss reweighting / calibration

### Dropout Hard-Negative Phase
- Added a non-public hard-negative training path to `Patient-Dropout-Prediction/src/train.py`:
  - window-level `hard_negative` flag generation
  - optional hard-negative weighted sampling
  - train/test hard-negative rate diagnostics
- Hard-negative windows are now defined from:
  - high symptom burden
  - negative label
  - active engagement indicators such as shielded participation or sustained completion despite symptoms
- This training path was implemented as an optional sampler only:
  - it does not change the public runtime contract
  - it does not change the transformer architecture

### Dropout Hard-Negative Experiment Result
- First oversampling attempt exposed that the initial hard-negative definition was too narrow:
  - hard-negative rate was only about `0.002`
  - effect on metrics was negligible
- Expanded the hard-negative definition to include stronger `engaged despite symptoms` windows.
- Rebuilt cache and reran training with:
  - `hard_negative_oversample = 4.0`
  - result:
    - `p_at_r80 = 0.3775`
    - `pr_auc = 0.5627`
    - `alert_frac_at_r80 = 0.5057`
- Reran with:
  - `hard_negative_oversample = 2.5`
  - result:
    - `p_at_r80 = 0.3857`
    - `pr_auc = 0.5558`
    - `alert_frac_at_r80 = 0.4952`
- Both oversampling runs underperformed the best non-oversampled tightened V2 run:
  - non-oversampled tightened V2 remained the best current operating point
  - therefore the default hard-negative oversampling setting was returned to disabled-by-default
    - `hard_negative_oversample = 1.0`

### Current Best Objective-Backsolve Status
- Best current tightened operating point remains the non-oversampled tightened V2 run:
  - `p_at_r80 = 0.3875`
  - `pr_auc = 0.5587`
  - `alert_frac_at_r80 = 0.4926`
  - `window positive_rate = 0.2385`
- Current interpretation:
  - `pr_auc` has crossed the target floor
  - `p_at_r80` is close to `0.40`
  - `alert_frac_at_r80` is still the main blocker
  - generator / label tightening helped much more than hard-negative sampling so far
- Next most defensible direction:
  - keep the current tightened label as baseline
  - improve the quality of symptom-heavy engaged negatives in the generator itself
  - only revisit sampling or loss reweighting after those negatives become more informative

### Dropout Generator-Led Engaged-Negative Strengthening
- Implemented a new generator-only strengthening pass focused on explicit `symptom-heavy but still engaged` negatives:
  - kept:
    - `feature_version = triallight_hybrid_v3_symptom_focus`
    - `label_version = disengagement_7d_v3_tightened_symptom_assisted`
    - transformer architecture unchanged
    - `hard_negative_oversample = 1.0`
  - updated:
    - `Patient-Dropout-Prediction/src/data_generator.py`
    - `Patient-Dropout-Prediction/src/quality_utils.py`
- Added protected flare tracks inside the generator:
  - `shielded_pain_flare`
  - `shielded_anxiety_flare`
- Protected flares now raise symptom signals while preserving stronger engagement floors for:
  - activity
  - vitals completion
  - ePRO completion
  - CRC follow-up responsiveness
- Added internal-only diagnostics:
  - `shielded_flare_active`
  - `shielded_pain_flare_active`
  - `shielded_anxiety_flare_active`
  - `high_symptom_and_engaged`
  - `high_pain_and_engaged`
  - `high_anxiety_and_engaged`
- Generated a new non-overwriting debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v32engagedneg.csv`
  - sanity report:
    - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v32engagedneg__sanity.json`

### Dropout V32 Generator Diagnostics
- Compared with tightened V2:
  - `event_rows_from_symptom_assisted_share` improved:
    - from `0.705576`
    - to `0.686429`
  - `event_rows_from_primary_share` improved:
    - from `0.295821`
    - to `0.314787`
  - `row_positive_rate` stayed almost flat:
    - from `0.126569`
    - to `0.127674`
- New engaged-negative diagnostics:
  - `shielded_flare_row_count = 9474`
  - `shielded_pain_flare_row_count = 8638`
  - `shielded_anxiety_flare_row_count = 836`
  - `high_symptom_and_engaged_row_rate = 0.058409`
  - `high_pain_and_engaged_row_rate = 0.018055`
  - `high_anxiety_and_engaged_row_rate = 0.000760`
- Interpretation:
  - the generator now creates materially more protected symptom-heavy participation patterns
  - symptom-assisted triggering remains dominant, but slightly less so than in tightened V2
  - row-level positive rate did not materially drift upward

### Dropout V32 CUDA Training Result
- Ran the same evaluation setup:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v32engagedneg.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
  - `run_ablations = true`
- Main run artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
- Final transformer result:
  - `p_at_r80 = 0.4031`
  - `pr_auc = 0.5769`
  - `alert_frac_at_r80 = 0.4938`
  - `roc_auc = 0.7877`
- Logistic baseline:
  - `p_at_r80 = 0.4020`
  - `pr_auc = 0.5659`
  - `alert_frac_at_r80 = 0.4946`
- Window label mix:
  - `train_positive_rate = 0.2507`
  - `test_positive_rate = 0.2485`
  - `train_hard_negative_rate = 0.0656`
  - `test_hard_negative_rate = 0.0611`

### Dropout V32 Ablation Readout
- `side_effects` ablation:
  - `p_at_r80 = 0.3780`
  - `pr_auc = 0.5356`
  - `alert_frac_at_r80 = 0.5262`
- `pain_anxiety` ablation:
  - `p_at_r80 = 0.4043`
  - `pr_auc = 0.5620`
  - `alert_frac_at_r80 = 0.4921`
- Interpretation:
  - `side_effects` continue to provide strong independent value
  - `pain/anxiety` now show meaningful `PR-AUC` contribution, even though `p_at_r80` lift is still weak

### Dropout V32 Outcome Assessment
- This pass passed 2 of the 3 intended operational gates:
  - `p_at_r80 >= 0.38` -> passed
  - `pr_auc >= 0.56` -> passed
  - `alert_frac_at_r80 <= 0.40` -> failed
- Relative to the previous best tightened V2 baseline:
  - `p_at_r80` improved:
    - from `0.3875`
    - to `0.4031`
  - `pr_auc` improved:
    - from `0.5587`
    - to `0.5769`
  - `alert_frac_at_r80` was effectively unchanged:
    - from `0.4926`
    - to `0.4938`
- Current conclusion:
  - generator-led engaged-negative strengthening improved ranking quality
  - but it did not materially reduce alert burden
  - the next most defensible step is no longer more generator broadening alone
  - the next step should move to threshold / loss tuning while keeping this V32 generator as the stronger baseline

### Dropout Loss-Tuning And Reweighting Pass
- Updated `Patient-Dropout-Prediction/src/train.py` to support explicit loss experimentation without changing the model architecture:
  - added `--loss_type` with:
    - `bce`
    - `focal`
  - added:
    - `--focal_gamma`
    - `--positive_class_weight_scale`
  - loss configuration is now recorded into:
    - training summaries
    - stage artifacts
    - experiment ledger rows
- Important clarification captured in this pass:
  - offline `p_at_r80` / `alert_frac_at_r80` are already computed by selecting the threshold required to reach `recall = 0.80`
  - therefore plain runtime threshold tuning does not directly improve these benchmark metrics
  - the only defensible lever in this pass was loss / ranking behavior

### Dropout V32 Loss Experiment Results
- Baseline for comparison remained the main V32 BCE run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
  - metrics:
    - `p_at_r80 = 0.4031`
    - `pr_auc = 0.5769`
    - `alert_frac_at_r80 = 0.4938`
- Focal loss experiment:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T17-53-39+00-00/`
  - config:
    - `loss_type = focal`
    - `focal_gamma = 2.0`
    - `positive_class_weight_scale = 1.0`
  - result:
    - `p_at_r80 = 0.3995`
    - `pr_auc = 0.5778`
    - `alert_frac_at_r80 = 0.4977`
- BCE with reduced positive class weight:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T18-14-52+00-00/`
  - config:
    - `loss_type = bce`
    - `positive_class_weight_scale = 0.70`
  - result:
    - `p_at_r80 = 0.4024`
    - `pr_auc = 0.5789`
    - `alert_frac_at_r80 = 0.4943`
- BCE with light hard-negative oversampling on V32:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T18-36-20+00-00/`
  - config:
    - `loss_type = bce`
    - `positive_class_weight_scale = 1.0`
    - `hard_negative_oversample = 2.0`
  - result:
    - `p_at_r80 = 0.4004`
    - `pr_auc = 0.5764`
    - `alert_frac_at_r80 = 0.4970`

### Dropout Loss-Tuning Conclusion
- None of the simple loss / reweighting variants materially improved alert burden relative to the current V32 BCE baseline.
- Best current operating point still remains:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
  - `p_at_r80 = 0.4031`
  - `pr_auc = 0.5769`
  - `alert_frac_at_r80 = 0.4938`
- Interpretation:
  - ranking quality has already improved enough to cross the `p_at_r80 >= 0.40` and `pr_auc >= 0.55` lines
  - the remaining blocker is not simple loss choice
  - the remaining blocker is likely the dataset/window positive regime itself, plus the need for a more explicit false-positive-sensitive objective if we want to reduce alert burden further
- Recommended next step after this pass:
  - do not keep iterating small loss variants blindly
  - move to a more explicit constrained training objective or window-label policy revision that targets lower alert burden directly

### Dropout Prevalence-Correction And Strict GPU Observability Pass
- Updated `Patient-Dropout-Prediction/src/data_generator.py` to introduce a `candidate -> confirmed` disengagement confirmation policy without changing the existing `primary_rule` / `symptom_assisted_rule` definitions:
  - `primary_rule` now requires `2` consecutive days before confirming `disengagement_day`
  - `symptom_assisted_rule` now requires at least `3` hits within a rolling `4`-day window before confirming
  - mixed confirmation is allowed when a current `primary_rule` hit follows a previous-day symptom-assisted candidate
  - strong engagement resets candidate state instead of letting a single transient hit permanently confirm disengagement
- Added generator-side candidate diagnostics to the generated rows:
  - `candidate_primary_active`
  - `candidate_symptom_active`
- Expanded `Patient-Dropout-Prediction/src/quality_utils.py` sanity reporting with patient-level prevalence diagnostics:
  - `patient_event_rate`
  - `patient_positive_label_rate`
  - `candidate_primary_rate`
  - `candidate_symptom_rate`
  - `confirmed_disengagement_patient_count`
- Hardened `Patient-Dropout-Prediction/src/train.py` GPU behavior and observability:
  - `--device` now defaults to `cuda`
  - `--device cuda` now fails fast if CUDA is unavailable instead of silently falling back to CPU
  - added `--batch_log_interval`
  - training startup now logs:
    - torch version
    - CUDA build
    - CUDA availability
    - selected device
    - GPU name
  - transformer training now logs per-batch CUDA memory snapshots:
    - allocated MB
    - reserved MB
    - peak allocated MB
  - training logs now explicitly separate:
    - `CPU phase: dataset loading / cache building`
    - `GPU phase: transformer training`
    - `CPU phase: logistic baseline`

### Dropout V33 Manual Prevalence-Fix Dataset
- Manual generator rerun produced:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__manual_v33prevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__manual_v33prevalencefix__sanity.json`
- V33 sanity result:
  - `patient_event_rate = 0.649618`
  - `patient_positive_label_rate = 0.649618`
  - `row_positive_rate = 0.121908`
  - `event_rows_from_primary_share = 0.313094`
  - `event_rows_from_symptom_assisted_share = 0.695115`
  - `high_symptom_and_engaged_row_rate = 0.064792`
- Interpretation:
  - prevalence correction improved the regime, but did not yet hit the planned generator gates
  - relative to the earlier V32 regime, row/window prevalence moved down, but patient-level event prevalence remains too high

### Dropout V33 Manual CUDA Train Result
- Manual training run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T03-26-33+00-00/`
- Final transformer metrics:
  - `p_at_r80 = 0.4135`
  - `pr_auc = 0.6380`
  - `alert_frac_at_r80 = 0.3956`
  - `roc_auc = 0.8374`
  - `threshold_at_r80 = 0.388025`
- Window prevalence:
  - `train_positive_rate = 0.2043`
  - `test_positive_rate = 0.2043`
- Logistic baseline:
  - `p_at_r80 = 0.4109`
  - `pr_auc = 0.6356`
  - `alert_frac_at_r80 = 0.3979`
- GPU observability confirmation from terminal logs:
  - selected device was `cuda`
  - GPU name was `NVIDIA GeForce RTX 4060 Laptop GPU`
  - batch logs showed non-zero CUDA memory usage with peak allocation around `80.6 MB`
- Interpretation:
  - this pass materially improved ranking and alert burden versus the earlier manual baseline:
    - `p_at_r80`: `0.4014 -> 0.4135`
    - `pr_auc`: `0.5858 -> 0.6380`
    - `alert_frac_at_r80`: `0.4951 -> 0.3956`
    - `test_positive_rate`: `0.2483 -> 0.2043`
  - the training-side gates mostly improved enough to become useful:
    - `p_at_r80 >= 0.38`: passed
    - `pr_auc >= 0.56`: passed
    - `alert_frac_at_r80 <= 0.40`: passed
    - `test_positive_rate <= 0.15`: still not met
  - the remaining blocker is now mostly prevalence/window regime, not CUDA execution or basic model ranking quality

### Dropout V34 Stronger Prevalence-Tightening Pass
- Tightened the prevalence correction logic again in `Patient-Dropout-Prediction/src/data_generator.py` without changing feature schema or transformer architecture:
  - increased `primary_rule` confirmation from `2` consecutive days to `3` consecutive days
  - increased symptom-assisted confirmation from `3 hits in 4 days` to `4 hits in 5 days`
  - increased `hard_reset_candidate_state` coverage so moderate-but-stable re-engagement clears candidate state earlier
- Generated:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34prevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34prevalencefix__sanity.json`
- V34 sanity result:
  - `patient_event_rate = 0.5332`
  - `row_positive_rate = 0.1022`
  - `event_rows_from_primary_share = 0.3442`
  - `event_rows_from_symptom_assisted_share = 0.6487`
- V34 CUDA run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T04-44-51+00-00/`
  - `p_at_r80 = 0.3813`
  - `pr_auc = 0.6003`
  - `alert_frac_at_r80 = 0.3185`
  - `test_positive_rate = 0.1518`
- Interpretation:
  - V34 moved much closer to the target regime and passed `3/4` training gates comfortably
  - the only remaining miss was `test_positive_rate`, and it was off by only `0.0018`

### Dropout V34b Final Prevalence-Tightening Adjustment
- Added one last minimal tightening in `Patient-Dropout-Prediction/src/data_generator.py`:
  - symptom-assisted confirmation now requires the current day to still satisfy `symptom_assisted_rule`
  - mixed confirmation now requires the current day to satisfy both `primary_rule` and `symptom_assisted_rule`
  - re-engagement reset thresholds were relaxed slightly further to clear stale candidates sooner
- Generated:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34bprevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34bprevalencefix__sanity.json`
- V34b sanity result:
  - `patient_event_rate = 0.5279`
  - `row_positive_rate = 0.1012`
  - `event_rows_from_primary_share = 0.3525`
  - `event_rows_from_symptom_assisted_share = 0.6641`
- V34b CUDA run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T05-17-06+00-00/`
  - `p_at_r80 = 0.3812`
  - `pr_auc = 0.6011`
  - `alert_frac_at_r80 = 0.3082`
  - `test_positive_rate = 0.1467`
  - `roc_auc = 0.8693`
- Final interpretation for this pass:
  - training-side target gates are now all satisfied on the debug1000 patient-split CUDA run:
    - `test_positive_rate <= 0.15`: passed
    - `p_at_r80 >= 0.38`: passed
    - `pr_auc >= 0.56`: passed
    - `alert_frac_at_r80 <= 0.40`: passed
  - generator-side prevalence is still a little above the stricter planning targets:
    - `patient_event_rate` remains above `0.50`
    - `row_positive_rate` remains above `0.09`
  - however, the operationally important window-level regime is now inside target while preserving good ranking quality and confirmed CUDA execution

### Dropout V34b Trial-Split Generalization Check
- Ran a held-out trial split on the same frozen V34b dataset:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SStrial__FGfull__2026-03-30T06-30-28+00-00/`
- Trial-split result:
  - `p_at_r80 = 0.3824`
  - `pr_auc = 0.5987`
  - `alert_frac_at_r80 = 0.3055`
  - `test_positive_rate = 0.1459`
- Interpretation:
  - the trial-held-out result stayed very close to the patient-held-out result
  - there was no obvious generalization collapse
  - relative to the patient split:
    - `p_at_r80` was effectively preserved
    - `alert_frac_at_r80` was also preserved
  - this is strong evidence that the current model is not merely memorizing patient-level artifacts within the sampled trials

### Dropout V34b Final Ablation Evidence
- Ran the final ablation suite on the V34b patient-split run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T06-58-49+00-00/feature_ablation_results.json`
- Important implementation note:
  - the ablation suite currently uses the repo's fast ablation path
  - these ablations were evaluated with the logistic-regression comparator path rather than full transformer retraining for every feature removal
  - this makes them appropriate as fast evidence of signal utility, but they should be described honestly in any final report
- Full V34b patient-split transformer reference:
  - `p_at_r80 = 0.3812`
  - `pr_auc = 0.6011`
  - `alert_frac_at_r80 = 0.3082`
- Fast ablation results:
  - without `epro`:
    - `p_at_r80 = 0.3722`
    - `pr_auc = 0.5760`
    - `alert_frac_at_r80 = 0.3154`
  - without `appointment`:
    - `p_at_r80 = 0.3727`
    - `pr_auc = 0.5594`
    - `alert_frac_at_r80 = 0.3149`
  - without `chat`:
    - `p_at_r80 = 0.3725`
    - `pr_auc = 0.5769`
    - `alert_frac_at_r80 = 0.3153`
  - without `side_effects`:
    - `p_at_r80 = 0.3172`
    - `pr_auc = 0.4836`
    - `alert_frac_at_r80 = 0.3701`
  - without `pain_anxiety`:
    - `p_at_r80 = 0.3690`
    - `pr_auc = 0.5735`
    - `alert_frac_at_r80 = 0.3184`
- Interpretation:
  - `side_effects` now show the strongest and clearly non-trivial contribution
  - `pain_anxiety` now show a smaller but still real contribution
  - `appointment` and `epro` also contribute
  - the current evidence supports the statement that the model is not being driven by vitals alone

### Dropout Model Global Readiness As Of 2026-03-30
- Current status:
  - offline model R&D is in a defensible state
  - patient-split and trial-split results are both inside the current operational target band for the debug1000 regime
  - GPU training and detailed observability are now stable
- Remaining gaps before full integration deployment:
  - reconnect the final frozen model to inference/publishing/runtime paths
  - do end-to-end CRC-side integration validation
  - prepare final scenario-based testing and scoring evidence for professor review

### Dropout Frozen Runtime Wiring (V34b)
- Confirmed a real runtime issue before this pass:
  - offline training had produced a valid frozen `v34b` run
  - but the runtime defaults still pointed to stale `deploy_assets` / legacy assets
  - `deploy_assets/checkpoints` had only old staged files and no `stage_3_29_single` checkpoint
- Updated `Patient-Dropout-Prediction/src/module_service.py` so runtime defaults now prefer a frozen manifest when present:
  - env vars still override everything
  - otherwise:
    - `deploy_assets/checkpoints/frozen_model_manifest.json` can define default `data_path`
    - `deploy_assets/checkpoints/frozen_model_manifest.json` can define default `checkpoints_dir`
  - old `deploy_assets/data/triallight_dropout_testing.csv` remains only as a fallback
- Added frozen manifest:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest.json`
- Copied the frozen V34b model assets into runtime-visible locations without overwriting old staged files:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/model_stage_3_29_single.pth`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/artifacts_stage_3_29_single.pkl`
  - `Patient-Dropout-Prediction/deploy_assets/data/triallight_dropout_testing_v34b.csv`
  - mirrored local convenience copies:
    - `Patient-Dropout-Prediction/checkpoints/model_stage_3_29_single.pth`
    - `Patient-Dropout-Prediction/checkpoints/artifacts_stage_3_29_single.pkl`
- Runtime smoke test passed using default paths resolved from the frozen manifest:
  - `DEFAULT_DATA_PATH` resolved to:
    - `deploy_assets/data/triallight_dropout_testing_v34b.csv`
  - `DEFAULT_CHECKPOINTS_DIR` resolved to:
    - `deploy_assets/checkpoints`
  - `score_subject_for_crc(...)` returned a valid CRC payload using the frozen defaults

### Dropout Demo Scenario Selector
- Added:
  - `Patient-Dropout-Prediction/src/select_demo_subjects.py`
  - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`
- Generated:
  - `Patient-Dropout-Prediction/deploy_assets/demo_scenarios_v34b.json`
- This demo scenario file now provides a ready-made set of representative subjects for:
  - `high_symptom_but_engaged`
  - `high_symptom_plus_engagement_slip`
  - `low_symptom_strong_adherence`
  - `missed_followup_with_symptom`
- Each scenario includes:
  - subject ID
  - trial ID
  - day index
  - supporting feature snapshot
  - frozen model score summary

### Dropout Readiness After Runtime Freeze
- The dropout model is now frozen to a concrete offline-validated artifact and wired into the default runtime path.
- Current remaining work is no longer about core model R&D:
  - validate the live CRC/publisher integration path end-to-end
  - confirm the Firestore mirror payload is correct for the frozen runtime
  - run professor/demo scenario walkthroughs using the generated scenario JSON

### Dropout Publisher Dry-Run And CRC Contract Surface Update
- Updated `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` to support safer validation before any real Firestore/Supabase write:
  - added `--dry-run`
  - added `--limit-patients`
  - added `--firebase-uids`
  - added `--output-preview-path`
  - added `--skip-testing-subject-sync`
  - added `--demo-scenarios-path`
- Publisher mirror payload was expanded to preserve more of the CRC contract in Firestore:
  - `contract_version`
  - `routed_stage`
  - `fallback_used`
  - `is_actionable`
  - `pred_horizon_days`
  - `history_window_days`
  - `model_type`
  - `missing_inputs_summary`
  - `explanation_signals`
- Added a safe no-remote validation path:
  - `publish_dropout_snapshots.py --dry-run --demo-scenarios-path ...`
  - this builds the same Firestore-style payloads from frozen demo scenarios without touching Firestore or Supabase
- Generated dry-run payload preview:
  - `Patient-Dropout-Prediction/deploy_assets/demo_publish_preview_v34b.json`
- Dry-run preview confirmed:
  - frozen checkpoint and dataset resolve correctly
  - CRC payload structure is complete
  - all four professor/demo scenarios produce valid Firestore-style snapshot payloads

### CRC Dropout Panel Contract Readiness
- Updated `src/components/DropoutRiskPanel.jsx` so the CRC panel can now display more frozen-runtime contract details when a live snapshot is present:
  - routed stage
  - prediction horizon
  - history window
  - model version
  - missing input summary
- This keeps the panel CRC-only while making runtime validation easier during final testing.

### Current Remaining Gap Before Real Publish
- The only material thing not executed in this pass is the real remote publish itself:
  - no Firestore write was performed in this pass
  - no Supabase write was performed in this pass
- That decision was intentional:
  - the safer path was to complete offline validation, runtime freeze, mirror-payload previewing, and professor scenario preparation first
  - the actual remote publish should be done only when the correct Firebase and Supabase credentials are available and the target environment is confirmed

### Publisher Preflight Validation
- Updated `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` with a new safe config-check mode:
  - `--preflight-only`
- The publisher now prints a clearer start banner and a preflight summary before any real work:
  - mode
  - whether Firestore is required
  - whether Supabase is required
  - whether frozen dataset/checkpoint/artifact paths exist
  - whether Firebase and Supabase credentials are configured
- If `--preflight-only` is used:
  - exit code `0` means local assets and required credentials are ready for the selected mode
  - exit code `1` means something required is still missing
- Verified locally:
  - frozen data path exists
  - frozen checkpoint directory exists
  - frozen model/artifacts exist
  - `FIREBASE_SERVICE_ACCOUNT_JSON` was missing
  - `SUPABASE_URL` was missing
  - `SUPABASE_SERVICE_ROLE_KEY` was missing
- This means the technical blocker for the real remote publish is now explicitly surfaced by the tool itself, instead of only appearing as a later runtime failure.

### Publisher Preflight Ready-Flag Bugfix
- Fixed a logic bug in Patient-Dropout-Prediction/src/publish_dropout_snapshots.py where live publish preflight could still report 
eady=False even when Firebase, Supabase, and frozen assets were all configured correctly.
- Root cause: the 
eady expression handled the no-demo-scenarios case incorrectly.
- Fix: normalized demo-scenario path readiness into a dedicated demo_path_ready boolean and reused it consistently in the report and final 
eady calculation.
- Result: --preflight-only can now be trusted as the gate before real dry-run or live publish.

### Publisher Mapping Diagnostics
- Extended Patient-Dropout-Prediction/src/publish_dropout_snapshots.py with read-only mapping diagnostics for real-patient dry-runs and publish attempts.
- The publisher now reports:
  - how many patient docs were scanned
  - how many docs expose dropout_subject_id`r
  - how many docs expose dropoutSubjectId`r
  - how many docs expose only subject_id / subjectId`r
  - how many docs are skipped because mapping is missing
  - how many mapped subjects are not present in the frozen dataset
  - how many score attempts fail after a valid mapping
- The same diagnostics are now also written into the dry-run preview JSON under mapping_diagnostics.
- Verified that the enhanced diagnostics do not break the existing local demo preview path.

### Patient Dropout Prediction ID Refactor And Canonical Subject Finalization
- Completed the approved dropout-only ID refactor so the active TrialLight dropout flow now treats `subject_id` as the canonical patient identity.
- Updated CRC-facing dropout UI to stop using `Hospital ID` in the active dropout flow:
  - `src/components/PatientEditMenu.jsx`
  - `src/components/PatientList.jsx`
  - `src/pages/CRCHome.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/services/dropoutService.js`
- Active CRC/dropout behavior now follows this contract:
  - patient configuration writes `subject_id`
  - roster search/display uses `subject_id`
  - dropout panel asks for `subject_id`
  - legacy `dropout_subject_id` is only used as a temporary compatibility fallback while migration is incomplete
- Added deploy-time identity remap support without retraining the model:
  - new script: `Patient-Dropout-Prediction/src/remap_deploy_subject_ids.py`
  - new frozen deployment dataset: `Patient-Dropout-Prediction/deploy_assets/data/triallight_dropout_testing_v35subjectid.csv`
  - new subject map: `Patient-Dropout-Prediction/deploy_assets/data/triallight_subject_id_map_v35subjectid.csv`
  - new manifest: `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_v35subjectid.json`
- The new deployment bundle preserves model semantics while changing only identity expression:
  - canonical deployment IDs now look like `TL-S00001`
  - each row retains `legacy_subject_id` inside the deploy dataset for migration-time traceability
  - new manifest records the remap and still points to the same frozen `stage_3_29_single` checkpoint/artifacts
- Added runtime compatibility so legacy frozen subject IDs can still be resolved to the canonical deployment subject IDs:
  - `Patient-Dropout-Prediction/src/module_service.py`
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- Generated new canonical demo assets:
  - `Patient-Dropout-Prediction/deploy_assets/demo_scenarios_v35subjectid.json`
  - `Patient-Dropout-Prediction/deploy_assets/demo_publish_preview_v35subjectid_livecompat.json`
- Demo scenarios now expose canonical `subject_id` plus `legacy_subject_id` trace, for example:
  - canonical: `TL-S00024`
  - legacy: `NCT00005879_P0012`
- Important integration nuance discovered and handled:
  - the current Supabase `dropout_predictions` table still requires the legacy column name `dropout_subject_id`
  - to avoid breaking live publish, history rows now write:
    - `subject_id = canonical TrialLight subject_id`
    - `dropout_subject_id = same canonical subject_id`
  - richer migration-only trace fields remain in Firestore mirror payloads, not in the Supabase history insert payload
- Updated daily automation workflow to use the in-repo dropout backend instead of checking out a separate external repository:
  - `.github/workflows/dropout-precompute.yml`
  - removed the extra `DROPOUT_REPO_PAT` checkout path
  - switched workflow data path to `triallight_dropout_testing_v35subjectid.csv`
  - added a publisher preflight step before live publish
- Updated dropout deployment/docs to reflect the new canonical subject bundle:
  - `Patient-Dropout-Prediction/DEPLOYMENT.md`
  - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`
  - `Patient-Dropout-Prediction/INTERFACES.md`
- Validation completed for this refactor:
  - Python syntax check passed for:
    - `module_service.py`
    - `publish_dropout_snapshots.py`
    - `select_demo_subjects.py`
    - `remap_deploy_subject_ids.py`
  - canonical vs legacy alias scoring parity check passed:
    - `TL-S00024`
    - `NCT00005879_P0012`
    - returned identical `dropout_probability`
  - targeted ESLint passed cleanly for the modified CRC/dropout files after one small hook dependency cleanup in `src/pages/CRCHome.jsx`
- Current remaining work after this refactor is no longer about ID design:
  - manually assign canonical `subject_id` values to the real Firestore patient docs through CRC configuration
  - rerun real Firestore dry-run and confirm `predictions_ready > 0`
  - execute the first live publish
  - then enable or trust the GitHub Actions daily automation path

### Live Subject Mapping And First Real Publish Attempt
- Wrote canonical `subject_id` values into all 18 live Firestore patient docs under `users/{uid}.subject_id`.
- Assigned a small set of demo-aligned canonical IDs for stable professor/testing coverage, including:
  - `TL-S21261`
  - `TL-S01463`
  - `TL-S00024`
  - `TL-S11794`
- Verified live Firestore mapping state after the write:
  - `count = 18`
  - `with_subject_id = 18`
  - `missing = 0`
- Ran a real publisher dry-run against the canonical `v35subjectid` frozen runtime with live Firestore:
  - `scanned_patient_docs = 18`
  - `predictions_ready = 18`
  - `missing_subject_id = 0`
  - `mapped_not_in_dataset = 0`
  - `score_failures = 0`
- Confirmed the real dry-run preview was written to:
  - `Patient-Dropout-Prediction/deploy_assets/manual_live_dry_run_v35subjectid_after_mapping.json`
- The first live publish attempt then exposed a runtime bug in `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`:
  - `_init_firestore()` re-initialized the default Firebase Admin app during the same process
  - this caused the Firestore `current` mirror write stage to fail after Supabase history publication had already started
- Fixed the publisher bug by reusing `firebase_admin.get_app()` when the default app already exists instead of initializing twice.
- Next step after this fix:
  - rerun live publish
  - verify Firestore `users/{uid}/dropout_predictions/current`
  - verify Supabase `dropout_testing_subjects` and `dropout_predictions`

### Live Publish Success And Canonical Subject Option Filtering
- Reran the live dropout publisher after the Firebase initialization fix and completed the first successful real publish against:
  - live Firestore patient docs
  - live Firestore `dropout_predictions/current`
  - live Supabase `dropout_predictions`
- Successful live publish result:
  - `scanned_patient_docs = 18`
  - `predictions_ready = 18`
  - `missing_subject_id = 0`
  - `mapped_not_in_dataset = 0`
  - `score_failures = 0`
- Verified a real Firestore current snapshot for `zUduQBX4cyULYvxTjZ1wWAPQhLx2`:
  - `subject_id = TL-S01463`
  - `risk_bucket = high`
  - `dropout_probability = 0.979375`
  - `recommended_action = review_today_consider_outreach`
- Verified Supabase history rows now exist for the same patient with:
  - `subject_id = TL-S01463`
  - `dropout_subject_id = TL-S01463`
- Discovered that `dropout_testing_subjects` still contains legacy `NCT...` rows from earlier phases alongside the new canonical subject universe.
- To prevent the CRC config dropdown from surfacing legacy IDs, updated `src/services/dropoutService.js` so the subject selector now prefers and displays only canonical `TL-S00001`-style IDs whenever they are present.
- Result:
  - active runtime identity is canonical `subject_id`
  - live publish is now working
  - CRC dropdown no longer needs a destructive cleanup of old Supabase rows in order to show the correct subject universe

### CRC UI And Dropout Workspace Finalization
- Implemented the CRC/product surface changes for this round without changing the dropout model contract:
  - `src/pages/CRCHome.jsx`
  - `src/components/PatientEditMenu.jsx`
  - `src/components/ProtocolManager.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/services/dropoutService.js`
  - `src/services/trialTemplateService.js`
  - `src/utils/validation.js`
  - `src/index.css`
- Added loose international phone validation for active CRC patient configuration fields:
  - `Primary CRC phone`
  - `Study emergency phone`
  - allowed formatting now includes digits, spaces, hyphens, parentheses, and one leading `+`
  - invalid values now show inline errors and block save
- Kept web DOB handling on `input[type="date"]` and upgraded patient mobile DOB entry from free text to a calendar-based picker:
  - added `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/CalendarDateField.js`
  - wired it into:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/ProfileModal.js`
  - DOB still persists as `YYYY-MM-DD`
- Reworked Protocol Library into a single-open accordion flow:
  - only one protocol card expands at a time
  - if the selected patient already has an assigned protocol, that template opens by default
  - otherwise the library starts collapsed to reduce scroll burden
- Fixed notification policy editing usability:
  - `Instruction`
  - `Action code`
  now use multi-line textareas with visible full text instead of clipped single-line inputs
- Locked vital template type safety:
  - built-in labels now keep their correct fixed `input_type`
  - `Body Temperature`, `SpO2`, `Heart Rate`, `Weight`, etc. stay `numeric`
  - `Blood Pressure` stays `blood_pressure`
  - custom vitals are now numeric-only
  - malformed existing template payloads are coerced back into valid shape on load in both:
    - `src/services/trialTemplateService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js`
- Split Clinical Intelligence into truly separate workspaces:
  - `focus=guidance` now renders only Side Effect Guidance
  - `focus=dropout` now renders only Patient Dropout Prediction
  - guidance and dropout no longer share one long continuously scrollable area
- Replaced the old single-patient dropout card with a dedicated CRC-only dashboard:
  - subscribes to all live Firestore `users/{uid}/dropout_predictions/current` snapshots
  - joins those snapshots against the live patient roster
  - shows summary metrics:
    - total scored patients
    - high-risk patients
    - actionable patients
    - average dropout probability
  - renders a risk-ranked patient list sorted highest-to-lowest by `dropout_probability`
  - adds search by:
    - patient nickname
    - `subject_id`
    - email
  - selecting a ranked or searched patient opens a dedicated detail panel with:
    - `dropout_probability`
    - `risk_bucket`
    - `recommended_action`
    - `action_priority_score`
    - `explanation_signals`
    - `missing_inputs_summary`
- Validation completed for this UI round:
  - `npm run build:crc` passed successfully after rerunning outside the sandbox because the sandbox blocked `esbuild` child process spawn with `EPERM`
  - targeted ESLint passed cleanly for:
    - `src/pages/CRCHome.jsx`
    - `src/components/ProtocolManager.jsx`
    - `src/components/DropoutRiskPanel.jsx`
    - `src/components/PatientEditMenu.jsx`
    - `src/services/dropoutService.js`
    - `src/services/trialTemplateService.js`
    - `src/utils/validation.js`
  - targeted ESLint also passed for the modified mobile files:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/ProfileModal.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/CalendarDateField.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js`

### CRC And Patient Web Live Redeploy
- Redeployed both Firebase Hosting sites from the integration workspace using the configured dual-site hosting targets:
  - `hosting:crc` -> `https://triallight.web.app/`
  - `hosting:patient` -> `https://triallight-patient.web.app/`
- Confirmed the workspace hosting configuration before deploy:
  - `.firebaserc` maps:
    - `crc` -> `triallight`
    - `patient` -> `triallight-patient`
  - `firebase.json` uses:
    - `dist` for CRC web
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/web-build` for patient web
- Deployment ran through the existing root script:
  - `npm run deploy:hosting`
  which executed both predeploy builds and then released both hosting targets successfully.
- CRC web production build completed during deploy:
  - `npm run build:crc`
  - output published from `dist`
- Patient web production export completed during deploy:
  - `npm run build:patient-web`
  - Expo web bundle exported to `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/web-build`
- Final live release status:
  - `triallight` release complete
  - `triallight-patient` release complete
- Firebase CLI reported a successful deploy for both live URLs:
  - `https://triallight.web.app`
  - `https://triallight-patient.web.app`
- The deploy surfaced a non-blocking bundle-size warning for the CRC web app:
  - the main JS bundle remains above the 500 kB warning threshold after minification
  - no deploy failure occurred, but future performance cleanup can target chunk splitting if needed

### Dropout Live-Data Direct Scoring Backend Cutover
- Began the v1 backend cutover from frozen day-history scoring to live operational-data direct scoring while preserving the existing daily GitHub Actions batch architecture.
- Kept the model contract and CRC-facing prediction payload unchanged:
  - no model retraining
  - no new CRC output fields
  - live path still publishes to:
    - `users/{uid}/dropout_predictions/current`
    - `dropout_predictions`
- Extended the frozen runtime manifest at:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_v35subjectid.json`
  with:
  - `subject_context_registry_path`
  so the deployment bundle can keep static trial context while removing dependence on frozen longitudinal daily rows.
- Added a new static context asset builder:
  - `Patient-Dropout-Prediction/src/build_subject_context_registry.py`
  which compresses the frozen deploy dataset into one row per canonical `subject_id`.
- Built the new subject context asset:
  - `Patient-Dropout-Prediction/deploy_assets/data/triallight_subject_context_registry_v35subjectid.csv`
  with:
  - `26063` subject rows
  - no duplicate `subject_id`
  - preserved static model covariates plus `trial_id`, `legacy_subject_id`, and `max_day_index`
- Added a new live adapter module:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  to assemble live `history_records` from:
  - `users/{uid}` patient profile
  - `users/{uid}/vitals`
  - `users/{uid}/appointments`
  - `users/{uid}/epro_submissions`
  - Supabase `patient_daily_logs`
  - `users/{uid}/side_effect_reports`
  - `incident_records`
  - `users/{uid}/alerts/*/messages`
- The live adapter now:
  - anchors `day_index` by `protocolAssignedAt`, else earliest operational timestamp
  - uses `Asia/Kuala_Lumpur` by default through `TRIALLIGHT_OPERATION_TZ`
  - rebuilds required rolling features using the existing generator math for:
    - days-since signals
    - recent ratios/counts
    - ePRO status coding
    - mean/max/trend windows
    - symptom burden composite
  - caps live history length to the subject registry `max_day_index` so inference stays within the deployment subject horizon
- Extended:
  - `Patient-Dropout-Prediction/src/module_service.py`
  with:
  - manifest-driven `DEFAULT_SUBJECT_CONTEXT_REGISTRY_PATH`
  to support live publisher/runtime lookups without hardcoding ad hoc paths.
- Upgraded:
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  to support:
  - `--source-mode frozen`
  - `--source-mode live`
  - `--source-mode dry-run-live`
- The publisher now:
  - keeps `frozen` as rollback/testing mode
  - uses `score_history_records_for_crc(...)` for live direct scoring
  - syncs `dropout_testing_subjects` from the new subject context registry in live mode
  - chunks live subject sync into batches to avoid oversized Supabase upsert payloads
  - prints live-source diagnostics including:
    - usable static context count
    - sufficient live history count
    - skipped patients due to missing operational sources
    - per-source coverage totals
- Updated GitHub Actions workflow:
  - `.github/workflows/dropout-precompute.yml`
  so scheduled dropout publishing now preflights and publishes with:
  - `--source-mode live`
- Validation completed for this backend cutover:
  - Python syntax check passed for:
    - `Patient-Dropout-Prediction/src/module_service.py`
    - `Patient-Dropout-Prediction/src/live_data_adapter.py`
    - `Patient-Dropout-Prediction/src/build_subject_context_registry.py`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  - subject context registry build succeeded
  - registry smoke checks confirmed:
    - `26063` rows
    - `26063` unique `subject_id`
    - legacy alias resolution example:
      - `NCT00003453_P0001 -> TL-S00001`
- Ran local live preflight in the current shell and confirmed the new path wiring is correct:
  - frozen checkpoints found
  - live subject context registry found
  - operation timezone printed correctly
- Live preflight in this Codex shell is still blocked by missing environment variables in the current shell session:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Because those live credentials were not present in this shell, this round did **not** execute:
  - real `dry-run-live`
  - real live publish with live direct operational history
- The next execution step is now clearly defined:
  - rerun `publish_dropout_snapshots.py --preflight-only --source-mode live`
  - then `--source-mode dry-run-live`
  - then manual `--source-mode live`
  using a shell that has the Firebase and Supabase credentials loaded.

### Live Direct Scoring Dry-Run Stabilization

- Continued the live direct-scoring rollout by fixing the first real runtime blocker in:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- Added per-source timing and error diagnostics for the live adapter:
  - `DROPOUT_LIVE_DEBUG=1` now prints source-by-source fetch latency and counts
  - publisher preview diagnostics now include `sample_live_source_errors`
- Reduced the heaviest live Firestore reads to recent-window queries where possible:
  - recent-limited reads for `vitals`
  - recent-limited reads for `appointments`
  - recent-limited reads for `epro_submissions`
  - recent-limited reads for `side_effect_reports`
  - recent-limited alert/message scans for CRC follow-up threads
- Tightened live-history readiness rules:
  - a patient is no longer considered `usable_live_history` if all live operational sources are empty
  - this prevents static-only fallback rows from being scored as if they were real live histories
- Re-ran live preflight with loaded Firebase and Supabase credentials and confirmed:
  - `ready=True`
  - live source mode paths and frozen assets resolved correctly
- Executed a read-only single-patient live direct dry-run:
  - `scanned_patient_docs=1`
  - `predictions_ready=1`
  - source timings were emitted successfully
- Executed a wider read-only five-patient live direct dry-run:
  - `scanned_patient_docs=5`
  - `predictions_ready=4`
  - `usable_static_context=5`
  - `sufficient_live_history=4`
  - `skipped_missing_operational_sources=1`
- The new live diagnostics showed the current external gap clearly:
  - Firestore live sources are reachable and scoring works
  - Supabase `patient_daily_logs` lookups failed due DNS resolution of the configured Supabase host in this shell
  - as a result, `pain/anxiety` signals from `patient_daily_logs` are still missing in this environment even though the live direct path now completes
- A representative dry-run preview artifact was written to:
  - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260331_fivepatients.json`
- Current state after this stabilization step:
  - live direct scoring no longer hangs on the first real dry-run
  - read-only batch dry-run is working against real Firestore patient docs
  - the remaining blocker before switching the main live publisher over is reliable access to Supabase `patient_daily_logs`, or an equivalent live ePRO answer fallback source

### ePRO-To-Dropout Live Data Cutover

- Implemented the formal ePRO-to-dropout cutover so pain/anxiety can flow into live direct scoring without depending on Supabase `patient_daily_logs` as the primary source.
- Updated the formal Edge-function baseline question set in:
  - `supabase/functions/_shared/baselineConfig.ts`
  and synced local parity config in:
  - `li qiu's part questionnaire ePRO/epro_config.json`
- Added a real protocol anxiety cluster:
  - `ePRO_012` anxiety boolean gatekeeper
  - `ePRO_013` anxiety 0-10 rating
  - `ePRO_014` anxiety interference 0-10 rating
  - `ePRO_015` anxiety text follow-up
- Reworked the formal ePRO Edge runtime in:
  - `supabase/functions/_shared/eproCore.ts`
  so it now:
  - extends the formal schedule from `4` days to `30` days
  - removes `dropout risk` from question generation inputs
  - uses real Firestore prompt context from:
    - `users/{uid}/ai_chat_history`
    - `users/{uid}/vitals`
    - `users/{uid}/side_effect_reports`
  - keeps the baseline protocol set immutable
  - appends at most `2` customized questions
  - restricts customized questions to `boolean` or `text`
- Added Firebase token passthrough for Edge question generation context in:
  - `supabase/functions/_shared/firebaseAuth.ts`
  - `supabase/functions/epro-daily-survey/index.ts`
  - `supabase/functions/epro-submit/index.ts`
- Added a new shared Firestore prompt-context loader:
  - `supabase/functions/_shared/firestorePromptContext.ts`
- Updated the local Node parity service in:
  - `li qiu's part questionnaire ePRO/server_integrated.js`
  so local dev behavior now matches the new contract:
  - `30` day horizon
  - no dropout-risk prompt input
  - baseline plus max-2 custom questions
- Expanded the patient-app operational ePRO mirror in:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
  so Firestore `users/{uid}/epro_submissions/{formId}` now carries structured dropout-ready answer summaries:
  - `day_number`
  - `pain_score`
  - `anxiety_score`
  - `base_positive_flags`
  - `has_free_text_followup`
- Rewired the dropout live adapter in:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  so ePRO scoring now uses:
  - primary source: Firestore `epro_submissions` answer summary fields
  - fallback source: Supabase `patient_daily_logs`
- Tightened fallback behavior so unsubmitted/assigned ePRO records do not trigger unnecessary Supabase answer lookups.
- Extended publisher diagnostics in:
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  to report live ePRO answer-summary coverage:
  - `patients_with_epro_answer_summary`
- Added a controlled backfill utility for existing Firestore ePRO mirrors:
  - `Patient-Dropout-Prediction/src/backfill_epro_answer_mirror.py`
  - default mode is dry-run
  - `--apply` is required before it writes any real Firestore updates
- Validation completed for this cutover:
  - Python syntax check passed for:
    - `Patient-Dropout-Prediction/src/live_data_adapter.py`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
    - `Patient-Dropout-Prediction/src/backfill_epro_answer_mirror.py`
  - local Node syntax check passed for:
    - `li qiu's part questionnaire ePRO/server_integrated.js`
  - targeted ESLint passed for:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
- Environment note:
  - `deno` is not installed in this shell, so formal Edge TypeScript runtime validation by `deno check` could not be executed here.
- Current cutover state:
  - ePRO no longer uses dropout risk to generate questions
  - anxiety is now a formal protocol-owned signal
  - Firestore ePRO mirrors are now capable of carrying dropout-ready pain/anxiety summaries
  - dropout live direct scoring is ready to prefer Firestore ePRO summaries over Supabase answer logs
- Remaining execution steps, not yet run in this round:
  - deploy the updated Edge functions
  - submit at least one real questionnaire through the new flow
  - run `publish_dropout_snapshots.py --source-mode dry-run-live`
  - confirm non-zero `patients_with_epro_answer_summary`
  - only then do manual real `--source-mode live` publish

## 2026-04-02 - ePRO live summary verification and first live dropout publish

- Resumed the paused ePRO-to-dropout cutover validation after Firestore quota recovered enough for targeted reads.
- Verified a real Firestore mirrored ePRO submission document for:
  - Firebase UID `Lt0ixlQZFkgg04MhBHwfQmW2tD33`
  - `form_id = TL-S00011-day-1`
- Confirmed the service-side Firestore mirror now contains dropout-ready structured summary fields:
  - `pain_score = 2.3333333333333335`
  - `anxiety_score = 5`
  - `status = submitted`
  - `base_positive_flags = ["ePRO_005", "ePRO_012"]`
  - `has_free_text_followup = true`
- Ran a targeted single-patient live dry-run:
  - `publish_dropout_snapshots.py --source-mode dry-run-live --firebase-uids Lt0ixlQZFkgg04MhBHwfQmW2tD33 --limit-patients 1`
- Dry-run result:
  - `predictions_ready = 1`
  - `epro_submissions = 1`
  - `epro_answer_summary = 1`
  - preview written to:
    - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260402_singlepatient.json`
- This confirmed the live path:
  - `Firestore ePRO answer summary -> live_data_adapter -> history_records -> dropout scoring`
- Executed the first real single-patient live publish using the new live-data path:
  - `publish_dropout_snapshots.py --source-mode live --firebase-uids Lt0ixlQZFkgg04MhBHwfQmW2tD33 --limit-patients 1 --skip-testing-subject-sync`
- Live publish succeeded:
  - `Published 1 dropout prediction snapshots`
  - `predictions_ready = 1`
  - `epro_answer_summary = 1`
- Verified Firestore current snapshot write at:
  - `users/Lt0ixlQZFkgg04MhBHwfQmW2tD33/dropout_predictions/current`
- Verified the current snapshot contains:
  - `subject_id = TL-S00011`
  - `dropout_probability = 0.79221`
  - `risk_bucket = high`
  - `recommended_action = review_today_consider_outreach`
  - `published_at = 2026-04-02T10:50:03+00:00`
- Verified matching Supabase history write in `dropout_predictions` for:
  - `subject_id = TL-S00011`
  - `dropout_probability = 0.79221`
  - `risk_bucket = high`
  - `recommended_action = review_today_consider_outreach`
- Current state after this milestone:
  - ePRO pain/anxiety summaries are now proven to flow into live direct dropout scoring
  - the live publisher has been validated end-to-end on a real patient using the new source path
  - frozen longitudinal history is no longer required for this validated live-scoring path
  - next rollout decision is whether to expand from single-patient validation to broader real-patient live publishing and scheduled automation

## 2026-04-02 - CRC safety information architecture simplified

- Implemented the recommended IA change for overlapping `Alerts`, `Safety Inbox`, and `History` so CRC now gets:
  - a top-right `Urgent` quick launcher
  - one primary `Safety Inbox` workspace
  - `History` merged into `Safety Inbox` as an internal tab instead of a separate sidebar destination
- Updated `src/pages/CRCHome.jsx`:
  - changed the top-right launcher label from `Alerts`/`Inbox`/`Message` variants to a stable `Urgent`
  - switched the alert launcher widget into urgent-only list mode
  - removed the separate `History` sidebar item
  - added `tab=open|resolved|history` state for `Safety Inbox`
  - passed structured incident data plus alert-thread history into the unified inbox panel
- Updated `src/components/LiveChatWidget.jsx` usage path so the CRC header launcher behaves like a quick urgent entry point instead of a mixed history workspace.
- Updated `src/components/TopNavbar.jsx` so the shared fallback label is also `Urgent`.
- Updated `src/App.jsx`:
  - deprecated `/history` as a standalone workflow route
  - now redirects `/history` to `/home?section=safety-inbox&tab=history`
  - kept the legacy page file on disk but disabled it as the primary path
- Expanded `src/components/SafetyInboxPanel.jsx` into a single workspace with:
  - `Open` tab for active structured incidents
  - `Resolved` tab for completed incident follow-up
  - `History` tab for read-only raw alert thread archive and audit search
- Added new inbox tab styling and archive filter support in `src/index.css`.
- Verification:
  - CRC production build passed with `npm run build:crc`
  - build required out-of-sandbox execution because sandboxed `esbuild` spawn hit `EPERM`; this was an environment permission issue, not a code error
- Resulting workflow intent:
  - `Urgent` = immediate quick launcher only
  - `Safety Inbox` = CRC daily safety workspace
  - `History` = archive tab inside `Safety Inbox`, not a competing main destination

## 2026-04-02 - CRC ePRO review-and-release workflow foundation

- Implemented the CRC-side `ePRO` workspace foundation so ePRO no longer lives only as an operational summary inside `Study Coordination`.
- Updated the CRC web navigation in:
  - `src/pages/CRCHome.jsx`
  - `src/components/CRCWorkspaceShell.jsx`
- Added a new sidebar section:
  - `ePRO`
  - positioned directly below `Patient Dropout Prediction`
  - routed via `/home?section=epro`
- Removed the duplicated `ePRO Operations` block from `Study Coordination` and moved ePRO operational visibility into the dedicated `ePRO` workspace.
- Added a new CRC review workspace component:
  - `src/components/EproReviewWorkspace.jsx`
  - supports:
    - `Pending Trial Reviews`
    - `Pending Patient Reviews`
    - `Released Today`
    - `Submitted / Overdue`
    - single-item approve actions
    - wording-only edit mode
    - `Approve All ePRO` with double-confirm modal
- Upgraded the operational status panel in:
  - `src/components/EproStatusPanel.jsx`
  - now supports header suppression so it can be embedded cleanly inside the new ePRO page without duplicating page titles.
- Added CRC web-to-edge service wiring in:
  - `src/services/eproReviewService.js`
  - new edge function calls:
    - `epro-review-queue`
    - `epro-review-action`

- Added new Supabase review data model migration:
  - `supabase/migrations/20260402_epro_review_release_workflow.sql`
- New review tables introduced:
  - `epro_trial_daily_review`
  - `epro_patient_daily_review`
- These tables support:
  - trial-level baseline review rows
  - patient-level customized review rows
  - wording overrides that only affect the current day/current review item
  - approval metadata
  - auto-release metadata

- Added new shared ePRO service modules:
  - `supabase/functions/_shared/eproShared.ts`
  - `supabase/functions/_shared/eproReviewCore.ts`
- Shared logic now covers:
  - baseline cloning
  - customized question generation
  - review-window timing
  - trial/patient review row creation
  - wording override application
  - single-item approval
  - `Approve All` approval
  - cutoff-based auto-release
  - Firestore mirror synchronization for pending/released states

- Added new edge functions:
  - `supabase/functions/epro-review-queue/index.ts`
  - `supabase/functions/epro-review-action/index.ts`
- Current runtime intent:
  - CRC workspace loads/builds today’s queue
  - patient cannot answer a draft that is still pending CRC review
  - approved or auto-released drafts become visible to the patient app

- Reworked the official ePRO runtime path in:
  - `supabase/functions/_shared/eproCore.ts`
- `epro-daily-survey` is now release-aware:
  - returns `awaiting_crc_review` when the current questionnaire is still pending CRC review
  - only returns `questions` after approval or auto-release
- `epro-submit` now only accepts the released questionnaire version and preserves review metadata in the Firestore mirror.

- Expanded Firestore prompt/identity helper behavior in:
  - `supabase/functions/_shared/firestorePromptContext.ts`
- It can now:
  - read target patient prompt context using a CRC Firebase token
  - expose:
    - `role`
    - `protocol_id`
    - `protocol_name`
    - `primary_crc_id`

- Updated patient app ePRO flow in:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js`
- Patient-facing behavior now supports:
  - `Today’s questionnaire is awaiting CRC review.`
  - review metadata mirrored to `users/{uid}/epro_submissions/{formId}`
  - continued answer-summary mirroring for:
    - `pain_score`
    - `anxiety_score`
    - `base_positive_flags`
    - `has_free_text_followup`

- Verification completed in this workspace:
  - `node --check` passed for:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js`
  - CRC production build passed:
    - `npm.cmd run build:crc`
  - build still reports the existing large bundle warning, but the build completed successfully.

- Validation limitation:
  - `deno` is not installed in this shell, so formal local `deno` type/runtime validation for the new Edge Functions could not be executed here.

- Current state after this milestone:
  - CRC now has a dedicated `ePRO` workspace entry in the sidebar
  - `Study Coordination` no longer duplicates ePRO operational UI
  - the service layer now supports pending review, per-item approval, approve-all, and auto-release metadata
  - the patient app now understands `awaiting_crc_review`
  - remote database migration and edge function deployment still need to be executed before this workflow becomes live in production

## 2026-04-02 - Supabase ePRO review deployment unblock

- Resumed production rollout for the ePRO review-and-release workflow after the local implementation milestone.
- Confirmed this workstation is now logged into Supabase CLI for project `fygkqituefwldmglijvy`.
- Confirmed remote function baseline before deployment:
  - existing: `process-pdf`, `epro-daily-survey`, `epro-submit`
  - missing: `epro-review-queue`, `epro-review-action`
- Confirmed remote database migration path is reachable via `supabase db push --dry-run`.
- Fixed a production-blocking config gap in:
  - `supabase/config.toml`
- Added:
  - `[functions.epro-review-queue] verify_jwt = false`
  - `[functions.epro-review-action] verify_jwt = false`
- Rationale:
  - these CRC-facing functions receive Firebase ID tokens from the web client
  - without `verify_jwt = false`, the Supabase gateway would reject requests before the function-level Firebase auth check runs

## 2026-04-02 - Supabase ePRO review workflow deployed remotely

- Applied remote database migrations to project `fygkqituefwldmglijvy` via Supabase CLI:
  - `20260323_triallight_no_render_baseline.sql`
  - `20260402_epro_review_release_workflow.sql`
- Migration push completed successfully.
- Deployed live Edge Functions:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`
- Confirmed remote function list now includes:
  - `epro-review-queue`
  - `epro-review-action`
- Confirmed the new review tables are reachable through the live Supabase REST layer:
  - `epro_trial_daily_review`
  - `epro_patient_daily_review`
- Current state after deployment:
  - the CRC-side ePRO review workspace is now backed by live review tables and live review/action functions
  - patient questionnaire release can now be gated by CRC approval or auto-release cutoff on the backend
  - end-to-end CRC/patient workflow verification is still required in the product UI

## 2026-04-02 - CRC and patient web redeployed after ePRO review rollout

- Rebuilt and redeployed both live Firebase Hosting surfaces after the ePRO review/release backend rollout.
- Build steps completed successfully:
  - `npm.cmd run build:crc`
  - `npm.cmd run build:patient-web`
- Live deployment completed successfully:
  - `https://triallight.web.app`
  - `https://triallight-patient.web.app`
- This publish puts the latest front-end changes live, including:
  - CRC `ePRO` sidebar workspace entry
  - removal of duplicated `ePRO Operations` from `Study Coordination`
  - patient-facing `awaiting CRC review` gating behavior
- Existing warning retained:
  - the CRC bundle still emits the non-blocking large chunk warning during build

<<<<<<< Updated upstream
## 2026-04-02 - CRC shell header and duplicate section hero cleanup

- Refined the CRC shell layout to reduce repeated navigation cues and make the workspace easier for CRC users to scan.
- Updated `src/components/CRCWorkspaceShell.jsx`:
  - moved the sidebar collapse control into the sidebar header row
  - aligned it beside the `TrialLight` brand block instead of floating it outside the sidebar edge
- Updated `src/components/TopNavbar.jsx`:
  - removed the duplicated top-right `Resources` launcher
  - kept only `Urgent` and the profile menu in the top-right action area
- Updated `src/pages/CRCHome.jsx`:
  - removed repeated page-level section hero blocks from:
    - `dashboard`
    - `patients`
    - `safety-inbox`
    - `clinical-intelligence`
    - `protocol-library`
    - `study-coordination`
    - `epro`
    - `resources`
  - kept the shell header as the single page title/description source
- Updated `src/index.css`:
  - added the new sidebar header row layout
  - restyled the collapse button as an internal compact header button
  - tightened section spacing after removing duplicated hero blocks
- Verification completed:
  - `npm.cmd run build:crc`
  - build passed successfully
- Existing warning retained:
  - the CRC bundle still emits the non-blocking large chunk warning during build

## 2026-04-03 - Fully-live dropout static sources and v2 deploy package

- Added patient-level live static field capture in the patient app:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/ProfileModal.js`
- New patient fields now persist to `users/{uid}`:
  - `caregiver_support`
  - `distance_to_site_km`
- `dob` remains the source for runtime-derived `age`.

- Added protocol PDF dropout static-context extraction service:
  - `src/services/protocolStaticContextService.js`
- The new service:
  - signs the uploaded protocol PDF from Supabase Storage
  - extracts text from the PDF
  - uses Gemini plus deterministic normalization helpers to derive:
    - `trial_phase`
    - `condition_family`
    - `enrollment`
    - `criteria_complexity`
    - intervention flags
  - writes `protocols/{protocolId}.dropout_static_context`
  - writes extraction metadata:
    - `extracted_at`
    - `extractor_version`
    - `source_pdf_path`
    - `extraction_status`
- Wired protocol upload to trigger extraction immediately after the protocol doc is created:
  - `src/components/ProtocolManager.jsx`

- Refactored the live dropout runtime to remove frozen static registry usage from the live path:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- Live scoring static inputs are now assembled only from:
  - `users/{uid}` patient fields
  - `protocols/{protocolId}.dropout_static_context`
- `live_data_adapter.py` now:
  - derives `age` from `dob`
  - maps `caregiver_support` -> model `caregiver`
  - maps `distance_to_site_km` -> model `dist_km`
  - no longer reads `subject_context_registry`
  - emits separate diagnostics for:
    - patient static coverage
    - protocol static coverage
    - dynamic source coverage
- `publish_dropout_snapshots.py` now:
  - no longer requires `subject_context_registry` in live preflight
  - syncs `dropout_testing_subjects` from live Firestore patient docs in live mode
  - skips patients with missing live static fields and reports explicit diagnostics

- Updated the model/training schema for the fully-live v2 line:
  - `Patient-Dropout-Prediction/src/feature_pipeline.py`
  - `Patient-Dropout-Prediction/src/integration_adapters.py`
  - `Patient-Dropout-Prediction/src/train.py`
  - `Patient-Dropout-Prediction/src/predict.py`
  - `Patient-Dropout-Prediction/src/data_generator.py`
- Removed `trial_dropout_prior` from the model input schema.
- The hybrid generator still uses latent trial-level dropout pressure internally, but the exported training rows for the new schema no longer expose `trial_dropout_prior` as a model feature.

- Trained two fully-live v2 candidate runs without overwriting the legacy deployed package:
  - patient split:
    - `Patient-Dropout-Prediction/runs/fully_live_v2/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-04-03T09-20-16+00-00`
    - best metrics:
      - `p_at_r80 = 0.3805`
      - `pr_auc = 0.5988`
      - `alert_frac_at_r80 = 0.3085`
      - `test_positive_rate = 0.1467`
  - trial split:
    - `Patient-Dropout-Prediction/runs/fully_live_v2/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SStrial__FGfull__2026-04-03T09-47-36+00-00`
    - best metrics:
      - `p_at_r80 = 0.3761`
      - `pr_auc = 0.6044`
      - `alert_frac_at_r80 = 0.3105`
      - `test_positive_rate = 0.1459`

- Created a new fully-live v2 deploy package without overwriting the legacy checkpoint directory:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints_live_v2/model_stage_3_29_single.pth`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints_live_v2/artifacts_stage_3_29_single.pkl`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_live_v2.json`
- Updated `Patient-Dropout-Prediction/src/module_service.py` to prefer the new fully-live v2 manifest before legacy manifests.
- The new manifest intentionally omits `subject_context_registry_path`.

- Verification completed:
  - Python syntax checks passed for the modified dropout backend files via `py_compile`
  - local model smoke test succeeded using the new fully-live v2 manifest and checkpoint directory
  - local static-context smoke test succeeded for:
    - `dob`
    - `caregiver_support`
    - `distance_to_site_km`
    - `dropout_static_context`
  - `npm.cmd run build:crc` passed successfully
- Current known environment gap:
  - the local `Patient-Dropout-Prediction/env` runtime used in this session is missing `requests`
  - live publisher preflight still runs and confirms registry is no longer required, but real live publish from that specific environment still needs a Python environment with the full HTTP dependency set

## 2026-04-03 - Honest dropout evaluation split and live-only generator pressure proxy

- Reviewed the dropout pipeline with a realism-first focus and implemented two structural corrections in the active backend:
  - `Patient-Dropout-Prediction/src/train.py`
  - `Patient-Dropout-Prediction/src/data_generator.py`

- Reworked training/evaluation so epoch selection and policy threshold derivation no longer look at the held-out test set:
  - added an explicit train/validation/test split inside `build_or_load_window_cache`
  - cache files now persist:
    - `__train.npz`
    - `__val.npz`
    - `__test.npz`
  - added `validation_frac` support to training runs
  - best checkpoint selection now uses validation metrics only
  - `risk_policy` is now derived from validation predictions instead of test predictions
  - training summaries now include:
    - `best_validation_metrics`
    - validation label diagnostics
- Updated `Patient-Dropout-Prediction/src/evaluate_saved_models.py` to consume the new cached split structure.

- Removed the remaining hidden dependence on non-live `trial_dropout_prior` inside the hybrid generator world model:
  - replaced it with a live-schema-compatible `trial_operational_pressure` proxy derived only from:
    - `trial_phase`
    - `condition_family`
    - `enrollment`
    - `criteria_complexity`
    - intervention flags
  - removed `droupout_rate` from the generator merge path so the synthetic patient world is no longer implicitly shaped by a deployment-unavailable field
  - updated latent burden, flare probability, abnormal vital probability, baseline engagement, baseline symptom pressure, and anxiety-branch activation to use the new proxy

- Exported a new realism-aligned hybrid dataset without overwriting previous datasets:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v35fullyliveproxy.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v35fullyliveproxy__sanity.json`
- New dataset diagnostics:
  - rows: `938,268`
  - patients: `26,063`
  - trials: `1,000`
  - row positive rate: `0.1098`
  - patient event rate: `0.5728`
- Compared with the prior `v34bprevalencefix` sanity report:
  - row positive rate increased from `0.1012` to `0.1098`
  - patient event rate increased from `0.5279` to `0.5728`

- Trained new honesty-first runs on the `v35fullyliveproxy` dataset:
  - patient split:
    - `Patient-Dropout-Prediction/runs/fully_live_v3_honest/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-04-03T10-58-04+00-00`
    - validation best:
      - `p_at_r80 = 0.3896`
      - `pr_auc = 0.6231`
      - `alert_frac_at_r80 = 0.3390`
    - held-out test:
      - `p_at_r80 = 0.3731`
      - `pr_auc = 0.6056`
      - `alert_frac_at_r80 = 0.3528`
      - `roc_auc = 0.8557`
      - `brier = 0.1575`
  - trial split:
    - `Patient-Dropout-Prediction/runs/fully_live_v3_honest/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SStrial__FGfull__2026-04-03T11-18-27+00-00`
    - validation best:
      - `p_at_r80 = 0.4052`
      - `pr_auc = 0.6107`
      - `alert_frac_at_r80 = 0.3515`
    - held-out test:
      - `p_at_r80 = 0.3914`
      - `pr_auc = 0.6136`
      - `alert_frac_at_r80 = 0.3307`
      - `roc_auc = 0.8611`
      - `brier = 0.1491`

- Ran one targeted tuning experiment for the weaker patient split using focal loss plus hard-negative oversampling:
  - `Patient-Dropout-Prediction/runs/fully_live_v3_honest_tuned/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-04-03T11-36-53+00-00`
  - held-out test:
    - `p_at_r80 = 0.3775`
    - `pr_auc = 0.5991`
    - `alert_frac_at_r80 = 0.3490`
    - `roc_auc = 0.8520`
    - `brier = 0.1687`
- Result:
  - tuning slightly improved patient-split `p_at_r80`
  - but worsened `pr_auc`, `roc_auc`, and `brier`
  - so the tuned patient run was not promoted as the preferred candidate

- Important interpretation from this round:
  - the previous fully-live v2 metrics were optimistic because test data was being used for epoch selection and policy derivation
  - the new `fully_live_v3_honest` line is more deployment-realistic even when its reported metrics are less flattering
  - under the more honest patient split, the transformer advantage over the logistic baseline is modest and not dominant on every metric

## 2026-04-03 - Honest v3 official freeze, v37 prevalence target, and default runtime cutover

- Finalized the official dropout generator target instead of continuing open-ended tuning:
  - tightened the generator confirmation rules in `Patient-Dropout-Prediction/src/data_generator.py`
  - froze the disengagement world at:
    - `SYMPTOM_FLARE_PRIOR_SCALE = 0.50`
    - `PRIMARY_CONFIRM_STREAK_DAYS = 6`
    - `SYMPTOM_CONFIRM_WINDOW_DAYS = 10`
    - `SYMPTOM_CONFIRM_MIN_HITS = 9`
    - `MIXED_CONFIRM_PRIMARY_STREAK_DAYS = 5`
    - `MIXED_CONFIRM_RECENT_SYMPTOM_HITS = 3`

- Exported the new official honest dataset without overwriting prior datasets:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v37honestofficial.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v37honestofficial__sanity.json`
- The new sanity report hit the intended patient-level prevalence target:
  - `patient_event_rate = 0.204773`
  - `row_positive_rate = 0.039817`
  - `confirmed_disengagement_patient_count = 5337`
  - `primary_event_share = 0.677534`
  - `symptom_event_share = 0.334270`

- Retrained the final honest candidate on the frozen `v37honestofficial` dataset using strict train/validation/test separation:
  - patient split:
    - `Patient-Dropout-Prediction/runs/honest_v3_official/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-04-03T12-37-08+00-00`
    - final transformer:
      - `p_at_r80 = 0.4493`
      - `pr_auc = 0.6088`
      - `alert_frac_at_r80 = 0.0848`
      - `roc_auc = 0.9720`
      - `brier = 0.0725`
    - logistic challenger:
      - `p_at_r80 = 0.4161`
      - `pr_auc = 0.5706`
      - `alert_frac_at_r80 = 0.0916`
      - `roc_auc = 0.9671`
      - `brier = 0.0720`
  - trial split:
    - `Patient-Dropout-Prediction/runs/honest_v3_official/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SStrial__FGfull__2026-04-03T12-59-05+00-00`
    - final transformer:
      - `p_at_r80 = 0.4391`
      - `pr_auc = 0.6029`
      - `alert_frac_at_r80 = 0.0838`
      - `roc_auc = 0.9715`
      - `brier = 0.0667`
    - logistic challenger:
      - `p_at_r80 = 0.3948`
      - `pr_auc = 0.5505`
      - `alert_frac_at_r80 = 0.0935`
      - `roc_auc = 0.9653`
      - `brier = 0.0693`

- Promotion gate result:
  - the final honest transformer did not materially underperform logistic on patient split
  - the final honest transformer clearly beat logistic on both `p_at_r80` and `pr_auc` under the stricter trial split
  - `alert_frac_at_r80` stayed below the logistic challenger on both splits
  - therefore the official model line was promoted to:
    - `Honest v3`
    - policy: `Recall-first`

- Created a new official deployment bundle without overwriting the older fully-live v2 package:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints_honest_v3/model_stage_3_29_single.pth`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints_honest_v3/artifacts_stage_3_29_single.pkl`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_honest_v3.json`
- The new manifest records:
  - official model line: `Honest v3`
  - official split strategy: `trial`
  - selection policy: `Recall-first`
  - rollout note that `frozen_model_manifest_live_v2.json` is now rollback only

- Updated the active runtime default order in:
  - `Patient-Dropout-Prediction/src/module_service.py`
- New manifest priority order now starts with:
  - `frozen_model_manifest_honest_v3.json`

- Updated deployment-facing docs:
  - `Patient-Dropout-Prediction/DEPLOYMENT.md`
  - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
- These now make the official stance explicit:
  - `Honest v3` is the current official runtime line
  - `fully_live_v2` remains available for rollback only
  - `trial_dropout_prior` and `subject_context_registry` are not part of the official live runtime contract

- Verification completed:
  - `py_compile` passed for:
    - `Patient-Dropout-Prediction/src/module_service.py`
    - `Patient-Dropout-Prediction/src/train.py`
    - `Patient-Dropout-Prediction/src/data_generator.py`
    - `Patient-Dropout-Prediction/src/evaluate_saved_models.py`
  - runtime manifest loading confirmed that the default selected manifest is now:
    - `Honest v3`
    - checkpoints dir: `deploy_assets/checkpoints_honest_v3`
    - official split: `trial`

## 2026-04-03 (dropout prediction P0-P2 completion pass)

- Extended the Honest v3 training/runtime toolchain with validation-fitted probability calibration:
  - added `Patient-Dropout-Prediction/src/calibration_utils.py`
  - updated:
    - `Patient-Dropout-Prediction/src/train.py`
    - `Patient-Dropout-Prediction/src/evaluate_saved_models.py`
    - `Patient-Dropout-Prediction/src/risk_engine_inference.py`
    - `Patient-Dropout-Prediction/src/risk_engine_batch_inference.py`
- New behavior:
  - calibration is fit on `validation`
  - calibrated probabilities are used for final evaluation and runtime scoring when present in artifacts
  - summaries now retain both raw and calibrated metrics

- Implemented a formal missing-data confidence policy for CRC-facing dropout outputs:
  - updated `Patient-Dropout-Prediction/src/module_service.py`
  - updated `src/components/DropoutRiskPanel.jsx`
- Added explicit confidence tiers:
  - `confidence_high`
  - `confidence_medium`
  - `confidence_limited`
- CRC list/detail views now surface a confidence label alongside risk ranking.

- Switched the scheduled GitHub Actions dropout workflow to the official Honest v3 checkpoint directory:
  - updated `.github/workflows/dropout-precompute.yml`
  - `DROPOUT_CHECKPOINTS_DIR` now defaults to:
    - `Patient-Dropout-Prediction/deploy_assets/checkpoints_honest_v3`

- Added shadow monitoring support to the dropout publisher:
  - updated `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- New publisher behavior:
  - preflight now prints:
    - official model line
    - selection policy
    - official split strategy
    - shadow monitoring requirement state
  - publish can now dual-write shadow rows to:
    - `dropout_shadow_predictions`
  - dry-run previews now include:
    - `shadow_prediction_rows`
  - shadow rows include:
    - model line metadata
    - source mode
    - subject mapping source
    - confidence/missing-input payloads
    - live source coverage
    - future proxy-evaluation status metadata

- Added a new Supabase migration for dropout shadow monitoring:
  - `supabase/migrations/20260403_dropout_shadow_monitoring.sql`
- New tables:
  - `dropout_shadow_predictions`
  - `dropout_proxy_evaluations`

- Added a forward proxy evaluation script:
  - `Patient-Dropout-Prediction/src/evaluate_shadow_proxies.py`
- This script:
  - reads due/pending shadow predictions
  - rebuilds live history for the scored patient
  - computes forward proxy outcomes such as:
    - `no_activity_7d`
    - `no_vitals_or_epro_7d`
    - `unanswered_followup_72h`
    - `serious_symptom_disengagement_7d`
    - `missed_appointment_and_no_recovery_7d`
  - upserts results into `dropout_proxy_evaluations`
  - patches the linked shadow row with completion/error status

- Added a protocol static-context QA export script:
  - `Patient-Dropout-Prediction/src/audit_protocol_static_context.py`
- This exports a CSV review sheet from Firestore `protocols/{protocolId}.dropout_static_context` for manual QA.

- Added a focused ablation runner for the official Honest v3 line:
  - `Patient-Dropout-Prediction/src/run_focus_ablation_suite.py`
- Supported scenarios:
  - `no_epro_pain_anxiety`
  - `no_crc_followup`
  - `no_side_effects`
  - `dynamic_only`

- Extended the training pipeline to support static-context ablation without changing the runtime contract:
  - updated `Patient-Dropout-Prediction/src/train.py`
- New training flag:
  - `--static_mode full|none`
- This allows a formal `dynamic_only` challenger run while keeping validation/test separation intact.

- Updated deployment and official-model docs:
  - `Patient-Dropout-Prediction/DEPLOYMENT.md`
  - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
- Docs now explicitly cover:
  - Honest v3 monitoring controls
  - shadow/proxy evaluation tables and scripts
  - calibration and confidence policy
  - protocol QA and focused ablation tooling

- Verification completed:
  - `py_compile` passed for:
    - `Patient-Dropout-Prediction/src/calibration_utils.py`
    - `Patient-Dropout-Prediction/src/risk_engine_inference.py`
    - `Patient-Dropout-Prediction/src/risk_engine_batch_inference.py`
    - `Patient-Dropout-Prediction/src/train.py`
    - `Patient-Dropout-Prediction/src/evaluate_saved_models.py`
    - `Patient-Dropout-Prediction/src/module_service.py`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
    - `Patient-Dropout-Prediction/src/evaluate_shadow_proxies.py`
    - `Patient-Dropout-Prediction/src/audit_protocol_static_context.py`
    - `Patient-Dropout-Prediction/src/run_focus_ablation_suite.py`
  - `npm.cmd run build:crc` passed after sandbox-escalated local build verification
  - non-blocking warning remains:
    - large JS bundle size during CRC production build

## 2026-04-04

- Stabilized the TrialLight dropout package for the pre-testing phase instead of enabling real-world shadow validation too early.
- Added a formal evidence pack:
  - `Patient-Dropout-Prediction/EVIDENCE_PACK.md`
- Added a fixed testing-start runbook for future real-user testing:
  - `Patient-Dropout-Prediction/TESTING_START_RUNBOOK.md`
- Added a demo scenario pack builder and generated official Honest v3 demo artifacts:
  - `Patient-Dropout-Prediction/src/build_demo_scenario_pack.py`
  - `Patient-Dropout-Prediction/deploy_assets/demo_scenario_pack_honest_v3.json`
  - `Patient-Dropout-Prediction/DEMO_SCENARIO_PACK.md`

- Reworked the focused ablation workflow so it is practical in the current phase:
  - updated `Patient-Dropout-Prediction/src/run_focus_ablation_suite.py`
- The runner now supports:
  - `suite-mode=sensitivity` for frozen-model source-missing analysis
  - `suite-mode=retrain` for future heavyweight re-train ablations
- For the current pre-testing freeze, the official ablation profile is:
  - `train_windows = 30000`
  - `test_windows = 15000`
  - patient split + trial split
  - scenarios:
    - `no_epro_pain_anxiety`
    - `no_crc_followup`
    - `no_side_effects`
    - `dynamic_only`
- Generated ablation outputs:
  - `Patient-Dropout-Prediction/runs/fa/20260404T025227Z/ablation_summary.json`
  - `Patient-Dropout-Prediction/ABLATION_SUMMARY.md`

- Frozen ablation conclusions recorded:
  - side-effect / incident signals are the strongest dependency in the current model
  - ePRO / pain / anxiety matter, but are not the single dominant anchor
  - CRC follow-up / reply helps, but is not the main driver in the current synthetic world
  - dynamic signals carry most of the ranking power
  - transformer stays stronger than logistic in most stress cases, but degrades sharply when side-effect signals are removed

- Replaced the old professor demo guide so it now follows Honest v3 rather than the legacy frozen `v35subjectid` runtime:
  - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`

- Added protocol static-context QA readiness artifacts:
  - `Patient-Dropout-Prediction/PROTOCOL_STATIC_CONTEXT_QA_STATUS.md`
  - `Patient-Dropout-Prediction/audit/protocol_static_context_qa_template.csv`
- Current blocker is explicit:
  - the real 25-protocol QA export is still pending because `FIREBASE_SERVICE_ACCOUNT_JSON` is not loaded in the local shell

- Local verification completed:
  - `py_compile` passed for:
    - `Patient-Dropout-Prediction/src/run_focus_ablation_suite.py`
    - `Patient-Dropout-Prediction/src/build_demo_scenario_pack.py`
    - `Patient-Dropout-Prediction/src/audit_protocol_static_context.py`
    - `Patient-Dropout-Prediction/src/evaluate_shadow_proxies.py`

- Added a full historical and status audit document for the entire dropout workstream:
  - `Patient-Dropout-Prediction/FULL_HISTORY_AND_STATUS_REPORT.md`
- This report consolidates:
  - the full implementation timeline from the first Codex takeover
  - major design pivots
  - model/dataset/runtime milestones
  - official metrics and current contract
  - completed vs partial vs pending work
  - remaining gaps and recommended next actions

- Added a root-level whole-system workflow and status document for supervisor review:
  - `TRIALLIGHT_FULL_WORKFLOW_AND_STATUS.md`
- This new document covers:
  - the full TrialLight system boundary and architecture
  - CRC web, patient app, ePRO, protocol extraction, safety, and dropout workflows
  - Firebase / Supabase / GitHub Actions runtime responsibilities
  - current subsystem maturity, risks, and likely supervisor criticism points
  - recommended feedback questions and next-step priorities
  - a condensed cross-system implementation timeline

## 2026-04-05

- Prepared a simulation-study research protocol package for TrialLight as a drug-clinical-trial-only workflow study using healthy volunteers role-playing as patients.
- Added an editable English source draft:
  - `TRIALLIGHT_SIMULATED_DRUG_TRIAL_RESEARCH_PROTOCOL.md`
- Generated Word deliverables based on the provided UMMC MREC research protocol template:
  - initial draft output:
    - `TrialLight_Simulated_Drug_Clinical_Trial_Research_Protocol.docx`
  - clean final submission copy:
    - `TrialLight_Simulated_Drug_Clinical_Trial_Research_Protocol_SUBMISSION.docx`
- The protocol package now includes:
  - a specific problem statement focused on reducing study-coordinator burden in side-effect monitoring for investigational drug subjects
  - study aim, null/alternative hypotheses, and measurable objectives
  - a detailed simulation methodology with a fictional Phase II oral investigational drug workflow
  - proposed sample size, recruitment, inclusion/exclusion criteria, scenario packs, conventional-vs-TrialLight crossover testing, rescue/safety logic, metrics, success criteria, data analysis, data handling, gantt plan, and potential impact
- Incorporated key guidance themes from the provided Ms Wong transcript:
  - start from a specific problem statement
  - define measurable outcomes instead of vague burden claims
  - use healthy volunteers / role-play simulation when real patient recruitment is not practical
  - keep a rescue/safety protocol and avoid over-promising reliance on the app

## 2026-04-07

- Reviewed the latest parallel 30-day live testing plan from:
  - `C:/Users/TUF-A15/Downloads/latest TrialLight_parallel_30day_protocol_background_noise_yellow.docx`
- Added a new planning guardrail document for future ChatGPT web revisions:
  - `TRIALLIGHT_TESTING_PLAN_CONTEXT_FOR_CHATGPT_WEB.md`
- This new document captures:
  - whether the current TrialLight system can realistically support the latest testing design
  - which parts are directly supported by the product versus supported only through study scaffolding
  - what the dropout module, ePRO flow, safety workflow, and synthetic background patient list can and cannot validly claim
  - wording and interpretation boundaries needed to avoid overclaiming real-world validity
  - operational constraints such as avoiding Firebase-heavy validation assumptions during planning

- Reviewed the new full 15-day + 15-day Sequence AB testing package from:
  - `C:/Users/TUF-A15/Downloads/15 day 15 days/TrialLight Testing Plan.docx`
  - `C:/Users/TUF-A15/Downloads/15 day 15 days/Pack_01_Master_Setup_and_Control.docx`
  - `C:/Users/TUF-A15/Downloads/15 day 15 days/Pack_02_Operational_Forms.docx`
  - `C:/Users/TUF-A15/Downloads/15 day 15 days/Pack_03_Patient_Role_Packs.docx`
  - `C:/Users/TUF-A15/Downloads/15 day 15 days/Pack_04_Answer_Key_and_Background_Group.docx`
- Added a deep critique document for return-to-Codex revision:
  - `TRIALLIGHT_TESTING_PLAN_PACKS_DEEP_CRITIQUE.md`
- The critique focuses on:
  - cross-document inconsistencies between the main plan, role packs, answer key, and operational forms
  - design confounds introduced by fixed Sequence AB ordering and non-equivalent role progression across phases
  - current-system mismatches such as dropout-history assumptions and incorrect same-day `late ePRO` wording
  - measurement gaps where the current forms are too coarse for the metrics being claimed
  - background-group realism problems that could make CRC list-noise testing weaker than intended

## 2026-04-09

- Performed a Firebase read-storm static review across the active frontend source trees only:
  - `src/`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/`
- Explicitly did **not** inspect or touch `newest-crc-web/`.
- Added a detailed review document for return-to-Codex debugging:
  - `FIREBASE_READ_STORM_FRONTEND_STATIC_REVIEW.md`
- The review documents:
  - high-confidence read amplification hotspots in CRC web and patient app
  - unbounded `collectionGroup` and list listeners
  - uncapped per-user history subscriptions
  - chatbot client-side fan-out reads
  - WebRTC call-context listener leaks
  - safe replacement query/listener patterns and a recommended fix order

- Applied frontend safety caps and listener cleanup patches across the active CRC web and patient mobile trees to stop likely Firestore read amplification without touching `newest-crc-web/`.
- CRC web hardening changes:
  - capped alert, appointment, protocol-template, incident, patient-roster, CRC-roster, selected-patient vitals, history, and dropout snapshot subscriptions to safe upper bounds
  - replaced the raw global alert listener in `src/pages/CRCHome.jsx` with the capped `subscribeToRecentAlertsGlobal(...)` service path
  - capped the global `epro_submissions` listener in `src/pages/CRCHome.jsx`
  - reduced `GeminiChatbot.jsx` global CRC mode from cross-patient Firestore fan-out to in-memory patient-summary mode
  - disabled expensive global appointment aggregation in CRC chatbot safe mode
  - capped AI chat history reads and capped history clearing to the latest bounded window
  - fixed nested WebRTC `onSnapshot(...)` leaks in `src/context/CallContext.jsx`
- Patient mobile hardening changes:
  - capped alert history, chat message, appointments, ePRO submission, side-effect report, and vitals-history subscriptions
  - capped patient AI chat history reads and reduced per-send context fetch sizes
  - fixed nested WebRTC `onSnapshot(...)` leaks in `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/context/CallContext.web.js`
- Also patched two high-risk legacy/reference screens that still sit inside the scanned source trees:
  - `src/pages/PatientHome.jsx`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/CRCHome.js`
  to avoid listener reattachment and leaked per-patient subscriptions if those screens are opened accidentally.
- Local verification:
  - avoided any Firebase/Firestore access
  - whole-repo `npm run lint` was not useful because it traverses legacy/build output and unrelated folders
  - targeted `npx.cmd eslint ...` over only the patched files completed with **0 errors**
  - one existing non-blocking warning remains in `src/components/GeminiChatbot.jsx` about a missing `useEffect` dependency on `startHybridChat`

- Applied a minimum rollback pass to restore frontend coverage semantics without undoing the read-storm safety fixes.
- Scope of this rollback pass:
  - kept WebRTC listener cleanup, bounded chat history, and other leak-prevention patches
  - did **not** touch `newest-crc-web/`
  - did **not** access Firebase/Firestore
  - did **not** change the dropout backend, publisher, manifest, or feature engineering
- CRC web rollback refinements:
  - changed global CRC patient roster loading from a hard `limit(20)` pattern to a stable expandable roster window in `src/pages/CRCHome.jsx`
  - changed global alerts, ePRO feed, and incident inbox in `src/pages/CRCHome.jsx` to use recent-window sizing controls instead of fixed `20`-row assumptions
  - updated `src/components/PatientList.jsx` to surface loaded-range messaging and a `Load more patients` control
  - updated `src/components/SafetyInboxPanel.jsx` so history/incidents explicitly describe the loaded recent window and can request more recent records instead of implying completeness
  - updated `src/components/EproReviewWorkspace.jsx` so the submitted/overdue area now declares that it is showing a recent operational window and can load more
  - updated `src/pages/HistoryPage.jsx` so it no longer presents `limit(20)` as a full audit archive; it now labels the view as a recent alert window with `Load more recent history`
- Dropout dashboard rollback refinements:
  - updated `src/services/dropoutService.js` so the global snapshot listener now targets only `current` docs and uses a configurable recent-window limit instead of an arbitrary uncapped collectionGroup slice
  - updated `src/components/DropoutRiskPanel.jsx` so metrics and labels are explicitly based on the loaded recent snapshot window, with `Load more recent snapshots` support
  - this rollback pass does **not** change model scoring or dropout probability calculation; it only changes the frontend interpretation of loaded snapshot coverage
- Patient-facing wording refinements:
  - updated `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js` so vitals, ePRO, and appointment cards now explicitly describe themselves as recent/current windows rather than complete all-time history
- CRC chatbot clarification:
  - updated `src/components/GeminiChatbot.jsx` so CRC global mode is explicitly framed as summary-only rather than a full-database assistant, while keeping the safe-mode read protections in place
- Local verification for the rollback pass:
  - targeted `npx.cmd eslint ...` over the newly edited files completed with **0 errors**
  - one pre-existing non-blocking warning remains in `src/components/GeminiChatbot.jsx` about a missing `useEffect` dependency on `startHybridChat`

- Adjusted the minimum rollback defaults so CRC recent-window views now open at **30** items instead of **40**.
- Updated default window sizes and step sizes in:
  - `src/pages/CRCHome.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/pages/HistoryPage.jsx`
  - `src/services/alertService.js`
  - `src/services/dropoutService.js`
- This change does **not** alter backend logic, model scoring, or Firebase access patterns beyond reducing the default initial loaded window size from 40 to 30.
- Local verification:
  - targeted `npx.cmd eslint ...` over the touched files completed with **0 errors**

- Reworked the CRC rollback controls from no-op `Load more` buttons into explicit pagination controls with page-size selection.
- Pagination contract now uses `10 / 20 / 30 / 50 / 100` page-size options plus `Prev / Next` across the affected CRC views.
- Implemented this pagination contract in:
  - `src/components/WindowPaginationControls.jsx` (new shared control)
  - `src/components/PatientList.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/components/SafetyInboxPanel.jsx`
  - `src/components/EproReviewWorkspace.jsx`
  - `src/pages/HistoryPage.jsx`
  - `src/pages/CRCHome.jsx`
- Corrected the no-op roster/inbox/feed behavior by changing the query-window strategy:
  - Firestore recent-window queries now overfetch by **one extra row** (`page * pageSize + 1`) so the UI can tell whether a real next page exists
  - this fixes cases like “21 patients fully visible but the UI still keeps showing `Load more`”
- Dropout dashboard stability fix:
  - stopped relying on the previous global collectionGroup current-snapshot query for the dashboard list
  - `src/components/DropoutRiskPanel.jsx` now reads current dropout snapshot docs per loaded patient window instead, which removes the blank-screen risk introduced by the stricter previous query
  - this does **not** change dropout scoring logic; it only changes how the CRC page reads and paginates current snapshot documents
- ePRO local preview resilience:
  - `src/services/eproReviewService.js` now turns raw network `Failed to fetch` errors into a clearer CRC-local-preview message instead of surfacing the browser fetch error directly
  - this does **not** fabricate missing review data; it only improves the local error message when the review service is unreachable
- Alert history subscription refinement:
  - `src/services/alertService.js` now accepts a configurable bounded history window for patient-specific alert history as well, so Safety Inbox history paging is no longer hard-capped at the old fixed value
- Local verification:
  - targeted `npx.cmd eslint ...` over the edited CRC files completed with **0 errors**
  - `npm.cmd run build:crc` completed successfully after a sandbox-related `esbuild` spawn restriction was bypassed with explicit local build approval

- Reworked CRC dashboard summaries so they no longer depend on the currently loaded page window.
- Full-summary wiring completed for:
  - patient roster totals via `src/services/crcSummaryService.js` + `getCountFromServer`
  - Safety Inbox counters via `src/services/crcSummaryService.js` + `fetchIncidentSummary(...)`
  - alert/history counters via `src/services/crcSummaryService.js` + `fetchAlertHistorySummary(...)`
  - dropout summary cards via a dedicated Firestore summary doc read from `dashboard_summaries/dropout_current`
- Frontend summary integration changes:
  - `src/pages/CRCHome.jsx` now loads independent roster / alert / incident aggregate summaries and uses them for overview cards and loaded-window notes
  - `src/components/SafetyInboxPanel.jsx` now uses passed full summary counts for tab badges and top counters instead of only the currently loaded rows
  - `src/pages/HistoryPage.jsx` now uses a full alert-history summary for its queue snapshot and header count while keeping the list itself paginated
  - `src/components/DropoutRiskPanel.jsx` now separates:
    - full published dashboard summary cards
    - paginated current-snapshot patient list
- Dropout backend publishing contract:
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` now builds and writes a dedicated dashboard summary payload to:
    - `dashboard_summaries/dropout_current`
  - the same dry-run preview output now includes `dashboard_summary`
- ePRO local preview support:
  - added local preview origins (`localhost` / `127.0.0.1` on ports `4175`, `4176`, plus matching `5173` and `8081`) to `supabase/functions/_shared/cors.ts`
  - this is a code-only fix for local CRC preview CORS support; the deployed Edge Functions still need redeploy before local preview can actually reach the service
  - improved `src/services/eproReviewService.js` network error messaging so local preview failures explicitly point at the missing deployed allowlist support
- Local verification for this pass:
  - targeted `npx.cmd eslint "src/pages/CRCHome.jsx" "src/components/DropoutRiskPanel.jsx" "src/components/SafetyInboxPanel.jsx" "src/pages/HistoryPage.jsx" "src/services/crcSummaryService.js" "src/services/eproReviewService.js"` completed with **0 errors**
  - `py_compile` passed for `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  - `npm.cmd run build:crc` completed successfully
  - build still reports the existing non-blocking large bundle warning only

- Fixed the `TrialLight Dropout Precompute` GitHub Actions workflow path and runtime hygiene:
  - upgraded `actions/checkout` from `v4` to `v5`
  - upgraded `actions/setup-python` from `v5` to `v6`
  - added explicit workspace file verification for:
    - `Patient-Dropout-Prediction/requirements.txt`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  - switched dependency install and Python runs to explicit `python -m pip ...` / `python "./Patient-Dropout-Prediction/src/publish_dropout_snapshots.py" ...` invocation style
  - added read-only workflow permissions block
- This CI fix targets the reported failure:
  - `Could not open requirements file: Patient-Dropout-Prediction/requirements.txt`
  - and reduces the risk of future action-runtime drift from the Node 20 deprecation warning
- Remote ePRO deployment:
  - redeployed Supabase Edge Functions after the CORS allowlist update:
    - `epro-review-queue`
    - `epro-review-action`
    - `epro-daily-survey`
    - `epro-submit`
  - deployed against project ref `fygkqituefwldmglijvy`
  - purpose: allow local CRC preview origins (`localhost` / `127.0.0.1` on `4175` and `4176`) to reach the ePRO review service
- Important safety note:
  - did **not** run the live dropout publisher after this change
  - this means no new Firestore-wide dropout scoring pass was triggered by me in this step

- Local live dropout publisher execution attempt:
  - created isolated local virtual environments to avoid the broken global Python environments on this machine:
    - `.venv-dropout312`
    - `.venv-dropout314`
  - `.venv-dropout312` could not be used because the Windows Store Python 3.12 launcher path inside the venv was invalid on this machine
  - `.venv-dropout314` was created successfully and could import:
    - `pandas`
    - `torch`
    - `firebase_admin`
  - live publisher preflight then completed successfully with:
    - `source_mode=live`
    - `official_model_line=Honest v3`
    - valid Firestore service account file
    - valid Supabase URL / service-role key
  - attempted one real live publish using:
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py --source-mode live`
  - result:
    - publisher failed immediately with Firestore `429 Quota exceeded`
    - failure happened during the initial live patient scan / testing-subject sync stage
    - therefore:
      - no successful Firestore mirror refresh occurred
      - no successful Supabase dropout snapshot publish occurred
      - no successful `dashboard_summaries/dropout_current` refresh occurred from this run
  - important interpretation:
    - the publisher path itself is now runnable locally
    - the remaining blocker is current Firestore quota exhaustion, not a local code-path failure

- Patient-side AI side effect guidance resilience:
  - updated `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
  - when Gemini side-effect guidance fails because the upstream model is temporarily unavailable or overloaded:
    - patient chat no longer stops at a raw AI error
    - the app now falls back to deterministic local safety guidance
    - fallback guidance still distinguishes:
      - urgent / serious patterns
      - moderate same-day CRC follow-up patterns
      - milder monitor-and-contact-if-worse patterns
    - fallback mode still attempts to document the symptom through the structured side-effect reporting path
  - added a lightweight retry for temporary Gemini-side failures before entering fallback mode
  - local verification:
    - `npx.cmd eslint "src/components/GeminiChatbot.js"` completed with `0 errors`

- TrialLight x Terry RAG donor merge continuation (code-complete only, no remote cutover executed):
  - kept the old integration plan as the source of truth and continued the merge into the active host repo instead of replacing it with `newest-crc-web/`
  - confirmed the shared storage boundary remains:
    - Firebase for auth and operational runtime docs
    - Supabase for guidance / retrieval / vector-backed schema
  - completed active CRC-side appointment suggestion cutover:
    - `src/services/appointmentService.js` now routes AI appointment suggestion through `suggestAppointmentDateHttp`
    - browser-side protocol PDF parsing for appointment AI is no longer the active CRC path
  - completed active protocol guidance ingestion merge:
    - `src/components/ProtocolManager.jsx` now triggers server-side guidance indexing on upload/update
    - protocol docs now surface guidance indexing status and allow retry
    - protocol delete now performs best-effort guidance chunk cleanup before doc/storage removal
    - existing dropout static-context extraction remains intact
  - completed active CRC guidance host merge:
    - `src/components/GeminiChatbot.jsx` now uses routed server-side guidance / retrieval flow
    - added bounded patient-context fallback reads only for selected or specifically targeted patients
    - retained docked UI shell, recent-window history, and read-storm protections
    - `src/pages/CRCHome.jsx` now passes selected-patient vitals / appointments / alerts / ePRO / incident context into the guidance host
  - completed root Firebase Functions donor merge:
    - root `functions/` is now the single backend package host
    - added `functions/guidanceRuntime.js`
    - upgraded `functions/index.js` to ESM and preserved the existing incident push trigger
    - unified exports now include:
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
  - updated `functions/package.json` to support the merged guidance runtime:
    - set package type to `module`
    - added dependencies for:
      - `@google/generative-ai`
      - `@supabase/supabase-js`
      - `pdfjs-dist`
    - retained existing `firebase-admin`, `firebase-functions`, and `web-push`
  - installed the new root Functions dependencies locally in `functions/` to update the lockfile and validate the merged package
  - added a formal integration/cutover runbook:
    - `TERRY_RAG_INTEGRATION_RUNBOOK.md`
    - covers:
      - current code-complete donor merge status
      - Supabase guidance migration/bootstrap steps
      - Firebase Auth migration preserving UIDs
      - Firestore migration checklist
      - later cutover order
      - explicit note that real remote cutover is still pending
  - local validation for this donor-merge continuation:
    - `npx.cmd eslint "src/components/GeminiChatbot.jsx" "src/components/ProtocolManager.jsx" "src/pages/CRCHome.jsx" "src/services/appointmentService.js"` completed with `0 errors`
    - `node --check "functions/index.js"` passed
    - `node --check "functions/guidanceRuntime.js"` passed
  - important safety note:
    - no real Firebase Auth export/import was executed
    - no Firestore data migration was executed
    - no Firebase Functions deploy was executed in this continuation step
    - no Supabase migration apply / bootstrap indexing was executed in this continuation step

- TrialLight x Terry RAG follow-on cutover scaffolding:
  - continued the unfinished Terry integration plan after the previous interruption
  - verified local Firebase CLI access:
    - current local CLI account can access Terry target project `traillight-4750b`
  - verified the local legacy Firebase service account still points to:
    - `idp-authentication-7e8d7`
  - added reusable active-repo guidance text utilities:
    - `src/services/guidanceTextUtils.js`
  - added a Supabase-first CTCAE bootstrap script so guidance indexing can be rebuilt from the active repo instead of relying on donor-only files:
    - `scripts/guidance/upload-ctcae-and-index.mjs`
    - root shortcut:
      - `npm run guidance:bootstrap:ctcae`
  - added a Firestore migration scaffold for later Terry cutover work:
    - `functions/scripts/migrate-firestore-operational-data.mjs`
    - functions shortcut:
      - `npm run migrate:firestore`
    - behavior:
      - default dry-run
      - `--execute` required for real writes
      - preserves document IDs
      - supports `users`, `protocols`, `incident_records`, `alerts`, and `dashboard_summaries`
      - supports nested `users/*` and `alerts/*/messages` migration
  - extended `TERRY_RAG_INTEGRATION_RUNBOOK.md` with:
    - available local helper scripts
    - current blockers
    - explicit note that full deploy/cutover still depends on proper Terry runtime secrets
  - local validation for this scaffolding pass:
    - `node --check "scripts/guidance/upload-ctcae-and-index.mjs"` passed
    - `node --check "functions/scripts/migrate-firestore-operational-data.mjs"` passed
    - `npx.cmd eslint "src/services/guidanceTextUtils.js"` passed
  - current blocker discovered during readiness checks:
    - local `functions/.env` does not yet contain the full Terry guidance runtime secrets, especially:
      - `SILICONFLOW_API_KEY`
      - `SUPABASE_SERVICE_ROLE_KEY`
      - router / retrieval env set
  - important safety note:
    - no Supabase migration was applied in this pass
    - no Terry Firebase Functions deploy was executed in this pass
    - no Auth export/import or Firestore migration was executed in this pass

- Patient disengagement prediction extreme audit hardening:
  - confirmed the previous long-running official audit was mistakenly executed from:
    - `D:\IDP For Integration\.venv-dropout314`
    - that environment had `torch 2.11.0+cpu`, so the Transformer audit path was running on CPU
  - verified the correct CUDA-enabled dropout environment is:
    - `D:\IDP For Integration\Patient-Dropout-Prediction\env`
    - detected:
      - `torch 2.9.1+cu126`
      - `cuda_available=True`
      - device:
        - `NVIDIA GeForce RTX 4060 Laptop GPU`
  - installed `xgboost` into the CUDA-enabled dropout environment so the challenger can run there too
  - updated the shadow challenger to prefer GPU automatically when CUDA is available:
    - `Patient-Dropout-Prediction/src/audit_challenger.py`
  - updated dropout Python requirements to include:
    - `xgboost>=3.2.0`
  - next execution path for the official audit is now:
    - `D:\IDP For Integration\Patient-Dropout-Prediction\env\Scripts\python.exe`
    - with explicit `--device cuda`
  - reran the official extreme audit from the CUDA-enabled dropout environment:
    - `Patient-Dropout-Prediction/env`
    - explicit device:
      - `--device cuda`
    - official audit package written to:
      - `Patient-Dropout-Prediction/audit/official_model_extreme_audit`
  - upgraded the challenger prediction helper to use booster/DMatrix prediction instead of the sklearn `predict_proba(...)` path:
    - goal:
      - reduce the earlier XGBoost device-mismatch warning during GPU-backed challenger runs
  - refreshed the main dropout documentation so it now matches the current frozen official system and extreme audit outputs:
    - `Patient-Dropout-Prediction/README.md`
    - `Patient-Dropout-Prediction/INTERFACES.md`
    - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
    - `Patient-Dropout-Prediction/EVIDENCE_PACK.md`
  - added a report-grade figure generator:
    - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
  - added a structured figure manifest:
    - `Patient-Dropout-Prediction/report_figures/patient_dropout/figure_manifest.md`
  - generated the current report figure package:
    - output root:
      - `Patient-Dropout-Prediction/report_figures/patient_dropout`
    - current figure count:
      - `16`
    - current figure set includes:
      - label prevalence
      - split summary
      - window schematic
      - event-day histogram
      - ROC curve
      - PR curve
      - confusion matrix
      - metrics summary
      - threshold sweep
      - calibration plus score distribution
      - Transformer vs challenger comparison
      - trajectory examples
      - side-effect dependency
      - TreeSHAP global bar chart
      - counterfactual examples
      - challenger seed stability
  - updated the official audit runner so that non-skip runs now call the figure generator instead of only writing a placeholder summary:
    - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
  - local validation for this pass:
    - `py_compile` passed for:
      - `Patient-Dropout-Prediction/src/audit_challenger.py`
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
      - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
    - figure generator completed successfully and rewrote the report figure package
  - final end-to-end rerun completed from the CUDA-enabled dropout environment:
    - command path:
      - `Patient-Dropout-Prediction/env/Scripts/python.exe`
    - audit entrypoint:
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
    - run mode:
      - `--refresh_dataset_reports --device cuda`
      - figures enabled
    - outputs refreshed successfully:
      - `Patient-Dropout-Prediction/audit/official_model_extreme_audit`candidate_027 
      - `Patient-Dropout-Prediction/report_figures/patient_dropout`
    - result:
    - official audit package regenerated
      - report figures regenerated
      - no XGBoost device-mismatch warning appeared in the final rerun output

- Patient disengagement prediction candidate-search acceleration and promotion checks:
  - hardened the candidate-search entrypoint so CUDA requests fail early instead of silently downgrading:
    - `Patient-Dropout-Prediction/src/run_candidate_search.py`
  - extended candidate-search config/runtime controls:
    - added explicit `--eval_batch_size`
    - added explicit `--num_workers`
    - default search worker count is now `2` on this machine
  - upgraded the training runtime for faster GPU feeding:
    - `WindowArrayDataset` now keeps prebuilt tensors instead of converting NumPy arrays inside `__getitem__`
    - GPU transfers now use `non_blocking=True` when pinned memory is enabled
    - train/validation/test loaders now all use the same bounded worker/pin-memory path
  - added training-throughput observability:
    - per-batch `running_samples_per_second`
    - per-epoch `train_loop_seconds`
    - per-epoch `validation_seconds`
    - per-epoch `epoch_seconds`
  - added a local throughput probe:
    - `Patient-Dropout-Prediction/src/benchmark_training_throughput.py`
  - measured loader throughput on the CUDA environment:
    - `num_workers=0` -> about `14949.8 samples/sec`
    - `num_workers=1` -> about `17392.6 samples/sec`
    - `num_workers=2` -> about `19659.8 samples/sec`
  - discovered the real epoch-time bottleneck was not CUDA fallback and not per-epoch calibration:
    - the old threshold-search utilities in `Patient-Dropout-Prediction/src/quality_utils.py` were effectively doing repeated full-array scans across thousands of candidate thresholds
    - this made validation dominate wall-clock time even when the GPU training loop was already fast
  - replaced the old threshold-search path with a vectorized threshold-curve implementation in:
    - `Patient-Dropout-Prediction/src/quality_utils.py`
  - also reduced evaluation overhead in:
    - `Patient-Dropout-Prediction/src/train.py`
    - evaluation now collects batch arrays and concatenates once instead of extending Python lists value-by-value
  - observed runtime impact after the threshold-search rewrite:
    - validation time dropped from roughly tens of minutes per epoch on the earlier interrupted run to about `0.9s - 1.4s` per epoch on the new CUDA candidate runs with `eval_batch_size=2048`
  - confirmed and finalized the previously interrupted `candidate_023` run:
    - trial split final metrics:
      - `pr_auc = 0.6349835540049881`
      - `p_at_r80 = 0.47372084928646013`
      - `brier = 0.02803468331694603`
      - `best_epoch = 8`
  - ran additional CUDA candidate-search passes under:
    - `Patient-Dropout-Prediction/runs/cs_r3/`
  - completed `candidate_051`:
    - trial split final metrics:
      - `pr_auc = 0.6286444120210056`
      - `p_at_r80 = 0.47211864590644836`
      - `brier = 0.028235578909516335`
      - `best_epoch = 7`
  - completed `candidate_055`:
    - trial split final metrics:
      - `pr_auc = 0.635723709149364`
      - `p_at_r80 = 0.4732678532600403`
      - `brier = 0.028000595048069954`
      - `best_epoch = 8`
  - completed `candidate_059`:
    - trial split final metrics:
      - `pr_auc = 0.6330567699826282`
      - `p_at_r80 = 0.4735560119152069`
      - `brier = 0.028034035116434097`
      - `best_epoch = 7`
  - completed `candidate_063`:
    - trial split final metrics:
      - `pr_auc = 0.6364926167756876`
      - `p_at_r80 = 0.4776695668697357`
      - `brier = 0.027835262939333916`
      - `best_epoch = 8`
  - current candidate ranking status:
    - `candidate_063` is now the best observed trial-split candidate across all three main metrics:
      - highest `pr_auc`
      - highest `p_at_r80`
      - lowest `brier`
  - ran a stricter patient-split reference validation for `candidate_063` under:
    - `Patient-Dropout-Prediction/runs/promotion_checks/candidate_063_patient_ref/`
  - `candidate_063` patient-split reference result:
    - `pr_auc = 0.6116755599990669`
    - `p_at_r80 = 0.4712558090686798`
    - `brier = 0.02963775023818016`
    - `best_epoch = 6`
  - patient-split interpretation:
    - `candidate_063` still beats the frozen official patient-split reference on the main ranking metrics, so the gain is not confined to trial-split only
  - found a TensorBoard tail-end stability bug:
    - training could succeed and write `training_summary.json`, but `writer.add_hparams(...)` could still crash the process on Windows/Python 3.14 when TensorBoard tried to open a nested event file path
  - hardened that path in:
    - `Patient-Dropout-Prediction/src/train.py`
    - training now writes a stable `tensorboard_hparams.json`
    - TensorBoard hparams logging is now best-effort and no longer allowed to mark a completed training run as failed
  - verified the final TensorBoard tail-end fix with a fresh 1-epoch CUDA smoke run under:
    - `Patient-Dropout-Prediction/runs/smoke_checks/tensorboard_hparams_guard/`
  - smoke verification result:
    - training completed successfully
    - no async TensorBoard stack trace appeared after completion
    - the run logged:
      - `TensorBoard hparams event logging skipped on Windows; wrote tensorboard_hparams.json instead`
  - resumed the remaining untested `d_model=160` / `focal` candidate set in `cs_r3`
  - completed `candidate_024`:
    - trial split final metrics:
      - `pr_auc = 0.6370487693141496`
      - `p_at_r80 = 0.4764572083950043`
      - `brier = 0.027922669425606728`
      - `best_epoch = 10`
  - completed `candidate_028`:
    - trial split final metrics:
      - `pr_auc = 0.6335499860648979`
      - `p_at_r80 = 0.4743165671825409`
      - `brier = 0.02799743227660656`
      - `best_epoch = 8`
  - completed `candidate_031`:
    - trial split final metrics:
      - `pr_auc = 0.6306586240993716`
      - `p_at_r80 = 0.4729800224304199`
      - `brier = 0.02807207591831684`
      - `best_epoch = 8`
  - completed `candidate_032`:
    - trial split final metrics:
      - `pr_auc = 0.625231665452409`
      - `p_at_r80 = 0.4730902910232544`
      - `brier = 0.028201062232255936`
      - `best_epoch = 7`
  - completed `candidate_052`:
    - trial split final metrics:
      - `pr_auc = 0.6266125679077555`
      - `p_at_r80 = 0.46915918588638306`
      - `brier = 0.02829384244978428`
      - `best_epoch = 7`
  - completed `candidate_056`:
    - trial split final metrics:
      - `pr_auc = 0.636401802320226`
      - `p_at_r80 = 0.4764572083950043`
      - `brier = 0.027988992631435394`
      - `best_epoch = 10`
  - completed `candidate_060`:
    - trial split final metrics:
      - `pr_auc = 0.6245074162432255`
      - `p_at_r80 = 0.47343710064888`
      - `brier = 0.028238127008080482`
      - `best_epoch = 7`
  - completed `candidate_064`:
    - trial split final metrics:
      - `pr_auc = 0.6358089559561889`
      - `p_at_r80 = 0.47792115807533264`
      - `brier = 0.027846096083521843`
      - `best_epoch = 8`
  - ranking interpretation after the expanded focal-160 sweep:
    - `candidate_024` is now best on trial `pr_auc`
    - `candidate_064` is now best on trial `p_at_r80`
    - `candidate_063` remains best on trial `brier`
    - the current promotion decision therefore requires a stricter cross-split comparison rather than a single-metric pick
  - ran patient-split reference validations for the new top trial candidates:
    - `Patient-Dropout-Prediction/runs/promotion_checks/candidate_024_patient_ref/`
    - `Patient-Dropout-Prediction/runs/promotion_checks/candidate_064_patient_ref/`
  - `candidate_024` patient-split reference result:
    - `pr_auc = 0.6159468068634809`
    - `p_at_r80 = 0.471280574798584`
    - `brier = 0.029501639306545258`
    - `best_epoch = 9`
  - `candidate_064` patient-split reference result:
    - `pr_auc = 0.613818993572208`
    - `p_at_r80 = 0.46530279517173767`
    - `brier = 0.0296112522482872`
    - `best_epoch = 6`
  - cross-split promotion interpretation:
    - `candidate_024` currently looks like the strongest promotion candidate overall because it leads trial `pr_auc` and also has the best patient-split `pr_auc` among the current leading trio (`024 / 063 / 064`)
    - `candidate_064` is the strongest pure recall-first trial candidate but weakens on patient-split reference compared with `024` and `063`
    - `candidate_063` remains the most calibration-friendly of the three on trial `brier`
  - extended the audit runner so it no longer only supports the frozen official run dirs:
    - `Patient-Dropout-Prediction/src/run_official_model_audit.py` now accepts:
      - `--trial_run_dir`
      - `--patient_run_dir`
      - `--model_line`
    - this enables running the full extreme audit package directly against a promotion candidate such as `candidate_024`
  - reviewed the first interrupted `candidate_024` extreme audit attempt after a user-side interruption:
    - the run itself did not prove a model bug
    - the main confirmed engineering issues were in the audit path, not the trained candidate
  - hardened the candidate audit runtime in:
    - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
  - audit runtime hardening changes:
    - candidate audits now reuse a shared raw dataset cache across trial/patient contexts instead of loading duplicate raw DataFrames into memory
    - Transformer evaluation now uses:
      - configurable `--num_workers`
      - `pin_memory=True` on CUDA
      - `non_blocking=True` device transfers
    - candidate audits now support bounded explanation/stress sampling via:
      - `--shap_sample_size`
      - `--stress_sample_size`
    - SHAP / subgroup-SHAP / SHAP-stability no longer need to materialize full-test-set explanation tensors by default
    - missingness stress can now run on a bounded sampled audit pack instead of repeatedly deep-copying the full test frame
    - `_anchor_context_frame(...)` now prefilters raw rows by relevant patient/trial/day keys before copying audit context columns, so candidate audits no longer deep-copy the full raw dataset just to enrich the held-out anchor rows
    - SHAP sampling now preserves all available positive windows before sampling negatives, which is better aligned with low-prevalence dropout explanation analysis than plain proportional sampling
    - missingness stress no longer deep-copies the entire sampled challenger frame per stress level; it now reuses a shallow frame view and only materializes replacement arrays for the dynamically blanked source columns
    - `run_official_model_audit.py` now emits step-level terminal logs and prints full traceback on failure, so long-running candidate audits are no longer opaque when they stall or terminate early
    - fixed a sampled-SHAP counterfactual indexing bug in the audit runner: counterfactual case generation now uses the sampled SHAP reference pack/frame explicitly instead of mixing sampled SHAP tensors with full-test-frame row indices
  - audit honesty safeguards kept in place:
    - full held-out Transformer/XGBoost metrics are still computed on the full test split
    - only the heavier explanation/stress layers are sampled
    - the sampled row counts are now written into the audit markdown so the report does not pretend those sections were full-population explanations
  - reran the full `candidate_024` extreme audit successfully after the runtime/memory/indexing fixes:
    - audit output:
      - `Patient-Dropout-Prediction/audit/candidate_024_extreme_audit_rerun_20260412_e/`
    - figure package:
      - `Patient-Dropout-Prediction/report_figures/patient_dropout_candidate_024_rerun_20260412_e/`
    - runtime:
      - completed end-to-end in about `21.7 minutes` with `--device cuda --batch_size 512 --num_workers 0`
    - key audited Transformer metrics remained aligned with the candidate training summaries:
      - trial:
        - `pr_auc = 0.637048654839693`
        - `p_at_r80 = 0.4764572083950043`
        - `brier = 0.027922671288251877`
      - patient reference:
        - `pr_auc = 0.6159469226096889`
        - `p_at_r80 = 0.471280574798584`
        - `brier = 0.029501641169190407`
    - the audit now completes all of:
      - subgroup audit
      - explainability audit
      - counterfactual audit
      - robustness audit
      - SHAP stability audit
      - calibration stability audit
      - report figure generation
  - reran the full `candidate_064` extreme audit successfully with the same hardened audit runner:
    - audit output:
      - `Patient-Dropout-Prediction/audit/candidate_064_extreme_audit_rerun_20260413_a/`
    - figure package:
      - `Patient-Dropout-Prediction/report_figures/patient_dropout_candidate_064_rerun_20260413_a/`
    - runtime:
      - completed end-to-end in about `21.5 minutes` with `--device cuda --batch_size 512 --num_workers 0`
    - key audited Transformer metrics:
      - trial:
        - `pr_auc = 0.635808838542744`
        - `p_at_r80 = 0.47792115807533264`
        - `brier = 0.027846097946166992`
      - patient reference:
        - `pr_auc = 0.613818877275259`
        - `p_at_r80 = 0.46530279517173767`
        - `brier = 0.0296112522482872`
  - completed a direct promotion comparison across:
    - `Honest v3`
    - `Candidate 024`
    - `Candidate 064`
  - promotion comparison artifact:
    - `Patient-Dropout-Prediction/audit/promotion_comparison_20260413.md`
  - current promotion recommendation:
    - `Candidate 024` should replace `Honest v3` as the leading official promotion candidate because it is the strongest balanced cross-split candidate
    - `Candidate 064` should be retained as the strongest recall-first alternate candidate, but not as the main replacement line
  - formally switched the dropout truth-source defaults from `Honest v3` to `Candidate 024` for the current pre-testing official line:
    - updated script defaults:
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
      - `Patient-Dropout-Prediction/src/run_candidate_search.py`
      - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
    - updated truth-source documents:
      - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
      - `Patient-Dropout-Prediction/README.md`
      - `Patient-Dropout-Prediction/EVIDENCE_PACK.md`
      - `Patient-Dropout-Prediction/CANDIDATE_PROMOTION_POLICY.md`
      - `Patient-Dropout-Prediction/DEPLOY_READINESS.md`
    - created the new official audit alias package:
      - `Patient-Dropout-Prediction/audit/official_candidate_024_extreme_audit/`
      - copied from:
        - `Patient-Dropout-Prediction/audit/candidate_024_extreme_audit_rerun_20260412_e/`
    - generated the new official report figure package:
      - `Patient-Dropout-Prediction/report_figures/patient_dropout_official_candidate_024/`
    - important scope note:
      - this change promotes `Candidate 024` as the current official truth source for audit/reporting and default tooling
      - it does **not** silently claim that live deploy bundles were already repackaged away from the archived `Honest v3` rollback assets
  - verified after the switch:
    - `py_compile` passes for:
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
      - `Patient-Dropout-Prediction/src/run_candidate_search.py`
      - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
    - new figure manifest generated successfully under:
      - `Patient-Dropout-Prediction/report_figures/patient_dropout_official_candidate_024/figure_manifest.md`
  - fixed local CRC/patient website boot failures caused by missing Firebase web env values:
    - root CRC local env file `D:\IDP For Integration\.env.local` was missing all required `VITE_FIREBASE_*` keys
    - patient app local env file `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env` was missing all required `EXPO_PUBLIC_FIREBASE_*` keys
    - recovered the active `traillight-4750b` web app SDK config from Firebase CLI and restored:
      - API key
      - auth domain
      - project ID
      - storage bucket
      - messaging sender ID
      - app ID
      - measurement ID
  - verification after env repair:
    - CRC web production build succeeded again with the restored Firebase env:
      - `npm run build:crc`
    - patient web static export succeeded and Expo confirmed the Firebase env block is now loaded:
      - `npm --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web`
    - remaining local-user action:
      - restart any old CRC `vite preview` or patient `expo web` process so the running site picks up the corrected env files
  - applied a local demo-only rollback from Terry Firebase back to the legacy Firebase project `idp-authentication-7e8d7`:
    - updated local-only files:
      - `D:\IDP For Integration\.env.local`
      - `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env`
    - restored legacy web SDK values:
      - `apiKey = AIzaSyBafCJ2iGZ-hYVpwHE_rubGDdOwhlqbkoQ`
      - `authDomain = idp-authentication-7e8d7.firebaseapp.com`
      - `projectId = idp-authentication-7e8d7`
      - `storageBucket = idp-authentication-7e8d7.firebasestorage.app`
      - `messagingSenderId = 858114692646`
      - `appId = 1:858114692646:web:027f8d324fd693830578e7`
      - `measurementId = G-7M5S7QN2TM`
    - scope note:
      - this rollback is local/demo-only
      - it does not change `.env.example`
      - it does not change `.firebaserc`
      - it does not change the long-term migration target `traillight-4750b`
  - verified after the local demo rollback:
    - CRC web build still succeeds:
      - `npm run build:crc`
    - patient web export still succeeds and reads the restored legacy Firebase env block:
      - `npm --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web`
  - fixed a CRC Side Effect Guidance panel render crash in the demo rollback path:
    - file:
      - `D:\IDP For Integration\src\components\GeminiChatbot.jsx`
    - root cause:
      - `initializeGuidance` was referenced inside `useEffect` dependency evaluation before the callback was initialized
      - this can crash the docked guidance panel at render time and present as a blank workspace
    - fix:
      - moved `saveMessage` and `initializeGuidance` above the `useEffect` blocks that depend on them
  - hardened the CRC guidance flow for legacy-Firebase demo mode:
    - file:
      - `D:\IDP For Integration\src\services\guidanceRouterService.js`
    - problem:
      - the routed retrieval path depends on newer guidance HTTP functions
      - the legacy Firebase project used for the professor demo may not have those functions deployed
    - fix:
      - retrieval now falls back to a no-retrieval prompt instead of aborting the whole guidance request
      - this keeps the Gemini browser guidance path usable even if retrieval/router infrastructure is unavailable
  - verification after the guidance fixes:
    - CRC production build succeeds again:
      - `npm run build:crc`
  - reverted the local demo-only Firebase rollback and restored the working tree back to Terry Firebase `traillight-4750b`:
    - updated local-only files:
      - `D:\IDP For Integration\.env.local`
      - `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env`
    - restored Terry web SDK values:
      - `projectId = traillight-4750b`
      - `authDomain = traillight-4750b.firebaseapp.com`
      - `storageBucket = traillight-4750b.firebasestorage.app`
      - `messagingSenderId = 793680079698`
      - `appId = 1:793680079698:web:562cb6043570196222a88b`
      - `measurementId = G-5J5ZLP3ENX`
    - scope note:
      - this only restores the local env back to the current migration target
      - it still does not change `.env.example`
      - it still does not change `.firebaserc`
  - verification after restoring Terry Firebase env locally:
    - CRC web build succeeds:
      - `npm run build:crc`
    - patient web export succeeds and Expo reads the restored Terry Firebase env block:
      - `npm --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web`
  - completed the next patient disengagement prediction hardening pass to align runtime, deploy assets, demo artifacts, and human-facing docs around `Candidate 024`:
    - repackaged the local default deploy bundle for the current official line:
      - created `Patient-Dropout-Prediction/deploy_assets/checkpoints_candidate_024/`
      - copied the promoted `Candidate 024` checkpoint and artifact bundle into that packaged location
      - updated:
        - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest.json`
        - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_candidate_024.json`
        - `Patient-Dropout-Prediction/src/module_service.py`
    - scope note:
      - the local default manifest now resolves to `Candidate 024`
      - `Honest v3` remains archived as the rollback baseline
      - this still does **not** claim that a real remote publish has happened
  - unified key disengagement truth-source docs and runtime guidance away from stale `Honest v3` wording:
    - updated:
      - `Patient-Dropout-Prediction/DEPLOYMENT.md`
      - `Patient-Dropout-Prediction/TESTING_START_RUNBOOK.md`
      - `Patient-Dropout-Prediction/EVIDENCE_PACK.md`
      - `Patient-Dropout-Prediction/RUNTIME.md`
      - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`
      - `Patient-Dropout-Prediction/DEPLOY_READINESS.md`
      - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
      - `Patient-Dropout-Prediction/FULL_HISTORY_AND_STATUS_REPORT.md`
    - wording rule now made explicit:
      - use `disengagement prediction` in human-facing docs
      - keep legacy `dropout_*` contract fields and `/dropout-risk/*` routes where compatibility matters
  - refreshed the official demo-scenario tooling for the current official line:
    - updated:
      - `Patient-Dropout-Prediction/src/build_demo_scenario_pack.py`
    - improvements:
      - default JSON output now targets `deploy_assets/demo_scenario_pack_candidate_024.json`
      - markdown now labels the score as `Disengagement probability (contract field: dropout_probability)`
      - manual medium-risk boundary scenario was re-tuned for the current `Candidate 024` thresholds so demo-pack generation no longer fails under the promoted line
    - regenerated artifacts:
      - `Patient-Dropout-Prediction/deploy_assets/demo_scenario_pack_candidate_024.json`
      - `Patient-Dropout-Prediction/DEMO_SCENARIO_PACK.md`
  - cleaned remaining human-facing script wording for the disengagement rename without breaking compatibility:
    - updated:
      - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
      - `Patient-Dropout-Prediction/src/http_service.py`
      - `Patient-Dropout-Prediction/src/risk_engine_inference.py`
      - `Patient-Dropout-Prediction/src/risk_engine_batch_inference.py`
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
      - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
    - also updated current official audit summaries:
      - `Patient-Dropout-Prediction/audit/official_candidate_024_extreme_audit/official_model_audit_summary.json`
      - `Patient-Dropout-Prediction/audit/official_candidate_024_extreme_audit/report_ready_summary.json`
  - made the protocol static-context QA blocker precise instead of generic:
    - updated:
      - `Patient-Dropout-Prediction/PROTOCOL_STATIC_CONTEXT_QA_STATUS.md`
    - clarified blocker:
      - local workspace only has the legacy Firebase service account for `idp-authentication-7e8d7`
      - executing the real 25-protocol QA export for the current target now explicitly requires a `traillight-4750b` service account JSON passed through `FIREBASE_SERVICE_ACCOUNT_JSON`
  - verification after this hardening pass:
    - `py_compile` passes for:
      - `Patient-Dropout-Prediction/src/run_official_model_audit.py`
      - `Patient-Dropout-Prediction/src/build_demo_scenario_pack.py`
      - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
      - `Patient-Dropout-Prediction/src/http_service.py`
      - `Patient-Dropout-Prediction/src/risk_engine_inference.py`
      - `Patient-Dropout-Prediction/src/risk_engine_batch_inference.py`
      - `Patient-Dropout-Prediction/report_figures/patient_dropout/generate_report_figures.py`
    - official demo pack regeneration succeeded:
      - `Patient-Dropout-Prediction/deploy_assets/demo_scenario_pack_candidate_024.json`
      - `Patient-Dropout-Prediction/DEMO_SCENARIO_PACK.md`
2026-04-15
- Git sync and GitHub push alignment:
  - pushed `Patient-Dropout-Prediction` branch `codex/candidate-024-disengagement-hardening` to:
    - `https://github.com/yisheng10/Patient-Dropout-Prediction.git`
  - created and pushed patient app branch `codex/patient-app-sync-20260415` to:
    - `https://github.com/yisheng10/IDP_PatientApp.git`
  - added the patient app submodule mapping to root `.gitmodules`:
    - path: `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2`
    - url: `https://github.com/yisheng10/IDP_PatientApp.git`
  - root integration branch remains:
    - `codex/root-integration-sync-20260415`
  - patient app gitlink now points to:
    - `bf08a64204dd731d77c30c5ad02fffa704dc5cd7`

## 2026-04-28 - Patient app login/ePRO triage

- Investigated current patient-side failures reported as:
  - patient login not working
  - ePRO questionnaire not opening
- Confirmed a concrete Firebase project mismatch in the Supabase ePRO runtime:
  - `supabase/functions/_shared/firebaseAuth.ts`
  - `supabase/functions/_shared/firestorePromptContext.ts`
- Fixed both shared helpers so the default Firebase project fallback now matches the current patient app target:
  - from `idp-authentication-7e8d7`
  - to `traillight-4750b`
- Rationale:
  - the patient app is currently configured against `traillight-4750b`
  - the ePRO Edge runtime was still validating Firebase bearer tokens and defaulting Firestore mirror reads/writes against the legacy project
  - this mismatch could block questionnaire load/submit even when the patient app itself booted correctly
- Follow-up note:
  - if existing legacy patient accounts still cannot log in after this fix, that is likely an Auth/data migration gap rather than a front-end code bug

## 2026-05-01 / 2026-05-02 - Patient login and ePRO recovery continuation

- Continued low-read diagnostics and remote recovery work for the patient-side login / ePRO failures.
- Confirmed with Firebase Auth-only diagnostics that the main patient login blocker is an incomplete Auth migration:
  - old Firebase project `idp-authentication-7e8d7` currently has `24` Auth users
  - Terry Firebase project `traillight-4750b` currently has `5` Auth users
  - at least `22` legacy login emails are still missing from the Terry project
- Important scope note:
  - these diagnostics used Firebase Auth APIs only
  - they did **not** require a Firestore collection scan
  - they were intentionally chosen to avoid consuming the project's Firestore read quota
- Completed the remote ePRO edge-function recovery step using the supplied Supabase access token:
  - deployed:
    - `supabase/functions/epro-daily-survey`
    - `supabase/functions/epro-submit`
  - project ref:
    - `fygkqituefwldmglijvy`
  - result:
    - the patient questionnaire endpoints now run with the updated Terry Firebase project fallback in:
      - `supabase/functions/_shared/firebaseAuth.ts`
      - `supabase/functions/_shared/firestorePromptContext.ts`
- Continued password-preserving migration investigation for legacy patient logins:
  - exported legacy Auth accounts locally into a gitignored `.firebase/` working file
  - confirmed the legacy project returns `passwordHash` fields only as redacted placeholders with the current service account access
  - confirmed the currently accessible project config does not expose usable hash parameters for import
- Current blocker after this pass:
  - legacy patient accounts can be enumerated safely
  - but the available credentials still do **not** expose the real password hash material or hash config needed for a safe password-preserving Firebase Auth import
  - because of that, a full old-password-preserving Auth migration has **not** been executed yet

## 2026-05-02 - Patient auth reset migration fallback preparation

- Prepared a real fallback path for legacy patient login recovery when old-password-preserving Firebase Auth import is not available.
- Added a new functions-side migration helper:
  - `functions/scripts/backfill-patient-auth-reset.mjs`
- Added a matching functions script entry:
  - `npm run backfill:patient-auth-reset`
- Added a dedicated runbook:
  - `PATIENT_AUTH_RESET_MIGRATION_RUNBOOK.md`
- The fallback migration is intentionally designed to preserve the same Firebase `uid` while switching patients onto a password reset flow:
  - create missing Terry Firebase Auth users with the legacy UID
  - keep patient Firestore data under `users/{uid}`
  - generate reset links instead of attempting to preserve the old password hash
- Safety / quota notes captured in the fallback tooling:
  - default mode is dry-run only
  - default dry-run avoids full Firestore scans
  - optional deeper inspection of patient subcollections is explicit rather than automatic
- Added explicit manual-review tagging inside the fallback migration plan for:
  - legacy Auth users that no longer have a source `users/{uid}` profile document
  - legacy patient profiles that still lack a `subject_id`
- Added `--clean-only` support to the fallback migration helper so the first real execution can safely target only the automatically clean subset.
- Added `--no-continue-url` support so password reset links can still be generated when the preferred continue URL domain is not allowlisted in Firebase Auth.
- This keeps the next execution step deliberate:
  - dry-run first
  - then explicit dangerous flags for Auth writes, Firestore copy, and reset-link generation

## 2026-05-02 - Clean patient auth reset migration executed

- Executed the UID-preserving fallback migration for the automatically clean patient subset against `traillight-4750b`.
- Real remote execution results:
  - created `16` missing Terry Firebase Auth users with the same legacy UIDs
  - copied `16` `users/{uid}` profile documents
  - copied `459` nested patient Firestore documents across the selected subcollections
  - generated `16` Firebase-hosted password reset links
- Sensitive local artifacts were written only into ignored `.firebase/` working files:
  - `.firebase/patient-auth-reset-plan.json`
  - `.firebase/patient-password-reset-links.json`
- Added a `--no-continue-url` fallback and used it successfully because the preferred reset continue URL domain was not allowlisted in Firebase Auth.
- Remaining manual-review backlog after the clean execution:
  - `1` email collision against a different Terry UID
  - `1` legacy Auth user with no source `users/{uid}` profile
  - `5` legacy patient profiles that still lack `subject_id`

## 2026-05-02 - Targeted Terry patient deletion tooling

- Added a destructive-but-scoped Firebase cleanup helper for explicit patient UID removal:
  - `functions/scripts/delete-target-patient-users.mjs`
- Added a matching functions script entry:
  - `npm run delete:target-patient-users`
- The helper is intentionally narrow:
  - requires an explicit `--uids=` list
  - dry-run by default
  - separates:
    - recursive Firestore deletion under `users/{uid}`
    - Firebase Auth deletion
- This was added so any approved Terry-side patient cleanup can be executed against a fixed reviewed UID list rather than through ad hoc console actions.

## 2026-05-02 - Reviewed Terry patient deletions confirmed

- Confirmed by direct Terry Firebase status check that the previously reviewed six patient UIDs are no longer present in the Terry target project:
  - Firebase Auth users missing
  - `users/{uid}` profile documents missing
- Important follow-up note:
  - one of those six UIDs was later requested to be kept
  - but the status check confirmed that this UID had already been removed before the scope was narrowed
  - any further recovery for that patient now requires an explicit restore step from the legacy project rather than a selective delete

## 2026-05-02 - Single patient restore after narrowed keep decision

- Restored the requested Terry patient account:
  - UID: `UAWfSS7KZmfY164jm26DwVLOSRN2`
  - email: `jianhongtan73@gmail.com`
- Real remote recovery steps completed:
  - recreated the Terry Firebase Auth user with the original legacy UID
  - restored the Terry `users/{uid}` profile document from the legacy project
  - generated a Firebase-hosted password reset link without a custom continue URL
- Local ignored working artifacts for this restore:
  - `.firebase/restore-uaw-plan.json`
  - `.firebase/restore-uaw-reset-link.json`
- Also fixed the fallback reset-link helper so the `--no-continue-url` path now calls the Admin SDK without passing an invalid empty ActionCodeSettings payload.

## 2026-05-02 - Patient login forgot-password support

- Added a patient-side `Forgot password?` action to the active login screen:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
- Scope:
  - patient login only
  - not shown during patient registration
  - not shown for CRC login
- Behavior:
  - sends a Firebase Auth password reset email for the entered patient email
  - blocks obvious CRC `@hospital.com` misuse from the patient surface
  - surfaces clearer reset-specific error messages for invalid email, missing user, rate limit, and network failure
- This gives affected patients a direct self-service reset path from the login UI instead of relying only on manually distributed reset links.

## 2026-05-02 - Clearer CRC and patient login failure prompts

- Refined the active login error copy in both surfaces:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
  - `src/components/Login.jsx`
- Login failures now distinguish:
  - incorrect password
  - no account found for the entered email
  - Firebase generic `auth/invalid-credential` responses, explained in plain language as:
    - email missing from the current Firebase project
    - or incorrect password
- This avoids the previous overly generic “check your email and password” message for CRC and patient sign-in.

## 2026-05-02 - Patient auth backlog re-baselined and collision reconciled

- Re-ran the legacy-vs-Terry patient Auth dry-run after the earlier targeted deletions and single-account restore.
- Current source/target Auth comparison at that point:
  - legacy Auth users: `24`
  - Terry Auth users: `22`
  - remaining missing legacy UIDs in Terry: `6`
  - skipped CRC-style account(s): `1`
- Confirmed that `5` of the remaining missing UIDs were intentionally decommissioned rather than accidentally left pending.
- Added a dedicated reconciliation helper for the single remaining email-collision case:
  - `functions/scripts/reconcile-patient-email-conflict.mjs`
  - `npm run reconcile:patient-email-conflict`
- Executed the reconciliation for:
  - legacy source UID `Q5wxUBAt0hfuyIZW1mbrh3EtJnh1`
  - Terry target UID `43Sa3yF88BXBaucckMdzcmGxpM42`
- Real remote reconciliation result:
  - preserved the existing Terry Auth user
  - merged the legacy patient profile into the Terry `users/{uid}` record
  - copied `22` nested patient docs from the legacy UID path into the Terry UID path
  - restored `subject_id = TL-S00014` onto the Terry-side patient profile
- Added a status document so the patient-account cutover state is explicit:
  - `PATIENT_AUTH_CUTOVER_STATUS.md`

## 2026-05-02 - Root live runtime prepared for Gemini-based cutover

- Re-verified that both local front-end runtimes now point at Terry Firebase:
  - root CRC env `VITE_FIREBASE_PROJECT_ID=traillight-4750b`
  - patient app env `EXPO_PUBLIC_FIREBASE_PROJECT_ID=traillight-4750b`
- Rebuilt both active surfaces successfully via:
  - `npm run build:shareable`
- Filled the local root `functions/.env` to support the current Gemini live path:
  - `SIDE_EFFECT_GUIDANCE_MODEL`
  - `APPOINTMENT_GUIDANCE_MODEL`
  - `GUIDANCE_ROUTER_MODEL`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Full Terry retrieval/indexing remains deferred because `SILICONFLOW_API_KEY` is still not available for this wave.

## 2026-05-02 - Terry live cutover deploy attempt status

- Performed a real remote deploy attempt for the merged root Firebase Functions package against `traillight-4750b`.
- Result:
  - deploy blocked by missing Terry IAM permission `iam.serviceAccounts.ActAs`
  - required runtime service account:
    - `traillight-4750b@appspot.gserviceaccount.com`
- Performed a real remote deploy attempt for Firebase Hosting targets:
  - `hosting:crc`
  - `hosting:patient`
- Result:
  - both local predeploy builds succeeded
  - remote Hosting deploy failed with `403 The caller does not have permission`
- Conclusion:
  - code and local build paths are now ready for the current Gemini-based cutover
  - the remaining blocker for real root Functions / Hosting cutover is Terry project IAM, not local code state

## 2026-05-02 - Protocol static-context cutover blockers refined

- Initial `protocol static-context QA` export against Terry Firebase still returned zero rows.
- Investigated the root cause directly:
  - Terry did not initially have the `protocols` collection migrated
  - migrated the `protocols` collection from the legacy Firebase project into Terry
  - source and target protocol docs were then inspected field-by-field
- Key finding:
  - the blocker is no longer "missing Terry service account"
  - the blocker is now "protocol documents do not yet contain `dropout_static_context`"
- Added a root helper for protocol static-context backfill:
  - `functions/scripts/backfill-protocol-static-context.mjs`
  - `npm run backfill:protocol-static-context`
- Also added a `--fallback-only` mode so protocol PDFs can be processed with local heuristics only, without sending protocol contents to Gemini.
- Current limitation:
  - the external policy denied Gemini-based protocol extraction because that would send protocol PDF text to a third-party model
  - the later fallback-only remote execution was not completed in this session because the elevated command quota was exhausted
- Updated documentation to reflect the real blocker change:
  - `TERRY_RAG_INTEGRATION_RUNBOOK.md`
  - `Patient-Dropout-Prediction/PROTOCOL_STATIC_CONTEXT_QA_STATUS.md`

## 2026-05-03 - Protocol static-context fallback backfill executed on Terry

- Executed the fallback-only protocol static-context backfill against Terry Firebase via:
  - `functions/scripts/backfill-protocol-static-context.mjs`
  - `--fallback-only --execute`
- Real Terry result:
  - `4` protocol docs now contain `dropout_static_context`
  - `1` migrated protocol doc still could not be populated because it has no `storagePath`
- Exported the first real Terry protocol QA sheet:
  - `Patient-Dropout-Prediction/audit/protocol_static_context_qa.csv`
  - current row count: `4`

## 2026-05-03 - Patient static-context backfill executed from official subject registry

- Added a dedicated helper:
  - `functions/scripts/backfill-patient-static-context.mjs`
  - `npm run backfill:patient-static-context`
- Updated the live disengagement adapter so live static context can use direct patient `age` when `dob` is absent:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
- First dry-run showed legacy Firebase did not contain the missing static fields either, so source-copy alone was insufficient.
- Switched the helper to use the official subject registry:
  - `Patient-Dropout-Prediction/deploy_assets/data/triallight_subject_context_registry_v35subjectid.csv`
- Real Terry write result:
  - `17` Terry patient profiles received safe static-context patches
  - patched fields came from the official registry and included:
    - `age`
    - `caregiver`
    - `dist_km`

## 2026-05-03 - Disengagement live dry-run improved but remains blocked

- Re-ran the Terry live disengagement dry-run after the protocol and patient static-context backfills:
  - output preview:
    - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260503_after_static_backfill.json`
- Real result:
  - scanned patient docs: `21`
  - predictions ready: `3`
  - usable static-context count: `5`
  - sufficient live-history count: `3`
  - missing subject_id count: `4`
- This is a real improvement over the earlier zero-score state, but publish gates still fail because:
  - many Terry patients still lack reliable protocol assignment (`protocolId` / `protocolName`)
  - live operational history is still sparse for most Terry patients
- The blocker is therefore no longer "patient static fields are universally missing".
- The current dominant blockers are:
  - patient-to-protocol linkage
  - live history completeness
- Exported a manual remediation list for the remaining protocol-assignment gap:
  - `Patient-Dropout-Prediction/audit/terry_patient_protocol_assignment_gaps_20260503.csv`

## 2026-05-03 - Patient subject assignments synced into TrialLight and live adapter now falls back to the official registry

- Extended the live disengagement adapter so trial-level static context can fall back to the official subject registry when the patient-side protocol doc is missing or incomplete:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
- Added a dedicated TrialLight writeback helper for curated patient subject assignments:
  - `functions/scripts/sync-patient-subject-assignments.mjs`
  - `npm run sync:patient-subject-assignments`
- Ran a dry-run plan against the updated curated CSV:
  - `Patient-Dropout-Prediction/audit/terry_patient_protocol_assignment_gaps_20260503.csv`
  - real result:
    - `17` rows reviewed
    - `16` rows eligible for writeback
    - `1` row still missing `subject_id`
- Executed the curated writeback into the TrialLight Firebase project:
  - `16` patient `users/{uid}` documents were patched with reviewed:
    - `subject_id`
    - `subjectId`
    - `protocolName = Prot_000.pdf`
    - `dropout_registry_trial_id` when available
- Re-ran a targeted live dry-run for the previously unmapped patients:
  - output preview:
    - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260503_subject_sync_targeted.json`
  - real result:
    - known `missing subject_id` blocker reduced from `4` to `1`
    - the recovered patients now enter live scoring and fail later on:
      - `No operational timestamp found`
- This confirms the dominant blocker has shifted again:
  - not subject mapping
  - not universal static-context absence
  - now mainly sparse live operational history
- A fresh full `21`-patient live dry-run was attempted after the subject sync, but it exceeded a 10-minute timeout budget before completion:
  - no new global all-patient totals are claimed yet from that run

## 2026-05-03 - Patient disengagement repo-side closure hardening completed

- Closed the training-artifact enforcement gap in:
  - `Patient-Dropout-Prediction/src/train.py`
- New training runs now explicitly emit:
  - `epoch_history.json`
  - `training_artifact_manifest.json`
  - `validation_metrics.json`
  - `test_metrics.json`
  - `threshold_sweep.json`
  - `calibration_summary.json`
- The new manifest records:
  - best interim checkpoint path
  - final checkpoint path
  - checkpoint retention policy
  - TensorBoard event-log presence versus Windows JSON fallback
- Tightened candidate promotion tooling in:
  - `Patient-Dropout-Prediction/src/run_candidate_search.py`
- Candidate search now distinguishes:
  - `trial_only_first_pass`
  - `artifact_incomplete_first_pass_only`
  - `promotion_ready`
- Verified the new enforcement against the current official historical run:
  - `candidate_024` is now honestly classified as `artifact_incomplete_first_pass_only` under the stricter artifact policy
  - this does not reopen the existing official-line decision; it only closes the written-policy versus code-policy gap for future runs
- Refreshed the current search artifact in place without rerunning training:
  - `Patient-Dropout-Prediction/runs/cs_r3/candidate_search_summary.json`
  - the summary now records:
    - `current_official_line`
    - `artifact_validation`
    - `trial_only_first_pass`
    - `promotion_ready`
    - `promotion_scope`
- Reconciled the main disengagement truth-source docs:
  - `Patient-Dropout-Prediction/README.md`
  - `Patient-Dropout-Prediction/OFFICIAL_MODEL.md`
  - `Patient-Dropout-Prediction/EVIDENCE_PACK.md`
  - `Patient-Dropout-Prediction/DEPLOY_READINESS.md`
  - `Patient-Dropout-Prediction/PROTOCOL_STATIC_CONTEXT_QA_STATUS.md`
- Key doc cleanup completed:
  - static-input wording now matches the real runtime fallback path (`age`/`dob`, `caregiver_support`/`caregiver`, `distance_to_site_km`/`dist_km`)
  - legacy `dropout_*` field names are now explicitly documented as compatibility-only contract names
  - official docs now consistently state the current dominant blocker:
    - sparse live operational history
  - protocol static-context QA is now explicitly documented as partial rather than implicitly waiting on a nonexistent 25-row completeness claim
- Added a new compact deploy-facing evidence package:
  - `Patient-Dropout-Prediction/audit/official_candidate_024_extreme_audit/deploy_evidence_summary.md`
  - `Patient-Dropout-Prediction/audit/official_candidate_024_extreme_audit/deploy_evidence_summary.json`
- Updated the official figure manifest so deploy-facing figures are explicitly labeled as:
  - `deploy gate evidence`
- Added a repo-hygiene classification note:
  - `Patient-Dropout-Prediction/REPO_HYGIENE_STATUS.md`
- This classifies current subrepo residue into:
  - official evidence
  - official tooling
  - temporary rerun residue
  - local-only debugging output
- Validation completed:
  - `py_compile` passed for:
    - `Patient-Dropout-Prediction/src/train.py`
    - `Patient-Dropout-Prediction/src/run_candidate_search.py`

## 2026-05-03 - TrialLight Firebase Functions and Hosting deploy completed

- Verified the root Firebase deploy configuration already in repo:
  - `.firebaserc` still targets Firebase project ID `traillight-4750b`
  - the Firebase console display name may now read `TrialLight`, but deploy commands still bind to the project ID
- Verified production bundle generation before deploy:
  - CRC web `npm run build:crc` succeeded
  - patient web `npm run build:patient-web` succeeded
- Confirmed the real deploy principal had to come from `firebase login`, not only the local service-account path:
  - `npx firebase login:list` now shows the owner-authorized Google account
- Live Firebase Functions deploy succeeded:
  - command used:
    - `npx firebase deploy --only functions --project traillight-4750b`
  - deployed/upserted the active Gemini guidance runtime and operational functions in `functions/`
  - included:
    - `classifyGuidanceRoute`
    - `classifyGuidanceRouteHttp`
    - `deleteGuidanceDocumentChunks`
    - `deleteGuidanceDocumentChunksHttp`
    - `ingestGuidanceDocument`
    - `processPendingProtocolGuidanceIndex`
    - `retrieveGuidanceContext`
    - `retrieveGuidanceContextHttp`
    - `sideEffectGuidanceChat`
    - `sideEffectGuidanceChatHttp`
    - `suggestAppointmentDate`
    - `suggestAppointmentDateHttp`
    - `sendIncidentPushNotifications`
- Live Firebase Hosting deploy succeeded:
  - command used:
    - `npx firebase deploy --only hosting:crc,hosting:patient --project traillight-4750b`
  - CRC hosting released:
    - `https://triallight.web.app`
  - patient hosting released:
    - `https://triallight-patient.web.app`
- Important scope note:
  - this completes the current root Gemini-based live web/runtime publish path
  - it does **not** mean full Terry SiliconFlow-backed retrieval/indexing has been enabled
  - current full Terry retrieval/indexing remains deferred unless the team later chooses to provide the remaining SiliconFlow secret bundle

## 2026-05-04 - Added teammate codebase packaging script

- Added a reusable root packaging script:
  - `scripts/package-codebase-for-teammate.ps1`
- The script is designed for teammate-sharing rather than full local-environment backup.
- Default exclusions now remove the main size and risk sources:
  - Git metadata
  - Node and Python virtual environments
  - large training datasets and cached window datasets
  - build outputs and local temp folders
  - local secrets and committed credential text files
  - deprecated/reference trees not needed for normal continuation work
  - large raw disengagement prediction CSV outputs and rerun residue
- Verified the script with `-DryRun`.
- Current dry-run result for the default lean share package:
  - included files: `998`
  - excluded files: `363835`
  - included size: about `99.33 MB`
- The script supports a custom zip output path so teammates can produce a named zip directly where they want it.

## 2026-05-03 - External UI/UX skill repository downloaded for future TrialLight CRC redesign work

- Downloaded the external UI/UX skill repository into the workspace for later design work:
  - `external-skills/ui-ux-pro-max-skill`
- No CRC or patient UI changes were started in this step.
- Confirmed the repository is a skill bundle rather than a single top-level `SKILL.md`.
- Confirmed the main skill path for later installation/use:
  - `external-skills/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/SKILL.md`
- Confirmed additional companion skills are present in the bundle, including:
  - `design`
  - `design-system`
  - `ui-styling`
  - `brand`
  - `banner-design`
  - `slides`
- This step was limited to downloading and locating the skill structure only; no UI redesign was started.

## 2026-05-03 - UI/UX Pro Max skill bundle installed into local Codex skills

- Installed the external UI/UX Pro Max skill bundle into the local Codex skills directory:
  - `C:\Users\TUF-A15\.codex\skills\ui-ux-pro-max`
  - `C:\Users\TUF-A15\.codex\skills\design`
  - `C:\Users\TUF-A15\.codex\skills\design-system`
  - `C:\Users\TUF-A15\.codex\skills\ui-styling`
  - `C:\Users\TUF-A15\.codex\skills\brand`
  - `C:\Users\TUF-A15\.codex\skills\banner-design`
  - `C:\Users\TUF-A15\.codex\skills\slides`
- Installation source:
  - `nextlevelbuilder/ui-ux-pro-max-skill`
- Verified all seven skill directories now exist locally.
- No TrialLight CRC or patient UI code was modified in this step.
- No redesign work was started in this step; this was installation-only preparation.

## 2026-05-03 - TrialLight CRC mockup direction package prepared before implementation

- Defined a desktop-only CRC UI direction mockup scope before any production UI changes:
  - `CRC_UI_DIRECTION_MOCKUPS_SPEC.md`
- Locked the mockup package to three directions:
  - `Clinical Command Center`
  - `Calm Research Operations`
  - `Precision Intelligence Workspace`
- Locked the page coverage for each direction board:
  - `CRC Login`
  - `Today`
  - `Patients`
  - `Patient Workspace / Study Coordination`
  - `Safety`
  - `Intelligence / Side Effect Guidance`
  - `Intelligence / Patient Disengagement Prediction`
  - `Questionnaires`
  - `Protocols`
  - `Resources`
- Locked the mockup target device to desktop browser only.
- Confirmed this step is mockup-only:
  - no CRC runtime code changed
  - no current UI implementation changed

## 2026-05-03 - TrialLight CRC web UI direction implemented for the root website

- Implemented the selected CRC direction on the root CRC website only:
  - overall direction: `Precision Intelligence Workspace`
  - visual tone: `restrained upgrade`
  - home label: `Today`
  - `ePRO` naming preserved
  - patient app intentionally untouched
- Reworked CRC route semantics so the main website now treats these as first-class sections:
  - `today`
  - `patients`
  - `safety`
  - `side-effect-guidance`
  - `patient-disengagement`
  - `epro`
  - `protocols`
  - `resources`
- Added compatibility mapping so older CRC links continue to resolve:
  - `dashboard` -> `today`
  - `safety-inbox` -> `safety`
  - `protocol-library` -> `protocols`
  - `study-coordination` -> `patients&panel=coordination`
  - `clinical-intelligence&focus=guidance` -> `side-effect-guidance`
  - `clinical-intelligence&focus=dropout` -> `patient-disengagement`
- Reworked the CRC information architecture:
  - removed the top-level aggregate `Intelligence` section
  - kept `Side Effect Guidance` and `Patient Disengagement Prediction` as separate first-class sidebar entries
  - merged `Study Coordination` into the `Patients` workspace instead of leaving it as a separate top-level section
- Updated the `Today` workspace to function as a shift-opening task surface with:
  - assigned patients
  - active safety items
  - pending ePRO items
  - actionable disengagement flags
  - direct action cards into safety, guidance, ePRO, and prediction
- Updated the `Patients` workspace to include:
  - roster
  - pinned patient context
  - in-page `Handoff` / `Study Coordination` switching
  - trial assignment, subject mapping, recent vitals, and appointment scheduling within the same patient-first workspace
- Updated CRC-facing naming and page copy:
  - `Patient Dropout Prediction` -> `Patient Disengagement Prediction`
  - `Safety Inbox` -> `Safety`
  - `Protocol Library` -> `Protocols`
  - `CRC Portal` -> `CRC Workspace`
- Preserved compatibility at the code-contract layer:
  - existing backend `dropout_*` field names remain untouched where required
  - disengagement UI text changed without breaking the current CRC-only runtime contract
- Updated the root login surface to match the CRC workspace wording:
  - `TrialLight CRC Workspace`
  - clearer CRC-only operations copy
- Hardened CRC auth bootstrap so local preview no longer looks like a white screen while auth
  initializes:
  - replaced the white-on-light loading layer with a visible startup card
  - added a 4-second fallback that releases the app to the CRC sign-in screen if Firebase auth
    bootstrap stalls
  - added an honest warning banner on the sign-in screen when saved-session recovery times out
- Added a CRC workspace runtime error boundary around the authenticated home route:
  - post-login crashes now render a visible diagnostic card instead of a blank page
  - the error card shows the real runtime message and offers reload / return-to-sign-in actions
- Fixed the post-login CRC workspace crash:
  - the new `Today` priority-action block had been declared before the safety and routing values it
    depended on
  - moved the action-definition block below those runtime values so the authenticated home workspace
    no longer trips a temporal-dead-zone error during startup
- Build verification:
  - `npm run build:crc` completed successfully after the UI/route changes

## 2026-05-04 - CRC precision intelligence refinement (desktop CRC web only)

- Pushed the previously committed CRC startup-fix commit on root branch `codex/root-integration-sync-20260415` before starting new UI work:
  - root push completed for commit `282c63a Fix CRC workspace startup crash and white screen`
- Continued CRC web UI/UX refinement toward `CRC_UI_DIRECTION_MOCKUPS_SPEC.md` Direction 3 `Precision Intelligence Workspace` without touching the patient app.
- Kept the locked product and data boundaries:
  - CRC web only
  - `ePRO` naming unchanged
  - no patient-side changes
  - no Firestore schema changes
  - no new Firebase queries added for UI polish
- Reworked the CRC top shell toward the selected direction:
  - introduced stronger desktop analytical framing for the app shell
  - prepared the header for local quick patient search over the already-loaded roster window only
  - kept `Side Effect Guidance` and `Patient Disengagement Prediction` as separate first-class sidebar entries
- Reworked the CRC login experience toward the selected mockup direction:
  - replaced the prior large-background feel with a structured portal layout
  - added an upper CRC workspace identity / boundary card
  - kept the lower sign-in card focused on the real existing CRC login flow
  - preserved CRC-only boundary wording and hospital-email requirement
- Added local quick-search behavior in the CRC top bar:
  - search is limited to the currently loaded patient roster window
  - no cross-source or global Firebase search was added
  - selecting a result routes back into the `Patients` workspace with that patient pinned
- Refined the `Today` workspace:
  - added a clearer `Today's overview` heading and stronger shift-opening framing
  - kept the real four summary metrics only:
    - assigned patients
    - active safety items
    - pending ePRO
    - actionable disengagement flags
  - kept only lightweight next-action guidance derived from existing data
- Refined the `Patients` workspace:
  - converted the roster into a denser analytical list/table style
  - added safe local filters only for:
    - protocol assigned/unassigned
    - subject mapped/unmapped
  - kept search scoped to existing loaded data only
  - renamed the patient tab from `Handoff` to `Overview`
- Refined the shared visual system for CRC pages:
  - deep-navy sidebar
  - pale blue-gray app background
  - white high-radius workspace cards
  - tighter analytical top bar
  - `IBM Plex Sans` / `IBM Plex Mono` typography stack with safe fallbacks
  - more consistent clinical blue / amber / restrained red state language
- Applied the refined visual language across existing real pages without adding unsupported product features:
  - `Today`
  - `Patients`
  - `Safety`
  - `Side Effect Guidance`
  - `Patient Disengagement Prediction`
  - `ePRO`
  - `Protocols`
  - `Resources`
- Explicitly did not add mockup-only features that TrialLight does not currently own:
  - no global multi-source search
  - no `Documents / Notes / Tasks`
  - no expanded resource knowledgebase
  - no new patient-risk taxonomy
  - no new task-engine backend
- Verification:
  - `npm.cmd run build:crc` passed after the refinement changes
  - targeted lint passed for touched CRC files:
    - `src/App.jsx`
    - `src/components/Login.jsx`
    - `src/components/TopNavbar.jsx`
    - `src/components/CRCWorkspaceShell.jsx`
    - `src/components/PatientList.jsx`
    - `src/pages/CRCHome.jsx`
  - full-repo `npm run lint` still reports unrelated errors from virtualenvs, generated assets, and subtrees outside the CRC refinement scope

## 2026-05-04 - CRC precision intelligence second-pass density and login refinement

- Continued the CRC-only `Precision Intelligence Workspace` refinement to address remaining layout-density issues reported after manual browser review.
- Reworked the CRC login experience to align more closely with direction 3:
  - kept a CRC-only desktop portal layout
  - tightened the split portal structure so the brand/illustration panel and sign-in panel feel like one framed workspace
  - changed the CRC sign-in copy to `Welcome back`
  - added a real `Remember me` toggle using Firebase local vs session persistence
  - added CRC `Forgot password?` email reset support through Firebase Auth
- Reworked `Patients` to reduce horizontal crowding:
  - narrowed the analytical roster into four stable columns
  - moved subject mapping into the subject column instead of keeping a fifth wide status column
  - reduced the chance of the roster/workspace composition forcing horizontal overflow on desktop
- Rebuilt `Patient workspace / Study Coordination` into a single right-side workspace instead of multiple competing wide grids:
  - kept one patient workspace shell with `Overview` and `Study Coordination`
  - moved study coordination into one composed layout:
    - main configuration panel
    - assigned-trial summary aside
    - recent vitals aside
    - appointments aside
  - reduced verbose copy so the workspace reads more like a clinical operations surface and less like a documentation page
- Densified `PatientEditMenu` itself:
  - grouped fields into `Identity`, `CRC ownership`, and `Trial assignment`
  - kept only existing real fields and no mockup-only fake controls
- Explicitly still did not add unsupported direction-3-looking features:
  - no true global multi-source search
  - no `Documents / Notes / Tasks`
  - no risk/status taxonomy columns that TrialLight does not currently own
  - no expanded resource library backend
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/App.jsx`
    - `src/components/Login.jsx`
    - `src/components/PatientList.jsx`
    - `src/components/PatientEditMenu.jsx`
    - `src/pages/CRCHome.jsx`

## 2026-05-04 - CRC direction 3 completion pass (Patients / Guidance / Notes / Tasks / branding)

- Continued the CRC-only UI/UX refinement toward `CRC_UI_DIRECTION_MOCKUPS_SPEC.md` direction 3 `Precision Intelligence Workspace`.
- Kept the locked boundary:
  - CRC web only
  - patient app untouched
  - no patient-facing disengagement exposure
  - no new unbounded Firebase queries
- Added CRC website brand assets:
  - introduced a dedicated SVG `TrialLight CRC` brand mark / wordmark for the CRC website shell and login portal
  - added a dedicated CRC favicon and wired it into:
    - `index.html`
    - `src/config.js`
    - `public/notification-sw.js`
- Rebuilt the CRC login portal closer to direction 3:
  - split intro/auth layout retained and tightened
  - login left panel now uses CRC-specific brand assets and a dedicated clinical-research illustration
  - kept `Welcome back`, `Remember me`, and real CRC `Forgot password?`
- Removed the low-value top-header pills from the CRC website shell:
  - `CRC-only surface`
  - `Patient safety first`
  - `Study-bound data`
- Reworked shell ratio and desktop space usage:
  - compressed the top workspace bar
  - reduced shell chrome overhead
  - increased the visible working area for main CRC tasks
  - kept desktop layouts focused on `1366 / 1536 / 1920`
- Rebuilt `Patients` into a direction-3-style master-detail workspace:
  - left side = dense patient roster
  - right side = pinned patient workspace
  - selecting a patient no longer requires scrolling to the bottom of the page to see patient detail
- Kept `risk` out of the `Patients` page and left it only in `Patient Disengagement Prediction`.
- Added front-end-derived patient workflow indicators without changing Firestore schema:
  - `Workflow Status`
  - `Next Task`
  - derived from existing incidents, ePRO, subject mapping, protocol assignment, and CRC ownership only
- Expanded the patient workspace tabs to:
  - `Overview`
  - `Vitals`
  - `Safety`
  - `ePRO`
  - `Notes`
  - `Tasks`
  - `Study Coordination`
- Added real CRC-only `Notes` functionality:
  - Firestore collection: `users/{uid}/crc_notes/{noteId}`
  - supports create / edit / delete with confirmation
  - not exposed to the patient app
- Added real CRC-only `Tasks` functionality:
  - Firestore collection: `users/{uid}/crc_tasks/{taskId}`
  - supports create / mark done / reopen / delete with confirmation
  - not exposed to the patient app
- Reworked `Study Coordination` into a clearer operational layout:
  - main patient configuration area
  - separate aside for assigned trial summary, recent vitals, and appointments
  - removed the prior oversized competing card layout that wasted space
- Reworked `Side Effect Guidance` into a fixed two-column CRC workspace:
  - left = docked conversation area
  - right = pinned patient / protocol / CTCAE / recent safety context
  - the input area remains visible without scrolling down the full page first
- Cleaned visible text issues that were degrading the perceived UI quality:
  - replaced corrupted separator glyphs in roster/guidance-related UI strings
  - removed no-longer-used context-pill rendering from the shell/topbar path
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/App.jsx`
    - `src/components/CRCWorkspaceShell.jsx`
    - `src/components/Login.jsx`
    - `src/components/PatientEditMenu.jsx`
    - `src/components/PatientList.jsx`
    - `src/components/PatientNotesPanel.jsx`
    - `src/components/PatientTasksPanel.jsx`
    - `src/components/TopNavbar.jsx`
    - `src/components/TrialLightCrcBrand.jsx`
    - `src/components/TrialLightCrcIllustration.jsx`
  - `src/components/GeminiChatbot.jsx`
  - `src/pages/CRCHome.jsx`

## 2026-05-04 - CRC direction 3 corrective pass (roster-first patients workspace)

- Corrected the CRC web `Patients` interaction model after the prior split-view pass proved too cramped and visually unstable.
- Locked `Patients` into a roster-first flow:
  - opening `Patients` now shows the roster as the primary view
  - selecting a patient now switches the full main workspace into `Patient Workspace`
  - the UI no longer relies on keeping roster and workspace visible at the same time
- Tightened the CRC shell ratio again:
  - reduced top workspace-bar height
  - returned more vertical space to the actual task surfaces
  - kept desktop-only direction 3 framing
- Refined patient workspace behavior:
  - `Patient Workspace` now uses a dedicated full-width shell once a patient is selected
  - `Back to roster` explicitly clears the selected patient route state
  - patient tab switches now preserve the selected patient in the URL instead of silently dropping the patient context
- Reduced clutter in the patient workspace:
  - removed the visible `Delete patient` action from the configuration surface
  - kept the configuration focused on real CRC coordination fields only
- Simplified the roster row treatment:
  - clicking a roster row always opens the patient workspace
  - removed the extra `Open workspace` pill from the roster action column
  - kept `Workflow Status` and `Next Task` as front-end-derived fields based only on existing data
- Further compressed the docked `Side Effect Guidance` workspace so the message area and composer fit the first screen more predictably on desktop.
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/pages/CRCHome.jsx`
    - `src/components/PatientList.jsx`
    - `src/components/PatientEditMenu.jsx`
    - `src/components/TopNavbar.jsx`
- 2026-05-04: Applied a direction-3 density pass for CRC web only. Tightened the shell ratio, removed sidebar outer spacing and rounded edges, reduced header height, compressed Today card spacing, made Patients roster denser, kept Patients roster-first with full Patient Workspace after selection, pushed Patient Workspace tabs toward direction-3 card composition, compressed Side Effect Guidance to prioritize first-screen input, and forced ePRO summary metrics into a single-row desktop layout.

## 2026-05-04 - CRC direction 3 corrective pass (sidebar collapse, header spacing, login emphasis)

- Removed the redundant `Today` section subheader so the page no longer repeats the same introduction under the main top bar.
- Tightened the CRC shell again to reduce the gap between the page header and the first actionable content block.
- Added a final corrective CSS pass for the sidebar:
  - compressed the expanded sidebar so all sections can fit on a normal desktop height without scrolling down to `Resources`
  - fixed the collapsed sidebar layout so the retract state no longer leaves the navigation visually broken
  - restored icon contrast so active/collapsed sidebar icons do not wash out into all-white marks
- Updated the CRC login experience to emphasize the two core intelligence surfaces:
  - `Side Effect Guidance`
  - `Patient Disengagement Prediction`
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/App.jsx`
    - `src/components/Login.jsx`
  - `src/pages/CRCHome.jsx`
  - `src/components/CRCWorkspaceShell.jsx`
  - `src/components/TopNavbar.jsx`

## 2026-05-05 - CRC direction 3 corrective pass (sidebar fit, WhatsApp-style guidance timestamps, tighter shell)

- Continued the CRC-only `Direction 3` refinement with a stricter desktop-density pass instead of adding new product scope.
- Cleaned the CRC sidebar source structure:
  - kept only one visible navigation group
  - ensured the visible sequence is now `Today / Patients / Safety / Side Effect Guidance / Patient Disengagement Prediction / ePRO / Protocols / Resources`
  - removed extra badge/description noise from the sidebar data layer
- Tightened the sidebar visual fit so the full navigation can be scanned without scrolling to reach `Resources` on a normal desktop viewport:
  - reduced top spacing above `WORKSPACE`
  - reduced nav row height
  - removed the last remaining extra shell padding
  - corrected collapsed-state spacing and icon alignment
- Fixed the icon contrast issue for:
  - `Side Effect Guidance`
  - `Patient Disengagement Prediction`
  so they no longer default to all-white inactive icons and instead match the rest of the navigation system.
- Tightened page shell spacing again:
  - reduced the gap between the sticky page header and the first content block
  - compressed top bar typography and control heights
  - reduced section-to-section spacing across the main CRC workspace
- Reduced oversized desktop typography on the `Protocols` summary cards so long values like `None selected` and `Not assigned` no longer dominate the section.
- Forced the `ePRO` top metrics into a single desktop row:
  - `Pending trials`
  - `Pending patient drafts`
  - `Released today`
  - `Customized drafts`
- Added WhatsApp-like time markers inside `Side Effect Guidance`:
  - each user/model chat bubble now shows a message timestamp
  - daily separator chips now appear above grouped messages
  - the last 3 days use weekday labels
  - anything older switches to `DD/MM/YYYY`
- Kept the guidance implementation inside the existing loaded message history only:
  - no new Firestore listeners
  - no new cross-collection reads
  - no patient-app exposure changes
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/pages/CRCHome.jsx`
    - `src/components/GeminiChatbot.jsx`
    - `src/components/CRCWorkspaceShell.jsx`
    - `src/components/EproReviewWorkspace.jsx`
    - `src/components/ProtocolManager.jsx`

## 2026-05-05 - CRC hosting release prep

- Prioritized supervisor-demo readiness over additional UI refinement.
- Rebuilt the CRC web bundle from the current root workspace state before release.
- Kept the deployment scope limited to CRC Hosting only:
  - no patient app changes
  - no patient Hosting deployment
  - no additional remote data migration in this step
- Known demo-state caveats intentionally left visible for now:
  - `Patient Disengagement Prediction` may still depend on current Firestore summary visibility
  - `ePRO` review queue and mirrored record visibility may still be partially degraded

## 2026-05-05 - CRC workspace startup hotfix

- Fixed a CRC website startup crash after sign-in:
  - `CRCHome.jsx` was still calling `orderBy(...)`
  - but the Firestore import list no longer included `orderBy`
- Result:
  - the CRC workspace can boot again after successful login instead of failing with `Runtime error: orderBy is not defined`
- Follow-up:
  - rebuild CRC bundle
  - redeploy CRC Hosting so the hotfix reaches the live supervisor demo site

## 2026-05-06 - CRC and patient web stabilization (local only)

- Fixed the CRC `Patient Disengagement Prediction` fallback query so it no longer crashes when the Firestore mirror is empty:
  - removed the invalid `collectionGroup(... where(documentId(), '==', 'current'))` query
  - kept the query bounded with `limit()`
  - now filters `doc.id === 'current'` on the client after the bounded snapshot returns
- Hardened the CRC `ePRO` workspace for degraded backend states:
  - summary metrics now fall back to `0` instead of corrupted placeholder characters
  - queue-service failures now render a friendly unavailable state instead of surfacing raw backend text
  - cleaned malformed separators inside review metadata rows
- Updated the dropout GitHub Actions workflow locally:
  - daily schedule changed to `19:00 UTC`, which is `03:00 Asia/Kuala_Lumpur`
  - added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
  - added explicit checkout of `yisheng10/Patient-Dropout-Prediction` using `DROPOUT_REPO_PAT`
  - added `DROPOUT_REPO_PAT` to required secret validation
- Verified the patient web build chain locally without deploying:
  - `expo export --platform web --output-dir web-build` succeeds when run outside the sandbox restriction
  - fixed `MyClinicalApp2/src/firebase.js` so Expo web now receives build-time inlined `EXPO_PUBLIC_FIREBASE_*` values instead of trying to read dynamic `process.env[name]` at runtime
  - verified the exported `web-build` bundle now contains the concrete Firebase config values instead of an unresolved runtime env lookup
  - this confirms the patient blank-screen root cause is the old deployed bundle plus the previous dynamic-env web boot bug, not the patient login flow itself
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/services/dropoutService.js`
    - `src/components/EproReviewWorkspace.jsx`
    - `src/services/eproReviewService.js`
  - patient local web export passed:
    - `npm.cmd --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web`

## 2026-05-06 - Dropout workflow and patient web stabilization follow-up (local only)

- Hardened the scheduled dropout GitHub Actions workflow without changing any model logic:
  - kept the schedule at `0 19 * * *` so the job runs at `03:00 AM` Asia/Kuala_Lumpur
  - corrected workflow env paths to use the checked-out dropout repo root:
    - `deploy_assets/data/triallight_dropout_testing_v35subjectid.csv`
    - `deploy_assets/checkpoints_honest_v3`
  - upgraded the file preflight to fail early with explicit missing-path output instead of a later pandas `FileNotFoundError`
- Tightened the CRC `Patient Disengagement Prediction` empty-state behavior:
  - if no published summary and no bounded fallback rows are available, the panel now renders a product-facing empty state instead of surfacing engineering recovery instructions
  - removed the "run the workflow" style copy from the visible CRC panel
- Cleaned protocol upload messaging in the CRC web app:
  - successful upload now reports `Added to Trial Library. Guidance indexing will continue in the background.`
  - dropout static-context extraction failures are shown only as a secondary warning
  - added a short UI note explaining that the guidance index is used by `Side Effect Guidance` for fast protocol search
- Improved patient web login visibility without changing patient app business logic:
  - patient login now has inline web-visible `error` and `info` messages
  - sign-in and forgot-password actions now show loading/disabled states
  - web no longer depends only on `Alert.alert(...)` for auth feedback
- Added a patient workspace error boundary for the web surface:
  - login success + patient-home crash now shows a visible `Patient workspace error`
  - includes `Back to sign-in` and `Reload workspace`
- Hardened `PatientHome` startup subscriptions:
  - added explicit error callbacks for profile, vitals, appointments, alerts, ePRO, side-effect reports, and assigned trial template subscriptions where supported
  - failed patient-home data streams now degrade to empty state plus a visible notice instead of silently risking a full-page crash
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for the edited CRC and patient JS files (the Expo `app/index.tsx` path is ignored by the current root ESLint config, but the patient web export below compiled it successfully)
  - `npm.cmd --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web` passed after allowing local Metro child-process spawning outside the sandbox

## 2026-05-07 - Read-safe CRC and patient fallback stabilization (local only)

- Reduced CRC read pressure by tightening global listener windows and gating the remaining cross-patient feeds by active section:
  - lowered the CRC roster cap to `60`
  - lowered global alert, mirrored ePRO, and incident windows to `30`
  - kept heavy listeners off sections that do not need them
- Unified the CRC top-right `Urgent` button with the same serious-incident signal used by `Safety`:
  - the badge now reflects open `incident_records` with `severity == serious`
  - the Today urgent panel now opens serious incidents instead of treating unread alert threads as the primary urgent source
- Clarified patient-to-disengagement mapping language in the CRC workspace:
  - `mapped subject ID` now explicitly states that it is only the canonical subject mapping used by CRC-only disengagement prediction
  - the helper copy now states that it does not affect patient login or general CRC profile management
- Hardened patient side-effect fallback severity handling:
  - expanded respiratory emergency keywords to include `breathing difficulty`, `difficulty in breathing`, and `breathless`
  - fallback triage is now more conservative when AI guidance is unavailable
- Softened disengagement empty states so missing or unreadable snapshots no longer surface engineering-heavy recovery copy inside the CRC panel
- Verification:
  - `npm.cmd run build:crc` passed
  - targeted `eslint` passed for:
    - `src/pages/CRCHome.jsx`
    - `src/services/incidentService.js`
    - `src/services/appointmentService.js`
    - `src/components/PatientEditMenu.jsx`
    - `src/components/DropoutRiskPanel.jsx`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/appointmentService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/firebaseFunctionHttp.js`
  - `npm.cmd --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web` passed after allowing local Metro child-process spawning outside the sandbox

## 2026-05-07 18:41:52

- Restored local data visibility after the previous read-safe tightening hid legacy records:
  - CRC `users` subscriptions no longer require `role == patient/crc` at query time
  - legacy user records now fall back to hospital-email heuristics when `role` is missing
  - legacy profile field aliases are normalized back into `protocolId`, `protocolName`, `primary_crc_id`, and `subject_id`
- Relaxed CRC incident loading so legacy incidents without `updated_at` are not excluded:
  - `incident_records` now load through a bounded `limit(...)` query
  - records are sorted client-side by `updated_at || created_at`
- Hardened assigned-trial fallback on both CRC and patient paths:
  - if a stored `protocolId` no longer resolves, the app now falls back to `protocolName`
  - snake_case protocol field aliases are also accepted in the patient web template loader
- Restored patient home profile compatibility:
  - patient web now accepts `protocol_id`, `protocol_name`, and `protocol_url` legacy profile fields when present
- Verification:
  - `npm.cmd run build:crc` passed
  - `npm.cmd --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web` passed
  - targeted `eslint` passed for:
    - `src/pages/CRCHome.jsx`
    - `src/services/incidentService.js`
    - `src/services/trialTemplateService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js`

## 2026-05-07 - Temporary SULAM booth assistant swap (local only)

- Created a temporary patient-side `SULAM Booth Assistant` component for the secondary school activity:
  - file: `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbotForSecondarySchool.js`
  - this booth-mode assistant keeps chat in local UI state only and does not write chat history, side-effect reports, CRC alerts, or audit records
- Swapped the current patient website guidance entry to the temporary booth assistant without editing the formal clinical chatbot implementation:
  - `PatientHome.js` now imports `GeminiChatbotForSecondarySchool`
  - the original `GeminiChatbot.js` was intentionally left unchanged for post-activity rollback
- Activity-mode booth behavior:
  - asks for sleep hours and Milo/Coffee in free chat
  - uses the currently assigned booth account protocol as the source of truth
  - warns booth staff to switch accounts if the student input conflicts with the active Milo/Coffee account
  - attempts to read the assigned protocol PDF before generating the reply
  - falls back to a friendly local booth answer if protocol retrieval or Gemini generation is unavailable
- Follow-up activity-mode polish:
  - `PatientHome.js` booth card copy now matches the school activity instead of the formal clinical guidance wording
  - the dedicated `/side-effect` route now redirects users back to the patient home booth flow with school-activity copy
  - patient home no longer subscribes to mirrored side-effect reports during booth mode, reducing unnecessary reads
  - the temporary booth assistant now respects `openSignal`, so the home-screen button reliably opens it again after `Hide`
- No deployment actions were taken in this step.

## 2026-05-07 - SULAM booth assistant usability follow-up (local only)

- Updated the temporary patient-side `SULAM Booth Assistant` so it no longer opens automatically on patient home entry:
  - the booth panel now stays hidden until the user presses `Open SULAM Booth Assistant`
  - after the user has opened it once, `Hide` collapses it and leaves a lightweight reopen pill
- Added bilingual booth support for English and Bahasa Malaysia:
  - Milo/Coffee detection now also understands `kopi`
  - sleep-hour extraction now supports Malay phrasing such as `tidur 5 jam`
  - missing-info prompts, account-conflict prompts, and fallback predictions now switch into Bahasa Malaysia when the student writes in Malay
  - Gemini prompting now explicitly tells the model to reply in Bahasa Malaysia when the student uses Malay or mixed Malay-English
- Hardened booth-account detection for tomorrow's school flow:
  - account drink resolution now checks protocol name, protocol URL, patient nickname, and patient account email
  - this reduces the chance of the booth assistant failing if the drink signal is stored in the account identity rather than only in the protocol name
- Reworked the booth chat layout for local web use:
  - the assistant panel is now a fixed bottom sheet on web
  - the message list scrolls inside the panel while the input and send button stay pinned at the bottom
  - the input placeholder now explicitly accepts both English and Bahasa Malaysia
- Updated the patient home booth card copy to match the new behavior:
  - the card now tells users the assistant supports English and Bahasa Malaysia
  - the card also clarifies that the booth assistant only opens after pressing the button

## 2026-05-07 - SULAM booth assistant answer-quality follow-up (local only)

- Tightened the temporary `SULAM Booth Assistant` so it responds to the student's latest question instead of repeating the same baseline booth prediction:
  - added explicit booth intent detection for overconsumption-style questions such as `too much` / `terlalu banyak`
  - the assistant now distinguishes between a normal booth prediction and a direct follow-up question about drinking too much Milo or Coffee
- Added stricter anti-hallucination guardrails for the temporary booth assistant:
  - rejects replies that invent face/video analysis, hidden booth measurements, or unsupported "research says..." claims
  - falls back to a safe local answer if Gemini returns an off-topic or exaggerated booth answer
- Added direct local fallback answers for `too much Coffee` and `too much Milo` in both English and Bahasa Malaysia so the activity still works even if Gemini returns a weak answer
- Preserved the temporary activity boundaries:
  - no chat persistence
  - no side-effect reports
  - no CRC alert trigger
  - no edits to the formal clinical `GeminiChatbot` implementation

## 2026-05-07 - SULAM patient website hosting release

- Deployed only the patient website hosting target for the school booth activity:
  - target: `hosting:patient`
  - site: `https://triallight-patient.web.app`
- Confirmed the deployment rebuilt the current patient web export before release:
  - activity entry remains the temporary `SULAM Booth Assistant`
  - formal clinical `GeminiChatbot` file remains unchanged
- No CRC hosting deployment was performed in this step.

## 2026-05-08 - SULAM booth Gemini key-pool rotation (local only)

- Updated the temporary `SULAM Booth Assistant` to support separate frontend Gemini key pools for the two booth accounts:
  - `EXPO_PUBLIC_GEMINI_API_KEYS_COFFEE`
  - `EXPO_PUBLIC_GEMINI_API_KEYS_MILO`
- The activity assistant now routes each booth account to its own key pool:
  - Coffee account uses only the Coffee pool
  - Milo account uses only the Milo pool
- Added sequential key rotation with per-account browser `sessionStorage` tracking so repeated prompts on the same laptop do not always start from the first key
- Added retry-on-key-failure handling for temporary event-only Gemini failures:
  - rotates on quota / rate-limit / 403 / empty-response style failures
  - falls back to the local booth answer if the entire pool is unavailable
- Updated `MyClinicalApp2/.env.example` with the temporary SULAM key-pool environment variable names and left the single-key variable as an optional local fallback only
- No deploy, commit, or push was performed in this step.

## 2026-05-08 - SULAM booth local Gemini key assignment (local only)

- Added the temporary event key pools to the local patient-web `.env` file without committing them:
  - `EXPO_PUBLIC_GEMINI_API_KEYS_COFFEE`
  - `EXPO_PUBLIC_GEMINI_API_KEYS_MILO`
- Split the currently provided temporary keys into separate Coffee and Milo pools so the two booth laptops do not rotate through the exact same frontend keys.
- Kept a single `EXPO_PUBLIC_GEMINI_API_KEY` value as a last-resort fallback only.
- Intentionally left one extra historical key unused because the user said only eight temporary keys should be active for the booth.
- No deploy, commit, or push was performed in this step.

## 2026-05-08 - SULAM booth visible key-label indicator (local only)

- Updated the temporary patient-web booth config to support separate visible key-label lists:
  - `EXPO_PUBLIC_GEMINI_KEY_LABELS_COFFEE`
  - `EXPO_PUBLIC_GEMINI_KEY_LABELS_MILO`
- Expanded the local SULAM booth `.env` assignment to use all 9 latest temporary keys:
  - Coffee pool uses 5 labels/keys
  - Milo pool uses 4 labels/keys
- Updated `GeminiChatbotForSecondarySchool` so the assistant tracks the currently selected Gemini key label while rotating through the temporary frontend key pool.
- Added a small footer status line inside the activity assistant input area to show the current key label (for example `mooonpie`, `23005048`, `jianhongtan72`) without exposing the actual API key value.
- No deploy, commit, or push was performed in this step.

## 2026-05-08 - SULAM patient website redeploy with visible key labels

- Redeployed only the patient hosting target after wiring the visible temporary Gemini key-label indicator into the SULAM booth assistant.
- Confirmed the exported patient web bundle includes:
  - `EXPO_PUBLIC_GEMINI_KEY_LABELS_COFFEE`
  - `EXPO_PUBLIC_GEMINI_KEY_LABELS_MILO`
  - the separate Coffee/Milo frontend key pools
- The live patient site now shows the current Gemini key label in the temporary SULAM assistant footer so booth staff can monitor which account's quota is currently in use.
- Hosting URL:
  - `https://triallight-patient.web.app`
- No CRC hosting deployment was performed in this step.

## 2026-05-09 - SULAM activity rollback staged locally

- Restored the patient home guidance entry back to the formal `GeminiChatbot` component without modifying the formal chatbot file itself.
- Removed the temporary SULAM booth assistant card and button from the active patient home workflow.
- Restored the `/side-effect` patient page back to the post-booth clinical wording that directs users to the formal AI guidance flow.
- Reconnected patient-side effect report visibility on the patient home screen by re-enabling the mirrored side-effect report subscription in `PatientHome.js`.
- Left `GeminiChatbotForSecondarySchool.js` and the temporary booth key-pool config in the repo, but they are no longer referenced by the active patient pages.
- No commit, push, or deploy was performed in this step.

## 2026-05-09 - CRC disengagement explainability v1 wired locally

- Added a dedicated CRC-facing explainability mirror contract for disengagement predictions:
  - new mirror path: `users/{uid}/dropout_predictions_explainability/current`
  - contract version: `dropout_explainability_crc_v1`
- Added a lightweight explainability summary assembler in the dropout backend:
  - converts existing `explanation_signals`, `missing_inputs_summary`, and `data_quality_flags` into CRC-readable sections
  - publishes:
    - `why_flagged`
    - `missing_or_weak_inputs`
    - `what_could_reduce_risk`
    - `model_agreement`
    - `confidence_and_stability`
- Kept the explainability mirror failure-safe:
  - main `dropout_predictions/current` publish is not blocked if explainability assembly fails
  - preview payloads now include explainability mirror updates separately from the main current snapshot updates
- Added CRC frontend support for on-demand explainability reads only for the active patient:
  - no explainability collection-group listener was added
  - active patient detail now subscribes only to `users/{uid}/dropout_predictions_explainability/current`
- Upgraded the CRC `DropoutRiskPanel` UI with a dedicated explainability area:
  - `Why this patient is flagged`
  - `Data gaps affecting confidence`
  - `What might reduce disengagement risk`
  - `Model agreement`
  - `Confidence and stability`
- Preserved graceful fallback behavior:
  - explainability mirror first
  - legacy current-snapshot explanation fields second
  - productized empty state last
- Local verification completed:
  - Python explainability files compiled successfully
  - CRC production build completed successfully
  - targeted eslint passed for the modified CRC frontend files

## 2026-05-09 - Dropout workflow schedule and path hardening updated locally

- Updated `TrialLight Dropout Precompute` to run twice daily at `06:00` and `18:00` Asia/Kuala_Lumpur (`22:00` and `10:00` UTC).
- Switched the workflow's dropout verification, dependency install, preflight, and publish steps to run from the checked-out `Patient-Dropout-Prediction` working directory so `deploy_assets/...` paths resolve inside the dropout repository rather than the root integration workspace.
- Added a workflow submodule metadata normalization step so GitHub Actions post-job cleanup has explicit `.gitmodules` URLs for both `Patient-Dropout-Prediction` and `MyClinicalApp2`.
- Realigned the workflow checkpoint runtime override to the official `Candidate 024` bundle (`deploy_assets/checkpoints_candidate_024`) instead of the older `honest_v3` rollback directory.

## 2026-05-09 - Explainability-only publish gate path enabled locally

- Upgraded the dropout publisher so challenger/stability audit evidence now feeds the CRC explainability mirror through deployment-level context:
  - `model_agreement` now falls back to the official Transformer-vs-XGBoost challenger audit when patient-level challenger summaries are absent.
  - `confidence_and_stability` now falls back to the official deployment audit bundle instead of showing `unavailable` by default.
  - `what_could_reduce_risk` now reuses counterfactual source hints from the official audit bundle when patient-level suggestions are sparse.
- Added a limited-coverage publish path:
  - when live publish gates block the main `dropout_predictions/current` snapshot, the publisher may still write `users/{uid}/dropout_predictions_explainability/current`
  - this keeps the main risk snapshot strict while allowing CRC-facing explainability docs to ship under partial live coverage.
- Executed one real local live publish with the new gate behavior:
  - preflight passed with the Candidate 024 bundle
  - live gate still blocked the main snapshot because `score_generation_success_rate` was `0.6957` against a `0.7000` threshold and `usable_static_context_rate` was `0.7826` against a `0.9500` threshold
  - despite that, the explainability-only path successfully wrote `16` Firestore explainability mirror docs

## 2026-05-10 - CRC redeploy for invalid dropout query fix

- Confirmed the local CRC frontend no longer uses the invalid `collectionGroup(...)+documentId() == "current"` query shape for disengagement snapshots.
- Rebuilt the CRC web bundle successfully before rollout.
- Redeployed the CRC website so `Patient Disengagement Prediction` uses the fixed single-doc / bounded-query dropout readers instead of the stale crashing build.

## 2026-05-10 - Dropout explainability null-guard hotfix

- Fixed a CRC disengagement detail crash where the explainability fallback helpers accepted `undefined` but still crashed on `null` during the active-patient handoff.
- Hardened the legacy explainability fallback path so `Patient Disengagement Prediction` can safely render while the selected row or explainability mirror is still settling.

## 2026-05-10 - Dropout workflow switched to live-safe deploy assets

- Confirmed the GitHub Actions failure was no longer a cron issue or a local-computer issue; the live workflow was still verifying a large frozen CSV that is not required for live preflight.
- Updated the main-branch workflow plan to verify only the live publish assets that are actually required on GitHub:
  - `deploy_assets/data/triallight_subject_context_registry_v35subjectid.csv`
  - `deploy_assets/checkpoints_candidate_024/model_stage_3_29_single.pth`
  - `deploy_assets/checkpoints_candidate_024/artifacts_stage_3_29_single.pkl`
- Kept the dropout explainability / publish path aligned with the `Candidate 024` deployment bundle instead of trying to upload the untrackable `302MB` testing CSV into GitHub.

## 2026-05-10 - Dropout main source chain synced for live precompute

- Confirmed the latest GitHub Actions failure moved past asset verification and was now caused by the dropout default branch missing the live publish source chain (`live_data_adapter.py` and matching helper modules).
- Synced the active dropout `src` modules used by `publish_dropout_snapshots.py` into the dropout `main` worktree so the live precompute path matches the locally working publisher.
- Re-ran `publish_dropout_snapshots.py --preflight-only --source-mode live --limit-patients 5` against the dropout `main` worktree with the live registry/checkpoint bundle and confirmed the preflight now reports `ready=True`.

## 2026-05-10 - Dropout live publish progress logging added

- Added periodic progress logs to the live dropout publisher so GitHub Actions no longer looks stuck during long patient-by-patient scans.
- The publisher now logs:
  - testing-subject sync start/completion
  - scanned patient count
  - predictions ready
  - mapping failures
  - score failures
  - missing static context
  - insufficient live history
  - elapsed seconds
- Updated the GitHub workflow plan to run Python in unbuffered mode and emit progress every `5` patients by default.

## 2026-05-10 - Dropout publish progress import hotfix

- Fixed the GitHub Actions live publish regression caused by the `.dropout-main-worktree` version of `publish_dropout_snapshots.py` missing `import time` after heartbeat logging was added.
- Kept the remote dropout `main` hotfix minimal so the next `TrialLight Dropout Precompute` rerun can continue past publish startup and show real progress output.

## 2026-05-10 - Dropout live publish bounded-source hotfix

- Tightened the live dropout publisher so Firestore sources no longer fall back to unbounded full-history reads when `protocolAssignedAt` is missing.
- Added a capped `incident_records` query plus source-start debug logs so GitHub Actions can show which patient/source is slowing live publish.
- Enabled source-level live debug output in the workflow and aligned the local root workflow copy with the main-branch workflow version.

## 2026-05-10 - CRC detailed reasoning trace streaming V1 implemented locally

- Added a new Firebase Functions v2 HTTP streaming endpoint for CRC side-effect guidance:
  - `sideEffectGuidanceTraceStreamHttp`
  - transport: authenticated POST + NDJSON stream
  - runtime file: `functions/guidanceRuntime.js`
- The new trace stream now emits structured CRC-facing reasoning events instead of raw private chain-of-thought:
  - observed signals
  - retrieval decision
  - CTCAE evidence
  - protocol evidence
  - risk interpretation
  - why this action
  - what would change the recommendation
  - final answer / completion / error events
- Added patient-linked trace persistence for patient-scoped CRC guidance answers:
  - summary doc: `users/{patientUid}/guidance_traces/{traceId}`
  - full event log: `users/{patientUid}/guidance_traces/{traceId}/events/{seq}`
- Added a CRC-side streaming HTTP helper and guidance service wrapper:
  - `src/services/firebaseFunctionHttp.js`
  - `src/services/sideEffectGuidanceService.js`
- Added CRC frontend feature-flag support:
  - `VITE_CRC_GUIDANCE_TRACE_STREAM`
  - default behavior is enabled unless explicitly set to `false`
- Upgraded `src/components/GeminiChatbot.jsx` to support:
  - live collapsed `Thinking...` status driven by streamed events
  - expandable detailed reasoning trace panels on model answers
  - a docked `Patient AI Guidance History` review panel for saved patient-linked traces
  - bounded trace-history reads and on-demand event loading to avoid Firestore read storms
  - final-answer display gating so the visible grounded answer is only released after the trace reaches a terminal completion state
- Hardened the new trace path against repeated listener churn:
  - memoized the chat-history and trace-history collection refs so React does not rebuild Firestore subscriptions/queries every render
  - kept all new trace history reads bounded (`limit(20)` for trace summaries, `limit(100)` for event detail)
- Added a teammate-facing implementation note:
  - `CRC_GUIDANCE_TRACE_STREAM_V1.md`
- Current known limitation:
  - the CRC browser currently reads saved trace history directly from Firestore; if remote Firestore rules block `guidance_traces/*`, the safer fallback will be dedicated backend list/detail trace endpoints rather than broader browser reads.
- Follow-up UI hardening:
  - restructured the docked guidance layout so `Patient AI Guidance History` no longer competes with the fixed 3-row guidance card grid
  - changed live trace save-state rendering so in-progress traces show `Save status pending` instead of the misleading early `Not saved` state
- Follow-up deploy fix:
  - discovered that `functions/index.js` had not re-exported `sideEffectGuidanceTraceStreamHttp`, so the first targeted Firebase deploy could not actually publish the new streaming endpoint
  - patched the root functions entrypoint to import/export the new streaming function before redeploy
  - redeployed `functions:sideEffectGuidanceTraceStreamHttp` successfully to `traillight-4750b`
  - verified the remote function update path returned a live HTTPS endpoint for the CRC reasoning trace stream
- Runtime hotfix after first live smoke test:
  - traced the CRC-side streaming failure to `guidanceRuntime.js` calling `buildSourceMask(...)` without defining that helper on the server side
  - added the missing backend `buildSourceMask` helper so the live reasoning trace path can resolve `sourceMask` without crashing before the final answer
- Guidance key rotation / redeploy follow-up:
  - confirmed the local CRC guidance path is configured for `firebase-callable` instead of browser-first direct Gemini fallback
  - confirmed the root `functions/.env` now points at a replacement Gemini API key after the previous key was rejected as leaked by Google
  - redeployed the CRC side-effect guidance backend functions to `traillight-4750b` so the rotated key is active in the live runtime:
    - `sideEffectGuidanceTraceStreamHttp`
    - `sideEffectGuidanceChat`
    - `sideEffectGuidanceChatHttp`
    - `classifyGuidanceRoute`
    - `classifyGuidanceRouteHttp`
  - deploy completed successfully, so the previous `403 Forbidden` leaked-key failure should no longer come from stale remote function configuration
- CRC Side Effect Guidance split-pane implementation:
  - added a new left-pane mixed timeline component:
    - `src/components/PatientConversationTimeline.jsx`
  - reworked the CRC `side-effect-guidance` workspace layout in `src/pages/CRCHome.jsx` into a stable two-pane grid:
    - left pane = patient / AI / CRC mixed timeline
    - right pane = existing CRC guidance runtime and trace surface
  - removed the external `Patient context` card from the active split-pane surface by disabling that legacy panel path in `CRCHome.jsx`
  - kept the existing right-pane `GeminiChatbot` behavior intact:
    - CRC detailed reasoning trace
    - `Patient AI Guidance History`
    - existing CRC guidance input / output flow
- Conversation timeline mirror layer:
  - added root conversation timeline service helpers:
    - `src/services/conversationTimelineService.js`
  - added patient-app conversation timeline service helpers:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/conversationTimelineService.js`
  - introduced the derived Firestore collection:
    - `users/{patientUid}/conversation_timeline/*`
  - timeline events now normalize:
    - `actorType`
    - `channelType`
    - `threadType`
    - `alertId`
    - `sourcePath`
    - `messageText`
    - `timestamp`
    - `displayName`
    - optional `guidanceTrace` summary
- CRC/patient human chat mirror writes:
  - upgraded both root and patient `alertService.js` files to mirror message writes into `conversation_timeline`
  - applied batch-style writes so source-of-truth chat writes and derived timeline writes commit together where possible
  - direct-message sends now mirror as `threadType=direct_message`
  - urgent alert thread messages now mirror as `threadType=urgent_alert`
- Patient AI guidance mirror writes:
  - upgraded patient `GeminiChatbot.js` so patient-side `ai_chat_history` writes also mirror into `conversation_timeline`
  - mirrored message types include:
    - patient -> AI prompt
    - AI -> patient final answer
    - patient-side audit/system note
  - intentionally excluded the one-time introductory AI greeting from the mixed timeline to avoid left-pane noise
  - patient AI timeline entries now attach persisted `guidanceTrace` summaries when available so CRC can expand patient-safe reasoning trace directly from the left pane
- Read-storm safety:
  - left-pane mixed timeline uses one bounded realtime listener only:
    - `orderBy('timestamp', 'desc')`
    - `limit(100)`
  - older history uses explicit manual paging instead of opening more live listeners
  - no old-message backfill was added in this wave; the new timeline only mirrors messages written after this implementation
- Verification:
  - `npm run build:crc` passed after the split-pane and mixed timeline changes
  - `npm --prefix "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" run export:web` passed after the patient-side timeline mirror changes
- Current caveat:
  - this workspace still does not contain a repo-managed Firestore rules file or `firebase.json` Firestore rules target, so `conversation_timeline` remote read/write authorization still depends on the currently active remote Firebase rules rather than a newly committed rules file in this repo
- CRC Adverse Event Guidance UI refresh:
  - renamed the CRC-facing `Side Effect Guidance` surface to `Adverse Event Guidance` across the active CRC workspace UI:
    - sidebar label
    - workspace title
    - open-workspace action copy
    - docked guidance panel title and placeholder/error text
  - cleaned up additional CRC web copy so visible supervisor-facing `side effect` wording now reads `adverse event` in:
    - guidance service error copy
    - history page label
    - protocol manager guidance/indexing notes
    - incident detail empty state
    - CRC login helper copy for patient account usage
  - converted the large `Patient AI Guidance History` side block into a compact dropdown-driven review surface:
    - new title `Patient AI Adverse Event History`
    - dropdown selection of saved turns
    - detail trace only expands below the selector when one saved turn is chosen
  - upgraded the CRC split-pane workspace so the left mixed timeline and right adverse event guidance pane can be resized by dragging a vertical divider
  - persisted the CRC split-pane width locally so the chosen left/right pane balance survives page refreshes in the same browser
  - tightened the mixed timeline copy so the left pane explicitly describes one time-ordered adverse event communication stream across patient / AI / CRC
- Verification:
  - `npm run build:crc` passed after the adverse event rename, dropdown history refactor, and resizable split-pane changes
- CRC workspace follow-up cleanup:
  - removed the extra helper copy under `Patient Mixed Timeline`
  - removed the extra helper copy under `Patient AI Adverse Event History`
  - simplified the history selector UI by removing the visible `Saved turns` label and the empty-state review hint copy
  - kept the existing Adverse Event Guidance runtime and reasoning-trace behavior unchanged while tightening the visible UI copy only
- Patient workspace cleanup:
  - removed the `Tasks` tab from the active CRC patient workspace tab set
  - removed the patient-workspace header explainer copy
  - replaced the old compact patient meta row under the patient name with labeled fields:
    - `Subject ID`
    - `Email`
    - `CRC`
    - `Protocol`
  - restored a guarded `Delete patient` action inside `Patient configuration`
    - opens a modal dialog
    - requires typing `DELETE` before the action becomes available
    - current implementation removes the primary `users/{patientUid}` record from the live CRC roster/workspace path
- Verification:
  - `npm run build:crc` passed after the patient workspace cleanup and guarded delete-flow restore
- CRC safety workspace and shell polish:
  - updated the `Safety` filter controls from a single-column stack to a 2x2 layout that matches the requested order:
    - `All due states`
    - `All severities`
    - `Filter by protocol`
    - `All active statuses`
  - narrowed the top-right `Urgent` counter so it now tracks only the latest unresolved items that still need direct CRC handling:
    - abnormal vital incidents
    - actionable adverse event incidents assigned to the current CRC
  - stopped using the broader global serious-incident summary for that header button because it overstated urgency outside the requested scope
  - fixed the collapsed CRC sidebar width regression so the sidebar no longer keeps expanded width and overlays the workspace content after collapse
- Verification:
  - `npm run build:crc` passed after the safety filter layout update, urgent-header filtering change, and collapsed-sidebar width fix
- Live deploy:
  - deployed the updated CRC website to Firebase Hosting target `triallight`
  - deployed the updated patient website to Firebase Hosting target `triallight-patient`
  - project id remained `traillight-4750b`
- Verification:
  - remote hosting deploy completed successfully for both sites
  - CRC Hosting URL: `https://triallight.web.app`
  - patient Hosting URL: `https://triallight-patient.web.app`

## 2026-05-11 - Dropout live publish runtime capped to recent context window

- Reworked the live dropout history builder so GitHub Actions no longer has to replay every day from protocol anchor to today for each patient.
- The live adapter now:
  - keeps only a controlled recent history context window (default `30` days)
  - preserves the real global `day_index` for the published history rows
  - clips stale `days_since_last_*` style features to a controlled ceiling instead of rebuilding unlimited day-by-day history
- Added explicit publish progress logs around:
  - `patient_history_build_started/completed`
  - `patient_score_started/completed`
- Added workflow env knobs and manual-dispatch inputs so GitHub debugging can target a small patient slice without rerunning the full batch:
  - `DROPOUT_LIVE_HISTORY_CONTEXT_DAYS`
  - `DROPOUT_LIVE_STALENESS_CAP_DAYS`
  - `limit_patients`
  - `firebase_uids`
  - `skip_testing_subject_sync`

## 2026-05-11 - Subject ID mapping hardened for CRC disengagement prediction

- Hardened the CRC patient configuration save path for `Subject ID`.
- Saving a mapped `Subject ID` now validates:
  - the selected canonical subject belongs to the current protocol's `dropout_trial_id`
  - the canonical subject is not already assigned to another patient record
- Updated the patient configuration copy so CRC users see that:
  - `Subject ID` is a CRC-only disengagement mapping bridge
  - it does not affect patient login
  - clearing it is allowed, but that patient will drop out of CRC-only disengagement scoring until remapped

## 2026-05-11 - CRC disengagement explainability fallback copy cleaned up

- Improved the CRC explainability fallback rendering so legacy snapshot fields no longer surface raw internal signals such as `attention_peak: ...` in the user-facing summary.
- `Why this patient is flagged` now translates legacy internal signals into CRC-readable English bullets.
- `Data gaps affecting confidence` no longer mixes in `confidence_high`; confidence state remains in the dedicated `Confidence and stability` block.

## 2026-05-11 - CRC safety numbering and mixed-timeline direct-message repair

- Added continuous visible numbering across the current filtered page windows for:
  - `Safety > Open`
  - `Safety > Resolved`
  - `Safety > History`
  - `Patients` roster
- `Safety > Open` and `Safety > Resolved` now render a leading row number on each incident card using the active incident pagination window.
- `Safety > History` now renders a leftmost `#` column using the active history pagination window.
- `Patients` roster now renders a leading index column that stays continuous across roster pages and reflows with roster filters/search.
- Replaced the CRC mixed-timeline direct-message send path with a backend callable:
  - new callable: `sendCrcPatientDirectMessage`
  - authenticates CRC server-side
  - validates the patient workspace
  - reuses the latest `type=MESSAGE` alert thread or creates one if missing
  - writes the child message under `users/{patientUid}/alerts/{alertId}/messages/*`
  - updates the parent alert metadata
  - mirrors the outgoing CRC message into `users/{patientUid}/conversation_timeline/*`
- Updated the CRC mixed timeline UI to call the backend send path instead of relying on browser-side direct writes into patient `alerts/*`.
- Improved CRC mixed-timeline send failure handling:
  - the composed message now stays in the input on failure
  - a clearer inline error is shown near the composer instead of only far above in the timeline

- Verification:
  - `node --check functions/crcAdminRuntime.js` passed
  - `node --check functions/index.js` passed
  - `node --check src/services/crcDirectMessageService.js` passed
  - `npm run build:crc` passed

- Live deploy:
  - deployed Firebase Function `sendCrcPatientDirectMessage` to project `traillight-4750b`
  - remote update completed successfully for `sendCrcPatientDirectMessage(us-central1)`

- Follow-up fix:
  - removed the backend direct-message thread lookup dependency on the higher-risk Firestore compound query
  - the callable now loads a bounded recent alert window ordered by timestamp and resolves the latest `MESSAGE` thread in server memory
  - this reduces the chance of CRC direct-message sends failing because of a missing Firestore composite index on the patient `alerts` subcollection
- Verification:
  - `node --check functions/crcAdminRuntime.js` passed
  - `npm run build:crc` passed
- Live deploy:
  - redeployed Firebase Function `sendCrcPatientDirectMessage` after the query-hardening fix
  - remote update completed successfully for `sendCrcPatientDirectMessage(us-central1)`

## 2026-05-12 - ePRO queue UI split for Submitted vs Overdue and review cutoff moved to 1 PM

- Updated the CRC ePRO review workspace so the `Submitted / Overdue` section is no longer one mixed list.
- Added a pill-style switch toggle in:
  - `src/components/EproReviewWorkspace.jsx`
  - `src/index.css`
- The toggle now lets CRC review:
  - `Submitted`
  - `Overdue`
  as separate filtered views while preserving the current mirrored Firestore operational data source.
- Fixed the misleading mixed-list behavior where overdue records could still appear with raw `ASSIGNED` wording inside the combined list.
  - The new section now filters by derived operational status before pagination.
- Adjusted the ePRO summary layout in the CRC workspace to stop the `Today's ePRO review queue` header area from crowding and wrapping badly.
  - Reworked the summary card layout so:
    - intro copy
    - action buttons
    - review window note
    - metric cards
    render in stable blocks instead of collapsing into one cramped row
- Changed the default ePRO review timing in:
  - `supabase/functions/_shared/eproReviewCore.ts`
- New defaults are now:
  - review window opens at `9:00 AM`
  - unapproved drafts auto-release at `1:00 PM`
  - patient due time remains `11:59 PM`
- Updated the CRC ePRO summary note so it now displays the review window as a time range and explicitly states that unapproved drafts auto-release at the cutoff time.

- Verification:
  - `npm run build:crc` passed

## 2026-05-12 - ePRO protocol-specific questionnaire generation wired into the real runtime

- Investigated Li Qiu's questionnaire generation path after testing showed different patient protocols still produced the same daily ePRO baseline questions.
- Confirmed the main issue was not just "missing automation" between the old manual scripts:
  - `li qiu's part questionnaire ePRO/idp_testing.js`
  - `li qiu's part questionnaire ePRO/generate_dynamic_questions.js`
  - `li qiu's part questionnaire ePRO/epro_config.json`
- Root cause in plain terms:
  - the live patient app runtime was not using those manual scripts at all
  - the real Supabase edge ePRO path was still falling back to one shared hardcoded baseline questionnaire for everyone
  - so changing protocol in testing did not automatically change the real questionnaire baseline seen by the patient app
- Added protocol-aware baseline generation to the active shared ePRO runtime:
  - `supabase/functions/_shared/eproShared.ts`
  - baseline questions are now generated from protocol chunks stored in Supabase `guidance_documents`
  - semantic retrieval uses `match_guidance_documents(...)` with protocol filters when available
  - fallback direct chunk reads also filter by protocol id / protocol name
  - the generated baseline is sanitized into valid ePRO question structure before use
- Updated the daily review flow so trial-level daily questionnaire baselines are protocol-specific instead of always cloning the old global fallback:
  - `supabase/functions/_shared/eproReviewCore.ts`
  - new trial reviews now build baseline questions from protocol context
  - pending trial reviews that still match the old fallback baseline are eligible for automatic upgrade
  - patient-level customized follow-up questions are still built on top of the protocol baseline, not instead of it
- Updated the patient app ePRO service and screen so the active runtime always sends protocol context explicitly:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
  - the app now forwards `protocol_id` and `protocol_name` for both fetch and submit flows
- Completed the missing end-to-end parameter wiring in the Supabase edge entrypoints:
  - `supabase/functions/_shared/eproCore.ts`
  - `supabase/functions/epro-daily-survey/index.ts`
  - `supabase/functions/epro-submit/index.ts`
  - before this, the patient app could send protocol metadata but the live edge entrypoints did not pass it all the way into the review core
  - now the review core can use explicit protocol metadata immediately, while still falling back to the Firebase user profile when needed
- Mirrored the same protocol-aware baseline behavior into the local Node demo server so manual testing does not drift away from the live runtime:
  - `li qiu's part questionnaire ePRO/server_integrated.js`

- Verification:
  - reviewed the active live path and confirmed the real runtime is:
    - patient app -> `src/services/eproService.js`
    - Supabase edge functions -> `supabase/functions/epro-daily-survey` and `supabase/functions/epro-submit`
    - shared review logic -> `supabase/functions/_shared/eproCore.ts` and `supabase/functions/_shared/eproReviewCore.ts`
  - `node --check "li qiu's part questionnaire ePRO/server_integrated.js"` passed
  - `node --check "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js"` passed
  - `node --check "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js"` passed
  - `npm --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2" run export:web` passed
  - local TypeScript-only Supabase files were manually re-reviewed after patching because `deno` is not installed in this workspace shell
  - deploy-time Supabase bundling also exposed and confirmed one hidden TypeScript syntax bug in `supabase/functions/_shared/eproShared.ts`
    - fixed `const baseQuestionIds = new string[]();`
    - replaced with `const baseQuestionIds: string[] = [];`
  - deployed to Jianhong/Kuro Supabase project `fygkqituefwldmglijvy`:
    - `epro-daily-survey`
    - `epro-submit`

## 2026-05-11 - Patient adverse effect guidance now shows CRC direct messages

- Updated the patient `GeminiChatbot` guidance history surface so the patient-side `AI Adverse Effect Guidance` modal now renders from the mirrored `conversation_timeline` stream instead of showing only `ai_chat_history`.
- This means the patient guidance view now preserves and replays one combined timeline containing:
  - patient -> AI adverse effect guidance messages
  - AI -> patient guidance replies
  - patient guidance audit/system notes
  - CRC -> patient direct messages mirrored from the CRC mixed timeline
  - patient -> CRC replies mirrored from direct-message or urgent chat threads
- Kept the existing patient AI save path intact:
  - AI guidance still writes to `users/{patientUid}/ai_chat_history/*`
  - the UI change only affects what the patient guidance modal reads and displays
- Added a distinct CRC message bubble treatment inside the patient guidance modal so patient users can clearly differentiate CRC manual messages from AI guidance replies.
- Renamed the visible patient-side `AI Side Effect Guidance` wording to `AI Adverse Effect Guidance` across the patient app home and guidance modal surfaces.

- Verification:
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js` passed
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js` passed
  - `npm --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2" run export:web` passed

## 2026-05-11 - Patient guidance wording corrected from Adverse Effect to Adverse Event

- Corrected the visible patient-side guidance wording so the patient website now uses:
  - `AI Adverse Event Guidance`
  instead of:
  - `AI Adverse Effect Guidance`
- Updated the patient guidance modal title, empty-state copy, patient home card title, hero summary copy, and the patient home CTA label so the terminology is consistent.

- Verification:
  - no remaining `Adverse Effect` wording was found under `MyClinicalApp2/src`
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/GeminiChatbot.js` passed
  - `node --check MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js` passed
  - `npm --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2" run export:web` passed

## 2026-05-11 - Terry adverse event trace bundle script added

- Added a packaging script for Terry so the recent adverse event guidance reasoning trace code can be bundled into one zip with repo-relative paths preserved.
- New script:
  - `scripts/package-terry-ai-adverse-event-trace.ps1`
- The script currently bundles:
  - shared Firebase Functions adverse event guidance trace runtime
  - CRC adverse event guidance trace UI and services
  - patient adverse event guidance trace UI and services
  - mirrored conversation timeline and CRC direct-message integration files that now feed the patient guidance view
  - `CRC_GUIDANCE_TRACE_STREAM_V1.md`
- The script also writes a `BUNDLE_MANIFEST.md` into the staging folder so Terry can see exactly which files were included and why.
- The script intentionally leaves the staging folder in place after packaging for audit/manual review.

- Verification:
  - executed `scripts/package-terry-ai-adverse-event-trace.ps1` successfully
  - generated staging folder:
    - `artifacts/terry-ai-adverse-event-trace/terry-ai-adverse-event-trace-20260511-232922`
  - generated zip:
    - `artifacts/terry-ai-adverse-event-trace/terry-ai-adverse-event-trace-20260511-232922.zip`
## 2026-05-11 - Canonical subject pool sync fix

- Root-caused the empty `Subject ID` dropdown after setting `dropout_trial_id=NCT00003453`.
- Confirmed the live `dropout_testing_subjects` mirror was still empty for `NCT00003453`, even though the local canonical registry contains `TL-S00001` to `TL-S00012`.
- Fixed `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` so `publish_testing_subjects()` always mirrors the canonical dropout registry CSV into Supabase instead of rebuilding the subject pool from current Firestore patient mappings.
- Mirrored the same fix into `.dropout-main-worktree/src/publish_dropout_snapshots.py` so the next push to the dropout repo `main` uses the corrected subject-pool sync behavior.
- This prevents `skip_testing_subject_sync=false` runs from producing an empty subject pool simply because patient mappings were cleared to `No mapped subject ID`.

## 2026-05-11 - Canonical TL subject sync source correction

- Identified a second root cause in the subject-pool sync path: the prior fix still sourced subjects from `triallight_dropout_testing.csv`, which yields raw legacy IDs like `NCT..._P000x` rather than CRC-facing canonical IDs like `TL-S00012`.
- Updated both `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` and `.dropout-main-worktree/src/publish_dropout_snapshots.py` so `publish_testing_subjects()` now prefers `deploy_assets/data/triallight_subject_id_map_v35subjectid.csv`.
- This makes the mirrored `dropout_testing_subjects` pool publish canonical `TL-SXXXXX` rows for `NCT00003453`, which is what the CRC UI expects and filters for.

## 2026-05-12 - Progress interval crash fix

- Fixed a regression in `publish_dropout_snapshots.py` where `_progress_interval()` could return `None` whenever `DROPOUT_PROGRESS_EVERY` was set.
- The bug caused GitHub Actions live publish runs to crash at `position % progress_interval` with `TypeError: unsupported operand type(s) for %: 'int' and 'NoneType'`.
- Restored the intended `try/except` parsing inside `_progress_interval()` and removed the misplaced dead code from `_normalize_text()`.

## 2026-05-12 - Publish early insufficient-history states

- Confirmed that the live publish run was excluding all five real patients before scoring because `usable_live_history` required at least 3 generated history rows.
- This conflicted with the model contract: day 1-2 patients are intentionally routed to `insufficient_history` / `collect_more_history`, not treated as runtime failures.
- Updated both `Patient-Dropout-Prediction/src/live_data_adapter.py` and `.dropout-main-worktree/src/live_data_adapter.py` to use a dedicated `DROPOUT_LIVE_MIN_PUBLISHABLE_HISTORY_DAYS` threshold with a default of `1`.
- The publish pipeline still requires at least one operational source, but it now allows early-study patients with 1-2 days of data to publish CRC-visible no-score states instead of failing the whole run.

## 2026-05-12 - ePRO review queue layout cleanup and Submitted/Overdue toggle refinement

- Reworked the CRC ePRO review queue summary so the title/description, action buttons, review-window note, and metric cards no longer collapse into the broken narrow-column layout.
- Kept the ePRO product logic intact while changing the visual structure to a more stable two-zone summary header with the metrics row below it.
- Refined the mirrored ePRO operational section so it now renders:
  - the explanatory lines first
  - the `Submitted / Overdue` segmented toggle with counts
  - the pagination controls below, matching the requested visual hierarchy
- Updated the review-window wording to explicitly state that if CRC does not approve by the cutoff, questionnaires auto release.
- Set the default shared review timing in the ePRO review core to:
  - review build at `9:00 AM`
  - CRC cutoff / auto release at `1:00 PM`
  - patient due at `11:59 PM`

- Verification:
  - `npm run build:crc` passed

## 2026-05-12 - CRC hosting, ePRO edge functions, and dropout registry functions deployed

- Deployed the CRC dropout registry Firebase Functions to `traillight-4750b`:
  - `configureProtocolDropoutTrial`
  - `ensureDropoutTrialRegistryTrial`
  - `refreshConfiguredDropoutTrialRegistry`
- Deployed the Supabase ePRO edge functions to project `fygkqituefwldmglijvy`:
  - `epro-daily-survey`
  - `epro-submit`
- Deployed the latest CRC web build to Firebase Hosting:
  - target: `hosting:crc`
  - URL: `https://triallight.web.app`

- Notes:
  - the dropout registry frontend/runtime changes are now live for the CRC web app and Firebase callable path
  - the ePRO review window backend now uses the updated `9:00 AM` to `1:00 PM` review/auto-release timing
  - `publish_dropout_snapshots.py` was updated locally, but it is not a deployable service by itself; it still depends on the repo/workflow execution path that uses that script

## 2026-05-12 - Protocol-specific ePRO baseline hardening and stale fallback removal

- Removed the silent global baseline fallback path from the shared ePRO questionnaire runtime.
- `buildProtocolBaselineQuestions(...)` now feeds into runtime validation that blocks questionnaire release when:
  - no protocol is assigned
  - no indexed protocol guidance chunks exist
  - Gemini generation fails
  - the generated result collapses back to the deprecated global `skin issues` baseline
- Hardened `ensurePatientDailyReview(...)` so protocol-bound patients no longer reuse `default-epro` / `TrialLight baseline ePRO` defaults.
- Changed patient questionnaire serving and submission to require a validated protocol-specific effective questionnaire instead of silently returning `cloneBaselineConfig()`.
- Allowed existing same-day trial reviews that were created with the old fallback baseline to attempt in-place regeneration from indexed protocol guidance; if regeneration still fails, the patient now sees an honest error instead of the misleading fallback questionnaire.
- Filtered the CRC ePRO review workspace to only show reviews for patients whose current protocol review could actually be prepared, preventing deleted or invalid protocol rows from polluting today's queue.
- Extended CRC protocol deletion so future protocol deletes also clean linked Supabase ePRO trial and patient review rows for that protocol ID.

- Verification:
  - `npm run build:crc` passed

## 2026-05-12 - Protocol-specific ePRO hardening deployed to Supabase

- Deployed the updated Supabase ePRO runtime functions to project `fygkqituefwldmglijvy`:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`
- The live runtime now uses the hardened shared logic that:
  - blocks silent fallback to the deprecated global `skin issues` questionnaire
  - throws explicit protocol-specific errors when no protocol, no chunks, or invalid generated baseline exists
  - allows same-day stale fallback trial reviews to be regenerated in place when a valid indexed protocol exists
  - stops CRC queue rendering from surfacing reviews for patients whose current protocol review could not be prepared successfully

- Notes:
  - already-created stale review rows for deleted protocols are not retroactively deleted by deployment alone; future protocol deletes now clean linked ePRO review rows automatically

## 2026-05-12 - Supabase fallback comparison bug fixed for live ePRO rows

- Identified a production bug in the protocol-specific ePRO hardening path:
  - live Supabase review rows were storing question objects with a different field order than the local `baselineConfig.ts`
  - direct `JSON.stringify(...)` comparison therefore failed to recognize that those rows were still the exact deprecated global `skin issues` fallback
- Replaced the question comparison helper with canonical field-by-field normalization so fallback detection now ignores object key order.
- Re-deployed the affected Supabase functions after that fix:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`
- Expected live behavior after this deploy:
  - old same-day fallback rows should no longer slip through as if they were protocol-specific
  - if Gemini generation still fails (for example because the active Gemini key is expired), patients now see the honest error instead of the misleading skin questionnaire

## 2026-05-12 - Supabase ePRO Gemini secret rotated and runtime re-deployed

- Updated the live Supabase `GEMINI_API_KEY` secret for the Jianhong ePRO runtime after production questionnaire generation started returning `API_KEY_INVALID`.
- Re-deployed the full ePRO function set so the new live key is picked up consistently across:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`

- Expected live behavior after this rotation:
  - protocol-specific questionnaire generation should no longer fail because of the expired Gemini key
  - patients with valid indexed protocols should either receive protocol-specific questionnaires or explicit protocol-generation errors, but not the deprecated global skin fallback

## 2026-05-12 - ePRO queue compact layout follow-up deployed

- Restored the CRC ePRO review queue to a tighter top-row layout closer to the earlier compact composition:
  - intro copy on the left
  - action buttons and metric cards grouped in the middle
  - review window note on the right
- Removed the extra `Submitted / Overdue` heading so the segmented toggle now acts as the visible section control.
- Reordered the mirrored ePRO operational block to:
  - toggle
  - explanatory lines
  - pagination controls
  - rows
- Deployed the additional Supabase edge functions that actually power the CRC queue and approvals:
  - `epro-review-queue`
  - `epro-review-action`
- Re-deployed `hosting:crc` after the compact ePRO UI changes.

- Verification:
  - `npm run build:crc` passed before deploy

## 2026-05-12 - ePRO review window source and mirrored count conflict fixed

- Removed the duplicate mirrored-record count line in the CRC ePRO `Submitted / Overdue` block by stopping the extra parent-supplied window label from rendering there.
- Locked the shared ePRO review timing in `eproReviewCore.ts` to the requested fixed schedule:
  - draft build at `9:00 AM`
  - CRC cutoff / auto release at `1:00 PM`
  - patient due at `11:59 PM`
- This avoids stale Supabase environment values from silently forcing the older `6:00 AM` to `9:00 AM` review window back into the CRC workspace copy.

- Verification:
  - `node --check D:\\IDP For Integration\\supabase\\functions\\_shared\\eproReviewCore.ts` passed
  - `npm run build:crc` passed

## 2026-05-12 - ePRO queue summary wording, pagination note, and released list tightening

- Updated the ePRO summary metric labels to:
  - `Pending Trials Review`
  - `Pending Patients Review`
- Centered the four summary metric cards so their labels and counts sit on one shared horizontal rhythm instead of drifting inside each tile.
- Changed the CRC-side review-window summary rendering to use the fixed intended schedule directly in the UI:
  - `9:00 AM` review start
  - `1:00 PM` CRC cutoff / auto release
  - `11:59 PM` patient due
- This prevents stale or conflicting backend timestamps from continuing to show `6:00 AM - 9:00 AM` in the CRC web summary copy.
- Refined the `Submitted / Overdue` pagination note to show the actual visible count versus the filtered total, reducing the false impression that page-size switching is broken.
- Tightened the `Released Today` rows so the released list uses less vertical space while preserving the same release logic and data.

- Verification:
  - `npm run build:crc` passed

## 2026-05-12 - CRC sidebar wording and active protocol PDF fallback

- Renamed the CRC workspace sidebar labels to:
  - `Clinical Trial Protocols`
  - `Electronic Patient Reported Outcome, ePRO`
- Fixed protocol PDF opening for older patient records that already have an assigned protocol but do not carry a populated `protocolUrl` field on the patient document.
- Added a fallback so CRC now opens the assigned protocol from the loaded protocol template `storagePath` when the patient record is missing its direct protocol file path.
- Applied the same fallback to the AI scheduler protocol read path and the guidance-side `Open protocol` action.
- Improved the `Active protocol` empty-state note so it distinguishes:
  - no patient / no assignment
  - assigned protocol exists but its PDF path is still unavailable
  - `node --check D:\\IDP For Integration\\supabase\\functions\\_shared\\eproReviewCore.ts` passed

## 2026-05-13 - GitHub handoff manuals for full TrialLight codebase sharing

- Added a beginner-friendly English onboarding manual for Yunhong to clone the full TrialLight workspace from GitHub, including the root repo plus both submodules:
  - `YUNHONG_GITHUB_ONBOARDING.md`
- Added an owner-side preparation checklist covering:
  - repo access
  - submodule pointer readiness
  - push-before-handoff requirements
  - secrets separation
  - minimum collaboration rules
  - `OWNER_PREP_FOR_YUNHONG_GITHUB_HANDOFF.md`
- Documented the current TrialLight GitHub structure explicitly so the handoff is less likely to fail because of missing submodules or misunderstood repo ownership.
- Expanded the Yunhong onboarding manual to include:
  - exact collaboration branches for the root repo and both submodules
  - dependency install steps
  - environment file setup
  - local preview commands for CRC web, patient app web, and dropout Python setup
  - explicit rule that Yunhong must not push directly to `main`
