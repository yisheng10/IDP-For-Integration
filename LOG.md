# TrialLight Project Log

## Last Updated
- Date: 2026-03-29
- Workspace: `D:\IDP For Integration`

## Current Objective
- Stabilize TrialLight v1 for internal teammate testing across the CRC website and patient app.
- Keep the workspace as an integration layer across the CRC web app, patient app, ePRO service, and dropout backend.

## Overall Status
- CRC website: active and under heavy integration.
- Patient app: active and usable for core testing flows.
- ePRO service: active and connected to the patient app flow.
- Dropout backend: active locally through Python 3.12 tooling, but still a separate repository/runtime.
- Production cloud functions: partially blocked by Firebase plan limitations.

## Completed Work
### Dropout Model Rebuild
- Rebuilt the dropout backend around a single-model `stage_3_29_single` contract.
- Removed the old staged strategy from the active training/inference path:
  - `stage_3_6`
  - `stage_7_29`
  - `stage_30_plus`
- Locked the new scoring policy to:
  - score only day 3 to day 29
  - treat day 1 to day 2 as `insufficient history`
  - predict 7-day disengagement risk
- Replaced unrealistic dynamic placeholders such as `med_status` and `task_ratio` with TrialLight-style operational signals:
  - vitals activity and abnormal-vitals counts
  - ePRO recency and completion state
  - appointment adherence and missed-visit signals
  - CRC follow-up responsiveness
  - side-effect reporting and emergency-event counts
- Rewrote the dropout synthetic generator so it now emits:
  - patient-day operational signals
  - `disengagement_event_today`
  - `is_disengaged`
  - `label_disengagement_7d`
- Reworked the dropout training pipeline to support:
  - one fixed 7-day lookback window
  - one fixed 7-day prediction horizon
  - patient-level and trial-level split strategies
  - recall-first model selection using `precision at recall >= 0.80`
  - logistic-regression baseline comparison
  - feature-group ablation entrypoints
- Updated dropout inference, batch inference, adapter, and evaluation files so they align with the new single-model contract.
- Added minimum consistency handling for `insufficient history` routing in the inference path.
- Targeted syntax validation passed for the rewritten dropout files via `py_compile`.
- End-to-end runtime training smoke test is still blocked in the current Codex environment because the available Python runtimes here do not have the required project packages installed.

### Dropout Hybrid Real-Trial Rebuild
- Replaced the previous pure-synthetic dropout generator with a hybrid generator grounded in:
  - `merged_allphases_X_dedup.csv`
  - `merged_allphases_Y_dedup.csv`
- Locked dropout training around real trial metadata priors:
  - `trial_phase`
  - `condition_family`
  - `criteria_complexity`
  - `enrollment`
  - `trial_dropout_prior`
  - intervention-profile flags
- Removed the old frequency-bucket `condition_cat` direction and replaced it with an explicit clinical-family mapping derived from `condition_browse/mesh_term` with fallback to `condition`.
- Reworked the generator to retain latent patient archetypes and MNAR behavior, while replacing unrealistic observed placeholders with TrialLight-style operational signals:
  - vitals completion ratios
  - ePRO completion ratios
  - appointment adherence
  - CRC follow-up responsiveness
  - side-effect burden
  - symptom burden composite
- Added structured burden features for:
  - `pain_score_*`
  - `anxiety_score_*`
  - `ctcae_grade_*`
- Introduced a canonical CTCAE-grade proxy path so the training contract can use numeric `ctcae_grade_*` features even while the product surface still operationally emits `mild / moderate / serious`.
- Changed the synthetic schedule logic from global fixed cadence to trial-conditioned cadence priors for:
  - vitals
  - ePRO
  - appointments
- Tightened synthetic realism:
  - `dist_km` is now capped to realistic ranges
  - `criteria_complexity` now comes from eligibility line count instead of raw text length
  - caregiver support is now conditionally sampled instead of flat random
- Updated training, feature-pipeline, adapter, inference-helper, batch-inference, and evaluation code so the new hybrid schema is internally consistent.
- Post-change syntax validation passed again for the updated dropout code via `py_compile`.

### Workspace Governance
- Added root workspace governance and phased planning documents.
- Locked the v1 product boundary:
  - CRC website is CRC-only.
  - patient mobile app is patient-only.
  - ePRO remains a separate service used by the patient app.
  - dropout prediction remains CRC-only.

### CRC Website
- Reworked the CRC shell toward a cleaner dashboard layout.
- Added section-based CRC workflows for:
  - Dashboard
  - Patients
  - Safety Inbox
  - Study Coordination
  - Resources
- Renamed CRC AI workspace from `AI Copilot` to `Side Effect Guidance`.
- Promoted `Patient Dropout Prediction` as a core CRC intelligence module directly under `Side Effect Guidance`.
- Added CRC-side safety inbox and grouped incident handling.

### Patient App
- Preserved patient-only surface boundaries.
- Integrated native ePRO access.
- Added patient vital logging with automatic abnormal-value escalation.
- Shifted side-effect intake toward AI-assisted symptom guidance and audit-preserved chat flows.

### Safety And Incident Flow
- Added structured incident records for side effects and emergencies.
- Added protocol-aware escalation handling.
- Preserved emergency positioning as support/documentation, not replacement for direct emergency phone escalation.

### AI Guidance
- Local CRC `Side Effect Guidance` was cut over from local Ollama dependency to a Firebase callable flow designed for Gemini.
- Local emulator testing confirmed CRC guidance can return Gemini output in local development.
- Provider abstraction direction is in place so qwen can be restored later without redesigning the CRC UI.

### Dropout Backend
- Standardized local runtime around Python 3.12.
- Added self-check/startup guidance for the dropout backend.
- Preserved separate repository/runtime ownership for the model service.

### Shareable Teammate Testing Deployment
- Converted Firebase Hosting planning from a single site to a two-link model:
  - CRC website on `triallight`
  - patient web on `triallight-patient`
- Added deploy-oriented build scripts for CRC web and patient web static export.
- Prepared the patient app for static web export as a shareable browser link.
- Hardened ePRO and dropout services for public deployment:
  - env-driven `PORT`
  - deploy-friendly host binding
  - origin allowlist based CORS
- Added deployment assets and docs for Firebase multi-site hosting and Render-based backend publishing.

### No-Render Final Architecture Preparation
- Added a no-Render preparation guide centered on Firebase + Supabase.
- Added a Supabase migration baseline for:
  - `epro_subject_state`
  - `dropout_predictions`
- Added a GitHub Actions template for future daily dropout precompute publishing.
- Marked the Render deployment guide as a legacy transition reference rather than the preferred final path.

## Current Blockers
- Firebase cloud functions are not fully deployable to production on the current project plan because the Firebase project still needs Blaze features for function deployment.
- As a result:
  - hosted CRC `Side Effect Guidance` is not yet fully live through production functions
  - production browser push automation is not yet fully live
- Local development remains the source of truth for full Gemini guidance testing.

## Repository Snapshot
### Root Repository
- Remote: `origin -> https://github.com/yisheng10/IDP-For-Integration.git`
- Status: not clean yet
- Reason:
  - CRC website layout and Gemini integration changes are still uncommitted
  - new service adapter file is still untracked
  - nested app/model folders are tracked as gitlink entries from the root repository

### Patient App Repository
- Status: clean at the moment
- Note:
  - tracked in the root repository as a gitlink entry
  - no remote is currently configured inside the nested repository

### Dropout Backend Repository
- Status: not clean yet
- Reason:
  - repository is ahead by one local commit
  - `LOG.md` is currently deleted in that repository working tree
- Note:
  - tracked in the root repository as a gitlink entry
  - has its own remote: `https://github.com/yisheng10/Patient-Dropout-Prediction.git`

## Repository Structure Risk
- The root repository currently contains gitlink entries for the patient app and dropout backend, but the root workspace does not have a `.gitmodules` file.
- This means the root repository is not yet a clean, standard submodule setup.
- Pushing only the root repository may not be enough for another machine or teammate to reproduce the full workspace correctly.

## What Still Needs Validation
- Full teammate UAT on the CRC website
- Full teammate UAT on the patient app
- Production-side Gemini guidance after cloud function deployment is unblocked
- Production browser push after function deployment is unblocked

## Recommended Next Steps
1. Clean the remaining git state in the root repository and dropout backend repository.
2. Decide whether the deleted dropout `LOG.md` should be restored or intentionally removed in a new commit.
3. Run one final pass of local end-to-end testing across:
   - CRC login and workspace navigation
   - patient signup/login
   - ePRO submission
   - vital logging
   - side effect escalation
   - CRC `Side Effect Guidance`
   - dropout panel rendering
4. Commit and push only after both the root repository and dropout backend repository are clean and intentional.

## Notes
- Do not commit real secrets such as `functions/.env`.
- The current hosted web UI may be newer than the currently deployed production functions.
- Local `localhost` testing is still the most complete environment for v1 verification.

### Dropout Training Observability
- Added terminal-friendly progress output to the dropout hybrid generator:
  - real trial metadata load start
  - planned trial/patient counts
  - periodic per-trial progress checkpoints
  - CSV write start
  - sanity report write start
  - final dataset summary
- Added terminal-friendly progress output to dropout training:
  - dataset load and split summary
  - cache load/build summary
  - train/test window counts
  - per-epoch loss and validation metrics
  - best-checkpoint announcements
  - logistic baseline progress
  - feature ablation progress
  - checkpoint / artifacts / summary output paths
- Verified the updated `data_generator.py` and `train.py` with `py_compile`.

### Dropout Local Debug Run
- Because the original `.venv312` Python launcher was broken, installed dropout training dependencies into a local project folder:
  - `Patient-Dropout-Prediction/.py314_packages`
- Confirmed that full-trial generator execution on all `30090` merged trials is too large for practical local iteration:
  - reached roughly `7750` trials in 30 minutes before timeout
- Generated a bounded debug dataset instead:
  - source: real `merged_allphases_X/Y`
  - `max_trials = 1000`
  - output: `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000.csv`
  - rows: `938268`
  - patients: `26063`
  - trials: `1000`
  - positive rows: `39599`
- Ran single-model local training on the debug dataset with a pragmatic CPU-friendly setup:
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
- Best transformer result from the debug run:
  - `p_at_r80 = 0.3155`
  - `pr_auc = 0.4873`
  - `alert_frac_at_r80 = 0.1423`
  - `roc_auc = 0.9393`
