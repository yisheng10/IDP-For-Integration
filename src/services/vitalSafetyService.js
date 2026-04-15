import { createUrgentAlertThread } from './alertService';
import { loadPatientSafetyProfile, normalizeEventKey, upsertSafetyIncident } from './incidentService';
import { coerceVitalTemplates } from './trialTemplateService';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function makeIssue({ key, label, value, severity }) {
  return {
    key,
    label,
    value,
    severity,
    message: `${label}: ${value}`,
  };
}

function evaluateNumericTemplate(template, vitalPayload) {
  const issues = [];
  const thresholdSet = template.thresholds || {};
  const storageKey = template.storage_key || template.key;
  const rawValue = toNumber(vitalPayload[storageKey]);

  if (rawValue == null) return issues;

  if (thresholdSet.serious_high != null && rawValue >= Number(thresholdSet.serious_high)) {
    issues.push(
      makeIssue({
        key: `${template.key}-serious-high`,
        label: `${template.label} critical high`,
        value: `${rawValue}${template.unit ? ` ${template.unit}` : ''}`,
        severity: 'serious',
      })
    );
  } else if (thresholdSet.moderate_high != null && rawValue >= Number(thresholdSet.moderate_high)) {
    issues.push(
      makeIssue({
        key: `${template.key}-moderate-high`,
        label: `${template.label} high`,
        value: `${rawValue}${template.unit ? ` ${template.unit}` : ''}`,
        severity: 'moderate',
      })
    );
  }

  if (thresholdSet.serious_low != null && rawValue <= Number(thresholdSet.serious_low)) {
    issues.push(
      makeIssue({
        key: `${template.key}-serious-low`,
        label: `${template.label} critical low`,
        value: `${rawValue}${template.unit ? ` ${template.unit}` : ''}`,
        severity: 'serious',
      })
    );
  } else if (thresholdSet.moderate_low != null && rawValue <= Number(thresholdSet.moderate_low)) {
    issues.push(
      makeIssue({
        key: `${template.key}-moderate-low`,
        label: `${template.label} low`,
        value: `${rawValue}${template.unit ? ` ${template.unit}` : ''}`,
        severity: 'moderate',
      })
    );
  }

  return issues;
}

function evaluateBloodPressureTemplate(template, vitalPayload) {
  const issues = [];
  const thresholdSet = template.thresholds || {};
  const systolic = toNumber(vitalPayload[template.systolic_key || 'bpSys']);
  const diastolic = toNumber(vitalPayload[template.diastolic_key || 'bpDia']);

  if (systolic != null) {
    if (thresholdSet.systolic_serious_high != null && systolic >= Number(thresholdSet.systolic_serious_high)) {
      issues.push(makeIssue({ key: `${template.key}-sys-serious-high`, label: 'Critical systolic blood pressure', value: `${systolic}`, severity: 'serious' }));
    } else if (thresholdSet.systolic_moderate_high != null && systolic >= Number(thresholdSet.systolic_moderate_high)) {
      issues.push(makeIssue({ key: `${template.key}-sys-moderate-high`, label: 'High systolic blood pressure', value: `${systolic}`, severity: 'moderate' }));
    }

    if (thresholdSet.systolic_serious_low != null && systolic <= Number(thresholdSet.systolic_serious_low)) {
      issues.push(makeIssue({ key: `${template.key}-sys-serious-low`, label: 'Low systolic blood pressure', value: `${systolic}`, severity: 'serious' }));
    }
  }

  if (diastolic != null) {
    if (thresholdSet.diastolic_serious_high != null && diastolic >= Number(thresholdSet.diastolic_serious_high)) {
      issues.push(makeIssue({ key: `${template.key}-dia-serious-high`, label: 'Critical diastolic blood pressure', value: `${diastolic}`, severity: 'serious' }));
    } else if (thresholdSet.diastolic_moderate_high != null && diastolic >= Number(thresholdSet.diastolic_moderate_high)) {
      issues.push(makeIssue({ key: `${template.key}-dia-moderate-high`, label: 'High diastolic blood pressure', value: `${diastolic}`, severity: 'moderate' }));
    }

    if (thresholdSet.diastolic_serious_low != null && diastolic <= Number(thresholdSet.diastolic_serious_low)) {
      issues.push(makeIssue({ key: `${template.key}-dia-serious-low`, label: 'Low diastolic blood pressure', value: `${diastolic}`, severity: 'serious' }));
    }
  }

  return issues;
}

