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
  const [protocolFilter, setProtocolFilter] = useState('all');
  const [mappingFilter, setMappingFilter] = useState('all');
  const effectiveQuery = typeof searchQuery === 'string' ? searchQuery : localSearchQuery;

  const filteredPatients = useMemo(() => {
    const queryText = effectiveQuery.trim().toLowerCase();

    return patients.filter((patient) => {
      const name = (patient.nickname || '').toLowerCase();
      const subjectId = String(patient.subject_id || patient.subjectId || '').toLowerCase();
      const primaryCrc = String(patient.primary_crc_name || '').toLowerCase();
      const hasProtocol = Boolean(String(patient.protocolName || patient.protocolId || '').trim());
      const hasSubjectMap = Boolean(String(patient.subject_id || patient.subjectId || '').trim());

      const matchesQuery =
        !queryText || name.includes(queryText) || subjectId.includes(queryText) || primaryCrc.includes(queryText);
      const matchesProtocol =
        protocolFilter === 'all' ||
        (protocolFilter === 'assigned' && hasProtocol) ||
        (protocolFilter === 'unassigned' && !hasProtocol);
      const matchesMapping =
        mappingFilter === 'all' ||
        (mappingFilter === 'mapped' && hasSubjectMap) ||
        (mappingFilter === 'unmapped' && !hasSubjectMap);

      return matchesQuery && matchesProtocol && matchesMapping;
    });
  }, [effectiveQuery, mappingFilter, patients, protocolFilter]);

  const handleSearchChange = (value) => {
    if (typeof onSearchQueryChange === 'function') {
      onSearchQueryChange(value);
      return;
    }
    setLocalSearchQuery(value);
  };

  useEffect(() => {
    onPageChange?.(1);
  }, [effectiveQuery, mappingFilter, onPageChange, protocolFilter]);

  const totalLoadedPages = Math.max(1, Math.ceil(filteredPatients.length / pageSize));
  const effectivePage = Math.min(currentPage, totalLoadedPages);
  const visiblePatients = filteredPatients.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const canGoNext = filteredPatients.length > effectivePage * pageSize || (!effectiveQuery.trim() && canGoNextPage);

  return (
    <div className="card workspace-card patient-roster">
      <div className="section-header">
        <div>
          <h3>Patients</h3>
          <div className="section-note">
            Search or filter the currently loaded roster by patient name, subject ID, assigned CRC, protocol assignment, and mapping status.
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
        <div className="section-note">Use the header quick search to filter the currently loaded roster.</div>
      )}

      <div className="patient-roster__filters">
        <select value={protocolFilter} onChange={(event) => setProtocolFilter(event.target.value)}>
          <option value="all">All protocols</option>
          <option value="assigned">Protocol assigned</option>
          <option value="unassigned">Protocol unassigned</option>
        </select>
        <select value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value)}>
          <option value="all">All subject mapping</option>
          <option value="mapped">Subject mapped</option>
          <option value="unmapped">Subject unmapped</option>
        </select>
      </div>

      <div className="patient-roster__tableHeader">
        <span>Patient</span>
        <span>Subject ID</span>
        <span>Protocol</span>
        <span>Primary CRC</span>
        <span>Mapping</span>
      </div>

      <div className="patient-roster__list patient-roster__list--dense">
        {visiblePatients.length === 0 ? (
          <div className="empty-panel">No patients match the current filters.</div>
        ) : (
          visiblePatients.map((patient) => {
            const isSelected = selectedPatientId === patient.id;
            const subjectId = patient.subject_id || patient.subjectId || 'Not set';
            const protocolName = patient.protocolName || 'Not assigned';
            const primaryCrc = patient.primary_crc_name || 'Unassigned';
            const isMapped = subjectId !== 'Not set';

            return (
              <button
                key={patient.id}
                type="button"
                onClick={() => onSelect(isSelected ? null : patient)}
                className={`patient-roster__item patient-roster__item--grid ${isSelected ? 'patient-roster__item--selected' : ''}`}
              >
                <div className="patient-roster__cell patient-roster__cell--identity">
                  <div className="patient-roster__name">{patient.nickname || 'Unnamed patient'}</div>
                  <div className="patient-roster__email">{patient.email || 'No email recorded'}</div>
                </div>
                <div className="patient-roster__cell patient-roster__cell--mono">{subjectId}</div>
                <div className="patient-roster__cell">{protocolName}</div>
                <div className="patient-roster__cell">{primaryCrc}</div>
                <div className="patient-roster__cell patient-roster__cell--status">
                  <span className={`metric-pill ${isMapped ? 'metric-pill--selected' : ''}`}>
                    {isMapped ? 'Mapped' : 'Unmapped'}
                  </span>
                  {isSelected ? <span className="metric-pill metric-pill--selected">Selected</span> : null}
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
        note={`Page ${effectivePage} - Showing up to ${pageSize} patients per page from the current loaded roster window.`}
      />

      {footerContent ? <div className="section-note section-note--spaced">{footerContent}</div> : null}
    </div>
  );
}
