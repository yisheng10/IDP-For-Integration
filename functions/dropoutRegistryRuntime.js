import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MAX_BATCH_WRITES = 400;
const REGISTRY_COLLECTION = 'dropout_trial_registry';
const SUBJECTS_SUBCOLLECTION = 'subjects';
const FUNCTIONS_SOURCE_NAME = 'firebase_function_dropout_registry';

let cachedSeed = null;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeTrialId(value) {
  return normalizeText(value).toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function splitIntoChunks(items, size = MAX_BATCH_WRITES) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function seedFilePath() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, 'generated', 'dropoutTrialRegistrySeed.json');
}

function loadRegistrySeed() {
  if (cachedSeed) {
    return cachedSeed;
  }

  const raw = fs.readFileSync(seedFilePath(), 'utf-8');
  const parsed = JSON.parse(raw);
  const trials = Array.isArray(parsed?.trials) ? parsed.trials : [];
  const trialMap = new Map();
  trials.forEach((entry) => {
    const trialId = normalizeTrialId(entry?.trial_id);
    if (!trialId) return;
    trialMap.set(trialId, {
      ...entry,
      trial_id: trialId,
      label: normalizeText(entry?.label) || trialId,
      is_active: entry?.is_active !== false,
      status: normalizeText(entry?.status) || 'configured',
      canonical_subject_pool_source:
        normalizeText(entry?.canonical_subject_pool_source) || 'dropout_trial_registry_seed',
      expected_pool_size: Number(entry?.expected_pool_size) || Number((entry?.subjects || []).length) || 0,
      model_version_label:
        normalizeText(entry?.model_version_label) ||
        normalizeText(parsed?.model_defaults?.model_version_label) ||
        '',
      model_checkpoint_file:
        normalizeText(entry?.model_checkpoint_file) ||
        normalizeText(parsed?.model_defaults?.model_checkpoint_file) ||
        '',
      model_artifacts_file:
        normalizeText(entry?.model_artifacts_file) ||
        normalizeText(parsed?.model_defaults?.model_artifacts_file) ||
        '',
      subjects: Array.isArray(entry?.subjects)
        ? entry.subjects
            .map((subject) => ({
              subject_id: normalizeText(subject?.subject_id),
              legacy_subject_id: normalizeText(subject?.legacy_subject_id) || null,
              trial_id: trialId,
              max_day_index: Number(subject?.max_day_index) || 0,
            }))
            .filter((subject) => subject.subject_id)
        : [],
    });
  });

  cachedSeed = {
    generated_at: normalizeText(parsed?.generated_at),
    source_file: normalizeText(parsed?.source_file),
    model_defaults: parsed?.model_defaults || {},
    trialMap,
  };
  return cachedSeed;
}

export function getSupportedTrialSeed(trialId) {
  const normalizedTrialId = normalizeTrialId(trialId);
  if (!normalizedTrialId) {
    return null;
  }
  return loadRegistrySeed().trialMap.get(normalizedTrialId) || null;
}

async function ensureCrcAccessByUid(uid, token = {}) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'CRC authentication is required.');
  }

  const email = normalizeLowerText(token.email || '');
  if (email.endsWith('@hospital.com')) {
    return {
      uid,
      role: 'crc',
      email,
      displayName: token.name || token.email || 'CRC user',
    };
  }

  const userSnapshot = await db.collection('users').doc(uid).get();
  if (!userSnapshot.exists) {
    throw new HttpsError('permission-denied', 'CRC profile not found.');
  }

  const userData = userSnapshot.data() || {};
  if (normalizeLowerText(userData.role) !== 'crc') {
    throw new HttpsError('permission-denied', 'Only CRC users can perform this action.');
  }

  return {
    uid,
    ...userData,
  };
}

async function assertAuthenticatedCrcRequest(request) {
  return ensureCrcAccessByUid(request.auth?.uid, request.auth?.token || {});
}

function buildRegistryMetadata(seed, syncedAt) {
  return {
    trial_id: seed.trial_id,
    label: seed.label,
    is_active: Boolean(seed.is_active),
    status: seed.status || 'configured',
    canonical_subject_pool_available: seed.subjects.length > 0,
    canonical_subject_pool_source: seed.canonical_subject_pool_source,
    expected_pool_size: Number(seed.expected_pool_size) || seed.subjects.length,
    synced_subject_count: seed.subjects.length,
    model_version_label: seed.model_version_label || '',
    model_checkpoint_file: seed.model_checkpoint_file || '',
    model_artifacts_file: seed.model_artifacts_file || '',
    seed_generated_at: loadRegistrySeed().generated_at || null,
    source_file: loadRegistrySeed().source_file || '',
    last_synced_at: syncedAt,
    last_verified_at: syncedAt,
    sync_source: FUNCTIONS_SOURCE_NAME,
  };
}

