import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const DEFAULT_ASSIGNMENT_CSV_PATH = path.resolve(
  process.cwd(),
  '..',
  'Patient-Dropout-Prediction',
  'audit',
  'terry_patient_protocol_assignment_gaps_20260503.csv'
);
const PLAN_OUTPUT_PATH = path.resolve(
  process.cwd(),
  '..',
  '.firebase',
  'patient-subject-assignment-sync-plan.json'
);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    csvPath: DEFAULT_ASSIGNMENT_CSV_PATH,
    execute: false,
    help: false,
    uids: [],
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
    if (entry.startsWith('--csv=')) {
      args.csvPath = path.resolve(entry.slice('--csv='.length).trim());
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
  node functions/scripts/sync-patient-subject-assignments.mjs [--execute] [--csv=path] [--uids=uid1,uid2]

Environment:
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. TrialLight Firebase service account path.

Behavior:
  - Default mode is dry-run and writes a plan to .firebase/patient-subject-assignment-sync-plan.json
  - --execute merges curated subject assignment fields into TrialLight users/{uid}
  - Only rows with a concrete subject_id are eligible for writeback
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

function loadAssignmentRows(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Assignment CSV not found: ${csvPath}`);
  }
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    return [];
  }
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((column, index) => {
      row[column] = values[index] ?? '';
    });
    return row;
  });
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  return true;
}

function cloneData(data = {}) {
  return JSON.parse(JSON.stringify(data));
}

function subjectIdFromProfile(profile = {}) {
  return (
    profile.subject_id ||
    profile.subjectId ||
    profile.trial_subject_id ||
    profile.dropout_subject_id ||
    profile.dropoutSubjectId ||
    ''
  );
}

function protocolNameFromProfile(profile = {}) {
  return profile.protocolName || profile.protocol_name || '';
}

function buildPatch(row, currentProfile) {
  const patch = {};
  const subjectId = String(row.subject_id || '').trim();
  const protocolName = String(row.current_protocol_name || '').trim();
  const registryTrialId = String(row.registry_trial_id || '').trim();

  if (subjectId && subjectId !== String(subjectIdFromProfile(currentProfile) || '').trim()) {
    patch.subject_id = subjectId;
    patch.subjectId = subjectId;
  } else if (subjectId && !isPresent(currentProfile.subjectId)) {
    patch.subjectId = subjectId;
  }

  if (protocolName && protocolName !== String(protocolNameFromProfile(currentProfile) || '').trim()) {
    patch.protocolName = protocolName;
  }

  if (registryTrialId && registryTrialId !== String(currentProfile.dropout_registry_trial_id || '').trim()) {
    patch.dropout_registry_trial_id = registryTrialId;
  }

  patch.protocol_assignment_last_synced_at = new Date().toISOString();
  patch.protocol_assignment_sync_source = 'manual_csv_cutover_20260503';

  return patch;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const targetServiceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!targetServiceAccountPath) {
    usage();
    throw new Error('TARGET_FIREBASE_SERVICE_ACCOUNT_JSON is required.');
  }

  const selectedUids = new Set(args.uids.map((value) => String(value).trim()).filter(Boolean));
  const rows = loadAssignmentRows(args.csvPath);
  const app = initApp('patient-subject-assignment-sync', targetServiceAccountPath);
  const db = app.firestore();

  const plan = {
    csvPath: args.csvPath,
    execute: Boolean(args.execute),
    reviewedAt: new Date().toISOString(),
    totalRows: rows.length,
    selectedUidCount: selectedUids.size,
    eligibleRows: 0,
    missingSubjectIdRows: 0,
    missingUserDocs: 0,
    patchableRows: 0,
    rows: [],
  };

  let batch = db.batch();
  let batchSize = 0;

  for (const row of rows) {
    const firebaseUid = String(row.firebase_uid || '').trim();
    if (!firebaseUid) {
      continue;
    }
    if (selectedUids.size && !selectedUids.has(firebaseUid)) {
      continue;
    }
    const subjectId = String(row.subject_id || '').trim();
    if (!subjectId) {
      plan.missingSubjectIdRows += 1;
      plan.rows.push({
        firebase_uid: firebaseUid,
        email: String(row.email || '').trim(),
        status: 'skipped_missing_subject_id',
      });
      continue;
    }

    plan.eligibleRows += 1;
    const userDocRef = db.collection('users').doc(firebaseUid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      plan.missingUserDocs += 1;
      plan.rows.push({
        firebase_uid: firebaseUid,
        email: String(row.email || '').trim(),
        subject_id: subjectId,
        status: 'missing_user_doc',
      });
      continue;
    }

    const currentProfile = cloneData(userDoc.data() || {});
    const patch = buildPatch(row, currentProfile);
    const patchKeys = Object.keys(patch).filter((key) => key !== 'protocol_assignment_last_synced_at' && key !== 'protocol_assignment_sync_source');
    const status = patchKeys.length ? 'will_patch' : 'already_aligned';
    if (patchKeys.length) {
      plan.patchableRows += 1;
      if (args.execute) {
        batch.set(userDocRef, patch, { merge: true });
        batchSize += 1;
        if (batchSize >= 350) {
          await batch.commit();
          batch = db.batch();
          batchSize = 0;
        }
      }
    }

    plan.rows.push({
      firebase_uid: firebaseUid,
      email: String(row.email || '').trim(),
      subject_id: subjectId,
      current_subject_id: String(subjectIdFromProfile(currentProfile) || '').trim(),
      current_protocol_name: String(protocolNameFromProfile(currentProfile) || '').trim(),
      patch,
      status,
    });
  }

  if (args.execute && batchSize > 0) {
    await batch.commit();
  }

  fs.mkdirSync(path.dirname(PLAN_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(PLAN_OUTPUT_PATH, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan, null, 2));

  await app.delete();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
