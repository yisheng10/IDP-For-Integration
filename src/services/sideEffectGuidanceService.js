import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const callable = httpsCallable(functions, 'sideEffectGuidanceChat');

function mapErrorMessage(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').trim();

  if (code.includes('unauthenticated')) {
    return '⚠️ AI Error. Your CRC session expired. Sign in again and retry.';
  }

  if (code.includes('permission-denied')) {
    return '⚠️ AI Error. This guidance workspace is restricted to CRC access.';
  }

  if (code.includes('failed-precondition')) {
    return `⚠️ AI Error. ${message || 'Gemini is not configured for this environment.'}`;
  }

  if (code.includes('resource-exhausted')) {
    return '⚠️ AI Error. Gemini rate limit reached. Retry in a moment.';
  }

  if (code.includes('deadline-exceeded')) {
    return '⚠️ AI Error. Gemini request timed out. Retry after a short wait.';
  }

  if (code.includes('unavailable')) {
    return '⚠️ AI Error. Guidance service is temporarily unavailable. Retry shortly.';
  }

  if (message) {
    return `⚠️ AI Error. ${message}`;
  }

  return '⚠️ AI Error. Side Effect Guidance is unavailable right now.';
}

export async function requestSideEffectGuidance(payload) {
  try {
    const response = await callable(payload);
    return response.data;
  } catch (error) {
    const wrapped = new Error(mapErrorMessage(error));
    wrapped.original = error;
    throw wrapped;
  }
}