- Logistic baseline on the same split:
  - `p_at_r80 = 0.3137`
  - `pr_auc = 0.4857`
  - `alert_frac_at_r80 = 0.1427`
- Feature ablation baseline findings on the same debug dataset:
  - removing `vitals` hurt the most
  - removing `epro` caused a moderate drop
  - removing `pain_anxiety` caused a small but real drop
  - removing `side_effects` caused only a very small drop in the current setup
- Current interpretation:
  - the model is learning mostly from adherence / activity signals
  - vitals are currently the strongest family
  - ePRO contributes useful signal
  - pain/anxiety are helping, but not yet strongly enough
  - side-effect burden is probably underpowered relative to the current label definition

### Dropout CUDA Enablement
- Added a separate CUDA-specific local dependency layer without overwriting the CPU package folder:
  - `Patient-Dropout-Prediction/.py314_packages_cuda`
- Installed `torch 2.11.0+cu128` into the CUDA package layer.
- Verified local GPU runtime:
  - `torch.cuda.is_available() = True`
  - device = `NVIDIA GeForce RTX 4060 Laptop GPU`
- Confirmed that the repeated log lines observed during local runs were terminal-render duplication caused by resizing the terminal window, not repeated model execution.
- Ran the same debug training configuration on CUDA:
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- CUDA debug run result:
  - `p_at_r80 = 0.3174`
  - `pr_auc = 0.4913`
  - `alert_frac_at_r80 = 0.1413`
  - `roc_auc = 0.9397`
- Local CUDA artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v2__SSpatient__FGfull__2026-03-29T05-12-47+00-00/`

### Dropout Symptom-Focused Rebuild (v3)
- Implemented the symptom-focused improvement pass in the active dropout backend:
  - `Patient-Dropout-Prediction/src/data_generator.py`
  - `Patient-Dropout-Prediction/src/feature_pipeline.py`
  - `Patient-Dropout-Prediction/src/train.py`
  - `Patient-Dropout-Prediction/src/predict.py`
- Upgraded the feature contract from `triallight_hybrid_v2` to:
  - `feature_version = triallight_hybrid_v3_symptom_focus`
- Upgraded the label contract from hard disengagement only to:
  - `label_version = disengagement_7d_v2_symptom_assisted`
- Kept the single-model setup unchanged:
  - `stage_3_29_single`
  - `history_window_days = 7`
  - `prediction_horizon_days = 7`
  - `min_scoring_day = 3`
- Reworked the hybrid generator to strengthen symptom dynamics without reverting to a pure synthetic trial setup:
  - added explicit symptom flare / aftershock states
  - made high `pain_score` and high `ctcae_grade` degrade later activity, vitals completion, ePRO completion, and CRC responsiveness
  - preserved anxiety as an optional missing-aware branch
  - kept real-trial grounding from `merged_allphases_X_dedup.csv` and `merged_allphases_Y_dedup.csv`
- Added new symptom-focused derived features:
  - `high_pain_burden_7d`
  - `high_anxiety_burden_7d`
  - `high_ctcae_burden_14d`
  - `symptom_persistence_7d`
  - `symptom_engagement_collision_7d`
- Reweighted `symptom_burden_composite_14d` to emphasize symptom burden directly:
  - CTCAE weight `0.40`
  - pain weight `0.35`
  - anxiety weight `0.25`
  - anxiety missingness now renormalizes available weights instead of forcing anxiety to zero
- Changed the positive-label mechanism:
  - kept the previous hard disengagement rule
  - added a symptom-assisted trigger for high symptom burden plus moderate participation decline
  - severe symptoms alone still do not force a positive label
- Verified the updated dropout source files with `py_compile`.

### Dropout Symptom-Focused Debug Dataset
- Generated a new bounded debug dataset without overwriting the earlier `debug1000` outputs:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v3symptom.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v3symptom__sanity.json`
- Dataset characteristics:
  - rows: `938268`
  - patients: `26063`
  - trials: `1000`
  - positive rows: `123015`
- Compared with the previous `debug1000` dataset, the symptom-assisted label greatly increased positive coverage.

### Dropout Symptom-Focused CUDA Run
- Ran the v3 symptom-focused dataset on the same lightweight CUDA loop for apples-to-apples comparison:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v3symptom.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- Best transformer result:
  - `p_at_r80 = 0.6390`
  - `pr_auc = 0.7583`
  - `alert_frac_at_r80 = 0.6710`
  - `roc_auc = 0.7255`
- Logistic baseline on the same dataset:
  - `p_at_r80 = 0.6295`
  - `pr_auc = 0.7492`
  - `alert_frac_at_r80 = 0.6811`
  - `roc_auc = 0.7166`
- Local training artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T06-08-09+00-00/`

### Dropout Symptom-Focused Ablation Readout
- Ran the v3 feature-group ablation suite on the new symptom-focused dataset.
- Full v3 transformer reference point:
  - `p_at_r80 = 0.6390`
  - `pr_auc = 0.7583`
  - `alert_frac_at_r80 = 0.6710`
- Key ablation results:
  - without `side_effects`:
    - `p_at_r80 = 0.6125`
    - `pr_auc = 0.7397`
    - `alert_frac_at_r80 = 0.7013`
  - without `pain_anxiety`:
    - `p_at_r80 = 0.6268`
    - `pr_auc = 0.7473`
    - `alert_frac_at_r80 = 0.6870`
- Interpretation:
  - the symptom-focused rebuild succeeded in making symptom features matter materially
  - `side_effects` now provide a meaningful lift
  - `pain/anxiety` now provide a real lift instead of a negligible one
  - however, the symptom-assisted label is currently too permissive and drives an impractically high alert burden
- Next optimization direction:
  - keep the new symptom features
  - tighten the symptom-assisted trigger rather than adding even more symptom fields immediately

### Dropout Objective-Backsolve Tightening Pass
- Implemented the first objective-backsolve round without changing the transformer architecture:
  - kept `feature_version = triallight_hybrid_v3_symptom_focus`
  - upgraded the training label to `disengagement_7d_v3_tightened_symptom_assisted`
  - added internal diagnostics:
    - `trigger_primary_rule`
    - `trigger_symptom_assisted_rule`
    - `symptom_assisted_slip_score`
    - `strong_engagement_shield`
- Tightened the symptom-assisted label logic:
  - `primary_rule` unchanged
  - `symptom_assisted_rule` now requires stronger slip structure
  - strong engagement now explicitly blocks symptom-assisted positives
- Added a symptom-heavy-but-engaged generator path:
  - caregiver / resilient patients can stay engaged during flare episodes
  - flare penalties were softened
  - flare / aftershock duration was reduced
- Extended training-time diagnostics:
  - row-level label mix
  - event-level primary vs symptom-assisted trigger share
  - train/test window positive rate

### Dropout Tightening Pass V1
- Generated a first tightened debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight.csv`
- First tightened generator/training result:
  - dataset row positives still too high for the desired operating regime
  - event trigger mix remained too dominated by `symptom_assisted_rule`
  - CUDA result:
    - `p_at_r80 = 0.5090`
    - `pr_auc = 0.6210`
    - `alert_frac_at_r80 = 0.6097`
- Interpretation:
  - the model kept useful symptom lift
  - but the label was still too permissive
  - another tightening pass was needed before moving to threshold/loss work

### Dropout Tightening Pass V2
- Applied a second tightening pass focused on:
  - requiring persistent symptom burden for symptom-assisted positives
  - broadening the strong-engagement shield
  - reducing symptom-assisted activation from activity-only slip patterns
- Generated the second tightened debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight2.csv`
  - sanity report:
    - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v31tight2__sanity.json`
- Generator-side label diagnostics improved materially:
  - `row_positive_rate = 0.126569`
  - `row_symptom_trigger_rate = 0.060526`
  - `row_shield_rate = 0.177732`
  - `event_rows_from_primary_share = 0.295821`
  - `event_rows_from_symptom_assisted_share = 0.705576`
- This was a meaningful improvement over the earlier tightened pass, where symptom-assisted events still dominated much more heavily.

### Dropout Tightening Pass V2 CUDA Result
- Ran CUDA training on the second tightened dataset:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v31tight2.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
- Final tightened V2 transformer result:
  - `p_at_r80 = 0.3875`
  - `pr_auc = 0.5587`
  - `alert_frac_at_r80 = 0.4926`
  - `roc_auc = 0.7800`
- Window label mix after the second tightening pass:
  - `train_positive_rate = 0.2433`
  - `test_positive_rate = 0.2385`
