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

# 2. 永久原则（必须遵守）

## 2.1 先分析，后执行

任何 copy / move / rename / delete / extract / merge / overwrite 行为之前，必须先输出一份“拟执行操作清单”，等用户明确同意后再执行。

## 2.2 禁止执行任何删除命令

* 不得执行任何删除命令，包括但不限于：永久删除、命令行回收站删除、清空回收站。
* 若需清理文件或文件夹，只能将对象移动到 `D:\99_回收站`，并保留原文件夹层级。
* 移入 `99_回收站` 后，默认不得再对该对象执行重命名、压缩、拆分、合并或二次整理；仅允许保留原层级暂存。
* 只有用户在图形界面中手动删除，才视为进入系统回收站的受控删除。
* 不得把“原文件消失”表述为“已移入回收站”，除非同时验证到回收站中新条目。
* 若清理方案涉及移动到 `99_回收站`，也必须单独列出并再次确认。

## 2.3 不得静默覆盖

若目标位置已存在同名文件/文件夹：

* 禁止直接覆盖。
* 先比较：文件名、大小、修改时间、可能的哈希值、内容是否重复。
* 输出差异说明和处理建议。
* 等用户决定“保留两份 / 覆盖 / 跳过 / 合并”。