# TrialLight Merge Validation Testing Checklist

This checklist is for teammates who need to validate the merged branch before continuing development.

Target branches:

- Root repo: `codex/merge-jianhong2-into-yisheng-v2`
- Patient app repo: `codex/merge-jianhong2-into-yisheng-v2`

Use this checklist after you finish the sync steps in `TEAMMATE_CODE_SYNC_STEPS.md`.

---

## 1. Goal Of This Checklist

The purpose of this checklist is to confirm that the merged codebase is stable before new work continues.

You are checking for:

- no obvious build failures
- patient AE Guidance still works
- patient reasoning trace is visible again
- patient-side retrieval / RAG is not silently broken
- Daily Health Report still hands off correctly into AE Guidance
- CRC and patient chat still work
- call UI and call acceptance state were not broken by the merge
- Android behavior is still acceptable, not just web behavior

---

## 2. What To Test On

You should test on both:

1. Expo web
2. Android Studio emulator

Why:

- Expo web and Android do not always behave the same
- the final patient surface is expected to become an APK
- a fix that only works on web is not enough

---

## 3. Environment Preparation

### Root repo

Open a terminal in the root merge worktree and run:

```powershell
cd /d "D:\IDP For Integration\.merge-jianhong2-root"
git branch --show-current
npm run build:crc
```

Expected:

- branch is `codex/merge-jianhong2-into-yisheng-v2`
- `build:crc` succeeds

### Patient app repo

Open a terminal in the patient merge worktree and run:

```powershell
cd /d "D:\IDP For Integration\.merge-jianhong2-patient"
git branch --show-current
npm run lint
npm run export:web
```

Expected:

- branch is `codex/merge-jianhong2-into-yisheng-v2`
- lint only shows existing warnings, not new errors
- `export:web` succeeds

---

## 4. Start The Apps

### CRC web

```powershell
cd /d "D:\IDP For Integration\.merge-jianhong2-root"
npm run preview -- --host 127.0.0.1 --port 4176
```

Open:

