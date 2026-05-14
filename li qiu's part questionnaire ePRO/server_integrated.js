require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI, TaskType } = require('@google/generative-ai');

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8081',
  'https://triallight.web.app',
  'https://triallight-patient.web.app',
];

function parseAllowedOrigins(rawValue) {
  if (!rawValue || !String(rawValue).trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return String(rawValue)
    .split(',')
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/$/, '');
      if (allowedOrigins.includes('*') || allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' }) : null;

const configPath = path.join(__dirname, 'epro_config.json');
const baselineConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const SUBJECT_SESSIONS = new Map();
const LEGACY_STATE = { subjectId: null };
const MAX_TRIAL_DAY = 30;
const SOURCE_SYSTEM = 'triallight-epro-service';

function cloneBaselineConfig() {
  return JSON.parse(JSON.stringify(baselineConfig));
}

function normalizeBaselineQuestionType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'boolean' || normalized === 'numeric_scale' || normalized === 'text') {
    return normalized;
  }
  return 'text';
}

function normalizeConditionalOperator(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'greater_than' || normalized === 'less_than') {
    return normalized;
  }
  return 'equals';
}

function ensureBooleanSuffix(questionText) {
  if (/\(yes\/no\)/i.test(questionText)) {
    return questionText;
  }
  return `${questionText} (Yes/No)`;
}

function ensureScaleSuffix(questionText) {
  if (/\b0\s*[-to]+\s*10\b/i.test(questionText) || /\(0-10\)/i.test(questionText)) {
    return questionText;
  }
  return `${questionText} (0-10)`;
}

function sanitizeBaselineQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions)) {
    return cloneBaselineConfig();
  }

  const preliminary = rawQuestions
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }

      const questionText = normalizeQuestionText(candidate.question_text ?? candidate.question);
      if (!questionText) {
        return null;
      }

      return {
        originalQuestionId: String(candidate.question_id ?? candidate.id ?? `AUTO_${index + 1}`).trim() || `AUTO_${index + 1}`,
        questionText,
        questionType: normalizeBaselineQuestionType(candidate.question_type ?? candidate.type),
        tier: String(candidate.tier || 'BASE').trim().toUpperCase() === 'CONDITIONAL' ? 'CONDITIONAL' : 'BASE',
        conditionalLogic: candidate.conditional_logic || null,
      };
    })
    .filter(Boolean);

  if (!preliminary.length) {
    return cloneBaselineConfig();
  }

  const idMap = new Map();
  preliminary.forEach((entry, index) => {
    idMap.set(entry.originalQuestionId, `ePRO_${String(index + 1).padStart(3, '0')}`);
  });

  const sanitized = [];
  const baseQuestionIds = [];

  preliminary.forEach((entry) => {
    const questionId = idMap.get(entry.originalQuestionId);
    let questionText = entry.questionText;

    if (entry.questionType === 'boolean') {
      questionText = ensureBooleanSuffix(questionText);
    }
    if (entry.questionType === 'numeric_scale') {
      questionText = ensureScaleSuffix(questionText);
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
          entry.conditionalLogic && Object.prototype.hasOwnProperty.call(entry.conditionalLogic, 'value')
            ? entry.conditionalLogic.value
            : true,
      },
    });
  });

  const hasBaseQuestion = sanitized.some((entry) => entry.tier === 'BASE');
  return sanitized.length && hasBaseQuestion ? sanitized : cloneBaselineConfig();
}