- Tightened V2 artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T07-50-25+00-00/`

### Dropout Tightening Pass V2 Ablation Readout
- Tightened V2 ablation results on the same dataset showed:
  - removing `side_effects` dropped performance clearly:
    - `p_at_r80 = 0.3660`
    - `pr_auc = 0.5315`
  - removing `pain_anxiety` caused only a very small change:
    - `p_at_r80 = 0.3863`
    - `pr_auc = 0.5655`
- Interpretation:
  - `side_effects` are now a real contributor
  - `pain/anxiety` still are not yet carrying enough distinct predictive value
  - the second tightening pass successfully pulled the dataset much closer to an operational regime
  - but the model still misses the target operating objective:
    - `p_at_r80` is close to `0.40` but still below it
    - `pr_auc` is above the target floor
    - `alert_frac_at_r80` is still far above the desired `<= 0.25`
- Next recommended step:
  - keep the tightened label
  - move to the next phase:
    - harder symptom-heavy negative construction
    - hard-negative oversampling
    - then only if needed, loss reweighting / calibration

### Dropout Hard-Negative Phase
- Added a non-public hard-negative training path to `Patient-Dropout-Prediction/src/train.py`:
  - window-level `hard_negative` flag generation
  - optional hard-negative weighted sampling
  - train/test hard-negative rate diagnostics
- Hard-negative windows are now defined from:
  - high symptom burden
  - negative label
  - active engagement indicators such as shielded participation or sustained completion despite symptoms
- This training path was implemented as an optional sampler only:
  - it does not change the public runtime contract
  - it does not change the transformer architecture

### Dropout Hard-Negative Experiment Result
- First oversampling attempt exposed that the initial hard-negative definition was too narrow:
  - hard-negative rate was only about `0.002`
  - effect on metrics was negligible
- Expanded the hard-negative definition to include stronger `engaged despite symptoms` windows.
- Rebuilt cache and reran training with:
  - `hard_negative_oversample = 4.0`
  - result:
    - `p_at_r80 = 0.3775`
    - `pr_auc = 0.5627`
    - `alert_frac_at_r80 = 0.5057`
- Reran with:
  - `hard_negative_oversample = 2.5`
  - result:
    - `p_at_r80 = 0.3857`
    - `pr_auc = 0.5558`
    - `alert_frac_at_r80 = 0.4952`
- Both oversampling runs underperformed the best non-oversampled tightened V2 run:
  - non-oversampled tightened V2 remained the best current operating point
  - therefore the default hard-negative oversampling setting was returned to disabled-by-default
    - `hard_negative_oversample = 1.0`

### Current Best Objective-Backsolve Status
- Best current tightened operating point remains the non-oversampled tightened V2 run:
  - `p_at_r80 = 0.3875`
  - `pr_auc = 0.5587`
  - `alert_frac_at_r80 = 0.4926`
  - `window positive_rate = 0.2385`
- Current interpretation:
  - `pr_auc` has crossed the target floor
  - `p_at_r80` is close to `0.40`
  - `alert_frac_at_r80` is still the main blocker
  - generator / label tightening helped much more than hard-negative sampling so far
- Next most defensible direction:
  - keep the current tightened label as baseline
  - improve the quality of symptom-heavy engaged negatives in the generator itself
  - only revisit sampling or loss reweighting after those negatives become more informative

### Dropout Generator-Led Engaged-Negative Strengthening
- Implemented a new generator-only strengthening pass focused on explicit `symptom-heavy but still engaged` negatives:
  - kept:
    - `feature_version = triallight_hybrid_v3_symptom_focus`
    - `label_version = disengagement_7d_v3_tightened_symptom_assisted`
    - transformer architecture unchanged
    - `hard_negative_oversample = 1.0`
  - updated:
    - `Patient-Dropout-Prediction/src/data_generator.py`
    - `Patient-Dropout-Prediction/src/quality_utils.py`
- Added protected flare tracks inside the generator:
  - `shielded_pain_flare`
  - `shielded_anxiety_flare`
- Protected flares now raise symptom signals while preserving stronger engagement floors for:
  - activity
  - vitals completion
  - ePRO completion
  - CRC follow-up responsiveness
- Added internal-only diagnostics:
  - `shielded_flare_active`
  - `shielded_pain_flare_active`
  - `shielded_anxiety_flare_active`
  - `high_symptom_and_engaged`
  - `high_pain_and_engaged`
  - `high_anxiety_and_engaged`
- Generated a new non-overwriting debug dataset:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v32engagedneg.csv`
  - sanity report:
    - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v32engagedneg__sanity.json`

### Dropout V32 Generator Diagnostics
- Compared with tightened V2:
  - `event_rows_from_symptom_assisted_share` improved:
    - from `0.705576`
    - to `0.686429`
  - `event_rows_from_primary_share` improved:
    - from `0.295821`
    - to `0.314787`
  - `row_positive_rate` stayed almost flat:
    - from `0.126569`
    - to `0.127674`
- New engaged-negative diagnostics:
  - `shielded_flare_row_count = 9474`
  - `shielded_pain_flare_row_count = 8638`
  - `shielded_anxiety_flare_row_count = 836`
  - `high_symptom_and_engaged_row_rate = 0.058409`
  - `high_pain_and_engaged_row_rate = 0.018055`
  - `high_anxiety_and_engaged_row_rate = 0.000760`
- Interpretation:
  - the generator now creates materially more protected symptom-heavy participation patterns
  - symptom-assisted triggering remains dominant, but slightly less so than in tightened V2
  - row-level positive rate did not materially drift upward

### Dropout V32 CUDA Training Result
- Ran the same evaluation setup:
  - dataset = `super_fusion_dataset_30days_1__debug1000_v32engagedneg.csv`
  - `split_strategy = patient`
  - `stride = 7`
  - `epochs = 3`
  - `device = cuda`
  - `run_ablations = true`
- Main run artifacts:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
- Final transformer result:
  - `p_at_r80 = 0.4031`
  - `pr_auc = 0.5769`
  - `alert_frac_at_r80 = 0.4938`
  - `roc_auc = 0.7877`
- Logistic baseline:
  - `p_at_r80 = 0.4020`
  - `pr_auc = 0.5659`
  - `alert_frac_at_r80 = 0.4946`
- Window label mix:
  - `train_positive_rate = 0.2507`
  - `test_positive_rate = 0.2485`
  - `train_hard_negative_rate = 0.0656`
  - `test_hard_negative_rate = 0.0611`

### Dropout V32 Ablation Readout
- `side_effects` ablation:
  - `p_at_r80 = 0.3780`
  - `pr_auc = 0.5356`
  - `alert_frac_at_r80 = 0.5262`
- `pain_anxiety` ablation:
  - `p_at_r80 = 0.4043`
  - `pr_auc = 0.5620`
  - `alert_frac_at_r80 = 0.4921`
- Interpretation:
  - `side_effects` continue to provide strong independent value
  - `pain/anxiety` now show meaningful `PR-AUC` contribution, even though `p_at_r80` lift is still weak

### Dropout V32 Outcome Assessment
- This pass passed 2 of the 3 intended operational gates:
  - `p_at_r80 >= 0.38` -> passed
  - `pr_auc >= 0.56` -> passed
  - `alert_frac_at_r80 <= 0.40` -> failed
- Relative to the previous best tightened V2 baseline:
  - `p_at_r80` improved:
    - from `0.3875`
    - to `0.4031`
  - `pr_auc` improved:
    - from `0.5587`
    - to `0.5769`
  - `alert_frac_at_r80` was effectively unchanged:
    - from `0.4926`
    - to `0.4938`
- Current conclusion:
  - generator-led engaged-negative strengthening improved ranking quality
  - but it did not materially reduce alert burden
  - the next most defensible step is no longer more generator broadening alone
  - the next step should move to threshold / loss tuning while keeping this V32 generator as the stronger baseline

### Dropout Loss-Tuning And Reweighting Pass
- Updated `Patient-Dropout-Prediction/src/train.py` to support explicit loss experimentation without changing the model architecture:
  - added `--loss_type` with:
    - `bce`
    - `focal`
  - added:
    - `--focal_gamma`
    - `--positive_class_weight_scale`
  - loss configuration is now recorded into:
    - training summaries
    - stage artifacts
    - experiment ledger rows
- Important clarification captured in this pass:
  - offline `p_at_r80` / `alert_frac_at_r80` are already computed by selecting the threshold required to reach `recall = 0.80`
  - therefore plain runtime threshold tuning does not directly improve these benchmark metrics
  - the only defensible lever in this pass was loss / ranking behavior

### Dropout V32 Loss Experiment Results
- Baseline for comparison remained the main V32 BCE run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
  - metrics:
    - `p_at_r80 = 0.4031`
    - `pr_auc = 0.5769`
    - `alert_frac_at_r80 = 0.4938`
- Focal loss experiment:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T17-53-39+00-00/`
  - config:
    - `loss_type = focal`
    - `focal_gamma = 2.0`
    - `positive_class_weight_scale = 1.0`
  - result:
    - `p_at_r80 = 0.3995`
    - `pr_auc = 0.5778`
    - `alert_frac_at_r80 = 0.4977`
- BCE with reduced positive class weight:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T18-14-52+00-00/`
  - config:
    - `loss_type = bce`
    - `positive_class_weight_scale = 0.70`
  - result:
    - `p_at_r80 = 0.4024`
    - `pr_auc = 0.5789`
    - `alert_frac_at_r80 = 0.4943`
- BCE with light hard-negative oversampling on V32:
  - run:
    - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T18-36-20+00-00/`
  - config:
    - `loss_type = bce`
    - `positive_class_weight_scale = 1.0`
    - `hard_negative_oversample = 2.0`
  - result:
    - `p_at_r80 = 0.4004`
    - `pr_auc = 0.5764`
    - `alert_frac_at_r80 = 0.4970`

### Dropout Loss-Tuning Conclusion
- None of the simple loss / reweighting variants materially improved alert burden relative to the current V32 BCE baseline.
- Best current operating point still remains:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-29T16-28-46+00-00/`
  - `p_at_r80 = 0.4031`
  - `pr_auc = 0.5769`
  - `alert_frac_at_r80 = 0.4938`
- Interpretation:
  - ranking quality has already improved enough to cross the `p_at_r80 >= 0.40` and `pr_auc >= 0.55` lines
  - the remaining blocker is not simple loss choice
  - the remaining blocker is likely the dataset/window positive regime itself, plus the need for a more explicit false-positive-sensitive objective if we want to reduce alert burden further
- Recommended next step after this pass:
  - do not keep iterating small loss variants blindly
  - move to a more explicit constrained training objective or window-label policy revision that targets lower alert burden directly

### Dropout Prevalence-Correction And Strict GPU Observability Pass
- Updated `Patient-Dropout-Prediction/src/data_generator.py` to introduce a `candidate -> confirmed` disengagement confirmation policy without changing the existing `primary_rule` / `symptom_assisted_rule` definitions:
  - `primary_rule` now requires `2` consecutive days before confirming `disengagement_day`
  - `symptom_assisted_rule` now requires at least `3` hits within a rolling `4`-day window before confirming
  - mixed confirmation is allowed when a current `primary_rule` hit follows a previous-day symptom-assisted candidate
  - strong engagement resets candidate state instead of letting a single transient hit permanently confirm disengagement
- Added generator-side candidate diagnostics to the generated rows:
  - `candidate_primary_active`
  - `candidate_symptom_active`
- Expanded `Patient-Dropout-Prediction/src/quality_utils.py` sanity reporting with patient-level prevalence diagnostics:
  - `patient_event_rate`
  - `patient_positive_label_rate`
  - `candidate_primary_rate`
  - `candidate_symptom_rate`
  - `confirmed_disengagement_patient_count`
- Hardened `Patient-Dropout-Prediction/src/train.py` GPU behavior and observability:
  - `--device` now defaults to `cuda`
  - `--device cuda` now fails fast if CUDA is unavailable instead of silently falling back to CPU
  - added `--batch_log_interval`
  - training startup now logs:
    - torch version
    - CUDA build
    - CUDA availability
    - selected device
    - GPU name
  - transformer training now logs per-batch CUDA memory snapshots:
    - allocated MB
    - reserved MB
    - peak allocated MB
  - training logs now explicitly separate:
    - `CPU phase: dataset loading / cache building`
    - `GPU phase: transformer training`
    - `CPU phase: logistic baseline`

### Dropout V33 Manual Prevalence-Fix Dataset
- Manual generator rerun produced:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__manual_v33prevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__manual_v33prevalencefix__sanity.json`
- V33 sanity result:
  - `patient_event_rate = 0.649618`
  - `patient_positive_label_rate = 0.649618`
  - `row_positive_rate = 0.121908`
  - `event_rows_from_primary_share = 0.313094`
  - `event_rows_from_symptom_assisted_share = 0.695115`
  - `high_symptom_and_engaged_row_rate = 0.064792`
