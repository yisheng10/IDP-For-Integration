import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const EXTRACTOR_VERSION = 'dropout-static-context-v1';
const TEXT_LIMIT = 45000;
const DEFAULT_BUCKET = 'protocol';
const pdfjs = pdfjsLib.default || pdfjsLib;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    execute: false,
    protocolIds: [],
    help: false,
  };

  argv.forEach((entry) => {
    if (entry === '--execute') {
      args.execute = true;
      return;
    }
    if (entry === '--help' || entry === '-h') {
      args.help = true;
      return;
    }
    if (entry.startsWith('--protocol-ids=')) {
      args.protocolIds = entry
        .slice('--protocol-ids='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      return;
    }
  });

  return args;
}

function usage() {
  console.log(`Usage:
  node functions/scripts/backfill-protocol-static-context.mjs [--execute] [--protocol-ids=id1,id2]

Environment:
  TARGET_FIREBASE_SERVICE_ACCOUNT_JSON   Required. Terry Firebase project service account path.
  SUPABASE_URL                          Required. Supabase URL for protocol storage.
  SUPABASE_SERVICE_ROLE_KEY             Required. Supabase service role key.
  GEMINI_API_KEY                        Required.

Behavior:
  - Default mode is dry-run and only reports which protocols would be updated
  - --execute writes dropout_static_context back into Firestore protocols/{protocolId}
  - Strict mode only: Gemini extraction must succeed and produce a complete static context
  - Existing fallback_only protocol states are no longer accepted
`);
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
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
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function requestGeminiStaticContext(protocol, extractedText) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });

  const prompt = `
You are extracting structured trial metadata for a disengagement prediction model.
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
`.trim();

  const result = await model.generateContent(prompt);
  return extractJsonObject(result.response.text());
}

function requireFiniteNumber(fieldName, value, { min = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Strict protocol static-context extraction did not produce a valid ${fieldName}.`);
  }
  return parsed;
}

function requireBooleanLike(fieldName, value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = normalizeText(value);
  if (['1', 'true', 'yes', 'y', 'present'].includes(text)) return 1;
  if (['0', 'false', 'no', 'n', 'absent'].includes(text)) return 0;
  throw new Error(`Strict protocol static-context extraction did not produce a valid ${fieldName}.`);
}

function mapTrialPhaseStrict(value) {
  const text = normalizeText(value);
  if (!text) {
    throw new Error('Strict protocol static-context extraction did not produce a valid trial_phase_label.');
  }
  if (text.includes('early phase 1')) return 0;
  if (/\bphase\s*1\b/.test(text)) return 1;
  if (/\bphase\s*2\b/.test(text)) return 2;
  if (/\bphase\s*3\b/.test(text)) return 3;
  if (/\bphase\s*4\b/.test(text)) return 4;
  throw new Error(`Strict protocol static-context extraction produced an unsupported trial_phase_label: ${value}`);
}

function normalizeGeminiStaticContext(rawContext) {
  const context = rawContext || {};
  return {
    trial_phase: mapTrialPhaseStrict(context.trial_phase_label),
    condition_family: conditionFamilyFromText(context.condition_summary),
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

async function downloadSupabaseFileBytes(storageBucket, storagePath) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.storage.from(storageBucket).download(storagePath);
  if (error) {
    throw new Error(`Failed to download ${storageBucket}/${storagePath}: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractPdfText(fileBytes) {
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

  return pageTexts.join('\n');
}

async function main() {
  loadEnvFile();
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const serviceAccountPath = process.env.TARGET_FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (!serviceAccountPath) {
    usage();
    throw new Error('TARGET_FIREBASE_SERVICE_ACCOUNT_JSON is required.');
  }

  const app = initApp('protocol-static-context-backfill', serviceAccountPath);
  const db = app.firestore();

  let protocolSnapshots = [];
  if (args.protocolIds.length) {
    protocolSnapshots = (
      await Promise.all(args.protocolIds.map((protocolId) => db.collection('protocols').doc(protocolId).get()))
    ).filter((snapshot) => snapshot.exists);
  } else {
    const snapshot = await db.collection('protocols').get();
    protocolSnapshots = snapshot.docs;
  }

  const candidates = protocolSnapshots.filter((snapshot) => !(snapshot.data() || {}).dropout_static_context);
  const summary = {
    execute: args.execute,
    totalProtocolsSeen: protocolSnapshots.length,
    candidates: [],
    updatedCount: 0,
  };

  for (const snapshot of candidates) {
    const protocol = snapshot.data() || {};
    const storagePath = String(protocol.storagePath || '').trim();
    if (!storagePath) {
      summary.candidates.push({
        protocolId: snapshot.id,
        protocolName: protocol.name || null,
        skipped: 'missing_storage_path',
      });
      continue;
    }

    try {
      const fileBytes = await downloadSupabaseFileBytes(DEFAULT_BUCKET, storagePath);
      const extractedText = await extractPdfText(fileBytes);
      const rawGemini = await requestGeminiStaticContext(protocol, extractedText);
      const staticContext = normalizeGeminiStaticContext(rawGemini);

      summary.candidates.push({
        protocolId: snapshot.id,
        protocolName: protocol.name || null,
        extractionStatus: 'ready',
        storagePath,
        staticContext,
      });

      if (args.execute) {
        await snapshot.ref.set(
          {
            dropout_static_context: staticContext,
            extraction_status: 'ready',
            extraction_error: null,
            extracted_at: new Date().toISOString(),
            extractor_version: EXTRACTOR_VERSION,
            source_pdf_path: storagePath,
            extracted_text_preview: String(extractedText || '').slice(0, 4000),
          },
          { merge: true }
        );
        summary.updatedCount += 1;
      }
    } catch (error) {
      summary.candidates.push({
        protocolId: snapshot.id,
        protocolName: protocol.name || null,
        extractionStatus: 'error',
        storagePath,
        error: error?.message || String(error || 'Unknown extraction error'),
      });

      if (args.execute) {
        await snapshot.ref.set(
          {
            extraction_status: 'error',
            extraction_error: error?.message || String(error || 'Unknown extraction error'),
            extracted_at: new Date().toISOString(),
            extractor_version: EXTRACTOR_VERSION,
            source_pdf_path: storagePath,
          },
          { merge: true }
        );
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await app.delete();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
