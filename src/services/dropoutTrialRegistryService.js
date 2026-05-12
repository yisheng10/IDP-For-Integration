import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import supportMetadataSeed from '../generated/dropoutTrialSupportMetadata.json';

const REGISTRY_COLLECTION = 'dropout_trial_registry';
const SUBJECTS_SUBCOLLECTION = 'subjects';
const ensureDropoutTrialRegistryTrialCallable = httpsCallable(functions, 'ensureDropoutTrialRegistryTrial');
const configureProtocolDropoutTrialCallable = httpsCallable(functions, 'configureProtocolDropoutTrial');
const reconcileProtocolDropoutTrialBindingCallable = httpsCallable(functions, 'reconcileProtocolDropoutTrialBinding');
const hydratedTrialIds = new Set();

function normalizeText(value) {
  return String(value || '').trim();
}

export function normalizeDropoutTrialId(value) {
  return normalizeText(value).toUpperCase();
}

function getSeedTrialsMap() {
  return supportMetadataSeed?.trials && typeof supportMetadataSeed.trials === 'object'
    ? supportMetadataSeed.trials
    : {};
}

export function getSupportedDropoutTrialMetadata(trialId) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  if (!normalizedTrialId) {
    return null;
  }

  const entry = getSeedTrialsMap()[normalizedTrialId];
  if (!entry) {
    return null;
  }

  return {
    trial_id: normalizedTrialId,
    label: normalizeText(entry.label) || normalizedTrialId,
    is_active: entry.is_active !== false,
    status: normalizeText(entry.status) || 'configured',
    expected_pool_size: Number(entry.expected_pool_size) || 0,
    model_version_label: normalizeText(entry.model_version_label) || '',
    model_checkpoint_file: normalizeText(entry.model_checkpoint_file) || '',
    model_artifacts_file: normalizeText(entry.model_artifacts_file) || '',
    canonical_subject_pool_source: normalizeText(entry.canonical_subject_pool_source) || '',
  };
}

function buildStatusPayload({
  trialId = '',
  source = 'none',
  registryDoc = null,
  seedMetadata = null,
} = {}) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);

  if (!normalizedTrialId) {
    return {
      trial_id: '',
      status: 'not_configured',
      status_label: 'Not configured',
      message: 'No disengagement dataset trial ID is configured for this protocol yet.',
      registry: null,
      metadata: null,
    };
  }

  if (registryDoc) {
    const canonicalPoolAvailable = registryDoc.canonical_subject_pool_available !== false;
    const isActive = registryDoc.is_active !== false;
    const rawStatus = normalizeText(registryDoc.status) || 'configured';
    const status =
      !isActive
        ? 'inactive'
        : rawStatus === 'model_unavailable'
          ? 'model_unavailable'
          : !canonicalPoolAvailable
            ? 'pool_unavailable'
            : 'configured';

    const statusLabel =
      status === 'configured'
        ? 'Configured'
        : status === 'pool_unavailable'
          ? 'No canonical subject pool available'
          : status === 'model_unavailable'
            ? 'No model configured'
            : 'Inactive';

    const message =
      status === 'configured'
        ? `This disengagement trial ID is supported. ${Number(registryDoc.expected_pool_size) || 0} canonical Subject IDs are currently available for mapping.`
        : status === 'pool_unavailable'
          ? `This disengagement trial ID exists, but its canonical Subject ID pool is not available yet.`
          : status === 'model_unavailable'
            ? `This disengagement trial ID exists, but no active disengagement model is configured for it.`
            : `This disengagement trial ID exists but is currently inactive.`;

    return {
      trial_id: normalizedTrialId,
      status,
      status_label: statusLabel,
      message,
      registry: registryDoc,
      metadata: seedMetadata || null,
      source,
    };
  }

  if (!seedMetadata) {
    return {
      trial_id: normalizedTrialId,
      status: 'unknown_trial',
      status_label: 'Unknown trial ID',
      message: `The disengagement dataset trial ID ${normalizedTrialId} is not in the supported dropout trial registry.`,
      registry: null,
      metadata: null,
      source,
    };
  }

  return {
    trial_id: normalizedTrialId,
    status: 'supported_pending_sync',
    status_label: 'Supported trial ID',
    message: `This disengagement trial ID is supported. Save the protocol to verify and sync its canonical Subject ID pool.`,
    registry: null,
    metadata: seedMetadata,
    source,
  };
}

