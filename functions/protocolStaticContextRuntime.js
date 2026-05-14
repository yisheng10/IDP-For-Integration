import admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import {
  buildNotConfiguredProtocolFields,
  buildProtocolTrialFields,
  getSupportedTrialSeed,
  syncTrialRegistryToFirestore,
  updateAssignedPatientsForProtocol,
} from './dropoutRegistryRuntime.js';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const pdfjs = pdfjsLib.default || pdfjsLib;
const EXTRACTOR_VERSION = 'dropout-static-context-v2-strict';
const TEXT_LIMIT = 45000;
const DEFAULT_STORAGE_BUCKET = 'protocol';
const ALLOWED_DISENGAGEMENT_TRIAL_PHASES = new Set([0, 1, 2]);
const DEFAULT_NOTIFICATION_POLICY = {
  mild: {
    due_in_hours: 168,
    action_code: 'report_during_next_visit',
    instruction: 'Document at the next protocol visit.',
    notification_tier: 'routine',
  },
  moderate: {
    due_in_hours: 24,
    action_code: 'review_next_day',
    instruction: 'CRC review is due by the next day.',
    notification_tier: 'priority',
  },
  serious: {
    due_in_hours: 1,
    action_code: 'attend_within_next_hour',
    instruction: 'Immediate CRC action is required within the next hour.',
    notification_tier: 'urgent',
  },
};
const DEFAULT_VITAL_TEMPLATES = [
  {
    key: 'temperature',
    label: 'Body Temperature',
    unit: 'C',
    input_type: 'numeric',
    storage_key: 'temperature',
    thresholds: { moderate_high: 38.4, serious_high: 39 },
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
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeManualTrialPhaseOverride(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    return null;
  }
  if (normalized === 'phase 0' || normalized === '0') return 0;
  if (normalized === 'phase 1' || normalized === '1') return 1;
  if (normalized === 'phase 2' || normalized === '2') return 2;
  throw new HttpsError(
    'invalid-argument',
    `Unsupported manual disengagement trial phase override: ${value}`
  );
}

function tryParseTrialPhaseLabel(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    return null;
  }
  if (normalized === '0') return 0;
  if (normalized === '1') return 1;
  if (normalized === '2') return 2;
  if (normalized === '3') return 3;
  if (normalized === '4') return 4;
  if (normalized.includes('early phase 1')) return 0;
  if (/\bphase\s*i\b/.test(normalized) || /\bphase\s*1\b/.test(normalized)) return 1;
  if (/\bphase\s*ii\b/.test(normalized) || /\bphase\s*2\b/.test(normalized)) return 2;
  if (/\bphase\s*iii\b/.test(normalized) || /\bphase\s*3\b/.test(normalized)) return 3;
  if (/\bphase\s*iv\b/.test(normalized) || /\bphase\s*4\b/.test(normalized)) return 4;
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeFileName(value) {
  return normalizeText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'protocol.pdf';
}

async function ensureCrcAccessByUid(uid, token = {}) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'CRC authentication is required.');
  }

  const email = normalizeLowerText(token.email || '');
  if (email.endsWith('@hospital.com')) {
    return {
      uid,
      role: 'crc',
      email,
      displayName: token.name || token.email || 'CRC user',
    };
  }

  const userSnapshot = await db.collection('users').doc(uid).get();
  if (!userSnapshot.exists) {
    throw new HttpsError('permission-denied', 'CRC profile not found.');
  }

  const userData = userSnapshot.data() || {};
  if (normalizeLowerText(userData.role) !== 'crc') {
    throw new HttpsError('permission-denied', 'Only CRC users can perform this action.');
  }

  return {
    uid,
    ...userData,
  };
}

async function assertAuthenticatedCrcRequest(request) {
  return ensureCrcAccessByUid(request.auth?.uid, request.auth?.token || {});
}

