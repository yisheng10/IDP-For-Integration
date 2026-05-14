import React, { useCallback, useEffect, useMemo, useState } from 'react';
import EproStatusPanel from './EproStatusPanel';
import WindowPaginationControls from './WindowPaginationControls';
import {
  approveAllEproReviews,
  approvePatientReview,
  approveTrialReview,
  fetchEproReviewWorkspace,
  savePatientReviewWording,
  saveTrialReviewWording,
} from '../services/eproReviewService';

const EMPTY_METRIC = '0';

function formatTimestamp(value) {
  if (!value) {
    return 'Not set';
  }
  return new Date(value).toLocaleString();
}

function statusLabel(value) {
  return String(value || 'unknown').toUpperCase().replace(/_/g, ' ');
}

function deriveOperationalStatus(entry) {
  if (String(entry?.status || '').toLowerCase() === 'submitted') {
    return 'submitted';
  }

  if (entry?.due_at && new Date(entry.due_at).getTime() < Date.now()) {
    return 'overdue';
  }

  return String(entry?.status || 'assigned').toLowerCase();
}

function resolveReviewDate(workspace) {
  const explicitDate = String(workspace?.review_date || '').trim();
  if (explicitDate) {
    return explicitDate;
  }

  const fallbackValue = workspace?.draft_generation_at || workspace?.review_cutoff_at || workspace?.patient_due_at;
  if (!fallbackValue) {
    return '';
  }

  const parsed = new Date(fallbackValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildLocalDateTime(reviewDate, hour, minute, second = 0) {
  if (!reviewDate) {
    return null;
  }
  const [year, month, day] = reviewDate.split('-').map((value) => Number(value));
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, hour, minute, second);
}

function formatReviewWindowSummary(workspace) {
  const reviewDate = resolveReviewDate(workspace);
  if (!reviewDate) {
    return '';
  }

  const reviewStart = buildLocalDateTime(reviewDate, 9, 0, 0);
  const reviewEnd = buildLocalDateTime(reviewDate, 13, 0, 0);
  const dueAt = buildLocalDateTime(reviewDate, 23, 59, 0);

  if (!reviewStart || !reviewEnd || !dueAt) {
    return '';
  }

  return `Review window: ${reviewStart.toLocaleString()} - ${reviewEnd.toLocaleTimeString()}. If CRC does not approve by ${reviewEnd.toLocaleTimeString()}, questionnaires auto release. Patient due by ${dueAt ? dueAt.toLocaleString() : 'Not set'}.`;
}

function buildQuestionMap(questions = []) {
  return Object.fromEntries(
    (Array.isArray(questions) ? questions : []).map((question) => [
      String(question.question_id || '').trim(),
      String(question.question_text || '').trim(),
    ])
  );
}

function ReviewQuestionList({ questions = [], editable = false, draft = {}, onChange }) {
  return (
    <div className="epro-review__questionList">
      {(Array.isArray(questions) ? questions : []).map((question) => {
        const questionId = String(question.question_id || '').trim();
        const value = editable ? draft[questionId] ?? question.question_text ?? '' : question.question_text;
        return (
          <div key={questionId} className="epro-review__questionItem">
            <div className="epro-review__questionMeta">
              <span className="epro-review__questionId">{questionId}</span>
              <span className="epro-review__questionTier">{String(question.tier || 'QUESTION').toUpperCase()}</span>
            </div>
            {editable ? (
              <textarea
                className="epro-review__textarea"
                rows={3}
                value={value}
                onChange={(event) => onChange(questionId, event.target.value)}
              />
            ) : (
              <div className="epro-review__questionText">{value}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EproReviewWorkspace({
  user,
  patients = [],
  entries = [],
  entriesPage = 1,
  entriesPageSize = 30,
  onEntriesPageChange,
  onEntriesPageSizeChange,
  canGoNextEntries = false,
}) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [editingTrialId, setEditingTrialId] = useState(null);
  const [editingPatientId, setEditingPatientId] = useState(null);
  const [trialDrafts, setTrialDrafts] = useState({});
  const [patientDrafts, setPatientDrafts] = useState({});
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [entryStatusView, setEntryStatusView] = useState('submitted');

  const activePatients = useMemo(() => {
    return patients.filter((patient) => {
      const owner = patient.primary_crc_id || patient.primaryCrcId || '';
      const hasProtocol = Boolean(patient.protocolId || patient.protocolName);
      return hasProtocol && (!owner || owner === user.uid);
    });
  }, [patients, user.uid]);

  const activePatientSignature = useMemo(
    () =>
      activePatients
        .map((patient) =>
          [patient.id, patient.subject_id || patient.subjectId || '', patient.protocolId || '', patient.protocolName || ''].join(
            ':'
          )
        )
        .join('|'),
    [activePatients]
  );

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );
  const isQueueServiceUnavailable = Boolean(error);
  const queueUnavailableMessage =
    'The live CRC ePRO review service is temporarily unavailable. Queue data is hidden until the review functions are repaired.';

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await fetchEproReviewWorkspace(activePatients);
      setWorkspace(payload);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load the ePRO review workspace.');
      setWorkspace(null);
    } finally {
      setLoading(false);
    }
  }, [activePatients]);

  useEffect(() => {
    loadWorkspace();
  }, [activePatientSignature, loadWorkspace]);

  const pendingTrialReviews = useMemo(
    () => (workspace?.trial_reviews || []).filter((row) => row.review_status === 'pending_crc_review'),
    [workspace]
  );
  const pendingPatientReviews = useMemo(
    () =>
      (workspace?.patient_reviews || []).filter(
        (row) => row.review_status === 'pending_crc_review' && row.review_scope === 'patient_customized'
      ),
    [workspace]
  );
  const releasedToday = useMemo(
    () =>
      (workspace?.patient_reviews || []).filter((row) =>
        ['approved', 'auto_released'].includes(String(row.review_status || ''))
      ),
    [workspace]
  );

  const submittedOrOverdue = useMemo(() => {
    return [...entries]
      .filter((entry) => {
        if (!entry) return false;
        const status = deriveOperationalStatus(entry);
        return status === 'submitted' || status === 'overdue';
      })
      .sort((left, right) => {
        const leftTime = new Date(left.updated_at || left.submitted_at || left.assigned_at || 0).getTime();
        const rightTime = new Date(right.updated_at || right.submitted_at || right.assigned_at || 0).getTime();
        return rightTime - leftTime;
      });
  }, [entries]);

  const submittedEntries = useMemo(
    () => submittedOrOverdue.filter((entry) => deriveOperationalStatus(entry) === 'submitted'),
    [submittedOrOverdue]
  );
  const overdueEntries = useMemo(
    () => submittedOrOverdue.filter((entry) => deriveOperationalStatus(entry) === 'overdue'),
    [submittedOrOverdue]
  );
  const filteredEntryRows = entryStatusView === 'overdue' ? overdueEntries : submittedEntries;

  const totalEntryPages = Math.max(1, Math.ceil(filteredEntryRows.length / entriesPageSize));
  const effectiveEntriesPage = Math.min(entriesPage, totalEntryPages);
  const visibleSubmittedOrOverdue = filteredEntryRows.slice(
    (effectiveEntriesPage - 1) * entriesPageSize,
    effectiveEntriesPage * entriesPageSize
  );
  const canAdvanceEntries =
    filteredEntryRows.length > effectiveEntriesPage * entriesPageSize || canGoNextEntries;
  const loadedEntryCount = submittedOrOverdue.length;
  const entryStatusLabel = entryStatusView === 'overdue' ? 'overdue' : 'submitted';

  const metrics = workspace?.metrics || null;

  const handleApproveTrial = async (reviewId) => {
    setBusyKey(`trial:${reviewId}`);
    try {
      await approveTrialReview(reviewId);
      await loadWorkspace();
    } catch (actionError) {
      window.alert(actionError.message || 'Unable to approve this trial review.');
    } finally {
      setBusyKey('');
    }
  };

  const handleApprovePatient = async (reviewId) => {
    setBusyKey(`patient:${reviewId}`);
    try {
      await approvePatientReview(reviewId);
      await loadWorkspace();
    } catch (actionError) {
      window.alert(actionError.message || 'Unable to approve this patient review.');
    } finally {
      setBusyKey('');
    }
  };

  const handleSaveTrialWording = async (review) => {
    const reviewId = review.id;
    setBusyKey(`trial-save:${reviewId}`);
    try {
      await saveTrialReviewWording(reviewId, trialDrafts[reviewId] || {});
      setEditingTrialId(null);
      await loadWorkspace();
    } catch (actionError) {
      window.alert(actionError.message || 'Unable to save trial wording.');
    } finally {
      setBusyKey('');
    }
  };

  const handleSavePatientWording = async (review) => {
    const reviewId = review.id;
    setBusyKey(`patient-save:${reviewId}`);
    try {
      await savePatientReviewWording(reviewId, patientDrafts[reviewId] || {});
      setEditingPatientId(null);
      await loadWorkspace();
    } catch (actionError) {
      window.alert(actionError.message || 'Unable to save patient wording.');
    } finally {
      setBusyKey('');
    }
  };

  const openTrialEditor = (review) => {
    setEditingPatientId(null);
    setEditingTrialId(review.id);
    setTrialDrafts((current) => ({
      ...current,
      [review.id]: buildQuestionMap(review.effective_questions || review.baseline_questions || []),
    }));
  };

  const openPatientEditor = (review) => {
    setEditingTrialId(null);
    setEditingPatientId(review.id);
    setSelectedPatientId(review.firebase_uid);
    setPatientDrafts((current) => ({
      ...current,
      [review.id]: buildQuestionMap(review.effective_questions || []),
    }));
  };

  const handleApproveAll = async () => {
    setBusyKey('approve-all');
    try {
      await approveAllEproReviews();
      setApproveAllOpen(false);
      await loadWorkspace();
    } catch (actionError) {
      window.alert(actionError.message || 'Unable to approve all ePRO drafts.');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <div className="epro-review">
      <div className="card workspace-card epro-review__summary">
        <div className="epro-review__summaryTop">
          <div className="epro-review__summaryIntro">
            <h3>Today&apos;s ePRO review queue</h3>
            <div className="section-note">
              CRC previews today&apos;s trial and patient-specific questionnaires before patient release.
            </div>
          </div>
          <div className="epro-review__summaryCenter">
            <div className="epro-review__toolbar">
              <button className="btn btn-secondary btn-small" onClick={loadWorkspace} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                className="btn btn-primary btn-small"
                onClick={() => setApproveAllOpen(true)}
                disabled={!metrics || (!metrics.pending_trials && !metrics.pending_patient_drafts)}
              >
                Approve All ePRO
              </button>
            </div>
            <div className="workspace-summary-grid workspace-summary-grid--compact epro-review__metricsRow">
              <div className="workspace-summary-item">
                <span>Pending Trials Review</span>
                <strong>{metrics ? metrics.pending_trials : EMPTY_METRIC}</strong>
              </div>
              <div className="workspace-summary-item">
                <span>Pending Patients Review</span>
                <strong>{metrics ? metrics.pending_patient_drafts : EMPTY_METRIC}</strong>
              </div>
              <div className="workspace-summary-item">
                <span>Released today</span>
                <strong>{metrics ? metrics.released_today : EMPTY_METRIC}</strong>
              </div>
              <div className="workspace-summary-item">
                <span>Customized drafts</span>
                <strong>{metrics ? metrics.customized_patient_drafts : EMPTY_METRIC}</strong>
              </div>
            </div>
          </div>
          {workspace ? (
            <div className="section-note epro-review__windowNote">{formatReviewWindowSummary(workspace)}</div>
          ) : (
            <div className="section-note epro-review__windowNote epro-review__windowNote--placeholder">
              Review window details will appear once the live CRC ePRO workspace finishes loading.
            </div>
          )}
        </div>

        {!workspace && isQueueServiceUnavailable ? (
          <div className="info-banner" style={{ marginTop: '14px' }}>
            {queueUnavailableMessage} Mirrored Firestore questionnaire activity can still load below while the review
            service is being repaired.
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="card workspace-card">
          <div className="empty-panel">{queueUnavailableMessage}</div>
        </div>
      ) : null}

      <div className="workspace-two-column">
        <div className="card workspace-card">
          <div className="section-header">
            <div>
              <h3>Pending Trials Review</h3>
              <div className="section-note">Approve or edit the protocol-owned baseline wording for today.</div>
            </div>
          </div>
          {pendingTrialReviews.length ? (
            pendingTrialReviews.map((review) => {
              const editing = editingTrialId === review.id;
              const draft = trialDrafts[review.id] || {};
              return (
                <div key={review.id} className="epro-review__card">
                  <div className="epro-review__cardHeader">
                    <div>
                      <div className="epro-review__title">{review.protocol_name || review.trial_id}</div>
                      <div className="section-note">
                        Trial ID: {review.trial_id} - Active patients: {review.active_patient_count || 0} - Cutoff:{' '}
                        {formatTimestamp(review.review_cutoff_at)}
                      </div>
                    </div>
                    <div className="epro-review__actions">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => (editing ? setEditingTrialId(null) : openTrialEditor(review))}
                      >
                        {editing ? 'Close editor' : 'Edit wording'}
                      </button>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => handleApproveTrial(review.id)}
                        disabled={busyKey === `trial:${review.id}`}
                      >
                        {busyKey === `trial:${review.id}` ? 'Approving...' : 'Approve'}
                      </button>
                    </div>
                  </div>
                  <ReviewQuestionList
                    questions={review.effective_questions || review.baseline_questions || []}
                    editable={editing}
                    draft={draft}
                    onChange={(questionId, value) =>
                      setTrialDrafts((current) => ({
                        ...current,
                        [review.id]: {
                          ...(current[review.id] || {}),
                          [questionId]: value,
                        },
                      }))
                    }
                  />
                  {editing ? (
                    <div className="epro-review__footer">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleSaveTrialWording(review)}
                        disabled={busyKey === `trial-save:${review.id}`}
                      >
                        {busyKey === `trial-save:${review.id}` ? 'Saving...' : 'Save wording'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="empty-panel">
              {isQueueServiceUnavailable ? queueUnavailableMessage : 'No pending trial-level reviews for today.'}
            </div>
          )}
        </div>

        <div className="card workspace-card">
          <div className="section-header">
            <div>
              <h3>Pending Patients Review</h3>
              <div className="section-note">Only patients with customized questions need patient-level approval.</div>
            </div>
          </div>
          {pendingPatientReviews.length ? (
            pendingPatientReviews.map((review) => {
              const editing = editingPatientId === review.id;
              const draft = patientDrafts[review.id] || {};
              return (
                <div key={review.id} className="epro-review__card">
                  <div className="epro-review__cardHeader">
                    <div>
                      <div className="epro-review__title">{review.patient_name || review.subject_id}</div>
                      <div className="section-note">
                        Subject ID: {review.subject_id} - Scope: {statusLabel(review.review_scope)} - Trial:{' '}
                        {review.protocol_name || review.trial_id}
                      </div>
                    </div>
                    <div className="epro-review__actions">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => (editing ? setEditingPatientId(null) : openPatientEditor(review))}
                      >
                        {editing ? 'Close editor' : 'Edit wording'}
                      </button>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => handleApprovePatient(review.id)}
                        disabled={busyKey === `patient:${review.id}`}
                      >
                        {busyKey === `patient:${review.id}` ? 'Approving...' : 'Approve'}
                      </button>
                    </div>
                  </div>
                  <ReviewQuestionList
                    questions={review.effective_questions || []}
                    editable={editing}
                    draft={draft}
                    onChange={(questionId, value) =>
                      setPatientDrafts((current) => ({
                        ...current,
                        [review.id]: {
                          ...(current[review.id] || {}),
                          [questionId]: value,
                        },
                      }))
                    }
                  />
                  {editing ? (
                    <div className="epro-review__footer">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleSavePatientWording(review)}
                        disabled={busyKey === `patient-save:${review.id}`}
                      >
                        {busyKey === `patient-save:${review.id}` ? 'Saving...' : 'Save wording'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="empty-panel">
              {isQueueServiceUnavailable
                ? queueUnavailableMessage
                : 'No patient-specific customized drafts are waiting for CRC approval.'}
            </div>
          )}
        </div>
      </div>

      <div className="workspace-two-column">
        <div className="card workspace-card">
          <div className="section-header">
            <div>
              <h3>Released Today</h3>
              <div className="section-note">These questionnaires are already visible to patients today.</div>
            </div>
          </div>
          {releasedToday.length ? (
            releasedToday.map((review) => (
              <button
                key={review.id}
                type="button"
                className="epro-review__releaseRow"
                onClick={() => setSelectedPatientId(review.firebase_uid)}
              >
                <div>
                  <div className="epro-review__releaseTitle">{review.patient_name || review.subject_id}</div>
                  <div className="section-note">
                    {review.subject_id} - {statusLabel(review.review_status)} - Visible{' '}
                    {formatTimestamp(review.patient_visible_at)}
                  </div>
                </div>
                <span className="metric-pill">{statusLabel(review.review_scope)}</span>
              </button>
            ))
          ) : (
            <div className="empty-panel">
              {isQueueServiceUnavailable ? queueUnavailableMessage : 'No questionnaires have been released today yet.'}
            </div>
          )}
        </div>

        <div className="card workspace-card">
          <div className="epro-review__statusSwitch" role="tablist" aria-label="Mirrored ePRO status filter">
            <button
              type="button"
              className={`epro-review__statusSwitchOption${entryStatusView === 'submitted' ? ' is-active' : ''}`}
              onClick={() => {
                setEntryStatusView('submitted');
                onEntriesPageChange?.(1);
              }}
            >
              Submitted
              <span className="epro-review__statusSwitchCount">{submittedEntries.length}</span>
            </button>
            <button
              type="button"
              className={`epro-review__statusSwitchOption${entryStatusView === 'overdue' ? ' is-active' : ''}`}
              onClick={() => {
                setEntryStatusView('overdue');
                onEntriesPageChange?.(1);
              }}
            >
              Overdue
              <span className="epro-review__statusSwitchCount">{overdueEntries.length}</span>
            </button>
          </div>
          <div className="section-note">Most recent operational visibility from mirrored ePRO records.</div>
          <div className="section-note">Showing {loadedEntryCount} loaded mirrored ePRO records from the current recent window.</div>
          <WindowPaginationControls
            page={effectiveEntriesPage}
            pageSize={entriesPageSize}
            onPageChange={onEntriesPageChange}
            onPageSizeChange={onEntriesPageSizeChange}
            canGoNext={canAdvanceEntries}
            note={`Page ${effectiveEntriesPage} - Showing ${visibleSubmittedOrOverdue.length} of ${filteredEntryRows.length} ${entryStatusLabel} mirrored ePRO rows from the current loaded window.`}
          />
          {visibleSubmittedOrOverdue.length ? (
            visibleSubmittedOrOverdue.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="epro-review__releaseRow"
                onClick={() => setSelectedPatientId(entry.uid)}
              >
                <div>
                  <div className="epro-review__releaseTitle">{entry.patientName || entry.subject_id || entry.uid}</div>
                  <div className="section-note">
                    {entry.form_id} - {statusLabel(deriveOperationalStatus(entry))} - Updated{' '}
                    {formatTimestamp(entry.updated_at || entry.submitted_at || entry.assigned_at)}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-panel">
              {entries.length
                ? `No ${entryStatusView} questionnaire records are visible inside the current loaded mirrored ePRO window.`
                : `No ${entryStatusView} questionnaire records yet.`}
            </div>
          )}
        </div>
      </div>

      <EproStatusPanel entries={entries} selectedPatient={selectedPatient} patients={patients} hideHeading />

      {approveAllOpen ? (
        <div className="modal-shell">
          <div className="modal-card epro-review__confirmCard">
            <button className="modal-close" onClick={() => setApproveAllOpen(false)}>
              Close
            </button>
            <h3>Confirm approve all ePRO drafts</h3>
            <p className="section-note">
              This will approve every current-day pending trial review and every current-day pending patient review.
            </p>
            <div className="workspace-summary-grid workspace-summary-grid--compact">
              <div className="workspace-summary-item">
                <span>Pending trials</span>
                <strong>{metrics ? metrics.pending_trials : EMPTY_METRIC}</strong>
              </div>
              <div className="workspace-summary-item">
                <span>Pending patient drafts</span>
                <strong>{metrics ? metrics.pending_patient_drafts : EMPTY_METRIC}</strong>
              </div>
            </div>
            <div className="epro-review__confirmActions">
              <button className="btn btn-secondary" onClick={() => setApproveAllOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleApproveAll} disabled={busyKey === 'approve-all'}>
                {busyKey === 'approve-all' ? 'Approving...' : 'Confirm Approve All'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
