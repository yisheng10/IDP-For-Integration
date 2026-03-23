# TrialLight Project Log

## Last Updated
- Date: 2026-03-23
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
