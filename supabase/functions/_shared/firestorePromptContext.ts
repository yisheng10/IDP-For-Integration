const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'idp-authentication-7e8d7';

type FirestoreRecord = Record<string, unknown> & {
  id?: string;
  path?: string;
};

function encodeFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => encodeFirestoreValue(entry)),
      },
    };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, encodeFirestoreValue(entry)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value: Record<string, unknown> | null | undefined): unknown {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return String(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('mapValue' in value) {
    const fields = (value.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, decodeFirestoreValue(entry)]));
  }
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: Record<string, unknown>[] })?.values || [];
    return values.map((entry) => decodeFirestoreValue(entry));
  }
  return null;
}

function decodeFirestoreDocument(document: Record<string, unknown>): FirestoreRecord {
  const fields = (document.fields as Record<string, Record<string, unknown>> | undefined) || {};
  const decoded = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
  const name = String(document.name || '');
  const id = name ? name.split('/').pop() || '' : '';
  return {
    ...decoded,
    id,
    path: name ? name.replace(/^projects\/[^/]+\/databases\/\(default\)\/documents\//, '') : '',
  };
}

async function listUserSubcollectionDocs({
  firebaseUid,
  firebaseToken,
  collectionName,
  pageSize,
  orderBy,
}: {
  firebaseUid: string;
  firebaseToken: string;
  collectionName: string;
  pageSize: number;
  orderBy: string;
}): Promise<FirestoreRecord[]> {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${firebaseUid}/${collectionName}`
  );
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('orderBy', orderBy);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  return documents.map((document) => decodeFirestoreDocument(document));
}

async function getUserDocument({
  firebaseUid,
  firebaseToken,
}: {
  firebaseUid: string;
  firebaseToken: string;
}): Promise<FirestoreRecord> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${firebaseUid}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
    },
  });

  if (!response.ok) {
    return {};
  }

  return decodeFirestoreDocument(await response.json());
}

async function upsertUserSubcollectionDoc({
  firebaseUid,
  firebaseToken,
  collectionName,
  documentId,
  payload,
}: {
  firebaseUid: string;
  firebaseToken: string;
  collectionName: string;
  documentId: string;
  payload: Record<string, unknown>;
}) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${firebaseUid}/${collectionName}/${documentId}`
  );

  Object.keys(payload).forEach((fieldPath) => {
    url.searchParams.append('updateMask.fieldPaths', fieldPath);
  });

  const response = await fetch(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${firebaseToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [key, encodeFirestoreValue(value)])
      ),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Unable to mirror Firestore document: ${errorText}`);
  }

  return decodeFirestoreDocument(await response.json());
}

function formatVitalsSummary(rows: FirestoreRecord[]): string[] {
  return rows.slice(0, 4).map((row) => {
    const parts = [];
    if (row.temperature != null) parts.push(`Temp ${row.temperature} C`);
    if (row.bpSys != null) parts.push(`BP ${row.bpSys}/${row.bpDia ?? '-'}`);
    if (row.heartRate != null) parts.push(`HR ${row.heartRate}`);
    if (row.respRate != null) parts.push(`RR ${row.respRate}`);
    if (row.spo2 != null) parts.push(`SpO2 ${row.spo2}%`);
    return parts.join(' | ');
  }).filter(Boolean);
}

function formatSideEffectSummary(rows: FirestoreRecord[]): string[] {
  return rows.slice(0, 4).map((row) => {
    const title = String(row.symptom_title || 'Reported symptom');
    const severity = String(row.severity || 'unknown');
    const summary = String(row.triage_summary || row.details || '').trim();
    return summary ? `${title} (${severity}): ${summary}` : `${title} (${severity})`;
  });
}

function formatChatSummary(rows: FirestoreRecord[]): string[] {
  return rows
    .filter((row) => String(row.role || '').toLowerCase() === 'user')
    .slice(-6)
    .map((row) => String(row.text || '').trim())
    .filter(Boolean);
}

export async function loadRealtimePromptContext({
  firebaseUid,
  firebaseToken,
  targetFirebaseUid,
}: {
  firebaseUid: string;
  firebaseToken: string;
  targetFirebaseUid?: string | null;
}) {
  const effectiveUid = String(targetFirebaseUid || firebaseUid || '').trim();
  const [vitalsRows, sideEffectRows, chatRows] = await Promise.all([
    listUserSubcollectionDocs({
      firebaseUid: effectiveUid,
      firebaseToken,
      collectionName: 'vitals',
      pageSize: 4,
      orderBy: 'timestamp desc',
    }),
    listUserSubcollectionDocs({
      firebaseUid: effectiveUid,
      firebaseToken,
      collectionName: 'side_effect_reports',
      pageSize: 4,
      orderBy: 'submitted_at desc',
    }),
    listUserSubcollectionDocs({
      firebaseUid: effectiveUid,
      firebaseToken,
      collectionName: 'ai_chat_history',
      pageSize: 12,
      orderBy: 'timestamp desc',
    }),
  ]);

  return {
    recentVitalsSummary: formatVitalsSummary(vitalsRows),
    recentSideEffectSummary: formatSideEffectSummary(sideEffectRows),
    recentChatSummary: formatChatSummary(chatRows),
    contextCounts: {
      vitals: vitalsRows.length,
      sideEffects: sideEffectRows.length,
      chatMessages: chatRows.length,
    },
  };
}

export async function upsertUserEproSubmissionMirror({
  firebaseUid,
  firebaseToken,
  formId,
  payload,
}: {
  firebaseUid: string;
  firebaseToken: string;
  formId: string;
  payload: Record<string, unknown>;
}) {
  return upsertUserSubcollectionDoc({
    firebaseUid,
    firebaseToken,
    collectionName: 'epro_submissions',
    documentId: formId,
    payload,
  });
}

export async function loadRealtimeUserIdentity({
  firebaseUid,
  firebaseToken,
  targetFirebaseUid,
}: {
  firebaseUid: string;
  firebaseToken: string;
  targetFirebaseUid?: string | null;
}) {
  const effectiveUid = String(targetFirebaseUid || firebaseUid || '').trim();
  const userDoc = await getUserDocument({ firebaseUid: effectiveUid, firebaseToken });
  return {
    firebase_uid: effectiveUid,
    subject_id: String(userDoc.subject_id || userDoc.subjectId || '').trim(),
    nickname: String(userDoc.nickname || '').trim(),
    role: String(userDoc.role || '').trim().toLowerCase(),
    protocol_id: String(userDoc.protocolId || '').trim(),
    protocol_name: String(userDoc.protocolName || '').trim(),
    primary_crc_id: String(userDoc.primary_crc_id || userDoc.primaryCrcId || '').trim(),
  };
}
