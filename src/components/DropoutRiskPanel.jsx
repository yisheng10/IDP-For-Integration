import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToDropoutPredictionSnapshot } from '../services/dropoutService';

function deriveMappedSubject(patient) {
  const mappedSubjectId = patient?.dropout_subject_id || patient?.dropoutSubjectId || '';
  if (mappedSubjectId) {
    return {
      subjectId: mappedSubjectId,
      source: 'testing_mapping',
    };
  }

  const canonicalSubjectId =
    patient?.subject_id || patient?.subjectId || patient?.trialSubjectId || patient?.id || '';
  if (/^NCT.+_P\d+$/i.test(canonicalSubjectId)) {
    return {
      subjectId: canonicalSubjectId,
      source: 'canonical_subject',
    };
  }

  return {
    subjectId: '',
    source: 'missing_mapping',
  };
}

function renderRiskBucket(bucket) {
  if (!bucket) return 'PENDING';
  return String(bucket).toUpperCase();
}

function renderErrorCard(title, description, reason) {
  return (
    <div className="dropout-card dropout-card--warning">
      <div className="dropout-card__title">{title}</div>
      <div className="section-note">{description}</div>
      {reason ? <div className="section-note">Reason: {reason}</div> : null}
    </div>
  );
}

function computeStaleness(snapshot) {
  if (!snapshot?.published_at) {
    return 'pending';
  }
  const ageMs = Date.now() - new Date(snapshot.published_at).getTime();
  if (ageMs > 36 * 60 * 60 * 1000) {
    return 'stale';
  }
  return snapshot.staleness_status || 'fresh';
}

export default function DropoutRiskPanel({ selectedPatient }) {
  const [subscriptionState, setSubscriptionState] = useState({
    patientId: '',
    data: null,
    error: '',
    code: '',
  });

  const resolution = useMemo(() => deriveMappedSubject(selectedPatient), [selectedPatient]);

  useEffect(() => {
    if (!selectedPatient?.id || !resolution.subjectId) {
      return () => {};
    }

    return subscribeToDropoutPredictionSnapshot(
      selectedPatient.id,
      (snapshot) => {
        if (!snapshot) {
          setSubscriptionState({
            patientId: selectedPatient.id,
            data: null,
            error: '',
            code: 'snapshot_missing',
          });
          return;
        }

        setSubscriptionState({
          patientId: selectedPatient.id,
          data: snapshot,
          error: '',
          code: computeStaleness(snapshot),
        });
      },
      (error) => {
        setSubscriptionState({
          patientId: selectedPatient.id,
          data: null,
          error: error.message,
          code: 'mirror_error',
        });
      }
    );
  }, [resolution.subjectId, selectedPatient?.id]);

  const content = (() => {
    if (!selectedPatient) {
      return <div className="section-note">Select a patient to inspect the CRC-only dropout prediction.</div>;
    }

    if (!resolution.subjectId) {
      return renderErrorCard(
        'No mapped dropout subject',
        'Select a dropout testing subject in Patient configuration before scoring this patient.',
        'No mapped dropout subject. Assign a testing subject in Patient configuration.'
      );
    }

    if (subscriptionState.patientId !== selectedPatient.id) {
      return <div className="section-note">Loading the latest published dropout snapshot...</div>;
    }

    if (subscriptionState.error) {
      return renderErrorCard(
        'Snapshot unavailable',
        'The CRC-only dropout mirror could not be loaded from Firestore.',
        subscriptionState.error
      );
    }

    if (!subscriptionState.data) {
      return renderErrorCard(
        'Prediction pending',
        'No published dropout snapshot exists yet for this patient. Run the scheduled precompute or workflow dispatch first.',
        ''
      );
    }

    if (subscriptionState.data) {
      const data = subscriptionState.data;
      const staleness = computeStaleness(data);
      return (
        <div className="dropout-stack">
          <div className="dropout-card">
            <div className="dropout-card__header">
              <strong>{selectedPatient.nickname}</strong>
              <span className="dropout-card__bucket">{renderRiskBucket(data.risk_bucket)}</span>
            </div>
            <div className="dropout-card__metric">Testing subject: {data.dropout_subject_id || data.subject_id || resolution.subjectId}</div>
            <div className="dropout-card__metric">
              Dropout probability:{' '}
              {typeof data.dropout_probability === 'number' ? data.dropout_probability.toFixed(3) : 'N/A'}
            </div>
            <div className="dropout-card__metric">Recommended action: {data.recommended_action || 'N/A'}</div>
            <div className="dropout-card__metric">Risk bucket: {data.risk_bucket || 'N/A'}</div>
            <div className="dropout-card__metric">Last published: {data.published_at ? new Date(data.published_at).toLocaleString() : 'N/A'}</div>
          </div>

          <div className="dropout-card dropout-card--soft">
            <strong>Mapping source</strong>
            <div className="section-note">
              {resolution.source === 'testing_mapping'
                ? 'Using the explicit dropout testing subject selected for this patient.'
                : 'Using the canonical subject ID because it already matches the dropout dataset format.'}
            </div>
          </div>

          <div className={`dropout-card ${staleness === 'stale' ? 'dropout-card--warning' : 'dropout-card--soft'}`}>
            <strong>Snapshot freshness</strong>
            <div className="section-note">
              {staleness === 'stale'
                ? 'This published snapshot is stale. Re-run the scheduled precompute workflow to refresh it.'
                : 'This panel is reading the current published CRC-only snapshot from Firestore.'}
            </div>
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
            CRC-only predictive view sourced from the latest published Firestore snapshot. This module must never be exposed in patient surfaces.
          </div>
        </div>
        <span className="metric-pill">CRC only</span>
      </div>
      {content}
    </div>
  );
}
