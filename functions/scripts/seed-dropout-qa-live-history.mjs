#!/usr/bin/env node

import fs from 'node:fs';
import admin from 'firebase-admin';

const SCENARIOS = new Set(['low', 'medium', 'high']);
const QA_SOURCE = 'qa_dropout_seed_v1';
const REQUIRED_FIREBASE_PROJECT_ID = 'traillight-4750b';

function parseArgs(argv) {
  const args = {
    apply: false,
    days: 7,
    scenario: 'high',
    patchPatientStatic: false,
    patchProtocolAnchor: false,
  };

  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--patch-patient-static') {
      args.patchPatientStatic = true;
      continue;
    }
    if (arg === '--patch-protocol-anchor') {
      args.patchProtocolAnchor = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      args[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
  }

  args.days = Number(args.days || 7);
  return args;
}

function validateArgs(args) {
  if (!args.uid) {
    throw new Error('Missing --uid=<firebase patient uid>. This script never scans Firestore for patients.');
  }
  if (!SCENARIOS.has(args.scenario)) {
    throw new Error(`Invalid --scenario. Expected one of: ${Array.from(SCENARIOS).join(', ')}`);
  }
  if (!Number.isInteger(args.days) || args.days < 5 || args.days > 14) {
    throw new Error('Invalid --days. Use an integer from 5 to 14. For QA scoring, use 5-7 days.');
  }
}

function initAdmin() {
  if (admin.apps.length) return;

  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const targetServiceAccountPath = String(process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  let parsed = null;

  if (serviceAccountJson) {
    parsed = JSON.parse(serviceAccountJson);
  } else if (targetServiceAccountPath) {
    parsed = JSON.parse(fs.readFileSync(targetServiceAccountPath, 'utf8'));
  }

  if (!parsed || parsed.type !== 'service_account') {
    throw new Error(
      'Seed requires FIREBASE_SERVICE_ACCOUNT_JSON or TARGET_FIREBASE_SERVICE_ACCOUNT_JSON. Application default credentials are intentionally disabled.'
    );
  }
  if (String(parsed.project_id || '').trim() !== REQUIRED_FIREBASE_PROJECT_ID) {
    throw new Error(
      `Seed refused to run against project "${parsed.project_id || 'unknown'}". Only ${REQUIRED_FIREBASE_PROJECT_ID} is allowed.`
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(parsed),
    projectId: REQUIRED_FIREBASE_PROJECT_ID,
  });
}

function dateOnlyInMalaysia(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function subtractDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - days);
  return utc.toISOString().slice(0, 10);
}

function malaysiaTimestamp(dateString, hour, minute = 0) {
  return admin.firestore.Timestamp.fromDate(new Date(`${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`));
}

