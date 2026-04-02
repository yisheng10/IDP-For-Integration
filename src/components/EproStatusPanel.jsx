import React, { useMemo } from 'react';

function formatTimestamp(value) {
  if (!value) {
    return 'Not recorded';
  }
  return new Date(value).toLocaleString();
}

function deriveOperationalStatus(entry) {
  if (entry.status === 'submitted') {
    return 'submitted';
  }

  if (entry.due_at && new Date(entry.due_at) < new Date()) {
    return 'overdue';
  }

  return entry.status || 'assigned';
}

function statusStyle(status) {
  if (status === 'submitted') {
    return { background: '#edf8f1', color: '#1e7a44', border: '1px solid #bfe1c8' };
  }
  if (status === 'overdue') {
    return { background: '#fff1f1', color: '#c62828', border: '1px solid #f0c3c3' };
  }
  return { background: '#eef4ff', color: '#1e4ea1', border: '1px solid #cad8f2' };
}

export default function EproStatusPanel({
  entries = [],
  selectedPatient,
  patients = [],
  hideHeading = false,
  title = 'ePRO Operations',
  description = 'CRC visibility comes only from mirrored operational records, not questionnaire-service internals.',
}) {
  const sortedEntries = useMemo(() => {
    return [...entries].sort((left, right) => {
      const leftTime = new Date(left.submitted_at || left.updated_at || left.assigned_at || 0).getTime();
      const rightTime = new Date(right.submitted_at || right.updated_at || right.assigned_at || 0).getTime();
      return rightTime - leftTime;
    });
  }, [entries]);

  const selectedEntries = useMemo(() => {
    if (!selectedPatient) {
      return [];
    }
    return sortedEntries.filter((entry) => entry.uid === selectedPatient.id);
  }, [selectedPatient, sortedEntries]);

  const counts = useMemo(() => {
    return sortedEntries.reduce(
      (summary, entry) => {
        const status = deriveOperationalStatus(entry);
        if (status === 'submitted') summary.submitted += 1;
        else if (status === 'overdue') summary.overdue += 1;
        else summary.assigned += 1;
        return summary;
      },
      { submitted: 0, overdue: 0, assigned: 0 }
    );
  }, [sortedEntries]);

  const latestGlobalEntries = sortedEntries.slice(0, 5).map((entry) => ({
    ...entry,
    patientName:
      patients.find((patient) => patient.id === entry.uid)?.nickname ||
      entry.patientName ||
      entry.subject_id ||
      entry.uid,
  }));

  return (
    <div className="card" style={{ borderTop: '4px solid #0056b3' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {!hideHeading ? (
          <div>
            <h3 className="mt-0" style={{ marginBottom: '6px' }}>{title}</h3>
            <div style={{ color: '#5b6470', fontSize: '13px' }}>{description}</div>
          </div>
        ) : <div />}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div style={styles.metricBox}>
            <div style={styles.metricLabel}>Assigned</div>
            <div style={styles.metricValue}>{counts.assigned}</div>
          </div>
          <div style={styles.metricBox}>
            <div style={styles.metricLabel}>Submitted</div>
            <div style={styles.metricValue}>{counts.submitted}</div>
          </div>
          <div style={styles.metricBox}>
            <div style={styles.metricLabel}>Overdue</div>
            <div style={styles.metricValue}>{counts.overdue}</div>
          </div>
        </div>
      </div>

      {selectedPatient ? (
        <div style={{ marginTop: '18px', padding: '14px', borderRadius: '10px', background: '#f7faff', border: '1px solid #dbe6f6' }}>
          <div style={{ fontWeight: 'bold', color: '#1f3553', marginBottom: '10px' }}>
            Selected patient: {selectedPatient.nickname}
          </div>
          {selectedEntries.length === 0 ? (
            <div style={{ color: '#6b7785', fontSize: '14px' }}>
              No mirrored ePRO records yet for this patient.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {selectedEntries.slice(0, 4).map((entry) => {
                const status = deriveOperationalStatus(entry);
                return (
                  <div key={entry.id} style={styles.entryCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{entry.form_id}</strong>
                      <span style={{ ...styles.statusPill, ...statusStyle(status) }}>{status.toUpperCase()}</span>
                    </div>
                    <div style={styles.entryMeta}>Subject ID: {entry.subject_id}</div>
                    <div style={styles.entryMeta}>Assigned: {formatTimestamp(entry.assigned_at)}</div>
                    <div style={styles.entryMeta}>Due: {formatTimestamp(entry.due_at)}</div>
                    <div style={styles.entryMeta}>Submitted: {formatTimestamp(entry.submitted_at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '18px', color: '#6b7785', fontSize: '14px' }}>
          Select a patient to inspect mirrored questionnaire status.
        </div>
      )}

      <div style={{ marginTop: '18px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '10px', color: '#1f3553' }}>Latest mirrored activity</div>
        {latestGlobalEntries.length === 0 ? (
          <div style={{ color: '#6b7785', fontSize: '14px' }}>No mirrored questionnaire activity has been recorded yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {latestGlobalEntries.map((entry) => {
              const status = deriveOperationalStatus(entry);
              return (
                <div key={entry.id} style={styles.entryCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{entry.patientName}</strong>
                    <span style={{ ...styles.statusPill, ...statusStyle(status) }}>{status.toUpperCase()}</span>
                  </div>
                  <div style={styles.entryMeta}>{entry.form_id}</div>
                  <div style={styles.entryMeta}>Updated: {formatTimestamp(entry.updated_at || entry.submitted_at || entry.assigned_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  metricBox: {
    minWidth: '86px',
    padding: '10px 12px',
    borderRadius: '10px',
    background: '#f8fbff',
    border: '1px solid #dbe6f6',
  },
  metricLabel: {
    fontSize: '12px',
    color: '#6b7785',
    textTransform: 'uppercase',
    marginBottom: '4px',
  },
  metricValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#123253',
  },
  entryCard: {
    padding: '12px',
    borderRadius: '10px',
    background: '#ffffff',
    border: '1px solid #e3e9f2',
  },
  entryMeta: {
    fontSize: '13px',
    color: '#5b6470',
    marginTop: '4px',
  },
  statusPill: {
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 'bold',
  },
};