function resolveVitalTemplates(protocolDoc = null, vitalPayload = {}) {
  const fallbackVitals = Object.keys(vitalPayload)
    .filter((key) => key !== 'timestamp' && key !== 'bpSys' && key !== 'bpDia' && key !== 'bmi')
    .concat(vitalPayload.bpSys || vitalPayload.bpDia ? ['bp'] : []);

  return coerceVitalTemplates(
    protocolDoc?.vital_templates || protocolDoc?.vitalTemplates || [],
    protocolDoc?.monitoredVitals || fallbackVitals
  );
}

export function evaluateVitalSafety(vitalPayload = {}, protocolDoc = null) {
  const issues = [];
  const templates = resolveVitalTemplates(protocolDoc, vitalPayload);

  templates.forEach((template) => {
    if (template.input_type === 'blood_pressure') {
      issues.push(...evaluateBloodPressureTemplate(template, vitalPayload));
    } else {
      issues.push(...evaluateNumericTemplate(template, vitalPayload));
    }
  });

  const highestSeverity = issues.some((issue) => issue.severity === 'serious')
    ? 'serious'
    : issues.some((issue) => issue.severity === 'moderate')
      ? 'moderate'
      : 'mild';

  return {
    issues,
    highestSeverity,
    hasSafetyIssue: issues.length > 0,
    requiresUrgentAlert: issues.some((issue) => issue.severity === 'serious'),
    summary: issues.map((issue) => issue.message).join('; '),
    eventKey: normalizeEventKey(`vitals-${issues.map((issue) => issue.key).join('-')}`),
  };
}

function buildVitalDetails(vitalPayload, issues) {
  const measurements = Object.entries(vitalPayload)
    .filter(([key, value]) => key !== 'timestamp' && value != null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  return [
    'Auto-detected abnormal vitals.',
    measurements ? `Measurements: ${measurements}.` : null,
    `Flagged issues: ${issues.map((issue) => issue.message).join('; ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function handleLoggedVitalSafety({ userId, vitalPayload, reporterName }) {
  const { patientProfile, protocolDoc } = await loadPatientSafetyProfile(userId);
  const assessment = evaluateVitalSafety(vitalPayload, protocolDoc);

  if (!assessment.hasSafetyIssue) {
    return {
      hasSafetyIssue: false,
      severity: 'mild',
      incidentId: null,
      alertPath: null,
      summary: '',
    };
  }

  const nowIso = new Date().toISOString();
  const eventTitle = assessment.requiresUrgentAlert ? 'Critical vitals detected' : 'Abnormal vitals detected';
  const details = buildVitalDetails(vitalPayload, assessment.issues);

  const alertRef = await createUrgentAlertThread(
    userId,
    eventTitle,
    details,
    reporterName || patientProfile.nickname || 'Patient',
    {
      syncIncident: false,
      alertMetadata: {
        source_system: 'patient_vitals_auto_monitor',
        safety_category: 'vitals',
        auto_generated: true,
        derived_severity: assessment.highestSeverity,
      },
    }
  );

  const incident = await upsertSafetyIncident({
    patientId: userId,
    patientProfile,
    protocolDoc,
    eventTitle,
    eventKey: assessment.eventKey,
    severity: assessment.highestSeverity,
    details,
    onsetAt: vitalPayload.timestamp || nowIso,
    immediateHelpRequested: assessment.requiresUrgentAlert,
    sourceSystem: 'patient_vitals_auto_monitor',
    linkedAlertPath: alertRef.path,
    incidentTypeOverride: assessment.requiresUrgentAlert ? 'emergency' : 'vital_monitor',
  });

  return {
    hasSafetyIssue: true,
    severity: assessment.highestSeverity,
    incidentId: incident.id,
    alertPath: alertRef.path,
    summary: assessment.summary,
  };
}
