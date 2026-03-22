import { createUrgentAlertThread } from './alertService';
import { loadPatientSafetyProfile, normalizeEventKey, upsertSafetyIncident } from './incidentService';

const DEFAULT_VITAL_THRESHOLDS = {
  temperature: {
    moderate: { min: null, max: 38.4, operator: 'gt', value: 38.4, label: 'Raised temperature' },
    serious: { min: null, max: 39, operator: 'gte', value: 39, label: 'High fever' },
  },
  spo2: {
    moderate: { operator: 'lt', value: 94, label: 'Low oxygen saturation' },
    serious: { operator: 'lt', value: 92, label: 'Critical oxygen saturation' },
  },
  bpSys: {
    moderateHigh: { operator: 'gte', value: 160, label: 'High systolic blood pressure' },
    seriousHigh: { operator: 'gte', value: 180, label: 'Critical systolic blood pressure' },
    seriousLow: { operator: 'lt', value: 90, label: 'Low systolic blood pressure' },
  },
  bpDia: {
    moderateHigh: { operator: 'gte', value: 100, label: 'High diastolic blood pressure' },
    seriousHigh: { operator: 'gte', value: 120, label: 'Critical diastolic blood pressure' },
    seriousLow: { operator: 'lt', value: 60, label: 'Low diastolic blood pressure' },
  },
  heartRate: {
    moderateHigh: { operator: 'gte', value: 110, label: 'High heart rate' },
    seriousHigh: { operator: 'gte', value: 130, label: 'Critical heart rate' },
    seriousLow: { operator: 'lt', value: 45, label: 'Low heart rate' },
  },
  respRate: {
    moderateHigh: { operator: 'gte', value: 24, label: 'Raised respiratory rate' },
    seriousHigh: { operator: 'gte', value: 30, label: 'Critical respiratory rate' },
    seriousLow: { operator: 'lt', value: 10, label: 'Low respiratory rate' },
  },
  glucoseFasting: {
    moderateHigh: { operator: 'gte', value: 11.1, label: 'High fasting glucose' },
    seriousHigh: { operator: 'gte', value: 13.9, label: 'Critical fasting glucose' },
    seriousLow: { operator: 'lt', value: 3.5, label: 'Low fasting glucose' },
  },
  glucosePost: {
    moderateHigh: { operator: 'gte', value: 13.9, label: 'High post-meal glucose' },
    seriousHigh: { operator: 'gte', value: 16.7, label: 'Critical post-meal glucose' },
  },
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compare(operator, left, right) {
  if (left == null || right == null) return false;
  switch (operator) {
    case 'gte':
      return left >= right;
    case 'gt':
      return left > right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      return false;
  }
}

function mergeThresholds(protocolDoc) {
  const overrides = protocolDoc?.vital_thresholds || protocolDoc?.vitalThresholds || {};
  return {
    ...DEFAULT_VITAL_THRESHOLDS,
    ...overrides,
  };
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

export function evaluateVitalSafety(vitalPayload = {}, protocolDoc = null) {
  const thresholds = mergeThresholds(protocolDoc);
  const issues = [];

  const temperature = toNumber(vitalPayload.temperature);
  if (temperature != null) {
    if (compare('gte', temperature, thresholds.temperature?.serious?.value)) {
      issues.push(makeIssue({ key: 'temperature-high', label: 'High fever', value: `${temperature} C`, severity: 'serious' }));
    } else if (compare('gt', temperature, thresholds.temperature?.moderate?.value)) {
      issues.push(makeIssue({ key: 'temperature-raised', label: 'Raised temperature', value: `${temperature} C`, severity: 'moderate' }));
    }
  }

  const spo2 = toNumber(vitalPayload.spo2);
  if (spo2 != null) {
    if (compare('lt', spo2, thresholds.spo2?.serious?.value)) {
      issues.push(makeIssue({ key: 'spo2-critical', label: 'Critical oxygen saturation', value: `${spo2}%`, severity: 'serious' }));
    } else if (compare('lt', spo2, thresholds.spo2?.moderate?.value)) {
      issues.push(makeIssue({ key: 'spo2-low', label: 'Low oxygen saturation', value: `${spo2}%`, severity: 'moderate' }));
    }
  }

  const bpSys = toNumber(vitalPayload.bpSys);
  if (bpSys != null) {
    if (compare('gte', bpSys, thresholds.bpSys?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'bp-sys-critical-high', label: 'Critical systolic blood pressure', value: `${bpSys}`, severity: 'serious' }));
    } else if (compare('lt', bpSys, thresholds.bpSys?.seriousLow?.value)) {
      issues.push(makeIssue({ key: 'bp-sys-low', label: 'Low systolic blood pressure', value: `${bpSys}`, severity: 'serious' }));
    } else if (compare('gte', bpSys, thresholds.bpSys?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'bp-sys-high', label: 'High systolic blood pressure', value: `${bpSys}`, severity: 'moderate' }));
    }
  }

  const bpDia = toNumber(vitalPayload.bpDia);
  if (bpDia != null) {
    if (compare('gte', bpDia, thresholds.bpDia?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'bp-dia-critical-high', label: 'Critical diastolic blood pressure', value: `${bpDia}`, severity: 'serious' }));
    } else if (compare('lt', bpDia, thresholds.bpDia?.seriousLow?.value)) {
      issues.push(makeIssue({ key: 'bp-dia-low', label: 'Low diastolic blood pressure', value: `${bpDia}`, severity: 'serious' }));
    } else if (compare('gte', bpDia, thresholds.bpDia?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'bp-dia-high', label: 'High diastolic blood pressure', value: `${bpDia}`, severity: 'moderate' }));
    }
  }

  const heartRate = toNumber(vitalPayload.heartRate);
  if (heartRate != null) {
    if (compare('gte', heartRate, thresholds.heartRate?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'heart-rate-critical-high', label: 'Critical heart rate', value: `${heartRate} bpm`, severity: 'serious' }));
    } else if (compare('lt', heartRate, thresholds.heartRate?.seriousLow?.value)) {
      issues.push(makeIssue({ key: 'heart-rate-low', label: 'Low heart rate', value: `${heartRate} bpm`, severity: 'serious' }));
    } else if (compare('gte', heartRate, thresholds.heartRate?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'heart-rate-high', label: 'High heart rate', value: `${heartRate} bpm`, severity: 'moderate' }));
    }
  }

  const respRate = toNumber(vitalPayload.respRate);
  if (respRate != null) {
    if (compare('gte', respRate, thresholds.respRate?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'resp-rate-critical-high', label: 'Critical respiratory rate', value: `${respRate}`, severity: 'serious' }));
    } else if (compare('lt', respRate, thresholds.respRate?.seriousLow?.value)) {
      issues.push(makeIssue({ key: 'resp-rate-low', label: 'Low respiratory rate', value: `${respRate}`, severity: 'serious' }));
    } else if (compare('gte', respRate, thresholds.respRate?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'resp-rate-high', label: 'Raised respiratory rate', value: `${respRate}`, severity: 'moderate' }));
    }
  }

  const glucoseFasting = toNumber(vitalPayload.glucoseFasting);
  if (glucoseFasting != null) {
    if (compare('gte', glucoseFasting, thresholds.glucoseFasting?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'glucose-fasting-critical-high', label: 'Critical fasting glucose', value: `${glucoseFasting} mmol/L`, severity: 'serious' }));
    } else if (compare('lt', glucoseFasting, thresholds.glucoseFasting?.seriousLow?.value)) {
      issues.push(makeIssue({ key: 'glucose-fasting-low', label: 'Low fasting glucose', value: `${glucoseFasting} mmol/L`, severity: 'serious' }));
    } else if (compare('gte', glucoseFasting, thresholds.glucoseFasting?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'glucose-fasting-high', label: 'High fasting glucose', value: `${glucoseFasting} mmol/L`, severity: 'moderate' }));
    }
  }

  const glucosePost = toNumber(vitalPayload.glucosePost);
  if (glucosePost != null) {
    if (compare('gte', glucosePost, thresholds.glucosePost?.seriousHigh?.value)) {
      issues.push(makeIssue({ key: 'glucose-post-critical-high', label: 'Critical post-meal glucose', value: `${glucosePost} mmol/L`, severity: 'serious' }));
    } else if (compare('gte', glucosePost, thresholds.glucosePost?.moderateHigh?.value)) {
      issues.push(makeIssue({ key: 'glucose-post-high', label: 'High post-meal glucose', value: `${glucosePost} mmol/L`, severity: 'moderate' }));
    }
  }

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
  const measurements = [
    vitalPayload.temperature ? `Temp ${vitalPayload.temperature} C` : null,
    vitalPayload.bpSys ? `BP ${vitalPayload.bpSys}/${vitalPayload.bpDia || '-'}` : null,
    vitalPayload.spo2 ? `SpO2 ${vitalPayload.spo2}%` : null,
    vitalPayload.heartRate ? `HR ${vitalPayload.heartRate}` : null,
    vitalPayload.respRate ? `RR ${vitalPayload.respRate}` : null,
    vitalPayload.glucoseFasting ? `Glucose(F) ${vitalPayload.glucoseFasting}` : null,
    vitalPayload.glucosePost ? `Glucose(P) ${vitalPayload.glucosePost}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return [`Auto-detected abnormal vitals.`, measurements ? `Measurements: ${measurements}.` : null, `Flagged issues: ${issues.map((issue) => issue.message).join('; ')}.`]
    .filter(Boolean)
    .join(' ');
}

export async function handleLoggedVitalSafety({
  userId,
  vitalPayload,
  reporterName,
}) {
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

  let linkedAlertPath = null;
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
  linkedAlertPath = alertRef.path;

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
    linkedAlertPath,
    incidentTypeOverride: assessment.requiresUrgentAlert ? 'emergency' : 'vital_monitor',
  });

  return {
    hasSafetyIssue: true,
    severity: assessment.highestSeverity,
    incidentId: incident.id,
    alertPath: linkedAlertPath,
    summary: assessment.summary,
  };
}
