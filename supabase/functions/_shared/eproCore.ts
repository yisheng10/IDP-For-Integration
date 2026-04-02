import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { baselineConfig } from './baselineConfig.ts';
import {
  loadRealtimePromptContext,
  loadRealtimeUserIdentity,
  upsertUserEproSubmissionMirror,
} from './firestorePromptContext.ts';

const MAX_TRIAL_DAY = 30;
const MAX_CUSTOM_QUESTIONS = 2;
const SOURCE_SYSTEM = 'triallight-epro-supabase';
const ALLOWED_CUSTOM_TYPES = new Set(['boolean', 'text']);

type ServiceClient = ReturnType<typeof getServiceClient>;
type EproQuestion = {
  question_id: string;
  question_text: string;
  question_type: string;
  tier: string;
  conditional_logic: Record<string, unknown> | null;
};

function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Supabase service role configuration is missing for ePRO.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function cloneBaselineConfig(): EproQuestion[] {
  return JSON.parse(JSON.stringify(baselineConfig));
}

function sanitizeSubjectId(subjectId: string | null | undefined) {
  return String(subjectId || '').trim();
}

function nextDueDate(fromIsoString?: string | null) {
  const baseDate = fromIsoString ? new Date(fromIsoString) : new Date();
  return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function buildFormId(subjectId: string, day: number) {
  return `${subjectId}-day-${day}`;
}

function normalizeQuestionText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeQuestionType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_CUSTOM_TYPES.has(normalized) ? normalized : 'text';
}

