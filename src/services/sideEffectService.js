import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createUrgentAlertThread } from './alertService';
import {
  buildLinkedReportReference,
  deriveSubjectIdFromProfile,
  loadPatientSafetyProfile,
  normalizeEventKey,
  normalizeSafetySeverity,
  upsertSafetyIncident,
} from './incidentService';

export async function submitSideEffectReport({
  userId,
  symptomTitle,
  details,
  severity,
  onsetAt,
  immediateHelpRequested = false,
  reporterName,
  sourceSystem = 'patient_side_effect_form',
  protocolCovered = null,
  protocolGuidance = '',
  shouldAlertCrc,
  auditTrail = null,
  triageSummary = '',
  rawUserText = '',
  extractedData = null,
}) {
  const normalizedSeverity = normalizeSafetySeverity(severity);
  const safeSymptomTitle = String(symptomTitle || '').trim();

  if (!safeSymptomTitle) {
    throw new Error('Symptom title is required.');
  }

  const { patientProfile, protocolDoc } = await loadPatientSafetyProfile(userId);
  const nowIso = new Date().toISOString();
  const safeOnsetAt = onsetAt || nowIso;
  const subjectId = deriveSubjectIdFromProfile(patientProfile, userId);

  const baseReport = {
    report_type: 'side_effect',
    source_system: sourceSystem,
    patient_uid: userId,
    subject_id: subjectId,
    patient_name: patientProfile.nickname || patientProfile.email || userId,
    hospital_patient_id: patientProfile.hospitalPatientId || '',
    primary_crc_id:
      patientProfile.primary_crc_id ||
      patientProfile.primaryCrcId ||
      patientProfile.assigned_crc_id ||
      null,
    primary_crc_name:
      patientProfile.primary_crc_name ||
      patientProfile.primaryCrcName ||
      patientProfile.assigned_crc_name ||
      null,
    protocol_id: protocolDoc?.id || patientProfile.protocolId || null,
    protocol_name: protocolDoc?.name || patientProfile.protocolName || null,
    protocol_rule_snapshot: protocolDoc?.notification_policy || null,
    symptom_title: safeSymptomTitle,
    details: String(details || ''),
    raw_user_text: String(rawUserText || ''),
    severity: normalizedSeverity,
    onset_at: safeOnsetAt,
    immediate_help_requested: Boolean(immediateHelpRequested),
    protocol_covered: typeof protocolCovered === 'boolean' ? protocolCovered : null,
    protocol_guidance: String(protocolGuidance || ''),
    triage_summary: String(triageSummary || ''),
    audit_trail: auditTrail || null,
    extracted_data: extractedData || null,
    status: 'submitted',
    submitted_at: nowIso,
    updated_at: nowIso,
    event_key: normalizeEventKey(safeSymptomTitle),
  };

  const reportRef = await addDoc(collection(db, 'users', userId, 'side_effect_reports'), baseReport);

  let linkedAlertPath = null;
  const requiresCrcAlert =
    typeof shouldAlertCrc === 'boolean'
      ? shouldAlertCrc
      : normalizedSeverity === 'serious' ||
        immediateHelpRequested ||
        protocolCovered === false ||
        protocolCovered === null;

  if (requiresCrcAlert) {
    const alertMessage = [
      `Structured side effect event documented for ${safeSymptomTitle}.`,
      details ? `Details: ${details}` : null,
      `Severity: ${normalizedSeverity}.`,
      protocolCovered === false ? 'This symptom is not clearly covered by the active protocol.' : null,
      protocolCovered === null ? 'Protocol coverage could not be confirmed automatically.' : null,
      protocolGuidance ? `Protocol guidance: ${protocolGuidance}` : null,
      triageSummary ? `AI triage summary: ${triageSummary}` : null,
      immediateHelpRequested ? 'Patient requested immediate help.' : null,
    ]
      .filter(Boolean)
      .join(' ');

    const alertRef = await createUrgentAlertThread(
      userId,
      `Side Effect: ${safeSymptomTitle}`,
      alertMessage,
      reporterName || patientProfile.nickname || 'Patient',
      {
        syncIncident: false,
        alertMetadata: {
          source_report_id: reportRef.id,
          source_system: sourceSystem,
          side_effect_severity: normalizedSeverity,
          immediate_help_requested: Boolean(immediateHelpRequested),
          protocol_covered: typeof protocolCovered === 'boolean' ? protocolCovered : null,
        },
      }
    );

    linkedAlertPath = alertRef.path;
  }

  const incident = await upsertSafetyIncident({
    patientId: userId,
    patientProfile,
    protocolDoc,
    eventTitle: safeSymptomTitle,
    eventKey: normalizeEventKey(safeSymptomTitle),
    severity: normalizedSeverity,
    details: String(details || ''),
    onsetAt: safeOnsetAt,
    immediateHelpRequested: Boolean(immediateHelpRequested),
    sourceSystem,
    linkedReport: buildLinkedReportReference(userId, reportRef.id, baseReport),
    linkedAlertPath,
  });

  await updateDoc(reportRef, {
    incident_id: incident.id,
    alert_path: linkedAlertPath,
    updated_at: new Date().toISOString(),
  });

  return {
    reportId: reportRef.id,
    incidentId: incident.id,
    alertPath: linkedAlertPath,
    crcAlerted: requiresCrcAlert,
  };
}

export function subscribeToSideEffectReports(userId, onUpdate, onError) {
  const reportsQuery = query(
    collection(db, 'users', userId, 'side_effect_reports'),
    orderBy('submitted_at', 'desc')
  );

  return onSnapshot(
    reportsQuery,
    (snapshot) => {
      const reports = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      onUpdate(reports);
    },
    onError
  );
}
