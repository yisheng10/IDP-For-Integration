# Fresh Clone Validation Steps For The Stable Candidate Branch

This document explains how to verify that the current stable candidate branch can be cloned into a fresh folder and still work correctly after environment files are added.

This is the validation step we want to complete **before** merging anything into `main`.

## Branches To Validate

- Root integration repo:
  - branch: `codex/stable-candidate-20260517-rc1`
- Patient app submodule:
  - branch: `codex/stable-candidate-20260517-rc1`

Expected patient submodule commit after sync:

```text
a7a4a33
```

## What This Validation Is Proving

We are **not** trying to prove that a raw `git clone` works with zero setup.

That is not realistic for this project because some real environment values and credentials are intentionally not stored in Git.

We **are** trying to prove that the project works correctly when a teammate does all required setup in a clean new folder:

1. clone the correct branch
2. update submodules correctly
3. add the provided environment bundle
4. add the provided credentials bundle
5. start the CRC web app
6. start the patient app
7. test patient web and Android emulator

## Required Files Before Starting

You need:

- the GitHub repos
- the stable candidate branch names above
- the environment bundle zip
- the credentials-only bundle zip

If the environment bundle or credentials bundle is missing, stop and request it first.

## Step 1: Create A Fresh Test Folder

Choose a brand new folder that does not already contain an older checkout.

Example:

```powershell
cd D:\
mkdir TrialLightFreshCloneTest
cd TrialLightFreshCloneTest
```

## Step 2: Clone The Root Repo On The Stable Candidate Branch

```powershell
git clone --branch codex/stable-candidate-20260517-rc1 https://github.com/yisheng10/IDP-For-Integration.git
cd IDP-For-Integration
```

## Step 3: Update Submodules

```powershell
git submodule sync --recursive
git submodule update --init --recursive
```

This step should complete without the old error:

```text
fatal: No url found for submodule path 'external-skills/ui-ux-pro-max-skill' in .gitmodules
```

If you still see that exact error, it usually means you cloned an older branch state before the stable-candidate cleanup was pushed. Re-clone the stable candidate branch again instead of continuing with that broken checkout.

## Step 4: Verify The Root Branch

```powershell
git branch --show-current
```

Expected:

```text
codex/stable-candidate-20260517-rc1
```

## Step 5: Verify The Patient Submodule Branch And Commit

```powershell
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" branch --show-current
git -C "MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2" rev-parse HEAD
```

Expected branch:

```text
codex/stable-candidate-20260517-rc1
```

Expected commit:

```text
a7a4a33
```

## Step 6: Copy The Environment Bundle Into The Fresh Clone

Take the environment bundle contents and place them into the correct matching paths in this fresh clone.

Important:

- do not rename files
- do not move them into different folders
- do not skip hidden files such as `.env.local`

## Step 7: Copy The Credentials Bundle Into The Fresh Clone

Take the credentials-only bundle contents and place them into the matching paths in this fresh clone.

Important:

- keep the folder structure intact
- do not overwrite unrelated files without checking first
- if Windows asks about replacing files, compare the names and decide carefully

## Step 8: Install Root Dependencies

From the root repo:

```powershell
npm install
```

## Step 9: Install Patient App Dependencies

```powershell
npm install --prefix "D:\TrialLightFreshCloneTest\IDP-For-Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2"
```

## Step 10: CRC Web Validation

### Build CRC

```powershell
npm run build:crc
```

### Start CRC Preview

```powershell
npm run preview -- --host 127.0.0.1 --port 4176
```

Open:

- [http://127.0.0.1:4176/](http://127.0.0.1:4176/)

### CRC Pass Criteria

- page loads without white screen
- login works
- dropout board shows the `Final A2` layout
- CRC guidance still works

## Step 11: Patient Web Validation

From the patient app folder:

```powershell
cd /d "D:\TrialLightFreshCloneTest\IDP-For-Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2"
npx expo start --clear
```

Then:

- press `w` for web

### Patient Web Pass Criteria

- app opens
- AE Guidance opens
- grounded answer works
- reasoning trace appears
- Daily Health Report can hand off into AE Guidance

## Step 12: Patient Android Emulator Validation

### Start Android emulator

Use Android Studio:

- `Tools`
- `Device Manager`
- start a device such as `Medium_Phone_API_36.1`

### Start patient app on emulator

From the patient app folder:

```powershell
npx expo start --clear
```

Then:

- press `a` to open Android

### Android Pass Criteria

- patient app opens in emulator
- AE Guidance opens
- no `Only CRC users can access guidance services`
- no immediate forced `Temporary guidance fallback`
- grounded answer works
- reasoning trace appears
- Android trace does not stop at `Streaming response body was not available.`

## Step 13: Recommended Functional Checks

### AE Guidance

Send:

```text
What symptoms of hypoglycemia should I be on the lookout for? And what levels of FPG as well?
```

Check:

- answer is clinically sensible
- reasoning trace appears
- answer and trace do not obviously contradict each other

### Daily Health Report handoff

Check both:

- abnormal vitals submission
- symptom text submission

Expected:

- redirects into AE Guidance
- sends the correct auto-prompt
- does not land on an empty shell page

### Patient / CRC chat

Check:

- CRC can send to patient
- patient can reply
- timeline stays consistent

## Step 14: Record The Result

Write down:

- clone path used
- root branch
- patient branch
- patient commit
- whether CRC web passed
- whether patient web passed
- whether Android emulator passed
- screenshots for any failures

## Final Rule

Do **not** merge this stable candidate branch into `main` until:

1. CRC web passes
2. patient web passes
3. patient Android emulator passes
4. no critical blocker remains
