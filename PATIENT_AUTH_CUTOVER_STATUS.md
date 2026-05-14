# Patient Auth Cutover Status

## Scope

This document records the real current state of patient-account cutover into the TrialLight Firebase project:

- `traillight-4750b`

It exists so the migration status is no longer inferred indirectly from old dry-run plans.

## Current Cutover Position

The active migration path is:

- preserve Firebase `uid` whenever feasible
- preserve `users/{uid}` linkage
- use password-reset recovery instead of password-preserving import

This is the current truthful status:

- `16` clean legacy patient accounts were migrated into the TrialLight Firebase project with preserved UID
- `16` corresponding `users/{uid}` profile documents were copied
- `459` nested patient Firestore documents were copied during the clean migration batch
- `1` previously deleted patient account was restored:
  - UID `UAWfSS7KZmfY164jm26DwVLOSRN2`
- `1` email-collision case was reconciled by merging the legacy patient data into the already-existing Terry UID instead of creating a duplicate Auth user:
  - legacy source UID `Q5wxUBAt0hfuyIZW1mbrh3EtJnh1`
  - Terry target UID `43Sa3yF88BXBaucckMdzcmGxpM42`
- `5` legacy patient accounts were intentionally left decommissioned in the TrialLight Firebase project

## Decommissioned Legacy Accounts

These accounts were intentionally excluded from the TrialLight target and should be treated as decommissioned unless the team explicitly reverses that decision:

- `E8IRfIjUjPM0gkqknyJ4mdx3LNG2`
- `G54DviNgeybYqEI9Y214cbcLtMW2`
- `SpD7Lz3Qf9WXvqfX3pmt1oP9AK83`
- `WkWweQYYq6d3KIlEh6J7zpDDQx92`
- `aaM25DPZj3XO5h0mMdHAVsrybOn2`

## Reconciled Email-Collision Case

The remaining collision case was inspected and then reconciled instead of restored as a second TrialLight Auth user.

Why:

- the same email already existed in TrialLight under a different UID
- both source and target sides were patient accounts
- the TrialLight-side account was missing `subject_id`
- the legacy account still held usable patient data

What was done:

- kept the TrialLight Auth user in place
- merged the legacy profile into the TrialLight `users/{uid}` document
- copied the legacy patient subcollection data into the TrialLight `users/{uid}` path
- preserved a `legacy_uid_aliases` trace in the merged patient profile

This avoids duplicate patient logins while still preserving the useful legacy patient data.

## Operational Consequence

The cutover is no longer blocked by ambiguous patient-account state for the known reviewed backlog.

What still remains true:

- migrated/restored patients must use password reset to establish a new password
- the active patient login UI now exposes `Forgot password?`
- old-password preservation is still unavailable

## Patient Static-Context Backfill Status

Auth cutover and static scoring readiness are related but not identical.

After the patient-account reconciliation work, a separate Terry user-profile backfill was executed using the official disengagement subject registry as the source of:

- `age`
- `caregiver`
- `dist_km`

Real result:

- `17` TrialLight patient profiles received a safe static-context patch from the official subject registry
- this improved disengagement live dry-run scoreability from `0` patients to `3`

What still remains outside the Auth layer:

- a curated patient-to-subject assignment sync has now written `16` reviewed `subject_id` values back into TrialLight `users/{uid}` documents
- targeted live dry-run verification reduced the known `missing subject_id` blocker from `4` patient docs to `1`
- sparse live operational history now dominates the remaining disengagement scoring failures for the newly mapped patients

## Known Remaining Non-Auth Risk

Patient-side cutover can still fail operationally even if Auth is correct when:

- Firebase Functions / Hosting deploy permissions are insufficient on the Terry project
- ePRO or protocol-related runtime paths still depend on missing remote deploy steps

This means patient Auth recovery is now much closer to closed, but it is not the only remaining live-cutover dependency.
