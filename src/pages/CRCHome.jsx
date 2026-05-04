import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useLocation, useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import CRCWorkspaceShell from '../components/CRCWorkspaceShell';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import IncidentDetailModal from '../components/IncidentDetailModal';
import ProtocolManager from '../components/ProtocolManager';
import PatientList from '../components/PatientList';
import PatientEditMenu from '../components/PatientEditMenu';
import EproReviewWorkspace from '../components/EproReviewWorkspace';
import DropoutRiskPanel from '../components/DropoutRiskPanel';
import SafetyInboxPanel from '../components/SafetyInboxPanel';
import { getStatusText } from '../utils';
import { validateLoosePhoneNumber } from '../utils/validation';
import {
  createAppointment,
  purgeOldAppointments,
  suggestAppointmentDate,
  subscribeToAppointments,
  updateAppointmentStatus,
} from '../services/appointmentService';
import { subscribeToAlertHistory, subscribeToRecentAlertsGlobal, subscribeToUnresolvedAlerts } from '../services/alertService';
import {
  getBrowserPushState,
  registerBrowserPushSubscription,
  showForegroundIncidentNotification,
} from '../services/browserPushService';
import {
  fetchAlertHistorySummary,
  fetchIncidentSummary,
  fetchPatientRosterSummary,
} from '../services/crcSummaryService';
import { fetchDropoutDashboardSummary, fetchDropoutTestingSubjects } from '../services/dropoutService';
import { subscribeToIncidentRecords } from '../services/incidentService';
import { getSignedUrl } from '../services/storageService';
import {
  buildFallbackMonitoredVitals,
  describeInheritedVitals,
  subscribeToTrialTemplates,
} from '../services/trialTemplateService';

const AI_SUGGESTION_TITLE = 'AI Scheduler';
const MAX_PATIENT_ROSTER_LIMIT = 200;
const CRC_ROSTER_LIMIT = 80;
const MAX_GLOBAL_ALERT_LIMIT = 200;
const MAX_GLOBAL_EPRO_LIMIT = 200;
const MAX_GLOBAL_INCIDENT_LIMIT = 200;
const DEFAULT_WINDOW_PAGE_SIZE = 30;

const HOME_SECTIONS = {
  today: {
    label: 'Today',
    path: '/home?section=today',
    title: 'Today',
    description: 'Start with urgent work, pending CRC actions, and the fastest next step for the current shift.',
  },
  patients: {
    label: 'Patients',
    path: '/home?section=patients',
    title: 'Patients',
    description: 'Keep the roster, patient handoff, and study coordination inside one patient-first workspace.',
  },
  safety: {
    label: 'Safety',
    path: '/home?section=safety&tab=open',
    title: 'Safety',
    description: 'Review open incidents, resolved follow-up, and historical safety threads in one structured workspace.',
  },
  'side-effect-guidance': {
    label: 'Side Effect Guidance',
    path: '/home?section=side-effect-guidance',
    title: 'Side Effect Guidance',
    description: 'Use patient context, protocol grounding, and CTCAE support from one dedicated CRC guidance workspace.',
  },
  'patient-disengagement': {
    label: 'Patient Disengagement Prediction',
    path: '/home?section=patient-disengagement',
    title: 'Patient Disengagement Prediction',
    description: 'Inspect CRC-only patient ranking, confidence, and data completeness from a dedicated prediction workspace.',
  },
  epro: {
    label: 'ePRO',
    path: '/home?section=epro',
    title: 'ePRO',
    description: 'Review, edit, approve, and release patient questionnaires without leaving the CRC workspace.',
  },
  protocols: {
    label: 'Protocols',
    path: '/home?section=protocols',
    title: 'Protocols',
    description: 'Manage protocol PDFs, trial templates, monitored vitals, and static-context status from one workspace.',
  },
  resources: {
    label: 'Resources',
    path: '/home?section=resources',
    title: 'Resources',
    description: 'Keep CTCAE and assigned protocol references close to the active CRC workflow.',
  },
};

const LEGACY_HOME_SECTIONS = {
  dashboard: 'today',
  'safety-inbox': 'safety',
  'protocol-library': 'protocols',
};

