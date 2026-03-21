# PLAN.md

## Goal
Deliver a v1 integration baseline where:
- the root website operates as the CRC surface
- the Expo mobile app operates as the patient surface
- ePRO is available natively inside the patient app through the existing questionnaire service
- dropout prediction is represented on the CRC side through a safe adapter/placeholder contract

## Implementation Phases

### Phase 1. Workspace Governance
- Add root governance documents that lock folder ownership and product boundaries.
- Mark active versus legacy source trees.
- Record security-first and CRC-only/patient-only rules.

### Phase 2. Boundary Cleanup
- Hard-disable patient use of the root website without deleting deprecated patient web code yet.
- Hard-disable CRC use of the mobile app without deleting deprecated CRC mobile code yet.
- Keep role-specific messaging explicit so unsupported users know which surface to use.

### Phase 3. Native ePRO Integration
- Normalize questionnaire service endpoints to:
  - `GET /api/epro/daily-survey?subject_id=...`
  - `POST /api/epro/submit`
- Add a native patient questionnaire screen in the Expo app.
- Support `boolean`, `numeric_scale`, `text`, and conditional-question rendering.
- Mirror operational questionnaire records into Firestore under `users/{uid}/epro_submissions/{form_id}`.

### Phase 4. CRC Operational Visibility
- Add a CRC ePRO status panel driven only by mirrored operational records.
- Keep CRC operational modules already in use: registry, protocol library, alerts, chat, appointments, AI copilot.
- Add a dropout-risk adapter card that can consume the existing contract when reachable and degrade safely when it is not.

### Phase 5. Verification
- Confirm the web app still builds after the boundary change.
- Confirm the mobile app passes a basic static check after adding the questionnaire flow.
- Confirm the questionnaire service parses and serves the normalized endpoints.
- Confirm the dropout HTTP service remains reachable and browser-consumable.

## Public Contracts

### Mirrored ePRO Record
Stored at `users/{uid}/epro_submissions/{form_id}` with:
- `subject_id`
- `form_id`
- `assigned_at`
- `due_at`
- `submitted_at`
- `status`
- `completion_latency_sec`
- `source_system`

Additional operational metadata is allowed if it does not leak patient-only or dropout-only protected information.

### Dropout Visibility Rule
Dropout outputs are CRC-only.

The patient app must never consume:
- `dropout_probability`
- `risk_bucket`
- `recommended_action`
- `explanation_signals`

## Acceptance Criteria
- Root `AGENTS.md` and `PLAN.md` correctly describe workspace ownership and product boundaries.
- Root website supports CRC workflows only.
- Mobile app supports patient workflows only.
- Patient questionnaire screen loads real questions from the normalized ePRO service.
- Questionnaire submission mirrors operational records into Firestore.
- CRC dashboard can read mirrored ePRO status without calling questionnaire-service internals.
- Dropout panel appears only on the CRC side and safely handles unavailable adapters.
- Emergency UX clearly instructs direct urgent contact rather than chat-only escalation.

## Non-Goals For This Round
- Full production rollout of live dropout inference for real patient data
- Migration of questionnaire logic into the main application backend
- Deletion of all deprecated code paths immediately
- Replacement of institution-grade hosting, IAM, or compliance work

## Defaults And Assumptions
- The root folder remains an integration workspace rather than a single merged application.
- Detailed questionnaire content remains owned by the questionnaire service in this round.
- Firebase `user.uid` is the temporary `subject_id` fallback until a dedicated pseudonymous subject ID is introduced.
- Existing committed API keys are treated as compromised legacy development artifacts, not approved production secrets.
