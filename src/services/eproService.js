import Constants from 'expo-constants';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from '../firebase';

const DEFAULT_PORT = '3000';
const SOURCE_SYSTEM = 'triallight-epro-service';

function resolveDevHost() {
  const explicitBase = process.env.EXPO_PUBLIC_EPRO_BASE_URL;
  if (explicitBase) {
    return explicitBase.replace(/\/$/, '');
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

  const baseUrl = resolveDevHost();
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

  const baseUrl = resolveDevHost();
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
  assignedAt,
  dueAt,
  submittedAt,
  status,
  completionLatencySec,
  sourceSystem = SOURCE_SYSTEM,
  questionCount,
}) {
  if (!userId || !formId) {
    throw new Error('userId and formId are required to mirror ePRO status.');
  }

  await setDoc(
    doc(db, 'users', userId, 'epro_submissions', formId),
    {
      subject_id: subjectId || userId,
      form_id: formId,
      assigned_at: assignedAt || null,
      due_at: dueAt || null,
      submitted_at: submittedAt || null,
      status: status || 'assigned',
      completion_latency_sec:
        typeof completionLatencySec === 'number' ? completionLatencySec : null,
      source_system: sourceSystem,
      question_count: typeof questionCount === 'number' ? questionCount : null,
      updated_at: new Date().toISOString(),
    },
    { merge: true }
  );
}

export function subscribeToEproSubmissions(userId, onUpdate, onError) {
  const eproQuery = query(
    collection(db, 'users', userId, 'epro_submissions'),
    orderBy('updated_at', 'desc')
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
