import { collection, collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
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
