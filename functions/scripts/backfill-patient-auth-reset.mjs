import crypto from 'node:crypto';
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
const DEFAULT_PLAN_PATH = '.firebase/patient-auth-reset-plan.json';
const DEFAULT_LINK_PATH = '.firebase/patient-password-reset-links.json';
const DEFAULT_RESET_CONTINUE_URL = 'https://traillight.app/patient-login';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    executeAuth: false,
    executeFirestore: false,
    generateResetLinks: false,
    inspectSubcollections: false,
    cleanOnly: false,
    uids: [],
    planPath: DEFAULT_PLAN_PATH,
    linkPath: DEFAULT_LINK_PATH,
    continueUrl: process.env.PATIENT_RESET_CONTINUE_URL || DEFAULT_RESET_CONTINUE_URL,
    noContinueUrl: false,
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
    if (entry === '--generate-reset-links') {
      args.generateResetLinks = true;
      return;
    }
    if (entry === '--inspect-subcollections') {
      args.inspectSubcollections = true;
      return;
    }
    if (entry === '--clean-only') {
      args.cleanOnly = true;
      return;
    }
    if (entry === '--help' || entry === '-h') {
      args.help = true;
      return;
    }
    if (entry === '--no-continue-url') {
      args.noContinueUrl = true;
      args.continueUrl = '';
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
      args.planPath = entry.slice('--plan-path='.length).trim() || DEFAULT_PLAN_PATH;
      return;
    }
    if (entry.startsWith('--link-path=')) {
      args.linkPath = entry.slice('--link-path='.length).trim() || DEFAULT_LINK_PATH;
      return;
    }
    if (entry.startsWith('--continue-url=')) {
      args.continueUrl = entry.slice('--continue-url='.length).trim() || DEFAULT_RESET_CONTINUE_URL;
    }
  });

  return args;
}

function usage() {
  console.log(`Usage:
  node functions/scripts/backfill-patient-auth-reset.mjs [options]

Options:
  --execute-auth             Create missing Firebase Auth users in the target project.
  --execute-firestore        Copy missing patient Firestore profile/subcollection data for targeted UIDs.
  --generate-reset-links     Generate password reset links for target-side patient accounts.
  --inspect-subcollections   Count source-side patient subcollection docs in the dry-run plan.
  --clean-only               Skip accounts that require manual review before writing.
  --no-continue-url          Generate password reset links without a continue URL.
  --uids=UID1,UID2           Restrict the run to specific Firebase UIDs.
  --plan-path=PATH           Write the migration plan JSON to PATH.
  --link-path=PATH           Write the password reset link JSON to PATH.
  --continue-url=URL         Continue URL embedded in reset links.

Environment:
  SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Old Firebase project service account path.
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Terry Firebase project service account path.
  PATIENT_RESET_CONTINUE_URL             Optional. Default continue URL for reset links.

Behavior:
  - Default mode is dry-run and does not write to Auth or Firestore.
  - Auth users are created with the same UID plus a random temporary password.
  - Reset links are generated separately so patients can set a new password.
  - Firestore copy is limited to users/{uid} plus selected patient subcollections.
`);
}