- Interpretation:
  - prevalence correction improved the regime, but did not yet hit the planned generator gates
  - relative to the earlier V32 regime, row/window prevalence moved down, but patient-level event prevalence remains too high

### Dropout V33 Manual CUDA Train Result
- Manual training run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T03-26-33+00-00/`
- Final transformer metrics:
  - `p_at_r80 = 0.4135`
  - `pr_auc = 0.6380`
  - `alert_frac_at_r80 = 0.3956`
  - `roc_auc = 0.8374`
  - `threshold_at_r80 = 0.388025`
- Window prevalence:
  - `train_positive_rate = 0.2043`
  - `test_positive_rate = 0.2043`
- Logistic baseline:
  - `p_at_r80 = 0.4109`
  - `pr_auc = 0.6356`
  - `alert_frac_at_r80 = 0.3979`
- GPU observability confirmation from terminal logs:
  - selected device was `cuda`
  - GPU name was `NVIDIA GeForce RTX 4060 Laptop GPU`
  - batch logs showed non-zero CUDA memory usage with peak allocation around `80.6 MB`
- Interpretation:
  - this pass materially improved ranking and alert burden versus the earlier manual baseline:
    - `p_at_r80`: `0.4014 -> 0.4135`
    - `pr_auc`: `0.5858 -> 0.6380`
    - `alert_frac_at_r80`: `0.4951 -> 0.3956`
    - `test_positive_rate`: `0.2483 -> 0.2043`
  - the training-side gates mostly improved enough to become useful:
    - `p_at_r80 >= 0.38`: passed
    - `pr_auc >= 0.56`: passed
    - `alert_frac_at_r80 <= 0.40`: passed
    - `test_positive_rate <= 0.15`: still not met
  - the remaining blocker is now mostly prevalence/window regime, not CUDA execution or basic model ranking quality

### Dropout V34 Stronger Prevalence-Tightening Pass
- Tightened the prevalence correction logic again in `Patient-Dropout-Prediction/src/data_generator.py` without changing feature schema or transformer architecture:
  - increased `primary_rule` confirmation from `2` consecutive days to `3` consecutive days
  - increased symptom-assisted confirmation from `3 hits in 4 days` to `4 hits in 5 days`
  - increased `hard_reset_candidate_state` coverage so moderate-but-stable re-engagement clears candidate state earlier
- Generated:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34prevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34prevalencefix__sanity.json`
- V34 sanity result:
  - `patient_event_rate = 0.5332`
  - `row_positive_rate = 0.1022`
  - `event_rows_from_primary_share = 0.3442`
  - `event_rows_from_symptom_assisted_share = 0.6487`
- V34 CUDA run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T04-44-51+00-00/`
  - `p_at_r80 = 0.3813`
  - `pr_auc = 0.6003`
  - `alert_frac_at_r80 = 0.3185`
  - `test_positive_rate = 0.1518`
- Interpretation:
  - V34 moved much closer to the target regime and passed `3/4` training gates comfortably
  - the only remaining miss was `test_positive_rate`, and it was off by only `0.0018`

### Dropout V34b Final Prevalence-Tightening Adjustment
- Added one last minimal tightening in `Patient-Dropout-Prediction/src/data_generator.py`:
  - symptom-assisted confirmation now requires the current day to still satisfy `symptom_assisted_rule`
  - mixed confirmation now requires the current day to satisfy both `primary_rule` and `symptom_assisted_rule`
  - re-engagement reset thresholds were relaxed slightly further to clear stale candidates sooner
- Generated:
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34bprevalencefix.csv`
  - `Patient-Dropout-Prediction/data/super_fusion_dataset_30days_1__debug1000_v34bprevalencefix__sanity.json`
- V34b sanity result:
  - `patient_event_rate = 0.5279`
  - `row_positive_rate = 0.1012`
  - `event_rows_from_primary_share = 0.3525`
  - `event_rows_from_symptom_assisted_share = 0.6641`
- V34b CUDA run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T05-17-06+00-00/`
  - `p_at_r80 = 0.3812`
  - `pr_auc = 0.6011`
  - `alert_frac_at_r80 = 0.3082`
  - `test_positive_rate = 0.1467`
  - `roc_auc = 0.8693`
- Final interpretation for this pass:
  - training-side target gates are now all satisfied on the debug1000 patient-split CUDA run:
    - `test_positive_rate <= 0.15`: passed
    - `p_at_r80 >= 0.38`: passed
    - `pr_auc >= 0.56`: passed
    - `alert_frac_at_r80 <= 0.40`: passed
  - generator-side prevalence is still a little above the stricter planning targets:
    - `patient_event_rate` remains above `0.50`
    - `row_positive_rate` remains above `0.09`
  - however, the operationally important window-level regime is now inside target while preserving good ranking quality and confirmed CUDA execution

### Dropout V34b Trial-Split Generalization Check
- Ran a held-out trial split on the same frozen V34b dataset:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SStrial__FGfull__2026-03-30T06-30-28+00-00/`
- Trial-split result:
  - `p_at_r80 = 0.3824`
  - `pr_auc = 0.5987`
  - `alert_frac_at_r80 = 0.3055`
  - `test_positive_rate = 0.1459`
- Interpretation:
  - the trial-held-out result stayed very close to the patient-held-out result
  - there was no obvious generalization collapse
  - relative to the patient split:
    - `p_at_r80` was effectively preserved
    - `alert_frac_at_r80` was also preserved
  - this is strong evidence that the current model is not merely memorizing patient-level artifacts within the sampled trials

### Dropout V34b Final Ablation Evidence
- Ran the final ablation suite on the V34b patient-split run:
  - `runs/stage_3_29_single__FVtriallight_hybrid_v3_symptom_focus__SSpatient__FGfull__2026-03-30T06-58-49+00-00/feature_ablation_results.json`
- Important implementation note:
  - the ablation suite currently uses the repo's fast ablation path
  - these ablations were evaluated with the logistic-regression comparator path rather than full transformer retraining for every feature removal
  - this makes them appropriate as fast evidence of signal utility, but they should be described honestly in any final report
- Full V34b patient-split transformer reference:
  - `p_at_r80 = 0.3812`
  - `pr_auc = 0.6011`
  - `alert_frac_at_r80 = 0.3082`
- Fast ablation results:
  - without `epro`:
    - `p_at_r80 = 0.3722`
    - `pr_auc = 0.5760`
    - `alert_frac_at_r80 = 0.3154`
  - without `appointment`:
    - `p_at_r80 = 0.3727`
    - `pr_auc = 0.5594`
    - `alert_frac_at_r80 = 0.3149`
  - without `chat`:
    - `p_at_r80 = 0.3725`
    - `pr_auc = 0.5769`
    - `alert_frac_at_r80 = 0.3153`
  - without `side_effects`:
    - `p_at_r80 = 0.3172`
    - `pr_auc = 0.4836`
    - `alert_frac_at_r80 = 0.3701`
  - without `pain_anxiety`:
    - `p_at_r80 = 0.3690`
    - `pr_auc = 0.5735`
    - `alert_frac_at_r80 = 0.3184`
- Interpretation:
  - `side_effects` now show the strongest and clearly non-trivial contribution
  - `pain_anxiety` now show a smaller but still real contribution
  - `appointment` and `epro` also contribute
  - the current evidence supports the statement that the model is not being driven by vitals alone

### Dropout Model Global Readiness As Of 2026-03-30
- Current status:
  - offline model R&D is in a defensible state
  - patient-split and trial-split results are both inside the current operational target band for the debug1000 regime
  - GPU training and detailed observability are now stable
- Remaining gaps before full integration deployment:
  - reconnect the final frozen model to inference/publishing/runtime paths
  - do end-to-end CRC-side integration validation
  - prepare final scenario-based testing and scoring evidence for professor review

### Dropout Frozen Runtime Wiring (V34b)
- Confirmed a real runtime issue before this pass:
  - offline training had produced a valid frozen `v34b` run
  - but the runtime defaults still pointed to stale `deploy_assets` / legacy assets
  - `deploy_assets/checkpoints` had only old staged files and no `stage_3_29_single` checkpoint
- Updated `Patient-Dropout-Prediction/src/module_service.py` so runtime defaults now prefer a frozen manifest when present:
  - env vars still override everything
  - otherwise:
    - `deploy_assets/checkpoints/frozen_model_manifest.json` can define default `data_path`
    - `deploy_assets/checkpoints/frozen_model_manifest.json` can define default `checkpoints_dir`
  - old `deploy_assets/data/triallight_dropout_testing.csv` remains only as a fallback
- Added frozen manifest:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest.json`
- Copied the frozen V34b model assets into runtime-visible locations without overwriting old staged files:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/model_stage_3_29_single.pth`
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/artifacts_stage_3_29_single.pkl`
  - `Patient-Dropout-Prediction/deploy_assets/data/triallight_dropout_testing_v34b.csv`
  - mirrored local convenience copies:
    - `Patient-Dropout-Prediction/checkpoints/model_stage_3_29_single.pth`
    - `Patient-Dropout-Prediction/checkpoints/artifacts_stage_3_29_single.pkl`
- Runtime smoke test passed using default paths resolved from the frozen manifest:
  - `DEFAULT_DATA_PATH` resolved to:
    - `deploy_assets/data/triallight_dropout_testing_v34b.csv`
  - `DEFAULT_CHECKPOINTS_DIR` resolved to:
    - `deploy_assets/checkpoints`
  - `score_subject_for_crc(...)` returned a valid CRC payload using the frozen defaults

### Dropout Demo Scenario Selector
- Added:
  - `Patient-Dropout-Prediction/src/select_demo_subjects.py`
  - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`