- [http://127.0.0.1:4176/](http://127.0.0.1:4176/)

### Patient web

```powershell
cd /d "D:\IDP For Integration\.merge-jianhong2-patient"
npm run web
```

### Android

Run the patient app in Android Studio emulator and repeat the same core tests there.

---

## 5. High-Priority Test Areas

These are the most important items. If time is limited, test these first.

1. Patient AE Guidance basic interaction
2. Patient reasoning trace
3. Patient-side retrieval / RAG behavior
4. Daily Health Report handoff into AE Guidance
5. CRC to patient chat
6. Android emulator behavior

---

## 6. Detailed Checklist

### A. Patient AE Guidance Basic Interaction

Steps:

1. Open `AE Guidance`
2. Enter a simple message such as:
   - `I have mild nausea today`
3. Press `Send`

Expected:

- message sends successfully
- AI replies
- the screen is not just an empty shell or broken widget
- input, send button, and scrolling still work

Fail signals:

- pressing send does nothing
- only a fallback shell appears
- UI opens but cannot be interacted with

---

### B. Patient Reasoning Trace

Steps:

1. Ask a guidance question such as:
   - `Can you tell me what symptoms of hypoglycemia I should watch out for?`
2. Wait for the answer
3. Check whether the reasoning trace panel appears
4. Expand and collapse the trace

Expected:

- trace panel is visible
- trace is not permanently empty
- trace does not fail with a network error

Fail signals:

- no trace appears at all
- trace panel exists but remains empty
- trace keeps showing `NetworkError`

---

### C. Patient-Side Retrieval / RAG

Plain-language meaning:

- `RAG` means the system retrieves CTCAE or protocol excerpts before answering

Steps:

1. Ask a question that should use protocol or CTCAE context, such as:
   - `What symptoms of hypoglycemia should I be aware of?`
   - `What should I do if my blood sugar is low?`
2. Review the answer
3. Review the trace

Expected:

- the answer is not only a generic fallback
- the answer fits the active protocol
- the trace suggests that retrieval happened

Fail signals:

- generic fallback every time
- trace says no excerpts were retrieved for clearly protocol-specific questions

---

### D. Daily Health Report -> AE Guidance Handoff

This area had a reported regression and must be tested carefully.

#### Scenario 1: Abnormal vitals

Steps:

1. Open Daily Health Report
2. Enter abnormal vitals
3. Submit

Expected:

- app redirects into AE Guidance
- AE Guidance opens correctly, not an empty shell
- a proper structured prompt is auto-sent
- the message reflects measurements and flagged issues

Fail signals:

- redirect opens an empty AE Guidance page
- only a generic active alert message appears
- no useful prompt is sent

#### Scenario 2: Typed symptoms

Steps:

1. Open Daily Health Report
2. Enter symptom text, for example:
   - `I feel dizzy and shaky`
3. Submit

Expected:

- app redirects into AE Guidance
- symptom-related prompt is auto-sent

Fail signals:

- redirect happens but no message is sent
- symptom case does nothing

---

### E. CRC -> Patient Chat

Steps:

1. On CRC side, select a patient
2. Send a message from the mixed timeline
3. On patient side, confirm the message is visible
4. Reply from patient side
5. Confirm the reply appears on CRC side

Expected:

- CRC can send
- patient can receive
- patient can reply
- CRC sees the reply

Fail signals:

- CRC send fails
- patient receives nothing
- reply does not return to CRC

---

### F. AE Guidance UI Integrity

This is especially important because patient UI changed in `jianhong2`.

Check:

- AE Guidance still opens as the intended full-screen or full-tab experience
- call buttons are still present
- composer area is still usable
- no strange dropdown or overlay behavior blocks chat usage

Expected:

- UI still resembles the newer `jianhong2` design direction
- no major visual regression

Fail signals:

- call UI is missing
- layout is obviously reverted
- screen cannot be closed or navigated correctly

---

### G. Call UI / Call Acceptance State

Steps:

1. Start a patient call
2. Answer the call
3. Verify the accepted call becomes active
4. Verify the state is cleaned up correctly after accept/end

Expected:

- accepted call transitions into active state
- call state does not get stuck

Fail signals:

- already accepted call still appears pending
- active call cleanup is broken

---

### H. ePRO

Steps:

1. Open ePRO Questionnaire
2. Verify the page renders correctly
3. Submit a questionnaire
4. If possible, compare different protocols

Expected:

- ePRO page renders correctly
- dark mode remains readable
- basic submit flow works

---

### I. Dark Mode / Language / Appearance / Dropdowns

Steps:

1. Open `Me`
2. Switch appearance mode
3. Switch language
4. Recheck AE Guidance, ePRO, and chat

Expected:

- dropdowns render above nearby content
- dark mode text remains readable
- key UI strings switch correctly

---

### J. Tab Keep-Alive / Scroll Preservation

Steps:

1. Open AE Guidance
2. Scroll to a specific point
3. Switch tabs
4. Return to AE Guidance

Expected:

- chat state is preserved
- scroll position is approximately preserved

Fail signals:

- chat resets completely
- screen always jumps to the bottom

---

## 7. Recommended Evidence To Capture

Please capture screenshots for:

1. patient AE Guidance normal reply
2. patient reasoning trace visible
3. retrieval-backed question result
4. Daily Health Report abnormal vitals handoff
5. Daily Health Report symptom handoff
6. CRC to patient chat success
7. call accepted state
8. dark mode AE Guidance and ePRO

---

## 8. Suggested Result Format

Use a simple pass/fail log like this:

- AE Guidance send: pass
- Patient reasoning trace: pass
- Patient retrieval / RAG: fail
- Daily report abnormal vitals handoff: pass
- Daily report symptom handoff: fail
- CRC to patient chat: pass
- Call accepted state: pass
- ePRO page: pass
- Dark mode: pass

---

## 9. Final Decision Rule

Do not continue new feature development on old branches if these checks are not stable.

Use the merged `v2` branches as the baseline only after:

- builds pass
- patient AE Guidance works
- patient reasoning trace works
- Daily Health Report handoff works
- CRC/patient chat works
- Android emulator behavior is acceptable