function parseList(value, fallback = []) {
  const raw = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return raw.length ? raw : fallback;
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

async function listAllUsers(auth) {
  const users = [];
  let nextPageToken;

  do {
    const page = await auth.listUsers(1000, nextPageToken);
    users.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return users;
}

function maskEmail(email = '') {
  const normalized = String(email || '').trim();
  if (!normalized.includes('@')) {
    return normalized;
  }
  const [local, domain] = normalized.split('@');
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

function createTempPassword() {
  return `${crypto.randomBytes(24).toString('base64url')}Aa1!`;
}

async function getDocInfo(docRef) {
  const snapshot = await docRef.get();
  return {
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() : null,
  };
}

async function countCollectionDocs(collectionRef) {
  const snapshot = await collectionRef.get();
  return snapshot.size;
}

async function inspectSourceUserCollections(sourceUserRef, subcollections, alertNestedSubcollections) {
  const result = {};

  for (const subcollectionName of subcollections) {
    const subcollectionRef = sourceUserRef.collection(subcollectionName);
    const subcollectionSnapshot = await subcollectionRef.get();
    const subcollectionInfo = { docCount: subcollectionSnapshot.size };

    if (subcollectionName === 'alerts' && subcollectionSnapshot.size) {
      subcollectionInfo.nested = {};
      for (const alertDoc of subcollectionSnapshot.docs) {
        for (const nestedName of alertNestedSubcollections) {
          const nestedCount = await countCollectionDocs(alertDoc.ref.collection(nestedName));
          subcollectionInfo.nested[nestedName] =
            (subcollectionInfo.nested[nestedName] || 0) + nestedCount;
        }
      }
    }

    result[subcollectionName] = subcollectionInfo;
  }

  return result;
}

async function copyCollectionDocs(sourceCollectionRef, targetCollectionRef) {
  const snapshot = await sourceCollectionRef.get();
  if (snapshot.empty) {
    return 0;
  }

  let batch = targetCollectionRef.firestore.batch();
  let batchSize = 0;
  let copied = 0;

  for (const docSnapshot of snapshot.docs) {
    batch.set(targetCollectionRef.doc(docSnapshot.id), JSON.parse(JSON.stringify(docSnapshot.data())), {
      merge: true,
    });
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

async function copyAlertNestedDocs(sourceAlertDocRef, targetAlertDocRef, nestedSubcollections) {
  let copied = 0;
  for (const nestedName of nestedSubcollections) {
    copied += await copyCollectionDocs(sourceAlertDocRef.collection(nestedName), targetAlertDocRef.collection(nestedName));
  }
  return copied;
}

function buildActionCodeSettings(continueUrl) {
  if (!continueUrl) {
    return undefined;
  }
  return {
    url: continueUrl,
    handleCodeInApp: false,
  };
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

  const userSubcollections = parseList(
    process.env.PATIENT_FIRESTORE_USER_SUBCOLLECTIONS,
    DEFAULT_USER_SUBCOLLECTIONS
  );
  const alertNestedSubcollections = parseList(
    process.env.PATIENT_FIRESTORE_ALERT_SUBCOLLECTIONS,
    DEFAULT_ALERT_SUBCOLLECTIONS
  );

  const sourceApp = initApp('patient-auth-reset-source', sourceServiceAccountPath);
  const targetApp = initApp('patient-auth-reset-target', targetServiceAccountPath);
  const sourceAuth = sourceApp.auth();
  const targetAuth = targetApp.auth();
  const sourceDb = sourceApp.firestore();
  const targetDb = targetApp.firestore();

  const [sourceUsers, targetUsers] = await Promise.all([listAllUsers(sourceAuth), listAllUsers(targetAuth)]);
  const targetUsersByUid = new Map(targetUsers.map((user) => [user.uid, user]));
  const targetUsersByEmail = new Map(
    targetUsers
      .filter((user) => user.email)
      .map((user) => [String(user.email).trim().toLowerCase(), user])
  );

  const filteredSourceUsers = args.uids.length
    ? sourceUsers.filter((user) => args.uids.includes(user.uid))
    : sourceUsers;

  const migrationPlan = [];
  const resetLinks = [];
  const summary = {
    mode: {
      executeAuth: args.executeAuth,
      executeFirestore: args.executeFirestore,
      generateResetLinks: args.generateResetLinks,
      inspectSubcollections: args.inspectSubcollections,
      cleanOnly: args.cleanOnly,
      noContinueUrl: args.noContinueUrl,
    },
    sourceAuthUsers: sourceUsers.length,
    targetAuthUsers: targetUsers.length,
    scopedSourceUsers: filteredSourceUsers.length,
    missingAuthUsers: 0,
    skippedAuthUsers: 0,
    firestoreCopyCandidates: 0,
    authUsersCreated: 0,
    firestoreProfilesCopied: 0,
    firestoreNestedDocsCopied: 0,
    resetLinksGenerated: 0,
    conflicts: [],
  };

  for (const sourceUser of filteredSourceUsers) {
    if (!sourceUser.email || String(sourceUser.email).trim().toLowerCase().endsWith('@hospital.com')) {
      summary.skippedAuthUsers += 1;
      continue;
    }

    const sourceEmailKey = String(sourceUser.email).trim().toLowerCase();
    const targetByUid = targetUsersByUid.get(sourceUser.uid) || null;
    const targetByEmail = targetUsersByEmail.get(sourceEmailKey) || null;
    const hasUidMismatch = targetByEmail && targetByEmail.uid !== sourceUser.uid;

    const sourceUserDocRef = sourceDb.collection('users').doc(sourceUser.uid);
    const targetUserDocRef = targetDb.collection('users').doc(sourceUser.uid);
    const [sourceUserDoc, targetUserDoc] = await Promise.all([
      getDocInfo(sourceUserDocRef),
      getDocInfo(targetUserDocRef),
    ]);

    const planEntry = {
      uid: sourceUser.uid,
      emailMasked: maskEmail(sourceUser.email),
      email: sourceUser.email,
      sourceAuthPresent: true,
      targetAuthPresent: Boolean(targetByUid),
      targetAuthUidMatchesEmail: targetByEmail ? targetByEmail.uid : null,
      emailCollision: hasUidMismatch,
      sourceDisabled: Boolean(sourceUser.disabled),
      sourceEmailVerified: Boolean(sourceUser.emailVerified),
      sourceDisplayName: sourceUser.displayName || '',
      sourcePhoneNumber: sourceUser.phoneNumber || '',
      sourcePhotoURL: sourceUser.photoURL || '',
      sourceCustomClaims: sourceUser.customClaims || null,
      sourceUserDocExists: sourceUserDoc.exists,
      targetUserDocExists: targetUserDoc.exists,
      sourceRole: sourceUserDoc.data?.role || null,
      sourceSubjectId:
        sourceUserDoc.data?.subject_id ||
        sourceUserDoc.data?.subjectId ||
        sourceUserDoc.data?.trial_subject_id ||
        sourceUserDoc.data?.trialSubjectId ||
        null,
      plannedActions: [],
    };

    if (!sourceUserDoc.exists) {
      planEntry.plannedActions.push('manual_source_profile_review');
    } else if (!planEntry.sourceSubjectId) {
      planEntry.plannedActions.push('manual_subject_id_review');
    }

    if (!targetByUid) {
      summary.missingAuthUsers += 1;
      if (hasUidMismatch) {
        planEntry.plannedActions.push('manual_email_conflict_review');
        summary.conflicts.push({
          uid: sourceUser.uid,
          emailMasked: planEntry.emailMasked,
          targetUidWithSameEmail: targetByEmail.uid,
        });
      } else {
        planEntry.plannedActions.push('create_target_auth_user_same_uid');
      }
    }

    if (!targetUserDoc.exists && sourceUserDoc.exists) {
      summary.firestoreCopyCandidates += 1;
      planEntry.plannedActions.push('copy_users_uid_profile');
    }

    if (args.inspectSubcollections && sourceUserDoc.exists) {
      planEntry.sourceSubcollections = await inspectSourceUserCollections(
        sourceUserDocRef,
        userSubcollections,
        alertNestedSubcollections
      );
    }

    const requiresManualReview =
      planEntry.emailCollision ||
      planEntry.plannedActions.some((action) => action.startsWith('manual_'));

    if (args.cleanOnly && requiresManualReview) {
      migrationPlan.push(planEntry);
      continue;
    }

    if (args.executeAuth && !targetByUid && !hasUidMismatch) {
      const tempPassword = createTempPassword();
      await targetAuth.createUser({
        uid: sourceUser.uid,
        email: sourceUser.email,
        emailVerified: sourceUser.emailVerified,
        displayName: sourceUser.displayName || undefined,
        phoneNumber: sourceUser.phoneNumber || undefined,
        photoURL: sourceUser.photoURL || undefined,
        disabled: sourceUser.disabled,
        password: tempPassword,
      });
      if (sourceUser.customClaims && Object.keys(sourceUser.customClaims).length) {
        await targetAuth.setCustomUserClaims(sourceUser.uid, sourceUser.customClaims);
      }
      summary.authUsersCreated += 1;
    }

    if (args.executeFirestore && sourceUserDoc.exists) {
      await targetUserDocRef.set(JSON.parse(JSON.stringify(sourceUserDoc.data)), { merge: true });
      summary.firestoreProfilesCopied += 1;

      for (const subcollectionName of userSubcollections) {
        const copied = await copyCollectionDocs(
          sourceUserDocRef.collection(subcollectionName),
          targetUserDocRef.collection(subcollectionName)
        );
        summary.firestoreNestedDocsCopied += copied;

        if (subcollectionName === 'alerts' && copied > 0) {
          const sourceAlertsSnapshot = await sourceUserDocRef.collection('alerts').get();
          for (const sourceAlertDoc of sourceAlertsSnapshot.docs) {
            const targetAlertDocRef = targetUserDocRef.collection('alerts').doc(sourceAlertDoc.id);
            summary.firestoreNestedDocsCopied += await copyAlertNestedDocs(
              sourceAlertDoc.ref,
              targetAlertDocRef,
              alertNestedSubcollections
            );
          }
        }
      }
    }

    if (args.generateResetLinks && sourceUser.email && !hasUidMismatch) {
      const actionCodeSettings = buildActionCodeSettings(args.continueUrl);
      const link = actionCodeSettings
        ? await targetAuth.generatePasswordResetLink(sourceUser.email, actionCodeSettings)
        : await targetAuth.generatePasswordResetLink(sourceUser.email);
      resetLinks.push({
        uid: sourceUser.uid,
        email: sourceUser.email,
        emailMasked: planEntry.emailMasked,
        resetLink: link,
      });
      summary.resetLinksGenerated += 1;
    }

    migrationPlan.push(planEntry);
  }

  const planPath = ensureDirectoryForFile(args.planPath);
  fs.writeFileSync(
    planPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        migrationPlan,
      },
      null,
      2
    )
  );

  if (args.generateResetLinks) {
    const linkPath = ensureDirectoryForFile(args.linkPath);
    fs.writeFileSync(
      linkPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          continueUrl: args.continueUrl,
          resetLinks,
        },
        null,
        2
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        planPath,
        linkPath: args.generateResetLinks ? path.resolve(args.linkPath) : null,
        summary,
      },
      null,
      2
    )
  );

  await Promise.all([sourceApp.delete(), targetApp.delete()]);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
