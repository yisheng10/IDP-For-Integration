const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();

const db = admin.firestore();

const WEB_PUSH_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || '';
const WEB_PUSH_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || '';
const WEB_PUSH_CONTACT_EMAIL = process.env.WEB_PUSH_CONTACT_EMAIL || '';
const SIDE_EFFECT_GUIDANCE_PROVIDER = process.env.SIDE_EFFECT_GUIDANCE_PROVIDER || 'gemini';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY && WEB_PUSH_CONTACT_EMAIL) {
  webpush.setVapidDetails(
    `mailto:${WEB_PUSH_CONTACT_EMAIL}`,
    WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY
  );
}

function normalizeConversation(messages = []) {
  return messages
    .filter((entry) => entry && typeof entry.content === 'string' && entry.content.trim())
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'model' : entry.role === 'model' ? 'model' : 'user',
      parts: [{ text: entry.content.trim() }],
    }));
}

async function ensureCrcAccess(auth) {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'CRC authentication is required.');
  }

  const email = String(auth.token?.email || '').toLowerCase();
  if (email.endsWith('@hospital.com')) {
    return {
      role: 'crc',
      email,
      displayName: auth.token?.name || auth.token?.email || 'CRC user',
    };
  }

  try {
    const userSnapshot = await db.collection('users').doc(auth.uid).get();
    if (!userSnapshot.exists) {
      throw new HttpsError('permission-denied', 'CRC profile not found.');
    }

    const userData = userSnapshot.data() || {};
    if (userData.role !== 'crc') {
      throw new HttpsError('permission-denied', 'Only CRC users can access Side Effect Guidance.');
    }

    return userData;
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    console.error('CRC profile lookup failed:', error);
    throw new HttpsError('unavailable', 'CRC profile lookup is temporarily unavailable.');
  }
}

async function callGeminiGuidance({ systemPrompt, messages, userMessage }) {
  if (!GEMINI_API_KEY) {
    throw new HttpsError('failed-precondition', 'Set GEMINI_API_KEY in the functions runtime before using Side Effect Guidance.');
  }

  const conversation = normalizeConversation(messages);
  if (userMessage && String(userMessage).trim()) {
    conversation.push({
      role: 'user',
      parts: [{ text: String(userMessage).trim() }],
    });
  }

  if (!conversation.length) {
    throw new HttpsError('invalid-argument', 'A user message is required.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: String(systemPrompt || '').trim() || 'You are Side Effect Guidance for CRC workflows.' }],
        },
        contents: conversation,
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.promptFeedback?.blockReason ||
      `Gemini returned HTTP ${response.status}.`;

    if (response.status === 429) {
      throw new HttpsError('resource-exhausted', detail);
    }

    if (response.status === 403) {
      throw new HttpsError('permission-denied', detail);
    }

    if (response.status >= 500) {
      throw new HttpsError('unavailable', detail);
    }

    throw new HttpsError('internal', detail);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new HttpsError('internal', 'Gemini returned an empty response.');
  }

  return {
    text,
    provider: 'gemini',
    model: GEMINI_MODEL,
  };
}

exports.sideEffectGuidanceChat = onCall(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (request) => {
    await ensureCrcAccess(request.auth);

    const provider = String(request.data?.provider || SIDE_EFFECT_GUIDANCE_PROVIDER || 'gemini').toLowerCase();
    const payload = {
      systemPrompt: request.data?.systemPrompt,
      messages: Array.isArray(request.data?.messages) ? request.data.messages : [],
      userMessage: request.data?.userMessage,
    };

    if (provider !== 'gemini') {
      throw new HttpsError('failed-precondition', `Provider "${provider}" is not enabled in this deployment.`);
    }

    return callGeminiGuidance(payload);
  }
);

function isActionableIncident(incident) {
  if (!incident) return false;
  if (incident.status === 'resolved') return false;
  return (
    incident.severity === 'serious' ||
    incident.immediate_help_requested === true ||
    incident.urgency === 'urgent'
  );
}

function buildSignature(incidentId, incident) {
  return `${incidentId}:${incident.updated_at || incident.created_at || 'unknown'}:${incident.status || 'open'}`;
}

async function markPushAttempt(ref, signature, count) {
  await ref.set(
    {
      notification_state: {
        last_push_signature: signature,
        last_push_attempt_at: new Date().toISOString(),
        last_push_recipient_count: count,
      },
    },
    { merge: true }
  );
}

exports.sendIncidentPushNotifications = onDocumentWritten(
  'incident_records/{incidentId}',
  async (event) => {
    const afterSnapshot = event.data.after;

    if (!afterSnapshot.exists) {
      return;
    }

    const incident = afterSnapshot.data();
    const incidentId = event.params.incidentId;

    if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY || !WEB_PUSH_CONTACT_EMAIL) {
      console.warn('Web push environment variables are missing. Skipping push dispatch.');
      return;
    }

    if (!incident.primary_crc_id || !isActionableIncident(incident)) {
      return;
    }

    const signature = buildSignature(incidentId, incident);
    if (incident.notification_state?.last_push_signature === signature) {
      return;
    }

    const subscriptionSnapshot = await db
      .collection('users')
      .doc(incident.primary_crc_id)
      .collection('web_push_subscriptions')
      .get();

    if (subscriptionSnapshot.empty) {
      await markPushAttempt(afterSnapshot.ref, signature, 0);
      return;
    }

    const payload = JSON.stringify({
      title: `TrialLight: ${incident.event_title || 'CRC incident'}`,
      body: `${incident.severity || 'serious'} incident for ${(incident.linked_patients || [])
        .map((entry) => entry.patient_name)
        .join(', ')}`,
      data: {
        incidentId,
        url: `/home?incident=${incidentId}`,
      },
    });

    const invalidSubscriptions = [];

    await Promise.all(
      subscriptionSnapshot.docs.map(async (subscriptionDoc) => {
        const subscription = {
          endpoint: subscriptionDoc.get('endpoint'),
          keys: subscriptionDoc.get('keys') || {},
        };

        try {
          await webpush.sendNotification(subscription, payload);
        } catch (error) {
          const statusCode = error.statusCode || error.status;
          if (statusCode === 404 || statusCode === 410) {
            invalidSubscriptions.push(subscriptionDoc.ref);
          } else {
            console.error(`Push delivery failed for ${subscriptionDoc.id}:`, error.message || error);
          }
        }
      })
    );

    await Promise.all(invalidSubscriptions.map((ref) => ref.delete()));
    await markPushAttempt(afterSnapshot.ref, signature, subscriptionSnapshot.size - invalidSubscriptions.length);
  }
);
