# Jianhong2 Change Log

Date: 2026-05-16
Branch: `jianhong2`

This file summarizes the integration work completed in this environment for the patient app and related backend function code.

## Environment And Branch

- Set up the working environment for JianHong on branch `jianhong2`.
- Kept the root integration repo and nested patient app checkout separated.
- Patient app path: `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2`.
- Root integration repo path: `E:\IDP-For-Integration3`.

## Patient App UI And UX

- Reworked the AE Guidance chat composer area so the fixed bottom input no longer leaves a large empty filled space.
- Added a stronger WhatsApp-style bottom blur/scrim behind fixed chat inputs.
- Improved dark mode coverage across patient app screens so UI panels, inputs, chat bubbles, cards, and text remain readable.
- Updated the Me tab Appearance selector to a Windows-style dropdown while keeping System, Light, and Dark choices.
- Centered and aligned the Appearance row correctly in the Me tab.
- Added a Language selector with English, Malay, and Chinese locale support.
- Updated bottom navigation labels and main patient UI strings to use locale files.
- Kept AE as an untranslated term in translated labels, for example `AE Guidance` / `Panduan AE` / `AE 指导`.
- Fixed dropdown stacking so Appearance and Language menus render above nearby rows.

## AE Guidance Chat

- Added local chat cache pagination for AE Guidance.
- Kept AE Guidance mounted when switching tabs so scroll position and chat state are preserved.
- Preserved AE Guidance scroll position instead of always forcing a jump to the bottom.
- Added a sequential blinking `Thinking` text indicator while AI guidance is being generated.
- Improved chat loading and dropdown layering.
- Added Gemini API key rotation so configured keys are tried in sequence when one fails.

## Active Emergency And CRC Chat

- Preserved active emergency chat scroll position when backing out and reopening the same conversation.
- Added WhatsApp-like message actions:
  - long press a message
  - reply to a message
  - delete own sent message within 15 minutes
  - edit own sent message within 15 minutes
  - disable edit/delete after the 15-minute window
- Added reply quote navigation so tapping a replied-to quote jumps to the original message.
- Added local cache behavior for latest emergency chat messages.
- Added a Clear cache button in Me with a confirmation popup.
- Added cache size display in Me, including persisted chat cache plus mounted chat state.
- Changed Active Emergency list to show all loaded safety reports, not only the first 8.
- Changed Active Emergency list to include read and unread safety reports, not unread-only.
- Added paged Active Emergency loading:
  - first page uses a bounded 20-item live query
  - older pages use `startAfter(...)` plus `limit(20)`
  - footer shows `Pull up to load more`, `Release to load more`, `Loading more...`, or `All safety reports loaded`
  - older reports load only when the user crosses the bottom threshold and releases while still past the threshold

## Attachment Feature Reverts

- Earlier emergency attachment work for photos, camera, documents, locations, previews, and document viewing was reverted.
- The current branch keeps the app before that attachment feature set, while retaining later chat action and scroll behavior improvements.

## ePRO

- Added dark mode styling to the ePRO Questionnaire screen:
  - background
  - summary card
  - question cards
  - text
  - badges
  - input fields
  - scale/choice buttons
  - loading, error, complete, and awaiting-review panels
- Kept ePRO status and questionnaire entry points integrated in the patient app.

## Calendar Date Picker

- Updated the shared `CalendarDateField` used by account creation and edit profile.
- Added direct month selection by tapping the month label.
- Added direct year selection by tapping the year label.
- Kept previous/next month controls.
- Fixed Expo Web layout so the calendar modal stays constrained and centered instead of stretching across the browser viewport.

## Backend Function Fix

- Fixed the Firebase Admin SDK `DocumentSnapshot.exists` usage in `functions/guidanceRuntime.js`.
- Replaced server-side `userSnapshot.exists()` calls with `userSnapshot.exists`.
- Verified the runtime file with `node --check functions\guidanceRuntime.js`.

## Key Patient App Commits

- `6114ac3` Add active emergency paged loading
- `aa372c6` Constrain calendar modal on web
- `acb4ba6` Add direct month and year date picker
- `ea240f2` Include mounted chats in cache size
- `2e40730` Add ePRO dark mode and cache size
- `57e1db5` Improve chat loading and dropdown layering
- `95f116d` Obscure emergency chat composer area
- `9fa8c64` Preserve emergency chat position
- `cf7f3ba` Add Gemini key rotation
- `26418a1` Keep AE guidance chat mounted
- `d02f3cb` Add chat cache pagination
- `dc346e7` Add reply quote jump in emergency chat
- `9485f28` Add emergency chat message actions
- `20219da` Revert attachment preview work
- `ba5875f` Complete patient app localization coverage
- `3229c7d` Add patient app language selector
- `96be2db` Polish patient app dark mode UI

## Key Root Integration Commits

- `352323d` Update patient app active emergency pagination pointer
- `b8a7290` Update patient app calendar web fix pointer
- `dd45d91` Update patient app date picker pointer
- `06f91c3` Update patient app cache size pointer
- `e97b9b7` Fix guidance runtime snapshot exists checks
- `e8b187e` Update patient app ePRO dark mode pointer
- `4025898` Update patient app loading UI pointer
- `a19d636` Update patient app composer scrim pointer
- `217df04` Update patient app emergency chat pointer
- `345dafc` Update patient app Gemini rotation pointer
- `373961b` Update patient app keep-alive pointer
- `4a6c11b` Update patient app chat cache pointer

## Verification Performed

- Repeatedly ran `npm.cmd run lint` in the patient app.
- Lint passed after each major change with the same existing warnings:
  - `GeminiChatbot.js` hook dependency warning
  - `config.js` `process` no-redeclare warning
  - unused `assignedTemplate` and `handleAddVitals` warnings
  - BOM warnings in existing service files
- Verified `functions/guidanceRuntime.js` syntax with `node --check`.

## Notes

- `.env` and API keys were not committed.
- The debug export folder `.expo-debug-export/` remains untracked in the patient app and is not part of the pushed changes.
