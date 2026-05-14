import { auth } from '../firebase';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';

function resolveFunctionBaseUrl() {
  const baseUrl = String(SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Supabase URL is not configured for the CRC ePRO workspace.');
  }
  return `${baseUrl}/functions/v1`;
}

async function getFirebaseIdToken() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in again to continue.');
  }
  return currentUser.getIdToken();
}

function normalizeEdgeFunctionError(message) {
  const raw = String(message || '').trim();

  if (raw.includes('unexpected "iss" claim value')) {
    return 'The live CRC ePRO review service is temporarily unavailable.';
  }

  return raw || 'Unable to reach the ePRO review service.';
}

async function callEdgeFunction(path, body) {
  const token = await getFirebaseIdToken();
  let response;

  try {
    response = await fetch(`${resolveFunctionBaseUrl()}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
    });
  } catch (error) {
    const message = String(error?.message || error || '');
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      throw new Error('The live CRC ePRO review service is temporarily unavailable.');
    }
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(normalizeEdgeFunctionError(payload.error));
  }
  return payload;
}

function normalizeActivePatients(patients = []) {
  return patients
    .map((patient) => ({
      firebase_uid: patient.id,
      subject_id: patient.subject_id || patient.subjectId || patient.id,
      nickname: patient.nickname || patient.email || patient.id,
      protocol_id: patient.protocolId || '',
      protocol_name: patient.protocolName || '',
    }))
    .filter((patient) => patient.firebase_uid && patient.subject_id);
}

export async function fetchEproReviewWorkspace(patients = []) {
  const payload = await callEdgeFunction('epro-review-queue', {
    activePatients: normalizeActivePatients(patients),
  });
  return payload;
}

export async function approveTrialReview(reviewId) {
  const payload = await callEdgeFunction('epro-review-action', {
    action: 'approve_trial',
    reviewId,
  });
  return payload.payload;
}

export async function approvePatientReview(reviewId) {
  const payload = await callEdgeFunction('epro-review-action', {
    action: 'approve_patient',
    reviewId,
  });
  return payload.payload;
}

export async function saveTrialReviewWording(reviewId, overrides) {
  const payload = await callEdgeFunction('epro-review-action', {
    action: 'save_trial_wording',
    reviewId,
    overrides,
  });
  return payload.payload;
}

export async function savePatientReviewWording(reviewId, overrides) {
  const payload = await callEdgeFunction('epro-review-action', {
    action: 'save_patient_wording',
    reviewId,
    overrides,
  });
  return payload.payload;
}

export async function approveAllEproReviews() {
  const payload = await callEdgeFunction('epro-review-action', {
    action: 'approve_all',
  });
  return payload.payload;
}
