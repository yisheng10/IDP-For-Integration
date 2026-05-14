# Patient Auth Reset Migration Runbook

## Purpose

This runbook defines the fallback migration path for legacy patient logins when password-preserving Firebase Auth export is not available.

The target outcome is:

- preserve the same Firebase `uid`
- preserve the patient Firestore path `users/{uid}`
- create missing Terry Firebase Auth users with a temporary random password
- force patients onto a password reset flow instead of attempting to keep the legacy password

This approach is less elegant than a hash-preserving migration, but it avoids breaking patient record linkage.

## Why UID Preservation Is Mandatory

The active patient app reads and writes directly under:

- `users/{uid}`
- `users/{uid}/vitals`
- `users/{uid}/appointments`
- `users/{uid}/alerts`
- `users/{uid}/epro_submissions`
- `users/{uid}/side_effect_reports`
- `users/{uid}/ai_chat_history`

If a migrated patient receives a new Firebase UID, those records no longer line up with the signed-in account.

Because of that, any fallback migration must still preserve the legacy UID.

## Current Status

- The ePRO Supabase edge functions now validate Terry Firebase tokens.
- Legacy patient login failures are primarily caused by missing Auth users in `traillight-4750b`.
- Password-preserving import is blocked because the currently available old-project credentials do not expose real password hash material / hash config.

## Tooling

Prepared script:

- `functions/scripts/backfill-patient-auth-reset.mjs`

Functions shortcut:

- `node ./scripts/backfill-patient-auth-reset.mjs`

## Required Environment

- `SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON`
  - old Firebase project service account path
- `TARGET_FIREBASE_SERVICE_ACCOUNT_JSON`
  - Terry Firebase project service account path

Optional:

- `PATIENT_RESET_CONTINUE_URL`
  - continue URL embedded in reset links
- `PATIENT_FIRESTORE_USER_SUBCOLLECTIONS`
  - comma-separated override for copied patient subcollections
- `PATIENT_FIRESTORE_ALERT_SUBCOLLECTIONS`
  - comma-separated override for copied nested alert subcollections

## Dry-Run First

Default behavior is dry-run only.

Recommended first pass:

```bash
node functions/scripts/backfill-patient-auth-reset.mjs
```

Output:

- `.firebase/patient-auth-reset-plan.json`

This dry-run:

- compares old vs new Auth users
- identifies missing Terry Firebase patient accounts
- checks `users/{uid}` profile document presence in both projects
- does **not** write Auth users
- does **not** copy Firestore records

## Optional Deeper Inspection

If you need per-user patient subcollection counts before execution:

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --inspect-subcollections
```

This consumes more Firestore reads because it counts source-side patient subcollection documents for the scoped users.

If you want to preview or later execute only the automatically safe subset:

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --clean-only
```

This skips accounts that the plan marks for manual review, such as:

- email collision against a different Terry UID
- missing source `users/{uid}` profile
- missing `subject_id` in the source patient profile

## Dangerous Execution Modes

The following flags perform real remote writes and must only be run deliberately.

### 1. Create missing Terry Auth users with the same UID

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --execute-auth --clean-only
```

Behavior:

- creates only missing target-side patient Auth users
- preserves the old UID
- assigns a random temporary password
- does not attempt to preserve the old password

### 2. Copy patient Firestore profile + selected subcollections

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --execute-firestore --clean-only
```

Behavior:

- copies `users/{uid}`
- copies selected patient subcollections with the same document IDs
- preserves the existing Firebase UID linkage

### 3. Generate password reset links

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --generate-reset-links --clean-only
```

Output:

- `.firebase/patient-password-reset-links.json`

This generates reset links for the target-side patient accounts so the team can coordinate password resets.

If Firebase rejects the continue URL because the domain is not allowlisted, use:

```bash
node functions/scripts/backfill-patient-auth-reset.mjs --generate-reset-links --clean-only --no-continue-url
```

That falls back to Firebase's default hosted password reset flow without embedding a custom continue URL.

## Suggested Safe Order

1. Dry-run
2. Review `.firebase/patient-auth-reset-plan.json`
3. Execute Auth backfill
4. Execute Firestore backfill if required
5. Generate reset links
6. Coordinate patient communication / reset completion
7. Smoke-test real patient login and questionnaire flow

## Conflict Handling

The script flags email collisions where:

- old project UID is missing in Terry Firebase
- but the same email already exists under a different Terry UID

Those cases require manual review before any write is attempted.

## Read Quota Note

The basic dry-run is intentionally scoped to keep Firestore reads low.

It primarily uses:

- Firebase Auth user listing
- targeted `users/{uid}` profile checks only

It does **not** do a full Firestore collection scan.