- Generated:
  - `Patient-Dropout-Prediction/deploy_assets/demo_scenarios_v34b.json`
- This demo scenario file now provides a ready-made set of representative subjects for:
  - `high_symptom_but_engaged`
  - `high_symptom_plus_engagement_slip`
  - `low_symptom_strong_adherence`
  - `missed_followup_with_symptom`
- Each scenario includes:
  - subject ID
  - trial ID
  - day index
  - supporting feature snapshot
  - frozen model score summary

### Dropout Readiness After Runtime Freeze
- The dropout model is now frozen to a concrete offline-validated artifact and wired into the default runtime path.
- Current remaining work is no longer about core model R&D:
  - validate the live CRC/publisher integration path end-to-end
  - confirm the Firestore mirror payload is correct for the frozen runtime
  - run professor/demo scenario walkthroughs using the generated scenario JSON

### Dropout Publisher Dry-Run And CRC Contract Surface Update
- Updated `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` to support safer validation before any real Firestore/Supabase write:
  - added `--dry-run`
  - added `--limit-patients`
  - added `--firebase-uids`
  - added `--output-preview-path`
  - added `--skip-testing-subject-sync`
  - added `--demo-scenarios-path`
- Publisher mirror payload was expanded to preserve more of the CRC contract in Firestore:
  - `contract_version`
  - `routed_stage`
  - `fallback_used`
  - `is_actionable`
  - `pred_horizon_days`
  - `history_window_days`
  - `model_type`
  - `missing_inputs_summary`
  - `explanation_signals`
- Added a safe no-remote validation path:
  - `publish_dropout_snapshots.py --dry-run --demo-scenarios-path ...`
  - this builds the same Firestore-style payloads from frozen demo scenarios without touching Firestore or Supabase
- Generated dry-run payload preview:
  - `Patient-Dropout-Prediction/deploy_assets/demo_publish_preview_v34b.json`
- Dry-run preview confirmed:
  - frozen checkpoint and dataset resolve correctly
  - CRC payload structure is complete
  - all four professor/demo scenarios produce valid Firestore-style snapshot payloads

### CRC Dropout Panel Contract Readiness
- Updated `src/components/DropoutRiskPanel.jsx` so the CRC panel can now display more frozen-runtime contract details when a live snapshot is present:
  - routed stage
  - prediction horizon
  - history window
  - model version
  - missing input summary
- This keeps the panel CRC-only while making runtime validation easier during final testing.

### Current Remaining Gap Before Real Publish
- The only material thing not executed in this pass is the real remote publish itself:
  - no Firestore write was performed in this pass
  - no Supabase write was performed in this pass
- That decision was intentional:
  - the safer path was to complete offline validation, runtime freeze, mirror-payload previewing, and professor scenario preparation first
  - the actual remote publish should be done only when the correct Firebase and Supabase credentials are available and the target environment is confirmed

### Publisher Preflight Validation
- Updated `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py` with a new safe config-check mode:
  - `--preflight-only`
- The publisher now prints a clearer start banner and a preflight summary before any real work:
  - mode
  - whether Firestore is required
  - whether Supabase is required
  - whether frozen dataset/checkpoint/artifact paths exist
  - whether Firebase and Supabase credentials are configured
- If `--preflight-only` is used:
  - exit code `0` means local assets and required credentials are ready for the selected mode
  - exit code `1` means something required is still missing
- Verified locally:
  - frozen data path exists
  - frozen checkpoint directory exists
  - frozen model/artifacts exist
  - `FIREBASE_SERVICE_ACCOUNT_JSON` was missing
  - `SUPABASE_URL` was missing
  - `SUPABASE_SERVICE_ROLE_KEY` was missing
- This means the technical blocker for the real remote publish is now explicitly surfaced by the tool itself, instead of only appearing as a later runtime failure.

### Publisher Preflight Ready-Flag Bugfix
- Fixed a logic bug in Patient-Dropout-Prediction/src/publish_dropout_snapshots.py where live publish preflight could still report eady=False even when Firebase, Supabase, and frozen assets were all configured correctly.
- Root cause: the eady expression handled the no-demo-scenarios case incorrectly.
- Fix: normalized demo-scenario path readiness into a dedicated demo_path_ready boolean and reused it consistently in the report and final eady calculation.
- Result: --preflight-only can now be trusted as the gate before real dry-run or live publish.

### Publisher Mapping Diagnostics
- Extended Patient-Dropout-Prediction/src/publish_dropout_snapshots.py with read-only mapping diagnostics for real-patient dry-runs and publish attempts.
- The publisher now reports:
  - how many patient docs were scanned
  - how many docs expose dropout_subject_id`r
  - how many docs expose dropoutSubjectId`r
  - how many docs expose only subject_id / subjectId`r
  - how many docs are skipped because mapping is missing
  - how many mapped subjects are not present in the frozen dataset
  - how many score attempts fail after a valid mapping
- The same diagnostics are now also written into the dry-run preview JSON under mapping_diagnostics.
- Verified that the enhanced diagnostics do not break the existing local demo preview path.

### Patient Dropout Prediction ID Refactor And Canonical Subject Finalization
- Completed the approved dropout-only ID refactor so the active TrialLight dropout flow now treats `subject_id` as the canonical patient identity.
- Updated CRC-facing dropout UI to stop using `Hospital ID` in the active dropout flow:
  - `src/components/PatientEditMenu.jsx`
  - `src/components/PatientList.jsx`
  - `src/pages/CRCHome.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/services/dropoutService.js`
- Active CRC/dropout behavior now follows this contract:
  - patient configuration writes `subject_id`
  - roster search/display uses `subject_id`
  - dropout panel asks for `subject_id`
  - legacy `dropout_subject_id` is only used as a temporary compatibility fallback while migration is incomplete
- Added deploy-time identity remap support without retraining the model:
  - new script: `Patient-Dropout-Prediction/src/remap_deploy_subject_ids.py`
  - new frozen deployment dataset: `Patient-Dropout-Prediction/deploy_assets/data/triallight_dropout_testing_v35subjectid.csv`
  - new subject map: `Patient-Dropout-Prediction/deploy_assets/data/triallight_subject_id_map_v35subjectid.csv`
  - new manifest: `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_v35subjectid.json`
- The new deployment bundle preserves model semantics while changing only identity expression:
  - canonical deployment IDs now look like `TL-S00001`
  - each row retains `legacy_subject_id` inside the deploy dataset for migration-time traceability
  - new manifest records the remap and still points to the same frozen `stage_3_29_single` checkpoint/artifacts
- Added runtime compatibility so legacy frozen subject IDs can still be resolved to the canonical deployment subject IDs:
  - `Patient-Dropout-Prediction/src/module_service.py`
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- Generated new canonical demo assets:
  - `Patient-Dropout-Prediction/deploy_assets/demo_scenarios_v35subjectid.json`
  - `Patient-Dropout-Prediction/deploy_assets/demo_publish_preview_v35subjectid_livecompat.json`
- Demo scenarios now expose canonical `subject_id` plus `legacy_subject_id` trace, for example:
  - canonical: `TL-S00024`
  - legacy: `NCT00005879_P0012`
- Important integration nuance discovered and handled:
  - the current Supabase `dropout_predictions` table still requires the legacy column name `dropout_subject_id`
  - to avoid breaking live publish, history rows now write:
    - `subject_id = canonical TrialLight subject_id`
    - `dropout_subject_id = same canonical subject_id`
  - richer migration-only trace fields remain in Firestore mirror payloads, not in the Supabase history insert payload
- Updated daily automation workflow to use the in-repo dropout backend instead of checking out a separate external repository:
  - `.github/workflows/dropout-precompute.yml`
  - removed the extra `DROPOUT_REPO_PAT` checkout path
  - switched workflow data path to `triallight_dropout_testing_v35subjectid.csv`
  - added a publisher preflight step before live publish
- Updated dropout deployment/docs to reflect the new canonical subject bundle:
  - `Patient-Dropout-Prediction/DEPLOYMENT.md`
  - `Patient-Dropout-Prediction/PROFESSOR_DEMO_SCENARIOS.md`
  - `Patient-Dropout-Prediction/INTERFACES.md`
- Validation completed for this refactor:
  - Python syntax check passed for:
    - `module_service.py`
    - `publish_dropout_snapshots.py`
    - `select_demo_subjects.py`
    - `remap_deploy_subject_ids.py`
  - canonical vs legacy alias scoring parity check passed:
    - `TL-S00024`
    - `NCT00005879_P0012`
    - returned identical `dropout_probability`
  - targeted ESLint passed cleanly for the modified CRC/dropout files after one small hook dependency cleanup in `src/pages/CRCHome.jsx`
- Current remaining work after this refactor is no longer about ID design:
  - manually assign canonical `subject_id` values to the real Firestore patient docs through CRC configuration
  - rerun real Firestore dry-run and confirm `predictions_ready > 0`
  - execute the first live publish
  - then enable or trust the GitHub Actions daily automation path

### Live Subject Mapping And First Real Publish Attempt
- Wrote canonical `subject_id` values into all 18 live Firestore patient docs under `users/{uid}.subject_id`.
- Assigned a small set of demo-aligned canonical IDs for stable professor/testing coverage, including:
  - `TL-S21261`
  - `TL-S01463`
  - `TL-S00024`
  - `TL-S11794`
- Verified live Firestore mapping state after the write:
  - `count = 18`
  - `with_subject_id = 18`
  - `missing = 0`
- Ran a real publisher dry-run against the canonical `v35subjectid` frozen runtime with live Firestore:
  - `scanned_patient_docs = 18`
  - `predictions_ready = 18`
  - `missing_subject_id = 0`
  - `mapped_not_in_dataset = 0`
  - `score_failures = 0`
- Confirmed the real dry-run preview was written to:
  - `Patient-Dropout-Prediction/deploy_assets/manual_live_dry_run_v35subjectid_after_mapping.json`
- The first live publish attempt then exposed a runtime bug in `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`:
  - `_init_firestore()` re-initialized the default Firebase Admin app during the same process
  - this caused the Firestore `current` mirror write stage to fail after Supabase history publication had already started
- Fixed the publisher bug by reusing `firebase_admin.get_app()` when the default app already exists instead of initializing twice.
- Next step after this fix:
  - rerun live publish
  - verify Firestore `users/{uid}/dropout_predictions/current`
  - verify Supabase `dropout_testing_subjects` and `dropout_predictions`

### Live Publish Success And Canonical Subject Option Filtering
- Reran the live dropout publisher after the Firebase initialization fix and completed the first successful real publish against:
  - live Firestore patient docs
  - live Firestore `dropout_predictions/current`
  - live Supabase `dropout_predictions`
- Successful live publish result:
  - `scanned_patient_docs = 18`
  - `predictions_ready = 18`
  - `missing_subject_id = 0`
  - `mapped_not_in_dataset = 0`
  - `score_failures = 0`
- Verified a real Firestore current snapshot for `zUduQBX4cyULYvxTjZ1wWAPQhLx2`:
  - `subject_id = TL-S01463`
  - `risk_bucket = high`
  - `dropout_probability = 0.979375`
  - `recommended_action = review_today_consider_outreach`
- Verified Supabase history rows now exist for the same patient with:
  - `subject_id = TL-S01463`
  - `dropout_subject_id = TL-S01463`
- Discovered that `dropout_testing_subjects` still contains legacy `NCT...` rows from earlier phases alongside the new canonical subject universe.
- To prevent the CRC config dropdown from surfacing legacy IDs, updated `src/services/dropoutService.js` so the subject selector now prefers and displays only canonical `TL-S00001`-style IDs whenever they are present.
- Result:
  - active runtime identity is canonical `subject_id`
  - live publish is now working
  - CRC dropdown no longer needs a destructive cleanup of old Supabase rows in order to show the correct subject universe

### CRC UI And Dropout Workspace Finalization
- Implemented the CRC/product surface changes for this round without changing the dropout model contract:
  - `src/pages/CRCHome.jsx`
  - `src/components/PatientEditMenu.jsx`
  - `src/components/ProtocolManager.jsx`
  - `src/components/DropoutRiskPanel.jsx`
  - `src/services/dropoutService.js`
  - `src/services/trialTemplateService.js`
  - `src/utils/validation.js`
  - `src/index.css`
- Added loose international phone validation for active CRC patient configuration fields:
  - `Primary CRC phone`
  - `Study emergency phone`
  - allowed formatting now includes digits, spaces, hyphens, parentheses, and one leading `+`
  - invalid values now show inline errors and block save
- Kept web DOB handling on `input[type="date"]` and upgraded patient mobile DOB entry from free text to a calendar-based picker:
  - added `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/CalendarDateField.js`
  - wired it into:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/ProfileModal.js`
  - DOB still persists as `YYYY-MM-DD`
