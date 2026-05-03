import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    uids: [],
    executeAuth: false,
    executeFirestore: false,
    planPath: '.firebase/delete-target-patient-users-plan.json',
    help: false,
  };

  argv.forEach((entry) => {
    if (entry === '--execute-auth') {
      args.executeAuth = true;
      return;
    }
    if (entry === '--execute-firestore') {
      args.executeFirestore = true;
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
      return;
    }
    if (entry.startsWith('--plan-path=')) {
      args.planPath = entry.slice('--plan-path='.length).trim() || args.planPath;
    }
  });

  return args;
}

function usage() {
  console.log(`Usage:
  node functions/scripts/delete-target-patient-users.mjs --uids=UID1,UID2 [--execute-firestore] [--execute-auth]

Environment:
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Terry Firebase service account path.

Behavior:
  - Default mode is dry-run only.
  - --execute-firestore recursively deletes users/{uid} and nested subcollections.
  - --execute-auth deletes the Firebase Auth users.
  - Recommended destructive order:
    1. --execute-firestore
    2. --execute-auth
`);
}

function ensureDirectoryForFile(filePath) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
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

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  if (!args.uids.length) {
    usage();
    throw new Error('At least one UID is required.');
  }

  const targetServiceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!targetServiceAccountPath) {
    usage();
    throw new Error('TARGET_FIREBASE_SERVICE_ACCOUNT_JSON is required.');
  }

  const app = initApp('delete-target-patient-users', targetServiceAccountPath);
  const auth = app.auth();
  const db = app.firestore();

  const summary = {
    mode: {
      executeAuth: args.executeAuth,
      executeFirestore: args.executeFirestore,
    },
    totalRequested: args.uids.length,
    authDeleted: 0,
    firestoreDeleted: 0,
    rows: [],
  };

  for (const uid of args.uids) {
    const row = {
      uid,
      authExists: false,
      authEmail: null,
      authDeleted: false,
      userDocExists: false,
      userDocDeleted: false,
      errors: [],
    };

    try {
      const authUser = await auth.getUser(uid);
      row.authExists = true;
      row.authEmail = authUser.email || null;
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') {
        row.errors.push(`auth_lookup:${error.code || error.message}`);
      }
    }

    try {
      const userDocRef = db.collection('users').doc(uid);
      const userDoc = await userDocRef.get();
      row.userDocExists = userDoc.exists;

      if (args.executeFirestore && userDoc.exists) {
        await db.recursiveDelete(userDocRef);
        row.userDocDeleted = true;
        summary.firestoreDeleted += 1;
      }
    } catch (error) {
      row.errors.push(`firestore:${error.code || error.message}`);
    }

    try {
      if (args.executeAuth && row.authExists) {
        await auth.deleteUser(uid);
        row.authDeleted = true;
        summary.authDeleted += 1;
      }
    } catch (error) {
      row.errors.push(`auth_delete:${error.code || error.message}`);
    }

    summary.rows.push(row);
  }

  const planPath = ensureDirectoryForFile(args.planPath);
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        planPath,
        summary: {
          ...summary,
          rows: undefined,
        },
      },
      null,
      2
    )
  );

  await app.delete();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
