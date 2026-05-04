import React, { useEffect, useMemo, useState } from 'react';
import WindowPaginationControls from './WindowPaginationControls';
import {
  fetchDropoutDashboardSummary,
  subscribeToDropoutPredictionSnapshotsForUsers,
} from '../services/dropoutService';

const DEFAULT_DROPOUT_PAGE_SIZE = 30;

function renderRiskBucket(bucket) {
  return String(bucket || 'pending').toUpperCase();
}

function getProbabilityNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function formatProbabilityPercent(value) {
  const probability = getProbabilityNumber(value);
  return probability == null ? 'N/A' : `${(probability * 100).toFixed(1)}%`;
}

function formatProbabilityDecimal(value) {
  const probability = getProbabilityNumber(value);
  return probability == null ? 'N/A' : probability.toFixed(3);
}

function isActionableSnapshot(snapshot = {}) {
  if (snapshot.is_actionable === true) return true;
  const riskBucket = String(snapshot.risk_bucket || '').toLowerCase();
  const priorityScore = Number(snapshot.action_priority_score);
  return riskBucket === 'high' || (Number.isFinite(priorityScore) && priorityScore >= 0.5);
}

function getConfidenceLabel(flagsValue) {
  const flags = Array.isArray(flagsValue) ? flagsValue.map((entry) => String(entry || '').toLowerCase()) : [];
  if (flags.includes('confidence_high')) return 'High';
  if (flags.includes('confidence_medium')) return 'Medium';
  if (flags.includes('confidence_limited')) return 'Limited';
  return 'Unknown';
}

function buildSignalLines(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null) return '';
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object') {
          const label = entry.label || entry.signal || entry.key || entry.feature || '';
          const signalValue = entry.value ?? entry.score ?? entry.delta ?? '';
          return label ? `${label}: ${signalValue}` : JSON.stringify(entry);
        }
        return String(entry);
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, signalValue]) => `${key}: ${signalValue}`);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function sortDropoutRows(left, right) {
  const leftProbability = getProbabilityNumber(left.dropout_probability) ?? -1;
  const rightProbability = getProbabilityNumber(right.dropout_probability) ?? -1;
  if (rightProbability !== leftProbability) {
    return rightProbability - leftProbability;
  }

  const leftPriority = Number(left.action_priority_score);
  const rightPriority = Number(right.action_priority_score);
  const safeLeftPriority = Number.isFinite(leftPriority) ? leftPriority : -1;
  const safeRightPriority = Number.isFinite(rightPriority) ? rightPriority : -1;
  if (safeRightPriority !== safeLeftPriority) {
    return safeRightPriority - safeLeftPriority;
  }

  return String(left.patientName || '').localeCompare(String(right.patientName || ''));
}

