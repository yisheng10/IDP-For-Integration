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
    <div className="card" style={{ borderTop: '4px solid #0f609b' }}>
      <div style={styles.headerRow}>
        <div>
          <h3 className="mt-0" style={{ marginBottom: '6px' }}>
            Safety Inbox
          </h3>
          <div style={styles.headerHint}>
            Structured side effect incidents and emergency documentation stay here instead of raw alert history.
          </div>
        </div>
        <div style={styles.counterGroup}>
          <div style={styles.counterBox}>
            <strong>{openCount}</strong>
            <span>Open</span>
          </div>
          <div style={styles.counterBox}>
            <strong>{groupedCount}</strong>
            <span>Grouped</span>
          </div>
        </div>
      </div>

      <div style={styles.pushBox}>
        <div>
          <strong>Browser alerts</strong>
          <div style={styles.headerHint}>{pushState?.label || 'Browser notification status unavailable.'}</div>
        </div>
        <button className="btn btn-primary btn-small" onClick={onEnablePush} disabled={!pushState?.canEnable}>
          {pushState?.buttonLabel || 'Enable Alerts'}
        </button>
      </div>

      <div style={styles.filterRow}>
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

      {selectedPatient && (
        <div style={styles.selectedPatientBanner}>
          Showing incidents linked to <strong>{selectedPatient.nickname}</strong>
        </div>
      )}

      <div style={{ maxHeight: '460px', overflowY: 'auto' }}>
        {filteredIncidents.length === 0 ? (
          <div style={styles.emptyState}>No incidents match the current filters.</div>
        ) : (
          filteredIncidents.map((incident) => {
            const state = getIncidentDueState(incident);
            return (
              <button
                key={incident.id}
                style={styles.rowButton}
                onClick={() => onOpenIncident?.(incident)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.rowTop}>
                    <strong>{incident.event_title}</strong>
                    <span style={styles.statusBadge}>{incident.status}</span>
                    {incident.compare_ready && <span style={styles.groupBadge}>compare {incident.patient_count}</span>}
                  </div>
                  <div style={styles.rowMeta}>
                    Severity: {incident.severity} | Due: {dueLabel(state)} | Protocol:{' '}
                    {incident.protocol_snapshot?.protocol_name || 'None'}
                  </div>
                  <div style={styles.rowMeta}>
                    Patients: {(incident.linked_patients || []).map((entry) => entry.patient_name).join(', ') || 'Unassigned'}
                  </div>
                </div>
                <div style={styles.rowTime}>
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

const styles = {
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  headerHint: {
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  counterGroup: {
    display: 'flex',
    gap: '8px',
  },
  counterBox: {
    minWidth: '72px',
    padding: '10px',
    borderRadius: '10px',
    background: '#f8fafc',
    border: '1px solid #dbe5f0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
  },
  pushBox: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '10px',
    background: '#f4f8ff',
    border: '1px solid #d6e4ff',
    marginBottom: '12px',
  },
  filterRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '8px',
    marginBottom: '12px',
  },
  selectedPatientBanner: {
    marginBottom: '10px',
    padding: '10px 12px',
    borderRadius: '8px',
    background: '#eff6ff',
    color: '#1d4ed8',
    fontSize: '13px',
  },
  emptyState: {
    color: '#64748b',
    fontStyle: 'italic',
    padding: '20px 0',
  },
  rowButton: {
    width: '100%',
    border: '1px solid #e5edf6',
    background: 'white',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  rowTop: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '6px',
  },
  statusBadge: {
    textTransform: 'capitalize',
    padding: '3px 8px',
    borderRadius: '999px',
    background: '#edf2ff',
    color: '#1d4ed8',
    fontSize: '11px',
    fontWeight: 'bold',
  },
  groupBadge: {
    padding: '3px 8px',
    borderRadius: '999px',
    background: '#fef3c7',
    color: '#92400e',
    fontSize: '11px',
    fontWeight: 'bold',
  },
  rowMeta: {
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  rowTime: {
    color: '#475569',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    alignSelf: 'flex-start',
  },
};

export default SafetyInboxPanel;
