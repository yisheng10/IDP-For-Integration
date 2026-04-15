# TrialLight Testing Plan And Packs Deep Critique

## 1. Purpose Of This Critique

This document critiques the current testing package consisting of:

- `TrialLight Testing Plan.docx`
- `Pack_01_Master_Setup_and_Control.docx`
- `Pack_02_Operational_Forms.docx`
- `Pack_03_Patient_Role_Packs.docx`
- `Pack_04_Answer_Key_and_Background_Group.docx`

The goal is not to attack the project. The goal is to stop the study from turning into a large improvisation exercise.

This critique focuses on:

- design validity
- internal consistency across documents
- mismatch between the documents and the current TrialLight system
- places where observers, CRCs, or volunteers will be forced to improvise
- places where the study may unintentionally overclaim what it has really shown

This critique only uses:

- what is explicitly written in the five documents above
- what is already known about the current TrialLight workspace and official dropout runtime

If a workflow detail exists in the product but is not written clearly in these documents, that is still a study-design problem. In a live 30-day study, undocumented assumptions become improvisation.

## 2. Executive Judgment

## Overall Assessment

This package is **directionally much better** than the earlier compressed-session concept, because it now uses a real 30-day live role-play period.

That is an important improvement.

However, in its current form, the package is **not yet tight enough** to be used as a clean testing protocol without revision.

The biggest reason is not one single bug. The biggest reason is that the package still contains:

- design confounding
- undefined operational rules
- terms that do not match current TrialLight behavior
- measurement forms that are too coarse for the outcomes being claimed
- role/scenario structures that are not phase-balanced

So the correct high-level judgment is:

- **usable as a serious draft:** yes
- **ready to run without revision:** no
- **at risk of becoming structured improvisation if left unchanged:** yes

## What Is Good

Several design choices are already strong:

- TrialLight is explicitly limited to **drug clinical trial workflow**
- the hypertension outpatient oral-drug framing is appropriate for the current system
- the 30-day live design is much more realistic than a few-hour compression design
- the package separates patient-side outcomes and CRC-side outcomes
- the package uses a gold-standard answer key
- the package explicitly includes a background list to create CRC list noise
- the package already warns people not to improvise

These are good foundations.

The problem is that the current documents still leave too many critical implementation details under-specified or logically unbalanced.

## 3. The Biggest Critical Problems

## Critical Problem 1: Sequence AB Is Confounded With Script Progression

The study now uses:

- Days 1-15: Conventional
- Days 16-30: TrialLight

for the **same volunteers**, the **same roles**, and the **same 30-day storyline**.

This is a major validity problem.

Why:

- the later half of the script is not the same as the earlier half
- some roles clearly worsen over time
- some dropout-related patterns accumulate over time
- some symptoms repeat or intensify later in the month

This means the TrialLight phase is not being compared against a matched difficulty version of the same events. It is being compared against a later stage of the same story.

That creates a strong confound:

- if TrialLight looks better, part of that may be because participants and CRC are more experienced by then
- if TrialLight looks worse, part of that may be because the later-half cases are inherently more severe or more complex

This is not a small academic complaint. It directly affects the fairness of the comparison.

### Concrete Evidence

From `Pack_03_Patient_Role_Packs.docx` and `Pack_04_Answer_Key_and_Background_Group.docx`:

- `P05` is explicitly described as the main dropout-risk case and becomes more severe across later days
- `P08` also escalates into a mixed safety-plus-engagement case later in the month
- review-day snapshots differ across Day 7 / 14 versus Day 21 / 28 / 30 because the story itself has progressed

So the two phases are not facing equivalent event distributions.

### Why This Matters

This means the current package does **not** cleanly isolate:

- workflow effect

from:

- order effect
- learning effect
- role progression effect
- scenario severity effect

### Required Fix

Before testing, one of the following must be chosen explicitly:

1. Keep Sequence AB, but rewrite the claims to acknowledge that this is a **feasibility pilot**, not a fair causal comparison.
2. Keep Sequence AB, but split the role trajectories into **phase-balanced matched halves**.
3. Replace Sequence AB with a more balanced design.

If you do not fix this, the study will produce results that are easy to criticize.

## Critical Problem 2: Dropout Support Assumes Longitudinal History, But The Operational Source Of That History Is Not Fully Defined

The package assumes CRC dropout support will be used during the TrialLight phase.

But in the study design:

- Days 1-15 are conventional
- TrialLight only starts on Day 16

