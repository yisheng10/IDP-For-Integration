import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { DROPOUT_RUNTIME } from '../config';
import {
  fetchDropoutTrialConfigurationStatus,
  fetchDropoutTrialRegistrySubjects,
} from './dropoutTrialRegistryService';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_RECENT_SNAPSHOT_LIMIT = 30;
const MAX_RECENT_SNAPSHOT_LIMIT = 200;
const DEFAULT_RECENT_INTERVENTION_CASE_LIMIT = 6;
const MAX_RECENT_INTERVENTION_CASE_LIMIT = 20;
const DEFAULT_DROPOUT_PROXY_WINDOW_DAYS = 7;
const CLOSED_DROPOUT_INTERVENTION_STATUSES = new Set(['closed']);
const MANUAL_DROPOUT_INTERVENTION_ACTIONS = new Set([
  'outreach_attempted',
  'monitor_only',
]);
const MANUAL_DROPOUT_INTERVENTION_RESULTS = new Set([
  'no_response_yet',
  'responded',
]);
const READ_ONLY_DROPOUT_PROXY_STATUSES = new Set([
  'window_open',
  'reengaged_observed',
  'no_reengagement_observed',
  'source_incomplete',
]);

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveDropoutServiceUrl() {
  const envUrl = import.meta.env.VITE_DROPOUT_SERVICE_BASE_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined' && !isLocalHostname(window.location.hostname)) {
    return '';
  }

  return DEFAULT_BASE_URL.replace(/\/$/, '');
}

function resolveDropoutRuntime() {
  return DROPOUT_RUNTIME || 'firestore-mirror';
}

function normalizeWorkflowValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getFiniteNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function isActionableDropoutPrediction(prediction = {}) {
  if (prediction?.is_actionable === true) return true;
  const riskBucket = normalizeWorkflowValue(prediction?.risk_bucket);
  const priorityScore = getFiniteNumber(prediction?.action_priority_score);
  return riskBucket === 'high' || (priorityScore != null && priorityScore >= 0.5);
}

function hasUsableDropoutPrediction(prediction = {}) {
  return Boolean(
    String(prediction?.published_at || '').trim() ||
      normalizeWorkflowValue(prediction?.risk_bucket) ||
      getFiniteNumber(prediction?.dropout_probability) != null
  );
}

function hasIncompletePredictionSources(prediction = {}) {
  const flags = Array.isArray(prediction?.data_quality_flags)
    ? prediction.data_quality_flags.map((entry) => normalizeWorkflowValue(entry))
    : [];

  return (
    flags.includes('reduced_input_mode') ||
    flags.includes('side_effect_signal_missing') ||
    flags.includes('insufficient_history_no_score')
  );
}

function normalizeDropoutInterventionAction(value) {
  const normalized = normalizeWorkflowValue(value);
  return MANUAL_DROPOUT_INTERVENTION_ACTIONS.has(normalized) ? normalized : '';
}

function normalizeDropoutInterventionResult(value) {
  const normalized = normalizeWorkflowValue(value);
  return MANUAL_DROPOUT_INTERVENTION_RESULTS.has(normalized) ? normalized : '';
}

function buildDropoutInterventionPatientName(prediction = {}, patient = null) {
  return (
    patient?.nickname ||
    patient?.email ||
    prediction?.patientName ||
    prediction?.subject_id ||
    prediction?.userId ||
    'Unknown patient'
  );
}

export function buildDropoutInterventionPredictionSignature(prediction = {}, patient = null) {
  return JSON.stringify({
    patient_name: buildDropoutInterventionPatientName(prediction, patient),
    subject_id: prediction?.subject_id || patient?.subject_id || patient?.subjectId || '',
    published_at: prediction?.published_at || '',
    risk_bucket: normalizeWorkflowValue(prediction?.risk_bucket),
    dropout_probability: getFiniteNumber(prediction?.dropout_probability),
    recommended_action: normalizeWorkflowValue(prediction?.recommended_action),
    action_priority_score: getFiniteNumber(prediction?.action_priority_score),
    model_version: String(prediction?.model_version || '').trim(),
    routed_stage: String(prediction?.routed_stage || '').trim(),
    pred_horizon_days: getFiniteNumber(prediction?.pred_horizon_days),
    history_window_days: getFiniteNumber(prediction?.history_window_days),
    is_actionable: isActionableDropoutPrediction(prediction),
  });
}

