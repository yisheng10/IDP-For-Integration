import React, { useMemo, useState } from 'react';

export default function PatientList({
  patients,
  selectedPatientId,
  onSelect,
  searchQuery,
  onSearchQueryChange,
  showSearchInput = true,
}) {
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const effectiveQuery = typeof searchQuery === 'string' ? searchQuery : localSearchQuery;

  const filteredPatients = useMemo(() => {
    const queryText = effectiveQuery.trim().toLowerCase();
    if (!queryText) return patients;

    return patients.filter((patient) => {
      const name = (patient.nickname || '').toLowerCase();
      const hospitalId = (patient.hospitalPatientId || '').toLowerCase();
      const subjectId = (patient.subject_id || patient.subjectId || '').toLowerCase();
      const primaryCrc = (patient.primary_crc_name || '').toLowerCase();
      return (
        name.includes(queryText) ||
        hospitalId.includes(queryText) ||
        subjectId.includes(queryText) ||
        primaryCrc.includes(queryText)
      );
    });
  }, [effectiveQuery, patients]);

  const handleSearchChange = (value) => {
    if (typeof onSearchQueryChange === 'function') {
      onSearchQueryChange(value);
      return;
    }
    setLocalSearchQuery(value);
  };

  return (
    <div className="card workspace-card patient-roster">
      <div className="section-header">
        <div>
          <h3>Patient roster</h3>
          <div className="section-note">
            Search by patient name, hospital ID, subject ID, or assigned CRC.
          </div>
        </div>
        <div className="metric-pill">{filteredPatients.length} visible</div>
      </div>

      {showSearchInput ? (
        <input
          type="text"
          placeholder="Search name, hospital ID, or subject ID"
          value={effectiveQuery}
          onChange={(event) => handleSearchChange(event.target.value)}
        />
      ) : (
        <div className="section-note">Use the header search bar to filter the roster.</div>
      )}

      <div className="patient-roster__list">
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
                className={`patient-roster__item ${isSelected ? 'patient-roster__item--selected' : ''}`}
              >
                <div className="patient-roster__itemTop">
                  <div>
                    <div className="patient-roster__name">{patient.nickname || 'Unnamed patient'}</div>
                    <div className="patient-roster__email">{patient.email || 'No email recorded'}</div>
                  </div>
                  {isSelected ? <span className="metric-pill metric-pill--selected">Selected</span> : null}
                </div>

                <div className="patient-roster__meta">
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
