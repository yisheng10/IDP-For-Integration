import admin from 'firebase-admin';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { AccessToken } from 'livekit-server-sdk';

const DEFAULT_REGION = 'us-central1';
const TOKEN_TTL_SECONDS = 60 * 60;

function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new HttpsError('failed-precondition', `${name} is not configured on the server.`);
  }
  return value;
}

function sendJson(res, status, payload) {
  res.status(status).set('Content-Type', 'application/json').send(JSON.stringify(payload));
}

function parseJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw new HttpsError('invalid-argument', 'Request body must be valid JSON.');
  }
}

async function verifyRequestUser(req) {
  const authHeader = String(req.get('authorization') || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpsError('unauthenticated', 'Sign in before joining a call.');
  }

  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch {
    throw new HttpsError('unauthenticated', 'Sign in again before joining a call.');
  }
}

function normalizeRoomName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 96);
}

function buildCallRoomName(callId) {
  return normalizeRoomName(`triallight-call-${callId}`);
}

function assertCallParticipant(callData, uid) {
  if (!callData || (callData.callerId !== uid && callData.calleeId !== uid)) {
    throw new HttpsError('permission-denied', 'You can only join calls assigned to your account.');
  }
}

function toHttpsErrorPayload(error) {
  const normalized =
    error instanceof HttpsError
      ? error
      : new HttpsError('internal', error?.message || 'LiveKit token generation failed.');
  return {
    error: {
      status: normalized.code,
      message: normalized.message,
    },
  };
}

export async function createLiveKitCallToken({ callId, uid, displayName }) {
  const db = admin.firestore();
  const normalizedCallId = String(callId || '').trim();
  if (!normalizedCallId) {
    throw new HttpsError('invalid-argument', 'callId is required.');
  }

  const callRef = db.collection('calls').doc(normalizedCallId);
  const callSnapshot = await callRef.get();
  if (!callSnapshot.exists) {
    throw new HttpsError('not-found', 'Call not found.');
  }

  const callData = callSnapshot.data() || {};
  assertCallParticipant(callData, uid);

  const livekitUrl = getRequiredEnv('LIVEKIT_URL');
  const apiKey = getRequiredEnv('LIVEKIT_API_KEY');
  const apiSecret = getRequiredEnv('LIVEKIT_API_SECRET');
  const roomName = normalizeRoomName(callData.livekitRoomName) || buildCallRoomName(normalizedCallId);
  const identity = String(uid || '').trim();
  const participantName =
    String(displayName || '').trim() ||
    (callData.callerId === uid ? callData.callerName : callData.calleeName) ||
    'TrialLight user';

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity,
    name: participantName,
    ttl: TOKEN_TTL_SECONDS,
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  await callRef.set(
    {
      livekitRoomName: roomName,
      signalingMode: 'livekit',
      livekitUpdatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return {
    livekitUrl,
    roomName,
    token: await accessToken.toJwt(),
    expiresInSeconds: TOKEN_TTL_SECONDS,
  };
}

export const createLiveKitCallTokenHttp = onRequest(
  { region: DEFAULT_REGION, cors: true, secrets: [] },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { status: 'method-not-allowed', message: 'Use POST.' } });
      return;
    }

    try {
      const decodedToken = await verifyRequestUser(req);
      const payload = parseJsonBody(req);
      const result = await createLiveKitCallToken({
        callId: payload.callId,
        uid: decodedToken.uid,
        displayName: payload.displayName || decodedToken.name || decodedToken.email,
      });
      sendJson(res, 200, { result });
    } catch (error) {
      const status =
        error instanceof HttpsError && error.code === 'unauthenticated'
          ? 401
          : error instanceof HttpsError && error.code === 'permission-denied'
            ? 403
            : error instanceof HttpsError && error.code === 'not-found'
              ? 404
              : error instanceof HttpsError && error.code === 'invalid-argument'
                ? 400
                : 500;
      console.error('createLiveKitCallTokenHttp failed:', error);
      sendJson(res, status, toHttpsErrorPayload(error));
    }
  }
);