function buildDropoutInterventionPredictionFields(prediction = {}, patient = null) {
  const riskBucket = normalizeWorkflowValue(prediction?.risk_bucket) || null;
  const probability = getFiniteNumber(prediction?.dropout_probability);
  const recommendedAction = normalizeWorkflowValue(prediction?.recommended_action) || null;
  const modelVersion = String(prediction?.model_version || '').trim() || null;
  const routedStage = String(prediction?.routed_stage || '').trim() || null;
  const predHorizonDays = getFiniteNumber(prediction?.pred_horizon_days);
  const historyWindowDays = getFiniteNumber(prediction?.history_window_days);

  return {
    patient_uid: prediction?.userId || patient?.id || '',
    patient_name: buildDropoutInterventionPatientName(prediction, patient),
    subject_id: prediction?.subject_id || patient?.subject_id || patient?.subjectId || '',
    latest_prediction_ref: prediction?.id || 'current',
    latest_prediction_signature: buildDropoutInterventionPredictionSignature(prediction, patient),
    latest_prediction_published_at: prediction?.published_at || null,
    latest_prediction_risk_bucket: riskBucket,
    latest_risk_bucket: riskBucket,
    latest_prediction_probability: probability,
    latest_dropout_probability: probability,
    latest_recommended_action: normalizeWorkflowValue(prediction?.recommended_action) || null,
    latest_action_priority_score: getFiniteNumber(prediction?.action_priority_score),
    latest_prediction_model_version: modelVersion,
    latest_model_version: modelVersion,
    latest_prediction_routed_stage: routedStage,
    latest_routed_stage: routedStage,
    latest_prediction_pred_horizon_days: predHorizonDays,
    latest_pred_horizon_days: predHorizonDays,
    latest_prediction_history_window_days: historyWindowDays,
    latest_history_window_days: historyWindowDays,
    latest_is_actionable: isActionableDropoutPrediction(prediction),
  };
}

function buildDropoutInterventionAnchorFields(prediction = {}, patient = null) {
  const latestFields = buildDropoutInterventionPredictionFields(prediction, patient);
  return {
    anchor_prediction_published_at: latestFields.latest_prediction_published_at,
    anchor_prediction_model_version: latestFields.latest_prediction_model_version,
    anchor_prediction_risk_bucket: latestFields.latest_prediction_risk_bucket,
    anchor_prediction_probability: latestFields.latest_prediction_probability,
    anchor_recommended_action: latestFields.latest_recommended_action,
  };
}

export function getDropoutInterventionProxyStatus(caseEntry = {}) {
  const directStatus = normalizeWorkflowValue(caseEntry?.proxy_reengagement_status);
  if (READ_ONLY_DROPOUT_PROXY_STATUSES.has(directStatus)) {
    return directStatus;
  }

  const legacyStatus = normalizeWorkflowValue(caseEntry?.status);
  if (READ_ONLY_DROPOUT_PROXY_STATUSES.has(legacyStatus)) {
    return legacyStatus;
  }

  return '';
}

export function isDropoutInterventionCaseOpen(caseEntry = {}) {
  const status = normalizeWorkflowValue(caseEntry?.status);
  if (status) {
    return !CLOSED_DROPOUT_INTERVENTION_STATUSES.has(status);
  }

  const legacyProxyStatus = getDropoutInterventionProxyStatus(caseEntry);
  return !['reengaged_observed', 'no_reengagement_observed'].includes(legacyProxyStatus);
}

