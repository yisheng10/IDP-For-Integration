# AGENTS.md

## Workspace Purpose
This workspace is the integration repo for the TrialLight v1 surfaces.

It coordinates four related but still separate workstreams:
- CRC web operations surface
- patient mobile application
- ePRO / questionnaire service
- dropout prediction backend contract integration

This root workspace is an orchestration layer, not a signal to collapse every folder into one runtime.

## Active Source Trees
- `src/`, `public/`, root `package.json`: active CRC web application
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/app/`: active Expo router entrypoints
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/`: active patient mobile logic
- `li qiu's part questionnaire ePRO/server_integrated.js`: active v1 questionnaire service entrypoint
- `Patient-Dropout-Prediction/src/`: active dropout prediction backend and contracts

## Legacy Or Reference Trees
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/Code/`: legacy/reference only unless explicitly migrated
- `li qiu's part questionnaire ePRO/frontend-epro/`: demo/reference frontend once native app integration is in place
- patient web screens under the root web app: retained only as deprecated reference until safely removed
- CRC mobile screens under the Expo app: retained only as deprecated reference until safely removed

## Product Boundary (Locked For V1)
- Root website is CRC-only.
- Mobile app is patient-only.
- ePRO is a patient-app feature with a separate service backend.
- Dropout prediction output is CRC-only.

The patient app must never expose:
- dropout probability
- risk bucket
- action priority
- recommended CRC action
- model explanation signals

## Ownership And Integration Rules
- Preserve existing module separation where possible.
- Integrate through explicit interfaces and mirrored operational data, not direct cross-folder coupling.
- Do not make the CRC web app depend on questionnaire-service internals.
- Do not make the patient app depend on dropout model internals.
- Treat the questionnaire service as the owner of detailed questionnaire generation and submission logic.
- Treat Firestore `users/{uid}/epro_submissions/*` as the mirrored operational layer for CRC visibility.

## Identity Rules
- Canonical v1 integration identity is `subject_id`.
- If no dedicated pseudonymous trial subject ID exists yet, use Firebase `user.uid` as the temporary fallback.
- Do not require direct patient-identifying fields for dropout integration.

## Safety And Clinical Positioning
- Security and patient confidentiality come first.
- Structured, study-linked records are the reason to use TrialLight instead of WhatsApp.
- Emergency chat is a support and documentation layer; it does not replace direct emergency phone escalation.
- The current operational target is DCT-friendly, investigator-led, earlier-phase deployment before broader rollout.
- Do not present the product as diagnosis or autonomous emergency care.

## Config Hygiene
- Do not introduce any new hardcoded secrets.
- Assume already committed keys are compromised and unsuitable for production reuse.
- Prefer environment variables or deployment-managed secrets for any new integration point.

## Language And Documentation
- Repository content, code, comments, and docs added here should be in English.
- Collaboration with the user remains in Chinese.

## Editing Guidance
- Disable deprecated paths before deleting them outright.
- Keep changes focused on active source trees.
- Do not merge the separate dropout repository into the web or app runtime.
- When uncertain, prefer adapter layers and mirrored records over large refactors.

# 2. Permanent Principles (Must Be Followed)

## 2.1 Any Delete Commands are Prohibited

* Do not execute any delete commands, including but not limited to: permanent deletion, command-line recycle bin deletion, and emptying the recycle bin.
* If you need to clean up files or folders, you can only move the objects to `D:\99_recycle_bin` while preserving the original folder hierarchy.
* You can move objects to `D:\99_recycle_bin` directly without my explicit permission, but once moved, the above regulations must be strictly followed.
* After moving objects to `D:\99_recycle_bin`, by default, no renaming, compression, splitting, merging, or reorganization is allowed; they are only permitted to be kept as-is in their original hierarchy.
* Only manual deletion by the user in a graphical user interface (GUI) is considered a controlled deletion into the system recycle bin.
* Do not describe the "disappearance of the original file" as "moved to the recycle bin" unless you have verified that the new item is indeed in the recycle bin.
* If the cleanup plan involves moving files to `D:\99_recycle_bin`, it must be listed separately and confirmed again.

## 2.2 No Silent Overwrites

If a file/folder with the same name already exists in the target location:

* Direct overwriting is strictly prohibited.
* First compare: filename, size, modification time, potential hash values, and content redundancy.
* Output a difference description and handling recommendations.
* Wait for the user to decide on "keep both / overwrite / skip / merge".

## 2.3 Absolute Red Lines for Frontend Interaction with Firebase (Preventing Read Storm Incidents)

Historical Lesson: An improper configuration of the frontend React lifecycle and Firebase listeners once led to millions of unintended reads. When generating any frontend query code, the following standards must be strictly followed:

* **No Unbounded Queries:**
  Any code fetching collection data via `getDocs` must enforce the use of `query()` combined with `limit()` (default maximum of 50), unless there is an extremely specific, approved whitelist reason. Naked queries like `getDocs(collection(db, "collectionName"))` are strictly prohibited.

* **Strict Listener Hygiene (onSnapshot Lifecycle Management):**
  Any React component that uses `onSnapshot` for real-time subscription must satisfy:
  1. It must be wrapped inside a `useEffect`.
  2. The dependency array of `useEffect` must be extremely precise; it is strictly prohibited to trigger the effect repeatedly due to unrelated state changes.
  3. It **MUST** return an `unsubscribe` function in `useEffect` to ensure the connection is disconnected when the component unmounts.

* **No Retry on Denial (Do not trigger retry side effects in catch blocks):**
  When handling `try...catch` for Firebase calls, if an error is encountered (especially `permission-denied` or `quota-exceeded`), you are only allowed to block the logic and display a static UI prompt. Modifying states that trigger a re-render and lead to a re-request inside the catch block is absolutely prohibited, preventing infinite request loops.