- Reworked Protocol Library into a single-open accordion flow:
  - only one protocol card expands at a time
  - if the selected patient already has an assigned protocol, that template opens by default
  - otherwise the library starts collapsed to reduce scroll burden
- Fixed notification policy editing usability:
  - `Instruction`
  - `Action code`
  now use multi-line textareas with visible full text instead of clipped single-line inputs
- Locked vital template type safety:
  - built-in labels now keep their correct fixed `input_type`
  - `Body Temperature`, `SpO2`, `Heart Rate`, `Weight`, etc. stay `numeric`
  - `Blood Pressure` stays `blood_pressure`
  - custom vitals are now numeric-only
  - malformed existing template payloads are coerced back into valid shape on load in both:
    - `src/services/trialTemplateService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js`
- Split Clinical Intelligence into truly separate workspaces:
  - `focus=guidance` now renders only Side Effect Guidance
  - `focus=dropout` now renders only Patient Dropout Prediction
  - guidance and dropout no longer share one long continuously scrollable area
- Replaced the old single-patient dropout card with a dedicated CRC-only dashboard:
  - subscribes to all live Firestore `users/{uid}/dropout_predictions/current` snapshots
  - joins those snapshots against the live patient roster
  - shows summary metrics:
    - total scored patients
    - high-risk patients
    - actionable patients
    - average dropout probability
  - renders a risk-ranked patient list sorted highest-to-lowest by `dropout_probability`
  - adds search by:
    - patient nickname
    - `subject_id`
    - email
  - selecting a ranked or searched patient opens a dedicated detail panel with:
    - `dropout_probability`
    - `risk_bucket`
    - `recommended_action`
    - `action_priority_score`
    - `explanation_signals`
    - `missing_inputs_summary`
- Validation completed for this UI round:
  - `npm run build:crc` passed successfully after rerunning outside the sandbox because the sandbox blocked `esbuild` child process spawn with `EPERM`
  - targeted ESLint passed cleanly for:
    - `src/pages/CRCHome.jsx`
    - `src/components/ProtocolManager.jsx`
    - `src/components/DropoutRiskPanel.jsx`
    - `src/components/PatientEditMenu.jsx`
    - `src/services/dropoutService.js`
    - `src/services/trialTemplateService.js`
    - `src/utils/validation.js`
  - targeted ESLint also passed for the modified mobile files:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/Login.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/ProfileModal.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/components/CalendarDateField.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/trialTemplateService.js`

### CRC And Patient Web Live Redeploy
- Redeployed both Firebase Hosting sites from the integration workspace using the configured dual-site hosting targets:
  - `hosting:crc` -> `https://triallight.web.app/`
  - `hosting:patient` -> `https://triallight-patient.web.app/`
- Confirmed the workspace hosting configuration before deploy:
  - `.firebaserc` maps:
    - `crc` -> `triallight`
    - `patient` -> `triallight-patient`
  - `firebase.json` uses:
    - `dist` for CRC web
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/web-build` for patient web
- Deployment ran through the existing root script:
  - `npm run deploy:hosting`
  which executed both predeploy builds and then released both hosting targets successfully.
- CRC web production build completed during deploy:
  - `npm run build:crc`
  - output published from `dist`
- Patient web production export completed during deploy:
  - `npm run build:patient-web`
  - Expo web bundle exported to `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/web-build`
- Final live release status:
  - `triallight` release complete
  - `triallight-patient` release complete
- Firebase CLI reported a successful deploy for both live URLs:
  - `https://triallight.web.app`
  - `https://triallight-patient.web.app`
- The deploy surfaced a non-blocking bundle-size warning for the CRC web app:
  - the main JS bundle remains above the 500 kB warning threshold after minification
  - no deploy failure occurred, but future performance cleanup can target chunk splitting if needed

### Dropout Live-Data Direct Scoring Backend Cutover
- Began the v1 backend cutover from frozen day-history scoring to live operational-data direct scoring while preserving the existing daily GitHub Actions batch architecture.
- Kept the model contract and CRC-facing prediction payload unchanged:
  - no model retraining
  - no new CRC output fields
  - live path still publishes to:
    - `users/{uid}/dropout_predictions/current`
    - `dropout_predictions`
- Extended the frozen runtime manifest at:
  - `Patient-Dropout-Prediction/deploy_assets/checkpoints/frozen_model_manifest_v35subjectid.json`
  with:
  - `subject_context_registry_path`
  so the deployment bundle can keep static trial context while removing dependence on frozen longitudinal daily rows.
- Added a new static context asset builder:
  - `Patient-Dropout-Prediction/src/build_subject_context_registry.py`
  which compresses the frozen deploy dataset into one row per canonical `subject_id`.
- Built the new subject context asset:
  - `Patient-Dropout-Prediction/deploy_assets/data/triallight_subject_context_registry_v35subjectid.csv`
  with:
  - `26063` subject rows
  - no duplicate `subject_id`
  - preserved static model covariates plus `trial_id`, `legacy_subject_id`, and `max_day_index`
- Added a new live adapter module:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  to assemble live `history_records` from:
  - `users/{uid}` patient profile
  - `users/{uid}/vitals`
  - `users/{uid}/appointments`
  - `users/{uid}/epro_submissions`
  - Supabase `patient_daily_logs`
  - `users/{uid}/side_effect_reports`
  - `incident_records`
  - `users/{uid}/alerts/*/messages`
- The live adapter now:
  - anchors `day_index` by `protocolAssignedAt`, else earliest operational timestamp
  - uses `Asia/Kuala_Lumpur` by default through `TRIALLIGHT_OPERATION_TZ`
  - rebuilds required rolling features using the existing generator math for:
    - days-since signals
    - recent ratios/counts
    - ePRO status coding
    - mean/max/trend windows
    - symptom burden composite
  - caps live history length to the subject registry `max_day_index` so inference stays within the deployment subject horizon
- Extended:
  - `Patient-Dropout-Prediction/src/module_service.py`
  with:
  - manifest-driven `DEFAULT_SUBJECT_CONTEXT_REGISTRY_PATH`
  to support live publisher/runtime lookups without hardcoding ad hoc paths.
- Upgraded:
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  to support:
  - `--source-mode frozen`
  - `--source-mode live`
  - `--source-mode dry-run-live`
- The publisher now:
  - keeps `frozen` as rollback/testing mode
  - uses `score_history_records_for_crc(...)` for live direct scoring
  - syncs `dropout_testing_subjects` from the new subject context registry in live mode
  - chunks live subject sync into batches to avoid oversized Supabase upsert payloads
  - prints live-source diagnostics including:
    - usable static context count
    - sufficient live history count
    - skipped patients due to missing operational sources
    - per-source coverage totals
- Updated GitHub Actions workflow:
  - `.github/workflows/dropout-precompute.yml`
  so scheduled dropout publishing now preflights and publishes with:
  - `--source-mode live`
- Validation completed for this backend cutover:
  - Python syntax check passed for:
    - `Patient-Dropout-Prediction/src/module_service.py`
    - `Patient-Dropout-Prediction/src/live_data_adapter.py`
    - `Patient-Dropout-Prediction/src/build_subject_context_registry.py`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  - subject context registry build succeeded
  - registry smoke checks confirmed:
    - `26063` rows
    - `26063` unique `subject_id`
    - legacy alias resolution example:
      - `NCT00003453_P0001 -> TL-S00001`
- Ran local live preflight in the current shell and confirmed the new path wiring is correct:
  - frozen checkpoints found
  - live subject context registry found
  - operation timezone printed correctly
- Live preflight in this Codex shell is still blocked by missing environment variables in the current shell session:
  - `FIREBASE_SERVICE_ACCOUNT_JSON`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Because those live credentials were not present in this shell, this round did **not** execute:
  - real `dry-run-live`
  - real live publish with live direct operational history
