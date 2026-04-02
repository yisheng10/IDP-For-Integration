import {
  autoReleaseCurrentPatientReview,
  ensurePatientDailyReview,
  REVIEW_STATUS_APPROVED,
  REVIEW_STATUS_AUTO_RELEASED,
  REVIEW_STATUS_PENDING,
} from './eproReviewCore.ts';
import {
  buildAnswerSummary,
  cloneBaselineConfig,
  getServiceClient,
  MAX_TRIAL_DAY,
  sanitizeSubjectId,
  SOURCE_SYSTEM,
} from './eproShared.ts';
import { loadRealtimeUserIdentity, upsertUserEproSubmissionMirror } from './firestorePromptContext.ts';

async function ensureSubjectAccess(
  client: ReturnType<typeof getServiceClient>,
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
    const identity = await loadRealtimeUserIdentity({ firebaseUid, firebaseToken, targetFirebaseUid: firebaseUid });
    if (identity.subject_id === requestedSubjectId) {
      return requestedSubjectId;
    }
    throw new Error('Requested subject_id is not linked to this authenticated patient.');
  }

  return requestedSubjectId;
}

function buildAwaitingPayload({
  subjectId,
  state,
  patientReview,
}: {
  subjectId: string;
  state: Record<string, unknown>;
  patientReview: Record<string, unknown>;
}) {
  return {
    subject_id: subjectId,
    patient_name: state.patient_name || subjectId,
    patientName: state.patient_name || subjectId,
    day: Number(state.current_day || 1),
    day_number: Number(state.current_day || 1),
    form_id: patientReview.form_id,
    assigned_at: null,
    due_at: patientReview.patient_due_at || null,
    status: REVIEW_STATUS_PENDING,
    review_status: REVIEW_STATUS_PENDING,
    review_scope: patientReview.review_scope || null,
    review_cutoff_at: patientReview.review_cutoff_at || null,
    patient_visible_at: null,
    source_system: SOURCE_SYSTEM,
    question_count: Array.isArray(patientReview.effective_questions) ? patientReview.effective_questions.length : 0,
    awaiting_crc_review: true,
  };
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
  const subjectId = await ensureSubjectAccess(
    client,
    sanitizeSubjectId(requestedSubjectId),
    firebaseUid,
    firebaseToken
  );

  let reviewState = await ensurePatientDailyReview({
    requestedSubjectId: subjectId,
    patientName,
    firebaseUid,
    firebaseToken,
  });

  if (
    reviewState.state?.trial_complete ||
    Number(reviewState.state?.current_day || 1) > MAX_TRIAL_DAY
  ) {
    return {
      trial_complete: true,
      subject_id: subjectId,
      patient_name: reviewState.state?.patient_name || subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  if (!reviewState.patientReview) {
    throw new Error('No questionnaire review row exists for this patient yet.');
  }

  if (String(reviewState.patientReview.review_status || '') === REVIEW_STATUS_PENDING && reviewState.reviewWindow.cutoffPassed) {
    await autoReleaseCurrentPatientReview({ subjectId, firebaseUid, firebaseToken });
    reviewState = await ensurePatientDailyReview({
      requestedSubjectId: subjectId,
      patientName,
      firebaseUid,
      firebaseToken,
    });
  }

  if (!reviewState.patientReview) {
    throw new Error('No questionnaire review row exists for this patient yet.');
  }

  if (String(reviewState.patientReview.review_status || '') === REVIEW_STATUS_PENDING) {
    return buildAwaitingPayload({
      subjectId,
      state: reviewState.state,
      patientReview: reviewState.patientReview,
    });
  }

  const questions =
    Array.isArray(reviewState.patientReview.effective_questions) &&
    reviewState.patientReview.effective_questions.length > 0
      ? reviewState.patientReview.effective_questions
      : cloneBaselineConfig();

  return {
    subject_id: subjectId,
    patient_name: reviewState.state.patient_name || subjectId,
    patientName: reviewState.state.patient_name || subjectId,
    day: Number(reviewState.state.current_day || 1),
    day_number: Number(reviewState.state.current_day || 1),
    form_id: reviewState.patientReview.form_id,
    assigned_at: reviewState.patientReview.patient_visible_at || reviewState.state.assigned_at || null,
    due_at: reviewState.patientReview.patient_due_at || reviewState.state.due_at || null,
    status: 'assigned',
    review_status: reviewState.patientReview.review_status,
    review_scope: reviewState.patientReview.review_scope || null,
    review_cutoff_at: reviewState.patientReview.review_cutoff_at || null,
    patient_visible_at: reviewState.patientReview.patient_visible_at || null,
    approved_at: reviewState.patientReview.approved_at || null,
    approved_by: reviewState.patientReview.approved_by || null,
    auto_released_at: reviewState.patientReview.auto_released_at || null,
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
  const subjectId = await ensureSubjectAccess(
    client,
    sanitizeSubjectId(requestedSubjectId),
    firebaseUid,
    firebaseToken
  );

  let reviewState = await ensurePatientDailyReview({
    requestedSubjectId: subjectId,
    patientName,
    firebaseUid,
    firebaseToken,
  });

  if (
    reviewState.state?.trial_complete ||
    Number(reviewState.state?.current_day || 1) > MAX_TRIAL_DAY
  ) {
    return {
      trial_complete: true,
      subject_id: subjectId,
      source_system: SOURCE_SYSTEM,
    };
  }

  if (!reviewState.patientReview) {
    throw new Error('No questionnaire review row exists for this patient yet.');
  }

  if (String(reviewState.patientReview.review_status || '') === REVIEW_STATUS_PENDING) {
    await autoReleaseCurrentPatientReview({ subjectId, firebaseUid, firebaseToken });
    reviewState = await ensurePatientDailyReview({
      requestedSubjectId: subjectId,
      patientName,
      firebaseUid,
      firebaseToken,
    });
  }

  const releaseStatus = String(reviewState.patientReview?.review_status || '');
  if (![REVIEW_STATUS_APPROVED, REVIEW_STATUS_AUTO_RELEASED].includes(releaseStatus)) {
    throw new Error("Today's questionnaire is awaiting CRC review.");
  }

  const currentDay = Number(reviewState.state.current_day || 1);
  const currentQuestions =
    Array.isArray(reviewState.patientReview.effective_questions) &&
    reviewState.patientReview.effective_questions.length > 0
      ? reviewState.patientReview.effective_questions
      : cloneBaselineConfig();
  const submittedAt = new Date().toISOString();
  const assignedAt = reviewState.patientReview.patient_visible_at || reviewState.state.assigned_at || submittedAt;
  const completionLatencySec = Math.max(
    0,
    Math.round((new Date(submittedAt).getTime() - new Date(assignedAt).getTime()) / 1000)
  );

  const { error: historyError } = await client.from('patient_daily_logs').insert({
    patient_id: subjectId,
    day_number: currentDay,
    answers: answers || {},
  });
  if (historyError) {
    throw new Error(historyError.message);
  }

  const nextDay = currentDay + 1;
  const nextState = {
    subject_id: subjectId,
    firebase_uid: reviewState.state.firebase_uid || firebaseUid,
    patient_name: patientName || reviewState.state.patient_name || `Subject ${subjectId}`,
    current_day: nextDay,
    assigned_at: null,
    due_at: null,
    current_questions: [],
    trial_complete: nextDay > MAX_TRIAL_DAY,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await client
    .from('epro_subject_state')
    .upsert(nextState, { onConflict: 'subject_id' });
  if (updateError) {
    throw new Error(updateError.message);
  }

  const answerSummary = buildAnswerSummary({
    questions: currentQuestions,
    answers: answers || {},
  });

  await upsertUserEproSubmissionMirror({
    firebaseUid,
    firebaseToken,
    formId: String(reviewState.patientReview.form_id || ''),
    payload: {
      subject_id: subjectId,
      form_id: reviewState.patientReview.form_id,
      day_number: currentDay,
      assigned_at: assignedAt,
      due_at: reviewState.patientReview.patient_due_at || null,
      submitted_at: submittedAt,
      status: 'submitted',
      review_status: releaseStatus,
      review_scope: reviewState.patientReview.review_scope || null,
      review_cutoff_at: reviewState.patientReview.review_cutoff_at || null,
      patient_visible_at: reviewState.patientReview.patient_visible_at || null,
      approved_at: reviewState.patientReview.approved_at || null,
      approved_by: reviewState.patientReview.approved_by || null,
      auto_released_at: reviewState.patientReview.auto_released_at || null,
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
    form_id: reviewState.patientReview.form_id,
    status: 'submitted',
    review_status: releaseStatus,
    assigned_at: assignedAt,
    submitted_at: submittedAt,
    completion_latency_sec: completionLatencySec,
    source_system: SOURCE_SYSTEM,
    next_day: nextDay <= MAX_TRIAL_DAY ? nextDay : null,
    trial_complete: nextDay > MAX_TRIAL_DAY,
  };
}
