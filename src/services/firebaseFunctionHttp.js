import { auth } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

function getFunctionsBaseUrl() {
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new Error('Missing Firebase project ID.');
  }

  const useEmulator =
    typeof window !== 'undefined' && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === 'true';

  if (useEmulator) {
    return `http://127.0.0.1:5001/${projectId}/${FUNCTIONS_REGION}`;
  }

  return `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;
}

async function getCurrentUserIdToken() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const error = new Error('Sign in before using CRC guidance services.');
    error.code = 'unauthenticated';
    throw error;
  }

  return currentUser.getIdToken();
}

function parseResponsePayload(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toHttpFunctionError(response, payload, fallbackMessage) {
  const error = new Error(
    String(payload?.error?.message || fallbackMessage || `Request failed with status ${response.status}.`)
  );
  error.code = String(payload?.error?.status || response.status || 'unknown').toLowerCase();
  error.httpStatus = response.status;
  error.payload = payload;
  return error;
}

export async function callFunctionHttp(functionName, payload = {}) {
  const idToken = await getCurrentUserIdToken();
  const response = await fetch(`${getFunctionsBaseUrl()}/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });

  const responseText = await response.text();
  const parsedPayload = parseResponsePayload(responseText);

  if (!response.ok || parsedPayload?.error) {
    throw toHttpFunctionError(response, parsedPayload, responseText);
  }

  if (parsedPayload && typeof parsedPayload === 'object' && 'result' in parsedPayload) {
    return parsedPayload.result;
  }

  return parsedPayload;
}
