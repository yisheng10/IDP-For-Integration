# Team Sync Guide For The `jianhong2` Integration Merge v2

This document explains:

1. what was merged into the new integration branch
2. which branches teammates must use
3. the exact commands to run
4. how to verify that the full codebase was updated correctly

This guide is written for teammates who are not confident with Git.

## What Was Merged

The new integration branch combines:

- the current root integration work from `yisheng`
- the root repo changes from `jianhong2`
- the current patient guidance runtime fixes that force local development to use the shared online backend
- the patient-side detailed reasoning trace path
- the patient app UI and UX changes from `jianhong2`
- the latest `jianhong2` call UI changes
- the latest `jianhong2` root call acceptance state fix
- the patient-side RAG trace wiring fix
- the Daily Health Report to AE Guidance handoff fix
- the patient guidance timeline filtering fix so urgent alert thread noise does not appear as AE Guidance chat history

In plain language:

- the patient app keeps the newer `jianhong2` UI work
- the patient app also keeps the newer patient reasoning trace and shared online guidance runtime
- the patient app now passes real retrieval chunks into the patient reasoning trace instead of empty arrays
- local patient web development now ignores accidental `localhost` Firebase Functions URLs unless a teammate explicitly opts in
- Daily Health Report now expands AE Guidance and sends a proper auto-prompt containing symptoms, measurements, and flagged issues
- the root web call context now records accepted call state consistently with the latest `jianhong2` behavior
- the root repo keeps the newer Gemini key rotation and backend guidance fixes

## Source Of Truth Branches

Teammates must sync to these branches:

- Root integration repo:
  - branch: `codex/merge-jianhong2-into-yisheng-v2`
- Patient app submodule:
  - branch: `codex/merge-jianhong2-into-yisheng-v2`

Expected submodule commits after sync:

- Patient app submodule:
  - commit: `bb0b27c`

Do **not** continue development from:

- `jianhong2`
- `jianhong`
- `yisheng`
- any older personal branch that does not already point to this merge

Those branches are now older baselines.

## Important Git Concept

This project is **not** one single Git repo.

It contains:

- one root repo: `IDP-For-Integration`
- one patient app submodule: `IDP_PatientApp`
- one dropout prediction submodule: `Patient-Dropout-Prediction`

This means:

- pulling only the root repo is **not enough**
- you must also update submodules

If you skip the submodule update step, you may get:

- old patient app code
- missing reasoning trace
- outdated UI
- wrong backend behavior

## Before You Start

If you already have local changes on your machine, do **one** of these first:

### Option A: commit your local work

If your local work matters, commit it to your own branch first.

### Option B: stash your local work

If you are not ready to commit it yet:

```powershell
git stash push -m "my-local-work-before-jianhong2-merge-sync"
```

Do **not** hard reset and do **not** delete files.

## Step 1: Go To The Root Integration Repo

Open a terminal and run:

```powershell
cd /d "D:\IDP For Integration"
```

## Step 2: Fetch The Latest Remote Branches

Run:

```powershell
git fetch origin
git submodule foreach --recursive git fetch origin
```

This updates:

- the root repo branch list
- the patient submodule branch list
- the dropout submodule branch list

## Step 3: Switch The Root Repo To The New Integration Branch

Run:

```powershell
git checkout codex/merge-jianhong2-into-yisheng-v2
git pull --ff-only origin codex/merge-jianhong2-into-yisheng-v2
```

If Git says the branch does not exist locally, run:

```powershell
git checkout -b codex/merge-jianhong2-into-yisheng-v2 origin/codex/merge-jianhong2-into-yisheng-v2
```

## Step 4: Sync And Update Submodules

This step is mandatory.

Run:

```powershell
git submodule sync --recursive
git submodule update --init --recursive
```

This makes the root repo pull the exact patient app commit and dropout submodule commit that belong to this integration branch.

## Step 5: Install Patient App Dependencies

This step is now required because the merged patient app includes the `expo-camera` dependency used by the newer call UI.

Run:

```powershell
npm install --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2"
```

Do not skip this step.

If you skip it, the patient app may fail to start or export and you may see missing plugin errors for `expo-camera`.

## Step 6: Verify The Root Branch

Run:

```powershell
git branch --show-current
```

Expected result:

```text
codex/merge-jianhong2-into-yisheng-v2
```

## Step 7: Verify The Patient App Submodule Commit

Run:

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" branch --show-current
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" rev-parse HEAD
```

The patient app branch should show:

```text
codex/merge-jianhong2-into-yisheng-v2
```

Expected patient app commit:

```text
bb0b27c
```

## Step 8: Start Development From A New Personal Branch

After syncing, do **not** keep developing directly on the integration branch.

Create your own branch from the synced state.

### Root repo

```powershell
git checkout -b <your-new-root-branch>
```

### Patient app submodule

If you will edit patient app code, also create a new patient-app branch:

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" checkout -b <your-new-patient-branch>
```

## Step 9: Quick Functional Checks

After syncing, teammates should verify these points:

### CRC side

- CRC guidance still runs through the shared online backend
- local `npm run dev` or `npm run preview` should not silently fall back to browser-direct Gemini

### Patient side

- patient AE guidance opens normally
- patient reasoning trace is visible again
- patient local development no longer bypasses the shared online guidance runtime by default
- patient Daily Health Report can redirect into AE Guidance and auto-send the correct summary prompt
- urgent alert auto-thread messages should not pollute the AE Guidance chat timeline

### If you intentionally need the local Firebase Functions emulator

By default, this merge branch ignores local `localhost` / `127.0.0.1` Firebase Functions base URLs for patient guidance, because that path caused teammates to bypass the shared online backend.

If you really need to test a local functions emulator, explicitly set:

```text
EXPO_PUBLIC_ALLOW_LOCAL_FUNCTIONS_BASE_URL=true
```

Only do this when you intentionally want local emulator behavior.

### Shared backend behavior

- local devices should now contribute to the shared Gemini key rotation usage path
- patient reasoning trace should no longer disappear just because a teammate is running locally

## If Something Looks Wrong

If a teammate still sees:

- no reasoning trace
- old patient guidance behavior
- outdated patient UI

then the most likely reason is:

- they updated the root repo
- but did **not** update submodules correctly

The fix is usually to run again:

```powershell
git fetch origin
git checkout codex/merge-jianhong2-into-yisheng-v2
git pull --ff-only origin codex/merge-jianhong2-into-yisheng-v2
git submodule sync --recursive
git submodule update --init --recursive
npm install --prefix "D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2"
```

## If You Already Have Local Branches Based On Older Work

If your old local branch is based on:

- `jianhong2`
- `jianhong`
- `yisheng`

do not continue adding new work there.

Instead:

1. sync to the new integration branch first
2. create a fresh new branch from it
3. re-apply your unfinished local work carefully

## If You Change A Submodule Later

Remember this rule:

1. commit and push the submodule branch first
2. return to the root repo
3. stage the updated submodule pointer in the root repo
4. commit and push the root repo

If you skip step 2 to 4, other teammates will not receive the correct submodule version.

## Final Reminder

The root repo and the patient app submodule must move together.

If a teammate updates only one of them, they may think the merge is broken even when the code on GitHub is already correct.
