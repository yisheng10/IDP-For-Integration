import React, { useEffect, useMemo, useState } from 'react';
import {
  deriveIncidentWorkflowStatus,
  getIncidentDueState,
  isOpenIncidentWorkflow,
} from '../services/incidentService';
import WindowPaginationControls from './WindowPaginationControls';

function dueLabel(state) {
  switch (state) {
    case 'overdue':
      return 'Overdue';
    case 'due_24h':
      return 'Due < 24h';
    case 'resolved':
      return 'Documented & Resolved';
    case 'documented':
      return 'Documented';
    case 'ae_resolved':
      return 'AE Resolved';
    case 'documented_resolved':
      return 'Documented & Resolved';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'Untracked';
  }
}

function historyStatusLabel(status) {
  return status === 'unread' ? 'Active' : 'Documented';
}

function incidentStatusLabel(incident) {
  switch (deriveIncidentWorkflowStatus(incident)) {
    case 'documented':
      return 'AE documented';
    case 'ae_resolved':
      return 'AE resolved';
    case 'documented_resolved':
      return 'Documented & resolved';
    default:
      return 'open';
  }
}

const SAFETY_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'documented', label: 'Documented' },
  { id: 'ae_resolved', label: 'AE Resolved' },
  { id: 'documented_resolved', label: 'Documented & Resolved' },
  { id: 'history', label: 'History' },
];