The problem is that the current dropout engine uses longitudinal time-based features. It is not just looking at the current day.

Examples include:

- days since last activity
- ePRO completion ratio over recent windows
- missed appointment patterns
- unanswered follow-up patterns
- symptom burden trends

If Days 1-15 happen outside TrialLight, then the documents must explicitly explain how the TrialLight dropout side receives or reconstructs those first 15 days of relevant history.

Right now, the package does **not** explain that clearly enough.

`Pack_01_Master_Setup_and_Control.docx` says:

- do not reset patient history on Day 16

But that is not the same thing as specifying how the history exists in the system.

### Why This Is Critical

If this is not defined, one of two bad things happens:

1. The dropout panel starts Day 16 with incomplete digital history.
2. The project team manually backfills history in an ad hoc way.

Either way, the testing day becomes improvisation.

### Required Fix

You need one explicit operational rule:

- either the TrialLight dropout view in Days 16-30 is fed by **pre-seeded study history**
- or the conventional Days 1-15 data are formally mirrored into the dropout input layer using a defined procedure
- or dropout is treated as a **scenario-backed support tool** rather than a directly emergent live model output

This must be written clearly before testing.

## Critical Problem 3: The Plan Repeatedly Uses ePRO "Late" Language That Does Not Match Current TrialLight Rules

You already noticed this, and you are correct.

The current package repeatedly uses phrases like:

- `Scheduled ePRO is late`
- `Late ePRO follow-up`
- `One late ePRO by same evening`

This appears in:

- `Pack_03_Patient_Role_Packs.docx`
- `Pack_04_Answer_Key_and_Background_Group.docx`

But in the current TrialLight logic, ePRO is not best described that way.

If the participant has the entire calendar day to submit the questionnaire, then:

- same-day completion is still on time
- "late" within the same day is the wrong term
- the meaningful boundary is usually **same-day completed vs not completed by daily cutoff**

### Why This Matters

If the wording is wrong:

- observers will score wrongly
- CRC follow-up logic will be inconsistent
- role packs will not match the system
- human study findings will become partly about wording confusion rather than product behavior

### Required Fix

Replace vague same-day `late ePRO` language with a rule that matches the actual system.

For example:

- `completed by end-of-day`
- `not completed by daily cutoff`
- `missed same-day ePRO`

Do not let observers or volunteers invent their own definition of "late."

## Critical Problem 4: The Background Group Is Not Actually Hidden Noise If IDs Are Obviously Marked

The active volunteers use IDs like:

- `P01` to `P08`

The background list uses IDs like:

- `BG01` to `BG24`

This is a major design weakness.

If the CRC sees IDs that visually reveal:

- who is an active role-play case
- who is just background noise

then the instruction:

- "Treat the background patients as part of the real working list"

becomes weak.

The masking collapses.

### Why This Matters

You want to test prioritization under list noise.

But if the full list is visually split into:

- obvious active humans
- obvious synthetic background entries

then the CRC does not really have to search a genuinely mixed list.

The background load becomes cosmetic.

### Required Fix

Use a neutral unified ID scheme.

Do not use visibly different prefixes like `P` versus `BG` if the CRC can see them during testing.

## Critical Problem 5: The Background Group Is Too Safe And Too Memorizable

The documents say:

- background cases are mostly routine
- they should never rise above watch level unless the local team changes the rule
- they should stay the same across both phases

This creates two problems at once.

### Problem A

If the background cases are almost guaranteed to stay harmless, then the background list is not a true prioritization challenge. It becomes decorative workload.

### Problem B

Because the same fixed background group persists across both phases, the CRC can learn:

- these cases are usually noise
- these IDs are not the main story

This especially benefits the later TrialLight phase.

### Why This Matters

Your design currently tries to make the comparison fair by keeping the background group fixed.

But the same choice also makes memorization easier and weakens the realism of the list-noise challenge.

### Required Fix

At minimum, you need to decide and document:

- whether the background cases are shown in a stable or shuffled order
- how much harmless variation each can show
- whether a few background cases are allowed to become temporarily ambiguous without turning into real red flags

Right now the package is too close to:

- "background group exists on paper"

rather than:

- "background group genuinely challenges prioritization"

## 4. Major Design And Measurement Problems

## Major Problem 1: Unequal ePRO Burden Across Phases

The role packs define scheduled ePRO days as:

- 1
- 7
- 14
- 21
- 28

But the study phases are:

- Conventional: Days 1-15
- TrialLight: Days 16-30

That means the conventional phase contains:

