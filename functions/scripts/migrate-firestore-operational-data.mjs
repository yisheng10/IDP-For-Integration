import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

const DEFAULT_COLLECTIONS = [
  'users',
  'protocols',
  'incident_records',
  'alerts',
  'dashboard_summaries',
];

const DEFAULT_USER_SUBCOLLECTIONS = [
  'appointments',
  'epro_submissions',
  'side_effect_reports',
  'alerts',
  'web_push_subscriptions',
  'vitals',
];

const DEFAULT_ALERT_SUBCOLLECTIONS = ['messages'];

function parseList(value, fallback) {
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
  if (!serviceAccountPath) {
    throw new Error(`Missing required service account path for ${name}.`);
  }
  return admin.initializeApp(
    {
      credential: admin.credential.cert(loadServiceAccount(serviceAccountPath)),
    },
    name
  );
}

function usage() {
  console.log(`Usage:
  node functions/scripts/migrate-firestore-operational-data.mjs [--execute]

Environment:
  SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Source project service account path.
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Target project service account path.
  FIRESTORE_MIGRATION_COLLECTIONS        Optional comma-separated top-level collections.
  FIRESTORE_MIGRATION_USER_SUBCOLLECTIONS Optional comma-separated users/* subcollections.
  FIRESTORE_MIGRATION_ALERT_SUBCOLLECTIONS Optional comma-separated alerts/* subcollections.

Behavior:
  - Default mode is dry-run
  - Use --execute to write into the target project
  - Existing destination docs are overwritten with the same document IDs
  - No source documents are deleted
`);
}

function isExecuteMode() {
  return process.argv.includes('--execute');
}

function shouldShowHelp() {
  return process.argv.includes('--help') || process.argv.includes('-h');
}

async function listDocuments(collectionRef) {
  const snapshot = await collectionRef.get();
  return snapshot.docs;
}

function cloneData(data = {}) {
  return JSON.parse(JSON.stringify(data));
}

async function copyCollection({
  sourceDb,
  targetDb,
  collectionName,
  execute,
  summary,
  nestedConfig,
}) {
  const sourceCollection = sourceDb.collection(collectionName);
  const docs = await listDocuments(sourceCollection);
  summary.collections[collectionName] = {
    docCount: docs.length,
    nestedWrites: 0,
  };

  for (const sourceDoc of docs) {
    const targetRef = targetDb.collection(collectionName).doc(sourceDoc.id);
    summary.totalDocs += 1;

    if (execute) {
      await targetRef.set(cloneData(sourceDoc.data()), { merge: true });
    }

    const nestedSubcollections = nestedConfig[collectionName] || [];
    for (const subcollectionName of nestedSubcollections) {
      const nestedDocs = await listDocuments(sourceDoc.ref.collection(subcollectionName));
      summary.collections[collectionName].nestedWrites += nestedDocs.length;
      summary.totalNestedDocs += nestedDocs.length;

      if (!execute || nestedDocs.length === 0) {
        continue;
      }

      let batch = targetDb.batch();
      let batchSize = 0;

      for (const nestedDoc of nestedDocs) {
        const targetNestedRef = targetRef.collection(subcollectionName).doc(nestedDoc.id);
        batch.set(targetNestedRef, cloneData(nestedDoc.data()), { merge: true });
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
  }
}

async function main() {
  if (shouldShowHelp()) {
    usage();
    return;
  }

  const execute = isExecuteMode();
  const sourceServiceAccountPath = process.env.SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  const targetServiceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';

  if (!sourceServiceAccountPath || !targetServiceAccountPath) {
    usage();
    throw new Error('Both SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON and TARGET_FIREBASE_SERVICE_ACCOUNT_JSON are required.');
  }

  const collections = parseList(process.env.FIRESTORE_MIGRATION_COLLECTIONS, DEFAULT_COLLECTIONS);
  const nestedConfig = {
    users: parseList(process.env.FIRESTORE_MIGRATION_USER_SUBCOLLECTIONS, DEFAULT_USER_SUBCOLLECTIONS),
    alerts: parseList(process.env.FIRESTORE_MIGRATION_ALERT_SUBCOLLECTIONS, DEFAULT_ALERT_SUBCOLLECTIONS),
  };

  const sourceApp = initApp('firestore-migration-source', sourceServiceAccountPath);
  const targetApp = initApp('firestore-migration-target', targetServiceAccountPath);

  const sourceDb = sourceApp.firestore();
  const targetDb = targetApp.firestore();

  const summary = {
    mode: execute ? 'execute' : 'dry-run',
    collections: {},
    totalDocs: 0,
    totalNestedDocs: 0,
  };

  for (const collectionName of collections) {
    await copyCollection({
      sourceDb,
      targetDb,
      collectionName,
      execute,
      summary,
      nestedConfig,
    });
  }

  console.log(JSON.stringify(summary, null, 2));

  await Promise.all([sourceApp.delete(), targetApp.delete()]);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
