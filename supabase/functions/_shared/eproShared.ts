import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { baselineConfig } from './baselineConfig.ts';
import { loadRealtimePromptContext } from './firestorePromptContext.ts';

export const MAX_TRIAL_DAY = 30;
export const MAX_CUSTOM_QUESTIONS = 2;
export const SOURCE_SYSTEM = 'triallight-epro-supabase';
export const ALLOWED_CUSTOM_TYPES = new Set(['boolean', 'text']);

export type ServiceClient = ReturnType<typeof getServiceClient>;
export type EproQuestion = {
  question_id: string;
  question_text: string;
  question_type: string;
  tier: string;
  conditional_logic: Record<string, unknown> | null;
};

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

function buildGenerationPrompt({
  currentDay,
  patientName,
  recentHistory,
  promptContext,
}: {
  currentDay: number;
  patientName: string;
  recentHistory: Array<Record<string, unknown>>;
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

REAL-TIME FIRESTORE CONTEXT:
- Recent vitals summary: ${JSON.stringify(promptContext.recentVitalsSummary)}
- Recent side effect summary: ${JSON.stringify(promptContext.recentSideEffectSummary)}
- Recent AI chat summary: ${JSON.stringify(promptContext.recentChatSummary)}
- Context counts: ${JSON.stringify(promptContext.contextCounts)}

RECENT EPRO HISTORY (LAST 3 DAYS):
${JSON.stringify(recentHistory, null, 2)}

IMMUTABLE BASELINE PROTOCOL QUESTIONS:
${JSON.stringify(baselineConfig, null, 2)}

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
  firebaseUid,
  firebaseToken,
}: {
  client: ServiceClient;
  subjectId: string;
  currentDay: number;
  patientName: string;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const baseline = cloneBaselineConfig();
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