- Day 1
- Day 7
- Day 14

which is **3 scheduled ePRO days**

while the TrialLight phase contains:

- Day 21
- Day 28

which is only **2 scheduled ePRO days**

This is not phase-balanced.

### Why This Matters

Any outcome related to:

- ePRO completion
- ePRO follow-up burden
- disengagement signals connected to ePRO

is being compared across unequal opportunity windows.

### Required Fix

Either:

- phase-balance the ePRO due days

or:

- stop interpreting ePRO-related differences as if both phases had equal exposure

## Major Problem 2: Review-Day Structure Is Also Unequal Across Phases

The role-play trial basis emphasizes review points like:

- Day 1
- Day 7
- Day 14
- Day 21
- Day 28

The review-day CRC snapshots in `Pack_04` are:

- Day 1 (Conventional)
- Day 7 (Conventional)
- Day 14 (Conventional)
- Day 21 (TrialLight)
- Day 28 (TrialLight)
- Day 30 (TrialLight)

Again, the two phases are not clearly symmetric.

The study can still run, but then it should be described as:

- an operational pilot with anchored review points

not as a tightly balanced comparison.

## Major Problem 3: The Human-Testing Hypotheses Mix System Prerequisites With Human Study Outcomes

The study hypotheses include:

- `H5: The current dropout prediction engine will meet the pre-defined offline technical gate before its CRC dashboard is used in this study.`

This is not a human-testing hypothesis in the same sense as the other hypotheses.

It is a:

- pre-study technical eligibility condition

not really a study hypothesis.

### Why This Matters

Mixing these together makes the study logic look conceptually untidy.

### Required Fix

Move the dropout technical gate out of the hypotheses section and into:

- Study activation criteria
- Pre-study eligibility criteria
- Technical readiness criteria

## Major Problem 4: The Forms Are Too Coarse For Several Claimed Outcomes

The package claims outcomes such as:

- symptom reporting delay
- CRC decision time
- prioritization agreement
- false alert / over-triage
- missed high-risk case rate

But the operational forms do not always capture enough granularity to support those claims cleanly.

### Example A: Observer Timing Sheet

`Form 7` captures:

- day
- study ID
- event
- start time
- completed at
- active workflow
- correct yes/no
- notes

This is not enough if you want to separately calculate:

- symptom onset time
- report submission time
- guidance display time
- CRC first recognition time
- CRC first action time

Those are different timestamps.

### Example B: CRC Ranking And Action Record

`Form 8` records:

- top priority patients today
- reason
- chosen action
- watch-only people

But if your metric is "prioritization agreement with gold standard within the full mixed list," then this form may be too loose.

It does not force:

- a fixed top-N list
- a full ranked shortlist
- a structured field for missed cases
- a structured field for false positives

That makes later scoring more subjective.

### Required Fix

Refine the forms so they directly support the metrics being claimed.

Right now the metrics are more detailed than the data collection instruments.

That mismatch is dangerous.


## Major Problem 6: Patient-Side Comparison Is Biased By Learning

In Sequence AB:

- the same volunteers first learn the routine under conventional workflow
- then later use TrialLight

This means improved TrialLight performance may partly reflect:

- routine familiarity
- scenario familiarity
- symptom-rule familiarity
- confidence from 15 days of practice

This especially affects outcomes like:

- reporting speed
- action correctness
- usability

Because later use often feels easier regardless of the tool.

This does not make the study useless, but it means the interpretation must stay modest.

## Major Problem 7: CRC-Side Comparison Is Also Biased By Learning

The same CRC:

- sees the same role archetypes
- learns the background list
- learns the likely problem patients
- learns the study rhythm

By the time TrialLight starts on Day 16, the CRC is no longer naive.

So if CRC performance improves, the study cannot cleanly separate:

- tool effect

from:

- operator learning

This is one of the biggest reasons the current design must be described as a pilot workflow study, not a definitive comparison.

## Major Problem 8: The Current Documents Do Not Fully Specify What "Same-Day Review" Means

The packs use action labels like:

- same-day CRC review
- urgent escalation
- watch and monitor

But the documents do not clearly define the operational clock windows.

Examples:

- Does "same-day" mean within 2 hours?
- before end of working day?
- before midnight?
- before the next scheduled review?

In a 30-day live study, vague time language is not acceptable.

### Required Fix

Define explicit operational windows for:

- morning routine window
- ePRO daily cutoff
- same-day CRC review deadline
- urgent contact expectation
- message reply expectation