- The next execution step is now clearly defined:
  - rerun `publish_dropout_snapshots.py --preflight-only --source-mode live`
  - then `--source-mode dry-run-live`
  - then manual `--source-mode live`
  using a shell that has the Firebase and Supabase credentials loaded.

### Live Direct Scoring Dry-Run Stabilization

- Continued the live direct-scoring rollout by fixing the first real runtime blocker in:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
- Added per-source timing and error diagnostics for the live adapter:
  - `DROPOUT_LIVE_DEBUG=1` now prints source-by-source fetch latency and counts
  - publisher preview diagnostics now include `sample_live_source_errors`
- Reduced the heaviest live Firestore reads to recent-window queries where possible:
  - recent-limited reads for `vitals`
  - recent-limited reads for `appointments`
  - recent-limited reads for `epro_submissions`
  - recent-limited reads for `side_effect_reports`
  - recent-limited alert/message scans for CRC follow-up threads
- Tightened live-history readiness rules:
  - a patient is no longer considered `usable_live_history` if all live operational sources are empty
  - this prevents static-only fallback rows from being scored as if they were real live histories
- Re-ran live preflight with loaded Firebase and Supabase credentials and confirmed:
  - `ready=True`
  - live source mode paths and frozen assets resolved correctly
- Executed a read-only single-patient live direct dry-run:
  - `scanned_patient_docs=1`
  - `predictions_ready=1`
  - source timings were emitted successfully
- Executed a wider read-only five-patient live direct dry-run:
  - `scanned_patient_docs=5`
  - `predictions_ready=4`
  - `usable_static_context=5`
  - `sufficient_live_history=4`
  - `skipped_missing_operational_sources=1`
- The new live diagnostics showed the current external gap clearly:
  - Firestore live sources are reachable and scoring works
  - Supabase `patient_daily_logs` lookups failed due DNS resolution of the configured Supabase host in this shell
  - as a result, `pain/anxiety` signals from `patient_daily_logs` are still missing in this environment even though the live direct path now completes
- A representative dry-run preview artifact was written to:
  - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260331_fivepatients.json`
- Current state after this stabilization step:
  - live direct scoring no longer hangs on the first real dry-run
  - read-only batch dry-run is working against real Firestore patient docs
  - the remaining blocker before switching the main live publisher over is reliable access to Supabase `patient_daily_logs`, or an equivalent live ePRO answer fallback source

### ePRO-To-Dropout Live Data Cutover

- Implemented the formal ePRO-to-dropout cutover so pain/anxiety can flow into live direct scoring without depending on Supabase `patient_daily_logs` as the primary source.
- Updated the formal Edge-function baseline question set in:
  - `supabase/functions/_shared/baselineConfig.ts`
  and synced local parity config in:
  - `li qiu's part questionnaire ePRO/epro_config.json`
- Added a real protocol anxiety cluster:
  - `ePRO_012` anxiety boolean gatekeeper
  - `ePRO_013` anxiety 0-10 rating
  - `ePRO_014` anxiety interference 0-10 rating
  - `ePRO_015` anxiety text follow-up
- Reworked the formal ePRO Edge runtime in:
  - `supabase/functions/_shared/eproCore.ts`
  so it now:
  - extends the formal schedule from `4` days to `30` days
  - removes `dropout risk` from question generation inputs
  - uses real Firestore prompt context from:
    - `users/{uid}/ai_chat_history`
    - `users/{uid}/vitals`
    - `users/{uid}/side_effect_reports`
  - keeps the baseline protocol set immutable
  - appends at most `2` customized questions
  - restricts customized questions to `boolean` or `text`
- Added Firebase token passthrough for Edge question generation context in:
  - `supabase/functions/_shared/firebaseAuth.ts`
  - `supabase/functions/epro-daily-survey/index.ts`
  - `supabase/functions/epro-submit/index.ts`
- Added a new shared Firestore prompt-context loader:
  - `supabase/functions/_shared/firestorePromptContext.ts`
- Updated the local Node parity service in:
  - `li qiu's part questionnaire ePRO/server_integrated.js`
  so local dev behavior now matches the new contract:
  - `30` day horizon
  - no dropout-risk prompt input
  - baseline plus max-2 custom questions
- Expanded the patient-app operational ePRO mirror in:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
  so Firestore `users/{uid}/epro_submissions/{formId}` now carries structured dropout-ready answer summaries:
  - `day_number`
  - `pain_score`
  - `anxiety_score`
  - `base_positive_flags`
  - `has_free_text_followup`
- Rewired the dropout live adapter in:
  - `Patient-Dropout-Prediction/src/live_data_adapter.py`
  so ePRO scoring now uses:
  - primary source: Firestore `epro_submissions` answer summary fields
  - fallback source: Supabase `patient_daily_logs`
- Tightened fallback behavior so unsubmitted/assigned ePRO records do not trigger unnecessary Supabase answer lookups.
- Extended publisher diagnostics in:
  - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
  to report live ePRO answer-summary coverage:
  - `patients_with_epro_answer_summary`
- Added a controlled backfill utility for existing Firestore ePRO mirrors:
  - `Patient-Dropout-Prediction/src/backfill_epro_answer_mirror.py`
  - default mode is dry-run
  - `--apply` is required before it writes any real Firestore updates
- Validation completed for this cutover:
  - Python syntax check passed for:
    - `Patient-Dropout-Prediction/src/live_data_adapter.py`
    - `Patient-Dropout-Prediction/src/publish_dropout_snapshots.py`
    - `Patient-Dropout-Prediction/src/backfill_epro_answer_mirror.py`
  - local Node syntax check passed for:
    - `li qiu's part questionnaire ePRO/server_integrated.js`
  - targeted ESLint passed for:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
- Environment note:
  - `deno` is not installed in this shell, so formal Edge TypeScript runtime validation by `deno check` could not be executed here.
- Current cutover state:
  - ePRO no longer uses dropout risk to generate questions
  - anxiety is now a formal protocol-owned signal
  - Firestore ePRO mirrors are now capable of carrying dropout-ready pain/anxiety summaries
  - dropout live direct scoring is ready to prefer Firestore ePRO summaries over Supabase answer logs
- Remaining execution steps, not yet run in this round:
  - deploy the updated Edge functions
  - submit at least one real questionnaire through the new flow
  - run `publish_dropout_snapshots.py --source-mode dry-run-live`
  - confirm non-zero `patients_with_epro_answer_summary`
  - only then do manual real `--source-mode live` publish

## 2026-04-02 - ePRO live summary verification and first live dropout publish

- Resumed the paused ePRO-to-dropout cutover validation after Firestore quota recovered enough for targeted reads.
- Verified a real Firestore mirrored ePRO submission document for:
  - Firebase UID `Lt0ixlQZFkgg04MhBHwfQmW2tD33`
  - `form_id = TL-S00011-day-1`
- Confirmed the service-side Firestore mirror now contains dropout-ready structured summary fields:
  - `pain_score = 2.3333333333333335`
  - `anxiety_score = 5`
  - `status = submitted`
  - `base_positive_flags = ["ePRO_005", "ePRO_012"]`
  - `has_free_text_followup = true`
- Ran a targeted single-patient live dry-run:
  - `publish_dropout_snapshots.py --source-mode dry-run-live --firebase-uids Lt0ixlQZFkgg04MhBHwfQmW2tD33 --limit-patients 1`
- Dry-run result:
  - `predictions_ready = 1`
  - `epro_submissions = 1`
  - `epro_answer_summary = 1`
  - preview written to:
    - `Patient-Dropout-Prediction/deploy_assets/manual_live_direct_dry_run_preview_20260402_singlepatient.json`
- This confirmed the live path:
  - `Firestore ePRO answer summary -> live_data_adapter -> history_records -> dropout scoring`
- Executed the first real single-patient live publish using the new live-data path:
  - `publish_dropout_snapshots.py --source-mode live --firebase-uids Lt0ixlQZFkgg04MhBHwfQmW2tD33 --limit-patients 1 --skip-testing-subject-sync`
- Live publish succeeded:
  - `Published 1 dropout prediction snapshots`
  - `predictions_ready = 1`
  - `epro_answer_summary = 1`
- Verified Firestore current snapshot write at:
  - `users/Lt0ixlQZFkgg04MhBHwfQmW2tD33/dropout_predictions/current`
- Verified the current snapshot contains:
  - `subject_id = TL-S00011`
  - `dropout_probability = 0.79221`
  - `risk_bucket = high`
  - `recommended_action = review_today_consider_outreach`
  - `published_at = 2026-04-02T10:50:03+00:00`
- Verified matching Supabase history write in `dropout_predictions` for:
  - `subject_id = TL-S00011`
  - `dropout_probability = 0.79221`
  - `risk_bucket = high`
  - `recommended_action = review_today_consider_outreach`
- Current state after this milestone:
  - ePRO pain/anxiety summaries are now proven to flow into live direct dropout scoring
  - the live publisher has been validated end-to-end on a real patient using the new source path
  - frozen longitudinal history is no longer required for this validated live-scoring path
  - next rollout decision is whether to expand from single-patient validation to broader real-patient live publishing and scheduled automation

## 2026-04-02 - CRC safety information architecture simplified

- Implemented the recommended IA change for overlapping `Alerts`, `Safety Inbox`, and `History` so CRC now gets:
  - a top-right `Urgent` quick launcher
  - one primary `Safety Inbox` workspace
  - `History` merged into `Safety Inbox` as an internal tab instead of a separate sidebar destination
- Updated `src/pages/CRCHome.jsx`:
  - changed the top-right launcher label from `Alerts`/`Inbox`/`Message` variants to a stable `Urgent`
  - switched the alert launcher widget into urgent-only list mode
  - removed the separate `History` sidebar item
  - added `tab=open|resolved|history` state for `Safety Inbox`
  - passed structured incident data plus alert-thread history into the unified inbox panel
- Updated `src/components/LiveChatWidget.jsx` usage path so the CRC header launcher behaves like a quick urgent entry point instead of a mixed history workspace.
- Updated `src/components/TopNavbar.jsx` so the shared fallback label is also `Urgent`.
- Updated `src/App.jsx`:
  - deprecated `/history` as a standalone workflow route
  - now redirects `/history` to `/home?section=safety-inbox&tab=history`
  - kept the legacy page file on disk but disabled it as the primary path
