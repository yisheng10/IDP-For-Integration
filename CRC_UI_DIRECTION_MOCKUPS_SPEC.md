# TrialLight CRC UI Direction Mockups Spec

## Purpose

Create three high-fidelity desktop-only visual direction boards for the TrialLight CRC website before any production UI implementation begins.

This artifact is planning and review material only. It does not change the current CRC runtime, code structure, routing behavior, or Firebase logic.

## Fixed Scope

- Surface: CRC website only
- Fidelity: high-fidelity visual mockups
- Device target: desktop browser only
- Output type: static design boards, not interactive prototypes
- Naming:
  - use `Patient Disengagement Prediction` in UI copy
  - do not use `Patient Dropout Prediction` as the main UI label

## Direction Set

### 1. Clinical Command Center

Intent:
- strongest operational clarity
- strongest urgency signaling
- most command-center-like presentation without looking militarized or like a generic SOC dashboard

Traits:
- dense but controlled summary layer
- stronger contrast for safety and queue states
- very explicit task priority surfaces
- sharp hierarchy for high-risk vs normal information

### 2. Calm Research Operations

Intent:
- lower visual fatigue
- calmer long-session workspace
- more coordination-oriented than alarm-oriented

Traits:
- more breathing room
- softer panel rhythm
- clearer reading comfort
- professional research-operations tone

### 3. Precision Intelligence Workspace

Intent:
- highlight intelligent assistance as a first-class CRC tool
- better framing for guidance, questionnaires, protocols, and disengagement together
- clinical and precise, not flashy or consumer-tech

Traits:
- cleaner analytical framing
- stronger cross-panel continuity
- high information legibility
- visible but restrained intelligence emphasis

## Required Page Coverage Per Direction

Each direction board must include these ten desktop pages:

1. CRC Login
2. Today
3. Patients
4. Patient Workspace / Study Coordination
5. Safety
6. Intelligence / Side Effect Guidance
7. Intelligence / Patient Disengagement Prediction
8. Questionnaires
9. Protocols
10. Resources

## Shared UI Rules Across All Three Directions

- Keep the CRC website clearly professional and clinical.
- Do not make any direction feel like consumer marketing, gaming UI, or a generic SaaS landing page.
- Use English UI copy.
- Keep one coherent system inside each direction:
  - sidebar style
  - top bar style
  - summary cards
  - table and list rows
  - tabs
  - badges
  - alert styling
  - CTA hierarchy
  - spacing rhythm
  - typography hierarchy
- Keep the product boundary visible:
  - this is CRC-only
  - patient surfaces are out of scope

## Page-Level Content Priorities

### CRC Login
- CRC-only access identity
- professional first impression
- clear boundary language

### Today
- urgent work first
- assignment and queue metrics second
- clear next actions

### Patients
- roster + selected patient handoff
- patient context should feel persistent

### Patient Workspace / Study Coordination
- patient assignment
- recent vitals
- appointment handling
- protocol-linked context

### Safety
- open incidents
- due state
- severity
- history and resolution flow

### Intelligence / Side Effect Guidance
- selected patient context
- protocol/CTCAE grounding
- readable conversational workspace

### Intelligence / Patient Disengagement Prediction
- patient ranking
- confidence / data completeness
- CRC-only operational framing

### Questionnaires
- pending review
- release workflow
- submitted / overdue visibility

### Protocols
- protocol library
- static context / indexing status
- monitored vitals and policy visibility

### Resources
- CTCAE access
- assigned protocol quick access

## Review Standard

The chosen direction should optimize for:

- real CRC desktop usability
- clear task hierarchy
- low confusion
- strong professional credibility
- realistic implementability inside the current codebase
