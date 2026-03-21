import React, { useMemo, useState } from 'react';
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

const SafetyInboxPanel = ({
  incidents = [],
  selectedPatient,
  pushState,
  onEnablePush,
  onOpenIncident,
}) => {
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [protocolFilter, setProtocolFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('all');

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const matchesPatient = selectedPatient
        ? (incident.linked_patient_ids || []).includes(selectedPatient.id)
        : true;
      const matchesSeverity = severityFilter === 'all' ? true : incident.severity === severityFilter;
      const matchesStatus = statusFilter === 'all' ? true : incident.status === statusFilter;
      const protocolName = incident.protocol_snapshot?.protocol_name || '';
      const matchesProtocol = protocolFilter
        ? protocolName.toLowerCase().includes(protocolFilter.toLowerCase())
        : true;
      const state = getIncidentDueState(incident);
      const matchesDue = dueFilter === 'all' ? true : state === dueFilter;

      return matchesPatient && matchesSeverity && matchesStatus && matchesProtocol && matchesDue;
    });
  }, [dueFilter, incidents, protocolFilter, selectedPatient, severityFilter, statusFilter]);

  const openCount = incidents.filter((incident) => incident.status !== 'resolved').length;
  const groupedCount = incidents.filter((incident) => incident.compare_ready).length;

  return (
    <div className="card workspace-card utility-card utility-card--safety">
      <div className="section-header">
        <div>
          <h3 className="mt-0" style={{ marginBottom: '6px' }}>Safety Inbox</h3>
          <div className="section-note">
            Structured side effect incidents and emergency documentation stay here instead of raw alert history.
          </div>
        </div>
        <div className="inbox-counterGroup">
          <div className="inbox-counterBox">
            <strong>{openCount}</strong>
            <span>Open</span>
          </div>
          <div className="inbox-counterBox">
            <strong>{groupedCount}</strong>
            <span>Grouped</span>
          </div>
        </div>
      </div>

      <div className="inbox-pushBox">
        <div>
          <strong>Browser alerts</strong>
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
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
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
          Showing incidents linked to <strong>{selectedPatient.nickname}</strong>
        </div>
      ) : null}

      <div className="utility-list utility-list--scroll">
        {filteredIncidents.length === 0 ? (
          <div className="empty-panel">No incidents match the current filters.</div>
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
    </div>
  );
};

export default SafetyInboxPanel;
