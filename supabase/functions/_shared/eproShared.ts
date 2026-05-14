import { GoogleGenerativeAI, TaskType } from 'npm:@google/generative-ai@0.24.1';
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { baselineConfig } from './baselineConfig.ts';
import { loadRealtimePromptContext } from './firestorePromptContext.ts';

export const MAX_TRIAL_DAY = 30;
export const MAX_CUSTOM_QUESTIONS = 2;
export const SOURCE_SYSTEM = 'triallight-epro-supabase';
export const ALLOWED_CUSTOM_TYPES = new Set(['boolean', 'text']);
export const ALLOWED_BASELINE_TYPES = new Set(['boolean', 'numeric_scale', 'text']);
export const PROTOCOL_BASELINE_MATCH_COUNT = 8;
export const PROTOCOL_BASELINE_FALLBACK_COUNT = 12;
const SHARED_BASELINE_ANCHORS = [
  {
    key: 'pain',
    question_text: 'How would you rate your pain today? (0-10)',
    question_type: 'numeric_scale',
  },
  {
    key: 'anxiety',
    question_text: 'How would you rate your anxiety today? (0-10)',
    question_type: 'numeric_scale',
  },
  {
    key: 'stress',
    question_text: 'How would you rate your stress today? (0-10)',
    question_type: 'numeric_scale',
  },
] as const;

export type ServiceClient = ReturnType<typeof getServiceClient>;
export type EproQuestion = {
  question_id: string;
  question_text: string;
  question_type: string;
  tier: string;
  conditional_logic: Record<string, unknown> | null;
};

export class EproProtocolBaselineError extends Error {
  code: string;
  protocolId: string | null;
  protocolName: string | null;

  constructor({
    code,
    message,
    protocolId = null,
    protocolName = null,
  }: {
    code: string;
    message: string;
    protocolId?: string | null;
    protocolName?: string | null;
  }) {
    super(message);
    this.name = 'EproProtocolBaselineError';
    this.code = code;
    this.protocolId = protocolId;
    this.protocolName = protocolName;
  }
}

export function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Supabase service role configuration is missing for ePRO.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function cloneBaselineConfig(): EproQuestion[] {
  return JSON.parse(JSON.stringify(baselineConfig));
}

function deepCloneQuestions(questions: EproQuestion[]): EproQuestion[] {
  return JSON.parse(JSON.stringify(questions));
}

function nextGeneratedQuestionId(questions: EproQuestion[]) {
  let highestSeen = 0;
  for (const question of questions) {
    const match = /^ePRO_(\d+)$/i.exec(String(question.question_id || '').trim());
    if (!match) {
      continue;
    }
    highestSeen = Math.max(highestSeen, Number(match[1]) || 0);
  }

  return () => {
    highestSeen += 1;
    return `ePRO_${String(highestSeen).padStart(3, '0')}`;
  };
}

function hasSharedAnchorQuestion(questions: EproQuestion[], anchorKey: string) {
  return questions.some((question) => {
    const questionText = normalizeQuestionText(question.question_text).toLowerCase();
    if (String(question.question_type || '').trim().toLowerCase() !== 'numeric_scale') {
      return false;
    }

    if (anchorKey === 'pain') {
      return (
        questionText.includes('pain') &&
        !questionText.includes('interfered') &&
        !questionText.includes('bothersome')
      );
    }

    if (anchorKey === 'anxiety') {
      return questionText.includes('anxiety') || questionText.includes('anxious');
    }

    if (anchorKey === 'stress') {
      return questionText.includes('stress');
    }

    return false;
  });
}

