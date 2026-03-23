# Supabase Migration Notes

This folder contains the no-Render preparation assets for the final TrialLight architecture.

Current purpose:

- document the Supabase-side data objects needed for ePRO state and dropout snapshots
- store SQL migrations that can be applied manually in the Supabase SQL Editor
- keep future Edge Function implementation assets grouped in one place

Current migration entrypoint:

- `migrations/20260323_triallight_no_render_baseline.sql`

That migration now bootstraps the minimum ePRO and dropout tables plus the `protocol` bucket row.
It is safe to apply even if the current project only has the legacy `documents` table,
`match_documents`, and `process-pdf`.

This repository does not commit any live Supabase secrets.

Current function scaffolding:

- `functions/epro-daily-survey`
- `functions/epro-submit`

These functions are designed to:

- accept Firebase ID tokens from the patient surface
- read and write ePRO state inside Supabase
- keep Firestore as the mirrored CRC operational layer rather than the detailed questionnaire owner