function malaysiaIso(dateString, hour, minute = 0) {
  return new Date(`${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).toISOString();
}

function uidSlug(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function baseMeta(args, dayIndex = null) {
  return {
    qa_seed: true,
    qa_source: QA_SOURCE,
    qa_scenario: args.scenario,
    ...(dayIndex == null ? {} : { qa_day_index: dayIndex }),
  };
}

function scenarioVitals(scenario, dayIndex, days) {
  if (scenario === 'low') {
    return {
      temperature: 36.7,
      spo2: 98,
      bpSys: 118,
      bpDia: 76,
      heartRate: 72,
      respRate: 16,
    };
  }
  if (scenario === 'medium') {
    return {
      temperature: dayIndex >= days - 2 ? 37.6 : 36.9,
      spo2: dayIndex >= days - 2 ? 94 : 97,
      bpSys: dayIndex >= days - 2 ? 138 : 126,
      bpDia: dayIndex >= days - 2 ? 88 : 80,
      heartRate: dayIndex >= days - 2 ? 94 : 78,
      respRate: dayIndex >= days - 2 ? 20 : 17,
    };
  }
  return {
    temperature: dayIndex >= days - 2 ? 39.1 : 37.3,
    spo2: dayIndex >= days - 2 ? 89 : 93,
    bpSys: dayIndex >= days - 2 ? 152 : 140,
    bpDia: dayIndex >= days - 2 ? 96 : 88,
    heartRate: dayIndex >= days - 2 ? 116 : 98,
    respRate: dayIndex >= days - 2 ? 26 : 21,
  };
}

function eproForScenario(scenario, dayIndex, days) {
  if (scenario === 'low') {
    return {
      status: 'submitted',
      pain_score: dayIndex % 2,
      anxiety_score: 1,
      fatigue_score: 1,
      notes: 'No new concerns today.',
    };
  }
  if (scenario === 'medium') {
    const submitted = dayIndex < Math.max(3, days - 2);
    return {
      status: submitted ? 'submitted' : 'assigned',
      pain_score: submitted ? 4 : null,
      anxiety_score: submitted ? 5 : null,
      fatigue_score: submitted ? 4 : null,
      notes: submitted ? 'Symptoms present but manageable.' : 'QA seed: not submitted yet.',
    };
  }
  const submitted = dayIndex < 2;
  return {
    status: submitted ? 'submitted' : 'assigned',
    pain_score: submitted ? 8 : null,
    anxiety_score: submitted ? 8 : null,
    fatigue_score: submitted ? 7 : null,
    notes: submitted ? 'Severe symptoms and distress reported.' : 'QA seed: missed daily ePRO.',
  };
}

function addSet(plan, path, data, merge = true) {
  plan.push({ operation: 'set', path, data, merge });
}

function buildPlan(args) {
  const endDate = args.endDate || dateOnlyInMalaysia();
  const startDate = subtractDays(endDate, args.days - 1);
  const slug = uidSlug(args.uid);
  const plan = [];
  const now = admin.firestore.Timestamp.now();

  if (args.patchPatientStatic || args.patchProtocolAnchor) {
    const patientRootPatch = {
      updated_at: now,
      ...baseMeta(args),
    };

    if (args.patchPatientStatic) {
      patientRootPatch.subject_id = args.subjectId || `QA-${slug}`;
      patientRootPatch.dropout_static_context = {
        qa_seeded: true,
        support_level: args.scenario === 'low' ? 'strong' : args.scenario === 'medium' ? 'limited' : 'weak',
        distance_to_site_km: args.scenario === 'low' ? 8 : args.scenario === 'medium' ? 35 : 80,
        employment_or_school_constraint: args.scenario === 'high',
        last_verified_at: now,
      };
    }

    if (args.patchProtocolAnchor) {
      // QA-only anchor patch: keep the trial start day aligned with the seeded live-history window.
      patientRootPatch.protocolAssignedAt = malaysiaIso(startDate, 7, 0);
    }

    addSet(plan, `users/${args.uid}`, patientRootPatch);
  }

  for (let index = 0; index < args.days; index += 1) {
    const date = subtractDays(endDate, args.days - 1 - index);
    const vitalTs = malaysiaTimestamp(date, 8, 15);
    const eproAssignedTs = malaysiaTimestamp(date, 9, 0);
    const eproUpdatedTs = malaysiaTimestamp(date, args.scenario === 'high' ? 23 : 18, 30);
    const vitals = scenarioVitals(args.scenario, index, args.days);
    const epro = eproForScenario(args.scenario, index, args.days);

    addSet(plan, `users/${args.uid}/vitals/qa_dropout_${args.scenario}_${date}`, {
      ...vitals,
      timestamp: vitalTs,
      recorded_at: vitalTs,
      source: 'qa_seed',
      created_at: vitalTs,
      updated_at: vitalTs,
      ...baseMeta(args, index + 1),
    });

    addSet(plan, `users/${args.uid}/epro_submissions/qa_dropout_${args.scenario}_${date}`, {
      status: epro.status,
      assigned_at: eproAssignedTs,
      updated_at: eproUpdatedTs,
      submitted_at: epro.status === 'submitted' ? eproUpdatedTs : null,
      due_at: malaysiaTimestamp(date, 23, 59),
      pain_score: epro.pain_score,
      anxiety_score: epro.anxiety_score,
      fatigue_score: epro.fatigue_score,
      free_text: epro.notes,
      answers: {
        pain_score: epro.pain_score,
        anxiety_score: epro.anxiety_score,
        fatigue_score: epro.fatigue_score,
      },
      source: 'qa_seed',
      ...baseMeta(args, index + 1),
    });
  }

  if (args.scenario === 'low') {
    const appointmentDate = subtractDays(endDate, 3);
    addSet(plan, `users/${args.uid}/appointments/qa_dropout_low_completed`, {
      status: 'completed',
      datetime: malaysiaTimestamp(appointmentDate, 10, 0),
      updated_at: malaysiaTimestamp(appointmentDate, 10, 45),
      title: 'QA completed follow-up appointment',
      ...baseMeta(args),
    });

    const reportDate = subtractDays(endDate, 4);
    addSet(plan, `users/${args.uid}/side_effect_reports/qa_dropout_low_mild`, {
      submitted_at: malaysiaTimestamp(reportDate, 14, 0),
      severity: 'mild',
      symptom: 'Mild tiredness',
      immediate_help_requested: false,
      extracted_data: { ctcae_grade: 1 },
      ...baseMeta(args),
    });
  }

  if (args.scenario === 'medium') {
    const appointmentDate = subtractDays(endDate, 2);
    addSet(plan, `users/${args.uid}/appointments/qa_dropout_medium_missed`, {
      status: 'missed',
      datetime: malaysiaTimestamp(appointmentDate, 10, 0),
      updated_at: malaysiaTimestamp(appointmentDate, 12, 0),
      title: 'QA missed follow-up appointment',
      ...baseMeta(args),
    });

    const reportDate = subtractDays(endDate, 2);
    addSet(plan, `users/${args.uid}/side_effect_reports/qa_dropout_medium_moderate`, {
      submitted_at: malaysiaTimestamp(reportDate, 16, 15),
      severity: 'moderate',
      symptom: 'Persistent nausea and dizziness',
      immediate_help_requested: false,
      extracted_data: { ctcae_grade: 2 },
      ...baseMeta(args),
    });

    addSet(plan, `incident_records/qa_dropout_medium_${slug}`, {
      linked_patient_ids: [args.uid],
      incident_type: 'adverse_event',
      title: 'QA moderate adverse event follow-up',
      severity: 'moderate',
      status: 'open',
      immediate_help_requested: false,
      ctcae_grade: 2,
      created_at: malaysiaTimestamp(reportDate, 16, 20),
      updated_at: malaysiaTimestamp(reportDate, 16, 25),
      last_event_at: malaysiaTimestamp(reportDate, 16, 25),
      ...baseMeta(args),
    });
  }

  if (args.scenario === 'high') {
    const appointmentDate = subtractDays(endDate, 2);
    addSet(plan, `users/${args.uid}/appointments/qa_dropout_high_missed`, {
      status: 'missed',
      datetime: malaysiaTimestamp(appointmentDate, 9, 30),
      updated_at: malaysiaTimestamp(appointmentDate, 13, 0),
      title: 'QA missed urgent follow-up appointment',
      ...baseMeta(args),
    });

    const reportDate = subtractDays(endDate, 1);
    addSet(plan, `users/${args.uid}/side_effect_reports/qa_dropout_high_serious`, {
      submitted_at: malaysiaTimestamp(reportDate, 18, 10),
      severity: 'serious',
      symptom: 'Chest numbness and left leg weakness',
      immediate_help_requested: true,
      extracted_data: { ctcae_grade: 3 },
      ...baseMeta(args),
    });

    addSet(plan, `incident_records/qa_dropout_high_${slug}`, {
      linked_patient_ids: [args.uid],
      incident_type: 'abnormal_vital_sign',
      title: 'QA critical vitals and urgent adverse event',
      severity: 'serious',
      status: 'open',
      immediate_help_requested: true,
      ctcae_grade: 3,
      created_at: malaysiaTimestamp(reportDate, 18, 15),
      updated_at: malaysiaTimestamp(reportDate, 18, 20),
      last_event_at: malaysiaTimestamp(reportDate, 18, 20),
      ...baseMeta(args),
    });
  }

  const alertId = `qa_dropout_${args.scenario}_followup`;
  const alertType = args.scenario === 'high' ? 'URGENT' : 'MESSAGE';
  const alertStartDate = subtractDays(endDate, args.scenario === 'low' ? 5 : 4);
  addSet(plan, `users/${args.uid}/alerts/${alertId}`, {
    type: alertType,
    status: args.scenario === 'low' ? 'resolved' : 'open',
    title: args.scenario === 'high' ? 'QA urgent CRC follow-up' : 'QA CRC follow-up',
    patientUid: args.uid,
    timestamp: malaysiaTimestamp(alertStartDate, 11, 0),
    updated_at: malaysiaTimestamp(alertStartDate, 11, 0),
    ...baseMeta(args),
  });

  addSet(plan, `users/${args.uid}/alerts/${alertId}/messages/qa_crc_${args.scenario}_1`, {
    sender: 'crc',
    displayName: 'QA CRC',
    text: args.scenario === 'high'
      ? 'Please confirm your symptoms and call the study emergency pathway now.'
      : 'Please confirm how you are feeling today.',
    timestamp: malaysiaTimestamp(alertStartDate, 11, 5),
    created_at: malaysiaTimestamp(alertStartDate, 11, 5),
    ...baseMeta(args),
  });

  if (args.scenario !== 'high') {
    const replyDate = args.scenario === 'low' ? alertStartDate : subtractDays(endDate, 2);
    addSet(plan, `users/${args.uid}/alerts/${alertId}/messages/qa_patient_${args.scenario}_1`, {
      sender: 'patient',
      displayName: 'QA Patient',
      text: args.scenario === 'low'
        ? 'I am okay today and will continue the survey.'
        : 'I still feel unwell but can continue monitoring.',
      timestamp: malaysiaTimestamp(replyDate, args.scenario === 'low' ? 12 : 17, 0),
      created_at: malaysiaTimestamp(replyDate, args.scenario === 'low' ? 12 : 17, 0),
      ...baseMeta(args),
    });
  }

  return plan;
}

async function commitPlan(plan) {
  const db = admin.firestore();
  let batch = db.batch();
  let batchCount = 0;
  let committed = 0;

  for (const item of plan) {
    const ref = db.doc(item.path);
    batch.set(ref, item.data, { merge: item.merge !== false });
    batchCount += 1;
    if (batchCount === 450) {
      await batch.commit();
      committed += batchCount;
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    committed += batchCount;
  }

  return committed;
}

function printPlan(args, plan) {
  console.log('Dropout QA live-history seed plan');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Patient UID: ${args.uid}`);
  console.log(`Scenario: ${args.scenario}`);
  console.log(`Days: ${args.days}`);
  console.log(`End date: ${args.endDate || dateOnlyInMalaysia()}`);
  console.log(`Patch patient static context: ${args.patchPatientStatic ? 'yes' : 'no'}`);
  console.log(`Patch protocol anchor: ${args.patchProtocolAnchor ? 'yes' : 'no'}`);
  console.log('Firestore reads: 0');
  console.log(`Firestore writes planned: ${plan.length}`);
  console.log('');
  for (const item of plan) {
    console.log(`- ${item.operation.toUpperCase()} ${item.path}`);
  }
  if (!args.apply) {
    console.log('');
    console.log('Dry run only. Add --apply to write these exact documents.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  if (args.apply) {
    initAdmin();
  } else {
    // Dry-run needs Timestamp helpers but must not open Firebase credentials or network.
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'dry-run-no-network' });
    }
  }

  const plan = buildPlan(args);
  printPlan(args, plan);

  if (!args.apply) return;

  const committed = await commitPlan(plan);
  console.log('');
  console.log(`Committed writes: ${committed}`);
  console.log('Firestore reads performed by this script: 0');
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
});
