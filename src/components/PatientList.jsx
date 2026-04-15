import React, { useEffect, useMemo, useState } from 'react';
import WindowPaginationControls from './WindowPaginationControls';

export default function PatientList({
  patients,
  selectedPatientId,
  onSelect,
  searchQuery,
  onSearchQueryChange,
  showSearchInput = true,
  countLabel,
  summaryNote,
  footerContent = null,
  currentPage = 1,
  pageSize = 30,
  onPageChange,
  onPageSizeChange,
  canGoNextPage = false,
}) {
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const effectiveQuery = typeof searchQuery === 'string' ? searchQuery : localSearchQuery;

  const filteredPatients = useMemo(() => {
    const queryText = effectiveQuery.trim().toLowerCase();
    if (!queryText) return patients;

    return patients.filter((patient) => {
      const name = (patient.nickname || '').toLowerCase();
      const subjectId = (patient.subject_id || patient.subjectId || '').toLowerCase();
      const primaryCrc = (patient.primary_crc_name || '').toLowerCase();
      return name.includes(queryText) || subjectId.includes(queryText) || primaryCrc.includes(queryText);
    });
  }, [effectiveQuery, patients]);

  const handleSearchChange = (value) => {
    if (typeof onSearchQueryChange === 'function') {
      onSearchQueryChange(value);
      return;
    }
    setLocalSearchQuery(value);
  };

  useEffect(() => {
    onPageChange?.(1);
  }, [effectiveQuery, onPageChange]);

  const totalLoadedPages = Math.max(1, Math.ceil(filteredPatients.length / pageSize));
  const effectivePage = Math.min(currentPage, totalLoadedPages);
  const visiblePatients = filteredPatients.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const canGoNext = filteredPatients.length > effectivePage * pageSize || (!effectiveQuery.trim() && canGoNextPage);

  return (
    <div className="card workspace-card patient-roster">
      <div className="section-header">
        <div>
          <h3>Patient roster</h3>
          <div className="section-note">
            Search by patient name, subject ID, or assigned CRC.
          </div>
          {summaryNote ? <div className="section-note section-note--spaced">{summaryNote}</div> : null}
        </div>
        <div className="metric-pill">{countLabel || `${filteredPatients.length} visible`}</div>
      </div>

      {showSearchInput ? (
        <input
          type="text"
          placeholder="Search name, subject ID, or assigned CRC"
          value={effectiveQuery}
          onChange={(event) => handleSearchChange(event.target.value)}
        />
      ) : (
        <div className="section-note">Use the header search bar to filter the roster.</div>
      )}

      <div className="patient-roster__list">
        {visiblePatients.length === 0 ? (
          <div className="empty-panel">No patients match the current search.</div>
        ) : (
          visiblePatients.map((patient) => {
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
                  <div>Subject ID: {patient.subject_id || patient.subjectId || 'Not set'}</div>
                  <div>Primary CRC: {patient.primary_crc_name || 'Unassigned'}</div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <WindowPaginationControls
        page={effectivePage}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        canGoNext={canGoNext}
        note={`Page ${effectivePage} • Showing up to ${pageSize} patients per page from the current loaded roster window.`}
      />

      {footerContent ? <div className="section-note section-note--spaced">{footerContent}</div> : null}
    </div>
  );
}