function createSupabaseAdminClient() {
  const supabaseUrl = normalizeText(process.env.SUPABASE_URL);
  const supabaseServiceRoleKey = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new HttpsError(
      'failed-precondition',
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for strict protocol extraction.'
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

async function downloadSupabaseFileBytes({ storageBucket, storagePath }) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(storageBucket).download(storagePath);
  if (error) {
    throw new HttpsError(
      'failed-precondition',
      `Failed to download the uploaded protocol PDF from ${storageBucket}/${storagePath}: ${error.message}`
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function moveSupabaseFile({ storageBucket, fromPath, toPath }) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(storageBucket).move(fromPath, toPath);
  if (error) {
    throw new HttpsError(
      'failed-precondition',
      `Failed to finalize the uploaded protocol PDF into ${storageBucket}/${toPath}: ${error.message}`
    );
  }
  return data;
}

async function removeSupabaseFile({ storageBucket, storagePath }) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage.from(storageBucket).remove([storagePath]);
  if (error) {
    console.error(
      `[protocol-static-context] Failed to clean up ${storageBucket}/${storagePath}:`,
      error.message || error
    );
  }
}

async function extractPdfText(fileBytes) {
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fileBytes),
      disableWorker: true,
    });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str || '').join(' ');
      pageTexts.push(pageText);
    }

    return pageTexts.join('\n').trim();
  } catch (error) {
    throw new HttpsError(
      'failed-precondition',
      `Strict protocol PDF text extraction failed: ${error?.message || error || 'Unknown PDF parsing error'}`
    );
  }
}

function extractJsonObject(text) {
  const raw = normalizeText(text);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

async function requestGeminiStaticContext(protocolName, extractedText) {
  const apiKey = normalizeText(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new HttpsError(
      'failed-precondition',
      'GEMINI_API_KEY must be configured for strict protocol static-context extraction.'
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `
You are extracting structured clinical-trial metadata for a disengagement prediction model.
Return JSON only.

Protocol name:
${protocolName}

Protocol PDF text excerpt:
${String(extractedText || '').slice(0, TEXT_LIMIT)}

Required JSON shape:
{
  "trial_phase_label": "string",
  "condition_summary": "string",
  "enrollment": number,
  "criteria_complexity": number,
  "has_device_intervention": boolean,
  "has_drug_intervention": boolean,
  "has_behavioral_intervention": boolean,
  "has_procedure_intervention": boolean
}
`.trim();

  try {
    const result = await model.generateContent(prompt);
    const payload = extractJsonObject(result.response.text());
    if (!payload || typeof payload !== 'object') {
      throw new Error('Gemini did not return a valid JSON object.');
    }
    return payload;
  } catch (error) {
    throw new HttpsError(
      'failed-precondition',
      `Strict protocol static-context extraction failed during Gemini processing: ${error?.message || error || 'Unknown Gemini error'}`
    );
  }
}

function requireFiniteNumber(fieldName, value, { min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new HttpsError(
      'failed-precondition',
      `Strict protocol static-context extraction did not produce a valid ${fieldName}.`
    );
  }
  return parsed;
}

function requireBooleanLike(fieldName, value) {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const normalized = normalizeLowerText(value);
  if (['1', 'true', 'yes', 'y', 'present'].includes(normalized)) {
    return 1;
  }
  if (['0', 'false', 'no', 'n', 'absent'].includes(normalized)) {
    return 0;
  }
  throw new HttpsError(
    'failed-precondition',
    `Strict protocol static-context extraction did not produce a valid ${fieldName}.`
  );
}

function mapTrialPhaseStrict(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) {
    throw new HttpsError(
      'failed-precondition',
      'Strict protocol static-context extraction did not produce a valid trial_phase_label.'
    );
  }
  const parsedPhase = tryParseTrialPhaseLabel(value);
  if (parsedPhase != null) {
    return parsedPhase;
  }
  throw new HttpsError(
    'failed-precondition',
    `Strict protocol static-context extraction produced an unsupported trial_phase_label: ${value}`
  );
}

function buildConfiguredTrialBindingFields(trialId, metadata, source = 'pdf_text_unique_match') {
  return {
    ...buildProtocolTrialFields(metadata),
    dropout_trial_match_status: 'configured',
    dropout_trial_match_message:
      source === 'manual_configured'
        ? `This protocol is configured to supported disengagement dataset trial ${trialId}.`
        : `A unique supported disengagement dataset trial ID (${trialId}) was detected in the protocol PDF and configured automatically.`,
    dropout_trial_match_candidates: [trialId],
    dropout_trial_match_source: source,
  };
}

function buildUnresolvedTrialBindingFields(status, candidates = []) {
  if (status === 'multiple_supported_trials_detected') {
    return {
      ...buildNotConfiguredProtocolFields(),
      dropout_trial_match_status: status,
      dropout_trial_match_message: `Strict static context is ready, but multiple supported dataset trial IDs were detected in the protocol PDF: ${candidates.join(', ')}. Choose one manually before this protocol can enter patient disengagement prediction.`,
      dropout_trial_match_candidates: candidates,
      dropout_trial_match_source: 'pdf_text_multi_match',
    };
  }

  return {
    ...buildNotConfiguredProtocolFields(),
    dropout_trial_match_status: 'no_supported_trial_detected',
    dropout_trial_match_message:
      'Strict static context is ready, but no supported disengagement dataset trial ID was detected in the protocol PDF. This protocol stays out of patient disengagement prediction until a supported trial ID is configured.',
    dropout_trial_match_candidates: [],
    dropout_trial_match_source: 'pdf_text_no_match',
  };
}

async function resolveProtocolTrialBindingFromExtractedText(extractedText) {
  const candidateTrialIds = Array.from(
    new Set(
      (String(extractedText || '').match(/\bNCT\d{8}\b/gi) || [])
        .map((value) => normalizeText(value).toUpperCase())
        .filter((trialId) => Boolean(getSupportedTrialSeed(trialId)))
    )
  );

  if (candidateTrialIds.length === 1) {
    const metadata = await syncTrialRegistryToFirestore(candidateTrialIds[0]);
    return buildConfiguredTrialBindingFields(candidateTrialIds[0], metadata, 'pdf_text_unique_match');
  }

  if (candidateTrialIds.length > 1) {
    return buildUnresolvedTrialBindingFields('multiple_supported_trials_detected', candidateTrialIds);
  }

  return buildUnresolvedTrialBindingFields('no_supported_trial_detected', []);
}

function conditionFamilyFromSummaryStrict(value) {
  const text = normalizeLowerText(value);
  if (!text) {
    throw new HttpsError(
      'failed-precondition',
      'Strict protocol static-context extraction did not produce a valid condition_summary.'
    );
  }

  const familyMap = [
    [0, ['cancer', 'oncology', 'carcinoma', 'tumor', 'tumour', 'lymphoma', 'leukemia', 'neoplasm', 'glioma', 'melanoma']],
    [1, ['cardio', 'heart', 'hypertension', 'vascular', 'myocard', 'coronary', 'arrhythm']],
    [2, ['neurolog', 'parkinson', 'alzheimer', 'epilep', 'migraine', 'multiple sclerosis', 'stroke', 'dementia']],
    [3, ['respirat', 'asthma', 'copd', 'pneumonia', 'covid', 'infection', 'infectious', 'hepatitis', 'hiv', 'influenza', 'pulmonary']],
    [4, ['diabetes', 'endocr', 'metabolic', 'renal', 'kidney', 'obesity', 'thyroid', 'neph']],
    [5, ['depress', 'schizophrenia', 'bipolar', 'anxiety', 'mental', 'psych', 'behavior', 'behaviour', 'substance use', 'addiction']],
    [6, ['autoimmune', 'immun', 'inflamm', 'rheumatoid', 'arthritis', 'lupus', 'psoriasis', 'crohn', 'colitis', 'dermatitis']],
  ];

  for (const [familyCode, keywords] of familyMap) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return familyCode;
    }
  }

  return 7;
}