export function findActiveDropoutInterventionCase(cases = []) {
  return (Array.isArray(cases) ? cases : []).find((entry) => isDropoutInterventionCaseOpen(entry)) || null;
}

function buildTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function classifyDropoutError(errorOrPayload) {
  const message = String(errorOrPayload?.error || errorOrPayload?.message || errorOrPayload || '');

  if (message.includes('No rows found for subject_id=')) {
    return {
      code: 'subject_not_found',
      message: 'Mapped subject ID not found in the frozen dropout dataset.',
    };
  }

  if (message.includes('subject_id is required')) {
    return {
      code: 'subject_missing',
      message: 'No mapped subject ID. Assign a subject ID in Patient configuration.',
    };
  }

  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return {
      code: 'service_unreachable',
      message: 'Dropout adapter is not reachable. Check the configured dropout service URL and retry.',
    };
  }

  return {
    code: 'adapter_error',
    message: message || 'Dropout adapter request failed.',
  };
}

export async function fetchDropoutTestingSubjects({ trialId = null, limit = 80 } = {}) {
  if (resolveDropoutRuntime() === 'firestore-mirror') {
    return fetchDropoutTrialRegistrySubjects({
      trialId,
      limitCount: limit,
    });
  }

  const baseUrl = resolveDropoutServiceUrl();
  if (!baseUrl) {
    const wrapped = new Error(
      'Dropout service URL is not configured. Add VITE_DROPOUT_SERVICE_BASE_URL before deploying the CRC website.'
    );
    wrapped.code = 'service_misconfigured';
    throw wrapped;
  }

  const params = new URLSearchParams();
  if (trialId) params.set('trial_id', trialId);
  if (limit) params.set('limit', String(limit));

  const response = await fetch(`${baseUrl}/dropout-risk/testing-subjects?${params.toString()}`, { method: 'GET' });
  const payload = await readJson(response);

  if (!response.ok) {
    const classified = classifyDropoutError(payload);
    const wrapped = new Error(classified.message);
    wrapped.code = classified.code;
    throw wrapped;
  }

  return payload;
}

