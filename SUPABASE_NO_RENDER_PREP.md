# TrialLight No-Render Preparation

This document replaces the earlier Render-first path for the final TrialLight architecture.

Target architecture:

- Firebase keeps Auth, Firestore, and Hosting.
- Supabase keeps protocol PDF storage, signed URLs, vector retrieval, ePRO backend logic, and dropout snapshot storage.
- GitHub Actions runs daily dropout precompute and publishes CRC-only mirrors to Firestore.

## 1. Existing Services To Keep

Keep these existing platform responsibilities unchanged:

- Firebase Auth for CRC and patient sign-in
- Firestore for operational data, chat, incidents, appointments, and mirrors
- Firebase Hosting for:
  - `https://triallight.web.app`
  - `https://triallight-patient.web.app`
- Supabase Storage bucket:
  - `protocol`
- Existing Supabase retrieval RPCs:
  - `match_documents`
  - `match_protocol_chunks`

## 2. Credentials And Access You Must Prepare

You do not need to commit any secrets into this repository.

Prepare these values from your dashboards:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `GEMINI_API_KEY`

Recommended source locations:

- Supabase Dashboard -> Project Settings -> General -> Reference ID
- Supabase Dashboard -> Project Settings -> API
- Firebase Console -> Project settings -> Service accounts -> Generate new private key
- Google AI Studio -> API keys

## 3. GitHub Actions Secrets To Add

Add these repository secrets before enabling automation:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `GEMINI_API_KEY`

## 4. Supabase Objects To Confirm

Before migration, confirm these existing objects still exist:

- bucket `protocol`
- RPC `match_documents`
- RPC `match_protocol_chunks`
- table `mock_patient_profiles`
- table `patient_daily_logs`

Current observed baseline in the active Supabase project may only include:

- Edge Function `process-pdf`
- table `documents`
- RPC `match_documents`

If `mock_patient_profiles`, `patient_daily_logs`, or the `protocol` bucket are missing, apply the
baseline migration below first.

## 5. New Supabase Tables To Create

Apply the SQL migration in:

- `supabase/migrations/20260323_triallight_no_render_baseline.sql`

This creates:

- `public.epro_subject_state`
- `public.mock_patient_profiles`
- `public.patient_daily_logs`
- `public.dropout_predictions`
- `public.dropout_testing_subjects`
- storage bucket row `protocol` if it does not already exist

The migration does not create broad anonymous storage policies. Keep storage permissions explicit
and testing-scoped.

## 6. New Firestore Mirror To Publish

The final CRC web dropout panel should read:

- `users/{uid}/dropout_predictions/current`

This mirror is intentionally CRC-only and should never be exposed on patient surfaces.

## 7. Next Implementation Stages

After the required credentials and tables are ready, the next implementation stages are:

1. Move ePRO runtime behavior from the legacy Node server into Supabase Edge Functions.
2. Update the patient ePRO client to call Supabase-backed endpoints instead of a standalone HTTP service.
3. Replace the CRC dropout HTTP adapter with a Firestore snapshot reader.
4. Add a GitHub Actions workflow that runs Python 3.12 dropout scoring daily and publishes Supabase + Firestore snapshots.

## 8. Important Constraints

- Do not introduce any new hardcoded secrets.
- Do not move Firebase Auth to Supabase Auth.
- Do not expose dropout risk fields on patient surfaces.
- Treat the current Python HTTP dropout service as a local/reference tool once precompute publishing is in place.