const SafetyInboxPanel = ({
  incidents = [],
  alertHistory = [],
  selectedPatient,
  pushState,
  onEnablePush,
  onOpenIncident,
  onOpenAlertThread,
  onDocumentIncident,
  onResolveIncident,
  initialTab = 'open',
  onTabChange,
  historyWindowLabel = '',
  incidentWindowLabel = '',
  historySummary = null,
  incidentSummary = null,
  historyPage = 1,
  historyPageSize = 30,
  onHistoryPageChange,
  onHistoryPageSizeChange,
  canGoNextHistory = false,
  incidentPage = 1,
  incidentPageSize = 30,
  onIncidentPageChange,
  onIncidentPageSizeChange,
  canGoNextIncidents = false,
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('all');
  const [protocolFilter, setProtocolFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [historySort, setHistorySort] = useState({ key: 'timestamp', direction: 'desc' });
  const [documentingIncidentId, setDocumentingIncidentId] = useState('');
  const [resolvingIncidentId, setResolvingIncidentId] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    onHistoryPageChange?.(1);
  }, [activeTab, historySearch, historyDate, historyStatusFilter, onHistoryPageChange, selectedPatient]);

  useEffect(() => {
    onIncidentPageChange?.(1);
  }, [
    activeTab,
    dueFilter,
    incidentStatusFilter,
    protocolFilter,
    selectedPatient,
    severityFilter,
    onIncidentPageChange,
  ]);

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    onTabChange?.(nextTab);
  };

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesPatient = selectedPatient
        ? (incident.linked_patient_ids || []).includes(selectedPatient.id)
        : true;
      const workflowStatus = deriveIncidentWorkflowStatus(incident);
      const matchesTab = activeTab === workflowStatus;
      const matchesSeverity = severityFilter === 'all' ? true : incident.severity === severityFilter;
      const matchesStatus =
        activeTab !== 'open'
          ? true
          :
        incidentStatusFilter === 'all'
          ? true
          : incidentStatusFilter === 'open'
            ? isOpenIncidentWorkflow(incident)
            : deriveIncidentWorkflowStatus(incident) === incidentStatusFilter;
      const protocolName = incident.protocol_snapshot?.protocol_name || '';
      const matchesProtocol = protocolFilter
        ? protocolName.toLowerCase().includes(protocolFilter.toLowerCase())
        : true;
      const state = getIncidentDueState(incident);
      const matchesDue = dueFilter === 'all' ? true : state === dueFilter;

      return matchesPatient && matchesTab && matchesSeverity && matchesStatus && matchesProtocol && matchesDue;
    });
  }, [
    activeTab,
    dueFilter,
    incidentStatusFilter,
    incidents,
    protocolFilter,
    selectedPatient,
    severityFilter,
  ]);

  const filteredHistory = useMemo(() => {
    let rows = [...alertHistory];

    if (selectedPatient) {
      rows = rows.filter((alert) => alert.uid === selectedPatient.id);
    }

    if (historySearch.trim()) {
      const queryText = historySearch.toLowerCase();
      rows = rows.filter((alert) =>
        [alert.patientName, alert.senderName, alert.reason, alert.uid]
          .some((value) => String(value || '').toLowerCase().includes(queryText))
      );
    }

    if (historyDate) {
      rows = rows.filter((alert) => new Date(alert.timestamp).toISOString().split('T')[0] === historyDate);
    }

    if (historyStatusFilter === 'active') {
      rows = rows.filter((alert) => alert.status === 'unread');
    } else if (historyStatusFilter === 'resolved') {
      rows = rows.filter((alert) => alert.status !== 'unread');
    }

    rows.sort((left, right) => {
      const leftValue =
        historySort.key === 'patientName' ? left.patientName || left.senderName || '' : left[historySort.key] || '';
      const rightValue =
        historySort.key === 'patientName' ? right.patientName || right.senderName || '' : right[historySort.key] || '';

      if (leftValue < rightValue) return historySort.direction === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return historySort.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [alertHistory, historyDate, historySearch, historySort, historyStatusFilter, selectedPatient]);

  const patientScopedIncidents = useMemo(() => {
    if (!selectedPatient) return incidents;
    return incidents.filter((incident) => (incident.linked_patient_ids || []).includes(selectedPatient.id));
  }, [incidents, selectedPatient]);

  const patientScopedHistory = useMemo(() => {
    if (!selectedPatient) return alertHistory;
    return alertHistory.filter((alert) => alert.uid === selectedPatient.id);
  }, [alertHistory, selectedPatient]);

  const openCount = Number.isFinite(Number(incidentSummary?.openIncidents))
    ? Number(incidentSummary.openIncidents)
    : patientScopedIncidents.filter((incident) => isOpenIncidentWorkflow(incident)).length;
  const documentedCount = Number.isFinite(Number(incidentSummary?.documentedIncidents))
    ? Number(incidentSummary.documentedIncidents)
    : patientScopedIncidents.filter((incident) => deriveIncidentWorkflowStatus(incident) === 'documented').length;
  const aeResolvedCount = Number.isFinite(Number(incidentSummary?.aeResolvedIncidents))
    ? Number(incidentSummary.aeResolvedIncidents)
    : patientScopedIncidents.filter((incident) => deriveIncidentWorkflowStatus(incident) === 'ae_resolved').length;
  const documentedResolvedCount = Number.isFinite(Number(incidentSummary?.documentedResolvedIncidents))
    ? Number(incidentSummary.documentedResolvedIncidents)
    : patientScopedIncidents.filter((incident) => deriveIncidentWorkflowStatus(incident) === 'documented_resolved').length;
  const activeHistoryCount = Number.isFinite(Number(historySummary?.activeAlerts))
    ? Number(historySummary.activeAlerts)
    : patientScopedHistory.filter((alert) => alert.status === 'unread').length;
  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / historyPageSize));
  const currentHistoryItems = filteredHistory.slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize
  );
  const canAdvanceHistory = filteredHistory.length > historyPage * historyPageSize || canGoNextHistory;
  const visibleIncidents = filteredIncidents.slice(
    (incidentPage - 1) * incidentPageSize,
    incidentPage * incidentPageSize
  );
  const canAdvanceIncidents = filteredIncidents.length > incidentPage * incidentPageSize || canGoNextIncidents;

  const handleHistorySort = (key) => {
    setHistorySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    onHistoryPageChange?.(1);
  };

  const historySortIndicator = (key) => {
    if (historySort.key !== key) return 'Sort';
    return historySort.direction === 'asc' ? 'Asc' : 'Desc';
  };

  const handleIncidentKeyDown = (event, incident) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    onOpenIncident?.(incident);
  };

  const handleDocumentIncidentClick = async (event, incident) => {
    event.stopPropagation();

    if (!incident?.id || documentingIncidentId) {
      return;
    }

    if (!window.confirm('Mark this AE case as documented by CRC? This does not mean the patient has clinically recovered.')) {
      return;
    }

    setDocumentingIncidentId(incident.id);
    try {
      await onDocumentIncident?.(incident);
    } finally {
      setDocumentingIncidentId('');
    }
  };

  const handleResolveIncidentClick = async (event, incident) => {
    event.stopPropagation();

    if (!incident?.id || resolvingIncidentId) {
      return;
    }

    if (!window.confirm('Mark this AE as clinically resolved? Use this only when the patient adverse event has actually resolved.')) {
      return;
    }

    setResolvingIncidentId(incident.id);
    try {
      await onResolveIncident?.(incident);
    } finally {
      setResolvingIncidentId('');
    }
  };

  return (
    <div className="card workspace-card utility-card utility-card--safety">
      <div className="inbox-tabRow" role="tablist" aria-label="Safety inbox views">
        {SAFETY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`inbox-tabButton ${activeTab === tab.id ? 'inbox-tabButton--active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
            {tab.id === 'open' ? <span className="inbox-tabBadge">{openCount}</span> : null}
            {tab.id === 'documented' ? <span className="inbox-tabBadge">{documentedCount}</span> : null}
            {tab.id === 'ae_resolved' ? <span className="inbox-tabBadge">{aeResolvedCount}</span> : null}
            {tab.id === 'documented_resolved' ? <span className="inbox-tabBadge">{documentedResolvedCount}</span> : null}
            {tab.id === 'history' ? <span className="inbox-tabBadge">{activeHistoryCount}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === 'history' ? (
        <>
          <div className="section-header section-header--tight">
            <div>
              <strong>History archive</strong>
              <div className="section-note">Read-only alert thread archive for search and audit.</div>
              {historyWindowLabel ? <div className="section-note section-note--spaced">{historyWindowLabel}</div> : null}
            </div>
          </div>

          <WindowPaginationControls
            page={historyPage}
            pageSize={historyPageSize}
            onPageChange={onHistoryPageChange}
            onPageSizeChange={(value) => {
              onHistoryPageSizeChange?.(value);
              onHistoryPageChange?.(1);
            }}
            canGoNext={canAdvanceHistory}
            note={`Page ${historyPage} • Showing up to ${historyPageSize} alert-history rows from the current loaded window.`}
          />

          <div className="history-filter-grid">
            <input
              type="search"
              placeholder="Search patient name, subject ID, or incident reason"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
            <input
              type="date"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value)}
            />
            <select
              value={historyStatusFilter}
              onChange={(event) => setHistoryStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="resolved">Resolved only</option>
            </select>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setHistorySearch('');
                setHistoryDate('');
                setHistoryStatusFilter('all');
                onHistoryPageChange?.(1);
              }}
            >
              Clear
            </button>
          </div>

          {selectedPatient ? (
            <div className="inbox-selectedPatient">
              Showing alert history linked to <strong>{selectedPatient.nickname}</strong>
            </div>
          ) : null}

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '52px' }}>
                    #
                  </th>
                  <th onClick={() => handleHistorySort('timestamp')} style={{ cursor: 'pointer' }}>
                    Date {historySortIndicator('timestamp')}
                  </th>
                  <th onClick={() => handleHistorySort('status')} style={{ cursor: 'pointer' }}>
                    Status {historySortIndicator('status')}
                  </th>
                  <th onClick={() => handleHistorySort('patientName')} style={{ cursor: 'pointer' }}>
                    Patient {historySortIndicator('patientName')}
                  </th>
                  <th onClick={() => handleHistorySort('reason')} style={{ cursor: 'pointer' }}>
                    Reason {historySortIndicator('reason')}
                  </th>
                  <th onClick={() => handleHistorySort('lastSender')} style={{ cursor: 'pointer' }}>
                    Last sender {historySortIndicator('lastSender')}
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {currentHistoryItems.length === 0 ? (
                  <tr>
                    <td colSpan="7">
                      <div className="empty-panel">No matching historical alert threads.</div>
                    </td>
                  </tr>
                ) : (
                  currentHistoryItems.map((alert, rowIndex) => {
                    const historyNumber =
                      (historyPage - 1) * historyPageSize + rowIndex + 1;
                    return (
                      <tr key={alert.id} className="hover-row">
                        <td style={{ width: '52px', color: 'var(--text-muted)', fontWeight: 700 }}>
                          {historyNumber}
                        </td>
                        <td>
                          <div>{new Date(alert.timestamp).toLocaleDateString()}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td>{historyStatusLabel(alert.status)}</td>
                        <td>
                          <div style={{ fontWeight: '700' }}>{alert.patientName || alert.senderName || 'Unknown'}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{alert.uid || 'Unknown UID'}</div>
                        </td>
                        <td>{alert.reason}</td>
                        <td>{alert.lastSender === 'crc' ? 'Staff' : 'Patient'}</td>
                        <td>
                          <button
                            className="btn btn-primary btn-small"
                            onClick={() => onOpenAlertThread?.(alert)}
                          >
                            Open thread
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="section-note">
            Loaded history pages available in the current filtered window: <strong>{totalHistoryPages}</strong>
          </div>
        </>
      ) : (
        <>
          <div className="inbox-pushBox">
            <div>
              <strong>Urgent browser alerts</strong>
              <div className="section-note">{pushState?.label || 'Browser notification status unavailable.'}</div>
            </div>
            <button className="btn btn-primary btn-small" onClick={onEnablePush} disabled={!pushState?.canEnable}>
              {pushState?.buttonLabel || 'Enable Alerts'}
            </button>
          </div>

          <div className="inbox-filterGrid">
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}>
              <option value="all">All due states</option>
              <option value="overdue">Overdue</option>
              <option value="due_24h">Due within 24h</option>
              <option value="scheduled">Scheduled</option>
              <option value="documented">Documented</option>
              <option value="ae_resolved">AE Resolved</option>
              <option value="documented_resolved">Documented & Resolved</option>
            </select>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              <option value="all">All severities</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="serious">Serious</option>
            </select>
            <input
              placeholder="Filter by protocol"
              value={protocolFilter}
              onChange={(event) => setProtocolFilter(event.target.value)}
            />
            {activeTab === 'open' ? (
              <select value={incidentStatusFilter} onChange={(event) => setIncidentStatusFilter(event.target.value)}>
                <option value="all">All active statuses</option>
                <option value="open">Open</option>
              </select>
            ) : (
              <div className="inbox-filterHint">AE documentation and clinical resolution are tracked separately.</div>
            )}
          </div>

          {selectedPatient ? (
            <div className="inbox-selectedPatient">
              Showing {activeTab} safety cases linked to <strong>{selectedPatient.nickname}</strong>
            </div>
          ) : null}

          <div className="utility-list utility-list--scroll">
            {incidentWindowLabel ? (
              <div className="section-note section-note--spaced">{incidentWindowLabel}</div>
            ) : null}
            <WindowPaginationControls
              page={incidentPage}
              pageSize={incidentPageSize}
              onPageChange={onIncidentPageChange}
              onPageSizeChange={(value) => {
                onIncidentPageSizeChange?.(value);
                onIncidentPageChange?.(1);
              }}
              canGoNext={canAdvanceIncidents}
              note={`Page ${incidentPage} • Showing up to ${incidentPageSize} safety cases from the current loaded window.`}
            />
            {visibleIncidents.length === 0 ? (
              <div className="empty-panel">
                No {SAFETY_TABS.find((tab) => tab.id === activeTab)?.label.toLowerCase() || 'safety'} cases match the current filters.
              </div>
            ) : (
              visibleIncidents.map((incident, rowIndex) => {
                const state = getIncidentDueState(incident);
                const incidentNumber =
                  (incidentPage - 1) * incidentPageSize + rowIndex + 1;
                return (
                  <div
                    key={incident.id}
                    className="incident-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenIncident?.(incident)}
                    onKeyDown={(event) => handleIncidentKeyDown(event, incident)}
                  >
                    <div className="incident-row__index" aria-hidden="true">
                      {incidentNumber}
                    </div>
                    <div className="incident-row__copy">
                      <div className="incident-row__top">
                        <strong>{incident.event_title}</strong>
                        <span className="incident-row__status">{incidentStatusLabel(incident)}</span>
                        {incident.compare_ready ? (
                          <span className="incident-row__group">compare {incident.patient_count}</span>
                        ) : null}
                      </div>
                      <div className="incident-row__meta">
                        Severity: {incident.severity} | Due: {dueLabel(state)} | Protocol:{' '}
                        {incident.protocol_snapshot?.protocol_name || 'None'}
                      </div>
                      <div className="incident-row__meta">
                        Patients: {(incident.linked_patients || []).map((entry) => entry.patient_name).join(', ') || 'Unassigned'}
                      </div>
                    </div>
                    <div className="incident-row__time">
                      <span>{new Date(incident.updated_at || incident.created_at).toLocaleString()}</span>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {deriveIncidentWorkflowStatus(incident) !== 'documented_resolved' && deriveIncidentWorkflowStatus(incident) !== 'documented' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-small incident-row__resolveButton"
                          onClick={(event) => handleDocumentIncidentClick(event, incident)}
                          disabled={documentingIncidentId === incident.id}
                        >
                          {documentingIncidentId === incident.id ? 'Documenting...' : 'AE Documented'}
                        </button>
                      ) : null}
                      {deriveIncidentWorkflowStatus(incident) !== 'documented_resolved' && deriveIncidentWorkflowStatus(incident) !== 'ae_resolved' ? (
                        <button
                          type="button"
                          className="btn btn-success btn-small incident-row__resolveButton"
                          onClick={(event) => handleResolveIncidentClick(event, incident)}
                          disabled={resolvingIncidentId === incident.id}
                        >
                          {resolvingIncidentId === incident.id ? 'Resolving...' : 'AE Resolved'}
                        </button>
                      ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SafetyInboxPanel;
