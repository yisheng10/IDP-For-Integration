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
      <div className="section-header patient-roster__summaryHeader">
        {summaryNote ? <div className="section-note">{summaryNote}</div> : <span />}
        <div className="metric-pill">{countLabel || `${filteredPatients.length} visible`}</div>
      </div>

      {showSearchInput ? (
        <input
          type="text"
          placeholder="Search by subject ID, patient name, protocol, or CRC"
          value={effectiveQuery}
          onChange={(event) => handleSearchChange(event.target.value)}
        />
      ) : null}

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
        <span>#</span>
        <span>Subject ID</span>
        <span>Name</span>
        <span>Protocol</span>
        <span>Primary CRC</span>
        <span>Status</span>
        <span>Next task</span>
      </div>

      <div className="patient-roster__list patient-roster__list--dense">
        {visiblePatients.length === 0 ? (
          <div className="empty-panel">No patients match the current filters.</div>
        ) : (
          visiblePatients.map((patient, rowIndex) => {
            const subjectId = patient.subject_id || patient.subjectId || 'Not set';
            const protocolName = patient.protocolName || 'Not assigned';
            const primaryCrc = patient.primary_crc_name || 'Unassigned';
            const isMapped = subjectId !== 'Not set';
            const workflowStatus = patient.workflowStatus || 'Stable';
            const workflowTone = patient.workflowTone || 'default';
            const nextTask = patient.nextTask || 'No immediate action';
            const rosterNumber = (effectivePage - 1) * pageSize + rowIndex + 1;

            return (
              <button
                key={patient.id}
                type="button"
                onClick={() => onSelect(patient)}
                className={`patient-roster__item patient-roster__item--grid ${selectedPatientId === patient.id ? 'patient-roster__item--selected' : ''}`}
              >
                <div className="patient-roster__cell patient-roster__cell--index">
                  {rosterNumber}
                </div>
                <div className="patient-roster__cell patient-roster__cell--subject">
                  <div className="patient-roster__subjectValue">{subjectId}</div>
                  <span className={`metric-pill ${isMapped ? 'metric-pill--selected' : 'metric-pill--warning'}`}>
                    {isMapped ? 'Mapped' : 'Unmapped'}
                  </span>
                </div>
                <div className="patient-roster__cell patient-roster__cell--identity">
                  <div className="patient-roster__name">{patient.nickname || 'Unnamed patient'}</div>
                  <div className="patient-roster__email">{patient.email || 'No email recorded'}</div>
                </div>
                <div className="patient-roster__cell">{protocolName}</div>
                <div className="patient-roster__cell">{primaryCrc}</div>
                <div className="patient-roster__cell patient-roster__cell--status">
                  <span className={`metric-pill metric-pill--${workflowTone}`}>{workflowStatus}</span>
                </div>
                <div className="patient-roster__cell patient-roster__cell--task">
                  <span>{nextTask}</span>
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
