import React, { useEffect, useMemo, useState } from 'react';
import { getIncidentDueState } from '../services/incidentService';

function dueLabel(state) {
  switch (state) {
    case 'overdue':
      return 'Overdue';
    case 'due_24h':
      return 'Due < 24h';
    case 'resolved':
      return 'Resolved';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'Untracked';
  }
}

function historyStatusLabel(status) {
  return status === 'unread' ? 'Active' : 'Resolved';
}

const SAFETY_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
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
  initialTab = 'open',
  onTabChange,
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
  const [historyPage, setHistoryPage] = useState(1);
  const [historyItemsPerPage, setHistoryItemsPerPage] = useState(10);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setHistoryPage(1);
  }, [activeTab, historySearch, historyDate, historyItemsPerPage, historyStatusFilter]);

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    onTabChange?.(nextTab);
  };

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesPatient = selectedPatient
        ? (incident.linked_patient_ids || []).includes(selectedPatient.id)
        : true;
      const matchesTab = activeTab === 'resolved' ? incident.status === 'resolved' : incident.status !== 'resolved';
      const matchesSeverity = severityFilter === 'all' ? true : incident.severity === severityFilter;
      const matchesStatus =
        incidentStatusFilter === 'all' ? true : incident.status === incidentStatusFilter;
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

  const openCount = incidents.filter((incident) => incident.status !== 'resolved').length;
  const resolvedCount = incidents.filter((incident) => incident.status === 'resolved').length;
  const groupedCount = incidents.filter((incident) => incident.compare_ready).length;
  const activeHistoryCount = alertHistory.filter((alert) => alert.status === 'unread').length;
  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistory.length / historyItemsPerPage));
  const currentHistoryItems = filteredHistory.slice(
    (historyPage - 1) * historyItemsPerPage,
    historyPage * historyItemsPerPage
  );

  const handleHistorySort = (key) => {
    setHistorySort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
    setHistoryPage(1);
  };

  const historySortIndicator = (key) => {
    if (historySort.key !== key) return 'Sort';
    return historySort.direction === 'asc' ? 'Asc' : 'Desc';
  };

  return (
    <div className="card workspace-card utility-card utility-card--safety">
      <div className="section-header">
        <div>
          <h3 className="mt-0" style={{ marginBottom: '6px' }}>Safety Inbox</h3>
          <div className="section-note">
            Use one primary workspace for active safety cases, resolved follow-up, and historical alert threads.
          </div>
        </div>
        <div className="inbox-counterGroup">
          <div className="inbox-counterBox">
            <strong>{openCount}</strong>
            <span>Open</span>
          </div>
          <div className="inbox-counterBox">
            <strong>{resolvedCount}</strong>
            <span>Resolved</span>
          </div>
          <div className="inbox-counterBox">
            <strong>{groupedCount}</strong>
            <span>Grouped</span>
          </div>
        </div>
      </div>

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
            {tab.id === 'resolved' ? <span className="inbox-tabBadge">{resolvedCount}</span> : null}
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
            </div>
          </div>

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
                setHistoryPage(1);
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
                    <td colSpan="6">
                      <div className="empty-panel">No matching historical alert threads.</div>
                    </td>
                  </tr>
                ) : (
                  currentHistoryItems.map((alert) => (
                    <tr key={alert.id} className="hover-row">
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
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="section-header history-pagination">
            <div className="section-note">
              Page <strong>{historyPage}</strong> of <strong>{totalHistoryPages}</strong>
            </div>
            <div className="history-pagination__controls">
              <select
                value={historyItemsPerPage}
                onChange={(event) => {
                  setHistoryItemsPerPage(Number(event.target.value));
                  setHistoryPage(1);
                }}
                style={{ width: '100px' }}
              >
                <option value={10}>10</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <button
                className="btn btn-secondary btn-small"
                disabled={historyPage === 1}
                onClick={() => setHistoryPage((page) => Math.max(page - 1, 1))}
              >
                Prev
              </button>
              <button
                className="btn btn-secondary btn-small"
                disabled={historyPage === totalHistoryPages}
                onClick={() => setHistoryPage((page) => Math.min(page + 1, totalHistoryPages))}
              >
                Next
              </button>
            </div>
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
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              <option value="all">All severities</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="serious">Serious</option>
            </select>
            {activeTab === 'open' ? (
              <select value={incidentStatusFilter} onChange={(event) => setIncidentStatusFilter(event.target.value)}>
                <option value="all">All active statuses</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            ) : (
              <div className="inbox-filterHint">Resolved cases stay in the archive until reopened manually.</div>
            )}
            <select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}>
              <option value="all">All due states</option>
              <option value="overdue">Overdue</option>
              <option value="due_24h">Due within 24h</option>
              <option value="scheduled">Scheduled</option>
              <option value="resolved">Resolved</option>
            </select>
            <input
              placeholder="Filter by protocol"
              value={protocolFilter}
              onChange={(event) => setProtocolFilter(event.target.value)}
            />
          </div>

          {selectedPatient ? (
            <div className="inbox-selectedPatient">
              Showing {activeTab} safety cases linked to <strong>{selectedPatient.nickname}</strong>
            </div>
          ) : null}

          <div className="utility-list utility-list--scroll">
            {filteredIncidents.length === 0 ? (
              <div className="empty-panel">
                {activeTab === 'resolved'
                  ? 'No resolved incidents match the current filters.'
                  : 'No active incidents match the current filters.'}
              </div>
            ) : (
              filteredIncidents.map((incident) => {
                const state = getIncidentDueState(incident);
                return (
                  <button
                    key={incident.id}
                    className="incident-row"
                    onClick={() => onOpenIncident?.(incident)}
                  >
                    <div className="incident-row__copy">
                      <div className="incident-row__top">
                        <strong>{incident.event_title}</strong>
                        <span className="incident-row__status">{incident.status}</span>
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
                      {new Date(incident.updated_at || incident.created_at).toLocaleString()}
                    </div>
                  </button>
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
