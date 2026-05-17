import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { streamFunctionHttp } from './firebaseFunctionHttp';
import { SIDE_EFFECT_GUIDANCE_MODEL, SIDE_EFFECT_GUIDANCE_PROVIDER } from '../config';

const callable = httpsCallable(functions, 'sideEffectGuidanceChat');

function mapErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').trim();

  if (message.includes('api key') || message.includes('permission denied')) {
    return 'AI Error. Gemini API key is invalid for this environment. Update your local Gemini key and retry.';
  }

  if (message.includes('quota') || code.includes('resource-exhausted')) {
    return 'AI Error. Gemini quota or rate limit was reached. Retry in a moment.';
  }

  if (message.includes('timed out') || code.includes('deadline-exceeded')) {
    return 'AI Error. Gemini request timed out. Retry after a short wait.';
  }

  if (code.includes('unauthenticated')) {
    return 'AI Error. Your CRC session expired. Sign in again and retry.';
  }

  if (code.includes('permission-denied')) {
    return 'AI Error. This guidance workspace is restricted to CRC access.';
  }

  if (code.includes('failed-precondition')) {
    return `AI Error. ${message || 'Gemini is not configured for this environment.'}`;
  }

  if (code.includes('unavailable')) {
    return 'AI Error. Guidance service is temporarily unavailable. Retry shortly.';
  }

  if (message) {
    return `AI Error. ${message}`;
  }

  return 'AI Error. Adverse Event Guidance is unavailable right now.';
}

async function requestGuidanceViaCallable(payload) {
  const response = await callable(payload);
  return response.data;
}

export async function requestSideEffectGuidance(payload) {
  try {
    if (SIDE_EFFECT_GUIDANCE_PROVIDER !== 'firebase-callable') {
      throw new Error(
        `Unsupported guidance provider "${SIDE_EFFECT_GUIDANCE_PROVIDER}". TrialLight guidance must use the shared online Firebase runtime.`
      );
    }

    return await requestGuidanceViaCallable(payload);
  } catch (error) {
    const wrapped = new Error(mapErrorMessage(error));
    wrapped.original = error;
    throw wrapped;
  }
}

export async function requestSideEffectGuidanceTraceStream(payload, handlers = {}) {
  try {
    await streamFunctionHttp('sideEffectGuidanceTraceStreamHttp', payload, {
      onEvent: (event) => {
        if (event?.type === 'trace_event' && typeof handlers.onTraceEvent === 'function') {
          handlers.onTraceEvent(event);
          return;
        }

        if (event?.type === 'final_answer' && typeof handlers.onFinalAnswer === 'function') {
          handlers.onFinalAnswer(event);
          return;
        }

        if (event?.type === 'trace_complete' && typeof handlers.onTraceComplete === 'function') {
          handlers.onTraceComplete(event);
          return;
        }

        if (event?.type === 'trace_error' && typeof handlers.onTraceError === 'function') {
          handlers.onTraceError(event);
        }
      },
    });
  } catch (error) {
    const wrapped = new Error(mapErrorMessage(error));
    wrapped.original = error;
    throw wrapped;
  }
}
