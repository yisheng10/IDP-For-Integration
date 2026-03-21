import React, { useMemo, useState } from 'react';

export default function PatientList({ patients, selectedPatientId, onSelect }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPatients = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    if (!queryText) return patients;

    return patients.filter((patient) => {
      const name = (patient.nickname || '').toLowerCase();
      const hospitalId = (patient.hospitalPatientId || '').toLowerCase();
      const subjectId = (patient.subject_id || patient.subjectId || '').toLowerCase();
      return name.includes(queryText) || hospitalId.includes(queryText) || subjectId.includes(queryText);
    });
  }, [patients, searchQuery]);

  return (
    <div className="card workspace-card">
      <div className="section-header">
        <div>
          <h3>Patient roster</h3>
          <div className="section-note">Search by patient name, hospital ID, or subject ID.</div>
        </div>
        <div className="metric-pill">{filteredPatients.length} visible</div>
      </div>

      <input
        type="text"
        placeholder="Search name, hospital ID, or subject ID"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />

      <div style={{ maxHeight: '640px', overflowY: 'auto', display: 'grid', gap: '8px' }}>
        {filteredPatients.length === 0 ? (
          <div className="empty-panel">No patients match the current search.</div>
        ) : (
          filteredPatients.map((patient) => {
            const isSelected = selectedPatientId === patient.id;
            return (
              <button
                key={patient.id}
                type="button"
                onClick={() => onSelect(isSelected ? null : patient)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: isSelected ? '1px solid #0f609b' : '1px solid #dbe5f0',
                  background: isSelected ? '#eef7ff' : 'rgba(255, 255, 255, 0.9)',
                  borderRadius: '14px',
                  padding: '14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: '700', color: '#14324a' }}>{patient.nickname || 'Unnamed patient'}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{patient.email || 'No email recorded'}</div>
                  </div>
                  {isSelected ? <span className="metric-pill" style={{ background: '#d8ebfb', borderColor: '#a9d0f0' }}>Selected</span> : null}
                </div>

                <div style={{ display: 'grid', gap: '4px', marginTop: '10px', color: '#52606d', fontSize: '13px' }}>
                  <div>Hospital ID: {patient.hospitalPatientId || 'Not set'}</div>
                  <div>Subject ID: {patient.subject_id || patient.subjectId || patient.id}</div>
                  <div>Primary CRC: {patient.primary_crc_name || 'Unassigned'}</div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