async function buildProtocolQueryEmbedding(queryText) {
  if (!genAI) {
    return null;
  }

  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const embeddingResult = await embeddingModel.embedContent({
    content: { parts: [{ text: queryText }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return embeddingResult?.embedding?.values || null;
}

async function fetchProtocolContextChunks({ protocolId, protocolName }) {
  const cleanProtocolId = String(protocolId || '').trim();
  const cleanProtocolName = cleanProtocolId ? '' : String(protocolName || '').trim();

  if (!cleanProtocolId && !cleanProtocolName) {
    return [];
  }

  try {
    const queryEmbedding = await buildProtocolQueryEmbedding(
      'daily patient reported outcome questionnaire, diary questions, safety signals, symptom follow-up, primary endpoints'
    );

    if (queryEmbedding?.length) {
      const { data: matches, error } = await supabase.rpc('match_guidance_documents', {
        query_embedding: queryEmbedding,
        match_count: 8,
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
  } catch (error) {
    console.warn('Protocol semantic retrieval fallback activated:', error.message);
  }

  let queryBuilder = supabase
    .from('guidance_documents')
    .select('protocol_id, protocol_name, title, page, chunk_index, content')
    .eq('source_type', 'protocol');

  if (cleanProtocolId) {
    queryBuilder = queryBuilder.eq('protocol_id', cleanProtocolId);
  } else if (cleanProtocolName) {
    queryBuilder = queryBuilder.eq('protocol_name', cleanProtocolName);
  }

  const { data } = await queryBuilder.order('chunk_index', { ascending: true }).limit(12);
  return Array.isArray(data) ? data : [];
}

function buildProtocolBaselinePrompt({ protocolId, protocolName, protocolChunks }) {
  const excerptText = protocolChunks
    .map((entry, index) => {
      const page = entry.page ?? 'Unknown';
      const title = String(entry.title || protocolName || protocolId || 'Protocol');
      return `[Excerpt ${index + 1} | ${title} | page ${page}]\n${normalizeQuestionText(entry.content)}`;
    })
    .join('\n\n---\n\n');

  return `
You are a clinical trial questionnaire architect.

Create the BASELINE daily ePRO questionnaire for this protocol.

PROTOCOL:
- Protocol ID: ${protocolId || 'unknown'}
- Protocol name: ${protocolName || 'unknown'}

PROTOCOL EXCERPTS:
${excerptText}

STRICT OUTPUT RULES:
1. Return ONLY a valid JSON array. No markdown or extra explanation.
2. Each object must contain:
   - "question_id"
   - "question_text"
   - "question_type" ("boolean", "numeric_scale", or "text")
   - "tier" ("BASE" or "CONDITIONAL")
   - "conditional_logic" (null for BASE, object for CONDITIONAL)
3. BASE questions are mandatory daily gatekeeper questions.
4. CONDITIONAL questions are follow-up detail questions tied to a BASE question.
5. Use only patient-friendly English.
6. Keep the questionnaire grounded in the protocol excerpts only.
7. Prefer 6 to 16 total questions unless the excerpts clearly support fewer.
8. Every numeric_scale question must be a 0-10 severity or interference scale.
9. Use this conditional logic shape:
   {
     "question_id": "parent base question id",
     "operator": "equals",
     "value": true
   }
`;
}

async function generateProtocolBaselineConfig({ protocolId, protocolName }) {
  if (!model) {
    return cloneBaselineConfig();
  }

  const protocolChunks = await fetchProtocolContextChunks({ protocolId, protocolName });
  if (!protocolChunks.length) {
    return cloneBaselineConfig();
  }

  try {
    const result = await model.generateContent(
      buildProtocolBaselinePrompt({ protocolId, protocolName, protocolChunks })
    );
    const parsed = JSON.parse(
      result.response
        .text()
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim()
    );
    return sanitizeBaselineQuestions(parsed);
  } catch (error) {
    console.warn('Protocol baseline generation fallback activated:', error.message);
    return cloneBaselineConfig();
  }
}

function normalizeQuestionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeQuestionType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'boolean' ? 'boolean' : 'text';
}

function sanitizeCustomQuestions(rawQuestions, currentDay) {
  const candidates = Array.isArray(rawQuestions)
    ? rawQuestions
    : Array.isArray(rawQuestions?.custom_questions)
      ? rawQuestions.custom_questions
      : [];

  const normalized = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const questionText = normalizeQuestionText(candidate.question_text ?? candidate.question);
    if (!questionText) {
      continue;
    }
    const questionType = normalizeQuestionType(candidate.question_type ?? candidate.type);
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
    if (normalized.length >= 2) {
      break;
    }
  }
  return normalized;
}

function sanitizeSubjectId(subjectId) {
  return String(subjectId || '').trim();
}

function buildFallbackProfile(subjectId, patientName) {
  return {
    patient_id: subjectId,
    name: patientName || `Subject ${subjectId}`,
    medical_history: [],
    vitals_logged: {
      blood_pressure: 'Unknown',
      heart_rate: 'Unknown',
      temperature_celsius: 'Unknown',
    },
    chat_history: [],
  };
}

async function getPatientProfile(subjectId, patientName) {
  try {
    const { data, error } = await supabase
      .from('mock_patient_profiles')
      .select('*')
      .eq('patient_id', subjectId)
      .single();

    if (error || !data) {
      return buildFallbackProfile(subjectId, patientName);
    }

    return data;
  } catch (error) {
    console.warn('Profile fallback activated:', error.message);
    return buildFallbackProfile(subjectId, patientName);
  }
}

function buildFormId(subjectId, day) {
  return `${subjectId}-day-${day}`;
}

function nextDueDate(fromIsoString) {
  const baseDate = fromIsoString ? new Date(fromIsoString) : new Date();
  return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

async function ensureSession(subjectId, patientName, protocolIdInput = null, protocolNameInput = null) {
  const cleanSubjectId = sanitizeSubjectId(subjectId);
  if (!cleanSubjectId) {
    throw new Error('subject_id is required');
  }

  const protocolId = String(protocolIdInput || '').trim() || null;
  const protocolName = String(protocolNameInput || '').trim() || null;

  let session = SUBJECT_SESSIONS.get(cleanSubjectId);
  if (!session) {
    const activePatient = await getPatientProfile(cleanSubjectId, patientName);
    const assignedAt = new Date().toISOString();
    const protocolBaselineCache = await generateProtocolBaselineConfig({ protocolId, protocolName });
    session = {
      subjectId: cleanSubjectId,
      activePatient,
      protocolId,
      protocolName,
      currentDay: 1,
      protocolBaselineCache,
      currentConfigCache: protocolBaselineCache,
      assignedAt,
      dueAt: nextDueDate(assignedAt),
      localHistory: [],
    };
    await generateNextDayConfig(session);
    SUBJECT_SESSIONS.set(cleanSubjectId, session);
  } else if (patientName) {
    session.activePatient.name = patientName;
    const nextProtocolId = protocolId || session.protocolId || null;
    const nextProtocolName = protocolName || session.protocolName || null;
    if (nextProtocolId !== session.protocolId || nextProtocolName !== session.protocolName) {
      session.protocolId = nextProtocolId;
      session.protocolName = nextProtocolName;
      session.protocolBaselineCache = await generateProtocolBaselineConfig({
        protocolId: session.protocolId,
        protocolName: session.protocolName,
      });
      session.currentConfigCache = session.protocolBaselineCache;
    }
  }

  return session;
}

async function fetchRecentHistory(session) {
  try {
    const { data, error } = await supabase
      .from('patient_daily_logs')
      .select('day_number, answers')
      .eq('patient_id', session.subjectId)
      .order('day_number', { ascending: false })
      .limit(3);

    if (error) {
      throw error;
    }

    if (Array.isArray(data) && data.length > 0) {
      return [...data].reverse();
    }
  } catch (error) {
    console.warn(`History fallback for ${session.subjectId}:`, error.message);
  }

  return session.localHistory.slice(-3);
}

async function persistSurveyResponse(session, answers) {
  const record = {
    patient_id: session.subjectId,
    day_number: session.currentDay,
    answers,
  };

  session.localHistory.push(record);

  try {
    const { error } = await supabase.from('patient_daily_logs').insert(record);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.warn(`Supabase persistence fallback for ${session.subjectId}:`, error.message);
  }
}

function buildGenerationPrompt(session, recentHistory) {
  const patient = session.activePatient || buildFallbackProfile(session.subjectId);
  const baselineQuestions =
    Array.isArray(session.protocolBaselineCache) && session.protocolBaselineCache.length
      ? session.protocolBaselineCache
      : cloneBaselineConfig();

  return `
You are generating only the OPTIONAL customized section for a clinical ePRO form.

PATIENT:
- Name: ${patient.name || session.subjectId}
- Day number: ${session.currentDay}
- Protocol ID: ${session.protocolId || 'unknown'}
- Protocol name: ${session.protocolName || 'unknown'}
- Medical History: ${(patient.medical_history || []).join(', ') || 'Not provided'}
- Recent vitals summary: ${JSON.stringify(patient.vitals_logged || {})}
- Recent AI chat summary: ${JSON.stringify(patient.chat_history || [])}

RECENT EPRO HISTORY (LAST 3 DAYS):
${JSON.stringify(recentHistory, null, 2)}

IMMUTABLE BASELINE PROTOCOL QUESTIONS:
${JSON.stringify(baselineQuestions, null, 2)}

STRICT GENERATION RULES:
1. Do NOT rewrite, remove, reorder, or replace any baseline protocol question.
2. You may add at most 2 customized questions.
3. Customized questions may use ONLY medical history, recent vitals, recent side effects if present, and recent AI chat history.
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

async function generateNextDayConfig(session) {
  const baselineQuestions =
    Array.isArray(session.protocolBaselineCache) && session.protocolBaselineCache.length
      ? session.protocolBaselineCache
      : cloneBaselineConfig();

  if (!model) {
    session.currentConfigCache = baselineQuestions;
    return;
  }

  try {
    const recentHistory = await fetchRecentHistory(session);
    const prompt = buildGenerationPrompt(session, recentHistory);
    const result = await model.generateContent(prompt);
    const responseText = result.response
      .text()
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const parsed = JSON.parse(responseText);
    const customQuestions = sanitizeCustomQuestions(parsed, session.currentDay);
    session.currentConfigCache = [...baselineQuestions, ...customQuestions];
  } catch (error) {
    console.warn(`AI questionnaire generation fallback for ${session.subjectId}:`, error.message);
    session.currentConfigCache = baselineQuestions;
  }
}

function dailySurveyResponse(session) {
  if (session.currentDay > MAX_TRIAL_DAY) {
    return {
      trial_complete: true,
      subject_id: session.subjectId,
      patient_name: session.activePatient?.name || session.subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  return {
    subject_id: session.subjectId,
    patient_name: session.activePatient?.name || session.subjectId,
    patientName: session.activePatient?.name || session.subjectId,
    day: session.currentDay,
    day_number: session.currentDay,
    form_id: buildFormId(session.subjectId, session.currentDay),
    assigned_at: session.assignedAt,
    due_at: session.dueAt,
    status: 'assigned',
    source_system: SOURCE_SYSTEM,
    question_count: session.currentConfigCache.length,
    questions: session.currentConfigCache,
  };
}

async function handleDailySurvey(subjectId, patientName, protocolId, protocolName) {
  const session = await ensureSession(subjectId, patientName, protocolId, protocolName);
  return dailySurveyResponse(session);
}

async function handleSubmit(subjectId, patientName, answers, protocolId, protocolName) {
  const session = await ensureSession(subjectId, patientName, protocolId, protocolName);

  if (session.currentDay > MAX_TRIAL_DAY) {
    return {
      trial_complete: true,
      subject_id: session.subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  const submittedAt = new Date().toISOString();
  const assignedAt = session.assignedAt || submittedAt;
  const completionLatencySec = Math.max(
    0,
    Math.round((new Date(submittedAt).getTime() - new Date(assignedAt).getTime()) / 1000)
  );
  const formId = buildFormId(session.subjectId, session.currentDay);

  await persistSurveyResponse(session, answers || {});

  session.currentDay += 1;
  if (session.currentDay <= MAX_TRIAL_DAY) {
    await generateNextDayConfig(session);
    session.assignedAt = new Date().toISOString();
    session.dueAt = nextDueDate(session.assignedAt);
  } else {
    session.assignedAt = null;
    session.dueAt = null;
  }

  return {
    success: true,
    subject_id: session.subjectId,
    day_number: session.currentDay - 1,
    form_id: formId,
    status: 'submitted',
    assigned_at: assignedAt,
    submitted_at: submittedAt,
    completion_latency_sec: completionLatencySec,
    source_system: SOURCE_SYSTEM,
    next_day: session.currentDay <= MAX_TRIAL_DAY ? session.currentDay : null,
    trial_complete: session.currentDay > MAX_TRIAL_DAY,
  };
}

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', source_system: SOURCE_SYSTEM });
});

app.get('/api/epro/daily-survey', async (req, res) => {
  try {
    const payload = await handleDailySurvey(
      req.query.subject_id,
      req.query.patient_name,
      req.query.protocol_id,
      req.query.protocol_name
    );
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/epro/submit', async (req, res) => {
  try {
    const payload = await handleSubmit(
      req.body.subject_id,
      req.body.patient_name,
      req.body.answers,
      req.body.protocol_id,
      req.body.protocol_name
    );
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/start-simulation', async (req, res) => {
  try {
    const subjectId = sanitizeSubjectId(req.body.patientId);
    const session = await ensureSession(
      subjectId,
      req.body.patientName,
      req.body.protocol_id,
      req.body.protocol_name
    );
    LEGACY_STATE.subjectId = subjectId;
    session.currentDay = 1;
    session.protocolId = String(req.body.protocol_id || session.protocolId || '').trim() || null;
    session.protocolName = String(req.body.protocol_name || session.protocolName || '').trim() || null;
    session.protocolBaselineCache = await generateProtocolBaselineConfig({
      protocolId: session.protocolId,
      protocolName: session.protocolName,
    });
    session.currentConfigCache = session.protocolBaselineCache;
    session.assignedAt = new Date().toISOString();
    session.dueAt = nextDueDate(session.assignedAt);
    session.localHistory = [];

    res.json({
      success: true,
      day: session.currentDay,
      patient: session.activePatient?.name || subjectId,
      subject_id: session.subjectId,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/daily-survey', async (_req, res) => {
  if (!LEGACY_STATE.subjectId) {
    return res.status(400).json({ error: 'No patient loaded. Please start simulation.' });
  }

  try {
    const payload = await handleDailySurvey(LEGACY_STATE.subjectId);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/submit-survey', async (req, res) => {
  if (!LEGACY_STATE.subjectId) {
    return res.status(400).json({ error: 'No patient loaded. Please start simulation.' });
  }

  try {
    const payload = await handleSubmit(LEGACY_STATE.subjectId, null, req.body.answers);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TrialLight ePRO service running on http://0.0.0.0:${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log('Available endpoints:');
  console.log('  GET  /healthz');
  console.log('  GET  /api/epro/daily-survey?subject_id=...');
  console.log('  POST /api/epro/submit');
  console.log('Legacy demo endpoints remain available under /api/start-simulation, /api/daily-survey, /api/submit-survey');
});
