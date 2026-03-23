import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { baselineConfig } from './baselineConfig.ts';

const MAX_TRIAL_DAY = 4;
const SOURCE_SYSTEM = 'triallight-epro-supabase';

function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('Supabase service role configuration is missing for ePRO.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function cloneBaselineConfig() {
  return JSON.parse(JSON.stringify(baselineConfig));
}

function sanitizeSubjectId(subjectId: string | null | undefined) {
  return String(subjectId || '').trim();
}

function nextDueDate(fromIsoString?: string | null) {
  const baseDate = fromIsoString ? new Date(fromIsoString) : new Date();
  return new Date(baseDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

async function getPatientProfile(client: ReturnType<typeof getServiceClient>, subjectId: string, patientName?: string | null) {
  const { data } = await client
    .from('mock_patient_profiles')
    .select('*')
    .eq('patient_id', subjectId)
    .maybeSingle();

  return (
    data || {
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
    }
  );
}

function buildGenerationPrompt(state: Record<string, unknown>, patient: Record<string, unknown>, recentHistory: unknown[]) {
  return `
You are a Continuous Clinical Trial AI Orchestrator.
Generate the JSON configuration for the patient's DAY ${state.current_day} ePRO questionnaire.

PATIENT PROFILE:
- Medical History: ${((patient.medical_history as string[]) || []).join(', ')}
- Vitals: BP ${(patient.vitals_logged as Record<string, string>)?.blood_pressure || 'Unknown'}, HR ${(patient.vitals_logged as Record<string, string>)?.heart_rate || 'Unknown'}, Temp ${(patient.vitals_logged as Record<string, string>)?.temperature_celsius || 'Unknown'}C
- Chatbot Complaints: ${JSON.stringify((patient.chat_history as unknown[]) || [])}
- Dropout Risk: ${((patient.dropout_risk as Record<string, string>) || {}).level || 'unknown'}

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

async function fetchRecentHistory(client: ReturnType<typeof getServiceClient>, subjectId: string) {
  const { data } = await client
    .from('patient_daily_logs')
    .select('day_number, answers')
    .eq('patient_id', subjectId)
    .order('day_number', { ascending: false })
    .limit(3);

  return Array.isArray(data) ? [...data].reverse() : [];
}

async function generateNextDayConfig(client: ReturnType<typeof getServiceClient>, state: Record<string, unknown>, patient: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return cloneBaselineConfig();
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const recentHistory = await fetchRecentHistory(client, String(state.subject_id));
    const prompt = buildGenerationPrompt(state, patient, recentHistory);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(responseText);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : cloneBaselineConfig();
  } catch {
    return cloneBaselineConfig();
  }
}

function buildFormId(subjectId: string, day: number) {
  return `${subjectId}-day-${day}`;
}

async function ensureSubjectAccess(
  client: ReturnType<typeof getServiceClient>,
  requestedSubjectId: string,
  firebaseUid: string
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
    throw new Error('Requested subject_id is not linked to this authenticated patient.');
  }

  return requestedSubjectId;
}

export async function handleDailySurvey({
  requestedSubjectId,
  patientName,
  firebaseUid,
}: {
  requestedSubjectId?: string | null;
  patientName?: string | null;
  firebaseUid: string;
}) {
  const client = getServiceClient();
  const subjectId = await ensureSubjectAccess(client, sanitizeSubjectId(requestedSubjectId), firebaseUid);

  let { data: state } = await client
    .from('epro_subject_state')
    .select('*')
    .eq('subject_id', subjectId)
    .maybeSingle();

  if (!state) {
    state = {
      subject_id: subjectId,
      firebase_uid: firebaseUid,
      patient_name: patientName || `Subject ${subjectId}`,
      current_day: 1,
      assigned_at: new Date().toISOString(),
      due_at: nextDueDate(),
      current_questions: cloneBaselineConfig(),
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

  return {
    subject_id: subjectId,
    patient_name: state.patient_name || subjectId,
    patientName: state.patient_name || subjectId,
    day: state.current_day,
    form_id: buildFormId(subjectId, Number(state.current_day)),
    assigned_at: state.assigned_at,
    due_at: state.due_at,
    status: 'assigned',
    source_system: SOURCE_SYSTEM,
    questions: state.current_questions || cloneBaselineConfig(),
  };
}

export async function handleSubmit({
  requestedSubjectId,
  patientName,
  answers,
  firebaseUid,
}: {
  requestedSubjectId?: string | null;
  patientName?: string | null;
  answers?: Record<string, unknown>;
  firebaseUid: string;
}) {
  const client = getServiceClient();
  const subjectId = await ensureSubjectAccess(client, sanitizeSubjectId(requestedSubjectId), firebaseUid);

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
  const formId = buildFormId(subjectId, Number(currentState.current_day));

  const { error: historyError } = await client.from('patient_daily_logs').insert({
    patient_id: subjectId,
    day_number: currentState.current_day,
    answers: answers || {},
  });
  if (historyError) throw new Error(historyError.message);

  const nextDay = Number(currentState.current_day) + 1;
  const patient = await getPatientProfile(client, subjectId, patientName || currentState.patient_name);
  const nextQuestions =
    nextDay <= MAX_TRIAL_DAY ? await generateNextDayConfig(client, { ...currentState, current_day: nextDay }, patient) : [];

  const nextState = {
    subject_id: subjectId,
    firebase_uid: currentState.firebase_uid || firebaseUid,
    patient_name: patientName || currentState.patient_name || patient.name || subjectId,
    current_day: nextDay,
    assigned_at: nextDay <= MAX_TRIAL_DAY ? new Date().toISOString() : null,
    due_at: nextDay <= MAX_TRIAL_DAY ? nextDueDate() : null,
    current_questions: nextDay <= MAX_TRIAL_DAY ? nextQuestions : [],
    trial_complete: nextDay > MAX_TRIAL_DAY,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await client.from('epro_subject_state').upsert(nextState, { onConflict: 'subject_id' });
  if (updateError) throw new Error(updateError.message);

  return {
    success: true,
    subject_id: subjectId,
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

