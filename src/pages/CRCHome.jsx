import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import CRCWorkspaceShell from '../components/CRCWorkspaceShell';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import IncidentDetailModal from '../components/IncidentDetailModal';
import ProtocolManager from '../components/ProtocolManager';
import PatientList from '../components/PatientList';
import PatientEditMenu from '../components/PatientEditMenu';
import EproStatusPanel from '../components/EproStatusPanel';
import DropoutRiskPanel from '../components/DropoutRiskPanel';
import SafetyInboxPanel from '../components/SafetyInboxPanel';
import { getStatusText } from '../utils';
import {
  createAppointment,
  purgeOldAppointments,
  suggestAppointmentDate,
  subscribeToAppointments,
  updateAppointmentStatus,
} from '../services/appointmentService';
import { subscribeToAlertHistory, subscribeToUnresolvedAlerts } from '../services/alertService';
import {
  getBrowserPushState,
  registerBrowserPushSubscription,
  showForegroundIncidentNotification,
} from '../services/browserPushService';
import { getIncidentDueState, subscribeToIncidentRecords } from '../services/incidentService';

const AI_SUGGESTION_TITLE = 'AI Scheduler';

const VITAL_OPTIONS = [
  { key: 'temperature', label: 'Body Temp' },
  { key: 'bp', label: 'Blood Pressure' },
  { key: 'heartRate', label: 'Heart Rate' },
  { key: 'respRate', label: 'Resp. Rate' },
  { key: 'spo2', label: 'SpO2' },
  { key: 'weight', label: 'Weight' },
  { key: 'height', label: 'Height' },
  { key: 'glucoseFasting', label: 'Glucose (Fasting)' },
  { key: 'glucosePost', label: 'Glucose (Post)' },
  { key: 'pef', label: 'PEF (Asthma)' },
  { key: 'fev1', label: 'FEV1' },
  { key: 'inr', label: 'INR (Clotting)' },
  { key: 'ketones', label: 'Ketones' },
  { key: 'waist', label: 'Waist Circ.' },
];