function ensureSharedBaselineAnchors(questions: EproQuestion[]) {
  const normalized = deepCloneQuestions(questions);
  const createQuestionId = nextGeneratedQuestionId(normalized);
  const missingAnchors = SHARED_BASELINE_ANCHORS.filter(
    (anchor) => !hasSharedAnchorQuestion(normalized, anchor.key)
  );

  if (!missingAnchors.length) {
    return normalized;
  }

  const insertionIndex = normalized.findIndex(
    (question) => String(question.tier || '').trim().toUpperCase() === 'CONDITIONAL'
  );
  const anchorQuestions = missingAnchors.map((anchor) => ({
    question_id: createQuestionId(),
    question_text: anchor.question_text,
    question_type: anchor.question_type,
    tier: 'BASE',
    conditional_logic: null,
  })) as EproQuestion[];

  if (insertionIndex < 0) {
    normalized.push(...anchorQuestions);
    return normalized;
  }

  normalized.splice(insertionIndex, 0, ...anchorQuestions);
  return normalized;
}

function canonicalizeQuestionForComparison(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const raw = candidate as Record<string, unknown>;
  const rawConditional =
    raw.conditional_logic && typeof raw.conditional_logic === 'object' && !Array.isArray(raw.conditional_logic)
      ? (raw.conditional_logic as Record<string, unknown>)
      : null;

  return {
    question_id: String(raw.question_id || raw.id || '').trim(),
    question_text: normalizeQuestionText(raw.question_text ?? raw.question),
    question_type: normalizeBaselineQuestionType(raw.question_type ?? raw.type),
    tier: String(raw.tier || '').trim().toUpperCase() || 'BASE',
    conditional_logic: rawConditional
      ? {
          question_id: String(rawConditional.question_id || '').trim(),
          operator: normalizeConditionalOperator(rawConditional.operator),
          value: 'value' in rawConditional ? rawConditional.value : true,
        }
      : null,
  };
}

function sameQuestions(left: unknown, right: unknown) {
  const normalizeSide = (value: unknown) => {
    if (!Array.isArray(value)) {
      return value || null;
    }
    return value.map(canonicalizeQuestionForComparison);
  };

  return JSON.stringify(normalizeSide(left)) === JSON.stringify(normalizeSide(right));
}

export function isExactGlobalFallbackBaseline(questions: unknown) {
  return sameQuestions(questions, cloneBaselineConfig());
}

