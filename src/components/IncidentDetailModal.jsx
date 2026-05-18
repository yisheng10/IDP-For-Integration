import React, { useEffect, useMemo, useState } from 'react';
import {
  getIncidentDueState,
  hydrateIncidentPatientContext,
  resolveIncident,
  updateIncidentNote,
} from '../services/incidentService';

function renderDueStateLabel(state) {
  switch (state) {
    case 'overdue':
      return 'Overdue';
    case 'due_24h':
      return 'Due within 24h';
    case 'resolved':
      return 'Documented';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'Untracked';
  }
}

function renderVitalRow(record) {
  if (!record) return 'No vitals recorded.';

  const bits = [];
  if (record.temperature) bits.push(`Temp ${record.temperature} C`);
  if (record.bpSys) bits.push(`BP ${record.bpSys}/${record.bpDia || '-'}`);
  if (record.spo2) bits.push(`SpO2 ${record.spo2}%`);
  if (record.heartRate) bits.push(`HR ${record.heartRate}`);
  return bits.join(' | ') || 'No structured vitals in the latest record.';
}

const IncidentDetailModal = ({ incident, user, crcName, onClose, onOpenChat }) => {
  const [patientContexts, setPatientContexts] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [noteDraft, setNoteDraft] = useState(incident?.crc_note || '');
  const [savingNote, setSavingNote] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  useEffect(() => {
    setNoteDraft(incident?.crc_note || '');
  }, [incident]);

  useEffect(() => {
    let cancelled = false;

    const loadPatients = async () => {
      if (!incident) return;
      setLoadingPatients(true);
      try {
        const hydrated = await hydrateIncidentPatientContext(incident);
        if (!cancelled) {
          setPatientContexts(hydrated);
        }
      } catch (error) {
        console.error('Failed to load incident patient context:', error);
      } finally {
        if (!cancelled) {
          setLoadingPatients(false);
        }
      }
    };

    loadPatients();

    return () => {
      cancelled = true;
    };
  }, [incident]);

  const dueState = useMemo(() => getIncidentDueState(incident), [incident]);

  if (!incident) return null;

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      await updateIncidentNote(incident.id, noteDraft);
    } catch (error) {
      alert('Failed to save CRC note: ' + error.message);
    } finally {
      setSavingNote(false);
    }
  };

  const handleResolve = async () => {
    if (!window.confirm('Document this incident as resolved?')) return;
    setChangingStatus(true);
    try {
      await resolveIncident(incident.id, {
        uid: user.uid,
        name: crcName || user.email,
        email: user.email,
      });
    } catch (error) {
      alert('Failed to resolve incident: ' + error.message);
    } finally {
      setChangingStatus(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.window}>
        <div style={styles.header}>
          <div>
            <div style={styles.titleRow}>
              <h2 style={{ margin: 0 }}>{incident.event_title}</h2>
              <span style={styles.severityBadge}>{incident.severity}</span>
              {incident.compare_ready && <span style={styles.compareBadge}>Grouped Compare</span>}
            </div>
            <div style={styles.subTitle}>
              {incident.incident_type} | {renderDueStateLabel(dueState)} | {incident.protocol_snapshot?.protocol_name || 'No protocol'}
            </div>
          </div>
          <button onClick={onClose} style={styles.closeButton}>
            Close
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.metaGrid}>
            <div style={styles.metaCard}>
              <strong>Status</strong>
              <div>{incident.status}</div>
              <div style={styles.metaHint}>Due: {incident.due_at ? new Date(incident.due_at).toLocaleString() : 'Not tracked'}</div>
            </div>
            <div style={styles.metaCard}>
              <strong>Protocol Rule</strong>
              <div>{incident.protocol_rule_snapshot?.instruction || 'No protocol rule snapshot recorded.'}</div>
              <div style={styles.metaHint}>
                Action: {incident.protocol_rule_snapshot?.action_code || 'N/A'} | Tier:{' '}
                {incident.protocol_rule_snapshot?.notification_tier || 'N/A'}
              </div>
            </div>
            <div style={styles.metaCard}>
              <strong>Documentation</strong>
              <div>Reports: {incident.report_count || incident.linked_reports?.length || 0}</div>
              <div>Patients: {incident.patient_count || incident.linked_patients?.length || 0}</div>
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>CRC Documentation Note</h3>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              style={styles.textArea}
              placeholder="Document the action taken, phone call outcome, and follow-up plan."
            />
            <div style={styles.buttonRow}>
              <button onClick={handleSaveNote} className="btn btn-primary" disabled={savingNote}>
                {savingNote ? 'Saving...' : 'Save Note'}
              </button>
              {incident.status !== 'resolved' && (
                <button onClick={handleResolve} className="btn btn-success" disabled={changingStatus}>
                  Document
                </button>
              )}
            </div>
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Linked Reports</h3>
            {incident.linked_reports?.length ? (
              incident.linked_reports.map((report) => (
                <div key={report.report_path} style={styles.linkedRow}>
                  <strong>{report.symptom_title}</strong>
                  <span>{report.severity}</span>
                  <span>
                    {typeof report.protocol_covered === 'boolean'
                      ? report.protocol_covered
                        ? 'Protocol listed'
                        : 'Protocol not listed'
                      : 'Protocol coverage unknown'}
                  </span>
                  <span>{new Date(report.submitted_at).toLocaleString()}</span>
                </div>
              ))
            ) : (
            <div style={styles.emptyState}>No linked structured adverse event reports yet.</div>
            )}
          </div>

          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Patient Compare View</h3>
            {loadingPatients ? (
              <div style={styles.emptyState}>Loading patient context...</div>
            ) : patientContexts.length ? (
              <div style={styles.compareGrid}>
                {patientContexts.map((context) => {
                  const latestVital = context.latest_vitals?.[0];
                  const linkedChatPath = (incident.linked_alert_paths || []).find((path) =>
                    path.startsWith(`users/${context.uid}/alerts/`)
                  );

                  return (
                    <div key={context.uid} style={styles.compareCard}>
                      <div style={styles.compareHeader}>
                        <div>
                          <strong>{context.patient_name}</strong>
                          <div style={styles.metaHint}>Subject ID: {context.subject_id}</div>
                        </div>
                        {linkedChatPath && (
                          <button
                            onClick={() =>
                              onOpenChat?.({
                                alertPath: linkedChatPath,
                                uid: context.uid,
                                patientName: context.patient_name,
                                reason: incident.event_title,
                                status: incident.status,
                              })
                            }
                            className="btn btn-small btn-primary"
                          >
                            Open Thread
                          </button>
                        )}
                      </div>
                      <div style={styles.compareDetail}>Hospital ID: {context.hospital_patient_id || 'Not set'}</div>
                      <div style={styles.compareDetail}>
                        Protocol: {context.protocol_name || context.patient_profile?.protocolName || 'None'}
                      </div>
                      <div style={styles.compareDetail}>
                        Latest vitals: {latestVital ? renderVitalRow(latestVital) : 'No recent vitals.'}
                      </div>
                      <div style={styles.compareDetail}>
                        Last vital timestamp:{' '}
                        {latestVital?.timestamp ? new Date(latestVital.timestamp).toLocaleString() : 'Not recorded'}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={styles.emptyState}>No linked patient records found for this incident.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    zIndex: 12000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
  },
  window: {
    width: 'min(1180px, 100%)',
    maxHeight: '90vh',
    overflow: 'hidden',
    background: 'white',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 20px',
    borderBottom: '1px solid #e5e7eb',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  severityBadge: {
    textTransform: 'capitalize',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  compareBadge: {
    background: '#dbeafe',
    color: '#1d4ed8',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
  subTitle: {
    marginTop: '6px',
    color: '#475569',
    fontSize: '14px',
  },
  closeButton: {
    border: 'none',
    background: '#eef2ff',
    color: '#1e3a8a',
    borderRadius: '10px',
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 'bold',
  },
  body: {
    overflowY: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
  },
  metaCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    padding: '14px',
    color: '#1f2937',
  },
  metaHint: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px',
  },
  section: {
    background: '#fff',
    border: '1px solid #eef2f7',
    borderRadius: '12px',
    padding: '16px',
  },
  sectionTitle: {
    marginTop: 0,
    marginBottom: '12px',
  },
  textArea: {
    width: '100%',
    minHeight: '110px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    padding: '12px',
    resize: 'vertical',
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '12px',
    flexWrap: 'wrap',
  },
  linkedRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 120px 200px',
    gap: '10px',
    padding: '10px 0',
    borderBottom: '1px solid #edf2f7',
    fontSize: '14px',
  },
  emptyState: {
    color: '#64748b',
    fontStyle: 'italic',
  },
  compareGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '12px',
  },
  compareCard: {
    border: '1px solid #dbe5f0',
    borderRadius: '12px',
    padding: '14px',
    background: '#fbfdff',
  },
  compareHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  compareDetail: {
    fontSize: '14px',
    color: '#334155',
    marginBottom: '8px',
  },
};

export default IncidentDetailModal;
