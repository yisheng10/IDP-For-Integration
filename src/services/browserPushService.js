import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

const WEB_PUSH_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '';

function isSecureContextForPush() {
  return (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'https:' || window.location.hostname === 'localhost')
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function hashEndpoint(endpoint) {
  if (window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(endpoint);
    const buffer = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return window.btoa(endpoint).replace(/[^a-zA-Z0-9]/g, '').slice(0, 96);
}

export function isBrowserPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getBrowserPushState() {
  if (!isBrowserPushSupported()) {
    return {
      canEnable: false,
      label: 'Browser push is not supported in this environment.',
      buttonLabel: 'Unavailable',
    };
  }

  if (!isSecureContextForPush()) {
    return {
      canEnable: false,
      label: 'Browser push requires HTTPS or localhost.',
      buttonLabel: 'Unavailable',
    };
  }

  if (!WEB_PUSH_PUBLIC_KEY) {
    return {
      canEnable: false,
      label: 'Set VITE_WEB_PUSH_PUBLIC_KEY before enabling CRC browser push.',
      buttonLabel: 'Missing Key',
    };
  }

  if (Notification.permission === 'granted') {
    return {
      canEnable: true,
      label: 'Browser permission granted. Sync this device to keep CRC push subscriptions current.',
      buttonLabel: 'Sync Alerts',
    };
  }

  if (Notification.permission === 'denied') {
    return {
      canEnable: false,
      label: 'Notification permission is blocked in this browser. Reset it in browser settings to re-enable alerts.',
      buttonLabel: 'Blocked',
    };
  }

  return {
    canEnable: true,
    label: 'Enable browser alerts so serious incidents can notify CRC without waiting for a manual login check.',
    buttonLabel: 'Enable Alerts',
  };
}

export async function registerBrowserPushSubscription(userId) {
  if (!isBrowserPushSupported()) {
    throw new Error('Browser push is not supported in this environment.');
  }

  if (!isSecureContextForPush()) {
    throw new Error('Browser push requires HTTPS or localhost.');
  }

  if (!WEB_PUSH_PUBLIC_KEY) {
    throw new Error('Missing VITE_WEB_PUSH_PUBLIC_KEY.');
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  await navigator.serviceWorker.register('/notification-sw.js');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_PUBLIC_KEY),
    });
  }

  const subscriptionJson = subscription.toJSON();
  const subscriptionId = await hashEndpoint(subscription.endpoint);

  await setDoc(
    doc(db, 'users', userId, 'web_push_subscriptions', subscriptionId),
    {
      endpoint: subscription.endpoint,
      keys: subscriptionJson.keys || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      permission: permission,
      user_agent: window.navigator.userAgent,
      source_system: 'crc_web_browser_push',
    },
    { merge: true }
  );

  return subscription;
}

export function showForegroundIncidentNotification(incident) {
  if (!incident || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return null;
  }

  const notification = new Notification(`TrialLight: ${incident.event_title}`, {
    body: `${incident.severity} incident for ${(incident.linked_patients || [])
      .map((entry) => entry.patient_name)
      .join(', ')}`,
    data: {
      incidentId: incident.id,
      url: `/home?incident=${incident.id}`,
    },
  });

  notification.onclick = () => {
    window.focus();
    window.location.assign(`/home?incident=${incident.id}`);
  };

  return notification;
}
