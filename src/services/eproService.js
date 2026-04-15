import Constants from 'expo-constants';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { auth, db } from '../firebase';
import { EPRO_RUNTIME, SUPABASE_KEY, SUPABASE_URL } from '../config';

const DEFAULT_PORT = '3000';
const SOURCE_SYSTEM = 'triallight-epro-service';
const EDGE_SOURCE_SYSTEM = 'triallight-epro-supabase';
const runtimeEnv = globalThis.process?.env ?? {};

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveEproRuntime() {
  return runtimeEnv.EXPO_PUBLIC_EPRO_RUNTIME || EPRO_RUNTIME || 'supabase-edge';
}

function resolveSupabaseFunctionBaseUrl() {
  const baseUrl = (runtimeEnv.EXPO_PUBLIC_SUPABASE_URL || SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Supabase URL is not configured for ePRO.');
  }
  return `${baseUrl}/functions/v1`;
}

function resolveSupabaseAnonKey() {
  const anonKey = runtimeEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_KEY || '';
  if (!anonKey) {
    throw new Error('Supabase anon key is not configured for ePRO.');
  }
  return anonKey;
}

async function getFirebaseIdToken() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in again to continue.');
  }
  return currentUser.getIdToken();
}

function resolveEproBaseUrl() {
  const explicitBase = runtimeEnv.EXPO_PUBLIC_EPRO_BASE_URL;
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '');
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && !isLocalHostname(window.location.hostname)) {
    throw new Error(
      'ePRO base URL is not configured. Add EXPO_PUBLIC_EPRO_BASE_URL before exporting the patient web build.'
    );
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    Constants.manifest?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) {
      return `http://${host}:${DEFAULT_PORT}`;
    }
  }

  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${DEFAULT_PORT}`;
  }

  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

function normalizeQuestionId(question = {}) {
  return String(question.question_id || question.id || '').trim();
}

function normalizeQuestionText(question = {}) {
  return String(question.question_text || question.question || '').replace(/\s+/g, ' ').trim();
}

function extractNumericAnswer(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function averageScores(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildEproAnswerSummary({ questions = [], answers = {} }) {
  const painScores = [];
  const anxietyScores = [];
  const basePositiveFlags = [];
  let hasFreeTextFollowup = false;

  questions.forEach((question) => {
    const questionId = normalizeQuestionId(question);
    if (!questionId) {
      return;
    }

    const rawAnswer = answers[questionId];
    const questionType = String(question.question_type || '').trim().toLowerCase();
    const questionText = normalizeQuestionText(question).toLowerCase();
    const numericValue = extractNumericAnswer(rawAnswer);

    if (String(question.tier || '').trim().toUpperCase() === 'BASE' && rawAnswer === true) {
      basePositiveFlags.push(questionId);
    }

    if (questionType === 'text' && String(rawAnswer || '').trim()) {
      hasFreeTextFollowup = true;
    }

    if (numericValue === null) {
      return;
    }

    if (
      questionText.includes('pain') &&
      !questionText.includes('interfered') &&
      !questionText.includes('bothersome')
    ) {
      painScores.push(numericValue);
    }

    if (questionText.includes('anxiety')) {
      anxietyScores.push(numericValue);
    }
  });

  return {
    painScore: averageScores(painScores),
    anxietyScore: averageScores(anxietyScores),
    basePositiveFlags,
    hasFreeTextFollowup,
  };
}

export function deriveSubjectId(user, profile = {}) {
  return (
    profile.subject_id ||
    profile.subjectId ||
    profile.trialSubjectId ||
    profile.trial_subject_id ||
    user?.uid
  );
}

export async function fetchDailySurvey({ subjectId, patientName }) {
  if (!subjectId) {
    throw new Error('subject_id is required to load the questionnaire.');
  }

  if (resolveEproRuntime() === 'supabase-edge') {
    const token = await getFirebaseIdToken();
    const baseUrl = resolveSupabaseFunctionBaseUrl();
    const params = new URLSearchParams({ subject_id: String(subjectId) });
    if (patientName) {
      params.set('patient_name', patientName);
    }

    const response = await fetch(`${baseUrl}/epro-daily-survey?${params.toString()}`, {
      method: 'GET',
      headers: {
        apikey: resolveSupabaseAnonKey(),
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load questionnaire.');
    }

    return {
      ...payload,
      source_system: payload.source_system || EDGE_SOURCE_SYSTEM,
    };
  }

  const baseUrl = resolveEproBaseUrl();
  const query = [
    `subject_id=${encodeURIComponent(subjectId)}`,
    patientName ? `patient_name=${encodeURIComponent(patientName)}` : null,
  ]
    .filter(Boolean)
    .join('&');

  const response = await fetch(`${baseUrl}/api/epro/daily-survey?${query}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load questionnaire.');
  }

  return payload;
}

