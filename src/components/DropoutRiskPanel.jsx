import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToAllDropoutPredictionSnapshots } from '../services/dropoutService';

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

  useEffect(() => {
    return subscribeToAllDropoutPredictionSnapshots(
      (rows) => {
        setSnapshotRows(rows);
        setError('');
      },
      (nextError) => {
        setSnapshotRows([]);
        setError(nextError.message || 'Unable to read current dropout snapshots.');
      }
    );
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
      const haystack = [
        entry.patientName,
        entry.subjectId,
        entry.patientEmail,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(queryText);
    });
  }, [joinedRows, searchQuery]);

  const activeEntry = useMemo(
    () => filteredRows.find((entry) => entry.userId === selectedUserId) || filteredRows[0] || null,
    [filteredRows, selectedUserId]
  );

  const dashboardMetrics = useMemo(() => {
    const scoredCount = joinedRows.length;
    const highRiskCount = joinedRows.filter((entry) => String(entry.risk_bucket || '').toLowerCase() === 'high').length;
    const actionableCount = joinedRows.filter((entry) => entry.isActionable).length;
    const numericProbabilities = joinedRows
      .map((entry) => getProbabilityNumber(entry.dropout_probability))
      .filter((value) => value != null);

    const averageProbability =
      numericProbabilities.length > 0
        ? numericProbabilities.reduce((sum, value) => sum + value, 0) / numericProbabilities.length
        : null;

    return {
      scoredCount,
      highRiskCount,
      actionableCount,
      averageProbability,
    };
  }, [joinedRows]);

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
          Unable to load live dropout snapshots right now.
          <div className="section-note section-note--spaced">{error}</div>
        </div>
      );
    }

    if (!joinedRows.length) {
      return (
        <div className="empty-panel">
          No published dropout snapshots are available yet.
          <div className="section-note section-note--spaced">
            Run the daily precompute workflow or publish snapshots before using this dashboard.
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="dropout-dashboard__metrics">
          <MetricCard label="Total scored patients" value={dashboardMetrics.scoredCount} />
          <MetricCard label="High-risk patients" value={dashboardMetrics.highRiskCount} tone="warning" />
          <MetricCard label="Actionable patients" value={dashboardMetrics.actionableCount} tone="brand" />
          <MetricCard
            label="Average dropout probability"
            value={dashboardMetrics.averageProbability == null ? 'N/A' : formatProbabilityPercent(dashboardMetrics.averageProbability)}
          />
        </div>

        <div className="dropout-dashboard__layout">
          <div className="dropout-dashboard__listCard">
            <div className="section-header section-header--tight">
              <div>
                <h3 className="mt-0">Risk-ranked patients</h3>
                <div className="section-note">
                  Search by patient name, subject ID, or email. Results stay sorted from highest to lowest risk.
                </div>
              </div>
              <span className="metric-pill">{filteredRows.length} visible</span>
            </div>

            <input
              type="text"
              className="dropout-dashboard__search"
              placeholder="Search patient name, subject ID, or email"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />

            <div className="dropout-dashboard__list">
              {filteredRows.length ? (
                filteredRows.map((entry) => {
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
                        <span>Probability: {formatProbabilityPercent(entry.dropout_probability)}</span>
                      </div>

                      <div className="dropout-dashboard__rowStats">
                        <span>Action: {entry.recommended_action || 'N/A'}</span>
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
                    <h3 className="mt-0">Patient dropout detail</h3>
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
                    <div className="dropout-card__metric">Dropout probability: {formatProbabilityDecimal(activeEntry.dropout_probability)}</div>
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
              <div className="empty-panel">Select a ranked patient to inspect the current dropout snapshot.</div>
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
          <h3 className="mt-0">Patient Dropout Prediction</h3>
          <div className="section-note">
            Dedicated CRC-only dashboard sourced from live Firestore current snapshots. Patients are ranked from highest to lowest dropout risk.
          </div>
        </div>
        <span className="metric-pill">CRC only</span>
      </div>
      {content}
    </div>
  );
}
