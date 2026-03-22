import React from 'react';

export default function PatientEditMenu({
  patient,
  hospitalId,
  setHospitalId,
  email,
  setEmail,
  primaryCrcId,
  setPrimaryCrcId,
  primaryCrcPhone,
  setPrimaryCrcPhone,
  studyEmergencyPhone,
  setStudyEmergencyPhone,
  crcUsers,
  vitalsConfig,
  setVitalsConfig,
  vitalOptions,
  onSave,
  onDelete,
  isSaving,
  successMsg,
}) {
  if (!patient) return null;

  const handleVitalToggle = (key) => {
    setVitalsConfig((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="card workspace-card">
      <div className="section-header">
        <div>
          <h3>Patient configuration</h3>
          <div className="section-note">Update patient identifiers, assign the responsible CRC, and choose the monitored vitals.</div>
        </div>
        <button onClick={onDelete} className="btn btn-danger btn-small">
          Delete patient
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <input value={hospitalId} onChange={(event) => setHospitalId(event.target.value)} placeholder="Hospital ID" />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Patient email" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <input
          value={primaryCrcPhone}
          onChange={(event) => setPrimaryCrcPhone(event.target.value)}
          placeholder="Primary CRC phone"
        />
        <input
          value={studyEmergencyPhone}
          onChange={(event) => setStudyEmergencyPhone(event.target.value)}
          placeholder="Study emergency phone"
        />
      </div>

      <div>
        <label style={{ display: 'block', fontWeight: '700', marginBottom: '8px' }}>Primary CRC</label>
        <select value={primaryCrcId || ''} onChange={(event) => setPrimaryCrcId(event.target.value)}>
          <option value="">Unassigned</option>
          {(crcUsers || []).map((crc) => (
            <option key={crc.id} value={crc.id}>
              {crc.nickname || crc.email || crc.id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontWeight: '700', marginBottom: '10px' }}>Monitored vitals</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
          {vitalOptions.map((option) => (
            <label
              key={option.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid #dbe5f0',
                background: '#f8fbff',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={!!vitalsConfig[option.key]}
                onChange={() => handleVitalToggle(option.key)}
                style={{ width: '16px', height: '16px' }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button onClick={onSave} className="btn btn-success" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save changes'}
        </button>
        {successMsg ? <span className="text-green">{successMsg}</span> : null}
      </div>
    </div>
  );
}
