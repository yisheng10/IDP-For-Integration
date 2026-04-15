import admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
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
  suggestAppointmentDate,
  suggestAppointmentDateHttp,
} from './guidanceRuntime.js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const WEB_PUSH_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || '';
const WEB_PUSH_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || '';
const WEB_PUSH_CONTACT_EMAIL = process.env.WEB_PUSH_CONTACT_EMAIL || '';

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
  sideEffectGuidanceChat,
  sideEffectGuidanceChatHttp,
  classifyGuidanceRoute,
  classifyGuidanceRouteHttp,
  retrieveGuidanceContext,
  retrieveGuidanceContextHttp,
  ingestGuidanceDocument,
  deleteGuidanceDocumentChunks,
  deleteGuidanceDocumentChunksHttp,
  processPendingProtocolGuidanceIndex,
  suggestAppointmentDate,
  suggestAppointmentDateHttp,
};
