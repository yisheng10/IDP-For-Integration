import { collectionGroup, doc, getDoc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { DROPOUT_RUNTIME } from '../config';
import { supabase } from '../supabaseClient';

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
    let request = supabase
      .from('dropout_testing_subjects')
      .select('trial_id, subject_id, max_day_index')
      .order('trial_id', { ascending: true })
      .order('subject_id', { ascending: true })
      .limit(limit);

    if (trialId) {
      request = request.eq('trial_id', trialId);
    }

    const { data, error } = await request;
    if (error) {
      const wrapped = new Error(error.message || 'Unable to load subject ID options.');
      wrapped.code = 'testing_subjects_unavailable';
      throw wrapped;
    }

    const rows = (data || []).map((row) => ({
      trial_id: row.trial_id,
      subject_id: row.subject_id,
      max_day_index: row.max_day_index,
    }));
    const canonicalRows = rows.filter((row) => /^TL-S\d{5}$/i.test(String(row.subject_id || '').trim()));

    return {
      subjects: (canonicalRows.length ? canonicalRows : rows).slice(0, limit),
    };
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