export default function CRCHome({ user, onLogout }) {
  const location = useLocation();
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
  const [tempEmail, setTempEmail] = useState('');
  const [tempPrimaryCrcId, setTempPrimaryCrcId] = useState('');
  const [tempPrimaryCrcPhone, setTempPrimaryCrcPhone] = useState('');
  const [tempStudyEmergencyPhone, setTempStudyEmergencyPhone] = useState('');
  const [tempProtocolId, setTempProtocolId] = useState('');
  const [tempSubjectId, setTempSubjectId] = useState('');
  const [protocolTemplates, setProtocolTemplates] = useState([]);
  const [dropoutTestingSubjects, setDropoutTestingSubjects] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [isAlertWidgetOpen, setIsAlertWidgetOpen] = useState(false);
  const [patientRosterPage, setPatientRosterPage] = useState(1);
  const [patientRosterPageSize, setPatientRosterPageSize] = useState(DEFAULT_WINDOW_PAGE_SIZE);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(DEFAULT_WINDOW_PAGE_SIZE);
  const [eproEntriesPage, setEproEntriesPage] = useState(1);
  const [eproEntriesPageSize, setEproEntriesPageSize] = useState(DEFAULT_WINDOW_PAGE_SIZE);
  const [incidentPage, setIncidentPage] = useState(1);
  const [incidentPageSize, setIncidentPageSize] = useState(DEFAULT_WINDOW_PAGE_SIZE);
  const [patientRosterSummary, setPatientRosterSummary] = useState(null);
  const [globalAlertSummary, setGlobalAlertSummary] = useState(null);
  const [selectedAlertSummary, setSelectedAlertSummary] = useState(null);
  const [globalIncidentSummary, setGlobalIncidentSummary] = useState(null);
  const [selectedIncidentSummary, setSelectedIncidentSummary] = useState(null);
  const [disengagementSummary, setDisengagementSummary] = useState(null);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');

  const patientRosterLimit = Math.min(
    patientRosterPage * patientRosterPageSize + 1,
    MAX_PATIENT_ROSTER_LIMIT + 1
  );
  const globalAlertLimit = Math.min(
    historyPage * historyPageSize + 1,
    MAX_GLOBAL_ALERT_LIMIT + 1
  );
  const globalEproLimit = Math.min(
    eproEntriesPage * eproEntriesPageSize + 1,
    MAX_GLOBAL_EPRO_LIMIT + 1
  );
  const incidentWindowLimit = Math.min(
    incidentPage * incidentPageSize + 1,
    MAX_GLOBAL_INCIDENT_LIMIT + 1
  );

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
    let cancelled = false;

    async function loadRosterSummary() {
      try {
        const payload = await fetchPatientRosterSummary(user.uid);
        if (!cancelled) {
          setPatientRosterSummary(payload);
        }
      } catch (error) {
        console.error('Failed to load patient roster summary:', error);
        if (!cancelled) {
          setPatientRosterSummary(null);
        }
      }
    }

    loadRosterSummary();
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadGlobalSummaries() {
      try {
        const [alertsPayload, incidentsPayload] = await Promise.all([
          fetchAlertHistorySummary(),
          fetchIncidentSummary(),
        ]);
        if (!cancelled) {
          setGlobalAlertSummary(alertsPayload);
          setGlobalIncidentSummary(incidentsPayload);
        }
      } catch (error) {
        console.error('Failed to load global CRC summaries:', error);
        if (!cancelled) {
          setGlobalAlertSummary(null);
          setGlobalIncidentSummary(null);
        }
      }
    }

    loadGlobalSummaries();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDisengagementSummary() {
      try {
        const payload = await fetchDropoutDashboardSummary();
        if (!cancelled) {
          setDisengagementSummary(payload);
        }
      } catch (error) {
        console.error('Failed to load disengagement dashboard summary:', error);
        if (!cancelled) {
          setDisengagementSummary(null);
        }
      }
    }

    loadDisengagementSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selPatient?.id) {
      setSelectedAlertSummary(null);
      setSelectedIncidentSummary(null);
      return;
    }

    let cancelled = false;

    async function loadSelectedPatientSummaries() {
      try {
        const [alertsPayload, incidentsPayload] = await Promise.all([
          fetchAlertHistorySummary({ selectedPatientId: selPatient.id }),
          fetchIncidentSummary({ selectedPatientId: selPatient.id }),
        ]);
        if (!cancelled) {
          setSelectedAlertSummary(alertsPayload);
          setSelectedIncidentSummary(incidentsPayload);
        }
      } catch (error) {
        console.error('Failed to load selected-patient summaries:', error);
        if (!cancelled) {
          setSelectedAlertSummary(null);
          setSelectedIncidentSummary(null);
        }
      }
    }

    loadSelectedPatientSummaries();
    return () => {
      cancelled = true;
    };
  }, [selPatient?.id]);

  useEffect(() => {
    const patientsQuery = query(
      collection(db, 'users'),
      where('role', '==', 'patient'),
      orderBy(documentId()),
      limit(patientRosterLimit)
    );
    const unsubscribe = onSnapshot(patientsQuery, (snapshot) => {
      const rows = snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .sort((left, right) => {
          const leftLabel = String(left.nickname || left.email || left.id || '').toLowerCase();
          const rightLabel = String(right.nickname || right.email || right.id || '').toLowerCase();
          return leftLabel.localeCompare(rightLabel);
        });
      setPatients(rows);
    });
    return () => unsubscribe();
  }, [patientRosterLimit]);

  useEffect(() => {
    const crcQuery = query(
      collection(db, 'users'),
      where('role', '==', 'crc'),
      orderBy(documentId()),
      limit(CRC_ROSTER_LIMIT)
    );
    const unsubscribe = onSnapshot(crcQuery, (snapshot) => {
      const rows = snapshot.docs
        .map((entry) => ({ id: entry.id, ...entry.data() }))
        .sort((left, right) => {
          const leftLabel = String(left.nickname || left.email || left.id || '').toLowerCase();
          const rightLabel = String(right.nickname || right.email || right.id || '').toLowerCase();
          return leftLabel.localeCompare(rightLabel);
        });
      setCrcUsers(rows);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToTrialTemplates((rows) => {
      setProtocolTemplates(rows);
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

  const selectedProtocolTemplate = useMemo(() => {
    if (!selPatient) return null;
    return (
      protocolTemplates.find((template) => template.id === selPatient.protocolId) ||
      protocolTemplates.find((template) => template.name === selPatient.protocolName) ||
      null
    );
  }, [protocolTemplates, selPatient]);

  const editingProtocolTemplate = useMemo(() => {
    if (!tempProtocolId) return null;
    return protocolTemplates.find((template) => template.id === tempProtocolId) || null;
  }, [protocolTemplates, tempProtocolId]);

  useEffect(() => {
    let cancelled = false;

    async function loadTestingSubjects() {
      if (!selPatient) {
        setDropoutTestingSubjects([]);
        return;
      }

      try {
        const payload = await fetchDropoutTestingSubjects({
          trialId: editingProtocolTemplate?.dropout_trial_id || null,
          limit: 120,
        });
        if (!cancelled) {
          setDropoutTestingSubjects(payload.subjects || []);
        }
      } catch (error) {
        console.error('Failed to load subject ID options:', error);
        if (!cancelled) {
          setDropoutTestingSubjects([]);
        }
      }
    }

    loadTestingSubjects();
    return () => {
      cancelled = true;
    };
  }, [editingProtocolTemplate, selPatient, selectedProtocolTemplate]);

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

    const unsubscribeGlobal = subscribeToRecentAlertsGlobal((rows) => {
      setGlobalAlerts(rows);
    }, globalAlertLimit);

    return () => {
      unsubscribeActive();
      unsubscribeGlobal();
    };
  }, [globalAlertLimit]);

  useEffect(() => {
    const eproQuery = query(
      collectionGroup(db, 'epro_submissions'),
      orderBy('updated_at', 'desc'),
      limit(globalEproLimit)
    );
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
  }, [globalEproLimit]);

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
      (error) => console.error('Incident subscription failed:', error),
      { limitCount: incidentWindowLimit }
    );
    return () => unsubscribe();
  }, [incidentWindowLimit, searchParams, user.uid]);

  useEffect(() => {
    if (!selectedPatientId) {
      setSelPatient(null);
      setPVitals([]);
      setPAppts([]);
      setPAlerts([]);
      return undefined;
    }

    const vitalsQuery = query(
      collection(db, 'users', selectedPatientId, 'vitals'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const unsubscribeVitals = onSnapshot(vitalsQuery, (snapshot) => {
      setPVitals(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });
    const unsubscribeAppointments = subscribeToAppointments(selectedPatientId, setPAppts);
    const unsubscribeAlerts = subscribeToAlertHistory(selectedPatientId, setPAlerts, {
      limitCount: globalAlertLimit,
    });

    return () => {
      unsubscribeVitals();
      unsubscribeAppointments();
      unsubscribeAlerts();
    };
  }, [globalAlertLimit, selectedPatientId]);

  const selectP = (patient) => {
    if (!patient) {
      setSelectedPatientId(null);
      setTempEmail('');
      setTempPrimaryCrcId('');
      setTempPrimaryCrcPhone('');
      setTempStudyEmergencyPhone('');
      setTempProtocolId('');
      setTempSubjectId('');
      setSuggestedDate('');
      setSuggestedReason('');
      setSuccessMsg('');
      return;
    }

    setSelectedPatientId(patient.id);
    setSelPatient(patient);
    setTempEmail(patient.email || '');
    setTempPrimaryCrcId(patient.primary_crc_id || patient.primaryCrcId || user.uid);
    setTempPrimaryCrcPhone(patient.primary_crc_phone || patient.primaryCrcPhone || '');
    setTempStudyEmergencyPhone(patient.study_emergency_phone || patient.studyEmergencyPhone || '');
    setTempProtocolId(patient.protocolId || '');
    setTempSubjectId(patient.subject_id || patient.subjectId || patient.dropout_subject_id || patient.dropoutSubjectId || '');
    setSuggestedDate('');
    setSuggestedReason('');
    setSuccessMsg('');
    purgeOldAppointments(patient.id);
  };

  useEffect(() => {
    if (!selectedPatientId) return;
    setTempProtocolId(selPatient?.protocolId || '');
  }, [selectedPatientId, selPatient?.protocolId]);

  const handleNavAlertClick = (alert) => {
    const target = patients.find((patient) => patient.id === alert.uid);
    if (target) {
      selectP(target);
      setChatAlert(alert);
    } else {
      window.alert('Patient loading...');
      setChatAlert(alert);
    }
    setIsAlertWidgetOpen(true);
  };

  const handleOpenAlertWorkspace = () => {
    setChatAlert(null);
    setIsAlertWidgetOpen(true);
  };

  const handleSafetyInboxTabChange = (tabId) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', 'safety');
    nextParams.set('tab', tabId);
    nextParams.delete('focus');
    setSearchParams(nextParams, { replace: true });
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
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('incident', incident.id);
    setSearchParams(nextParams, { replace: true });
  };

  const handleCloseIncident = () => {
    setActiveIncident(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('incident');
    setSearchParams(nextParams, { replace: true });
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
    setIsAlertWidgetOpen(true);
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
    if (primaryCrcPhoneError || studyEmergencyPhoneError) {
      window.alert(primaryCrcPhoneError || studyEmergencyPhoneError);
      return;
    }
    setIsSaving(true);
    setSuccessMsg('');
    try {
      const assignedCrc = crcUsers.find((entry) => entry.id === tempPrimaryCrcId);
      const assignedProtocol = protocolTemplates.find((entry) => entry.id === tempProtocolId) || null;
      const inheritedMonitoredVitals = assignedProtocol
        ? buildFallbackMonitoredVitals(assignedProtocol.vital_templates || [])
        : [];
      await updateDoc(doc(db, 'users', selPatient.id), {
        email: tempEmail,
        primary_crc_id: tempPrimaryCrcId || null,
        primary_crc_name: assignedCrc?.nickname || assignedCrc?.email || null,
        primary_crc_phone: tempPrimaryCrcPhone || null,
        study_emergency_phone: tempStudyEmergencyPhone || null,
        protocolId: assignedProtocol?.id || null,
        protocolName: assignedProtocol?.name || null,
        protocolUrl: assignedProtocol?.storagePath || null,
        protocolStatus: assignedProtocol ? 'active' : null,
        protocolAssignedAt: assignedProtocol ? new Date().toISOString() : null,
        monitoredVitals: inheritedMonitoredVitals,
        subject_id: tempSubjectId || null,
      });
      setSuccessMsg('Saved patient ownership, trial assignment, emergency contact, and subject ID mapping.');
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

  const safetyHistoryAlerts = useMemo(() => {
    if (selPatient) {
      return pAlerts.map((alert) => ({
        ...alert,
        uid: selPatient.id,
        patientName: selPatient.nickname || alert.senderName || 'Unknown',
      }));
    }

    return enrichedGlobalAlerts;
  }, [enrichedGlobalAlerts, pAlerts, selPatient]);

  const totalPatientCount = Number.isFinite(Number(patientRosterSummary?.totalPatients))
    ? Number(patientRosterSummary.totalPatients)
    : patients.length;
  const assignedPatientCount = Number.isFinite(Number(patientRosterSummary?.assignedPatients))
    ? Number(patientRosterSummary.assignedPatients)
    : patients.filter((patient) => (patient.primary_crc_id || patient.primaryCrcId || '') === user.uid).length;
  const activeHistorySummary = selPatient ? selectedAlertSummary : globalAlertSummary;
  const activeIncidentSummary = selPatient ? selectedIncidentSummary : globalIncidentSummary;
  const canGoToNextPatientRosterPage = totalPatientCount > patientRosterPage * patientRosterPageSize;
  const canGoToNextHistoryPage =
    (Number.isFinite(Number(activeHistorySummary?.totalAlerts))
      ? Number(activeHistorySummary.totalAlerts)
      : safetyHistoryAlerts.length) > historyPage * historyPageSize;
  const canGoToNextEproPage = eproEntries.length > eproEntriesPage * eproEntriesPageSize;
  const canGoToNextIncidentPage =
    (Number.isFinite(Number(activeIncidentSummary?.totalIncidents))
      ? Number(activeIncidentSummary.totalIncidents)
      : incidents.length) > incidentPage * incidentPageSize;
  const patientRosterSummaryNote = `Showing ${patients.length} loaded patients from ${totalPatientCount} total patients. Assigned to this CRC: ${assignedPatientCount}.`;
  const historyWindowLabel = selPatient
    ? `Showing ${safetyHistoryAlerts.length} loaded alert-history records for ${selPatient.nickname || 'the selected patient'}. Full patient alert summary: ${selectedAlertSummary?.activeAlerts ?? 0} active, ${selectedAlertSummary?.resolvedAlerts ?? 0} resolved.`
    : `Showing ${globalAlerts.length} loaded global alert-history records from the current recent window. Full alert summary: ${globalAlertSummary?.activeAlerts ?? 0} active, ${globalAlertSummary?.resolvedAlerts ?? 0} resolved.`;
  const incidentWindowLabel = selPatient
    ? `Showing ${incidents.length} loaded safety cases for ${selPatient.nickname || 'the selected patient'}. Full patient safety summary: ${selectedIncidentSummary?.openIncidents ?? 0} open, ${selectedIncidentSummary?.resolvedIncidents ?? 0} resolved, ${selectedIncidentSummary?.groupedIncidents ?? 0} grouped.`
    : `Showing ${incidents.length} loaded safety cases from the current recent window. Full safety summary: ${globalIncidentSummary?.openIncidents ?? 0} open, ${globalIncidentSummary?.resolvedIncidents ?? 0} resolved, ${globalIncidentSummary?.groupedIncidents ?? 0} grouped.`;
  const eproWindowLabel = `Showing ${eproEntries.length} loaded mirrored ePRO records from the current recent window.`;
  const pendingEproCount = useMemo(
    () => eproEntries.filter((entry) => String(entry?.status || '').toLowerCase() !== 'submitted').length,
    [eproEntries]
  );
  const actionableDisengagementCount = Number.isFinite(Number(disengagementSummary?.actionable_count))
    ? Number(disengagementSummary.actionable_count)
    : 0;
  const scoredDisengagementCount = Number.isFinite(Number(disengagementSummary?.scored_count))
    ? Number(disengagementSummary.scored_count)
    : 0;

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
  const selectedPatientEproEntries = useMemo(() => {
    if (!selPatient?.id) return [];
    return eproEntries
      .filter((entry) => entry.uid === selPatient.id)
      .slice(0, 50);
  }, [eproEntries, selPatient?.id]);
  const selectedPatientIncidents = useMemo(() => {
    if (!selPatient?.id) return [];
    return incidents
      .filter((incident) => {
        const linkedIds = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : [];
        const linkedPatients = Array.isArray(incident.linked_patients) ? incident.linked_patients : [];
        const matchesLinkedIds = linkedIds.includes(selPatient.id);
        const matchesLinkedPatients = linkedPatients.some(
          (patient) => patient?.patient_id === selPatient.id || patient?.uid === selPatient.id
        );
        return matchesLinkedIds || matchesLinkedPatients;
      })
      .slice(0, 50);
  }, [incidents, selPatient?.id]);

  useEffect(() => {
    if (!activeIncident) return;
    const refreshed = incidents.find((incident) => incident.id === activeIncident.id);
    if (refreshed) setActiveIncident(refreshed);
  }, [activeIncident, incidents]);

  const primaryCrcPhoneError = useMemo(
    () => validateLoosePhoneNumber(tempPrimaryCrcPhone, 'Primary CRC phone'),
    [tempPrimaryCrcPhone]
  );
  const studyEmergencyPhoneError = useMemo(
    () => validateLoosePhoneNumber(tempStudyEmergencyPhone, 'Study emergency phone'),
    [tempStudyEmergencyPhone]
  );
  const hasPhoneValidationErrors = Boolean(primaryCrcPhoneError || studyEmergencyPhoneError);

  useEffect(() => {
    const legacyHash = location.hash.replace('#', '');
    const nextParams = new URLSearchParams(searchParams);
    let changed = false;

    if (legacyHash) {
      if (legacyHash === 'side-effect-guidance') {
        nextParams.set('section', 'side-effect-guidance');
        changed = true;
      } else if (legacyHash === 'patient-dropout-prediction') {
        nextParams.set('section', 'patient-disengagement');
        changed = true;
      } else if (legacyHash === 'protocol-library') {
        nextParams.set('section', 'protocols');
        changed = true;
      } else if (legacyHash === 'study-coordination') {
        nextParams.set('section', 'patients');
        nextParams.set('panel', 'coordination');
        changed = true;
      } else if (legacyHash === 'epro') {
        nextParams.set('section', 'epro');
        changed = true;
      } else if (legacyHash === 'dashboard') {
        nextParams.set('section', 'today');
        changed = true;
      } else if (HOME_SECTIONS[legacyHash]) {
        nextParams.set('section', legacyHash);
        changed = true;
      }
    }

    const rawSection = nextParams.get('section') || 'today';
    const rawFocus = nextParams.get('focus');
    let normalizedSection = rawSection;

    if (rawSection === 'clinical-intelligence') {
      normalizedSection = rawFocus === 'dropout' ? 'patient-disengagement' : 'side-effect-guidance';
    } else if (rawSection === 'study-coordination') {
      normalizedSection = 'patients';
      nextParams.set('panel', 'coordination');
    } else if (LEGACY_HOME_SECTIONS[rawSection]) {
      normalizedSection = LEGACY_HOME_SECTIONS[rawSection];
    }

    if (normalizedSection !== rawSection) {
      nextParams.set('section', normalizedSection);
      changed = true;
    }

    if (nextParams.has('focus')) {
      nextParams.delete('focus');
      changed = true;
    }

    if (normalizedSection === 'patients') {
      const panel = nextParams.get('panel');
      if (panel && panel !== 'coordination') {
        nextParams.delete('panel');
        changed = true;
      }
    } else if (nextParams.has('panel')) {
      nextParams.delete('panel');
      changed = true;
    }

    if (normalizedSection === 'safety') {
      const tab = nextParams.get('tab');
      if (!['open', 'resolved', 'history'].includes(tab)) {
        nextParams.set('tab', 'open');
        changed = true;
      }
    } else if (nextParams.has('tab')) {
      nextParams.delete('tab');
      changed = true;
    }

    if (!changed) return;
    setSearchParams(nextParams, { replace: true });
  }, [location.hash, searchParams, setSearchParams]);

  const activeHomeSection = useMemo(() => {
    const sectionId = searchParams.get('section') || 'today';
    return HOME_SECTIONS[sectionId] ? sectionId : 'today';
  }, [searchParams]);
  const activePatientPanel = activeHomeSection === 'patients' && searchParams.get('panel') === 'coordination'
    ? 'coordination'
    : 'summary';
  const activeSafetyTab = useMemo(() => {
    const tabId = searchParams.get('tab');
    return ['open', 'resolved', 'history'].includes(tabId) ? tabId : 'open';
  }, [searchParams]);
  const activeNavId = activeHomeSection;

  const openIncidentCount = useMemo(
    () => globalIncidentSummary?.openIncidents ?? incidents.filter((incident) => incident.status !== 'resolved').length,
    [globalIncidentSummary, incidents]
  );
  const selectedPatientIncidentCount = useMemo(() => {
    if (!selPatient) return 0;
    return selectedIncidentSummary?.totalIncidents ?? incidents.filter((incident) => (incident.linked_patient_ids || []).includes(selPatient.id)).length;
  }, [incidents, selPatient, selectedIncidentSummary]);
  const seriousActiveAlertCount = globalAlertSummary?.activeUrgentAlerts ?? urgentAlerts.filter((alert) => alert.status === 'unread').length;

  const currentHeaderSection = HOME_SECTIONS[activeHomeSection];
  const headerContextPills = useMemo(
    () => ['CRC-only surface', 'Patient safety first', 'Study-bound data'],
    []
  );

  const headerSearchResults = useMemo(() => {
    const queryText = rosterSearchQuery.trim().toLowerCase();
    if (!queryText) return [];

    return patients
      .filter((patient) => {
        const haystack = [
          patient.nickname,
          patient.email,
          patient.subject_id,
          patient.subjectId,
          patient.primary_crc_name,
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');

        return haystack.includes(queryText);
      })
      .slice(0, 6);
  }, [patients, rosterSearchQuery]);

  const openWorkspaceSection = (section, { panel, tab } = {}) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', section);
    nextParams.delete('focus');
    if (section === 'safety') {
      nextParams.set('tab', tab || 'open');
    } else {
      nextParams.delete('tab');
    }
    if (section === 'patients' && panel === 'coordination') {
      nextParams.set('panel', 'coordination');
    } else {
      nextParams.delete('panel');
    }
    setSearchParams(nextParams);
  };

  const todayPriorityActions = [
    {
      id: 'safety',
      label: 'Review active safety',
      value: openIncidentCount,
      note: openIncidentCount === 1 ? '1 open safety item needs review.' : `${openIncidentCount} open safety items need review.`,
      actionLabel: 'Open Safety',
      onClick: () => openWorkspaceSection('safety', { tab: 'open' }),
      tone: openIncidentCount > 0 ? 'warning' : 'default',
    },
    {
      id: 'guidance',
      label: 'Support symptom triage',
      value: seriousActiveAlertCount,
      note:
        seriousActiveAlertCount > 0
          ? `${seriousActiveAlertCount} urgent alert${seriousActiveAlertCount > 1 ? 's are' : ' is'} visible for immediate follow-up.`
          : 'Guidance workspace is ready for patient-level symptom support.',
      actionLabel: 'Open Guidance',
      onClick: () => openWorkspaceSection('side-effect-guidance'),
      tone: seriousActiveAlertCount > 0 ? 'danger' : 'default',
    },
    {
      id: 'epro',
      label: 'Release ePRO work',
      value: pendingEproCount,
      note:
        pendingEproCount > 0
          ? `${pendingEproCount} mirrored ePRO item${pendingEproCount > 1 ? 's are' : ' is'} still pending in the current window.`
          : 'No pending ePRO items are visible in the current loaded window.',
      actionLabel: 'Open ePRO',
      onClick: () => openWorkspaceSection('epro'),
      tone: pendingEproCount > 0 ? 'brand' : 'default',
    },
    {
      id: 'disengagement',
      label: 'Inspect disengagement ranking',
      value: actionableDisengagementCount,
      note:
        scoredDisengagementCount > 0
          ? `${actionableDisengagementCount} actionable patient${actionableDisengagementCount > 1 ? 's are' : ' is'} flagged across ${scoredDisengagementCount} scored patients.`
          : 'Published disengagement summary is not ready yet.',
      actionLabel: 'Open Prediction',
      onClick: () => openWorkspaceSection('patient-disengagement'),
      tone: actionableDisengagementCount > 0 ? 'warning' : 'default',
    },
  ];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 40);

    return () => window.clearTimeout(timer);
  }, [activeHomeSection, activePatientPanel]);

  const openDropoutPatientWorkspace = (patient, panel = 'summary') => {
    if (patient) {
      selectP(patient);
    }
    openWorkspaceSection('patients', {
      panel: panel === 'coordination' ? 'coordination' : undefined,
    });
  };

  const handleHeaderSearchSelect = (patient) => {
    selectP(patient);
    openWorkspaceSection('patients');
  };

  const handleOpenClinicalResource = async (filePath, bucket = 'pdfs') => {
    const newTab = window.open('', '_blank');
    if (!newTab) {
      window.alert('Please allow popups for this site to open the resource.');
      return;
    }

    newTab.document.write('Loading...');
    try {
      const signedUrl = await getSignedUrl(filePath, bucket);
      if (!signedUrl) {
        newTab.close();
        window.alert('Unable to generate the document link.');
        return;
      }

      newTab.location.href = signedUrl;
    } catch (error) {
      console.error('Resource open failed:', error);
      newTab.close();
      window.alert('Unable to open the document.');
    }
  };

  const navigationSections = [
    {
      title: 'Workspace',
      items: [
        { id: 'today', label: 'Today', description: 'Shift overview', icon: 'dashboard', path: HOME_SECTIONS.today.path },
        { id: 'patients', label: 'Patients', description: 'Roster', icon: 'patients', path: HOME_SECTIONS.patients.path },
        { id: 'safety', label: 'Safety', description: 'Incidents & history', icon: 'safety', path: HOME_SECTIONS.safety.path },
        { id: 'side-effect-guidance', label: 'Side Effect Guidance', description: 'Patient-grounded AI', icon: 'guidance', badge: 'AI', emphasis: 'guidance', path: HOME_SECTIONS['side-effect-guidance'].path },
        { id: 'patient-disengagement', label: 'Patient Disengagement Prediction', description: 'CRC only', icon: 'dropout', badge: 'CRC only', emphasis: 'dropout', path: HOME_SECTIONS['patient-disengagement'].path },
        { id: 'epro', label: 'ePRO', description: 'Review queue', icon: 'epro', path: HOME_SECTIONS.epro.path },
        { id: 'protocols', label: 'Protocols', description: 'Templates & PDFs', icon: 'protocol', path: HOME_SECTIONS.protocols.path },
      ],
    },
    {
      title: 'Reference',
      items: [
        { id: 'resources', label: 'Resources', description: 'CTCAE', icon: 'resources', path: HOME_SECTIONS.resources.path },
      ],
    },
  ];

  const headerAlertButtonLabel = enrichedAlerts.length > 0 ? `Urgent (${enrichedAlerts.length})` : 'Urgent';

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
        allAlerts={[]}
        listScope="urgent"
        onClose={() => {
          setChatAlert(null);
          setIsAlertWidgetOpen(false);
        }}
        controlledOpen={isAlertWidgetOpen}
        hideTrigger
        onOpenChange={setIsAlertWidgetOpen}
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
        navSections={navigationSections}
        activeNavId={activeNavId}
        alerts={enrichedAlerts}
        onAlertsClick={handleOpenAlertWorkspace}
        alertButtonLabel={headerAlertButtonLabel}
        alertButtonUrgent={enrichedAlerts.length > 0}
        onHomeClick={() => selectP(null)}
        headerTitle={currentHeaderSection.title}
        headerDescription={currentHeaderSection.description}
        headerContextPills={headerContextPills}
        searchValue={rosterSearchQuery}
        onSearchChange={setRosterSearchQuery}
        searchResults={headerSearchResults}
        onSearchSelect={handleHeaderSearchSelect}
      >
        <div className="dashboard-surface">
          {activeHomeSection === 'today' ? (
            <section id="today" className="dashboard-section">
              <div className="dashboard-section__header">
                <div>
                  <div className="dashboard-kicker">Today</div>
                  <h2 className="dashboard-section__title">Today&apos;s overview</h2>
                  <p className="section-note">
                    Triage urgent work first, then move into patient-specific coordination, ePRO, and intelligence workspaces.
                  </p>
                </div>
              </div>
              <div className="overview-grid">
                <div className="overview-card">
                  <span>Assigned patients</span>
                  <strong>{assignedPatientCount}</strong>
                  <small>CRC-linked roster ready for the current shift</small>
                </div>
                <div className="overview-card">
                  <span>Active safety items</span>
                  <strong>{openIncidentCount}</strong>
                  <small>Open incidents across the current safety workspace</small>
                </div>
                <div className="overview-card">
                  <span>Pending ePRO</span>
                  <strong>{pendingEproCount}</strong>
                  <small>Items still pending in the current loaded ePRO window</small>
                </div>
                <div className="overview-card">
                  <span>Actionable disengagement flags</span>
                  <strong>{actionableDisengagementCount}</strong>
                  <small>Latest published CRC-only prediction summary</small>
                </div>
              </div>

              <div className="dashboard-mainGrid">
                <div className="card workspace-card">
                  <div className="section-header">
                    <div>
                      <h3>Today&apos;s pending work</h3>
                      <div className="section-note">
                        Start with the highest-priority CRC actions before moving into patient-specific workspaces.
                      </div>
                    </div>
                  </div>

                  <div className="today-worklist">
                    {todayPriorityActions.map((item) => (
                      <div
                        key={item.id}
                        className={`today-workitem ${item.tone !== 'default' ? `today-workitem--${item.tone}` : ''}`}
                      >
                        <div className="today-workitem__metric">
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </div>
                        <div className="today-workitem__body">
                          <div className="section-note">{item.note}</div>
                        </div>
                        <button className="btn btn-secondary btn-small" onClick={item.onClick}>
                          {item.actionLabel}
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="info-banner today-focusCard">
                    <div className="section-header section-header--tight">
                      <div>
                        <strong>Current patient focus</strong>
                        <div className="section-note section-note--spaced">
                          {selPatient
                            ? `Pinned patient: ${selPatient.nickname}. Keep this context visible while moving across guidance, protocols, and study coordination.`
                            : 'No patient is pinned yet. Open Patients to select a roster entry and keep their study context visible.'}
                        </div>
                      </div>
                    </div>
                    {selPatient ? (
                      <>
                        <div className="workspace-summary-grid workspace-summary-grid--compact">
                          <div className="workspace-summary-item">
                            <span>Subject ID</span>
                            <strong>{selPatient.subject_id || selPatient.subjectId || 'Not set'}</strong>
                          </div>
                          <div className="workspace-summary-item">
                            <span>Protocol</span>
                            <strong>{selPatient.protocolName || 'Not assigned'}</strong>
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
                        <div className="workspace-actionStrip">
                          <button
                            className="btn btn-secondary"
                            onClick={() => openWorkspaceSection('patients', { panel: 'coordination' })}
                          >
                            Open Study Coordination
                          </button>
                          <button className="btn btn-primary" onClick={() => openWorkspaceSection('side-effect-guidance')}>
                            Open Side Effect Guidance
                          </button>
                          <button className="btn btn-secondary" onClick={() => openWorkspaceSection('protocols')}>
                            Open Protocols
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className={`card workspace-card ${urgentAlerts.length ? 'utility-card--danger' : 'utility-card--calm'}`}>
                  <div className="section-header">
                    <div>
                      <h3>Urgent safety</h3>
                      <div className="section-note">
                        Keep serious patient alerts visible from the Today workspace while triaging next steps.
                      </div>
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
                    <div className="empty-panel">No urgent safety alerts are active right now.</div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {activeHomeSection === 'patients' ? (
            <section id="patients" className="dashboard-section">
              <div className="dashboard-mainGrid">
                <PatientList
                  patients={patients}
                  selectedPatientId={selectedPatientId}
                  onSelect={selectP}
                  countLabel={`${patients.length} loaded`}
                  summaryNote={patientRosterSummaryNote}
                  searchQuery={rosterSearchQuery}
                  onSearchQueryChange={setRosterSearchQuery}
                  showSearchInput={false}
                  currentPage={patientRosterPage}
                  pageSize={patientRosterPageSize}
                  onPageChange={setPatientRosterPage}
                  onPageSizeChange={(value) => {
                    setPatientRosterPageSize(value);
                    setPatientRosterPage(1);
                  }}
                  canGoNextPage={canGoToNextPatientRosterPage}
                  footerContent={
                    canGoToNextPatientRosterPage
                      ? 'More patients may exist beyond the current loaded roster window.'
                      : 'All currently loaded patients fit inside the current roster page window.'
                  }
                />

                <div className="dashboard-column">
                  <div className="card workspace-card">
                    <div className="section-header">
                      <div>
                        <h3>{selPatient ? 'Patient workspace' : 'Choose a patient'}</h3>
                        <div className="section-note">
                          {selPatient
                            ? 'Keep patient context visible while switching between quick handoff and deeper study coordination.'
                            : 'Select a patient from the roster to load CRC handoff, trial assignment, and scheduling context.'}
                        </div>
                      </div>
                    </div>

                    <div className="workspace-tabRow" role="tablist" aria-label="Patient workspace views">
                      <button
                        type="button"
                        className={`workspace-tabButton ${activePatientPanel === 'summary' ? 'workspace-tabButton--active' : ''}`}
                        onClick={() => openWorkspaceSection('patients')}
                      >
                        Overview
                      </button>
                      <button
                        type="button"
                        className={`workspace-tabButton ${activePatientPanel === 'coordination' ? 'workspace-tabButton--active' : ''}`}
                        onClick={() => openWorkspaceSection('patients', { panel: 'coordination' })}
                      >
                        Study Coordination
                      </button>
                    </div>

                    {selPatient ? (
                      <>
                        <div className="workspace-summary-grid workspace-summary-grid--compact">
                          <div className="workspace-summary-item">
                            <span>Subject ID</span>
                            <strong>{selPatient.subject_id || selPatient.subjectId || 'Not set'}</strong>
                          </div>
                          <div className="workspace-summary-item">
                            <span>Primary CRC</span>
                            <strong>{selPatient.primary_crc_name || 'Unassigned'}</strong>
                          </div>
                          <div className="workspace-summary-item">
                            <span>Protocol</span>
                            <strong>{selPatient.protocolName || 'Not assigned'}</strong>
                          </div>
                          <div className="workspace-summary-item">
                            <span>Linked incidents</span>
                            <strong>{selectedPatientIncidentCount}</strong>
                          </div>
                        </div>

                        {activePatientPanel === 'summary' ? (
                          <>
                            <div className="sidebar-patient-context">
                              <div className="sidebar-patient-context__row">
                                <span>Patient</span>
                                <strong>{selPatient.nickname}</strong>
                              </div>
                              <div className="sidebar-patient-context__row">
                                <span>Email</span>
                                <strong>{selPatient.email || 'Not set'}</strong>
                              </div>
                              <div className="sidebar-patient-context__row">
                                <span>Study emergency</span>
                                <strong>{selPatient.study_emergency_phone || 'Not set'}</strong>
                              </div>
                              <div className="sidebar-patient-context__row">
                                <span>Recent vitals</span>
                                <strong>{pVitals.length}</strong>
                              </div>
                            </div>
                            <div className="workspace-actionStrip">
                              <button
                                className="btn btn-secondary"
                                onClick={() => openWorkspaceSection('patients', { panel: 'coordination' })}
                              >
                                Open Study Coordination
                              </button>
                              <button className="btn btn-primary" onClick={() => openWorkspaceSection('side-effect-guidance')}>
                                Open Side Effect Guidance
                              </button>
                              <button className="btn btn-secondary" onClick={() => openWorkspaceSection('protocols')}>
                                Open Protocols
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="info-banner">
                            Study Coordination is active below. Patient context stays pinned here while you edit ownership,
                            subject mapping, protocol assignment, recent vitals, and appointments.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-panel">Select a patient from the roster to open the patient workspace.</div>
                    )}
                  </div>

                  {activePatientPanel === 'coordination' ? (
                    selPatient ? (
                      <>
                        <div className="workspace-two-column">
                          <PatientEditMenu
                            patient={selPatient}
                            email={tempEmail}
                            setEmail={setTempEmail}
                            primaryCrcId={tempPrimaryCrcId}
                            setPrimaryCrcId={setTempPrimaryCrcId}
                            primaryCrcPhone={tempPrimaryCrcPhone}
                            setPrimaryCrcPhone={setTempPrimaryCrcPhone}
                            studyEmergencyPhone={tempStudyEmergencyPhone}
                            setStudyEmergencyPhone={setTempStudyEmergencyPhone}
                            assignedProtocolId={tempProtocolId}
                            setAssignedProtocolId={setTempProtocolId}
                            protocolOptions={protocolTemplates}
                            assignedProtocol={editingProtocolTemplate}
                            subjectId={tempSubjectId}
                            setSubjectId={setTempSubjectId}
                            crcUsers={crcUsers}
                            inheritedVitals={describeInheritedVitals(editingProtocolTemplate?.vital_templates)}
                            dropoutOptions={dropoutTestingSubjects}
                            onSave={handleSaveInfo}
                            onDelete={handleDeletePatient}
                            isSaving={isSaving}
                            successMsg={successMsg}
                            primaryCrcPhoneError={primaryCrcPhoneError}
                            studyEmergencyPhoneError={studyEmergencyPhoneError}
                            disableSave={hasPhoneValidationErrors}
                          />

                          <div className="card workspace-card">
                            <div className="section-header">
                              <div>
                                <h3>Assigned trial summary</h3>
                                <div className="section-note">
                                  Protocol editing now lives in Protocols. This panel keeps the selected patient&apos;s trial context visible.
                                </div>
                              </div>
                              <button className="btn btn-secondary btn-small" onClick={() => openWorkspaceSection('protocols')}>
                                Open Protocols
                              </button>
                            </div>

                            <div className="workspace-summary-grid workspace-summary-grid--compact">
                              <div className="workspace-summary-item">
                                <span>Assigned trial</span>
                                <strong>{editingProtocolTemplate?.name || 'Not assigned'}</strong>
                              </div>
                              <div className="workspace-summary-item">
                                <span>Inherited vitals</span>
                                <strong>{describeInheritedVitals(editingProtocolTemplate?.vital_templates).length || 0}</strong>
                              </div>
                            </div>

                            <div className="patient-config__pillWrap">
                              {describeInheritedVitals(editingProtocolTemplate?.vital_templates).length ? (
                                describeInheritedVitals(editingProtocolTemplate?.vital_templates).map((label) => (
                                  <span key={label} className="metric-pill">
                                    {label}
                                  </span>
                                ))
                              ) : (
                                <div className="section-note">Assign a trial template to preview inherited monitored vitals here.</div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="workspace-two-column">
                          <div className="card workspace-card">
                            <div className="section-header">
                              <div>
                                <h3>Recent vitals</h3>
                                <div className="section-note">
                                  Most recent patient measurements without leaving the selected patient workspace.
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
                                <h3>Appointments</h3>
                                <div className="section-note">
                                  Schedule, inspect AI date suggestions, and complete confirmed visits from one coordination panel.
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
                              <div className="section-header section-header--tight">
                                <strong>{AI_SUGGESTION_TITLE}</strong>
                                <button onClick={handleSuggestDate} disabled={isSuggesting} className="btn btn-secondary btn-small">
                                  {isSuggesting ? 'Thinking...' : 'Suggest date'}
                                </button>
                              </div>
                              {suggestedDate ? (
                                <>
                                  <div className="scheduler-suggestion">Suggested: {new Date(suggestedDate).toLocaleString()}</div>
                                  <div className="section-note section-note--spaced">{suggestedReason}</div>
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
                                    <div className="data-list-card__title">{new Date(appointment.datetime).toLocaleString()}</div>
                                    <div className="data-list-card__status" style={getStatusStyle(appointment.status)}>
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
                      </>
                    ) : (
                      <div className="card workspace-card">
                        <div className="dashboard-kicker">Patient workspace</div>
                        <h2 className="workspace-card__title">Select a patient to begin</h2>
                        <p className="section-note">
                          Choose a patient in the roster to edit CRC assignment, subject mapping, recent vitals, and appointments.
                        </p>
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeHomeSection === 'safety' ? (
          <section id="safety" className="dashboard-section">
            <SafetyInboxPanel
              incidents={incidents}
              alertHistory={safetyHistoryAlerts}
              selectedPatient={selPatient}
              pushState={pushState}
              onEnablePush={handleEnablePush}
              onOpenIncident={handleOpenIncident}
              onOpenAlertThread={handleNavAlertClick}
              initialTab={activeSafetyTab}
              onTabChange={handleSafetyInboxTabChange}
              historyWindowLabel={historyWindowLabel}
              incidentWindowLabel={incidentWindowLabel}
              historySummary={activeHistorySummary}
              incidentSummary={activeIncidentSummary}
              historyPage={historyPage}
              historyPageSize={historyPageSize}
              onHistoryPageChange={setHistoryPage}
              onHistoryPageSizeChange={setHistoryPageSize}
              canGoNextHistory={canGoToNextHistoryPage}
              incidentPage={incidentPage}
              incidentPageSize={incidentPageSize}
              onIncidentPageChange={setIncidentPage}
              onIncidentPageSizeChange={setIncidentPageSize}
              canGoNextIncidents={canGoToNextIncidentPage}
            />
          </section>
          ) : null}

          {activeHomeSection === 'side-effect-guidance' ? (
            <section id="side-effect-guidance" className="dashboard-section">
              <GeminiChatbot
                role="crc"
                userId={user.uid}
                userNickname={crcName}
                patientData={stablePatientData}
                patientVitals={pVitals}
                patientAppointments={pAppts}
                patientAlerts={pAlerts}
                patientEproEntries={selectedPatientEproEntries}
                patientIncidents={selectedPatientIncidents}
                activeProtocolId={selPatient?.protocolId || null}
                protocolUrl={selPatient?.protocolUrl}
                activeProtocolName={selPatient?.protocolName}
                allPatients={patients}
                workspaceAlerts={globalAlerts}
                workspaceUrgentAlerts={urgentAlerts}
                workspaceEproEntries={eproEntries}
                workspaceIncidents={incidents}
                presentation="docked"
                titleOverride="Side Effect Guidance"
                panelDescription="Review symptoms, protocol guidance, CTCAE context, and follow-up actions from one docked CRC workspace."
              />
            </section>
          ) : null}

          {activeHomeSection === 'patient-disengagement' ? (
            <section id="patient-disengagement" className="dashboard-section">
              <DropoutRiskPanel
                patients={patients}
                onOpenPatients={(patient) => openDropoutPatientWorkspace(patient)}
                onOpenStudyCoordination={(patient) => openDropoutPatientWorkspace(patient, 'coordination')}
              />
            </section>
          ) : null}

          {activeHomeSection === 'protocols' ? (
          <section id="protocols" className="dashboard-section">
            <ProtocolManager selectedPatient={selPatient} patients={patients} />
          </section>
          ) : null}

          {activeHomeSection === 'epro' ? (
          <section id="epro" className="dashboard-section">
            <EproReviewWorkspace
              user={user}
              patients={patients}
              entries={eproEntries}
              entryWindowLabel={eproWindowLabel}
              entriesPage={eproEntriesPage}
              entriesPageSize={eproEntriesPageSize}
              onEntriesPageChange={setEproEntriesPage}
              onEntriesPageSizeChange={(value) => {
                setEproEntriesPageSize(value);
                setEproEntriesPage(1);
              }}
              canGoNextEntries={canGoToNextEproPage}
            />
          </section>
          ) : null}

          {activeHomeSection === 'resources' ? (
          <section id="resources" className="dashboard-section">
            <div className="workspace-two-column">
              <div className="card workspace-card">
                <div className="section-header">
                  <div>
                    <h3>CTCAE quick access</h3>
                    <div className="section-note">Open the core toxicity guidance without leaving the CRC workspace.</div>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={() => handleOpenClinicalResource('CTCAE.pdf')}>
                  Open CTCAE PDF
                </button>
              </div>

              <div className="card workspace-card">
                <div className="section-header">
                  <div>
                    <h3>Active protocol</h3>
                    <div className="section-note">
                      {selPatient?.protocolUrl
                        ? 'Open the currently assigned protocol PDF for the selected patient.'
                        : 'Select a patient with an assigned protocol to open it here.'}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleOpenClinicalResource(selPatient.protocolUrl, 'protocol')}
                  disabled={!selPatient?.protocolUrl}
                >
                  Open assigned protocol
                </button>
              </div>
            </div>
          </section>
          ) : null}
        </div>
      </CRCWorkspaceShell>
    </>
  );
}