function normalizeStrictGeminiStaticContext(rawContext, { manualTrialPhaseOverride = null } = {}) {
  const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
  const extractedTrialPhaseLabel = normalizeText(context.trial_phase_label);
  if (!extractedTrialPhaseLabel) {
    throw new HttpsError(
      'failed-precondition',
      'Strict protocol static-context extraction did not produce a valid trial_phase_label.'
    );
  }
  const parsedExtractedTrialPhase = tryParseTrialPhaseLabel(extractedTrialPhaseLabel);
  if (parsedExtractedTrialPhase == null) {
    throw new HttpsError(
      'failed-precondition',
      `Strict protocol static-context extraction produced an unsupported trial_phase_label: ${context.trial_phase_label}`
    );
  }
  if (manualTrialPhaseOverride == null && !ALLOWED_DISENGAGEMENT_TRIAL_PHASES.has(parsedExtractedTrialPhase)) {
    throw new HttpsError(
      'failed-precondition',
      `Strict protocol static-context extraction produced a trial phase outside the allowed disengagement whitelist: ${context.trial_phase_label}`
    );
  }
  return {
    trial_phase: manualTrialPhaseOverride == null ? parsedExtractedTrialPhase : manualTrialPhaseOverride,
    condition_family: conditionFamilyFromSummaryStrict(context.condition_summary),
    enrollment: requireFiniteNumber('enrollment', context.enrollment, { min: 1 }),
    criteria_complexity: requireFiniteNumber('criteria_complexity', context.criteria_complexity, { min: 1 }),
    has_device_intervention: requireBooleanLike('has_device_intervention', context.has_device_intervention),
    has_drug_intervention: requireBooleanLike('has_drug_intervention', context.has_drug_intervention),
    has_behavioral_intervention: requireBooleanLike(
      'has_behavioral_intervention',
      context.has_behavioral_intervention
    ),
    has_procedure_intervention: requireBooleanLike(
      'has_procedure_intervention',
      context.has_procedure_intervention
    ),
  };
}