async function upsertRegistrySubjects(registryRef, seed, syncedAt) {
  const existingSnapshot = await registryRef.collection(SUBJECTS_SUBCOLLECTION).get();
  const nextSubjectIds = new Set(seed.subjects.map((subject) => subject.subject_id));

  for (const chunk of splitIntoChunks(seed.subjects)) {
    const batch = db.batch();
    chunk.forEach((subject) => {
      const subjectRef = registryRef.collection(SUBJECTS_SUBCOLLECTION).doc(subject.subject_id);
      batch.set(
        subjectRef,
        {
          subject_id: subject.subject_id,
          legacy_subject_id: subject.legacy_subject_id,
          trial_id: seed.trial_id,
          max_day_index: Number(subject.max_day_index) || 0,
          synced_at: syncedAt,
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  const staleRefs = existingSnapshot.docs
    .filter((entry) => !nextSubjectIds.has(entry.id))
    .map((entry) => entry.ref);

  for (const chunk of splitIntoChunks(staleRefs)) {
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export async function syncTrialRegistryToFirestore(trialId) {
  const seed = getSupportedTrialSeed(trialId);
  if (!seed) {
    throw new HttpsError(
      'invalid-argument',
      `The disengagement dataset trial ID ${normalizeTrialId(trialId)} is not in the supported dropout trial registry.`
    );
  }

  if (!seed.is_active) {
    throw new HttpsError(
      'failed-precondition',
      `The disengagement dataset trial ID ${seed.trial_id} exists but is not currently active.`
    );
  }

  if (!seed.subjects.length) {
    throw new HttpsError(
      'failed-precondition',
      `The disengagement dataset trial ID ${seed.trial_id} does not currently have a canonical subject pool.`
    );
  }

  const syncedAt = nowIso();
  const metadata = buildRegistryMetadata(seed, syncedAt);
  const registryRef = db.collection(REGISTRY_COLLECTION).doc(seed.trial_id);

  await registryRef.set(metadata, { merge: true });
  await upsertRegistrySubjects(registryRef, seed, syncedAt);

  return metadata;
}

export function buildProtocolTrialFields(metadata) {
  return {
    dropout_trial_id: metadata.trial_id,
    dropout_trial_label: metadata.label || metadata.trial_id,
    dropout_trial_status: metadata.status || 'configured',
    dropout_trial_pool_size: Number(metadata.expected_pool_size) || 0,
    dropout_trial_model_version: metadata.model_version_label || '',
    dropout_trial_last_verified_at: metadata.last_verified_at || nowIso(),
    dropout_trial_last_synced_at: metadata.last_synced_at || metadata.last_verified_at || nowIso(),
    dropout_trial_sync_source: metadata.sync_source || FUNCTIONS_SOURCE_NAME,
    dropout_trial_sync_error: null,
    updatedAt: nowIso(),
  };
}

export function buildNotConfiguredProtocolFields() {
  return {
    dropout_trial_id: '',
    dropout_trial_label: null,
    dropout_trial_status: 'not_configured',
    dropout_trial_pool_size: null,
    dropout_trial_model_version: null,
    dropout_trial_last_verified_at: nowIso(),
    dropout_trial_last_synced_at: null,
    dropout_trial_sync_source: FUNCTIONS_SOURCE_NAME,
    dropout_trial_sync_error: null,
    updatedAt: nowIso(),
  };
}

export function buildPatientTrialFieldsFromProtocolFields(protocolFields) {
  const status = normalizeText(protocolFields?.dropout_trial_status) || 'not_configured';
  const trialId = normalizeText(protocolFields?.dropout_trial_id) || null;
  return {
    dropout_trial_id: trialId,
    dropout_trial_label: normalizeText(protocolFields?.dropout_trial_label) || null,
    dropout_trial_status: status,
    dropout_trial_pool_size: Number(protocolFields?.dropout_trial_pool_size) || null,
    dropout_trial_model_version: normalizeText(protocolFields?.dropout_trial_model_version) || null,
    dropout_trial_last_verified_at: normalizeText(protocolFields?.dropout_trial_last_verified_at) || null,
    dropout_trial_last_synced_at: normalizeText(protocolFields?.dropout_trial_last_synced_at) || null,
  };
}

function buildProtocolTrialMatchFields({
  status = 'not_configured',
  message = '',
  candidates = [],
  source = FUNCTIONS_SOURCE_NAME,
} = {}) {
  return {
    dropout_trial_match_status: normalizeText(status) || 'not_configured',
    dropout_trial_match_message: normalizeText(message) || null,
    dropout_trial_match_candidates: Array.isArray(candidates) ? candidates.filter(Boolean) : [],
    dropout_trial_match_source: normalizeText(source) || FUNCTIONS_SOURCE_NAME,
  };
}

export async function updateAssignedPatientsForProtocol(protocolId, protocolFields) {
  const snapshot = await db.collection('users').where('protocolId', '==', protocolId).get();
  const patientFields = buildPatientTrialFieldsFromProtocolFields(protocolFields);
  const nextTrialId = normalizeText(patientFields.dropout_trial_id) || null;

  for (const chunk of splitIntoChunks(snapshot.docs)) {
    const batch = db.batch();
    chunk.forEach((entry) => {
      const currentTrialId = normalizeText(entry.get('dropout_trial_id') || entry.get('dropoutTrialId')) || null;
      const currentSubjectId =
        normalizeText(
          entry.get('subject_id') ||
            entry.get('subjectId') ||
            entry.get('dropout_subject_id') ||
            entry.get('dropoutSubjectId')
        ) || null;
      const nextPatientFields = { ...patientFields };

      if (currentSubjectId && (!nextTrialId || currentTrialId !== nextTrialId)) {
        nextPatientFields.subject_id = null;
      }

      batch.update(entry.ref, nextPatientFields);
    });
    await batch.commit();
  }

  return snapshot.size;
}

export const ensureDropoutTrialRegistryTrial = onCall(async (request) => {
  await assertAuthenticatedCrcRequest(request);
  const trialId = normalizeTrialId(request.data?.trialId);

  if (!trialId) {
    throw new HttpsError('invalid-argument', 'trialId is required.');
  }

  return syncTrialRegistryToFirestore(trialId);
});

export const configureProtocolDropoutTrial = onCall(async (request) => {
  await assertAuthenticatedCrcRequest(request);

  const protocolId = normalizeText(request.data?.protocolId);
  const requestedTrialId = normalizeTrialId(request.data?.trialId);

  if (!protocolId) {
    throw new HttpsError('invalid-argument', 'protocolId is required.');
  }

  const protocolRef = db.collection('protocols').doc(protocolId);
  const protocolSnapshot = await protocolRef.get();
  if (!protocolSnapshot.exists) {
    throw new HttpsError('not-found', 'Protocol template not found.');
  }
  const protocolData = protocolSnapshot.data() || {};
  const extractionStatus = normalizeLowerText(protocolData.extraction_status || '');

  if (!requestedTrialId) {
    const protocolFields = {
      ...buildNotConfiguredProtocolFields(),
      ...buildProtocolTrialMatchFields({
        status: 'not_configured',
        message: 'No disengagement dataset trial ID is configured for this protocol yet.',
        candidates: [],
        source: 'manual_clear',
      }),
    };
    await protocolRef.set(protocolFields, { merge: true });
    const assignedPatientCount = await updateAssignedPatientsForProtocol(protocolId, protocolFields);
    return {
      ...protocolFields,
      assigned_patient_count: assignedPatientCount,
      canonical_subject_pool_available: false,
    };
  }

  if (extractionStatus !== 'ready') {
    if (extractionStatus === 'error' || extractionStatus === 'fallback_only') {
      throw new HttpsError(
        'failed-precondition',
        'This protocol cannot bind a disengagement dataset trial ID until strict server-side dropout static-context extraction succeeds.'
      );
    }

    throw new HttpsError(
      'failed-precondition',
      'This protocol cannot bind a disengagement dataset trial ID until its strict dropout static context is ready.'
    );
  }

  const metadata = await syncTrialRegistryToFirestore(requestedTrialId);
  const protocolFields = {
    ...buildProtocolTrialFields(metadata),
    ...buildProtocolTrialMatchFields({
      status: 'configured',
      message: `This protocol is configured to supported disengagement dataset trial ${requestedTrialId}.`,
      candidates: [requestedTrialId],
      source: 'manual_configured',
    }),
  };
  await protocolRef.set(protocolFields, { merge: true });
  const assignedPatientCount = await updateAssignedPatientsForProtocol(protocolId, protocolFields);

  return {
    ...protocolFields,
    canonical_subject_pool_available: Boolean(metadata.canonical_subject_pool_available),
    assigned_patient_count: assignedPatientCount,
  };
});

export const refreshConfiguredDropoutTrialRegistry = onSchedule('every 12 hours', async () => {
  const protocolSnapshot = await db.collection('protocols').get();
  const configuredTrialIds = Array.from(
    new Set(
      protocolSnapshot.docs
        .map((entry) => normalizeTrialId(entry.get('dropout_trial_id')))
        .filter(Boolean)
    )
  );

  let refreshedCount = 0;
  const skippedTrials = [];
  for (const trialId of configuredTrialIds) {
    try {
      await syncTrialRegistryToFirestore(trialId);
      refreshedCount += 1;
    } catch (error) {
      console.error(`Dropout trial registry refresh failed for ${trialId}:`, error);
      skippedTrials.push(trialId);
    }
  }

  return {
    configured_trial_count: configuredTrialIds.length,
    refreshed_count: refreshedCount,
    skipped_trials: skippedTrials,
    refreshed_at: nowIso(),
  };
});
