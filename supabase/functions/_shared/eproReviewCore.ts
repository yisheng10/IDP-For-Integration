import {
  buildFormId,
  buildQuestionSet,
  cloneBaselineConfig,
  getServiceClient,
  MAX_TRIAL_DAY,
  SOURCE_SYSTEM,
} from './eproShared.ts';
import {
  loadRealtimeUserIdentity,
  upsertUserEproSubmissionMirror,
} from './firestorePromptContext.ts';

export const REVIEW_STATUS_PENDING = 'pending_crc_review';
export const REVIEW_STATUS_APPROVED = 'approved';
export const REVIEW_STATUS_AUTO_RELEASED = 'auto_released';

export const REVIEW_SCOPE_TRIAL = 'trial';
export const REVIEW_SCOPE_PATIENT_INHERITED = 'patient_inherited';
export const REVIEW_SCOPE_PATIENT_CUSTOMIZED = 'patient_customized';

const OPERATION_TIMEZONE = Deno.env.get('TRIALLIGHT_OPERATION_TZ') || 'Asia/Kuala_Lumpur';
const DRAFT_BUILD_HOUR_LOCAL = Number(Deno.env.get('EPRO_DRAFT_BUILD_HOUR_LOCAL') || 6);
const REVIEW_CUTOFF_HOUR_LOCAL = Number(Deno.env.get('EPRO_REVIEW_CUTOFF_HOUR_LOCAL') || 9);
const PATIENT_DUE_HOUR_LOCAL = Number(Deno.env.get('EPRO_PATIENT_DUE_HOUR_LOCAL') || 23);
const PATIENT_DUE_MINUTE_LOCAL = 59;

type ReviewWindow = {
  reviewDate: string;
  draftGenerationAt: string;
  reviewCutoffAt: string;
  patientDueAt: string;
  timeZone: string;
  cutoffPassed: boolean;
};

type ActivePatientInput = {
  firebase_uid?: string;
  uid?: string;
  id?: string;
  subject_id?: string;
  subjectId?: string;
  nickname?: string;
  patient_name?: string;
  patientName?: string;
  protocol_id?: string;
  protocolId?: string;
  protocol_name?: string;
  protocolName?: string;
};

type CrcActor = {
  uid: string;
  nickname: string;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function getLocalDateParts(date = new Date(), timeZone = OPERATION_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((entry) => entry.type === 'year')?.value || '1970';
  const month = parts.find((entry) => entry.type === 'month')?.value || '01';
  const day = parts.find((entry) => entry.type === 'day')?.value || '01';
  return { year, month, day };
}

function getOffsetString(date = new Date(), timeZone = OPERATION_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
  });
  const parts = formatter.formatToParts(date);
  const offsetToken = parts.find((entry) => entry.type === 'timeZoneName')?.value || 'GMT+0';
  const normalized = offsetToken.replace(/^GMT/i, '');
  const match = normalized.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return '+00:00';
  }
  const [, sign, hours, minutes] = match;
  return `${sign}${pad(Number(hours))}:${pad(Number(minutes || '0'))}`;
}

function buildLocalIso(
  reviewDate: string,
  hour: number,
  minute: number,
  timeZone = OPERATION_TIMEZONE,
  referenceDate = new Date()
) {
  return `${reviewDate}T${pad(hour)}:${pad(minute)}:00${getOffsetString(referenceDate, timeZone)}`;
}

export function getReviewWindow(now = new Date()): ReviewWindow {
  const { year, month, day } = getLocalDateParts(now, OPERATION_TIMEZONE);
  const reviewDate = `${year}-${month}-${day}`;
  const draftGenerationAt = buildLocalIso(reviewDate, DRAFT_BUILD_HOUR_LOCAL, 0, OPERATION_TIMEZONE, now);
  const reviewCutoffAt = buildLocalIso(reviewDate, REVIEW_CUTOFF_HOUR_LOCAL, 0, OPERATION_TIMEZONE, now);
  const patientDueAt = buildLocalIso(reviewDate, PATIENT_DUE_HOUR_LOCAL, PATIENT_DUE_MINUTE_LOCAL, OPERATION_TIMEZONE, now);
  return {
    reviewDate,
    draftGenerationAt,
    reviewCutoffAt,
    patientDueAt,
    timeZone: OPERATION_TIMEZONE,
    cutoffPassed: now.getTime() >= new Date(reviewCutoffAt).getTime(),
  };
}

