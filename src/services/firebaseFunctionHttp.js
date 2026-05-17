import { auth } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

function shouldAllowLocalFunctionsBaseUrl() {
  return import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === 'true';
}

function isLocalFunctionsUrl(value) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(String(value || '').trim());
}

function getFunctionsBaseUrl() {
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new Error('Missing Firebase project ID.');
  }

  const explicitBaseUrl = String(import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL || '').trim();
  const cloudBaseUrl = `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;

  if (explicitBaseUrl) {
    if (isLocalFunctionsUrl(explicitBaseUrl) && !shouldAllowLocalFunctionsBaseUrl()) {
      console.warn(
        'Ignoring local Firebase Functions base URL because VITE_USE_FUNCTIONS_EMULATOR is not enabled. Falling back to the shared online Firebase runtime.'
      );
      return cloudBaseUrl;
    }

    return explicitBaseUrl.replace(/\/+$/, '');
  }

  const useEmulator = typeof window !== 'undefined' && shouldAllowLocalFunctionsBaseUrl();

  if (useEmulator) {
    return `http://127.0.0.1:5001/${projectId}/${FUNCTIONS_REGION}`;
  }

  return cloudBaseUrl;
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

export async function streamFunctionHttp(functionName, payload = {}, { onEvent } = {}) {
  const idToken = await getCurrentUserIdToken();
  const response = await fetch(`${getFunctionsBaseUrl()}/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify(payload || {}),
  });

  if (!response.ok) {
    const responseText = await response.text();
    const parsedPayload = parseResponsePayload(responseText);
    throw toHttpFunctionError(response, parsedPayload, responseText);
  }

  if (!response.body) {
    throw new Error('Streaming response body was not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        let parsedLine = null;
        try {
          parsedLine = JSON.parse(line);
        } catch {
          parsedLine = null;
        }

        if (!parsedLine) {
          return;
        }

        if (parsedLine?.error) {
          throw new Error(String(parsedLine.error?.message || 'Streaming request failed.'));
        }

        if (typeof onEvent === 'function') {
          onEvent(parsedLine);
        }
      });
  }

  const finalChunk = decoder.decode();
  const trailingBuffer = `${buffer}${finalChunk}`.trim();
  if (trailingBuffer) {
    let parsedLine = null;
    try {
      parsedLine = JSON.parse(trailingBuffer);
    } catch {
      parsedLine = null;
    }

    if (parsedLine?.error) {
      throw new Error(String(parsedLine.error?.message || 'Streaming request failed.'));
    }

    if (parsedLine && typeof onEvent === 'function') {
      onEvent(parsedLine);
    }
  }
}