export function ensureProtocolSpecificBaselineQuestions({
  questions,
  protocolId,
  protocolName,
  sourceLabel,
}: {
  questions: unknown;
  protocolId?: string | null;
  protocolName?: string | null;
  sourceLabel: string;
}) {
  const cleanProtocolId = String(protocolId || '').trim();
  const cleanProtocolName = String(protocolName || '').trim();
  const normalizedQuestions = Array.isArray(questions) ? (questions as EproQuestion[]) : [];

  if (!normalizedQuestions.length) {
    throw new EproProtocolBaselineError({
      code: 'protocol_baseline_missing',
      message: `${sourceLabel} does not contain a protocol-specific ePRO baseline questionnaire for ${cleanProtocolName || cleanProtocolId || 'this patient'}.`,
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }

  if (isExactGlobalFallbackBaseline(normalizedQuestions)) {
    throw new EproProtocolBaselineError({
      code: 'protocol_baseline_fallback_detected',
      message: `${sourceLabel} is still using the deprecated global fallback questionnaire instead of a protocol-specific ePRO baseline for ${cleanProtocolName || cleanProtocolId || 'this patient'}.`,
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }

  return ensureSharedBaselineAnchors(normalizedQuestions);
}

export function sanitizeSubjectId(subjectId: string | null | undefined) {
  return String(subjectId || '').trim();
}

export function nextDueDate(fromIsoString?: string | null) {
  const baseDate = fromIsoString ? new Date(fromIsoString) : new Date();
  return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function buildFormId(subjectId: string, day: number) {
  return `${subjectId}-day-${day}`;
}

export function normalizeQuestionText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeQuestionType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_CUSTOM_TYPES.has(normalized) ? normalized : 'text';
}

export function normalizeBaselineQuestionType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_BASELINE_TYPES.has(normalized) ? normalized : 'text';
}

export function extractNumericAnswer(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function averageScores(values: number[]) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stripCodeFence(value: string) {
  return value.replace(/```json/gi, '').replace(/```/g, '').trim();
}

export function normalizeRecentAnswers(answers: unknown) {
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    return answers as Record<string, unknown>;
  }
  if (typeof answers === 'string' && answers.trim()) {
    try {
      const parsed = JSON.parse(answers);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function buildRecentHistorySummary(historyRows: Array<Record<string, unknown>>) {
  return historyRows.map((entry) => ({
    day_number: entry.day_number,
    answers: normalizeRecentAnswers(entry.answers),
  }));
}

export function sanitizeCustomQuestions(rawQuestions: unknown, currentDay: number) {
  const candidates = Array.isArray(rawQuestions)
    ? rawQuestions
    : Array.isArray((rawQuestions as { custom_questions?: unknown[] } | null)?.custom_questions)
      ? (rawQuestions as { custom_questions: unknown[] }).custom_questions
      : [];

  const normalized: EproQuestion[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const questionText = normalizeQuestionText(
      (candidate as { question_text?: unknown; question?: unknown }).question_text ??
        (candidate as { question?: unknown }).question
    );
    if (!questionText) {
      continue;
    }
    const questionType = normalizeQuestionType(
      (candidate as { question_type?: unknown; type?: unknown }).question_type ??
        (candidate as { type?: unknown }).type
    );
    normalized.push({
      question_id: `ePRO_CUSTOM_D${String(currentDay).padStart(2, '0')}_${String(index + 1).padStart(2, '0')}`,
      question_text:
        questionType === 'boolean' && !/\(yes\/no\)/i.test(questionText)
          ? `${questionText} (Yes/No)`
          : questionText,
      question_type: questionType,
      tier: 'CUSTOM',
      conditional_logic: null,
    });
    if (normalized.length >= MAX_CUSTOM_QUESTIONS) {
      break;
    }
  }
  return normalized;
}

function normalizeConditionalOperator(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'greater_than' || normalized === 'less_than') {
    return normalized;
  }
  return 'equals';
}

function normalizeBooleanSuffix(questionText: string) {
  if (/\(yes\/no\)/i.test(questionText)) {
    return questionText;
  }
  return `${questionText} (Yes/No)`;
}

function normalizeScaleSuffix(questionText: string) {
  if (/\b0\s*[-to]+\s*10\b/i.test(questionText) || /\(0-10\)/i.test(questionText)) {
    return questionText;
  }
  return `${questionText} (0-10)`;
}

export function sanitizeBaselineQuestions(rawQuestions: unknown) {
  if (!Array.isArray(rawQuestions)) {
    return cloneBaselineConfig();
  }

  const preliminary = rawQuestions
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }

      const questionText = normalizeQuestionText(
        (candidate as { question_text?: unknown; question?: unknown }).question_text ??
          (candidate as { question?: unknown }).question
      );
      if (!questionText) {
        return null;
      }

      const questionType = normalizeBaselineQuestionType(
        (candidate as { question_type?: unknown; type?: unknown }).question_type ??
          (candidate as { type?: unknown }).type
      );
      const normalizedTier = String(
        (candidate as { tier?: unknown }).tier || 'BASE'
      )
        .trim()
        .toUpperCase();
      const tier = normalizedTier === 'CONDITIONAL' ? 'CONDITIONAL' : 'BASE';
      const originalQuestionId = String(
        (candidate as { question_id?: unknown; id?: unknown }).question_id ??
          (candidate as { id?: unknown }).id ??
          `AUTO_${index + 1}`
      ).trim();

      const conditionalLogic =
        (candidate as { conditional_logic?: Record<string, unknown> | null }).conditional_logic || null;

      return {
        originalQuestionId: originalQuestionId || `AUTO_${index + 1}`,
        questionText,
        questionType,
        tier,
        conditionalLogic,
      };
    })
    .filter(Boolean) as Array<{
    originalQuestionId: string;
    questionText: string;
    questionType: string;
    tier: 'BASE' | 'CONDITIONAL';
    conditionalLogic: Record<string, unknown> | null;
  }>;

  if (!preliminary.length) {
    return cloneBaselineConfig();
  }

  const idMap = new Map<string, string>();
  preliminary.forEach((entry, index) => {
    idMap.set(entry.originalQuestionId, `ePRO_${String(index + 1).padStart(3, '0')}`);
  });

  const sanitized: EproQuestion[] = [];
  const baseQuestionIds: string[] = [];

  preliminary.forEach((entry) => {
    const questionId = idMap.get(entry.originalQuestionId) || `ePRO_${String(sanitized.length + 1).padStart(3, '0')}`;
    let questionText = entry.questionText;

    if (entry.questionType === 'boolean') {
      questionText = normalizeBooleanSuffix(questionText);
    }
    if (entry.questionType === 'numeric_scale') {
      questionText = normalizeScaleSuffix(questionText);
    }

    if (entry.tier === 'BASE') {
      sanitized.push({
        question_id: questionId,
        question_text: questionText,
        question_type: entry.questionType,
        tier: 'BASE',
        conditional_logic: null,
      });
      baseQuestionIds.push(questionId);
      return;
    }

    const referencedOriginalId = String(entry.conditionalLogic?.question_id || '').trim();
    let parentQuestionId = referencedOriginalId ? idMap.get(referencedOriginalId) || null : null;

    if (!parentQuestionId && baseQuestionIds.length > 0) {
      parentQuestionId = baseQuestionIds[baseQuestionIds.length - 1];
    }

    if (!parentQuestionId) {
      return;
    }

    sanitized.push({
      question_id: questionId,
      question_text: questionText,
      question_type: entry.questionType,
      tier: 'CONDITIONAL',
      conditional_logic: {
        question_id: parentQuestionId,
        operator: normalizeConditionalOperator(entry.conditionalLogic?.operator),
        value:
          entry.conditionalLogic && 'value' in entry.conditionalLogic
            ? entry.conditionalLogic.value
            : true,
      },
    });
  });

  const hasBaseQuestion = sanitized.some((entry) => entry.tier === 'BASE');
  return sanitized.length && hasBaseQuestion ? sanitized : cloneBaselineConfig();
}

function sanitizeBaselineQuestionsStrict(rawQuestions: unknown) {
  if (!Array.isArray(rawQuestions)) {
    return null;
  }

  const sanitized = sanitizeBaselineQuestions(rawQuestions);
  if (sameQuestions(sanitized, cloneBaselineConfig())) {
    return null;
  }

  return ensureSharedBaselineAnchors(sanitized);
}

async function buildProtocolQueryEmbedding(queryText: string) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const embeddingResult = await embeddingModel.embedContent({
    content: { parts: [{ text: queryText }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });

  return embeddingResult?.embedding?.values || null;
}

async function fetchProtocolContextChunks({
  client,
  protocolId,
  protocolName,
}: {
  client: ServiceClient;
  protocolId?: string | null;
  protocolName?: string | null;
}) {
  const cleanProtocolId = String(protocolId || '').trim();
  const cleanProtocolName = cleanProtocolId ? '' : String(protocolName || '').trim();

  if (!cleanProtocolId && !cleanProtocolName) {
    return [];
  }

  const semanticQuery =
    'daily patient reported outcome questionnaire, diary questions, safety signals, symptom follow-up, primary endpoints';

  try {
    const queryEmbedding = await buildProtocolQueryEmbedding(semanticQuery);
    if (queryEmbedding?.length) {
      const { data: matches, error } = await client.rpc('match_guidance_documents', {
        query_embedding: queryEmbedding,
        match_count: PROTOCOL_BASELINE_MATCH_COUNT,
        _source_types: ['protocol'],
        _protocol_id: cleanProtocolId || null,
        _protocol_name: cleanProtocolName || null,
      });

      if (error) {
        throw error;
      }

      if (Array.isArray(matches) && matches.length > 0) {
        return matches;
      }
    }
  } catch {
    // Fall back to direct protocol chunk reads when semantic retrieval is unavailable.
  }

  let queryBuilder = client
    .from('guidance_documents')
    .select('protocol_id, protocol_name, title, page, chunk_index, content')
    .eq('source_type', 'protocol');

  if (cleanProtocolId) {
    queryBuilder = queryBuilder.eq('protocol_id', cleanProtocolId);
  } else if (cleanProtocolName) {
    queryBuilder = queryBuilder.eq('protocol_name', cleanProtocolName);
  }

  const { data } = await queryBuilder.order('chunk_index', { ascending: true }).limit(PROTOCOL_BASELINE_FALLBACK_COUNT);
  return Array.isArray(data) ? data : [];
}

function buildProtocolBaselinePrompt({
  protocolName,
  protocolId,
  protocolChunks,
}: {
  protocolName?: string | null;
  protocolId?: string | null;
  protocolChunks: Array<Record<string, unknown>>;
}) {
  const excerptText = protocolChunks
    .map((entry, index) => {
      const page = entry.page ?? 'Unknown';
      const title = String(entry.title || protocolName || protocolId || 'Protocol');
      const content = normalizeQuestionText(entry.content);
      return `[Excerpt ${index + 1} | ${title} | page ${page}]\n${content}`;
    })
    .join('\n\n---\n\n');

  return `
You are a clinical trial questionnaire architect.

Your job is to create the BASELINE daily ePRO questionnaire for one protocol.
The questionnaire must be grounded in the supplied protocol excerpts.

PROTOCOL:
- Protocol ID: ${protocolId || 'unknown'}
- Protocol name: ${protocolName || 'unknown'}

PROTOCOL EXCERPTS:
${excerptText}

STRICT OUTPUT RULES:
1. Return ONLY a valid JSON array. No markdown, no prose, no code fences.
2. Every item must include exactly these keys:
   - "question_id"
   - "question_text"
   - "question_type" ("boolean", "numeric_scale", or "text")
   - "tier" ("BASE" or "CONDITIONAL")
   - "conditional_logic" (null for BASE, object for CONDITIONAL)
3. BASE questions should be the mandatory daily gatekeeper questions the patient should always see first.
4. CONDITIONAL questions should only appear as follow-up detail questions after a matching BASE gatekeeper is answered positively.
5. Use patient-friendly English.
6. Keep the questionnaire focused on protocol-defined patient-reported outcomes, safety symptoms, and required daily diary capture.
7. Prefer 6 to 16 total questions unless the protocol evidence clearly supports fewer.
8. Every numeric_scale question must be a 0-10 style severity or interference scale.
9. Do not invent questions that are not supported by the protocol excerpts.

CONDITIONAL LOGIC FORMAT:
{
  "question_id": "the parent BASE question id",
  "operator": "equals",
  "value": true
}
`;
}

export async function buildProtocolBaselineQuestions({
  client,
  protocolId,
  protocolName,
}: {
  client: ServiceClient;
  protocolId?: string | null;
  protocolName?: string | null;
}) {
  const cleanProtocolId = String(protocolId || '').trim();
  const cleanProtocolName = String(protocolName || '').trim();

  if (!cleanProtocolId && !cleanProtocolName) {
    throw new EproProtocolBaselineError({
      code: 'protocol_not_assigned',
      message: 'This patient does not have an active protocol assigned for ePRO questionnaire generation yet.',
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }

  const protocolChunks = await fetchProtocolContextChunks({
    client,
    protocolId: cleanProtocolId,
    protocolName: cleanProtocolName,
  });

  if (!protocolChunks.length) {
    throw new EproProtocolBaselineError({
      code: 'protocol_chunks_missing',
      message: `No indexed protocol guidance chunks were found for ${cleanProtocolName || cleanProtocolId}, so TrialLight cannot generate a protocol-specific ePRO questionnaire yet.`,
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new EproProtocolBaselineError({
      code: 'gemini_key_missing',
      message: 'GEMINI_API_KEY is not configured in the ePRO runtime, so TrialLight cannot generate a protocol-specific questionnaire right now.',
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = buildProtocolBaselinePrompt({
      protocolId: cleanProtocolId,
      protocolName: cleanProtocolName,
      protocolChunks,
    });
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(stripCodeFence(result.response.text()));
    const sanitized = sanitizeBaselineQuestionsStrict(parsed);
    if (!sanitized?.length) {
      throw new EproProtocolBaselineError({
        code: 'protocol_generation_invalid',
        message: `TrialLight generated an invalid protocol-specific questionnaire draft for ${cleanProtocolName || cleanProtocolId}. CRC review is blocked until protocol ePRO generation succeeds.`,
        protocolId: cleanProtocolId || null,
        protocolName: cleanProtocolName || null,
      });
    }
    return sanitized;
  } catch (error) {
    if (error instanceof EproProtocolBaselineError) {
      throw error;
    }

    throw new EproProtocolBaselineError({
      code: 'protocol_generation_failed',
      message: `TrialLight could not generate a protocol-specific questionnaire for ${cleanProtocolName || cleanProtocolId}. ${(error as Error)?.message || 'Gemini generation failed.'}`,
      protocolId: cleanProtocolId || null,
      protocolName: cleanProtocolName || null,
    });
  }
}

function buildGenerationPrompt({
  currentDay,
  patientName,
  recentHistory,
  protocolId,
  protocolName,
  baselineQuestions,
  promptContext,
}: {
  currentDay: number;
  patientName: string;
  recentHistory: Array<Record<string, unknown>>;
  protocolId?: string | null;
  protocolName?: string | null;
  baselineQuestions: EproQuestion[];
  promptContext: {
    recentVitalsSummary: string[];
    recentSideEffectSummary: string[];
    recentChatSummary: string[];
    contextCounts: Record<string, number>;
  };
}) {
  return `
You are generating only the OPTIONAL customized section for a clinical ePRO form.

PATIENT:
- Name: ${patientName}
- Day number: ${currentDay}
- Protocol ID: ${protocolId || 'unknown'}
- Protocol name: ${protocolName || 'unknown'}

REAL-TIME FIRESTORE CONTEXT:
- Recent vitals summary: ${JSON.stringify(promptContext.recentVitalsSummary)}
- Recent side effect summary: ${JSON.stringify(promptContext.recentSideEffectSummary)}
- Recent AI chat summary: ${JSON.stringify(promptContext.recentChatSummary)}
- Context counts: ${JSON.stringify(promptContext.contextCounts)}

RECENT EPRO HISTORY (LAST 3 DAYS):
${JSON.stringify(recentHistory, null, 2)}

IMMUTABLE BASELINE PROTOCOL QUESTIONS:
${JSON.stringify(baselineQuestions, null, 2)}

STRICT RULES:
1. Do NOT rewrite, remove, reorder, or replace any baseline protocol question.
2. You may add at most 2 customized questions.
3. Customized questions may use ONLY these sources: recent vitals, recent side effects, recent AI chat history.
4. Do NOT use dropout risk in any way.
5. Customized questions must be appended after the baseline set.
6. Customized question types may ONLY be "boolean" or "text".
7. Do NOT create any 0-10 rating customized question.
8. If there is not enough meaningful context, return an empty array.

OUTPUT FORMAT:
Return JSON only.
Return either [] or:
[
  {
    "question_text": "...",
    "question_type": "boolean" | "text"
  }
]
`;
}

export async function fetchRecentHistory(client: ServiceClient, subjectId: string) {
  const { data } = await client
    .from('patient_daily_logs')
    .select('day_number, answers')
    .eq('patient_id', subjectId)
    .order('day_number', { ascending: false })
    .limit(3);

  return Array.isArray(data) ? [...data].reverse() : [];
}

export async function buildQuestionSet({
  client,
  subjectId,
  currentDay,
  patientName,
  protocolId,
  protocolName,
  baselineQuestions,
  firebaseUid,
  firebaseToken,
}: {
  client: ServiceClient;
  subjectId: string;
  currentDay: number;
  patientName: string;
  protocolId?: string | null;
  protocolName?: string | null;
  baselineQuestions?: EproQuestion[];
  firebaseUid: string;
  firebaseToken: string;
}) {
  const baseline = Array.isArray(baselineQuestions) && baselineQuestions.length
    ? deepCloneQuestions(baselineQuestions)
    : [];
  if (!baseline.length) {
    throw new Error(
      `A protocol-specific baseline questionnaire is required before TrialLight can generate patient-specific follow-up questions for ${protocolName || protocolId || subjectId}.`
    );
  }
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return baseline;
  }

  const recentHistory = buildRecentHistorySummary(await fetchRecentHistory(client, subjectId));
  let promptContext = {
    recentVitalsSummary: [] as string[],
    recentSideEffectSummary: [] as string[],
    recentChatSummary: [] as string[],
    contextCounts: { vitals: 0, sideEffects: 0, chatMessages: 0 },
  };

  try {
    promptContext = await loadRealtimePromptContext({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  } catch {
    promptContext = {
      recentVitalsSummary: [],
      recentSideEffectSummary: [],
      recentChatSummary: [],
      contextCounts: { vitals: 0, sideEffects: 0, chatMessages: 0 },
    };
  }

  const hasMeaningfulContext =
    promptContext.recentVitalsSummary.length > 0 ||
    promptContext.recentSideEffectSummary.length > 0 ||
    promptContext.recentChatSummary.length > 0;

  if (!hasMeaningfulContext) {
    return baseline;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = buildGenerationPrompt({
      currentDay,
      patientName,
      recentHistory,
      protocolId,
      protocolName,
      baselineQuestions: baseline,
      promptContext,
    });
    const result = await model.generateContent(prompt);
    const responseText = stripCodeFence(result.response.text());
    const parsed = JSON.parse(responseText);
    const customQuestions = sanitizeCustomQuestions(parsed, currentDay);
    return [...baseline, ...customQuestions];
  } catch {
    return baseline;
  }
}

export function buildAnswerSummary({
  questions,
  answers,
}: {
  questions: EproQuestion[];
  answers: Record<string, unknown>;
}) {
  const painScores: number[] = [];
  const anxietyScores: number[] = [];
  const basePositiveFlags: string[] = [];
  let hasFreeTextFollowup = false;

  for (const question of questions) {
    const questionId = String(question.question_id || '').trim();
    if (!questionId) {
      continue;
    }
    const rawAnswer = answers[questionId];
    const questionText = normalizeQuestionText(question.question_text).toLowerCase();
    const questionType = String(question.question_type || '').trim().toLowerCase();
    const numericValue = extractNumericAnswer(rawAnswer);

    if (String(question.tier || '').trim().toUpperCase() === 'BASE' && rawAnswer === true) {
      basePositiveFlags.push(questionId);
    }
    if (questionType === 'text' && String(rawAnswer || '').trim()) {
      hasFreeTextFollowup = true;
    }
    if (numericValue === null) {
      continue;
    }
    if (
      questionText.includes('pain') &&
      !questionText.includes('interfered') &&
      !questionText.includes('bothersome')
    ) {
      painScores.push(numericValue);
    }
    if (questionText.includes('anxiety')) {
      anxietyScores.push(numericValue);
    }
  }

  return {
    painScore: averageScores(painScores),
    anxietyScore: averageScores(anxietyScores),
    basePositiveFlags,
    hasFreeTextFollowup,
  };
}