export async function fetchDropoutRiskSnapshot({ subjectId, currentDay = 1, historyRecords = null }) {
  if (!subjectId) {
    const wrapped = new Error('No mapped subject ID. Assign a subject ID in Patient configuration.');
    wrapped.code = 'subject_missing';
    throw wrapped;
  }

  const baseUrl = resolveDropoutServiceUrl();
  if (!baseUrl) {
    const wrapped = new Error(
      'Dropout service URL is not configured. Add VITE_DROPOUT_SERVICE_BASE_URL before deploying the CRC website.'
    );
    wrapped.code = 'service_misconfigured';
    throw wrapped;
  }

  const { controller, timeoutId } = buildTimeoutController();

  try {
    const response = await fetch(`${baseUrl}/dropout-risk/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject_id: subjectId,
        current_day: currentDay,
        ...(Array.isArray(historyRecords) && historyRecords.length > 0
          ? { history_records: historyRecords }
          : {}),
      }),
      signal: controller.signal,
    });

    const payload = await readJson(response);

    if (!response.ok) {
      const classified = classifyDropoutError(payload);
      const wrapped = new Error(classified.message);
      wrapped.code = classified.code;
      throw wrapped;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const wrapped = new Error('Adapter timed out.');
      wrapped.code = 'adapter_timeout';
      throw wrapped;
    }

    if (error.code) {
      throw error;
    }

    const classified = classifyDropoutError(error);
    const wrapped = new Error(classified.message);
    wrapped.code = classified.code;
    throw wrapped;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function subscribeToDropoutPredictionSnapshot(userId, onUpdate, onError) {
  if (!userId) {
    onUpdate(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, 'users', userId, 'dropout_predictions', 'current'),
    (snapshot) => onUpdate(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null),
    onError
  );
}

export function subscribeToDropoutPredictionSnapshotsForUsers(userIds = [], onUpdate, onError) {
  const uniqueUserIds = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));

  if (!uniqueUserIds.length) {
    onUpdate([]);
    return () => {};
  }

  const snapshotMap = new Map();
  const unsubscribers = uniqueUserIds.map((userId) =>
    onSnapshot(
      doc(db, 'users', userId, 'dropout_predictions', 'current'),
      (snapshot) => {
        if (snapshot.exists()) {
          snapshotMap.set(userId, {
            id: snapshot.id,
            userId,
            ...snapshot.data(),
          });
        } else {
          snapshotMap.delete(userId);
        }

        onUpdate(Array.from(snapshotMap.values()));
      },
      onError
    )
  );

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

export function subscribeToAllDropoutPredictionSnapshots(onUpdate, onError, options = {}) {
  const safeLimit = Math.min(
    Math.max(Number(options?.limitCount) || DEFAULT_RECENT_SNAPSHOT_LIMIT, 1),
    MAX_RECENT_SNAPSHOT_LIMIT
  );
  const snapshotQuery = query(
    collectionGroup(db, 'dropout_predictions'),
    orderBy('published_at', 'desc'),
    limit(safeLimit)
  );
  return onSnapshot(
    snapshotQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .filter((entry) => entry.id === 'current')
        .map((entry) => {
          const userDoc = entry.ref.parent.parent;
          return {
            id: entry.id,
            userId: userDoc?.id || '',
            ...entry.data(),
          };
        });
      onUpdate(rows);
    },
    onError
  );
}

export async function validateDropoutSubjectMapping({ subjectId, trialId, currentPatientId = null } = {}) {
  const normalizedSubjectId = String(subjectId || '').trim();
  const normalizedTrialId = String(trialId || '').trim().toUpperCase();

  if (!normalizedSubjectId) {
    return {
      ok: true,
      subject_id: '',
      trial_id: normalizedTrialId || null,
      conflict_patient_ids: [],
    };
  }

  if (!normalizedTrialId) {
    const wrapped = new Error(
      'Assign a clinical trial with a configured dropout trial ID before saving a mapped Subject ID.'
    );
    wrapped.code = 'subject_mapping_missing_trial';
    throw wrapped;
  }

  const supportStatus = await fetchDropoutTrialConfigurationStatus({
    trialId: normalizedTrialId,
    hydrateIfSupported: true,
  });

  if (supportStatus.status === 'unknown_trial') {
    const wrapped = new Error(
      `The disengagement dataset trial ID ${normalizedTrialId} is not supported by the canonical dropout registry.`
    );
    wrapped.code = 'subject_mapping_unknown_trial';
    throw wrapped;
  }

  if (supportStatus.status === 'pool_unavailable' || supportStatus.status === 'sync_failed') {
    const wrapped = new Error(
      supportStatus.message || `The canonical Subject ID pool for ${normalizedTrialId} is not available right now.`
    );
    wrapped.code = 'subject_mapping_pool_unavailable';
    throw wrapped;
  }

  if (supportStatus.status !== 'configured') {
    const wrapped = new Error(
      supportStatus.message || `The current protocol is not ready for canonical Subject ID mapping yet.`
    );
    wrapped.code = 'subject_mapping_trial_not_ready';
    throw wrapped;
  }

  const subjectDoc = await getDoc(
    doc(db, 'dropout_trial_registry', normalizedTrialId, 'subjects', normalizedSubjectId)
  );

  if (!subjectDoc.exists()) {
    const crossTrialSnapshot = await getDocs(
      query(collectionGroup(db, 'subjects'), where('subject_id', '==', normalizedSubjectId), limit(2))
    );
    const crossTrialDoc = crossTrialSnapshot.docs.find(
      (entry) => String(entry.get('trial_id') || '').trim().toUpperCase() !== normalizedTrialId
    );
    if (crossTrialDoc) {
      const wrapped = new Error(
        `The selected Subject ID belongs to ${String(crossTrialDoc.get('trial_id') || 'another trial')}, not the current protocol mapping ${normalizedTrialId}.`
      );
      wrapped.code = 'subject_mapping_trial_mismatch';
      throw wrapped;
    }

    const wrapped = new Error(
      `The selected Subject ID is not available in the verified canonical pool for ${normalizedTrialId}.`
    );
    wrapped.code = 'subject_mapping_unknown_subject';
    throw wrapped;
  }

  const fieldsToCheck = ['subject_id', 'subjectId', 'dropout_subject_id', 'dropoutSubjectId'];
  const conflictSets = await Promise.all(
    fieldsToCheck.map(async (fieldName) => {
      const snapshot = await getDocs(query(collection(db, 'users'), where(fieldName, '==', normalizedSubjectId), limit(2)));
      return snapshot.docs.map((entry) => entry.id);
    })
  );
  const conflictPatientIds = Array.from(
    new Set(
      conflictSets
        .flat()
        .filter((patientId) => patientId && patientId !== currentPatientId)
    )
  );

  if (conflictPatientIds.length) {
    const wrapped = new Error(
      'This Subject ID is already mapped to another patient. Each canonical Subject ID can only be assigned once.'
    );
    wrapped.code = 'subject_mapping_conflict';
    wrapped.conflictPatientIds = conflictPatientIds;
    throw wrapped;
  }

  return {
    ok: true,
    subject_id: normalizedSubjectId,
    trial_id: normalizedTrialId,
    conflict_patient_ids: [],
  };
}

export function subscribeToDropoutPredictionExplainability(userId, onUpdate, onError) {
  if (!userId) {
    onUpdate(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, 'users', userId, 'dropout_predictions_explainability', 'current'),
    (snapshot) => onUpdate(snapshot.exists() ? { id: snapshot.id, userId, ...snapshot.data() } : null),
    onError
  );
}

export function subscribeToRecentDropoutInterventionCases(userId, onUpdate, onError, options = {}) {
  if (!userId) {
    onUpdate([]);
    return () => {};
  }

  const safeLimit = Math.min(
    Math.max(Number(options?.limitCount) || DEFAULT_RECENT_INTERVENTION_CASE_LIMIT, 1),
    MAX_RECENT_INTERVENTION_CASE_LIMIT
  );
  const casesQuery = query(
    collection(db, 'users', userId, 'dropout_intervention_cases'),
    orderBy('updated_at', 'desc'),
    limit(safeLimit)
  );

  return onSnapshot(
    casesQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((entry) => ({ id: entry.id, userId, ...entry.data() })));
    },
    onError
  );
}

export async function updateActiveDropoutInterventionCase({
  userId,
  patient = null,
  prediction = {},
  recentCases = [],
  currentUser = null,
  actionTaken = '',
  manualResult = '',
} = {}) {
  if (!userId) {
    throw new Error('Patient UID is required to update a dropout intervention case.');
  }

  const normalizedAction = normalizeDropoutInterventionAction(actionTaken);
  const normalizedResult = normalizeDropoutInterventionResult(manualResult);
  if ((normalizedAction || normalizedResult) && !currentUser?.uid) {
    throw new Error('CRC identity is required to record intervention actions.');
  }

  const activeCase = findActiveDropoutInterventionCase(recentCases);
  const hasPrediction = hasUsableDropoutPrediction(prediction);
  if (!activeCase && !normalizedAction && !normalizedResult && (!hasPrediction || !isActionableDropoutPrediction(prediction))) {
    return null;
  }

  const predictionFields = buildDropoutInterventionPredictionFields(
    { ...prediction, userId: prediction?.userId || userId },
    patient
  );
  const anchorFields = buildDropoutInterventionAnchorFields(
    { ...prediction, userId: prediction?.userId || userId },
    patient
  );
  const actorUid = currentUser?.uid || null;
  const actorName = currentUser?.name || null;
  const actionTimestamp = normalizedAction ? serverTimestamp() : null;
  const resultTimestamp = normalizedResult ? serverTimestamp() : null;
  const defaultProxyStatus = hasIncompletePredictionSources(prediction) ? 'source_incomplete' : 'window_open';

  if (activeCase?.id) {
    const updates = {
      ...predictionFields,
      updated_at: serverTimestamp(),
      last_synced_by_uid: actorUid,
      last_synced_by_name: actorName,
    };

    if (!normalizeWorkflowValue(activeCase.status)) {
      updates.status = 'open';
    }

    if (!getDropoutInterventionProxyStatus(activeCase)) {
      updates.proxy_reengagement_status = defaultProxyStatus;
    }

    if (!activeCase?.proxy_window_days) {
      updates.proxy_window_days = DEFAULT_DROPOUT_PROXY_WINDOW_DAYS;
    }

    if (!String(activeCase?.anchor_prediction_published_at || '').trim()) {
      Object.assign(updates, anchorFields);
    }

    if (normalizedAction) {
      updates.action_taken_code = normalizedAction;
      updates.action_taken_at = actionTimestamp;
      updates.action_taken_by_uid = actorUid;
      updates.action_taken_by_name = actorName;
    }

    if (normalizedResult) {
      updates.contact_result_status = normalizedResult;
      updates.contact_result_recorded_at = resultTimestamp;
      updates.contact_result_recorded_by_uid = actorUid;
      updates.contact_result_recorded_by_name = actorName;
    }

    await updateDoc(doc(db, 'users', userId, 'dropout_intervention_cases', activeCase.id), updates);
    return {
      id: activeCase.id,
      ...activeCase,
      ...updates,
    };
  }

  const caseRef = doc(collection(db, 'users', userId, 'dropout_intervention_cases'));
  const payload = {
    case_id: caseRef.id,
    patient_uid: userId,
    status: 'open',
    opened_at: serverTimestamp(),
    close_reason: null,
    proxy_reengagement_status: defaultProxyStatus,
    proxy_window_days: DEFAULT_DROPOUT_PROXY_WINDOW_DAYS,
    action_taken_code: normalizedAction || null,
    contact_result_status: normalizedResult || null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    created_by_uid: actorUid,
    created_by_name: actorName,
    last_synced_by_uid: actorUid,
    last_synced_by_name: actorName,
    sync_source: 'crc_panel_case_loop',
    ...anchorFields,
    ...predictionFields,
  };

  if (normalizedAction) {
    payload.action_taken_at = actionTimestamp;
    payload.action_taken_by_uid = actorUid;
    payload.action_taken_by_name = actorName;
  }

  if (normalizedResult) {
    payload.contact_result_recorded_at = resultTimestamp;
    payload.contact_result_recorded_by_uid = actorUid;
    payload.contact_result_recorded_by_name = actorName;
  }

  await setDoc(caseRef, payload);
  return {
    id: caseRef.id,
    ...payload,
  };
}

export async function closeDropoutInterventionCase({ userId, caseId, currentUser = null } = {}) {
  if (!userId || !caseId) {
    throw new Error('Patient UID and intervention case ID are required to close a case.');
  }

  await updateDoc(doc(db, 'users', userId, 'dropout_intervention_cases', caseId), {
    status: 'closed',
    closed_at: serverTimestamp(),
    close_reason: 'manual_crc_close',
    updated_at: serverTimestamp(),
    last_synced_by_uid: currentUser?.uid || null,
    last_synced_by_name: currentUser?.name || null,
  });
}

export async function fetchDropoutDashboardSummary() {
  const summarySnapshot = await getDoc(doc(db, 'dashboard_summaries', 'dropout_current'));
  if (!summarySnapshot.exists()) {
    return null;
  }
  return {
    id: summarySnapshot.id,
    ...summarySnapshot.data(),
  };
}