function buildFinalStoragePath(protocolId, protocolName) {
  const safeName = sanitizeFileName(protocolName);
  return `protocol-templates/${protocolId}/${Date.now()}-${safeName}`;
}

function buildDefaultProtocolTemplateFields() {
  return {
    notification_policy: deepClone(DEFAULT_NOTIFICATION_POLICY),
    vital_templates: deepClone(DEFAULT_VITAL_TEMPLATES),
    monitoredVitals: ['temperature', 'spo2', 'bp'],
    dropout_trial_id: '',
    dropout_trial_status: 'not_configured',
    dropout_trial_label: null,
    dropout_trial_pool_size: null,
    dropout_trial_model_version: null,
    dropout_trial_last_verified_at: null,
    dropout_trial_last_synced_at: null,
    dropout_trial_sync_source: null,
    dropout_trial_sync_error: null,
  };
}

function buildStrictProtocolDocument({
  protocolName,
  finalStoragePath,
  uploadedAt,
  staticContext,
  protocolTrialFields,
  extractedText,
  manualTrialPhaseOverride,
  extractedTrialPhaseLabel,
  extractedTrialPhaseResolved,
  actor,
  existingData = {},
}) {
  const defaults = buildDefaultProtocolTemplateFields();
  return {
    ...defaults,
    ...existingData,
    ...protocolTrialFields,
    name: protocolName,
    storagePath: finalStoragePath,
    uploadedAt,
    dropout_static_context: staticContext,
    extraction_status: 'ready',
    extraction_error: null,
    extracted_at: uploadedAt,
    extractor_version: EXTRACTOR_VERSION,
    source_pdf_path: finalStoragePath,
    extracted_text_preview: String(extractedText || '').slice(0, 4000),
    dropout_static_context_override:
      manualTrialPhaseOverride == null
        ? null
        : {
            field: 'trial_phase',
            override_value: manualTrialPhaseOverride,
            extracted_trial_phase_label: normalizeText(extractedTrialPhaseLabel),
            extracted_trial_phase_resolved:
              extractedTrialPhaseResolved == null ? null : Number(extractedTrialPhaseResolved),
            applied_at: uploadedAt,
            applied_by_uid: normalizeText(actor?.uid),
            applied_by_email: normalizeText(actor?.email),
          },
    guidance_index_status: 'indexing',
    guidance_index_error: null,
    guidance_indexed_at: null,
    updatedAt: uploadedAt,
  };
}