function normalizeActivePatientInput(input: ActivePatientInput | null | undefined) {
  if (!input) {
    return null;
  }
  const firebaseUid = String(input.firebase_uid || input.uid || input.id || '').trim();
  const subjectId = String(input.subject_id || input.subjectId || firebaseUid).trim();
  if (!firebaseUid || !subjectId) {
    return null;
  }
  return {
    firebase_uid: firebaseUid,
    subject_id: subjectId,
    patient_name: String(input.nickname || input.patient_name || input.patientName || subjectId).trim(),
    protocol_id: String(input.protocol_id || input.protocolId || '').trim(),
    protocol_name: String(input.protocol_name || input.protocolName || '').trim(),
  };
}

function resolveTrialId(patient: ReturnType<typeof normalizeActivePatientInput>) {
  return patient?.protocol_id || patient?.protocol_name || 'default-epro';
}

function resolveProtocolName(patient: ReturnType<typeof normalizeActivePatientInput>) {
  return patient?.protocol_name || patient?.protocol_id || 'TrialLight baseline ePRO';
}

function normalizeOverrides(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, string>;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [String(key).trim(), String(entry || '').trim()])
      .filter(([key, entry]) => key && entry)
  );
}

function applyWordingOverrides(questions: Array<Record<string, unknown>>, overrides: unknown) {
  const safeOverrides = normalizeOverrides(overrides);
  return questions.map((question) => {
    const questionId = String(question.question_id || '').trim();
    const overrideText = safeOverrides[questionId];
    return overrideText ? { ...question, question_text: overrideText } : question;
  });
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

async function ensureSubjectState({
  client,
  subjectId,
  firebaseUid,
  patientName,
}: {
  client: ReturnType<typeof getServiceClient>;
  subjectId: string;
  firebaseUid: string;
  patientName: string;
}) {
  let { data: state } = await client
    .from('epro_subject_state')
    .select('*')
    .eq('subject_id', subjectId)
    .maybeSingle();

  if (!state) {
    state = {
      subject_id: subjectId,
      firebase_uid: firebaseUid,
      patient_name: patientName,
      current_day: 1,
      assigned_at: null,
      due_at: null,
      current_questions: [],
      trial_complete: false,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from('epro_subject_state').upsert(state, { onConflict: 'subject_id' });
    if (error) {
      throw new Error(error.message);
    }
  }

  return state;
}

function buildTrialEffectiveQuestions(trialReview: Record<string, unknown>) {
  const baselineQuestions = Array.isArray(trialReview.baseline_questions)
    ? (trialReview.baseline_questions as Array<Record<string, unknown>>)
    : cloneBaselineConfig();
  return applyWordingOverrides(baselineQuestions, trialReview.wording_overrides);
}

function buildPatientEffectiveQuestions({
  trialReview,
  patientReview,
}: {
  trialReview: Record<string, unknown>;
  patientReview: Record<string, unknown>;
}) {
  const inheritedBaseline = Array.isArray(trialReview.effective_questions)
    ? (trialReview.effective_questions as Array<Record<string, unknown>>)
    : buildTrialEffectiveQuestions(trialReview);
  const customized = Array.isArray(patientReview.customized_questions)
    ? (patientReview.customized_questions as Array<Record<string, unknown>>)
    : [];
  const merged =
    String(patientReview.review_scope || '') === REVIEW_SCOPE_PATIENT_CUSTOMIZED
      ? [...inheritedBaseline, ...customized]
      : inheritedBaseline;
  return applyWordingOverrides(merged, patientReview.wording_overrides);
}

async function syncPendingMirror({
  firebaseUid,
  firebaseToken,
  patientReview,
}: {
  firebaseUid: string;
  firebaseToken: string;
  patientReview: Record<string, unknown>;
}) {
  const formId = String(patientReview.form_id || '');
  if (!formId) {
    return;
  }
  await upsertUserEproSubmissionMirror({
    firebaseUid,
    firebaseToken,
    formId,
    payload: {
      subject_id: patientReview.subject_id,
      form_id: formId,
      day_number: Number(patientReview.day_number || 0) || null,
      assigned_at: null,
      due_at: patientReview.patient_due_at || null,
      submitted_at: null,
      status: REVIEW_STATUS_PENDING,
      review_status: REVIEW_STATUS_PENDING,
      review_scope: patientReview.review_scope || null,
      review_cutoff_at: patientReview.review_cutoff_at || null,
      patient_visible_at: null,
      approved_at: null,
      approved_by: null,
      auto_released_at: null,
      question_count: Array.isArray(patientReview.effective_questions) ? patientReview.effective_questions.length : null,
      source_system: SOURCE_SYSTEM,
      updated_at: new Date().toISOString(),
    },
  });
}

async function syncReleasedStateAndMirror({
  client,
  firebaseUid,
  firebaseToken,
  patientReview,
  effectiveQuestions,
  releasedAt,
  releaseStatus,
}: {
  client: ReturnType<typeof getServiceClient>;
  firebaseUid: string;
  firebaseToken: string;
  patientReview: Record<string, unknown>;
  effectiveQuestions: Array<Record<string, unknown>>;
  releasedAt: string;
  releaseStatus: string;
}) {
  const subjectId = String(patientReview.subject_id || '').trim();
  const formId = String(patientReview.form_id || '').trim();
  if (!subjectId || !formId) {
    return;
  }

  const { error: updateStateError } = await client
    .from('epro_subject_state')
    .update({
      current_questions: effectiveQuestions,
      assigned_at: releasedAt,
      due_at: patientReview.patient_due_at || null,
      updated_at: new Date().toISOString(),
    })
    .eq('subject_id', subjectId);

  if (updateStateError) {
    throw new Error(updateStateError.message);
  }

  await upsertUserEproSubmissionMirror({
    firebaseUid,
    firebaseToken,
    formId,
    payload: {
      subject_id: subjectId,
      form_id: formId,
      day_number: Number(patientReview.day_number || 0) || null,
      assigned_at: releasedAt,
      due_at: patientReview.patient_due_at || null,
      submitted_at: null,
      status: 'assigned',
      review_status: releaseStatus,
      review_scope: patientReview.review_scope || null,
      review_cutoff_at: patientReview.review_cutoff_at || null,
      patient_visible_at: releasedAt,
      approved_at: releaseStatus === REVIEW_STATUS_APPROVED ? releasedAt : null,
      approved_by: patientReview.approved_by || null,
      auto_released_at: releaseStatus === REVIEW_STATUS_AUTO_RELEASED ? releasedAt : null,
      question_count: effectiveQuestions.length,
      source_system: SOURCE_SYSTEM,
      updated_at: new Date().toISOString(),
    },
  });
}

async function refreshTrialReview(client: ReturnType<typeof getServiceClient>, trialReview: Record<string, unknown>) {
  const effectiveQuestions = buildTrialEffectiveQuestions(trialReview);
  if (sameJson(effectiveQuestions, trialReview.effective_questions)) {
    return trialReview;
  }
  const { data, error } = await client
    .from('epro_trial_daily_review')
    .update({
      effective_questions: effectiveQuestions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trialReview.id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function refreshPatientReview(
  client: ReturnType<typeof getServiceClient>,
  patientReview: Record<string, unknown>,
  trialReview: Record<string, unknown>
) {
  const effectiveQuestions = buildPatientEffectiveQuestions({ patientReview, trialReview });
  if (sameJson(effectiveQuestions, patientReview.effective_questions)) {
    return patientReview;
  }
  const { data, error } = await client
    .from('epro_patient_daily_review')
    .update({
      effective_questions: effectiveQuestions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', patientReview.id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

async function finalizePatientReview({
  client,
  patientReview,
  trialReview,
  firebaseToken,
  actor,
  releaseStatus,
  releasedAt,
}: {
  client: ReturnType<typeof getServiceClient>;
  patientReview: Record<string, unknown>;
  trialReview: Record<string, unknown>;
  firebaseToken: string;
  actor: CrcActor | null;
  releaseStatus: string;
  releasedAt: string;
}) {
  const effectiveQuestions = buildPatientEffectiveQuestions({ patientReview, trialReview });
  const payload: Record<string, unknown> = {
    effective_questions: effectiveQuestions,
    review_status: releaseStatus,
    patient_visible_at: releasedAt,
    updated_at: new Date().toISOString(),
  };

  if (releaseStatus === REVIEW_STATUS_APPROVED) {
    payload.approved_at = releasedAt;
    payload.approved_by = actor?.uid || null;
    payload.approved_by_name = actor?.nickname || null;
    payload.auto_released_at = null;
  } else {
    payload.auto_released_at = releasedAt;
  }

  const { data, error } = await client
    .from('epro_patient_daily_review')
    .update(payload)
    .eq('id', patientReview.id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await syncReleasedStateAndMirror({
    client,
    firebaseUid: String(data.firebase_uid || ''),
    firebaseToken,
    patientReview: data,
    effectiveQuestions,
    releasedAt,
    releaseStatus,
  });

  return data;
}

async function finalizeTrialReview({
  client,
  trialReview,
  firebaseToken,
  actor,
  releaseStatus,
  releasedAt,
}: {
  client: ReturnType<typeof getServiceClient>;
  trialReview: Record<string, unknown>;
  firebaseToken: string;
  actor: CrcActor | null;
  releaseStatus: string;
  releasedAt: string;
}) {
  const effectiveQuestions = buildTrialEffectiveQuestions(trialReview);
  const payload: Record<string, unknown> = {
    effective_questions: effectiveQuestions,
    review_status: releaseStatus,
    patient_visible_at: releasedAt,
    updated_at: new Date().toISOString(),
  };
  if (releaseStatus === REVIEW_STATUS_APPROVED) {
    payload.approved_at = releasedAt;
    payload.approved_by = actor?.uid || null;
    payload.approved_by_name = actor?.nickname || null;
    payload.auto_released_at = null;
  } else {
    payload.auto_released_at = releasedAt;
  }

  const { data, error } = await client
    .from('epro_trial_daily_review')
    .update(payload)
    .eq('id', trialReview.id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const { data: inheritedRows } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('trial_daily_review_id', data.id)
    .eq('review_scope', REVIEW_SCOPE_PATIENT_INHERITED)
    .eq('review_status', REVIEW_STATUS_PENDING);

  for (const patientReview of inheritedRows || []) {
    await finalizePatientReview({
      client,
      patientReview,
      trialReview: data,
      firebaseToken,
      actor,
      releaseStatus,
      releasedAt,
    });
  }

  return data;
}

export async function ensurePatientDailyReview({
  requestedSubjectId,
  patientName,
  firebaseUid,
  firebaseToken,
  now = new Date(),
}: {
  requestedSubjectId?: string | null;
  patientName?: string | null;
  firebaseUid: string;
  firebaseToken: string;
  now?: Date;
}) {
  const client = getServiceClient();
  const reviewWindow = getReviewWindow(now);
  const identity = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  const patient = normalizeActivePatientInput({
    firebase_uid: firebaseUid,
    subject_id: requestedSubjectId || identity.subject_id || firebaseUid,
    nickname: patientName || identity.nickname || requestedSubjectId || firebaseUid,
    protocol_id: identity.protocol_id,
    protocol_name: identity.protocol_name,
  });

  if (!patient) {
    throw new Error('Unable to resolve patient identity for ePRO review.');
  }

  const state = await ensureSubjectState({
    client,
    subjectId: patient.subject_id,
    firebaseUid: patient.firebase_uid,
    patientName: patient.patient_name,
  });

  if (state.trial_complete || Number(state.current_day || 1) > MAX_TRIAL_DAY) {
    return {
      state,
      trialReview: null,
      patientReview: null,
      reviewWindow,
    };
  }

  const currentDay = Number(state.current_day || 1);
  const trialId = resolveTrialId(patient);
  let { data: trialReview } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('trial_id', trialId)
    .maybeSingle();

  if (!trialReview) {
    const baselineQuestions = cloneBaselineConfig();
    const payload = {
      review_date: reviewWindow.reviewDate,
      trial_id: trialId,
      protocol_name: resolveProtocolName(patient),
      baseline_questions: baselineQuestions,
      effective_questions: baselineQuestions,
      wording_overrides: {},
      review_status: REVIEW_STATUS_PENDING,
      review_cutoff_at: reviewWindow.reviewCutoffAt,
      patient_visible_at: null,
      patient_due_at: reviewWindow.patientDueAt,
      active_patient_count: 0,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client.from('epro_trial_daily_review').insert(payload).select('*').single();
    if (error) {
      throw new Error(error.message);
    }
    trialReview = data;
  } else {
    trialReview = await refreshTrialReview(client, trialReview);
  }

  let { data: patientReview } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('subject_id', patient.subject_id)
    .eq('day_number', currentDay)
    .maybeSingle();

  if (!patientReview) {
    const generatedQuestions = await buildQuestionSet({
      client,
      subjectId: patient.subject_id,
      currentDay,
      patientName: patient.patient_name,
      firebaseUid: patient.firebase_uid,
      firebaseToken,
    });
    const customQuestions = generatedQuestions.filter(
      (question) => String(question.tier || '').toUpperCase() === 'CUSTOM'
    );
    const reviewScope = customQuestions.length ? REVIEW_SCOPE_PATIENT_CUSTOMIZED : REVIEW_SCOPE_PATIENT_INHERITED;
    const effectiveQuestions =
      reviewScope === REVIEW_SCOPE_PATIENT_CUSTOMIZED
        ? [...(trialReview.effective_questions || []), ...customQuestions]
        : (trialReview.effective_questions || []);
    const formId = buildFormId(patient.subject_id, currentDay);
    const payload = {
      review_date: reviewWindow.reviewDate,
      trial_daily_review_id: trialReview.id,
      trial_id: trialId,
      protocol_name: resolveProtocolName(patient),
      firebase_uid: patient.firebase_uid,
      subject_id: patient.subject_id,
      patient_name: patient.patient_name,
      day_number: currentDay,
      form_id: formId,
      baseline_questions: trialReview.baseline_questions || cloneBaselineConfig(),
      customized_questions: customQuestions,
      effective_questions: effectiveQuestions,
      review_scope: reviewScope,
      review_status: REVIEW_STATUS_PENDING,
      wording_overrides: {},
      review_cutoff_at: reviewWindow.reviewCutoffAt,
      patient_visible_at: null,
      patient_due_at: reviewWindow.patientDueAt,
      assigned_at: null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client.from('epro_patient_daily_review').insert(payload).select('*').single();
    if (error) {
      throw new Error(error.message);
    }
    patientReview = data;
  } else {
    patientReview = await refreshPatientReview(client, patientReview, trialReview);
  }

  const { count } = await client
    .from('epro_patient_daily_review')
    .select('id', { count: 'exact', head: true })
    .eq('review_date', reviewWindow.reviewDate)
    .eq('trial_id', trialId);

  if ((count || 0) !== Number(trialReview.active_patient_count || 0)) {
    const { data } = await client
      .from('epro_trial_daily_review')
      .update({
        active_patient_count: count || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trialReview.id)
      .select('*')
      .single();
    if (data) {
      trialReview = data;
    }
  }

  if (
    String(trialReview.review_status || '') !== REVIEW_STATUS_PENDING &&
    String(patientReview.review_scope || '') === REVIEW_SCOPE_PATIENT_INHERITED &&
    String(patientReview.review_status || '') === REVIEW_STATUS_PENDING
  ) {
    patientReview = await finalizePatientReview({
      client,
      patientReview,
      trialReview,
      firebaseToken,
      actor: null,
      releaseStatus: String(trialReview.review_status),
      releasedAt: String(trialReview.patient_visible_at || trialReview.auto_released_at || trialReview.approved_at || new Date().toISOString()),
    });
  } else if (String(patientReview.review_status || '') === REVIEW_STATUS_PENDING) {
    await syncPendingMirror({
      firebaseUid: patient.firebase_uid,
      firebaseToken,
      patientReview,
    });
  }

  return {
    state,
    trialReview,
    patientReview,
    reviewWindow,
  };
}

export async function autoReleasePendingForDate({
  firebaseUid,
  firebaseToken,
  now = new Date(),
}: {
  firebaseUid: string;
  firebaseToken: string;
  now?: Date;
}) {
  const client = getServiceClient();
  const reviewWindow = getReviewWindow(now);
  if (!reviewWindow.cutoffPassed) {
    return { autoReleasedTrials: 0, autoReleasedPatients: 0 };
  }

  const releasedAt = reviewWindow.reviewCutoffAt;
  let autoReleasedTrials = 0;
  let autoReleasedPatients = 0;

  const { data: pendingTrials } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('review_status', REVIEW_STATUS_PENDING);

  for (const trialReview of pendingTrials || []) {
    await finalizeTrialReview({
      client,
      trialReview,
      firebaseToken,
      actor: null,
      releaseStatus: REVIEW_STATUS_AUTO_RELEASED,
      releasedAt,
    });
    autoReleasedTrials += 1;
  }

  const { data: pendingPatients } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('review_status', REVIEW_STATUS_PENDING)
    .eq('review_scope', REVIEW_SCOPE_PATIENT_CUSTOMIZED);

  for (const patientReview of pendingPatients || []) {
    const { data: trialReview } = await client
      .from('epro_trial_daily_review')
      .select('*')
      .eq('id', patientReview.trial_daily_review_id)
      .single();
    if (!trialReview) {
      continue;
    }
    await finalizePatientReview({
      client,
      patientReview,
      trialReview,
      firebaseToken,
      actor: null,
      releaseStatus: REVIEW_STATUS_AUTO_RELEASED,
      releasedAt,
    });
    autoReleasedPatients += 1;
  }

  return { autoReleasedTrials, autoReleasedPatients };
}

export async function autoReleaseCurrentPatientReview({
  subjectId,
  firebaseUid,
  firebaseToken,
  now = new Date(),
}: {
  subjectId: string;
  firebaseUid: string;
  firebaseToken: string;
  now?: Date;
}) {
  const client = getServiceClient();
  const reviewWindow = getReviewWindow(now);
  const { data: patientReview } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('subject_id', subjectId)
    .eq('review_status', REVIEW_STATUS_PENDING)
    .maybeSingle();

  if (!patientReview) {
    return null;
  }

  let { data: trialReview } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('id', patientReview.trial_daily_review_id)
    .single();

  if (!trialReview) {
    return null;
  }

  if (String(trialReview.review_status || '') === REVIEW_STATUS_PENDING) {
    const trialEffectiveQuestions = buildTrialEffectiveQuestions(trialReview);
    const { data } = await client
      .from('epro_trial_daily_review')
      .update({
        effective_questions: trialEffectiveQuestions,
        review_status: REVIEW_STATUS_AUTO_RELEASED,
        patient_visible_at: reviewWindow.reviewCutoffAt,
        auto_released_at: reviewWindow.reviewCutoffAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trialReview.id)
      .select('*')
      .single();
    if (data) {
      trialReview = data;
    }
  }

  return finalizePatientReview({
    client,
    patientReview,
    trialReview,
    firebaseToken,
    actor: null,
    releaseStatus: REVIEW_STATUS_AUTO_RELEASED,
    releasedAt: reviewWindow.reviewCutoffAt,
  });
}

export async function loadCrcDailyReviewWorkspace({
  firebaseUid,
  firebaseToken,
  activePatients = [],
  now = new Date(),
}: {
  firebaseUid: string;
  firebaseToken: string;
  activePatients?: ActivePatientInput[];
  now?: Date;
}) {
  const crcIdentity = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (crcIdentity.role !== 'crc') {
    throw new Error('Only CRC users can access the ePRO review workspace.');
  }

  for (const rawPatient of activePatients) {
    const patient = normalizeActivePatientInput(rawPatient);
    if (!patient) {
      continue;
    }
    await ensurePatientDailyReview({
      requestedSubjectId: patient.subject_id,
      patientName: patient.patient_name,
      firebaseUid: patient.firebase_uid,
      firebaseToken,
      now,
    });
  }

  await autoReleasePendingForDate({ firebaseUid, firebaseToken, now });

  const client = getServiceClient();
  const reviewWindow = getReviewWindow(now);
  const [{ data: trialReviews }, { data: patientReviews }] = await Promise.all([
    client
      .from('epro_trial_daily_review')
      .select('*')
      .eq('review_date', reviewWindow.reviewDate)
      .order('trial_id'),
    client
      .from('epro_patient_daily_review')
      .select('*')
      .eq('review_date', reviewWindow.reviewDate)
      .order('trial_id')
      .order('patient_name'),
  ]);

  const safeTrialReviews = trialReviews || [];
  const safePatientReviews = patientReviews || [];

  return {
    review_date: reviewWindow.reviewDate,
    time_zone: reviewWindow.timeZone,
    draft_generation_at: reviewWindow.draftGenerationAt,
    review_cutoff_at: reviewWindow.reviewCutoffAt,
    patient_due_at: reviewWindow.patientDueAt,
    metrics: {
      pending_trials: safeTrialReviews.filter((row) => row.review_status === REVIEW_STATUS_PENDING).length,
      pending_patient_drafts: safePatientReviews.filter(
        (row) => row.review_status === REVIEW_STATUS_PENDING && row.review_scope === REVIEW_SCOPE_PATIENT_CUSTOMIZED
      ).length,
      released_today: safePatientReviews.filter((row) =>
        [REVIEW_STATUS_APPROVED, REVIEW_STATUS_AUTO_RELEASED].includes(String(row.review_status || ''))
      ).length,
      customized_patient_drafts: safePatientReviews.filter((row) => row.review_scope === REVIEW_SCOPE_PATIENT_CUSTOMIZED).length,
    },
    trial_reviews: safeTrialReviews,
    patient_reviews: safePatientReviews,
  };
}

export async function approveTrialDailyReview({
  reviewId,
  firebaseUid,
  firebaseToken,
}: {
  reviewId: string;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const actor = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (actor.role !== 'crc') {
    throw new Error('Only CRC users can approve ePRO reviews.');
  }
  const client = getServiceClient();
  const { data: trialReview, error } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('id', reviewId)
    .single();
  if (error || !trialReview) {
    throw new Error(error?.message || 'Trial review not found.');
  }
  return finalizeTrialReview({
    client,
    trialReview,
    firebaseToken,
    actor: { uid: firebaseUid, nickname: actor.nickname || actor.firebase_uid },
    releaseStatus: REVIEW_STATUS_APPROVED,
    releasedAt: new Date().toISOString(),
  });
}

export async function approvePatientDailyReview({
  reviewId,
  firebaseUid,
  firebaseToken,
}: {
  reviewId: string;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const actor = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (actor.role !== 'crc') {
    throw new Error('Only CRC users can approve ePRO reviews.');
  }
  const client = getServiceClient();
  const { data: patientReview, error } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('id', reviewId)
    .single();
  if (error || !patientReview) {
    throw new Error(error?.message || 'Patient review not found.');
  }
  const { data: trialReview } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('id', patientReview.trial_daily_review_id)
    .single();
  if (!trialReview) {
    throw new Error('Linked trial review was not found.');
  }
  return finalizePatientReview({
    client,
    patientReview,
    trialReview,
    firebaseToken,
    actor: { uid: firebaseUid, nickname: actor.nickname || actor.firebase_uid },
    releaseStatus: REVIEW_STATUS_APPROVED,
    releasedAt: new Date().toISOString(),
  });
}

export async function saveTrialDailyReviewWording({
  reviewId,
  overrides,
  firebaseUid,
  firebaseToken,
}: {
  reviewId: string;
  overrides: Record<string, string>;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const actor = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (actor.role !== 'crc') {
    throw new Error('Only CRC users can edit ePRO review wording.');
  }
  const client = getServiceClient();
  const { data, error } = await client
    .from('epro_trial_daily_review')
    .update({
      wording_overrides: overrides,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select('*')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return refreshTrialReview(client, data);
}

export async function savePatientDailyReviewWording({
  reviewId,
  overrides,
  firebaseUid,
  firebaseToken,
}: {
  reviewId: string;
  overrides: Record<string, string>;
  firebaseUid: string;
  firebaseToken: string;
}) {
  const actor = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (actor.role !== 'crc') {
    throw new Error('Only CRC users can edit ePRO review wording.');
  }
  const client = getServiceClient();
  const { data: patientReview, error } = await client
    .from('epro_patient_daily_review')
    .update({
      wording_overrides: overrides,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reviewId)
    .select('*')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  const { data: trialReview } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('id', patientReview.trial_daily_review_id)
    .single();
  if (!trialReview) {
    throw new Error('Linked trial review was not found.');
  }
  return refreshPatientReview(client, patientReview, trialReview);
}

export async function approveAllDailyReviews({
  firebaseUid,
  firebaseToken,
  now = new Date(),
}: {
  firebaseUid: string;
  firebaseToken: string;
  now?: Date;
}) {
  const actor = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
  if (actor.role !== 'crc') {
    throw new Error('Only CRC users can approve ePRO reviews.');
  }

  const client = getServiceClient();
  const reviewWindow = getReviewWindow(now);
  const releasedAt = new Date().toISOString();
  let approvedTrials = 0;
  let approvedPatients = 0;

  const { data: pendingTrials } = await client
    .from('epro_trial_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('review_status', REVIEW_STATUS_PENDING);

  for (const trialReview of pendingTrials || []) {
    await finalizeTrialReview({
      client,
      trialReview,
      firebaseToken,
      actor: { uid: firebaseUid, nickname: actor.nickname || actor.firebase_uid },
      releaseStatus: REVIEW_STATUS_APPROVED,
      releasedAt,
    });
    approvedTrials += 1;
  }

  const { data: pendingCustomPatients } = await client
    .from('epro_patient_daily_review')
    .select('*')
    .eq('review_date', reviewWindow.reviewDate)
    .eq('review_status', REVIEW_STATUS_PENDING)
    .eq('review_scope', REVIEW_SCOPE_PATIENT_CUSTOMIZED);

  for (const patientReview of pendingCustomPatients || []) {
    const { data: trialReview } = await client
      .from('epro_trial_daily_review')
      .select('*')
      .eq('id', patientReview.trial_daily_review_id)
      .single();
    if (!trialReview) {
      continue;
    }
    await finalizePatientReview({
      client,
      patientReview,
      trialReview,
      firebaseToken,
      actor: { uid: firebaseUid, nickname: actor.nickname || actor.firebase_uid },
      releaseStatus: REVIEW_STATUS_APPROVED,
      releasedAt,
    });
    approvedPatients += 1;
  }

  return {
    approved_trials: approvedTrials,
    approved_patient_drafts: approvedPatients,
  };
}
