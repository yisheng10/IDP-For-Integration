import React from 'react';

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
  inheritedVitals = [],
  subjectId,
  setSubjectId,
  crcUsers,
  dropoutOptions = [],
  onSave,
  isSaving,
  successMsg,
  primaryCrcPhoneError = '',
  studyEmergencyPhoneError = '',
  disableSave = false,
}) {
  if (!patient) return null;

  return (
    <div className="patient-workspace__card patient-config">
      <div className="section-header">
        <div>
          <h3>Patient configuration</h3>
          <div className="section-note">
            This subject mapping links the real patient record to the canonical subject ID used only by the CRC-only disengagement prediction workspace.
          </div>
        </div>
      </div>

      <div className="patient-config__section">
        <div className="patient-config__sectionHeader">
          <strong>Identity</strong>
          <span>Email and subject mapping</span>
        </div>
        <div className="patient-config__grid">
          <div className="patient-config__field">
            <label className="patient-config__label">Patient email</label>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Patient email" />
          </div>
          <div className="patient-config__field">
            <label className="patient-config__label">Subject ID</label>
            <select value={subjectId || ''} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">No mapped subject ID</option>
              {(dropoutOptions || []).map((option) => (
                <option key={option.subject_id} value={option.subject_id}>
                  {option.subject_id}
                  {option.trial_id ? ` (${option.trial_id})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="section-note">
          Pick the canonical subject ID that this patient should map to for CRC-only disengagement prediction. It does not affect patient login or general CRC profile management.
        </div>
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
                  {crc.nickname || crc.email || crc.id}
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
          <span>Protocol-linked monitoring inherited from the selected trial</span>
        </div>
        <div className="patient-config__field">
          <div className="section-header section-header--tight">
            <label className="patient-config__label" style={{ marginBottom: 0 }}>
              Assigned clinical trial
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
          <div className="section-note section-note--spaced">
            Trial templates own monitored vitals, threshold rules, and mild/moderate/serious follow-up timing.
          </div>
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
  );
}