function extractNumericAnswer(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function averageScores(values: number[]) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stripCodeFence(value: string) {
  return value.replace(/```json/gi, '').replace(/```/g, '').trim();
}

function normalizeRecentAnswers(answers: unknown) {
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

function buildRecentHistorySummary(historyRows: Array<Record<string, unknown>>) {
  return historyRows.map((entry) => ({
    day_number: entry.day_number,
    answers: normalizeRecentAnswers(entry.answers),
  }));
}

function sanitizeCustomQuestions(rawQuestions: unknown, currentDay: number) {
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

function buildAnswerSummary({
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

async function fetchRecentHistory(client: ServiceClient, subjectId: string) {
  const { data } = await client
    .from('patient_daily_logs')
    .select('day_number, answers')
    .eq('patient_id', subjectId)
    .order('day_number', { ascending: false })
    .limit(3);

  return Array.isArray(data) ? [...data].reverse() : [];
}

async function buildQuestionSet({
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
    promptContext = await loadRealtimePromptContext({ firebaseUid, firebaseToken });
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

async function ensureSubjectAccess(
  client: ServiceClient,
  requestedSubjectId: string,
  firebaseUid: string,
  firebaseToken: string
) {
  if (!requestedSubjectId || requestedSubjectId === firebaseUid) {
    return requestedSubjectId || firebaseUid;
  }

  const { data } = await client
    .from('epro_subject_state')
    .select('firebase_uid')
    .eq('subject_id', requestedSubjectId)
    .maybeSingle();

  if (!data || data.firebase_uid !== firebaseUid) {
    const identity = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken });
    if (identity.subject_id === requestedSubjectId) {
      return requestedSubjectId;
    }
    throw new Error('Requested subject_id is not linked to this authenticated patient.');
  }

  return requestedSubjectId;
}

export async function handleDailySurvey({
  requestedSubjectId,
  patientName,
  firebaseUid,
  firebaseToken,
}: {
  requestedSubjectId?: string | null;
  patientName?: string | null;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const client = getServiceClient();
  const subjectId = await ensureSubjectAccess(client, sanitizeSubjectId(requestedSubjectId), firebaseUid, firebaseToken);

  let { data: state } = await client
    .from('epro_subject_state')
    .select('*')
    .eq('subject_id', subjectId)
    .maybeSingle();

  if (!state) {
    const resolvedPatientName = patientName || `Subject ${subjectId}`;
    const initialQuestions = await buildQuestionSet({
      client,
      subjectId,
      currentDay: 1,
      patientName: resolvedPatientName,
      firebaseUid,
      firebaseToken,
    });
    state = {
      subject_id: subjectId,
      firebase_uid: firebaseUid,
      patient_name: resolvedPatientName,
      current_day: 1,
      assigned_at: new Date().toISOString(),
      due_at: nextDueDate(),
      current_questions: initialQuestions,
      trial_complete: false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await client.from('epro_subject_state').upsert(state, { onConflict: 'subject_id' });
    if (error) throw new Error(error.message);
  }

  if (state.trial_complete || Number(state.current_day) > MAX_TRIAL_DAY) {
    return {
      trial_complete: true,
      subject_id: subjectId,
      patient_name: state.patient_name || subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  const questions =
    Array.isArray(state.current_questions) && state.current_questions.length > 0
      ? state.current_questions
      : cloneBaselineConfig();
  const formId = buildFormId(subjectId, Number(state.current_day));

  await upsertUserEproSubmissionMirror({
    firebaseUid,
    firebaseToken,
    formId,
    payload: {
      subject_id: subjectId,
      form_id: formId,
      day_number: Number(state.current_day),
      assigned_at: state.assigned_at,
      due_at: state.due_at,
      submitted_at: null,
      status: 'assigned',
      question_count: questions.length,
      source_system: SOURCE_SYSTEM,
      updated_at: new Date().toISOString(),
    },
  });

  return {
    subject_id: subjectId,
    patient_name: state.patient_name || subjectId,
    patientName: state.patient_name || subjectId,
    day: state.current_day,
    day_number: state.current_day,
    form_id: formId,
    assigned_at: state.assigned_at,
    due_at: state.due_at,
    status: 'assigned',
    source_system: SOURCE_SYSTEM,
    question_count: questions.length,
    questions,
  };
}

export async function handleSubmit({
  requestedSubjectId,
  patientName,
  answers,
  firebaseUid,
  firebaseToken,
}: {
  requestedSubjectId?: string | null;
  patientName?: string | null;
  answers?: Record<string, unknown>;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const client = getServiceClient();
  const subjectId = await ensureSubjectAccess(client, sanitizeSubjectId(requestedSubjectId), firebaseUid, firebaseToken);

  const { data: currentState } = await client
    .from('epro_subject_state')
    .select('*')
    .eq('subject_id', subjectId)
    .maybeSingle();

  if (!currentState) {
    throw new Error('No questionnaire state exists for this subject yet.');
  }

  if (currentState.trial_complete || Number(currentState.current_day) > MAX_TRIAL_DAY) {
    return {
      trial_complete: true,
      subject_id: subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  const submittedAt = new Date().toISOString();
  const assignedAt = currentState.assigned_at || submittedAt;
  const completionLatencySec = Math.max(
    0,
    Math.round((new Date(submittedAt).getTime() - new Date(assignedAt).getTime()) / 1000)
  );
  const currentDay = Number(currentState.current_day);
  const formId = buildFormId(subjectId, currentDay);
  const currentQuestions =
    Array.isArray(currentState.current_questions) && currentState.current_questions.length > 0
      ? (currentState.current_questions as EproQuestion[])
      : cloneBaselineConfig();

  const { error: historyError } = await client.from('patient_daily_logs').insert({
    patient_id: subjectId,
    day_number: currentDay,
    answers: answers || {},
  });
  if (historyError) throw new Error(historyError.message);

  const nextDay = currentDay + 1;
  const resolvedPatientName = patientName || currentState.patient_name || `Subject ${subjectId}`;
  const answerSummary = buildAnswerSummary({
    questions: currentQuestions,
    answers: answers || {},
  });
  const nextQuestions =
    nextDay <= MAX_TRIAL_DAY
      ? await buildQuestionSet({
          client,
          subjectId,
          currentDay: nextDay,
          patientName: resolvedPatientName,
          firebaseUid,
          firebaseToken,
        })
      : [];

  const nextState = {
    subject_id: subjectId,
    firebase_uid: currentState.firebase_uid || firebaseUid,
    patient_name: resolvedPatientName,
    current_day: nextDay,
    assigned_at: nextDay <= MAX_TRIAL_DAY ? new Date().toISOString() : null,
    due_at: nextDay <= MAX_TRIAL_DAY ? nextDueDate() : null,
    current_questions: nextDay <= MAX_TRIAL_DAY ? nextQuestions : [],
    trial_complete: nextDay > MAX_TRIAL_DAY,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await client.from('epro_subject_state').upsert(nextState, { onConflict: 'subject_id' });
  if (updateError) throw new Error(updateError.message);

  await upsertUserEproSubmissionMirror({
    firebaseUid,
    firebaseToken,
    formId,
    payload: {
      subject_id: subjectId,
      form_id: formId,
      day_number: currentDay,
      assigned_at: assignedAt,
      due_at: currentState.due_at || null,
      submitted_at: submittedAt,
      status: 'submitted',
      completion_latency_sec: completionLatencySec,
      question_count: currentQuestions.length,
      pain_score: answerSummary.painScore,
      anxiety_score: answerSummary.anxietyScore,
      base_positive_flags: answerSummary.basePositiveFlags,
      has_free_text_followup: answerSummary.hasFreeTextFollowup,
      source_system: SOURCE_SYSTEM,
      updated_at: new Date().toISOString(),
    },
  });

  return {
    success: true,
    subject_id: subjectId,
    day_number: currentDay,
    form_id: formId,
    status: 'submitted',
    assigned_at: assignedAt,
    submitted_at: submittedAt,
    completion_latency_sec: completionLatencySec,
    source_system: SOURCE_SYSTEM,
    next_day: nextDay <= MAX_TRIAL_DAY ? nextDay : null,
    trial_complete: nextDay > MAX_TRIAL_DAY,
  };
}