async function readRegistryDoc(trialId) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  if (!normalizedTrialId) {
    return null;
  }

  const snapshot = await getDoc(doc(db, REGISTRY_COLLECTION, normalizedTrialId));
  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function ensureDropoutTrialRegistryTrial(trialId) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  if (!normalizedTrialId) {
    throw new Error('A disengagement dataset trial ID is required before the canonical Subject ID pool can be synced.');
  }

  const response = await ensureDropoutTrialRegistryTrialCallable({
    trialId: normalizedTrialId,
  });
  hydratedTrialIds.add(normalizedTrialId);
  return response.data || {};
}

export async function fetchDropoutTrialConfigurationStatus({ trialId, hydrateIfSupported = false } = {}) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  const seedMetadata = getSupportedDropoutTrialMetadata(normalizedTrialId);
  if (!normalizedTrialId) {
    return buildStatusPayload();
  }

  let registryDoc = await readRegistryDoc(normalizedTrialId);
  if (!registryDoc && hydrateIfSupported && seedMetadata && !hydratedTrialIds.has(normalizedTrialId)) {
    try {
      await ensureDropoutTrialRegistryTrial(normalizedTrialId);
      registryDoc = await readRegistryDoc(normalizedTrialId);
    } catch (error) {
      return {
        ...buildStatusPayload({
          trialId: normalizedTrialId,
          seedMetadata,
          source: 'seed_fallback',
        }),
        status: 'sync_failed',
        status_label: 'Sync failed',
        message:
          error?.message ||
          `The canonical Subject ID pool for ${normalizedTrialId} could not be synced automatically right now.`,
      };
    }
  }

  return buildStatusPayload({
    trialId: normalizedTrialId,
    seedMetadata,
    registryDoc,
    source: registryDoc ? 'firestore_registry' : 'seed_fallback',
  });
}

export async function fetchDropoutTrialRegistrySubjects({ trialId, limitCount = 80 } = {}) {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  const supportStatus = await fetchDropoutTrialConfigurationStatus({
    trialId: normalizedTrialId,
    hydrateIfSupported: true,
  });

  if (!normalizedTrialId || supportStatus.status !== 'configured') {
    return {
      subjects: [],
      registry: supportStatus.registry,
      supportStatus,
    };
  }

  const snapshot = await getDocs(
    query(
      collection(db, REGISTRY_COLLECTION, normalizedTrialId, SUBJECTS_SUBCOLLECTION),
      orderBy('subject_id', 'asc'),
      limit(Math.max(1, Number(limitCount) || 80))
    )
  );

  return {
    subjects: snapshot.docs.map((entry) => ({
      subject_id: normalizeText(entry.get('subject_id')),
      trial_id: normalizeDropoutTrialId(entry.get('trial_id')),
      max_day_index: Number(entry.get('max_day_index')) || 0,
    })),
    registry: supportStatus.registry,
    supportStatus,
  };
}

export async function configureProtocolDropoutTrial({ protocolId, trialId } = {}) {
  const normalizedProtocolId = normalizeText(protocolId);
  if (!normalizedProtocolId) {
    throw new Error('A protocol template must exist before configuring a disengagement dataset trial ID.');
  }

  const response = await configureProtocolDropoutTrialCallable({
    protocolId: normalizedProtocolId,
    trialId: normalizeDropoutTrialId(trialId),
  });

  const payload = response.data || {};
  if (payload?.dropout_trial_id) {
    hydratedTrialIds.add(normalizeDropoutTrialId(payload.dropout_trial_id));
  }
  return payload;
}

export async function reconcileProtocolDropoutTrialBinding({ protocolId } = {}) {
  const normalizedProtocolId = normalizeText(protocolId);
  if (!normalizedProtocolId) {
    throw new Error('A protocol template must exist before its disengagement dataset trial can be reconciled.');
  }

  const response = await reconcileProtocolDropoutTrialBindingCallable({
    protocolId: normalizedProtocolId,
  });
  const payload = response.data || {};
  if (payload?.dropout_trial_id) {
    hydratedTrialIds.add(normalizeDropoutTrialId(payload.dropout_trial_id));
  }
  return payload;
}