Without these, observers will improvise.

## 5. Current TrialLight-Specific Mismatches

## Mismatch 1: ePRO Release Logic Is Not Explicitly Handled

Current TrialLight work has included CRC-side ePRO review/release workflow logic.

But the testing documents mostly treat ePRO as:

- simply due on certain days

The pack does not clearly specify whether the study will use:

- the full real TrialLight ePRO release logic
- a simplified pre-approved release mode
- a bypassed study mode

### Why This Matters

If this is not decided now, live testing will improvise.

This is exactly the kind of hidden operational detail that breaks study discipline.

### Required Fix

Add one explicit rule:

- what happens operationally before a volunteer can see the scheduled ePRO in the TrialLight phase

## Mismatch 2: The Plan Treats Dropout Support As If The Human Study And The Offline Gate Are One Continuous Story

The current official dropout engine is frozen as:

- `Honest v3`

with offline metrics already documented.

That part is fine.

The problem is that the live testing documents still blur together:

- offline model readiness
- human workflow usefulness

These should remain separate.

### Correct Position

The human study can evaluate:

- whether CRC uses the dropout support panel helpfully
- whether prioritization becomes faster or clearer

The human study should **not** be written as if it proves:

- real-world predictive validity

This distinction should stay explicit.

## Mismatch 3: Conventional Workflow Is Underspecified As A Fair Comparator

The conventional route is described as:

- static written instruction sheet
- simple manual submissions
- manual CRC review

But the full operational structure for the conventional arm is still less concretely defined than the TrialLight arm.

Questions the documents do not fully answer:

- How exactly does the CRC receive conventional-route updates across 32 cases each day?
- Is there one binder, one spreadsheet, one inbox, or one combined log?
- How are background patients shown in the conventional arm in a way that is fair but not artificially crippled?
- What is the conventional equivalent of list view ordering?

If the conventional arm is too weakly specified, the study risks becoming:

- a comparison between a real product and an intentionally undersupported control arm

That would weaken the credibility of any claimed advantage.

## 6. Cross-Document Inconsistencies

## Inconsistency 1: Role Definitions In The Main Plan Do Not Fully Match The Actual Role Packs

The main testing plan gives short role summaries such as:

- `P5 Persistent moderate symptoms`
- `P6 Operational non-responder`
- `P7 Worsening symptoms + disengagement`
- `P8 Red-flag safety case`

But the actual role-pack labels in `Pack_03` are:

- `P05 - Gradual disengagement`
- `P06 - Safety red-flag case`
- `P07 - Anxiety and persistent symptom`
- `P08 - High BP plus disengagement`

This is not a harmless wording difference.

It changes the conceptual identity of the cases.

### Why This Matters

If the main plan and the role packs describe the same participant differently, then:

- supervisors will be confused
- observers may score wrongly
- future assistants will give the wrong advice

### Required Fix

Choose one canonical role set and make all documents match it exactly.

## Inconsistency 2: The Background Group Is Called "Generated In Both Workflows," But The Operational Mechanism Is Not Clearly Specified

The testing plan says the background group is:

- generated in both workflows

But the exact operational mechanism is not described clearly enough.

This matters because "generated in both workflows" could mean:

- pre-seeded into both systems before Day 1
- generated once and mirrored
- manually represented in the conventional arm
- auto-rendered inside TrialLight but manually simulated in conventional

Those are different things.

The documents should pick one and state it clearly.

## Inconsistency 3: Some Outcomes Use Formal Labels While The Forms Use Simplified Custom Versions

The package uses labels like:

- SUS
- NASA-TLX

But the actual forms are simplified plain-language versions.

That is not automatically wrong, but the naming should be careful.

If the forms are not the standard instruments, then it is safer to call them:

- SUS-style usability form
- simplified raw NASA-TLX-style workload form

rather than implying strict instrument fidelity.

## 7. Pack-By-Pack Critique

## 7.1 TrialLight Testing Plan.docx

### Strengths

- clear drug-trial-only scope
- sensible outpatient hypertension framing
- explicit limitation language
- sensible split between patient-side and CRC-side outcomes

### Main Problems

- Sequence AB is confounded with time progression
- "short outpatient simulation" wording is outdated and misleading for a 30-day live design
- dropout technical gate is framed like a study hypothesis instead of a readiness criterion
- several outcomes are more ambitious than the forms can support

## 7.2 Pack_01_Master_Setup_and_Control.docx

### Strengths

