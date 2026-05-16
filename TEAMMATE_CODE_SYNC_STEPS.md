# Team Sync Guide For The `jianhong2` Integration Merge

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

In plain language:

- the patient app keeps the newer `jianhong2` UI work
- the patient app also keeps the newer patient reasoning trace and shared online guidance runtime
- the root repo keeps the newer Gemini key rotation and backend guidance fixes

## Source Of Truth Branches

Teammates must sync to these branches:

- Root integration repo:
  - branch: `codex/merge-jianhong2-into-yisheng`
- Patient app submodule:
  - branch: `codex/merge-jianhong2-into-yisheng`

Expected submodule commits after sync:

- Patient app submodule:
  - commit: `f018f18`
- Dropout prediction submodule:
  - commit: `693e677`

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
git checkout codex/merge-jianhong2-into-yisheng
git pull --ff-only origin codex/merge-jianhong2-into-yisheng
```

If Git says the branch does not exist locally, run:

```powershell
git checkout -b codex/merge-jianhong2-into-yisheng origin/codex/merge-jianhong2-into-yisheng
```

## Step 4: Sync And Update Submodules

This step is mandatory.

Run:

```powershell
git submodule sync --recursive
git submodule update --init --recursive
```

This makes the root repo pull the exact patient app commit and dropout submodule commit that belong to this integration branch.

## Step 5: Verify The Root Branch

Run:

```powershell
git branch --show-current
```

Expected result:

```text
codex/merge-jianhong2-into-yisheng
```

## Step 6: Verify The Patient App Submodule Commit

Run:

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" branch --show-current
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" rev-parse HEAD
```

The patient app branch should show:

```text
codex/merge-jianhong2-into-yisheng
```

Expected patient app commit:

```text
f018f18
```

## Step 7: Verify The Dropout Prediction Submodule

Run:

```powershell
git -C "Patient-Dropout-Prediction" rev-parse HEAD
```

This confirms you did not accidentally keep an old local dropout pointer.

Expected dropout prediction commit:

```text
693e677
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
- patient local development no longer bypasses the shared online guidance runtime

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
git checkout codex/merge-jianhong2-into-yisheng
git pull --ff-only origin codex/merge-jianhong2-into-yisheng
git submodule sync --recursive
git submodule update --init --recursive
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