function MetricCard({ label, value, tone = 'default' }) {
  return (
    <div className={`dropout-dashboard__metric dropout-dashboard__metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailSection({ title, items, emptyLabel }) {
  if (!items.length) {
    return (
      <div className="dropout-dashboard__detailSection">
        <strong>{title}</strong>
        <div className="section-note">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className="dropout-dashboard__detailSection">
      <strong>{title}</strong>
      <ul className="dropout-dashboard__detailList">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function DropoutRiskPanel({
  patients = [],
  onOpenStudyCoordination,
  onOpenPatients,
}) {
  const [snapshotRows, setSnapshotRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [summaryReady, setSummaryReady] = useState(false);
  const [snapshotPageSize, setSnapshotPageSize] = useState(DEFAULT_DROPOUT_PAGE_SIZE);
  const [snapshotPage, setSnapshotPage] = useState(1);

  const loadedUserIds = useMemo(() => patients.map((patient) => patient.id).filter(Boolean), [patients]);
  const loadedUserSignature = useMemo(() => loadedUserIds.join('|'), [loadedUserIds]);

  useEffect(() => {
    return subscribeToDropoutPredictionSnapshotsForUsers(
      loadedUserIds,
      (rows) => {
        setSnapshotRows(rows);
        setError('');
      },
      (nextError) => {
        setSnapshotRows([]);
        setError(nextError.message || 'Unable to read current disengagement snapshots.');
      }
    );
  }, [loadedUserIds, loadedUserSignature]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardSummary() {
      try {
        const payload = await fetchDropoutDashboardSummary();
        if (!cancelled) {
          setSummary(payload);
        }
      } catch (loadError) {
        console.error('Unable to load full disengagement dashboard summary:', loadError);
        if (!cancelled) {
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setSummaryReady(true);
        }
      }
    }

    loadDashboardSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  const joinedRows = useMemo(() => {
    const patientMap = new Map(patients.map((patient) => [patient.id, patient]));
    return snapshotRows
      .map((snapshot) => {
        const patient = patientMap.get(snapshot.userId) || null;
        return {
          ...snapshot,
          patient,
          userId: snapshot.userId,
          patientName: patient?.nickname || patient?.email || snapshot.subject_id || 'Unknown patient',
          patientEmail: patient?.email || '',
          subjectId: snapshot.subject_id || patient?.subject_id || patient?.subjectId || 'Not set',
          primaryCrcName: patient?.primary_crc_name || 'Unassigned',
          isActionable: isActionableSnapshot(snapshot),
        };
      })
      .sort(sortDropoutRows);
  }, [patients, snapshotRows]);

  const filteredRows = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    if (!queryText) return joinedRows;

    return joinedRows.filter((entry) => {
      const haystack = [entry.patientName, entry.subjectId, entry.patientEmail]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(queryText);
    });
  }, [joinedRows, searchQuery]);

  const totalLoadedPages = Math.max(1, Math.ceil(filteredRows.length / snapshotPageSize));
  const effectiveSnapshotPage = Math.min(snapshotPage, totalLoadedPages);
  const visibleRows = filteredRows.slice(
    (effectiveSnapshotPage - 1) * snapshotPageSize,
    effectiveSnapshotPage * snapshotPageSize
  );
  const canGoToNextSnapshotPage = filteredRows.length > effectiveSnapshotPage * snapshotPageSize;

  const activeEntry = useMemo(
    () => visibleRows.find((entry) => entry.userId === selectedUserId) || visibleRows[0] || filteredRows[0] || null,
    [filteredRows, selectedUserId, visibleRows]
  );

  const dashboardMetrics = useMemo(
    () => ({
      scoredCount: Number.isFinite(Number(summary?.scored_count)) ? Number(summary.scored_count) : null,
      highRiskCount: Number.isFinite(Number(summary?.high_risk_count)) ? Number(summary.high_risk_count) : null,
      actionableCount: Number.isFinite(Number(summary?.actionable_count)) ? Number(summary.actionable_count) : null,
      averageProbability: getProbabilityNumber(summary?.average_probability),
      publishedAt: summary?.published_at || '',
    }),
    [summary]
  );

  const explanationSignals = useMemo(
    () => buildSignalLines(activeEntry?.explanation_signals),
    [activeEntry?.explanation_signals]
  );
  const missingInputs = useMemo(
    () => buildSignalLines(activeEntry?.missing_inputs_summary),
    [activeEntry?.missing_inputs_summary]
  );
  const dataQualityFlags = useMemo(
    () => buildSignalLines(activeEntry?.data_quality_flags),
    [activeEntry?.data_quality_flags]
  );

  const openStudyCoordination = () => {
    if (activeEntry?.patient && typeof onOpenStudyCoordination === 'function') {
      onOpenStudyCoordination(activeEntry.patient);
    }
  };

  const openPatientRoster = () => {
    if (activeEntry?.patient && typeof onOpenPatients === 'function') {
      onOpenPatients(activeEntry.patient);
    }
  };

  const content = (() => {
    if (error) {
      return (
        <div className="empty-panel">
          Unable to load live disengagement snapshots right now.
          <div className="section-note section-note--spaced">{error}</div>
        </div>
      );
    }

    if (!joinedRows.length) {
      return (
        <div className="empty-panel">
          No published disengagement snapshots are available yet.
          <div className="section-note section-note--spaced">
            Run the daily precompute workflow or publish snapshots before using this workspace.
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="dropout-dashboard__metrics">
          <MetricCard label="Scored patients" value={dashboardMetrics.scoredCount ?? 'N/A'} />
          <MetricCard label="High-risk patients" value={dashboardMetrics.highRiskCount ?? 'N/A'} tone="warning" />
          <MetricCard label="Actionable patients" value={dashboardMetrics.actionableCount ?? 'N/A'} tone="brand" />
          <MetricCard
            label="Average risk"
            value={
              dashboardMetrics.averageProbability == null
                ? 'N/A'
                : formatProbabilityPercent(dashboardMetrics.averageProbability)
            }
          />
        </div>

        <div className="section-note section-note--spaced">
          {summary
            ? `Summary cards reflect the latest published full disengagement dashboard summary${
                dashboardMetrics.publishedAt
                  ? ` from ${new Date(dashboardMetrics.publishedAt).toLocaleString()}`
                  : ''
              }. The ranked list below remains paginated from the currently loaded patient window.`
            : summaryReady
              ? 'Full disengagement dashboard summary is not available yet. The ranked list below still works, but summary cards stay blank until the next published summary is available.'
              : 'Loading the latest published disengagement dashboard summary...'}
        </div>

        <div className="dropout-dashboard__layout">
          <div className="dropout-dashboard__listCard">
            <div className="section-header section-header--tight">
              <div>
                <h3 className="mt-0">Risk-ranked patients</h3>
                <div className="section-note">
                  Search by patient name, subject ID, or email. Results stay sorted from highest to lowest risk inside the loaded current snapshot window.
                </div>
                <div className="section-note section-note--spaced">
                  Showing {visibleRows.length} visible patients from {filteredRows.length} loaded current snapshots. Full summary cards above are sourced separately from the latest published disengagement summary.
                </div>
              </div>
              <div className="dropout-dashboard__detailActions">
                <span className="metric-pill">{filteredRows.length} loaded</span>
              </div>
            </div>

            <input
              type="text"
              className="dropout-dashboard__search"
              placeholder="Search patient name, subject ID, or email"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSnapshotPage(1);
              }}
            />

            <WindowPaginationControls
              page={effectiveSnapshotPage}
              pageSize={snapshotPageSize}
              onPageChange={setSnapshotPage}
              onPageSizeChange={(value) => {
                setSnapshotPageSize(value);
                setSnapshotPage(1);
              }}
              canGoNext={canGoToNextSnapshotPage}
              note={`Page ${effectiveSnapshotPage} - Showing up to ${snapshotPageSize} ranked patients from the loaded disengagement snapshot window.`}
            />

            <div className="dropout-dashboard__list">
              {visibleRows.length ? (
                visibleRows.map((entry) => {
                  const isSelected = entry.userId === activeEntry?.userId;
                  return (
                    <button
                      key={entry.userId}
                      type="button"
                      className={`dropout-dashboard__row ${isSelected ? 'dropout-dashboard__row--selected' : ''}`}
                      onClick={() => setSelectedUserId(entry.userId)}
                    >
                      <div className="dropout-dashboard__rowTop">
                        <div>
                          <div className="dropout-dashboard__patientName">{entry.patientName}</div>
                          <div className="dropout-dashboard__rowMeta">{entry.patientEmail || 'No email recorded'}</div>
                        </div>
                        <span className="dropout-card__bucket">{renderRiskBucket(entry.risk_bucket)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>Subject ID: {entry.subjectId}</span>
                        <span>Risk: {formatProbabilityPercent(entry.dropout_probability)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>Confidence: {getConfidenceLabel(entry.data_quality_flags)}</span>
                        <span>Action: {entry.recommended_action || 'N/A'}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>{entry.published_at ? new Date(entry.published_at).toLocaleString() : 'Not published'}</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="empty-panel">No patients match the current search.</div>
              )}
            </div>
          </div>

          <div className="dropout-dashboard__detailCard">
            {activeEntry ? (
              <>
                <div className="section-header">
                  <div>
                    <h3 className="mt-0">Patient disengagement detail</h3>
                    <div className="section-note">
                      Detailed CRC-only snapshot for the selected patient. This panel updates immediately when you select a different row.
                    </div>
                  </div>
                  <div className="dropout-dashboard__detailActions">
                    <button className="btn btn-secondary btn-small" onClick={openPatientRoster} disabled={!activeEntry.patient}>
                      Open Patients
                    </button>
                    <button className="btn btn-primary btn-small" onClick={openStudyCoordination} disabled={!activeEntry.patient}>
                      Open Study Coordination
                    </button>
                  </div>
                </div>

                <div className="dropout-dashboard__detailSummary">
                  <div className="dropout-card">
                    <div className="dropout-card__header">
                      <strong>{activeEntry.patientName}</strong>
                      <span className="dropout-card__bucket">{renderRiskBucket(activeEntry.risk_bucket)}</span>
                    </div>
                    <div className="dropout-card__metric">Subject ID: {activeEntry.subjectId}</div>
                    <div className="dropout-card__metric">Risk probability: {formatProbabilityDecimal(activeEntry.dropout_probability)}</div>
                    <div className="dropout-card__metric">Confidence: {getConfidenceLabel(activeEntry.data_quality_flags)}</div>
                    <div className="dropout-card__metric">Recommended action: {activeEntry.recommended_action || 'N/A'}</div>
                    <div className="dropout-card__metric">Action priority score: {activeEntry.action_priority_score ?? 'N/A'}</div>
                    <div className="dropout-card__metric">Primary CRC: {activeEntry.primaryCrcName}</div>
                    <div className="dropout-card__metric">
                      Last published: {activeEntry.published_at ? new Date(activeEntry.published_at).toLocaleString() : 'N/A'}
                    </div>
                  </div>

                  <div className="dropout-card dropout-card--soft">
                    <strong>Model contract</strong>
                    <div className="dropout-card__metric">Stage: {activeEntry.routed_stage || 'N/A'}</div>
                    <div className="dropout-card__metric">Prediction horizon: {activeEntry.pred_horizon_days || 'N/A'} days</div>
                    <div className="dropout-card__metric">History window: {activeEntry.history_window_days || 'N/A'} days</div>
                    <div className="dropout-card__metric">Model version: {activeEntry.model_version || 'N/A'}</div>
                  </div>
                </div>

                <DetailSection
                  title="Explanation signals"
                  items={explanationSignals}
                  emptyLabel="No explanation signals were included in the current snapshot."
                />
                <DetailSection
                  title="Missing inputs summary"
                  items={missingInputs}
                  emptyLabel="No missing-input issues were reported for the current snapshot."
                />
                <DetailSection
                  title="Data quality flags"
                  items={dataQualityFlags}
                  emptyLabel="No data-quality flags were reported for the current snapshot."
                />
              </>
            ) : (
              <div className="empty-panel">Select a ranked patient to inspect the current disengagement snapshot.</div>
            )}
          </div>
        </div>
      </>
    );
  })();

  return (
    <div className="card workspace-card intelligence-card intelligence-card--dropout">
      <div className="section-header">
        <div>
          <h3 className="mt-0">Patient Disengagement Prediction</h3>
          <div className="section-note">
            Dedicated CRC-only workspace sourced from live Firestore current snapshots. Summary cards use the published full disengagement summary, while the ranked list stays paginated within the loaded patient window.
          </div>
        </div>
        <span className="metric-pill">CRC only</span>
      </div>
      {content}
    </div>
  );
}
