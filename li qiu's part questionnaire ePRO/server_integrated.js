require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
const MAX_TRIAL_DAY = 4;
const SOURCE_SYSTEM = 'triallight-epro-service';

function cloneBaselineConfig() {
  return JSON.parse(JSON.stringify(baselineConfig));
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
    dropout_risk: { level: 'unknown' },
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

async function ensureSession(subjectId, patientName) {
  const cleanSubjectId = sanitizeSubjectId(subjectId);
  if (!cleanSubjectId) {
    throw new Error('subject_id is required');
  }

  let session = SUBJECT_SESSIONS.get(cleanSubjectId);
  if (!session) {
    const activePatient = await getPatientProfile(cleanSubjectId, patientName);
    const assignedAt = new Date().toISOString();
    session = {
      subjectId: cleanSubjectId,
      activePatient,
      currentDay: 1,
      currentConfigCache: cloneBaselineConfig(),
      assignedAt,
      dueAt: nextDueDate(assignedAt),
      localHistory: [],
    };
    SUBJECT_SESSIONS.set(cleanSubjectId, session);
  } else if (patientName) {
    session.activePatient.name = patientName;
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

  return `
You are a Continuous Clinical Trial AI Orchestrator.
Generate the JSON configuration for the patient's DAY ${session.currentDay} ePRO questionnaire.

PATIENT PROFILE:
- Medical History: ${(patient.medical_history || []).join(', ')}
- Vitals: BP ${patient.vitals_logged?.blood_pressure || 'Unknown'}, HR ${patient.vitals_logged?.heart_rate || 'Unknown'}, Temp ${patient.vitals_logged?.temperature_celsius || 'Unknown'}C
- Chatbot Complaints: ${JSON.stringify(patient.chat_history || [])}
- Dropout Risk: ${patient.dropout_risk?.level || 'unknown'}

RECENT PATIENT TREND (LAST 3 DAYS):
${JSON.stringify(recentHistory, null, 2)}

======================================
THE IMMUTABLE ORIGINAL PROTOCOL:
${JSON.stringify(baselineConfig, null, 2)}
======================================

STRICT GENERATION RULES:
1. THE GATEKEEPER RULE: You MUST ALWAYS include the primary boolean (Yes/No) "BASE" questions from the Original Protocol.
2. THE PARENT-CHILD RULE: If the patient answered "No" to a BASE symptom yesterday, REMOVE related CONDITIONAL questions today. If they answered "Yes", KEEP the CONDITIONAL questions.
3. SMART BURDEN: ONLY remove a 0-10 scale if the patient explicitly gave it a rating of 1 or 2 yesterday. If the scale was missing yesterday but the BASE symptom was "Yes", RESTORE the scale.
4. RELAPSE CATCHER: If the patient answers "Yes" to a gatekeeper today, restore the associated rating scale tomorrow.
5. AI CUSTOMIZATION: If chatbot complaints mention a new symptom, invent ONE specific CONDITIONAL question for it.
6. QUESTION FORMAT: Add "(0-10)" for rating and "(Yes/No)" for boolean.

OUTPUT JSON FORMAT EXACTLY:
[{"id":"...","tier":"BASE or CONDITIONAL","question":"..."}]
`;
}

async function generateNextDayConfig(session) {
  if (!model) {
    session.currentConfigCache = cloneBaselineConfig();
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
    session.currentConfigCache = Array.isArray(parsed) && parsed.length > 0 ? parsed : cloneBaselineConfig();
  } catch (error) {
    console.warn(`AI questionnaire generation fallback for ${session.subjectId}:`, error.message);
    session.currentConfigCache = cloneBaselineConfig();
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
    form_id: buildFormId(session.subjectId, session.currentDay),
    assigned_at: session.assignedAt,
    due_at: session.dueAt,
    status: 'assigned',
    source_system: SOURCE_SYSTEM,
    questions: session.currentConfigCache,
  };
}

async function handleDailySurvey(subjectId, patientName) {
  const session = await ensureSession(subjectId, patientName);
  return dailySurveyResponse(session);
}

async function handleSubmit(subjectId, patientName, answers) {
  const session = await ensureSession(subjectId, patientName);

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
    const payload = await handleDailySurvey(req.query.subject_id, req.query.patient_name);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/epro/submit', async (req, res) => {
  try {
    const payload = await handleSubmit(req.body.subject_id, req.body.patient_name, req.body.answers);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/start-simulation', async (req, res) => {
  try {
    const subjectId = sanitizeSubjectId(req.body.patientId);
    const session = await ensureSession(subjectId, req.body.patientName);
    LEGACY_STATE.subjectId = subjectId;
    session.currentDay = 1;
    session.currentConfigCache = cloneBaselineConfig();
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
