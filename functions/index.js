import admin from 'firebase-admin';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import webpush from 'web-push';
import {
  classifyGuidanceRoute,
  classifyGuidanceRouteHttp,
  deleteGuidanceDocumentChunks,
  deleteGuidanceDocumentChunksHttp,
  ingestGuidanceDocument,
  processPendingProtocolGuidanceIndex,
  retrieveGuidanceContext,
  retrieveGuidanceContextHttp,
  sideEffectGuidanceChat,
  sideEffectGuidanceChatHttp,
  sideEffectGuidanceTraceHttp,
  sideEffectGuidanceTraceStreamHttp,
  suggestAppointmentDate,
  suggestAppointmentDateHttp,
} from './guidanceRuntime.js';
import {
  fetchCrcUrgentIncidentSummary,
  purgePatientRecord,
  sendCrcPatientDirectMessage,
} from './crcAdminRuntime.js';
import {
  configureProtocolDropoutTrial,
  ensureDropoutTrialRegistryTrial,
  refreshConfiguredDropoutTrialRegistry,
} from './dropoutRegistryRuntime.js';
import {
  finalizeUploadedProtocolTemplate,
  reconcileProtocolDropoutTrialBinding,
} from './protocolStaticContextRuntime.js';
import { createLiveKitCallTokenHttp } from './livekitRuntime.js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const WEB_PUSH_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || '';
const WEB_PUSH_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || '';
const WEB_PUSH_CONTACT_EMAIL = process.env.WEB_PUSH_CONTACT_EMAIL || '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const INCOMING_CALL_CATEGORY_ID = 'incoming-call';

if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY && WEB_PUSH_CONTACT_EMAIL) {
  webpush.setVapidDetails(
    `mailto:${WEB_PUSH_CONTACT_EMAIL}`,
    WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY
  );
}

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

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildIncomingCallSignature(activeCall) {
  return `${activeCall?.callId || 'unknown'}:${activeCall?.callerId || 'unknown'}:${activeCall?.callType || 'audio'}`;
}

async function sendExpoPushMessages(messages) {
  if (!messages.length) return [];

  const responses = [];
  for (const chunk of chunkArray(messages, 100)) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chunk),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.errors?.[0]?.message || `Expo push failed with status ${response.status}.`);
    }
    responses.push(payload);
  }

  return responses;
}

async function getPatientExpoPushTokens(userId) {
  const tokenSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('expo_push_tokens')
    .limit(50)
    .get();

  return tokenSnapshot.docs
    .map((tokenDoc) => String(tokenDoc.get('token') || '').trim())
    .filter((token) => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

async function getPatientFcmTokens(userId) {
  const tokenSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('fcm_tokens')
    .limit(50)
    .get();

  return tokenSnapshot.docs
    .map((tokenDoc) => String(tokenDoc.get('token') || '').trim())
    .filter(Boolean);
}

async function sendFcmDataMessages(tokens, data) {
  if (!tokens.length) return [];

  const responses = [];
  for (const chunk of chunkArray(tokens, 500)) {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value == null ? '' : String(value)])
      ),
      android: {
        priority: 'high',
      },
    });
    responses.push(response);
  }
  return responses;
}