- useful operational backbone
- good emphasis on fixed IDs, full-pack control, and daily closing
- good attempt to stop improvisation

### Main Problems

- "Do not reset patient history" is not enough; the actual history mechanism is undefined
- no formal non-study rehearsal day is built in
- technical readiness is stated, but the study still lacks rules for what to do if partial failure happens on Day 7, 14, 21, or 28
- no clear daily clock windows are defined

## 7.3 Pack_02_Operational_Forms.docx

### Strengths

- practical
- simple
- easy for non-expert participants to use

### Main Problems

- forms are too coarse for some claimed metrics
- conventional daily form uses `ePRO done yes/no` without an explicit `not due` state
- symptom form is good for action capture but not enough for multi-step timing analysis
- CRC ranking form does not force enough structure to compute prioritization quality robustly
- SUS and NASA naming may overstate instrument fidelity

## 7.4 Pack_03_Patient_Role_Packs.docx

### Strengths

- clear volunteer-facing language
- strong "do not improvise" messaging
- useful role diversity

### Main Problems

- role identities do not fully match the main plan summary
- several role trajectories worsen over time, which makes Sequence AB especially problematic
- repeated use of `late ePRO` language does not match current TrialLight interpretation
- role pack timing language may still be inconsistent across cases

## 7.5 Pack_04_Answer_Key_and_Background_Group.docx

### Strengths

- very useful idea to centralize gold-standard action levels
- useful CRC priority anchors
- useful attempt to formalize background noise

### Main Problems

- background group is too obviously synthetic if shown with `BGxx` IDs
- background cases are too safely capped, so list noise may become cosmetic
- review-day snapshots are helpful but not enough to fully support daily prioritization scoring
- several `late ePRO` and `missed ePRO` rules need to be rewritten to match actual product logic

## 8. What Must Be Fixed Before Running The Study

These are the items I would treat as mandatory before live testing starts.

## Must Fix 1

Decide how dropout history exists on Day 16.

Without that, the dropout-support part is operationally ambiguous.

## Must Fix 2

Replace all same-day `late ePRO` wording with a rule that matches actual TrialLight ePRO timing.

## Must Fix 3

Decide whether this is:

- a feasibility pilot with Sequence AB

or:

- a fair comparative design

If it stays Sequence AB, the claims must become more modest.

## Must Fix 4

Unify the role definitions across:

- main plan
- role packs
- answer key

## Must Fix 5

Replace visible `Pxx` versus `BGxx` identity separation if the CRC can see those IDs.

## Must Fix 6

Define exact operational time windows for:

- morning routine
- ePRO day cutoff
- same-day review
- urgent escalation expectation
- response window

## Must Fix 7

Make the data collection forms match the metrics more tightly.

Especially:

- observer timestamps
- CRC ranking structure
- missed high-risk and false-alert capture

## Must Fix 8

Specify how the conventional arm operationally presents the full mixed patient list in a fair way.

## Must Fix 9

Add a non-study rehearsal before Day 1.

## Must Fix 10

Reclassify the dropout technical gate as a pre-study readiness criterion, not a normal human-study hypothesis.

## 9. Strong Recommendations

These are not as critical as the items above, but I strongly recommend them.

## Recommendation 1

Rename the questionnaire instruments more cautiously unless you are using the strict standard versions.

## Recommendation 2

Define a volunteer replacement and missed-day policy.

For a 30-day live study, this matters.

## Recommendation 3

Define a technology failure recovery rule.

The issue/deviation log exists, but the rescue procedure is not specific enough.

## Recommendation 4

Reduce the amount of manual daily exporting if possible.

Daily screenshots and exports across 30 days can become its own source of inconsistency.

## Recommendation 5

If you keep the background group fixed, randomize how it appears in the CRC working list so the CRC cannot memorize the noise pattern too easily.

## 10. Final Bottom-Line Verdict

This package is **serious**, **improved**, and **worth salvaging**.

But it is **not yet clean enough to run without revision**.

If you run it exactly as written now, the biggest likely failure is not total chaos. The bigger risk is subtler:

- the study will look organized
- the team will work hard
- data will be collected
- but several results will be easy to challenge because the design and the forms do not fully match the claims

In other words:

this is close to a disciplined study package, but still too close to a controlled improvisation environment.

The key fixes are not cosmetic. They are:

- phase fairness
- longitudinal dropout logic
- ePRO wording alignment
- background-list realism
- stronger operational definitions
- stronger data collection structure

Once those are tightened, the package will be much more defendable.
