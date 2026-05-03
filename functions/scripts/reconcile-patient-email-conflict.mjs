import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const DEFAULT_USER_SUBCOLLECTIONS = [
  'appointments',
  'epro_submissions',
  'side_effect_reports',
  'alerts',
  'vitals',
  'web_push_subscriptions',
  'ai_chat_history',
  'active_call',
];

const DEFAULT_ALERT_SUBCOLLECTIONS = ['messages'];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    sourceUid: '',
    targetUid: '',
    execute: false,
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
    if (entry.startsWith('--source-uid=')) {
      args.sourceUid = entry.slice('--source-uid='.length).trim();
      return;
    }
    if (entry.startsWith('--target-uid=')) {
      args.targetUid = entry.slice('--target-uid='.length).trim();
    }
  });

  return args;
}

function usage() {
  console.log(`Usage:
  node functions/scripts/reconcile-patient-email-conflict.mjs --source-uid=OLD_UID --target-uid=NEW_UID [--execute]

Environment:
  SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Old Firebase project service account path.
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Terry Firebase project service account path.

Behavior:
  - Default mode is dry-run and only prints the merge summary
  - --execute merges source patient data into the existing target UID
  - Target Auth user is preserved
  - Source Auth user is not created in Terry
`);
}

function parseList(value, fallback = []) {
  const raw = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return raw.length ? raw : fallback;
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

async function listCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  return snapshot.docs;
}

function cloneData(data = {}) {
  return JSON.parse(JSON.stringify(data));
}

function mergeProfile(sourceProfile = {}, targetProfile = {}, sourceUid = '') {
  const merged = {
    ...sourceProfile,
    ...targetProfile,
  };

  const resolvedSubjectId =
    targetProfile.subject_id ||
    targetProfile.subjectId ||
    sourceProfile.subject_id ||
    sourceProfile.subjectId ||
    null;

  if (resolvedSubjectId) {
    merged.subject_id = resolvedSubjectId;
  }

  const existingAliases = Array.isArray(targetProfile.legacy_uid_aliases)
    ? targetProfile.legacy_uid_aliases
    : [];
  const aliases = Array.from(new Set([...existingAliases, sourceUid].filter(Boolean)));
  if (aliases.length) {
    merged.legacy_uid_aliases = aliases;
  }

  merged.reconciled_from_legacy_uid = sourceUid || targetProfile.reconciled_from_legacy_uid || null;
  merged.reconciled_at = new Date().toISOString();

  return merged;
}

async function copyCollectionDocs(sourceCollectionRef, targetCollectionRef) {
  const docs = await listCollectionDocs(sourceCollectionRef);
  if (!docs.length) {
    return 0;
  }

  let batch = targetCollectionRef.firestore.batch();
  let batchSize = 0;
  let copied = 0;

  for (const docSnapshot of docs) {
    batch.set(targetCollectionRef.doc(docSnapshot.id), cloneData(docSnapshot.data()), { merge: true });
    batchSize += 1;
    copied += 1;

    if (batchSize >= 400) {
      await batch.commit();
      batch = targetCollectionRef.firestore.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return copied;
}

async function copyAlertsNestedDocs(sourceAlertsRef, targetAlertsRef, nestedSubcollections) {
  const alerts = await listCollectionDocs(sourceAlertsRef);
  let copied = 0;

  for (const alertDoc of alerts) {
    for (const nestedName of nestedSubcollections) {
      copied += await copyCollectionDocs(
        alertDoc.ref.collection(nestedName),
        targetAlertsRef.doc(alertDoc.id).collection(nestedName)
      );
    }
  }

  return copied;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  if (!args.sourceUid || !args.targetUid) {
    usage();
    throw new Error('Both --source-uid and --target-uid are required.');
  }

  const sourceServiceAccountPath = process.env.SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const targetServiceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!sourceServiceAccountPath || !targetServiceAccountPath) {
    usage();
    throw new Error('Both SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON and TARGET_FIREBASE_SERVICE_ACCOUNT_JSON are required.');
  }

  const userSubcollections = parseList(
    process.env.PATIENT_FIRESTORE_USER_SUBCOLLECTIONS,
    DEFAULT_USER_SUBCOLLECTIONS
  );
  const alertNestedSubcollections = parseList(
    process.env.PATIENT_FIRESTORE_ALERT_SUBCOLLECTIONS,
    DEFAULT_ALERT_SUBCOLLECTIONS
  );

  const sourceApp = initApp('patient-email-conflict-source', sourceServiceAccountPath);
  const targetApp = initApp('patient-email-conflict-target', targetServiceAccountPath);
  const sourceDb = sourceApp.firestore();
  const targetDb = targetApp.firestore();
  const targetAuth = targetApp.auth();

  const sourceUserDocRef = sourceDb.collection('users').doc(args.sourceUid);
  const targetUserDocRef = targetDb.collection('users').doc(args.targetUid);

  const [sourceUserDoc, targetUserDoc, targetAuthUser] = await Promise.all([
    sourceUserDocRef.get(),
    targetUserDocRef.get(),
    targetAuth.getUser(args.targetUid),
  ]);

  if (!sourceUserDoc.exists) {
    throw new Error(`Source user profile does not exist for UID ${args.sourceUid}.`);
  }
  if (!targetUserDoc.exists) {
    throw new Error(`Target user profile does not exist for UID ${args.targetUid}.`);
  }

  const sourceProfile = sourceUserDoc.data() || {};
  const targetProfile = targetUserDoc.data() || {};

  const summary = {
    execute: args.execute,
    sourceUid: args.sourceUid,
    targetUid: args.targetUid,
    targetEmailMasked: targetAuthUser.email
      ? targetAuthUser.email.replace(/(^.).+(@.*$)/, '$1***$2')
      : null,
    sourceSubjectId: sourceProfile.subject_id || sourceProfile.subjectId || null,
    targetSubjectIdBefore: targetProfile.subject_id || targetProfile.subjectId || null,
    targetSubjectIdAfter:
      targetProfile.subject_id ||
      targetProfile.subjectId ||
      sourceProfile.subject_id ||
      sourceProfile.subjectId ||
      null,
    collections: {},
    copiedNestedDocs: 0,
  };

  for (const subcollectionName of userSubcollections) {
    const [sourceDocs, targetDocs] = await Promise.all([
      listCollectionDocs(sourceUserDocRef.collection(subcollectionName)),
      listCollectionDocs(targetUserDocRef.collection(subcollectionName)),
    ]);
    summary.collections[subcollectionName] = {
      sourceDocCount: sourceDocs.length,
      targetDocCount: targetDocs.length,
    };
  }

  if (args.execute) {
    const mergedProfile = mergeProfile(sourceProfile, targetProfile, args.sourceUid);
    await targetUserDocRef.set(mergedProfile, { merge: true });

    for (const subcollectionName of userSubcollections) {
      summary.copiedNestedDocs += await copyCollectionDocs(
        sourceUserDocRef.collection(subcollectionName),
        targetUserDocRef.collection(subcollectionName)
      );

      if (subcollectionName === 'alerts') {
        summary.copiedNestedDocs += await copyAlertsNestedDocs(
          sourceUserDocRef.collection('alerts'),
          targetUserDocRef.collection('alerts'),
          alertNestedSubcollections
        );
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await Promise.all([sourceApp.delete(), targetApp.delete()]);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
