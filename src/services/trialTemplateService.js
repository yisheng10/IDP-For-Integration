import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

const BUILTIN_VITAL_LIBRARY = [
  {
    key: 'temperature',
    label: 'Body Temperature',
    unit: 'C',
    input_type: 'numeric',
    storage_key: 'temperature',
    thresholds: { moderate_high: 38.4, serious_high: 39 },
  },
  {
    key: 'bp',
    label: 'Blood Pressure',
    unit: 'mmHg',
    input_type: 'blood_pressure',
    systolic_key: 'bpSys',
    diastolic_key: 'bpDia',
    thresholds: {
      systolic_moderate_high: 160,
      systolic_serious_high: 180,
      systolic_serious_low: 90,
      diastolic_moderate_high: 100,
      diastolic_serious_high: 120,
      diastolic_serious_low: 60,
    },
  },
  {
    key: 'spo2',
    label: 'SpO2',
    unit: '%',
    input_type: 'numeric',
    storage_key: 'spo2',
    thresholds: { moderate_low: 94, serious_low: 92 },
  },
  {
    key: 'heartRate',
    label: 'Heart Rate',
    unit: 'bpm',
    input_type: 'numeric',
    storage_key: 'heartRate',
    thresholds: { moderate_high: 110, serious_high: 130, serious_low: 45 },
  },
  {
    key: 'respRate',
    label: 'Respiratory Rate',
    unit: 'breaths/min',
    input_type: 'numeric',
    storage_key: 'respRate',
    thresholds: { moderate_high: 24, serious_high: 30, serious_low: 10 },
  },
  {
    key: 'weight',
    label: 'Weight',
    unit: 'kg',
    input_type: 'numeric',
    storage_key: 'weight',
    thresholds: {},
  },
  {
    key: 'height',
    label: 'Height',
    unit: 'cm',
    input_type: 'numeric',
    storage_key: 'height',
    thresholds: {},
  },
  {
    key: 'glucoseFasting',
    label: 'Glucose (Fasting)',
    unit: 'mmol/L',
    input_type: 'numeric',
    storage_key: 'glucoseFasting',
    thresholds: { moderate_high: 11.1, serious_high: 13.9, serious_low: 3.5 },
  },
  {
    key: 'glucosePost',
    label: 'Glucose (Post)',
    unit: 'mmol/L',
    input_type: 'numeric',
    storage_key: 'glucosePost',
    thresholds: { moderate_high: 13.9, serious_high: 16.7 },
  },
  {
    key: 'pef',
    label: 'PEF',
    unit: 'L/min',
    input_type: 'numeric',
    storage_key: 'pef',
    thresholds: {},
  },
  {
    key: 'fev1',
    label: 'FEV1',
    unit: 'L',
    input_type: 'numeric',
    storage_key: 'fev1',
    thresholds: {},
  },
  {
    key: 'inr',
    label: 'INR',
    unit: 'ratio',
    input_type: 'numeric',
    storage_key: 'inr',
    thresholds: {},
  },
  {
    key: 'ketones',
    label: 'Ketones',
    unit: 'mmol/L',
    input_type: 'numeric',
    storage_key: 'ketones',
    thresholds: {},
  },
  {
    key: 'waist',
    label: 'Waist Circumference',
    unit: 'cm',
    input_type: 'numeric',
    storage_key: 'waist',
    thresholds: {},
  },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toNumberOrNull(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getBuiltinVitalLibrary() {
  return deepClone(BUILTIN_VITAL_LIBRARY);
}

export function findBuiltinVitalTemplate(key) {
  const normalizedKey = String(key || '').trim();
  const match = BUILTIN_VITAL_LIBRARY.find(
    (template) =>
      template.key === normalizedKey ||
      template.storage_key === normalizedKey ||
      (normalizedKey === 'bp' && template.input_type === 'blood_pressure')
  );
  return match ? deepClone(match) : null;
}

export function isBuiltinVitalTemplate(template = {}, fallbackKey = '') {
  return Boolean(
    findBuiltinVitalTemplate(
      template.key || template.storage_key || template.systolic_key || template.label || fallbackKey
    )
  );
}

export function coerceVitalTemplate(template = {}, fallbackKey = '') {
  const builtinTemplate = findBuiltinVitalTemplate(
    template.key || template.storage_key || template.systolic_key || template.label || fallbackKey
  );
  const isBuiltin = Boolean(builtinTemplate);
  const base =
    builtinTemplate || {
      key: slugify(template.key || template.label || fallbackKey || 'custom-vital'),
      label: template.label || 'Custom Vital',
      unit: template.unit || '',
      input_type: 'numeric',
      storage_key: slugify(template.storage_key || template.key || template.label || fallbackKey || 'custom-vital'),
      thresholds: {},
    };

  const normalized = {
    ...base,
    ...template,
    key: slugify(template.key || base.key || template.label || fallbackKey || 'custom-vital'),
    label: String(template.label || base.label || 'Custom Vital'),
    unit: String(template.unit || base.unit || ''),
    input_type: isBuiltin ? base.input_type || 'numeric' : 'numeric',
    storage_key: String(isBuiltin ? base.storage_key || base.key || 'custom-vital' : template.storage_key || base.storage_key || base.key || 'custom-vital'),
    systolic_key: String(isBuiltin ? base.systolic_key || 'bpSys' : template.systolic_key || base.systolic_key || 'bpSys'),
    diastolic_key: String(isBuiltin ? base.diastolic_key || 'bpDia' : template.diastolic_key || base.diastolic_key || 'bpDia'),
    thresholds: {},
  };

  const rawThresholds = {
    ...(base.thresholds || {}),
    ...(template.thresholds || {}),
  };

  Object.entries(rawThresholds).forEach(([thresholdKey, thresholdValue]) => {
    normalized.thresholds[thresholdKey] = toNumberOrNull(thresholdValue);
  });

  return normalized;
}

export function coerceVitalTemplates(templates = [], legacyMonitoredVitals = []) {
  const source =
    Array.isArray(templates) && templates.length > 0
      ? templates
      : Array.isArray(legacyMonitoredVitals) && legacyMonitoredVitals.length > 0
        ? legacyMonitoredVitals.map((key) => findBuiltinVitalTemplate(key) || { key, label: key })
        : BUILTIN_VITAL_LIBRARY.slice(0, 3);

  const seen = new Set();
  return source
    .map((template, index) => coerceVitalTemplate(template, `vital-${index + 1}`))
    .filter((template) => {
      if (!template.key || seen.has(template.key)) return false;
      seen.add(template.key);
      return true;
    });
}

export function buildFallbackMonitoredVitals(vitalTemplates = []) {
  return coerceVitalTemplates(vitalTemplates).map((template) =>
    template.input_type === 'blood_pressure' ? 'bp' : template.key
  );
}

export function describeInheritedVitals(vitalTemplates = []) {
  if (!Array.isArray(vitalTemplates) || vitalTemplates.length === 0) {
    return [];
  }

  return coerceVitalTemplates(vitalTemplates).map((template) =>
    template.input_type === 'blood_pressure'
      ? `${template.label} (${template.systolic_key}/${template.diastolic_key})`
      : `${template.label}${template.unit ? ` (${template.unit})` : ''}`
  );
}

export function subscribeToTrialTemplates(onUpdate, onError) {
  const templatesQuery = query(collection(db, 'protocols'), orderBy('uploadedAt', 'desc'), limit(20));
  return onSnapshot(
    templatesQuery,
    (snapshot) => {
      const rows = snapshot.docs.map((entry) => {
        const data = entry.data();
        return {
          id: entry.id,
          ...data,
          vital_templates: coerceVitalTemplates(data.vital_templates, data.monitoredVitals),
        };
      });
      onUpdate(rows);
    },
    onError
  );
}

export async function loadAssignedTrialTemplate(profile = {}) {
  if (profile?.protocolId) {
    const templateSnapshot = await getDoc(doc(db, 'protocols', profile.protocolId));
    if (templateSnapshot.exists()) {
      const data = templateSnapshot.data();
      return {
        id: templateSnapshot.id,
        ...data,
        vital_templates: coerceVitalTemplates(data.vital_templates, data.monitoredVitals),
      };
    }
  }

  if (profile?.protocolName) {
    const templateQuery = query(
      collection(db, 'protocols'),
      where('name', '==', profile.protocolName),
      limit(1)
    );
    const templateSnapshot = await getDocs(templateQuery);
    if (!templateSnapshot.empty) {
      const templateDoc = templateSnapshot.docs[0];
      const data = templateDoc.data();
      return {
        id: templateDoc.id,
        ...data,
        vital_templates: coerceVitalTemplates(data.vital_templates, data.monitoredVitals),
      };
    }
  }

  return null;
}
