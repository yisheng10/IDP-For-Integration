import React, { useState } from 'react';

export default function PatientEditMenu({
  patient,
  email,
  setEmail,
  primaryCrcId,
  setPrimaryCrcId,
  primaryCrcPhone,
  setPrimaryCrcPhone,
  studyEmergencyPhone,
  setStudyEmergencyPhone,
  assignedProtocolId,
  setAssignedProtocolId,
  protocolOptions = [],
  assignedProtocol,
  currentDropoutTrialId = '',
  currentDropoutTrialStatus = 'not_configured',
  currentDropoutTrialStatusLabel = 'Not configured',
  currentDropoutTrialStatusMessage = '',
  currentProtocolStaticContextStatus = 'not_started',
  currentProtocolStaticContextStatusLabel = 'Static context not ready',
  currentProtocolStaticContextTone = 'warning',
  currentProtocolStaticContextMessage = '',
  currentDropoutTrialPoolSize = 0,
  currentDropoutTrialModelVersion = '',
  currentDropoutTrialLastVerifiedAt = '',
  mappingStatus = 'unmapped',
  mappingStatusNote = '',
  isMappingStatusPending = false,
  inheritedVitals = [],
  subjectId,
  setSubjectId,
  crcUsers,
  dropoutOptions = [],
  onSave,
  isSaving,
  successMsg,
  subjectIdError = '',
  primaryCrcPhoneError = '',
  studyEmergencyPhoneError = '',
  disableSave = false,
  onDeletePatient,
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!patient) return null;

  const canDeletePatient = typeof onDeletePatient === 'function';
  const normalizedSubjectId = String(subjectId || '').trim();
  const currentProtocolName = assignedProtocol?.name || patient.protocolName || 'Not assigned';
  const subjectPoolOptions = Array.isArray(dropoutOptions) ? dropoutOptions : [];
  const subjectOptionExists = subjectPoolOptions.some((option) => option.subject_id === normalizedSubjectId);
  const subjectOptions =
    normalizedSubjectId && !subjectOptionExists
      ? [
          {
            subject_id: normalizedSubjectId,
            trial_id: currentDropoutTrialId || 'Current mapping outside the current trial pool',
          },
          ...subjectPoolOptions,
        ]
      : subjectPoolOptions;
  const mappingTone = isMappingStatusPending
    ? 'brand'
    : mappingStatus === 'mapped'
      ? 'success'
      : mappingStatus === 'invalid'
        ? 'danger'
        : 'warning';
  const mappingLabel = isMappingStatusPending
    ? 'Checking mapping...'
    : mappingStatus === 'mapped'
      ? 'Mapped'
      : mappingStatus === 'invalid'
      ? 'Invalid mapping'
      : 'Unmapped';
  const isProtocolStaticContextReady = currentProtocolStaticContextStatus === 'ready';
  const isTrialReadyForSubjectSelection =
    currentDropoutTrialStatus === 'configured' && isProtocolStaticContextReady;
  const disableSubjectSelection = !isTrialReadyForSubjectSelection && !normalizedSubjectId;
  const hasCanonicalSubjectOptions = subjectPoolOptions.length > 0;
  const subjectPoolWarning = !isProtocolStaticContextReady
    ? currentProtocolStaticContextMessage ||
      'The current protocol has not finished strict disengagement static-context extraction yet, so Subject ID selection stays disabled.'
    : !currentDropoutTrialId
    ? 'No canonical Subject IDs are available because the current protocol does not have a configured dropout_trial_id yet. Open Protocols and set the disengagement dataset trial ID first.'
    : !isTrialReadyForSubjectSelection
      ? currentDropoutTrialStatusMessage ||
        `The current protocol trial mapping ${currentDropoutTrialId} is not verified for canonical Subject ID selection yet.`
      : !hasCanonicalSubjectOptions
      ? `No canonical Subject IDs are currently available for ${currentDropoutTrialId}.`
      : '';
  const trialReadyNote = !isProtocolStaticContextReady
    ? currentProtocolStaticContextMessage
    : isTrialReadyForSubjectSelection
    ? `This disengagement trial binding is verified. ${currentDropoutTrialPoolSize || 0} canonical Subject IDs are currently available in the ${currentDropoutTrialId} pool.`
    : currentDropoutTrialStatusMessage;
  const formattedLastVerifiedAt = currentDropoutTrialLastVerifiedAt
    ? new Date(currentDropoutTrialLastVerifiedAt).toLocaleString()
    : '';

  const handleDeleteConfirm = async () => {
    if (!canDeletePatient || deleteConfirmValue !== 'DELETE' || isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDeletePatient();
      setShowDeleteDialog(false);
      setDeleteConfirmValue('');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="patient-workspace__card patient-config">
        <div className="section-header">
          <div>
            <h3>Patient configuration</h3>
            <div className="section-note">
              This subject mapping links the real patient record to the canonical subject ID used only by the CRC-only disengagement prediction workspace.
            </div>
          </div>
          {canDeletePatient ? (
            <button
              type="button"
              className="btn btn-danger btn-small"
              onClick={() => {
                setDeleteConfirmValue('');
                setShowDeleteDialog(true);
              }}
            >
              Delete patient
            </button>
          ) : null}
        </div>

      <div className="patient-config__section">
        <div className="patient-config__sectionHeader">
          <strong>Identity</strong>
          <span>Email and subject mapping</span>
        </div>
        <div className="patient-config__pillWrap" style={{ marginBottom: '12px' }}>
          <span className={`metric-pill metric-pill--${mappingTone}`}>{mappingLabel}</span>
          <span className="metric-pill">{currentProtocolName}</span>
          <span className={`metric-pill ${currentDropoutTrialId ? 'metric-pill--brand' : 'metric-pill--warning'}`}>
            {currentDropoutTrialId || 'No dropout_trial_id configured'}
          </span>
          <span className={`metric-pill metric-pill--${currentProtocolStaticContextTone || (isProtocolStaticContextReady ? 'success' : 'warning')}`}>
            {currentProtocolStaticContextStatusLabel}
          </span>
          <span className={`metric-pill metric-pill--${isTrialReadyForSubjectSelection ? 'success' : 'warning'}`}>
            {currentDropoutTrialStatusLabel}
          </span>
        </div>
        <div className="patient-config__grid">
          <div className="patient-config__field">
            <label className="patient-config__label">Patient email</label>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Patient email" />
          </div>
          <div className="patient-config__field">
            <label className="patient-config__label">Subject ID</label>
            <select
              value={subjectId || ''}
              onChange={(event) => setSubjectId(event.target.value)}
              disabled={disableSubjectSelection}
            >
              <option value="">No mapped subject ID</option>
              {subjectOptions.map((option) => (
                <option key={option.subject_id} value={option.subject_id}>
                  {option.subject_id}
                  {option.trial_id ? ` (${option.trial_id})` : ''}
                </option>
              ))}
            </select>
            {subjectIdError ? <div className="field-error">{subjectIdError}</div> : null}
            {!subjectIdError && subjectPoolWarning ? <div className="field-error">{subjectPoolWarning}</div> : null}
          </div>
        </div>
        <div className="section-note">
          Subject ID is a CRC-only canonical mapping for disengagement prediction. It does not affect patient login or general CRC profile management. TL-SXXXXX IDs come from the canonical dropout subject registry and subject ID map; CRC is selecting an existing canonical subject, not generating a random one. Clearing this field is allowed, but this patient will stay out of dropout scoring until a valid Subject ID is mapped again.
        </div>
        {trialReadyNote ? <div className="section-note section-note--spaced">{trialReadyNote}</div> : null}
        {currentDropoutTrialModelVersion ? (
          <div className="section-note">Model version: {currentDropoutTrialModelVersion}</div>
        ) : null}
        {formattedLastVerifiedAt ? (
          <div className="section-note">Last verified: {formattedLastVerifiedAt}</div>
        ) : null}
        {mappingStatusNote ? <div className="section-note section-note--spaced">{mappingStatusNote}</div> : null}
      </div>

      <div className="patient-config__section">
        <div className="patient-config__sectionHeader">
          <strong>CRC ownership</strong>
          <span>Primary coordinator and escalation contacts</span>
        </div>
        <div className="patient-config__grid patient-config__grid--ownership">
          <div className="patient-config__field">
            <label className="patient-config__label">Primary CRC</label>
            <select value={primaryCrcId || ''} onChange={(event) => setPrimaryCrcId(event.target.value)}>
              <option value="">Unassigned</option>
              {(crcUsers || []).map((crc) => (
                <option key={crc.id} value={crc.id}>
                  {crc.resolvedName || crc.nickname || crc.email || crc.id}
                </option>
              ))}
            </select>
          </div>
          <div className="patient-config__field">
            <label className="patient-config__label">Primary CRC phone</label>
            <input
              value={primaryCrcPhone}
              onChange={(event) => setPrimaryCrcPhone(event.target.value)}
              placeholder="Primary CRC phone"
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(primaryCrcPhoneError)}
            />
            {primaryCrcPhoneError ? <div className="field-error">{primaryCrcPhoneError}</div> : null}
          </div>
          <div className="patient-config__field">
            <label className="patient-config__label">Study emergency phone</label>
            <input
              value={studyEmergencyPhone}
              onChange={(event) => setStudyEmergencyPhone(event.target.value)}
              placeholder="Study emergency phone"
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={Boolean(studyEmergencyPhoneError)}
            />
            {studyEmergencyPhoneError ? <div className="field-error">{studyEmergencyPhoneError}</div> : null}
          </div>
          <div className="patient-config__field patient-config__field--note">
            <div className="info-banner">
              <strong>Study emergency phone</strong>
              <div className="section-note section-note--spaced">
                Manual trial or site escalation phone shown to the patient. It is not generated automatically by the system.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="patient-config__section">
        <div className="patient-config__sectionHeader">
          <strong>Trial assignment</strong>
        </div>
        <div className="patient-config__field">
          <div className="section-header section-header--tight">
            <label className="patient-config__label" style={{ marginBottom: 0 }}>
              Protocol
            </label>
            <span className="metric-pill">{assignedProtocol?.name || patient.protocolName || 'Not assigned'}</span>
          </div>
          <select value={assignedProtocolId || ''} onChange={(event) => setAssignedProtocolId(event.target.value)}>
            <option value="">No assigned trial</option>
            {(protocolOptions || []).map((protocol) => (
              <option key={protocol.id} value={protocol.id}>
                {protocol.name}
              </option>
            ))}
          </select>
        </div>

        <div className="patient-config__field">
          <label className="patient-config__label">Inherited monitored vitals</label>
          {inheritedVitals.length ? (
            <div className="patient-config__pillWrap">
              {inheritedVitals.map((label) => (
                <span key={label} className="metric-pill">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <div className="section-note">Assign a clinical trial template to load monitored vitals for this patient.</div>
          )}
        </div>
      </div>

        <div className="patient-config__footer">
          <button onClick={onSave} className="btn btn-success" disabled={isSaving || disableSave}>
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
          {successMsg ? <span className="text-green">{successMsg}</span> : null}
        </div>
      </div>
      {showDeleteDialog ? (
        <div className="modal-shell" role="dialog" aria-modal="true" aria-labelledby="delete-patient-title">
          <div className="modal-card">
            <button
              type="button"
              className="modal-close"
              onClick={() => {
                if (isDeleting) return;
                setShowDeleteDialog(false);
                setDeleteConfirmValue('');
              }}
            >
              Close
            </button>
            <div className="section-header section-header--tight">
              <div>
                <h3 id="delete-patient-title">Delete patient</h3>
                <div className="section-note">
                  This is a dangerous action. Type <strong>DELETE</strong> to hard-purge this patient from the live CRC roster, safety records, adverse event guidance, ePRO, prediction links, and related runtime data.
                </div>
              </div>
            </div>
            <div className="patient-config__section" style={{ marginTop: 0 }}>
              <div className="patient-config__field">
                <label className="patient-config__label">Confirmation</label>
                <input
                  value={deleteConfirmValue}
                  onChange={(event) => setDeleteConfirmValue(event.target.value)}
                  placeholder="Type DELETE to confirm"
                  autoFocus
                />
              </div>
            </div>
            <div className="patient-config__footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (isDeleting) return;
                  setShowDeleteDialog(false);
                  setDeleteConfirmValue('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={deleteConfirmValue !== 'DELETE' || isDeleting}
                onClick={handleDeleteConfirm}
              >
                {isDeleting ? 'Purging...' : 'Delete patient'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
