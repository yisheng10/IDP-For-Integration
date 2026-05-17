# Post-Main Workflow For Existing Local Checkouts

Use this guide only if you already have a local TrialLight checkout and now need to move back onto the official team baseline.

If you are starting from a brand-new folder, use `FRESH_CLONE_VALIDATION_STEPS.md` instead.

## Official Team Baseline

- Root integration repo: `main`
- Patient app repo: `main`

Expected patient app commit after submodule sync:

```text
a7a4a33
```

## What This Means In Plain Language

After the stable candidate was validated, the team baseline moved to `main`.

From now on:

1. sync the root repo to `main`
2. sync submodules
3. if you will edit patient app code, switch the patient submodule onto its `main`
4. create your own new feature branch

Do not keep building on older branches such as:

- `yisheng`
- `jianhong2`
- `jianhong3`
- `codex/merge-jianhong2-into-yisheng-v2`
- `codex/stable-candidate-20260517-rc1`

## Important Git Note

This project is not one single repo.

It includes:

- root repo: `IDP-For-Integration`
- patient app submodule: `IDP_PatientApp`
- dropout submodule: `Patient-Dropout-Prediction`

So:

- updating only the root repo is not enough
- you must also update submodules

## Step 1: Go To Your Existing Root Checkout

```powershell
cd /d "D:\IDP For Integration"
```

## Step 2: Save Any Local Work First

If you already have unfinished local work, do one of these first:

- commit it to your own branch
- or stash it

Example stash command:

```powershell
git stash push -m "my-local-work-before-switching-to-main"
```

Do not hard reset and do not delete files.

## Step 3: Sync The Root Repo To `main`

```powershell
git fetch origin
git checkout main
git pull --ff-only origin main
```

If `main` does not exist locally yet:

```powershell
git checkout -b main origin/main
```

## Step 4: Sync Submodules

```powershell
git submodule sync --recursive
git submodule update --init --recursive
```

## Step 5: Install Patient App Dependencies

```powershell
npm install --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2"
```

## Step 6: Verify The Root Repo

```powershell
git branch --show-current
```

Expected:

```text
main
```

## Step 7: Verify The Patient Submodule

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" branch --show-current
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" rev-parse HEAD
```

Important:

- after `git submodule update --init --recursive`, the patient submodule may land in detached `HEAD`
- this is normal
- the critical check is the commit hash

Expected patient commit:

```text
a7a4a33
```

## Step 8: If You Will Edit Patient App Code

If you only need to run the code, you can stop after Step 7.

If you will actually edit patient app code, run this first:

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" checkout main
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" pull --ff-only origin main
```

Why:

- submodule sync gives you the correct commit
- but it may not put you on a writable branch
- `checkout main` puts the patient repo back onto its official development baseline

## Step 9: Create New Branches For New Work

Do not develop directly on `main`.

### Root repo

```powershell
git checkout -b <your-new-root-branch>
```

### Patient app repo

Only if you will edit patient app code:

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" checkout -b <your-new-patient-branch>
```

## Step 10: Quick Sanity Check

After syncing:

- CRC web should still run from the shared backend
- patient AE Guidance should still open normally
- patient reasoning trace should still be available
- patient Android emulator should not show the old CRC-only auth error

## Final Reminder

The correct new habit is:

1. sync root repo to `main`
2. sync submodules
3. if editing patient code, switch patient repo to `main`
4. create new personal branches from `main`

That is the post-main workflow.