export const sendIncomingCallPushNotification = onDocumentWritten(
  'users/{userId}/active_call/current',
  async (event) => {
    const afterSnapshot = event.data.after;
    if (!afterSnapshot.exists) {
      return;
    }

    const activeCall = afterSnapshot.data() || {};
    if (activeCall.type !== 'offer' || !activeCall.callId || !activeCall.callerId) {
      return;
    }

    const signature = buildIncomingCallSignature(activeCall);
    if (activeCall.notification_state?.last_push_signature === signature) {
      return;
    }

    const [expoTokens, fcmTokens] = await Promise.all([
      getPatientExpoPushTokens(event.params.userId),
      getPatientFcmTokens(event.params.userId),
    ]);

    if (!expoTokens.length && !fcmTokens.length) {
      await afterSnapshot.ref.set(
        {
          notification_state: {
            last_push_signature: signature,
            last_push_attempt_at: new Date().toISOString(),
            last_push_recipient_count: 0,
          },
        },
        { merge: true }
      );
      return;
    }

    const callerName = String(activeCall.callerName || 'TrialLight CRC').trim();
    const isVideo = activeCall.callType === 'video';
    const notificationData = {
      type: 'incoming-call',
      callId: activeCall.callId,
      callerId: activeCall.callerId,
      callerName,
      callType: activeCall.callType || 'audio',
      signalingMode: activeCall.signalingMode || 'livekit',
      livekitRoomName: activeCall.livekitRoomName || '',
    };
    const expoMessages = expoTokens.map((token) => ({
      to: token,
      sound: 'default',
      priority: 'high',
      channelId: 'incoming-calls',
      categoryId: INCOMING_CALL_CATEGORY_ID,
      title: isVideo ? 'Incoming TrialLight video call' : 'Incoming TrialLight call',
      body: `${callerName} is calling you.`,
      data: notificationData,
    }));

    try {
      await Promise.all([
        sendFcmDataMessages(fcmTokens, notificationData),
        sendExpoPushMessages(expoMessages),
      ]);
      await afterSnapshot.ref.set(
        {
          notification_state: {
            last_push_signature: signature,
            last_push_attempt_at: new Date().toISOString(),
            last_push_recipient_count: fcmTokens.length + expoMessages.length,
          },
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Incoming call push delivery failed:', error);
      await afterSnapshot.ref.set(
        {
          notification_state: {
            last_push_signature: signature,
            last_push_attempt_at: new Date().toISOString(),
            last_push_recipient_count: 0,
            last_push_error: error?.message || 'Expo push delivery failed.',
          },
        },
        { merge: true }
      );
    }
  }
);

export const sendPatientMessagePushNotification = onDocumentCreated(
  'users/{userId}/alerts/{alertId}/messages/{messageId}',
  async (event) => {
    const message = event.data?.data() || {};
    if (String(message.sender || '').trim().toLowerCase() !== 'crc') {
      return;
    }

    const messageText = String(message.text || '').trim();
    if (!messageText) {
      return;
    }

    const [expoTokens, fcmTokens] = await Promise.all([
      getPatientExpoPushTokens(event.params.userId),
      getPatientFcmTokens(event.params.userId),
    ]);
    if (!expoTokens.length && !fcmTokens.length) {
      return;
    }

    const senderName = String(message.senderName || 'CRC').trim();
    const body = messageText.length > 160 ? `${messageText.slice(0, 157)}...` : messageText;
    const notificationData = {
      type: 'crc-message',
      alertId: event.params.alertId,
      messageId: event.params.messageId,
      senderName,
      body,
    };
    const expoMessages = expoTokens.map((token) => ({
      to: token,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      title: senderName,
      body,
      data: notificationData,
    }));

    try {
      await Promise.all([
        sendFcmDataMessages(fcmTokens, notificationData),
        sendExpoPushMessages(expoMessages),
      ]);
    } catch (error) {
      console.error('Patient message push delivery failed:', error);
    }
  }
);

export const sendIncidentPushNotifications = onDocumentWritten(
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

export {
  configureProtocolDropoutTrial,
  ensureDropoutTrialRegistryTrial,
  fetchCrcUrgentIncidentSummary,
  finalizeUploadedProtocolTemplate,
  purgePatientRecord,
  reconcileProtocolDropoutTrialBinding,
  refreshConfiguredDropoutTrialRegistry,
  sendCrcPatientDirectMessage,
  sideEffectGuidanceChat,
  sideEffectGuidanceChatHttp,
  sideEffectGuidanceTraceHttp,
  sideEffectGuidanceTraceStreamHttp,
  classifyGuidanceRoute,
  classifyGuidanceRouteHttp,
  createLiveKitCallTokenHttp,
  retrieveGuidanceContext,
  retrieveGuidanceContextHttp,
  ingestGuidanceDocument,
  deleteGuidanceDocumentChunks,
  deleteGuidanceDocumentChunksHttp,
  processPendingProtocolGuidanceIndex,
  suggestAppointmentDate,
  suggestAppointmentDateHttp,
};
