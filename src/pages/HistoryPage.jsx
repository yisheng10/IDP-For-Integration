import React, { useEffect, useMemo, useState } from 'react';
import { collectionGroup, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import LiveChatWidget from '../components/LiveChatWidget';
import CRCWorkspaceShell from '../components/CRCWorkspaceShell';

export default function HistoryPage({ user, onLogout }) {
  const [allAlerts, setAllAlerts] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [isAlertWidgetOpen, setIsAlertWidgetOpen] = useState(false);

  useEffect(() => {
    const alertsQuery = query(collectionGroup(db, 'alerts'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(alertsQuery, (snapshot) => {
      const rows = snapshot.docs.map((entry) => {
        const parentDoc = entry.ref.parent.parent;
        const uid = parentDoc ? parentDoc.id : 'unknown';
        return { id: entry.id, ref: entry.ref, uid, ...entry.data() };
      });
      setAllAlerts(rows);
    });
    return () => unsubscribe();
  }, []);

  const filteredAlerts = useMemo(() => {
    let result = [...allAlerts];

    if (searchText.trim()) {
      const queryText = searchText.toLowerCase();
      result = result.filter((alert) =>
        [alert.patientName, alert.reason, alert.uid].some((value) =>
          String(value || '').toLowerCase().includes(queryText)
        )
      );
    }

    if (filterDate) {
      result = result.filter((alert) => new Date(alert.timestamp).toISOString().split('T')[0] === filterDate);
    }

    if (filterStatus === 'unread') {
      result = result.filter((alert) => alert.status === 'unread');
    } else if (filterStatus === 'read') {
      result = result.filter((alert) => alert.status !== 'unread');
    }

    result.sort((left, right) => {
      const leftValue =
        sortConfig.key === 'patientName' ? left.patientName || left.senderName || '' : left[sortConfig.key] || '';
      const rightValue =
        sortConfig.key === 'patientName' ? right.patientName || right.senderName || '' : right[sortConfig.key] || '';

      if (leftValue < rightValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [allAlerts, filterDate, filterStatus, searchText, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / itemsPerPage));
  const currentItems = filteredAlerts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return 'Sort';
    return sortConfig.direction === 'asc' ? 'Asc' : 'Desc';
  };

  const getStatusBadge = (status) => {
    const isActive = status === 'unread';
    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: '999px',
          background: isActive ? 'var(--danger-soft)' : 'var(--success-soft)',
          color: isActive ? 'var(--danger)' : 'var(--success)',
          fontWeight: '700',
          fontSize: '12px',
        }}
      >
        {isActive ? 'Active' : 'Resolved'}
      </span>
    );
  };

  const activeAlerts = useMemo(() => allAlerts.filter((alert) => alert.status === 'unread'), [allAlerts]);
  const resolvedCount = allAlerts.length - activeAlerts.length;

  const utilityContent = (
    <div className="utility-stack">
      <div className="card workspace-card">
        <div className="section-header">
          <div>
            <h3>Queue snapshot</h3>
            <div className="section-note">Keep unresolved threads visible while filtering the audit history.</div>
          </div>
        </div>
        <div className="workspace-summary-grid workspace-summary-grid--compact">
          <div className="workspace-summary-item">
            <span>Active</span>
            <strong>{activeAlerts.length}</strong>
          </div>
          <div className="workspace-summary-item">
            <span>Resolved</span>
            <strong>{resolvedCount}</strong>
          </div>
        </div>
      </div>

      <div className="card workspace-card">
        <div className="section-header">
          <div>
            <h3>Latest active alerts</h3>
            <div className="section-note">Open the live thread directly from the utility rail when needed.</div>
          </div>
        </div>
        {activeAlerts.length ? (
          <div className="utility-list">
            {activeAlerts.slice(0, 6).map((alert) => (
              <div key={alert.id} className="utility-alert">
                <div>
                  <div className="utility-alert__title">{alert.patientName || alert.senderName || 'Unknown'}</div>
                  <div className="utility-alert__body">{alert.reason}</div>
                </div>
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => {
                    setSelectedAlert(alert);
                    setIsAlertWidgetOpen(true);
                  }}
                >
                  Open
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel">No active alerts at the moment.</div>
        )}
      </div>
    </div>
  );

  const navSections = [
    {
      title: 'Primary',
      items: [
        { id: 'dashboard', label: 'Dashboard', description: 'Overview', icon: 'dashboard', path: '/home?section=dashboard' },
        { id: 'patients', label: 'Patients', description: 'Roster', icon: 'patients', path: '/home?section=patients' },
        { id: 'safety-inbox', label: 'Safety Inbox', description: 'Incidents', icon: 'safety', path: '/home?section=safety-inbox' },
        { id: 'side-effect-guidance', label: 'Side Effect Guidance', description: 'Gemini', icon: 'guidance', path: '/home?section=clinical-intelligence&focus=guidance' },
        { id: 'patient-dropout-prediction', label: 'Patient Dropout Prediction', description: 'CRC only', icon: 'dropout', path: '/home?section=clinical-intelligence&focus=dropout' },
      ],
    },
    {
      title: 'Secondary',
      items: [
        { id: 'history', label: 'History', description: 'Threads', icon: 'history', path: '/history' },
        { id: 'resources', label: 'Resources', description: 'CTCAE', icon: 'resources', path: '/home?section=resources' },
      ],
    },
  ];
  const headerAlertButtonLabel = activeAlerts.length ? `Alerts (${activeAlerts.length})` : 'Inbox';

  return (
    <CRCWorkspaceShell
      user={user}
      onLogout={onLogout}
      navSections={navSections}
      activeNavId="history"
      alerts={activeAlerts}
      onAlertsClick={() => {
        setSelectedAlert(null);
        setIsAlertWidgetOpen(true);
      }}
      alertButtonLabel={headerAlertButtonLabel}
      alertButtonUrgent={activeAlerts.length > 0}
      headerTitle="Global alert history"
      headerDescription="Search historical alert threads, filter by date and status, and reopen the full documentation trail without leaving the CRC portal."
    >
      <div className="workspace-two-column">
        {utilityContent}
        <div className="card workspace-card">
          <div className="section-header">
            <div>
              <h2 className="mt-0">Filter history</h2>
              <div className="section-note">Use quick filters to narrow the audit trail before opening a thread.</div>
            </div>
          </div>

          <div className="history-filter-grid">
            <input
              type="search"
              placeholder="Search patient name, subject ID, or incident reason"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value);
                setCurrentPage(1);
              }}
            />
            <input
              type="date"
              value={filterDate}
              onChange={(event) => {
                setFilterDate(event.target.value);
                setCurrentPage(1);
              }}
            />
            <select
              value={filterStatus}
              onChange={(event) => {
                setFilterStatus(event.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="unread">Active only</option>
              <option value="read">Resolved only</option>
            </select>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSearchText('');
                setFilterDate('');
                setFilterStatus('all');
                setCurrentPage(1);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="card workspace-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th onClick={() => handleSort('timestamp')} style={{ cursor: 'pointer' }}>Date {getSortIndicator('timestamp')}</th>
                <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>Status {getSortIndicator('status')}</th>
                <th onClick={() => handleSort('patientName')} style={{ cursor: 'pointer' }}>Patient {getSortIndicator('patientName')}</th>
                <th onClick={() => handleSort('reason')} style={{ cursor: 'pointer' }}>Reason {getSortIndicator('reason')}</th>
                <th onClick={() => handleSort('lastSender')} style={{ cursor: 'pointer' }}>Last sender {getSortIndicator('lastSender')}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {currentItems.length === 0 ? (
                <tr><td colSpan="6"><div className="empty-panel">No matching records found.</div></td></tr>
              ) : (
                currentItems.map((alert) => (
                  <tr key={alert.id} className="hover-row">
                    <td>
                      <div>{new Date(alert.timestamp).toLocaleDateString()}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                        {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td>{getStatusBadge(alert.status)}</td>
                    <td>
                      <div style={{ fontWeight: '700' }}>{alert.patientName || alert.senderName || 'Unknown'}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{alert.uid}</div>
                    </td>
                    <td>{alert.reason}</td>
                    <td>{alert.lastSender === 'crc' ? 'Staff' : 'Patient'}</td>
                    <td>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => {
                          setSelectedAlert(alert);
                          setIsAlertWidgetOpen(true);
                        }}
                      >
                        View thread
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
            Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
          </div>
          <div className="history-pagination__controls">
            <select
              value={itemsPerPage}
              onChange={(event) => {
                setItemsPerPage(Number(event.target.value));
                setCurrentPage(1);
              }}
              style={{ width: '100px' }}
            >
              <option value={10}>10</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button className="btn btn-secondary btn-small" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}>
              Prev
            </button>
            <button className="btn btn-secondary btn-small" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}>
              Next
            </button>
          </div>
        </div>
      </div>

      <LiveChatWidget
        user={user}
        role="crc"
        userName="CRC Admin"
        existingAlert={selectedAlert}
        recipientId={selectedAlert?.uid}
        recipientName={selectedAlert?.patientName}
        onClose={() => {
          setSelectedAlert(null);
          setIsAlertWidgetOpen(false);
        }}
        allAlerts={allAlerts}
        activeEmergencies={activeAlerts}
        controlledOpen={isAlertWidgetOpen}
        hideTrigger
        onOpenChange={setIsAlertWidgetOpen}
      />
    </CRCWorkspaceShell>
  );
}