export default function CRCHome({ user, onLogout }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [crcName, setCrcName] = useState('');
  const [patients, setPatients] = useState([]);
  const [crcUsers, setCrcUsers] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [selPatient, setSelPatient] = useState(null);
  const [pVitals, setPVitals] = useState([]);
  const [pAppts, setPAppts] = useState([]);
  const [pAlerts, setPAlerts] = useState([]);
  const [globalAlerts, setGlobalAlerts] = useState([]);
  const [eproEntries, setEproEntries] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [newDate, setNewDate] = useState('');
  const [suggestedDate, setSuggestedDate] = useState('');
  const [suggestedReason, setSuggestedReason] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [chatAlert, setChatAlert] = useState(null);
  const [activeIncident, setActiveIncident] = useState(null);
  const [pushState, setPushState] = useState(() => getBrowserPushState());
  const [toastMsg, setToastMsg] = useState(null);
  const [tempPatientID, setTempPatientID] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [tempPrimaryCrcId, setTempPrimaryCrcId] = useState('');
  const [tempVitalsConfig, setTempVitalsConfig] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const prevAlertCountRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const foregroundNotificationRef = useRef(new Set());

  useEffect(() => {
    getDoc(doc(db, 'users', user.uid)).then((snapshot) => {
      if (snapshot.exists()) {
        setCrcName(snapshot.data().nickname || 'CRC');
      }
    });
  }, [user]);

  useEffect(() => {
    const patientsQuery = query(collection(db, 'users'), where('role', '==', 'patient'));
    const unsubscribe = onSnapshot(patientsQuery, (snapshot) => {
      setPatients(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const crcQuery = query(collection(db, 'users'), where('role', '==', 'crc'));
    const unsubscribe = onSnapshot(crcQuery, (snapshot) => {
      setCrcUsers(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setPushState(getBrowserPushState());
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      registerBrowserPushSubscription(user.uid)
        .then(() => setPushState(getBrowserPushState()))
        .catch((error) => console.error('Browser push sync failed:', error));
    }
  }, [user.uid]);

  useEffect(() => {
    if (!selectedPatientId || !patients.length) return;
    const updated = patients.find((patient) => patient.id === selectedPatientId);
    if (updated) setSelPatient(updated);
  }, [patients, selectedPatientId]);

  useEffect(() => {
    const unsubscribeActive = subscribeToUnresolvedAlerts((entries) => {
      setUrgentAlerts(entries);
      if (!isFirstLoadRef.current && entries.length > prevAlertCountRef.current) {
        const nextAlert = entries[0];
        if (nextAlert && nextAlert.lastSender !== 'crc') {
          setToastMsg(`New alert: ${nextAlert.patientName || 'Patient'} - ${nextAlert.reason}`);
          window.setTimeout(() => setToastMsg(null), 5000);
        }
      }
      prevAlertCountRef.current = entries.length;
      isFirstLoadRef.current = false;
    });

    const globalAlertQuery = query(collectionGroup(db, 'alerts'));
    const unsubscribeGlobal = onSnapshot(globalAlertQuery, (snapshot) => {
      const rows = snapshot.docs
        .map((entry) => {
          const parentDoc = entry.ref.parent.parent;
          const uid = parentDoc ? parentDoc.id : 'unknown';
          return { id: entry.id, ref: entry.ref, uid, ...entry.data() };
        })
        .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
      setGlobalAlerts(rows);
    });

    return () => {
      unsubscribeActive();
      unsubscribeGlobal();
    };
  }, []);

  useEffect(() => {
    const eproQuery = query(collectionGroup(db, 'epro_submissions'));
    const unsubscribe = onSnapshot(eproQuery, (snapshot) => {
      const records = snapshot.docs
        .map((entry) => {
          const parentDoc = entry.ref.parent.parent;
          const uid = parentDoc ? parentDoc.id : 'unknown';
          return { id: entry.id, uid, ...entry.data() };
        })
        .sort((left, right) => {
          const leftTime = new Date(left.submitted_at || left.updated_at || left.assigned_at || 0).getTime();
          const rightTime = new Date(right.submitted_at || right.updated_at || right.assigned_at || 0).getTime();
          return rightTime - leftTime;
        });
      setEproEntries(records);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let isFirstIncidentLoad = true;
    const requestedIncidentId = searchParams.get('incident');
    const unsubscribe = subscribeToIncidentRecords(
      (records) => {
        const visibleRecords = records.filter(
          (incident) => !incident.primary_crc_id || incident.primary_crc_id === user.uid
        );
        setIncidents(visibleRecords);

        if (isFirstIncidentLoad) {
          visibleRecords.forEach((incident) => {
            foregroundNotificationRef.current.add(`${incident.id}:${incident.updated_at}`);
          });
          isFirstIncidentLoad = false;
        } else {
          visibleRecords.forEach((incident) => {
            const signature = `${incident.id}:${incident.updated_at}`;
            const shouldNotify =
              !foregroundNotificationRef.current.has(signature) &&
              incident.status !== 'resolved' &&
              incident.severity === 'serious' &&
              incident.primary_crc_id === user.uid;
            foregroundNotificationRef.current.add(signature);
            if (shouldNotify) showForegroundIncidentNotification(incident);
          });
        }

        if (requestedIncidentId) {
          const matched = visibleRecords.find((incident) => incident.id === requestedIncidentId);
          if (matched) setActiveIncident(matched);
        }
      },
      (error) => console.error('Incident subscription failed:', error)
    );
    return () => unsubscribe();
  }, [searchParams, user.uid]);

  useEffect(() => {
    if (!selectedPatientId) {
      setSelPatient(null);
      setPVitals([]);
      setPAppts([]);
      setPAlerts([]);
      return undefined;
    }

    const vitalsQuery = query(collection(db, 'users', selectedPatientId, 'vitals'), orderBy('timestamp', 'desc'));
    const unsubscribeVitals = onSnapshot(vitalsQuery, (snapshot) => {
      setPVitals(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    const unsubscribeAppointments = subscribeToAppointments(selectedPatientId, setPAppts);
    const unsubscribeAlerts = subscribeToAlertHistory(selectedPatientId, setPAlerts);

    return () => {
      unsubscribeVitals();
      unsubscribeAppointments();
      unsubscribeAlerts();
    };
  }, [selectedPatientId]);

  const selectP = (patient) => {
    if (!patient) {
      setSelectedPatientId(null);
      setTempPatientID('');
      setTempEmail('');
      setTempPrimaryCrcId('');
      setTempVitalsConfig({});
      setSuggestedDate('');
      setSuggestedReason('');
      setSuccessMsg('');
      return;
    }

    setSelectedPatientId(patient.id);
    setSelPatient(patient);
    setTempPatientID(patient.hospitalPatientId || '');
    setTempEmail(patient.email || '');
    setTempPrimaryCrcId(patient.primary_crc_id || patient.primaryCrcId || user.uid);
    setSuggestedDate('');
    setSuggestedReason('');
    setSuccessMsg('');

    const savedConfig = patient.monitoredVitals || ['temperature', 'spo2', 'bp'];
    const config = {};
    VITAL_OPTIONS.forEach((option) => {
      config[option.key] = savedConfig.includes(option.key);
    });
    setTempVitalsConfig(config);
    purgeOldAppointments(patient.id);
  };

  const handleNavAlertClick = (alert) => {
    const target = patients.find((patient) => patient.id === alert.uid);
    if (target) {
      selectP(target);
      setChatAlert(alert);
    } else {
      window.alert('Patient loading...');
      setChatAlert(alert);
    }
  };

  const handleEnablePush = async () => {
    try {
      await registerBrowserPushSubscription(user.uid);
      setPushState(getBrowserPushState());
      window.alert('Browser alerts enabled for this CRC session.');
    } catch (error) {
      window.alert(`Unable to enable browser alerts: ${error.message}`);
    }
  };

  const handleOpenIncident = (incident) => {
    setActiveIncident(incident);
    setSearchParams({ incident: incident.id }, { replace: true });
  };

  const handleCloseIncident = () => {
    setActiveIncident(null);
    setSearchParams({}, { replace: true });
  };

  const handleOpenIncidentChat = ({ alertPath, uid, patientName, reason, status }) => {
    const target = patients.find((patient) => patient.id === uid);
    if (target) selectP(target);

    setChatAlert({
      id: alertPath.split('/').pop(),
      ref: doc(db, alertPath),
      uid,
      patientName,
      reason,
      status,
    });
    handleCloseIncident();
  };

  const handleSuggestDate = async () => {
    if (!selPatient?.protocolUrl) {
      setSuggestedReason('No protocol assigned.');
      return;
    }

    setIsSuggesting(true);
    setSuggestedReason(`Reading ${selPatient.protocolName}...`);
    setSuggestedDate('');
    try {
      const result = await suggestAppointmentDate(selPatient.protocolUrl, pAppts);
      setSuggestedDate(result.date);
      setSuggestedReason(result.reason);
      if (result.date) setNewDate(result.date);
    } catch (error) {
      setSuggestedReason(`Error: ${error.message}`);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleMarkComplete = async (appointmentId) => {
    if (!window.confirm('Confirm attended appointment?')) return;
    try {
      await updateAppointmentStatus(selPatient.id, appointmentId, 'completed');
    } catch (error) {
      window.alert(`Error: ${error.message}`);
    }
  };

  const handleSaveInfo = async () => {
    if (!selPatient) return;
    setIsSaving(true);
    setSuccessMsg('');
    try {
      const vitalsArray = Object.keys(tempVitalsConfig).filter((key) => tempVitalsConfig[key]);
      const assignedCrc = crcUsers.find((entry) => entry.id === tempPrimaryCrcId);
      await updateDoc(doc(db, 'users', selPatient.id), {
        hospitalPatientId: tempPatientID,
        email: tempEmail,
        monitoredVitals: vitalsArray,
        primary_crc_id: tempPrimaryCrcId || null,
        primary_crc_name: assignedCrc?.nickname || assignedCrc?.email || null,
      });
      setSuccessMsg('Saved patient info and monitoring configuration.');
      window.setTimeout(() => setSuccessMsg(''), 3000);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePatient = async () => {
    if (!selPatient) return;
    const confirmation = window.prompt(
      `Warning: this will permanently delete patient "${selPatient.nickname}". Type "CONFIRM" to continue.`
    );
    if (confirmation !== 'CONFIRM') return;

    try {
      await deleteDoc(doc(db, 'users', selPatient.id));
      window.alert(`Patient "${selPatient.nickname}" has been deleted.`);
      selectP(null);
    } catch (error) {
      window.alert(`Error deleting patient: ${error.message}`);
    }
  };

  const schedule = async () => {
    try {
      await createAppointment(selPatient.id, newDate);
      setNewDate('');
      window.alert('Appointment scheduled.');
    } catch (error) {
      window.alert(error.message);
    }
  };

  const enrichedAlerts = urgentAlerts.map((alert) => ({
    ...alert,
    patientName: patients.find((patient) => patient.id === alert.uid)?.nickname || alert.senderName || 'Unknown',
  }));

  const enrichedGlobalAlerts = globalAlerts.map((alert) => ({
    ...alert,
    patientName: patients.find((patient) => patient.id === alert.uid)?.nickname || alert.senderName || 'Unknown',
  }));

  const getStatusStyle = (status) => {
    switch (status) {
      case 'confirmed':
        return { color: '#1f7a45', fontWeight: 'bold' };
      case 'reschedule_requested':
        return { color: '#9a6200', fontWeight: 'bold' };
      case 'pending':
        return { color: '#b42318', fontWeight: 'bold' };
      case 'completed':
        return { color: '#64748b', fontWeight: 'bold', textDecoration: 'line-through' };
      default:
        return { color: '#14324a' };
    }
  };

  const stablePatientData = useMemo(
    () => (selPatient ? { ...selPatient, vitals: pVitals, appointments: pAppts } : null),
    [pAppts, pVitals, selPatient]
  );

  useEffect(() => {
    if (!activeIncident) return;
    const refreshed = incidents.find((incident) => incident.id === activeIncident.id);
    if (refreshed) setActiveIncident(refreshed);
  }, [activeIncident, incidents]);

  const selectedPatientEproEntries = useMemo(
    () => (selPatient ? eproEntries.filter((entry) => entry.uid === selPatient.id) : []),
    [eproEntries, selPatient]
  );

  const openIncidentCount = useMemo(
    () => incidents.filter((incident) => incident.status !== 'resolved').length,
    [incidents]
  );
  const overdueIncidentCount = useMemo(
    () => incidents.filter((incident) => getIncidentDueState(incident) === 'overdue').length,
    [incidents]
  );
  const selectedPatientIncidentCount = useMemo(() => {
    if (!selPatient) return 0;
    return incidents.filter((incident) => (incident.linked_patient_ids || []).includes(selPatient.id)).length;
  }, [incidents, selPatient]);
  const seriousActiveAlertCount = urgentAlerts.filter((alert) => alert.status === 'unread').length;
  const assignedPatientCount = useMemo(
    () =>
      patients.filter((patient) => (patient.primary_crc_id || patient.primaryCrcId || '') === user.uid).length,
    [patients, user.uid]
  );

  const sidebarContent = (
    <>
      <div className="card sidebar-summary">
        <div className="sidebar-summary__label">CRC workload snapshot</div>
        <div className="sidebar-summary__grid">
          <div className="sidebar-summary__item">
            <span>Assigned patients</span>
            <strong>{assignedPatientCount}</strong>
          </div>
          <div className="sidebar-summary__item">
            <span>Open incidents</span>
            <strong>{openIncidentCount}</strong>
          </div>
          <div className="sidebar-summary__item">
            <span>Overdue</span>
            <strong>{overdueIncidentCount}</strong>
          </div>
          <div className="sidebar-summary__item">
            <span>Unread emergencies</span>
            <strong>{seriousActiveAlertCount}</strong>
          </div>
        </div>
      </div>

      <PatientList patients={patients} selectedPatientId={selectedPatientId} onSelect={selectP} />

      <div className="card workspace-card">
        <div className="section-header">
          <div>
            <h3>Selected patient context</h3>
            <div className="section-note">Keep core identifiers and study context visible while you work.</div>
          </div>
        </div>

        {selPatient ? (
          <div className="sidebar-patient-context">
            <div className="sidebar-patient-context__row">
              <span>Patient</span>
              <strong>{selPatient.nickname}</strong>
            </div>
            <div className="sidebar-patient-context__row">
              <span>Subject ID</span>
              <strong>{selPatient.subject_id || selPatient.subjectId || selPatient.id}</strong>
            </div>
            <div className="sidebar-patient-context__row">
              <span>Protocol</span>
              <strong>{selPatient.protocolName || 'Not assigned'}</strong>
            </div>
            <div className="sidebar-patient-context__row">
              <span>Primary CRC</span>
              <strong>{selPatient.primary_crc_name || 'Unassigned'}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-panel">Select a patient from the roster to keep their study context pinned here.</div>
        )}
      </div>
    </>
  );

  const utilityContent = (
    <div className="utility-stack">
      <div className={`card workspace-card ${urgentAlerts.length ? 'utility-card--danger' : 'utility-card--calm'}`}>
        <div className="section-header">
          <div>
            <h3>Active emergencies</h3>
            <div className="section-note">Urgent patient alerts remain visible without leaving the main workflow.</div>
          </div>
        </div>
        {urgentAlerts.length ? (
          <div className="utility-list">
            {enrichedAlerts.map((alert) => (
              <div key={alert.id} className="utility-alert">
                <div>
                  <div className="utility-alert__title">{alert.patientName}</div>
                  <div className="utility-alert__body">{alert.reason}</div>
                  <div className="utility-alert__meta">{new Date(alert.timestamp).toLocaleString()}</div>
                </div>
                <button onClick={() => handleNavAlertClick(alert)} className="btn btn-primary btn-small">
                  Open
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-panel">No active emergencies right now.</div>
        )}
      </div>

      <SafetyInboxPanel
        incidents={incidents}
        selectedPatient={selPatient}
        pushState={pushState}
        onEnablePush={handleEnablePush}
        onOpenIncident={handleOpenIncident}
      />

      <DropoutRiskPanel selectedPatient={selPatient} eproEntries={selectedPatientEproEntries} />
    </div>
  );

  return (
    <>
      {toastMsg ? (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            background: '#b42318',
            color: 'white',
            padding: '14px 16px',
            borderRadius: '16px',
            zIndex: 1400,
            boxShadow: '0 20px 40px rgba(180, 35, 24, 0.28)',
          }}
        >
          {toastMsg}
        </div>
      ) : null}

      <LiveChatWidget
        user={user}
        role="crc"
        userName={crcName}
        existingAlert={chatAlert}
        activeEmergencies={enrichedAlerts}
        allAlerts={selPatient ? pAlerts : enrichedGlobalAlerts}
        onClose={() => setChatAlert(null)}
        recipientId={selPatient?.id}
        recipientName={selPatient?.nickname}
      />

      {activeIncident ? (
        <IncidentDetailModal
          incident={activeIncident}
          user={user}
          crcName={crcName}
          onClose={handleCloseIncident}
          onOpenChat={handleOpenIncidentChat}
        />
      ) : null}

      <CRCWorkspaceShell
        user={user}
        onLogout={onLogout}
        activePage="dashboard"
        alerts={enrichedAlerts}
        onAlertClick={handleNavAlertClick}
        onHomeClick={() => selectP(null)}
        headerEyebrow="CRC operations"
        title="Clinical operations workspace"
        description="Review structured safety events, monitor questionnaire completion, coordinate appointments, and inspect dropout risk from one CRC-only control surface."
        stats={[
          { label: 'Patients', value: patients.length },
          { label: 'Open incidents', value: openIncidentCount },
          { label: 'Overdue items', value: overdueIncidentCount },
          { label: 'Active emergencies', value: seriousActiveAlertCount },
        ]}
        sidebarContent={sidebarContent}
        utilityContent={utilityContent}
      >
        <div className="card info-banner">
          <div className="metric-strip">
            <span className="metric-pill">Signed in as {crcName || user.email}</span>
            <span className="metric-pill">{pushState?.label || 'Browser alerts unavailable'}</span>
            <span className="metric-pill">{selectedPatientIncidentCount} linked incidents in current view</span>
          </div>
        </div>

        {selPatient ? (
          <>
            <div className="card workspace-card">
              <div className="workspace-card__header">
                <div>
                  <div className="dashboard-kicker">Patient workspace</div>
                  <h2 className="workspace-card__title">{selPatient.nickname}</h2>
                  <div className="workspace-card__meta">
                    Subject ID: {selPatient.subject_id || selPatient.subjectId || selPatient.id}
                  </div>
                </div>
                <div className="metric-strip">
                  <span className="metric-pill">Primary CRC {selPatient.primary_crc_name || 'Unassigned'}</span>
                  <span className="metric-pill">Protocol {selPatient.protocolName || 'None'}</span>
                  <span className="metric-pill">{selectedPatientIncidentCount} linked incidents</span>
                </div>
              </div>

              <div className="workspace-summary-grid">
                <div className="workspace-summary-item">
                  <span>Hospital ID</span>
                  <strong>{selPatient.hospitalPatientId || 'Not set'}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Email</span>
                  <strong>{selPatient.email || 'Not set'}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Appointments</span>
                  <strong>{pAppts.length}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Recent vitals</span>
                  <strong>{pVitals.length}</strong>
                </div>
              </div>
            </div>

            <div className="workspace-two-column">
              <PatientEditMenu
                patient={selPatient}
                hospitalId={tempPatientID}
                setHospitalId={setTempPatientID}
                email={tempEmail}
                setEmail={setTempEmail}
                primaryCrcId={tempPrimaryCrcId}
                setPrimaryCrcId={setTempPrimaryCrcId}
                crcUsers={crcUsers}
                vitalsConfig={tempVitalsConfig}
                setVitalsConfig={setTempVitalsConfig}
                vitalOptions={VITAL_OPTIONS}
                onSave={handleSaveInfo}
                onDelete={handleDeletePatient}
                isSaving={isSaving}
                successMsg={successMsg}
              />

              <ProtocolManager selectedPatient={selPatient} />
            </div>

            <div className="workspace-two-column">
              <div className="card workspace-card">
                <div className="section-header">
                  <div>
                    <h3>Recent vitals</h3>
                    <div className="section-note">
                      Most recent patient measurements without leaving the selected workspace.
                    </div>
                  </div>
                </div>
                {pVitals.length ? (
                  pVitals.slice(0, 5).map((record) => (
                    <div key={record.id} className="data-list-row data-list-row--vitals">
                      <div>{new Date(record.timestamp).toLocaleString()}</div>
                      <div>BP {record.bpSys ? `${record.bpSys}/${record.bpDia}` : '-'}</div>
                      <div>SpO2 {record.spo2 ? `${record.spo2}%` : '-'}</div>
                      <div>Temp {record.temperature ? `${record.temperature} C` : '-'}</div>
                    </div>
                  ))
                ) : (
                  <div className="empty-panel">No vitals recorded for this patient yet.</div>
                )}
              </div>

              <div className="card workspace-card">
                <div className="section-header">
                  <div>
                    <h3>Appointment scheduler</h3>
                    <div className="section-note">
                      Schedule, inspect AI date suggestions, and complete confirmed visits from one panel.
                    </div>
                  </div>
                </div>
                <div className="inline-form-row">
                  <input
                    type="datetime-local"
                    value={newDate}
                    onChange={(event) => setNewDate(event.target.value)}
                    style={{ flex: 1, minWidth: '240px' }}
                  />
                  <button onClick={schedule} className="btn btn-primary">
                    Schedule
                  </button>
                </div>
                <div className="info-banner">
                  <div className="section-header" style={{ marginBottom: '6px' }}>
                    <strong>{AI_SUGGESTION_TITLE}</strong>
                    <button onClick={handleSuggestDate} disabled={isSuggesting} className="btn btn-secondary btn-small">
                      {isSuggesting ? 'Thinking...' : 'Suggest date'}
                    </button>
                  </div>
                  {suggestedDate ? (
                    <>
                      <div style={{ fontWeight: '700', color: 'var(--brand-strong)' }}>
                        Suggested: {new Date(suggestedDate).toLocaleString()}
                      </div>
                      <div className="section-note" style={{ marginTop: '6px' }}>
                        {suggestedReason}
                      </div>
                    </>
                  ) : suggestedReason ? (
                    <div className="section-note">{suggestedReason}</div>
                  ) : (
                    <div className="section-note">
                      Use the AI scheduler to propose the next visit based on the active protocol and current appointments.
                    </div>
                  )}
                </div>
                {pAppts.length ? (
                  pAppts.map((appointment) => (
                    <div key={appointment.id} className="data-list-card">
                      <div>
                        <div style={{ fontWeight: '700' }}>{new Date(appointment.datetime).toLocaleString()}</div>
                        <div style={{ marginTop: '4px', ...getStatusStyle(appointment.status) }}>
                          {getStatusText(appointment.status)}
                        </div>
                      </div>
                      {appointment.status === 'confirmed' ? (
                        <button onClick={() => handleMarkComplete(appointment.id)} className="btn btn-success btn-small">
                          Mark complete
                        </button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="empty-panel">No appointments recorded yet.</div>
                )}
              </div>
            </div>

            <EproStatusPanel entries={eproEntries} selectedPatient={selPatient} patients={patients} />
          </>
        ) : (
          <>
            <div className="card workspace-card">
              <div className="dashboard-kicker">Patient workspace</div>
              <h2 className="workspace-card__title">Select a patient to begin</h2>
              <p className="section-note">
                Choose a patient from the left sidebar to edit CRC assignment, review vitals, manage appointments,
                inspect ePRO status, and open related incidents.
              </p>
            </div>
            <ProtocolManager selectedPatient={selPatient} />
            <EproStatusPanel entries={eproEntries} selectedPatient={selPatient} patients={patients} />
          </>
        )}
      </CRCWorkspaceShell>

      <GeminiChatbot
        role="crc"
        userId={user.uid}
        userNickname={crcName}
        patientData={stablePatientData}
        protocolUrl={selPatient?.protocolUrl}
        activeProtocolName={selPatient?.protocolName}
        allPatients={patients}
      />
    </>
  );
}