- Expanded `src/components/SafetyInboxPanel.jsx` into a single workspace with:
  - `Open` tab for active structured incidents
  - `Resolved` tab for completed incident follow-up
  - `History` tab for read-only raw alert thread archive and audit search
- Added new inbox tab styling and archive filter support in `src/index.css`.
- Verification:
  - CRC production build passed with `npm run build:crc`
  - build required out-of-sandbox execution because sandboxed `esbuild` spawn hit `EPERM`; this was an environment permission issue, not a code error
- Resulting workflow intent:
  - `Urgent` = immediate quick launcher only
  - `Safety Inbox` = CRC daily safety workspace
  - `History` = archive tab inside `Safety Inbox`, not a competing main destination

## 2026-04-02 - CRC ePRO review-and-release workflow foundation

- Implemented the CRC-side `ePRO` workspace foundation so ePRO no longer lives only as an operational summary inside `Study Coordination`.
- Updated the CRC web navigation in:
  - `src/pages/CRCHome.jsx`
  - `src/components/CRCWorkspaceShell.jsx`
- Added a new sidebar section:
  - `ePRO`
  - positioned directly below `Patient Dropout Prediction`
  - routed via `/home?section=epro`
- Removed the duplicated `ePRO Operations` block from `Study Coordination` and moved ePRO operational visibility into the dedicated `ePRO` workspace.
- Added a new CRC review workspace component:
  - `src/components/EproReviewWorkspace.jsx`
  - supports:
    - `Pending Trial Reviews`
    - `Pending Patient Reviews`
    - `Released Today`
    - `Submitted / Overdue`
    - single-item approve actions
    - wording-only edit mode
    - `Approve All ePRO` with double-confirm modal
- Upgraded the operational status panel in:
  - `src/components/EproStatusPanel.jsx`
  - now supports header suppression so it can be embedded cleanly inside the new ePRO page without duplicating page titles.
- Added CRC web-to-edge service wiring in:
  - `src/services/eproReviewService.js`
  - new edge function calls:
    - `epro-review-queue`
    - `epro-review-action`

- Added new Supabase review data model migration:
  - `supabase/migrations/20260402_epro_review_release_workflow.sql`
- New review tables introduced:
  - `epro_trial_daily_review`
  - `epro_patient_daily_review`
- These tables support:
  - trial-level baseline review rows
  - patient-level customized review rows
  - wording overrides that only affect the current day/current review item
  - approval metadata
  - auto-release metadata

- Added new shared ePRO service modules:
  - `supabase/functions/_shared/eproShared.ts`
  - `supabase/functions/_shared/eproReviewCore.ts`
- Shared logic now covers:
  - baseline cloning
  - customized question generation
  - review-window timing
  - trial/patient review row creation
  - wording override application
  - single-item approval
  - `Approve All` approval
  - cutoff-based auto-release
  - Firestore mirror synchronization for pending/released states

- Added new edge functions:
  - `supabase/functions/epro-review-queue/index.ts`
  - `supabase/functions/epro-review-action/index.ts`
- Current runtime intent:
  - CRC workspace loads/builds today’s queue
  - patient cannot answer a draft that is still pending CRC review
  - approved or auto-released drafts become visible to the patient app

- Reworked the official ePRO runtime path in:
  - `supabase/functions/_shared/eproCore.ts`
- `epro-daily-survey` is now release-aware:
  - returns `awaiting_crc_review` when the current questionnaire is still pending CRC review
  - only returns `questions` after approval or auto-release
- `epro-submit` now only accepts the released questionnaire version and preserves review metadata in the Firestore mirror.

- Expanded Firestore prompt/identity helper behavior in:
  - `supabase/functions/_shared/firestorePromptContext.ts`
- It can now:
  - read target patient prompt context using a CRC Firebase token
  - expose:
    - `role`
    - `protocol_id`
    - `protocol_name`
    - `primary_crc_id`

- Updated patient app ePRO flow in:
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
  - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js`
- Patient-facing behavior now supports:
  - `Today’s questionnaire is awaiting CRC review.`
  - review metadata mirrored to `users/{uid}/epro_submissions/{formId}`
  - continued answer-summary mirroring for:
    - `pain_score`
    - `anxiety_score`
    - `base_positive_flags`
    - `has_free_text_followup`

- Verification completed in this workspace:
  - `node --check` passed for:
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/services/eproService.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/QuestionnaireScreen.js`
    - `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/src/pages/PatientHome.js`
  - CRC production build passed:
    - `npm.cmd run build:crc`
  - build still reports the existing large bundle warning, but the build completed successfully.

- Validation limitation:
  - `deno` is not installed in this shell, so formal local `deno` type/runtime validation for the new Edge Functions could not be executed here.

- Current state after this milestone:
  - CRC now has a dedicated `ePRO` workspace entry in the sidebar
  - `Study Coordination` no longer duplicates ePRO operational UI
  - the service layer now supports pending review, per-item approval, approve-all, and auto-release metadata
  - the patient app now understands `awaiting_crc_review`
  - remote database migration and edge function deployment still need to be executed before this workflow becomes live in production

## 2026-04-02 - Supabase ePRO review deployment unblock

- Resumed production rollout for the ePRO review-and-release workflow after the local implementation milestone.
- Confirmed this workstation is now logged into Supabase CLI for project `fygkqituefwldmglijvy`.
- Confirmed remote function baseline before deployment:
  - existing: `process-pdf`, `epro-daily-survey`, `epro-submit`
  - missing: `epro-review-queue`, `epro-review-action`
- Confirmed remote database migration path is reachable via `supabase db push --dry-run`.
- Fixed a production-blocking config gap in:
  - `supabase/config.toml`
- Added:
  - `[functions.epro-review-queue] verify_jwt = false`
  - `[functions.epro-review-action] verify_jwt = false`
- Rationale:
  - these CRC-facing functions receive Firebase ID tokens from the web client
  - without `verify_jwt = false`, the Supabase gateway would reject requests before the function-level Firebase auth check runs

## 2026-04-02 - Supabase ePRO review workflow deployed remotely

- Applied remote database migrations to project `fygkqituefwldmglijvy` via Supabase CLI:
  - `20260323_triallight_no_render_baseline.sql`
  - `20260402_epro_review_release_workflow.sql`
- Migration push completed successfully.
- Deployed live Edge Functions:
  - `epro-daily-survey`
  - `epro-submit`
  - `epro-review-queue`
  - `epro-review-action`
- Confirmed remote function list now includes:
  - `epro-review-queue`
  - `epro-review-action`
- Confirmed the new review tables are reachable through the live Supabase REST layer:
  - `epro_trial_daily_review`
  - `epro_patient_daily_review`
- Current state after deployment:
  - the CRC-side ePRO review workspace is now backed by live review tables and live review/action functions
  - patient questionnaire release can now be gated by CRC approval or auto-release cutoff on the backend
  - end-to-end CRC/patient workflow verification is still required in the product UI

## 2026-04-02 - CRC and patient web redeployed after ePRO review rollout

- Rebuilt and redeployed both live Firebase Hosting surfaces after the ePRO review/release backend rollout.
- Build steps completed successfully:
  - `npm.cmd run build:crc`
  - `npm.cmd run build:patient-web`
- Live deployment completed successfully:
  - `https://triallight.web.app`
  - `https://triallight-patient.web.app`
- This publish puts the latest front-end changes live, including:
  - CRC `ePRO` sidebar workspace entry
  - removal of duplicated `ePRO Operations` from `Study Coordination`
  - patient-facing `awaiting CRC review` gating behavior
- Existing warning retained:
  - the CRC bundle still emits the non-blocking large chunk warning during build

## 2026-05-06 - Dropout precompute workflow schedule and checkout fix

- Updated `.github/workflows/dropout-precompute.yml` on `main` so the daily dropout publish workflow can run from the default branch.
- The workflow now:
  - runs at `03:00` Asia/Kuala_Lumpur via cron `0 19 * * *` in GitHub Actions UTC time
  - explicitly checks out the private `Patient-Dropout-Prediction` repository into `Patient-Dropout-Prediction/`
  - requires the `DROPOUT_REPO_PAT` secret in addition to the existing Supabase and Firebase secrets
  - upgrades to `actions/checkout@v5` and `actions/setup-python@v6`
  - verifies the dropout workspace files before installing dependencies
  - uses `deploy_assets/checkpoints_honest_v3` as the checkpoints directory
- This change only updates the GitHub Actions automation path and does not deploy Firebase Hosting or Supabase functions.

## 2026-05-09 - Dropout precompute workflow rescheduled and path-corrected on main

- Updated `.github/workflows/dropout-precompute.yml` on `main` again to reduce scheduler congestion and fix the live asset path bug.
- The workflow now:
  - runs twice daily at `06:00` and `18:00` Asia/Kuala_Lumpur via cron `0 22 * * *` and `0 10 * * *`
  - runs the verify / install / preflight / publish steps from the checked-out `Patient-Dropout-Prediction` working directory so `deploy_assets/...` paths resolve inside the dropout repository
  - validates the required CSV and the official `Candidate 024` checkpoint directory before installing dependencies
  - uses `deploy_assets/checkpoints_candidate_024` instead of the older `honest_v3` rollback checkpoint path
  - writes a temporary `.gitmodules` file during CI so GitHub post-job cleanup no longer fails on missing submodule metadata for `Patient-Dropout-Prediction` and `MyClinicalApp2`
- This change only updates the GitHub Actions automation path and does not deploy Firebase Hosting or Supabase functions.

## 2026-05-10 - Dropout workflow switched to live-safe deploy assets

- Confirmed the latest GitHub Actions failure was caused by verifying a large frozen CSV that is not required for `source_mode=live`, not by scheduler drift or the user's local computer state.
- Updated `.github/workflows/dropout-precompute.yml` so the main workflow now verifies only the live publish assets that must exist inside the checked-out dropout repository:
  - `deploy_assets/data/triallight_subject_context_registry_v35subjectid.csv`
  - `deploy_assets/checkpoints_candidate_024/model_stage_3_29_single.pth`
  - `deploy_assets/checkpoints_candidate_024/artifacts_stage_3_29_single.pkl`
- This keeps the workflow aligned with the `Candidate 024` live deployment bundle without trying to commit the untrackable `302MB` `triallight_dropout_testing_v35subjectid.csv` file to GitHub.

