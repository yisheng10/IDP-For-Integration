import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const PLAN_OUTPUT_PATH = path.resolve(process.cwd(), '..', '.firebase', 'patient-static-context-backfill-plan.json');
const DEFAULT_REGISTRY_PATH = path.resolve(
  process.cwd(),
  '..',
  'Patient-Dropout-Prediction',
  'deploy_assets',
  'data',
  'triallight_subject_context_registry_v35subjectid.csv'
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    execute: false,
    uids: [],
    help: false,
  };

  argv.forEach((entry) => {
    if (entry === '--execute') {
      args.execute = true;
      return;
    }
    if (entry === '--help' || entry === '-h') {
      args.help = true;
      return;
    }
    if (entry.startsWith('--uids=')) {
      args.uids = entry
        .slice('--uids='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
  });

  return args;
}

function usage() {
  console.log(`Usage:
  node functions/scripts/backfill-patient-static-context.mjs [--execute] [--uids=uid1,uid2]

Environment:
  SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Legacy Firebase project service account path.
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Terry Firebase project service account path.

Behavior:
  - Default mode is dry-run and writes a plan file to .firebase/patient-static-context-backfill-plan.json
  - --execute merges safe patient static-context fields into Terry users/{uid}
  - Source preference is same UID, then legacy_uid_aliases, then reconciled_from_legacy_uid
`);
}

function loadServiceAccount(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function initApp(name, serviceAccountPath) {
  return admin.initializeApp(
    {
      credential: admin.credential.cert(loadServiceAccount(serviceAccountPath)),
    },
    name
  );
}

function cloneData(data = {}) {
  return JSON.parse(JSON.stringify(data));
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  return true;
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBinary(value) {
  if (!isPresent(value)) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'present', 'has', 'supported'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'none', 'absent', 'unsupported'].includes(text)) return false;
  return null;
}

function normalizeNumber(value) {
  if (!isPresent(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeDob(value) {
  if (!isPresent(value)) return null;
  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let insideQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const nextChar = line[index + 1];
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === ',' && !insideQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function loadSubjectRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  if (!fs.existsSync(registryPath)) {
    return new Map();
  }
  const raw = fs.readFileSync(registryPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    return new Map();
  }
  const header = parseCsvLine(lines[0]);
  const entries = new Map();
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((column, index) => {
      row[column] = values[index] ?? '';
    });
    const subjectId = String(row.subject_id || '').trim();
    if (subjectId) {
      entries.set(subjectId, row);
    }
  }
  return entries;
}

function subjectIdFromProfile(profile = {}) {
  return (
    profile.subject_id ||
    profile.subjectId ||
    profile.trial_subject_id ||
    profile.dropout_subject_id ||
    null
  );
}

function distanceFromProfile(profile = {}) {
  return (
    normalizeNumber(profile.distance_to_site_km) ??
    normalizeNumber(profile.distanceToSiteKm) ??
    normalizeNumber(profile.dist_km) ??
    null
  );
}

function caregiverFromProfile(profile = {}) {
  return (
    normalizeBinary(profile.caregiver_support) ??
    normalizeBinary(profile.caregiverSupport) ??
    normalizeBinary(profile.caregiver) ??
    null
  );
}

function dobFromProfile(profile = {}) {
  return (
    normalizeDob(profile.dob) ??
    normalizeDob(profile.date_of_birth) ??
    normalizeDob(profile.dateOfBirth) ??
    null
  );
}

function candidateSourceUids(uid, targetProfile = {}) {
  const values = [
    uid,
    targetProfile.reconciled_from_legacy_uid,
    ...(Array.isArray(targetProfile.legacy_uid_aliases) ? targetProfile.legacy_uid_aliases : []),
  ];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function protocolDocVariants(protocolId, protocol = {}) {
  const rawValues = [
    protocolId,
    protocol.name,
    protocol.protocol_name,
    protocol.dropout_trial_id,
    protocol.trial_id,
    protocol.legacy_trial_id,
    protocol.title,
    protocol.fileName,
    protocol.filename,
    protocol.storagePath,
    path.basename(String(protocol.storagePath || '')),
  ];
  return Array.from(new Set(rawValues.map(normalizeKey).filter(Boolean)));
}

async function loadProtocols(targetDb) {
  const snapshot = await targetDb.collection('protocols').get();
  const byId = new Map();
  const byVariant = new Map();

  snapshot.forEach((docSnapshot) => {
    const data = docSnapshot.data() || {};
    const record = { id: docSnapshot.id, ...cloneData(data) };
    byId.set(docSnapshot.id, record);
    for (const variant of protocolDocVariants(docSnapshot.id, record)) {
      const existing = byVariant.get(variant) || [];
      existing.push(record);
      byVariant.set(variant, existing);
    }
  });

  return { byId, byVariant };
}

function resolveProtocol(protocolIndexes, protocolIdValue, protocolNameValue) {
  const protocolId = String(protocolIdValue || '').trim();
  if (protocolId && protocolIndexes.byId.has(protocolId)) {
    return protocolIndexes.byId.get(protocolId);
  }

  const variants = [protocolNameValue, protocolIdValue].map(normalizeKey).filter(Boolean);
  for (const variant of variants) {
    const matches = protocolIndexes.byVariant.get(variant) || [];
    if (matches.length === 1) {
      return matches[0];
    }
  }
  return null;
}

async function findSourceProfile(sourceDb, uid, targetProfile = {}) {
  const triedUids = candidateSourceUids(uid, targetProfile);

  for (const candidateUid of triedUids) {
    const snapshot = await sourceDb.collection('users').doc(candidateUid).get();
    if (snapshot.exists) {
      return {
        sourceUid: candidateUid,
        sourceProfile: snapshot.data() || {},
        lookupStrategy: candidateUid === uid ? 'same_uid' : 'legacy_uid_alias',
      };
    }
  }

  const email = String(targetProfile.email || '').trim().toLowerCase();
  if (!email) {
    return { sourceUid: null, sourceProfile: null, lookupStrategy: 'not_found' };
  }

  const emailSnapshot = await sourceDb.collection('users').where('email', '==', email).limit(2).get();
  if (emailSnapshot.empty) {
    return { sourceUid: null, sourceProfile: null, lookupStrategy: 'not_found' };
  }
  if (emailSnapshot.size > 1) {
    return { sourceUid: null, sourceProfile: null, lookupStrategy: 'ambiguous_email_match' };
  }

  const match = emailSnapshot.docs[0];
  return {
    sourceUid: match.id,
    sourceProfile: match.data() || {},
    lookupStrategy: 'email_match',
  };
}

function registryAge(row = {}) {
  return normalizeNumber(row.age);
}

function registryCaregiver(row = {}) {
  return normalizeNumber(row.caregiver);
}

function registryDistance(row = {}) {
  return normalizeNumber(row.dist_km);
}

function registryTrialId(row = {}) {
  return String(row.trial_id || row.legacy_trial_id || '').trim();
}

function planForUser(uid, targetProfile, sourceResolution, protocolIndexes, registryRow = null) {
  const sourceProfile = sourceResolution.sourceProfile || {};
  const targetProtocolId = String(targetProfile.protocolId || '').trim();
  const sourceProtocolId = String(sourceProfile.protocolId || '').trim();
  const targetProtocolName = String(targetProfile.protocolName || '').trim();
  const sourceProtocolName = String(sourceProfile.protocolName || '').trim();
  const registryProtocolTrialId = registryTrialId(registryRow || {});

  const targetProtocol =
    resolveProtocol(protocolIndexes, targetProtocolId, targetProtocolName) ||
    resolveProtocol(protocolIndexes, sourceProtocolId, sourceProtocolName) ||
    resolveProtocol(protocolIndexes, registryProtocolTrialId, registryProtocolTrialId);

  const patch = {};
  const reasons = [];

  const subjectId = String(subjectIdFromProfile(targetProfile) || subjectIdFromProfile(sourceProfile) || '').trim();
  if (!isPresent(targetProfile.subject_id) && !isPresent(targetProfile.subjectId) && subjectId) {
    patch.subject_id = subjectId;
    reasons.push('filled subject_id from source');
  }

  const dob = dobFromProfile(targetProfile) ?? dobFromProfile(sourceProfile);
  if (!isPresent(targetProfile.dob) && dob) {
    patch.dob = dob;
    reasons.push('filled dob from source');
  }

  const targetAge = normalizeNumber(targetProfile.age);
  const resolvedAge = targetAge ?? registryAge(registryRow || {});
  if (targetAge === null && resolvedAge !== null) {
    patch.age = resolvedAge;
    reasons.push('filled age from subject registry');
  }

  const caregiver = caregiverFromProfile(targetProfile);
  const resolvedCaregiver = caregiver ?? caregiverFromProfile(sourceProfile) ?? registryCaregiver(registryRow || {});
  if (caregiver === null && resolvedCaregiver !== null) {
    patch.caregiver = resolvedCaregiver;
    reasons.push('filled caregiver from source/registry alias field');
  }

  const distance = distanceFromProfile(targetProfile);
  const resolvedDistance = distance ?? distanceFromProfile(sourceProfile) ?? registryDistance(registryRow || {});
  if (distance === null && resolvedDistance !== null) {
    patch.dist_km = resolvedDistance;
    reasons.push('filled dist_km from source/registry alias field');
  }

  if (!targetProtocolId && targetProtocol?.id) {
    patch.protocolId = targetProtocol.id;
    reasons.push('filled protocolId from source or protocol-name match');
  }

  if (!targetProtocolName) {
    if (targetProtocol?.name) {
      patch.protocolName = String(targetProtocol.name);
      reasons.push('filled protocolName from Terry protocol doc');
    } else if (sourceProtocolName) {
      patch.protocolName = sourceProtocolName;
      reasons.push('filled protocolName from source');
    }
  }

  const unresolved = [];
  if (!subjectId) unresolved.push('subject_id');
  if (!(dob || resolvedAge !== null)) unresolved.push('age_or_dob');
  if (resolvedCaregiver === null) unresolved.push('caregiver_support');
  if (resolvedDistance === null) unresolved.push('distance_to_site_km');
  if (!(targetProtocolId || patch.protocolId || targetProtocol?.id)) unresolved.push('protocolId');
  if (!(targetProtocolName || patch.protocolName || targetProtocol?.name)) unresolved.push('protocolName');

  return {
    uid,
    email: String(targetProfile.email || '').trim() || null,
    sourceUid: sourceResolution.sourceUid,
    lookupStrategy: sourceResolution.lookupStrategy,
    patch,
    reasons,
    unresolved,
    targetSnapshot: {
      subject_id: subjectIdFromProfile(targetProfile) || null,
      dob: targetProfile.dob || null,
      age: targetProfile.age ?? null,
      caregiver_support: targetProfile.caregiver_support ?? targetProfile.caregiver ?? null,
      distance_to_site_km: targetProfile.distance_to_site_km ?? targetProfile.dist_km ?? null,
      protocolId: targetProtocolId || null,
      protocolName: targetProtocolName || null,
    },
    sourceSnapshot: sourceResolution.sourceProfile
      ? {
          subject_id: subjectIdFromProfile(sourceProfile) || null,
          dob: sourceProfile.dob || sourceProfile.date_of_birth || sourceProfile.dateOfBirth || null,
          age: sourceProfile.age ?? null,
          caregiver_support:
            sourceProfile.caregiver_support ?? sourceProfile.caregiverSupport ?? sourceProfile.caregiver ?? null,
          distance_to_site_km:
            sourceProfile.distance_to_site_km ??
            sourceProfile.distanceToSiteKm ??
            sourceProfile.dist_km ??
            null,
          protocolId: sourceProtocolId || null,
          protocolName: sourceProtocolName || null,
        }
      : null,
    registrySnapshot: registryRow
      ? {
          subject_id: String(registryRow.subject_id || '').trim() || null,
          trial_id: registryProtocolTrialId || null,
          age: registryAge(registryRow),
          caregiver: registryCaregiver(registryRow),
          dist_km: registryDistance(registryRow),
        }
      : null,
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const sourceServiceAccountPath = process.env.SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const targetServiceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!sourceServiceAccountPath || !targetServiceAccountPath) {
    usage();
    throw new Error('Both SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON and TARGET_FIREBASE_SERVICE_ACCOUNT_JSON are required.');
  }

  const sourceApp = initApp('patient-static-context-source', sourceServiceAccountPath);
  const targetApp = initApp('patient-static-context-target', targetServiceAccountPath);
  const sourceDb = sourceApp.firestore();
  const targetDb = targetApp.firestore();
  const registryBySubjectId = loadSubjectRegistry();

  const [protocolIndexes, targetUsersSnapshot] = await Promise.all([
    loadProtocols(targetDb),
    targetDb.collection('users').get(),
  ]);

  const targetDocs = targetUsersSnapshot.docs.filter((docSnapshot) => {
    if (!args.uids.length) return true;
    return args.uids.includes(docSnapshot.id);
  });

  const planEntries = [];
  const executionEntries = [];

  for (const docSnapshot of targetDocs) {
    const targetProfile = docSnapshot.data() || {};
    const sourceResolution = await findSourceProfile(sourceDb, docSnapshot.id, targetProfile);
    const resolvedSubjectId = String(
      subjectIdFromProfile(targetProfile) || subjectIdFromProfile(sourceResolution.sourceProfile || {}) || ''
    ).trim();
    const registryRow = resolvedSubjectId ? registryBySubjectId.get(resolvedSubjectId) || null : null;
    const plan = planForUser(docSnapshot.id, targetProfile, sourceResolution, protocolIndexes, registryRow);
    if (Object.keys(plan.patch).length > 0) {
      executionEntries.push(plan);
    }
    planEntries.push(plan);
  }

  const summary = {
    execute: args.execute,
    totalTargetUsers: targetDocs.length,
    totalWithPatch: executionEntries.length,
    totalWithoutPatch: targetDocs.length - executionEntries.length,
    totalUnresolvedUsers: planEntries.filter((entry) => entry.unresolved.length > 0).length,
    entries: planEntries,
  };

  ensureParentDir(PLAN_OUTPUT_PATH);
  fs.writeFileSync(PLAN_OUTPUT_PATH, JSON.stringify(summary, null, 2), 'utf8');

  if (args.execute && executionEntries.length > 0) {
    let batch = targetDb.batch();
    let batchSize = 0;
    for (const entry of executionEntries) {
      batch.set(targetDb.collection('users').doc(entry.uid), entry.patch, { merge: true });
      batchSize += 1;
      if (batchSize >= 400) {
        await batch.commit();
        batch = targetDb.batch();
        batchSize = 0;
      }
    }
    if (batchSize > 0) {
      await batch.commit();
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Plan file: ${PLAN_OUTPUT_PATH}`);

  await Promise.all([sourceApp.delete(), targetApp.delete()]);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
