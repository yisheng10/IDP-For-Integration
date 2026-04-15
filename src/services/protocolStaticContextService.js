import { GoogleGenerativeAI } from '@google/generative-ai';
import { doc, updateDoc } from 'firebase/firestore';
import { GEMINI_API_KEY } from '../config';
import { db } from '../firebase';
import { extractTextFromPdf } from '../utils';
import { getSignedUrl } from './storageService';

const EXTRACTOR_VERSION = 'dropout-static-context-v1';
const TEXT_LIMIT = 45000;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function coercePositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function coerceBinary(value, fallback = 0) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = normalizeText(value);
  if (['1', 'true', 'yes', 'y', 'present'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n', 'absent'].includes(text)) return 0;
  return fallback;
}

function mapTrialPhase(value, textSource = '') {
  const text = `${normalizeText(value)} ${normalizeText(textSource)}`;
  if (text.includes('early phase 1')) return 0;
  if (/\bphase\s*1\b/.test(text)) return 1;
  if (/\bphase\s*2\b/.test(text)) return 2;
  if (/\bphase\s*3\b/.test(text)) return 3;
  if (/\bphase\s*4\b/.test(text)) return 4;
  return 2;
}

function conditionFamilyFromText(...parts) {
  const text = parts.map((entry) => normalizeText(entry)).join(' ');
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

function findEnrollment(text) {
  const patterns = [
    /enrollment[^0-9]{0,40}(\d{1,5})/i,
    /sample size[^0-9]{0,40}(\d{1,5})/i,
    /participants?[^0-9]{0,25}(\d{1,5})/i,
    /target[^0-9]{0,20}enrollment[^0-9]{0,20}(\d{1,5})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return coercePositiveNumber(match[1], 120);
  }
  return 120;
}

function estimateCriteriaComplexity(text) {
  const lower = normalizeText(text);
  const eligibilitySection = lower.split('eligibility')[1] || lower.split('inclusion criteria')[1] || lower;
  const bulletMatches = eligibilitySection.match(/(\n|\r|•|- |\* )/g) || [];
  const numberedMatches = eligibilitySection.match(/\b\d+\./g) || [];
  const criteriaCount = bulletMatches.length + numberedMatches.length;
  return Math.max(5, Math.min(criteriaCount || 20, 60));
}

function detectInterventionFlag(text, keywords) {
  return Number(keywords.some((keyword) => text.includes(keyword)));
}

function fallbackStaticContext({ extractedText = '', protocol = {} }) {
  const combinedText = `${protocol.name || ''}\n${extractedText}`;
  const normalized = normalizeText(combinedText);
  return {
    trial_phase: mapTrialPhase(protocol.phase, combinedText),
    condition_family: conditionFamilyFromText(protocol.name, combinedText),
    enrollment: findEnrollment(combinedText),
    criteria_complexity: estimateCriteriaComplexity(combinedText),
    has_device_intervention: detectInterventionFlag(normalized, ['device', 'implant', 'monitor', 'wearable', 'sensor']),
    has_drug_intervention: detectInterventionFlag(normalized, ['drug', 'medication', 'tablet', 'capsule', 'dose', 'pharmac']),
    has_behavioral_intervention: detectInterventionFlag(normalized, ['behavioral', 'behavioural', 'counseling', 'coaching', 'therapy', 'education']),
    has_procedure_intervention: detectInterventionFlag(normalized, ['procedure', 'surgery', 'biopsy', 'infusion', 'operation']),
  };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

async function requestGeminiStaticContext(protocol, extractedText) {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured.');
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `
You are extracting structured trial metadata for a dropout prediction model.
Return JSON only.

Protocol name:
${protocol.name || ''}

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
`;

  const result = await model.generateContent(prompt);
  return extractJsonObject(result.response.text());
}

function normalizeGeminiStaticContext(rawContext, protocol, extractedText) {
  const fallback = fallbackStaticContext({ extractedText, protocol });
  const context = rawContext || {};
  return {
    trial_phase: mapTrialPhase(context.trial_phase_label, extractedText),
    condition_family: conditionFamilyFromText(context.condition_summary, protocol.name, extractedText),
    enrollment: coercePositiveNumber(context.enrollment, fallback.enrollment),
    criteria_complexity: coercePositiveNumber(context.criteria_complexity, fallback.criteria_complexity),
    has_device_intervention: coerceBinary(context.has_device_intervention, fallback.has_device_intervention),
    has_drug_intervention: coerceBinary(context.has_drug_intervention, fallback.has_drug_intervention),
    has_behavioral_intervention: coerceBinary(context.has_behavioral_intervention, fallback.has_behavioral_intervention),
    has_procedure_intervention: coerceBinary(context.has_procedure_intervention, fallback.has_procedure_intervention),
  };
}

export async function extractProtocolDropoutStaticContext(protocol) {
  if (!protocol?.storagePath) {
    throw new Error('Protocol storage path is missing.');
  }

  const signedUrl = await getSignedUrl(protocol.storagePath, 'protocol');
  if (!signedUrl) {
    throw new Error('Could not authorize protocol PDF access.');
  }

  const extractedText = await extractTextFromPdf(signedUrl);
  if (!extractedText) {
    throw new Error('Could not extract text from protocol PDF.');
  }

  let extractionStatus = 'fallback_only';
  let rawGemini = null;

  try {
    rawGemini = await requestGeminiStaticContext(protocol, extractedText);
    if (rawGemini) {
      extractionStatus = 'ready';
    }
  } catch (_) {
    extractionStatus = 'fallback_only';
  }

  return {
    dropout_static_context: normalizeGeminiStaticContext(rawGemini, protocol, extractedText),
    extraction_status: extractionStatus,
    extracted_text_preview: String(extractedText || '').slice(0, 4000),
  };
}

export async function extractAndPersistProtocolDropoutStaticContext(protocolId, protocol) {
  const protocolRef = doc(db, 'protocols', protocolId);
  await updateDoc(protocolRef, {
    extraction_status: 'extracting',
    extracted_at: new Date().toISOString(),
    extractor_version: EXTRACTOR_VERSION,
    source_pdf_path: protocol.storagePath || '',
  });

  try {
    const extracted = await extractProtocolDropoutStaticContext(protocol);
    await updateDoc(protocolRef, {
      dropout_static_context: extracted.dropout_static_context,
      extraction_status: extracted.extraction_status,
      extracted_at: new Date().toISOString(),
      extractor_version: EXTRACTOR_VERSION,
      source_pdf_path: protocol.storagePath || '',
      extracted_text_preview: extracted.extracted_text_preview,
    });
    return extracted;
  } catch (error) {
    await updateDoc(protocolRef, {
      extraction_status: 'error',
      extraction_error: String(error?.message || error || 'Unknown extraction error'),
      extracted_at: new Date().toISOString(),
      extractor_version: EXTRACTOR_VERSION,
      source_pdf_path: protocol.storagePath || '',
    });
    throw error;
  }
}
