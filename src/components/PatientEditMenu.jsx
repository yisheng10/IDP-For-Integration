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
  onDelete,
  isSaving,
  successMsg,
  primaryCrcPhoneError = '',
  studyEmergencyPhoneError = '',
  disableSave = false,
}) {
  if (!patient) return null;

  return (
    <div className="card workspace-card">
      <div className="section-header">
        <div>
          <h3>Patient configuration</h3>
          <div className="section-note">
            Trial assignment controls inherited monitored vitals. Patient-level configuration stays limited to identifiers,
            CRC ownership, emergency contact details, and the canonical subject ID used by the CRC-only dropout runtime.
          </div>
        </div>
        <button onClick={onDelete} className="btn btn-danger btn-small">
          Delete patient
        </button>
      </div>

      <div className="patient-config__grid">
        <div className="patient-config__field">
          <label className="patient-config__label">Patient email</label>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Patient email" />
        </div>
      </div>

      <div className="patient-config__grid">
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
      </div>

      <div className="info-banner">
        <strong>Study emergency phone</strong>
        <div className="section-note section-note--spaced">
          This is the manual trial or site emergency contact shown to the patient for urgent phone escalation. It is not
          generated automatically by the system.
        </div>
      </div>

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
        <div className="section-note section-note--spaced">
          Choose the canonical subject ID that this real CRC patient should map to during TrialLight v1 dropout prediction runs and demos.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={onSave} className="btn btn-success" disabled={isSaving || disableSave}>
          {isSaving ? 'Saving...' : 'Save changes'}
        </button>
        {successMsg ? <span className="text-green">{successMsg}</span> : null}
      </div>
    </div>
  );
}