export async function submitDailySurvey({ subjectId, patientName, answers }) {
  if (!subjectId) {
    throw new Error('subject_id is required to submit the questionnaire.');
  }

  if (resolveEproRuntime() === 'supabase-edge') {
    const token = await getFirebaseIdToken();
    const baseUrl = resolveSupabaseFunctionBaseUrl();
    const response = await fetch(`${baseUrl}/epro-submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: resolveSupabaseAnonKey(),
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subject_id: subjectId,
        patient_name: patientName,
        answers,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to submit questionnaire.');
    }

    return {
      ...payload,
      source_system: payload.source_system || EDGE_SOURCE_SYSTEM,
    };
  }

  const baseUrl = resolveEproBaseUrl();
  const response = await fetch(`${baseUrl}/api/epro/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject_id: subjectId,
      patient_name: patientName,
      answers,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to submit questionnaire.');
  }

  return payload;
}

export async function mirrorEproOperationalRecord({
  userId,
  subjectId,
  formId,
  dayNumber,
  assignedAt,
  dueAt,
  submittedAt,
  status,
  completionLatencySec,
  sourceSystem = SOURCE_SYSTEM,
  questionCount,
  painScore,
  anxietyScore,
  basePositiveFlags,
  hasFreeTextFollowup,
  reviewStatus,
  reviewScope,
  reviewCutoffAt,
  patientVisibleAt,
  approvedAt,
  approvedBy,
  autoReleasedAt,
}) {
  if (!userId || !formId) {
    throw new Error('userId and formId are required to mirror ePRO status.');
  }

  await setDoc(
    doc(db, 'users', userId, 'epro_submissions', formId),
    {
      subject_id: subjectId || userId,
      form_id: formId,
      day_number: typeof dayNumber === 'number' ? dayNumber : null,
      assigned_at: assignedAt || null,
      due_at: dueAt || null,
      submitted_at: submittedAt || null,
      status: status || 'assigned',
      completion_latency_sec:
        typeof completionLatencySec === 'number' ? completionLatencySec : null,
      source_system: sourceSystem,
      question_count: typeof questionCount === 'number' ? questionCount : null,
      pain_score: typeof painScore === 'number' ? painScore : null,
      anxiety_score: typeof anxietyScore === 'number' ? anxietyScore : null,
      base_positive_flags: Array.isArray(basePositiveFlags) ? basePositiveFlags : [],
      has_free_text_followup: Boolean(hasFreeTextFollowup),
      review_status: reviewStatus || null,
      review_scope: reviewScope || null,
      review_cutoff_at: reviewCutoffAt || null,
      patient_visible_at: patientVisibleAt || null,
      approved_at: approvedAt || null,
      approved_by: approvedBy || null,
      auto_released_at: autoReleasedAt || null,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
}

export function subscribeToEproSubmissions(userId, onUpdate, onError) {
  const eproQuery = query(
    collection(db, 'users', userId, 'epro_submissions'),
    orderBy('updated_at', 'desc'),
    limit(20)
  );

  return onSnapshot(
    eproQuery,
    (snapshot) => {
      const records = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      onUpdate(records);
    },
    onError
  );
}
