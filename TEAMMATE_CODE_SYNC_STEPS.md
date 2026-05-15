# Teammate Code Sync Steps

This document tells `yunhong` and `jianhong` exactly how to get the latest integrated TrialLight code before continuing development and testing.

## Integration Baseline

Use these integration branches and commits as the source of truth:

- Root integration repo:
  - branch: `codex/merge-yunhong-jianhong-into-yisheng`
  - commit: `c330b25`
- Patient app submodule:
  - branch: `codex/merge-yunhong-jianhong-into-sync`
  - commit: `06c2f76`
- Dropout prediction submodule:
  - branch: `codex/candidate-024-disengagement-safe`
  - commit: `693e677`

Do **not** continue new work directly on the old `yunhong` or `jianhong` branches.

## Before You Start

If you already have uncommitted local changes, do one of these first:

1. Commit them to your own branch.
2. Or stash them.

Do **not** hard reset or delete work.

## Get The Latest Integrated Code

Run these commands from the root integration repository:

```powershell
git fetch origin
git checkout codex/merge-yunhong-jianhong-into-yisheng
git pull --ff-only origin codex/merge-yunhong-jianhong-into-yisheng
git submodule sync --recursive
git submodule update --init --recursive
```

After that, confirm the submodule commits:

```powershell
git -C MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2 rev-parse HEAD
git -C Patient-Dropout-Prediction rev-parse HEAD
```

Expected results:

- `MyClinicalApp2` -> `06c2f76`
- `Patient-Dropout-Prediction` -> `693e677`

## Start New Development From This Baseline

After you have the integrated baseline, create your own new branch.

Example:

```powershell
git checkout -b <your-new-root-branch>
```

If you need to continue patient app work inside the submodule, move the submodule onto a new branch based on the integrated patient app branch:

```powershell
git -C MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2 fetch origin
git -C MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2 checkout -b <your-new-patient-branch> origin/codex/merge-yunhong-jianhong-into-sync
```

If you need to continue dropout prediction work inside the submodule, branch from the agreed safe dropout line:

```powershell
git -C Patient-Dropout-Prediction fetch origin
git -C Patient-Dropout-Prediction checkout -b <your-new-dropout-branch> origin/codex/candidate-024-disengagement-safe
```

## Important Notes

- The patient app guidance HTTP client is already restored to production-default Firebase Functions routing.
- The root backend guidance runtime no longer uses the unsafe temporary auth bypass.
- Patient-facing guidance HTTP access is now formally supported for:
  - `retrieveGuidanceContextHttp`
  - `sideEffectGuidanceChatHttp`
  - `suggestAppointmentDateHttp`
- Other guidance-management HTTP endpoints remain CRC-only by design.

## If You Change A Submodule

If you commit new work inside a submodule, remember:

1. Commit and push the submodule branch first.
2. Then return to the root repo.
3. Stage the updated submodule pointer in the root repo.
4. Commit the root repo change.

Otherwise, other teammates will not get the correct submodule version when they update the root repo.

## Quick Verification

After syncing, these should be true:

- Root branch is `codex/merge-yunhong-jianhong-into-yisheng`
- Patient app submodule is at `06c2f76`
- Dropout prediction submodule is at `693e677`
- No local emulator-only Firebase Functions URL is hardcoded in the integrated patient app baseline
- No temporary HTTP auth bypass remains in `functions/guidanceRuntime.js`
