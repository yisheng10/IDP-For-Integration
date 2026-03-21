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
      return <div style={styles.note}>Select a patient to inspect the dropout adapter state.</div>;
    }

    if (adapterState.status === 'loading') {
      return <div style={styles.note}>Querying the dropout contract adapter...</div>;
    }

    if (adapterState.status === 'unavailable') {
      return (
        <div style={styles.fallbackCard}>
          <div style={styles.fallbackTitle}>Adapter unavailable</div>
          <div style={styles.note}>
            The CRC-only contract is wired, but no live risk payload is currently reachable for this subject.
          </div>
          <div style={styles.note}>Reason: {adapterState.error || 'Unknown adapter error.'}</div>
        </div>
      );
    }

    if (adapterState.status === 'ready' && adapterState.data) {
      const data = adapterState.data;
      return (
        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={styles.primaryCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <strong>{selectedPatient.nickname}</strong>
              <span style={styles.bucket}>{renderRiskBucket(data.risk_bucket)}</span>
            </div>
            <div style={styles.metric}>Subject ID: {data.subject_id || selectedSubjectId}</div>
            <div style={styles.metric}>Dropout probability: {typeof data.dropout_probability === 'number' ? data.dropout_probability.toFixed(3) : 'N/A'}</div>
            <div style={styles.metric}>Recommended action: {data.recommended_action || 'N/A'}</div>
            <div style={styles.metric}>Routed stage: {data.routed_stage || 'N/A'}</div>
          </div>

          {Array.isArray(data.data_quality_flags) && data.data_quality_flags.length > 0 ? (
            <div style={styles.secondaryCard}>
              <strong>Data quality flags</strong>
              <div style={styles.note}>{data.data_quality_flags.join(', ')}</div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div style={styles.fallbackCard}>
        <div style={styles.fallbackTitle}>Pending adapter state</div>
        <div style={styles.note}>The CRC panel is ready to consume the dropout contract once a live payload is available.</div>
      </div>
    );
  })();

  return (
    <div className="card" style={{ borderTop: '4px solid #9a5f00' }}>
      <h3 className="mt-0" style={{ marginBottom: '6px' }}>Dropout Risk Adapter</h3>
      <div style={{ color: '#5b6470', fontSize: '13px', marginBottom: '16px' }}>
        CRC-only placeholder and contract adapter. This module must never be exposed in patient surfaces.
      </div>
      {content}
    </div>
  );
}

const styles = {
  note: {
    color: '#5b6470',
    fontSize: '14px',
    lineHeight: 1.5,
  },
  fallbackCard: {
    padding: '14px',
    borderRadius: '10px',
    background: '#fff8ef',
    border: '1px solid #eed6b2',
  },
  fallbackTitle: {
    fontWeight: 'bold',
    color: '#8b5a00',
    marginBottom: '8px',
  },
  primaryCard: {
    padding: '14px',
    borderRadius: '10px',
    background: '#ffffff',
    border: '1px solid #eed6b2',
  },
  secondaryCard: {
    padding: '12px',
    borderRadius: '10px',
    background: '#fffaf2',
    border: '1px solid #f3e1c3',
  },
  metric: {
    color: '#4e4b57',
    fontSize: '14px',
    marginTop: '6px',
  },
  bucket: {
    background: '#9a5f00',
    color: '#fff',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
};
