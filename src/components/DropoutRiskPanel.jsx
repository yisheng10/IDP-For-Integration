import React, { useEffect, useMemo, useState } from 'react';
import { fetchDropoutRiskSnapshot } from '../services/dropoutService';

function deriveSubjectId(patient) {
  return patient?.subject_id || patient?.subjectId || patient?.trialSubjectId || patient?.id;
}

function renderRiskBucket(bucket) {
  if (!bucket) return 'PENDING';
  return String(bucket).toUpperCase();
}

export default function DropoutRiskPanel({ selectedPatient, eproEntries = [] }) {
  const [adapterState, setAdapterState] = useState({ status: 'idle', data: null, error: '' });

  const selectedSubjectId = deriveSubjectId(selectedPatient);
  const currentDay = useMemo(() => Math.max(1, eproEntries.length || 1), [eproEntries]);

  useEffect(() => {
    let cancelled = false;

    async function loadRisk() {
      if (!selectedSubjectId) {
        setAdapterState({ status: 'idle', data: null, error: '' });
        return;
      }

      setAdapterState({ status: 'loading', data: null, error: '' });

      try {
        const payload = await fetchDropoutRiskSnapshot({
          subjectId: selectedSubjectId,
          currentDay,
        });

        if (!cancelled) {
          setAdapterState({ status: 'ready', data: payload, error: '' });
        }
      } catch (error) {
        if (!cancelled) {
          setAdapterState({
            status: 'unavailable',
            data: null,
            error: error.name === 'AbortError' ? 'Adapter timed out.' : error.message,
          });
        }
      }
    }

    loadRisk();
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId, currentDay]);

  const content = (() => {
    if (!selectedPatient) {
      return <div className="section-note">Select a patient to inspect the CRC-only dropout prediction.</div>;
    }

    if (adapterState.status === 'loading') {
      return <div className="section-note">Querying the dropout prediction contract...</div>;
    }

    if (adapterState.status === 'unavailable') {
      return (
        <div className="dropout-card dropout-card--warning">
          <div className="dropout-card__title">Prediction unavailable</div>
          <div className="section-note">
            The CRC-only contract is wired, but no live risk payload is currently reachable for this subject.
          </div>
          <div className="section-note">Reason: {adapterState.error || 'Unknown adapter error.'}</div>
        </div>
      );
    }

    if (adapterState.status === 'ready' && adapterState.data) {
      const data = adapterState.data;
      return (
        <div className="dropout-stack">
          <div className="dropout-card">
            <div className="dropout-card__header">
              <strong>{selectedPatient.nickname}</strong>
              <span className="dropout-card__bucket">{renderRiskBucket(data.risk_bucket)}</span>
            </div>
            <div className="dropout-card__metric">Subject ID: {data.subject_id || selectedSubjectId}</div>
            <div className="dropout-card__metric">
              Dropout probability:{' '}
              {typeof data.dropout_probability === 'number' ? data.dropout_probability.toFixed(3) : 'N/A'}
            </div>
            <div className="dropout-card__metric">Recommended action: {data.recommended_action || 'N/A'}</div>
            <div className="dropout-card__metric">Routed stage: {data.routed_stage || 'N/A'}</div>
          </div>

          {Array.isArray(data.data_quality_flags) && data.data_quality_flags.length > 0 ? (
            <div className="dropout-card dropout-card--soft">
              <strong>Data quality flags</strong>
              <div className="section-note">{data.data_quality_flags.join(', ')}</div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="dropout-card dropout-card--warning">
        <div className="dropout-card__title">Pending contract state</div>
        <div className="section-note">
          The CRC panel is ready to consume the dropout prediction contract once a live payload is available.
        </div>
      </div>
    );
  })();

  return (
    <div className="card workspace-card intelligence-card intelligence-card--dropout">
      <div className="section-header">
        <div>
          <h3 className="mt-0">Patient Dropout Prediction</h3>
          <div className="section-note">
            CRC-only predictive view. This module must never be exposed in patient surfaces.
          </div>
        </div>
        <span className="metric-pill">CRC only</span>
      </div>
      {content}
    </div>
  );
}