export const finalizeUploadedProtocolTemplate = onCall(
  { invoker: 'public', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    const actor = await assertAuthenticatedCrcRequest(request);

    const protocolId = normalizeText(request.data?.protocolId);
    const protocolName = normalizeText(request.data?.protocolName);
    const stagedStorageBucket = normalizeText(request.data?.stagedStorageBucket) || DEFAULT_STORAGE_BUCKET;
    const stagedStoragePath = normalizeText(request.data?.stagedStoragePath);
    const manualTrialPhaseOverride = normalizeManualTrialPhaseOverride(request.data?.manualTrialPhaseOverride);

    if (!protocolName) {
      throw new HttpsError('invalid-argument', 'protocolName is required.');
    }
    if (!stagedStoragePath) {
      throw new HttpsError('invalid-argument', 'stagedStoragePath is required.');
    }

    let protocolRef = protocolId ? db.collection('protocols').doc(protocolId) : db.collection('protocols').doc();
    let existingSnapshot = null;
    if (protocolId) {
      existingSnapshot = await protocolRef.get();
      if (!existingSnapshot.exists) {
        throw new HttpsError('not-found', 'Protocol template not found.');
      }
    }

    let finalStoragePath = '';
    let movedToFinalPath = false;
    try {
      const fileBytes = await downloadSupabaseFileBytes({
        storageBucket: stagedStorageBucket,
        storagePath: stagedStoragePath,
      });
      const extractedText = await extractPdfText(fileBytes);
      if (!normalizeText(extractedText)) {
        throw new HttpsError(
          'failed-precondition',
          'Strict protocol PDF text extraction succeeded technically, but no readable text was recovered from the uploaded PDF.'
        );
      }

      const rawGeminiContext = await requestGeminiStaticContext(protocolName, extractedText);
      const strictStaticContext = normalizeStrictGeminiStaticContext(rawGeminiContext, {
        manualTrialPhaseOverride,
      });
      const parsedExtractedTrialPhase = tryParseTrialPhaseLabel(rawGeminiContext?.trial_phase_label);
      const protocolTrialFields = await resolveProtocolTrialBindingFromExtractedText(extractedText);
      const uploadedAt = nowIso();

      finalStoragePath = buildFinalStoragePath(protocolRef.id, protocolName);
      await moveSupabaseFile({
        storageBucket: stagedStorageBucket,
        fromPath: stagedStoragePath,
        toPath: finalStoragePath,
      });
      movedToFinalPath = true;

      const existingData = existingSnapshot?.exists ? existingSnapshot.data() || {} : {};
      const nextProtocolDocument = buildStrictProtocolDocument({
        protocolName,
        finalStoragePath,
        uploadedAt,
        staticContext: strictStaticContext,
        protocolTrialFields,
        extractedText,
        manualTrialPhaseOverride,
        extractedTrialPhaseLabel: rawGeminiContext?.trial_phase_label,
        extractedTrialPhaseResolved: parsedExtractedTrialPhase,
        actor,
        existingData,
      });

      await protocolRef.set(nextProtocolDocument, { merge: true });
      await updateAssignedPatientsForProtocol(protocolRef.id, nextProtocolDocument);

      return {
        protocolId: protocolRef.id,
        protocol: {
          id: protocolRef.id,
          ...nextProtocolDocument,
        },
      };
    } catch (error) {
      if (movedToFinalPath && finalStoragePath) {
        await removeSupabaseFile({
          storageBucket: stagedStorageBucket,
          storagePath: finalStoragePath,
        });
      } else {
        await removeSupabaseFile({
          storageBucket: stagedStorageBucket,
          storagePath: stagedStoragePath,
        });
      }
      throw error;
    }
  }
);

export const reconcileProtocolDropoutTrialBinding = onCall(
  { invoker: 'public', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    await assertAuthenticatedCrcRequest(request);

    const protocolId = normalizeText(request.data?.protocolId);
    if (!protocolId) {
      throw new HttpsError('invalid-argument', 'protocolId is required.');
    }

    const protocolRef = db.collection('protocols').doc(protocolId);
    const protocolSnapshot = await protocolRef.get();
    if (!protocolSnapshot.exists) {
      throw new HttpsError('not-found', 'Protocol template not found.');
    }

    const protocolData = protocolSnapshot.data() || {};
    if (normalizeLowerText(protocolData.extraction_status || '') !== 'ready') {
      throw new HttpsError(
        'failed-precondition',
        'This protocol cannot reconcile its disengagement dataset trial until strict static-context extraction is ready.'
      );
    }

    const storagePath = normalizeText(protocolData.storagePath || protocolData.source_pdf_path);
    if (!storagePath) {
      throw new HttpsError(
        'failed-precondition',
        'This protocol is missing its stored PDF path, so the disengagement dataset trial cannot be reconciled automatically.'
      );
    }

    const fileBytes = await downloadSupabaseFileBytes({
      storageBucket: DEFAULT_STORAGE_BUCKET,
      storagePath,
    });
    const extractedText = await extractPdfText(fileBytes);
    if (!normalizeText(extractedText)) {
      throw new HttpsError(
        'failed-precondition',
        'Strict protocol PDF text extraction succeeded technically, but no readable text was recovered from the stored PDF.'
      );
    }

    const protocolTrialFields = await resolveProtocolTrialBindingFromExtractedText(extractedText);
    await protocolRef.set(
      {
        ...protocolTrialFields,
        extracted_text_preview: String(extractedText || '').slice(0, 4000),
        updatedAt: nowIso(),
      },
      { merge: true }
    );
    const assignedPatientCount = await updateAssignedPatientsForProtocol(protocolId, protocolTrialFields);

    return {
      protocol_id: protocolId,
      assigned_patient_count: assignedPatientCount,
      ...protocolTrialFields,
    };
  }
);
