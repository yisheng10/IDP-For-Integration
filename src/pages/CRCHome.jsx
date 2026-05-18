import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { useLocation, useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import CRCWorkspaceShell from '../components/CRCWorkspaceShell';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import IncidentDetailModal from '../components/IncidentDetailModal';
import PatientConversationTimeline from '../components/PatientConversationTimeline';
import ProtocolManager from '../components/ProtocolManager';
import PatientList from '../components/PatientList';
import PatientEditMenu from '../components/PatientEditMenu';
import PatientNotesPanel from '../components/PatientNotesPanel';
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
  fetchCrcUrgentIncidentSummary,
  fetchIncidentSummary,
  fetchPatientRosterSummary,
} from '../services/crcSummaryService';
import {
  fetchDropoutDashboardSummary,
  fetchDropoutTestingSubjects,
  validateDropoutSubjectMapping,
} from '../services/dropoutService';
import { getProtocolStaticContextStatus } from '../services/protocolStaticContextService';
import { normalizeDropoutTrialId } from '../services/dropoutTrialRegistryService';
import { subscribeToIncidentRecords } from '../services/incidentService';
import { purgePatientRecord } from '../services/patientAdminService';
import { getSignedUrl } from '../services/storageService';
import {
  buildFallbackMonitoredVitals,
  describeInheritedVitals,
  subscribeToTrialTemplates,
} from '../services/trialTemplateService';

const AI_SUGGESTION_TITLE = 'AI Scheduler';
const MAX_PATIENT_ROSTER_LIMIT = 60;
const CRC_ROSTER_LIMIT = 80;
const MAX_GLOBAL_ALERT_LIMIT = 30;
const MAX_GLOBAL_EPRO_LIMIT = 30;
const MAX_GLOBAL_INCIDENT_LIMIT = 30;
const DEFAULT_WINDOW_PAGE_SIZE = 30;
const PATIENT_WORKSPACE_TABS = ['overview', 'vitals', 'safety', 'epro', 'notes', 'coordination'];
const GUIDANCE_PANE_STORAGE_KEY = 'crc-adverse-event-guidance-left-pane-width';
const DEFAULT_GUIDANCE_LEFT_PANE_WIDTH = 56;
const MIN_GUIDANCE_LEFT_PANE_WIDTH = 32;
const MAX_GUIDANCE_LEFT_PANE_WIDTH = 68;
const GUIDANCE_STACKED_BREAKPOINT = 1240;

function buildDefaultDropoutTrialSupportStatus(trialId = '') {
  const normalizedTrialId = normalizeDropoutTrialId(trialId);
  if (!normalizedTrialId) {
    return {
      trial_id: '',
      status: 'not_configured',
      status_label: 'Not configured',
      message: 'No disengagement dataset trial ID is configured for this protocol yet.',
      registry: null,
      metadata: null,
      source: 'none',
    };
  }

  return {
    trial_id: normalizedTrialId,
    status: 'loading',
    status_label: 'Checking trial support',
    message: `Checking whether ${normalizedTrialId} is supported by the canonical dropout registry...`,
    registry: null,
    metadata: null,
    source: 'none',
  };
}

function clampGuidancePaneWidth(nextWidth, containerWidth = 0) {
  const minWidthFromPixels = containerWidth ? Math.ceil((360 / containerWidth) * 100) : MIN_GUIDANCE_LEFT_PANE_WIDTH;
  const maxWidthFromPixels = containerWidth ? Math.floor(((containerWidth - 420) / containerWidth) * 100) : MAX_GUIDANCE_LEFT_PANE_WIDTH;
  const minWidth = Math.max(MIN_GUIDANCE_LEFT_PANE_WIDTH, minWidthFromPixels);
  const maxWidth = Math.min(MAX_GUIDANCE_LEFT_PANE_WIDTH, maxWidthFromPixels);
  const safeMaxWidth = Math.max(minWidth, maxWidth);
  return Math.min(safeMaxWidth, Math.max(minWidth, nextWidth));
}

function normalizeIncidentText(value) {
  return String(value || '').trim().toLowerCase();
}

function isUnresolvedIncident(incident) {
  return ['open', 'acknowledged'].includes(normalizeIncidentText(incident?.status));
}

function isAbnormalVitalIncident(incident) {
  const incidentType = normalizeIncidentText(incident?.incident_type);
  const latestSourceSystem = normalizeIncidentText(incident?.latest_source_system);
  const eventTitle = normalizeIncidentText(incident?.event_title || incident?.reason);

  return (
    incidentType === 'vital_monitor' ||
    latestSourceSystem === 'patient_vitals_auto_monitor' ||
    eventTitle.includes('critical vitals') ||
    eventTitle.includes('abnormal vitals')
  );
}

function isCrcActionableAdverseEvent(incident) {
  if (isAbnormalVitalIncident(incident)) return false;

  const severity = normalizeIncidentText(incident?.severity);
  const urgency = normalizeIncidentText(incident?.urgency);
  const incidentType = normalizeIncidentText(incident?.incident_type);

  return (
    incidentType === 'side_effect' ||
    incidentType === 'emergency' ||
    Boolean(incident?.immediate_help_requested) ||
    severity === 'serious' ||
    ['urgent', 'immediate', 'critical'].includes(urgency)
  );
}

function isHeaderUrgentIncident(incident) {
  return (
    isUnresolvedIncident(incident) &&
    (isAbnormalVitalIncident(incident) || isCrcActionableAdverseEvent(incident))
  );
}

function isHospitalEmailAddress(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .endsWith('@hospital.com');
}

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
    label: 'Adverse Event Guidance',
    path: '/home?section=side-effect-guidance',
    title: 'Adverse Event Guidance',
    description: 'Review patient context, protocol grounding, and CTCAE support from one dedicated CRC adverse event workspace.',
  },
  'patient-disengagement': {
    label: 'Patient Disengagement Prediction',
    path: '/home?section=patient-disengagement',
    title: 'Patient Disengagement Prediction',
    description: 'CRC-only mode for continuous risk monitoring, intervention case management, and explainability.',
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

const PATIENT_SEARCH_SECTIONS = ['today', 'patients', 'side-effect-guidance', 'patient-disengagement', 'epro'];
const PROTOCOL_CONTEXT_SECTIONS = ['patients', 'side-effect-guidance', 'protocols', 'resources'];
const INCIDENT_MONITOR_SECTIONS = ['today', 'patients', 'safety', 'side-effect-guidance'];
const EPRO_WINDOW_SECTIONS = ['today', 'patients', 'side-effect-guidance', 'epro'];

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
  const [subjectIdError, setSubjectIdError] = useState('');
  const [subjectMappingStatus, setSubjectMappingStatus] = useState('unmapped');
  const [subjectMappingStatusNote, setSubjectMappingStatusNote] = useState('');
  const [isSubjectMappingStatusPending, setIsSubjectMappingStatusPending] = useState(false);
  const [protocolTemplates, setProtocolTemplates] = useState([]);
  const [dropoutTestingSubjects, setDropoutTestingSubjects] = useState([]);
  const [currentDropoutTrialSupportStatus, setCurrentDropoutTrialSupportStatus] = useState(() =>
    buildDefaultDropoutTrialSupportStatus('')
  );
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
  const [globalUrgentIncidentSummary, setGlobalUrgentIncidentSummary] = useState(null);
  const [selectedIncidentSummary, setSelectedIncidentSummary] = useState(null);
  const [disengagementSummary, setDisengagementSummary] = useState(null);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [guidanceViewportWidth, setGuidanceViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  const [guidanceLeftPaneWidth, setGuidanceLeftPaneWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_GUIDANCE_LEFT_PANE_WIDTH;
    }

    const persistedValue = Number(window.localStorage.getItem(GUIDANCE_PANE_STORAGE_KEY));
    return Number.isFinite(persistedValue)
      ? clampGuidancePaneWidth(persistedValue)
      : DEFAULT_GUIDANCE_LEFT_PANE_WIDTH;
  });

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

  const activeHomeSection = useMemo(() => {
    const sectionId = searchParams.get('section') || 'today';
    return HOME_SECTIONS[sectionId] ? sectionId : 'today';
  }, [searchParams]);
  const activePatientId = useMemo(() => {
    if (activeHomeSection !== 'patients') return '';
    return searchParams.get('patient') || '';
  }, [activeHomeSection, searchParams]);
  const activePatientTab = useMemo(() => {
    if (activeHomeSection !== 'patients') return 'overview';
    const rawTab = searchParams.get('tab') || 'overview';
    return PATIENT_WORKSPACE_TABS.includes(rawTab) ? rawTab : 'overview';
  }, [activeHomeSection, searchParams]);
  const activeSafetyTab = useMemo(() => {
    if (activeHomeSection !== 'safety') return 'open';
    const tabId = searchParams.get('tab');
    return ['open', 'resolved', 'history'].includes(tabId) ? tabId : 'open';
  }, [activeHomeSection, searchParams]);
  const activeNavId = activeHomeSection;
  const isPatientWorkspaceOpen = activeHomeSection === 'patients' && Boolean(selPatient);

  const shouldLoadPatientRoster = PATIENT_SEARCH_SECTIONS.includes(activeHomeSection) || Boolean(activePatientId);
  const shouldLoadCrcUsers = activeHomeSection === 'patients';
  const shouldLoadProtocols = PROTOCOL_CONTEXT_SECTIONS.includes(activeHomeSection);
  const shouldLoadPatientRosterSummary = ['today', 'patients'].includes(activeHomeSection);
  const shouldLoadDisengagementSummary = ['today', 'patient-disengagement'].includes(activeHomeSection);
  const shouldLoadSelectedPatientSummaries =
    Boolean(selPatient?.id) && ['patients', 'side-effect-guidance'].includes(activeHomeSection);
  const shouldLoadDropoutTestingSubjects =
    activeHomeSection === 'patients' && activePatientTab === 'coordination' && Boolean(selPatient);
  const shouldLoadUrgentAlertThreads = activeHomeSection === 'side-effect-guidance' || isAlertWidgetOpen;
  const shouldLoadGlobalAlertHistory = activeHomeSection === 'safety';
  const shouldLoadGlobalEproWindow = EPRO_WINDOW_SECTIONS.includes(activeHomeSection);
  const shouldLoadIncidentWindow = INCIDENT_MONITOR_SECTIONS.includes(activeHomeSection);
  const shouldLoadSelectedPatientDetail =
    Boolean(selectedPatientId) && ['patients', 'side-effect-guidance'].includes(activeHomeSection);

  const prevAlertCountRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const foregroundNotificationRef = useRef(new Set());
  const guidanceWorkspaceRef = useRef(null);
  const guidanceResizeActiveRef = useRef(false);

  useEffect(() => {
    getDoc(doc(db, 'users', user.uid)).then((snapshot) => {
      if (snapshot.exists()) {
        setCrcName(snapshot.data().nickname || 'CRC');
      }
    });
  }, [user]);

  useEffect(() => {
    const handleResize = () => {
      setGuidanceViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      GUIDANCE_PANE_STORAGE_KEY,
      String(guidanceLeftPaneWidth)
    );
  }, [guidanceLeftPaneWidth]);

  const isGuidanceStacked = guidanceViewportWidth < GUIDANCE_STACKED_BREAKPOINT;

  const handleGuidanceResizeStart = useCallback((event) => {
    if (isGuidanceStacked) {
      return;
    }

    event.preventDefault();
    guidanceResizeActiveRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isGuidanceStacked]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      if (!guidanceResizeActiveRef.current || !guidanceWorkspaceRef.current || isGuidanceStacked) {
        return;
      }

      const bounds = guidanceWorkspaceRef.current.getBoundingClientRect();
      if (!bounds.width) {
        return;
      }

      const nextWidth = ((event.clientX - bounds.left) / bounds.width) * 100;
      setGuidanceLeftPaneWidth(clampGuidancePaneWidth(nextWidth, bounds.width));
    };

    const handlePointerUp = () => {
      if (!guidanceResizeActiveRef.current) {
        return;
      }

      guidanceResizeActiveRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isGuidanceStacked]);

  useEffect(() => {
    if (!shouldLoadPatientRosterSummary) {
      return undefined;
    }

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
  }, [shouldLoadPatientRosterSummary, user.uid]);

  useEffect(() => {
    if (!shouldLoadPatientRosterSummary) {
      return undefined;
    }

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
  }, [shouldLoadPatientRosterSummary]);

  useEffect(() => {
    let cancelled = false;

    async function loadUrgentIncidentSummary() {
      try {
        const payload = await fetchCrcUrgentIncidentSummary();
        if (!cancelled) {
          setGlobalUrgentIncidentSummary(payload);
        }
      } catch (error) {
        console.error('Failed to load urgent incident summary:', error);
        if (!cancelled) {
          setGlobalUrgentIncidentSummary(null);
        }
      }
    }

    loadUrgentIncidentSummary();
    return () => {
      cancelled = true;
    };
  }, [activeHomeSection]);

  useEffect(() => {
    if (!shouldLoadDisengagementSummary) {
      return undefined;
    }

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
  }, [shouldLoadDisengagementSummary]);

  useEffect(() => {
    if (!shouldLoadSelectedPatientSummaries || !selPatient?.id) {
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
  }, [selPatient?.id, shouldLoadSelectedPatientSummaries]);

  useEffect(() => {
    if (!shouldLoadPatientRoster) {
      return undefined;
    }

    const patientsQuery = query(collection(db, 'users'), limit(patientRosterLimit));
    const unsubscribe = onSnapshot(
      patientsQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((entry) => {
            const data = entry.data();
            return {
              id: entry.id,
              ...data,
              protocolId: data.protocolId || data.protocol_id || null,
              protocolName: data.protocolName || data.protocol_name || data.protocol || null,
              protocolUrl: data.protocolUrl || data.protocol_url || null,
              dropout_trial_id: data.dropout_trial_id || data.dropoutTrialId || null,
              primary_crc_id: data.primary_crc_id || data.primaryCrcId || null,
              primaryCrcId: data.primaryCrcId || data.primary_crc_id || null,
              study_emergency_phone: data.study_emergency_phone || data.studyEmergencyPhone || null,
              subject_id: data.subject_id || data.subjectId || null,
            };
          })
          .filter((entry) => {
            const role = String(entry.role || '').trim().toLowerCase();
            if (role === 'patient') return true;
            if (role === 'crc') return false;
            return !isHospitalEmailAddress(entry.email);
          })
          .sort((left, right) => {
            const leftLabel = String(left.nickname || left.email || left.id || '').toLowerCase();
            const rightLabel = String(right.nickname || right.email || right.id || '').toLowerCase();
            return leftLabel.localeCompare(rightLabel);
          });
        setPatients(rows);
      },
      (error) => {
        console.error('Patient roster subscription failed:', error);
        setPatients([]);
      }
    );
    return () => unsubscribe();
  }, [patientRosterLimit, shouldLoadPatientRoster]);

  useEffect(() => {
    if (!shouldLoadCrcUsers) {
      return undefined;
    }

    const crcQuery = query(collection(db, 'users'), limit(CRC_ROSTER_LIMIT));
    const unsubscribe = onSnapshot(
      crcQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((entry) => {
            const data = entry.data();
            return {
              id: entry.id,
              ...data,
              primary_crc_id: data.primary_crc_id || data.primaryCrcId || null,
              primaryCrcId: data.primaryCrcId || data.primary_crc_id || null,
            };
          })
          .filter((entry) => {
            const role = String(entry.role || '').trim().toLowerCase();
            if (role === 'crc') return true;
            if (role === 'patient') return false;
            return isHospitalEmailAddress(entry.email);
          })
          .sort((left, right) => {
            const leftLabel = String(left.nickname || left.email || left.id || '').toLowerCase();
            const rightLabel = String(right.nickname || right.email || right.id || '').toLowerCase();
            return leftLabel.localeCompare(rightLabel);
          });
        setCrcUsers(rows);
      },
      (error) => {
        console.error('CRC roster subscription failed:', error);
        setCrcUsers([]);
      }
    );
    return () => unsubscribe();
  }, [shouldLoadCrcUsers]);

  useEffect(() => {
    if (!shouldLoadProtocols) {
      return undefined;
    }

    const unsubscribe = subscribeToTrialTemplates((rows) => {
      setProtocolTemplates(rows);
    });
    return () => unsubscribe();
  }, [shouldLoadProtocols]);

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
  const selectedProtocolFilePath = useMemo(
    () =>
      String(
        selPatient?.protocolUrl ||
          selectedProtocolTemplate?.storagePath ||
          selectedProtocolTemplate?.protocolUrl ||
          ''
      ).trim(),
    [selPatient?.protocolUrl, selectedProtocolTemplate]
  );

  const editingProtocolTemplate = useMemo(() => {
    if (!tempProtocolId) return null;
    return protocolTemplates.find((template) => template.id === tempProtocolId) || null;
  }, [protocolTemplates, tempProtocolId]);
  const currentProtocolTemplateForDisengagement = useMemo(
    () => editingProtocolTemplate || selectedProtocolTemplate || null,
    [editingProtocolTemplate, selectedProtocolTemplate]
  );
  const currentProtocolStaticContextStatus = useMemo(
    () => getProtocolStaticContextStatus(currentProtocolTemplateForDisengagement),
    [currentProtocolTemplateForDisengagement]
  );

  const currentDropoutTrialId = useMemo(
    () =>
      String(
        editingProtocolTemplate?.dropout_trial_id ||
          selectedProtocolTemplate?.dropout_trial_id ||
          selPatient?.dropout_trial_id ||
          selPatient?.dropoutTrialId ||
          ''
      ).trim(),
    [editingProtocolTemplate, selectedProtocolTemplate, selPatient]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadTestingSubjects() {
      if (!shouldLoadDropoutTestingSubjects || !selPatient) {
        setDropoutTestingSubjects([]);
        setCurrentDropoutTrialSupportStatus(buildDefaultDropoutTrialSupportStatus(''));
        return;
      }

      if (currentProtocolTemplateForDisengagement && !currentProtocolStaticContextStatus.ready) {
        setDropoutTestingSubjects([]);
        setCurrentDropoutTrialSupportStatus({
          ...buildDefaultDropoutTrialSupportStatus(currentDropoutTrialId),
          trial_id: normalizeDropoutTrialId(currentDropoutTrialId),
          status: currentProtocolStaticContextStatus.status,
          status_label: currentProtocolStaticContextStatus.label,
          message: currentProtocolStaticContextStatus.message,
          registry: null,
          metadata: null,
          source: 'protocol_static_context',
        });
        return;
      }

      if (!currentDropoutTrialId) {
        setDropoutTestingSubjects([]);
        setCurrentDropoutTrialSupportStatus(buildDefaultDropoutTrialSupportStatus(''));
        return;
      }

      setCurrentDropoutTrialSupportStatus(buildDefaultDropoutTrialSupportStatus(currentDropoutTrialId));
      try {
        const payload = await fetchDropoutTestingSubjects({
          trialId: currentDropoutTrialId,
          limit: 120,
        });
        if (!cancelled) {
          setDropoutTestingSubjects(payload.subjects || []);
          setCurrentDropoutTrialSupportStatus(
            payload.supportStatus || buildDefaultDropoutTrialSupportStatus(currentDropoutTrialId)
          );
        }
      } catch (error) {
        console.error('Failed to load subject ID options:', error);
        if (!cancelled) {
          setDropoutTestingSubjects([]);
          setCurrentDropoutTrialSupportStatus({
            ...buildDefaultDropoutTrialSupportStatus(currentDropoutTrialId),
            status: 'sync_failed',
            status_label: 'Sync failed',
            message:
              error?.message ||
              `The canonical Subject ID pool for ${normalizeDropoutTrialId(currentDropoutTrialId)} could not be loaded.`,
          });
        }
      }
    }

    loadTestingSubjects();
    return () => {
      cancelled = true;
    };
  }, [
    currentDropoutTrialId,
    currentProtocolStaticContextStatus.label,
    currentProtocolStaticContextStatus.message,
    currentProtocolStaticContextStatus.ready,
    currentProtocolStaticContextStatus.status,
    currentProtocolTemplateForDisengagement,
    selPatient,
    shouldLoadDropoutTestingSubjects,
  ]);

  useEffect(() => {
    if (!shouldLoadUrgentAlertThreads) {
      return undefined;
    }

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
    }, (error) => {
      console.error('Urgent alert subscription failed:', error);
      setUrgentAlerts([]);
    });

    return () => {
      unsubscribeActive();
    };
  }, [shouldLoadUrgentAlertThreads]);

  useEffect(() => {
    if (!shouldLoadGlobalAlertHistory) {
      return undefined;
    }

    const unsubscribeGlobal = subscribeToRecentAlertsGlobal((rows) => {
      setGlobalAlerts(rows);
    }, globalAlertLimit);

    return () => {
      unsubscribeGlobal();
    };
  }, [globalAlertLimit, shouldLoadGlobalAlertHistory]);

  useEffect(() => {
    if (!shouldLoadGlobalEproWindow) {
      return undefined;
    }

    const eproQuery = query(
      collectionGroup(db, 'epro_submissions'),
      limit(globalEproLimit)
    );
    const unsubscribe = onSnapshot(
      eproQuery,
      (snapshot) => {
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
      },
      (error) => {
        console.error('Mirrored ePRO subscription failed:', error);
        setEproEntries([]);
      }
    );
    return () => unsubscribe();
  }, [globalEproLimit, shouldLoadGlobalEproWindow]);

  useEffect(() => {
    if (!shouldLoadIncidentWindow) {
      return undefined;
    }

    let isFirstIncidentLoad = true;
    const requestedIncidentId = searchParams.get('incident');
    const unsubscribe = subscribeToIncidentRecords(
      (records) => {
        setIncidents(records);

        if (isFirstIncidentLoad) {
          records.forEach((incident) => {
            foregroundNotificationRef.current.add(`${incident.id}:${incident.updated_at}`);
          });
          isFirstIncidentLoad = false;
        } else {
          records.forEach((incident) => {
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
          const matched = records.find((incident) => incident.id === requestedIncidentId);
          if (matched) setActiveIncident(matched);
        }
      },
      (error) => console.error('Incident subscription failed:', error),
      { limitCount: incidentWindowLimit }
    );
    return () => unsubscribe();
  }, [incidentWindowLimit, searchParams, shouldLoadIncidentWindow, user.uid]);

  useEffect(() => {
    if (!shouldLoadSelectedPatientDetail || !selectedPatientId) {
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
  }, [globalAlertLimit, selectedPatientId, shouldLoadSelectedPatientDetail]);

  const selectP = useCallback((patient) => {
    if (!patient) {
      setSelectedPatientId(null);
      setSelPatient(null);
      setTempEmail('');
      setTempPrimaryCrcId('');
      setTempPrimaryCrcPhone('');
      setTempStudyEmergencyPhone('');
      setTempProtocolId('');
      setTempSubjectId('');
      setSubjectIdError('');
      setSubjectMappingStatus('unmapped');
      setSubjectMappingStatusNote('');
      setIsSubjectMappingStatusPending(false);
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
    setSubjectIdError('');
    setSubjectMappingStatus('unmapped');
    setSubjectMappingStatusNote('');
    setIsSubjectMappingStatusPending(false);
    setSuggestedDate('');
    setSuggestedReason('');
    setSuccessMsg('');
    purgeOldAppointments(patient.id);
  }, [user.uid]);

  useEffect(() => {
    if (!selectedPatientId) return;
    setTempProtocolId(selPatient?.protocolId || '');
  }, [selectedPatientId, selPatient?.protocolId]);

  useEffect(() => {
    setSubjectIdError('');
  }, [selectedPatientId, tempProtocolId, tempSubjectId]);

  useEffect(() => {
    let cancelled = false;

    async function validateActiveSubjectMapping() {
      const normalizedSubjectId = String(tempSubjectId || '').trim();

      if (activeHomeSection !== 'patients' || activePatientTab !== 'coordination' || !selPatient?.id) {
        setIsSubjectMappingStatusPending(false);
        return;
      }

      if (!normalizedSubjectId) {
        setSubjectMappingStatus('unmapped');
        setSubjectMappingStatusNote(
          'No canonical subject is mapped. This patient will stay out of CRC-only disengagement prediction until a valid Subject ID is assigned.'
        );
        setIsSubjectMappingStatusPending(false);
        return;
      }

      if (currentProtocolTemplateForDisengagement && !currentProtocolStaticContextStatus.ready) {
        setSubjectMappingStatus('invalid');
        setSubjectMappingStatusNote(
          currentProtocolStaticContextStatus.message ||
            'The current protocol has not finished strict disengagement static-context extraction yet.'
        );
        setIsSubjectMappingStatusPending(false);
        return;
      }

      if (!currentDropoutTrialId) {
        setSubjectMappingStatus('invalid');
        setSubjectMappingStatusNote(
          'Assign a clinical protocol with a configured dropout trial ID before keeping a mapped Subject ID.'
        );
        setIsSubjectMappingStatusPending(false);
        return;
      }

      if (currentDropoutTrialSupportStatus.status !== 'configured') {
        setSubjectMappingStatus('invalid');
        setSubjectMappingStatusNote(
          currentDropoutTrialSupportStatus.message ||
            'The current protocol does not have a verified disengagement trial configuration yet.'
        );
        setIsSubjectMappingStatusPending(false);
        return;
      }

      setIsSubjectMappingStatusPending(true);
      try {
        await validateDropoutSubjectMapping({
          subjectId: normalizedSubjectId,
          trialId: currentDropoutTrialId,
          currentPatientId: selPatient.id,
        });
        if (cancelled) return;
        setSubjectMappingStatus('mapped');
        setSubjectMappingStatusNote(
          'This patient is mapped to one canonical dropout subject in the current trial pool.'
        );
      } catch (error) {
        if (cancelled) return;
        setSubjectMappingStatus('invalid');
        setSubjectMappingStatusNote(
          error?.message ||
            'This mapped Subject ID is not valid for the current trial or is already assigned to another patient.'
        );
      } finally {
        if (!cancelled) {
          setIsSubjectMappingStatusPending(false);
        }
      }
    }

    validateActiveSubjectMapping();
    return () => {
      cancelled = true;
    };
  }, [
    activeHomeSection,
    activePatientTab,
    currentDropoutTrialId,
    currentProtocolStaticContextStatus.message,
    currentProtocolStaticContextStatus.ready,
    currentProtocolTemplateForDisengagement,
    currentDropoutTrialSupportStatus.message,
    currentDropoutTrialSupportStatus.status,
    selPatient?.id,
    tempSubjectId,
  ]);

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
    if (!selectedProtocolFilePath) {
      setSuggestedReason('No protocol assigned.');
      return;
    }

    setIsSuggesting(true);
    setSuggestedReason(`Reading ${selPatient.protocolName}...`);
    setSuggestedDate('');
    try {
      const result = await suggestAppointmentDate(selectedProtocolFilePath, pAppts);
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
    setSubjectIdError('');
    try {
      const assignedCrc = crcUsers.find((entry) => entry.id === tempPrimaryCrcId);
      const assignedProtocol = protocolTemplates.find((entry) => entry.id === tempProtocolId) || null;
      const assignedDropoutTrialId = String(assignedProtocol?.dropout_trial_id || '').trim();
      const assignedDropoutTrialStatus = String(assignedProtocol?.dropout_trial_status || '').trim() || 'not_configured';
      const assignedProtocolStaticContextStatus = getProtocolStaticContextStatus(assignedProtocol);
      const protocolIsFullyConfigured = Boolean(
        assignedProtocol &&
          assignedProtocolStaticContextStatus.ready &&
          assignedDropoutTrialId &&
          assignedDropoutTrialStatus === 'configured'
      );
      const inheritedMonitoredVitals = assignedProtocol
        ? buildFallbackMonitoredVitals(assignedProtocol.vital_templates || [])
        : [];
      const currentSubjectId = String(
        selPatient.subject_id || selPatient.subjectId || selPatient.dropout_subject_id || selPatient.dropoutSubjectId || ''
      ).trim();
      const currentTrialId = normalizeDropoutTrialId(selPatient.dropout_trial_id || selPatient.dropoutTrialId || '');
      const nextTrialId = normalizeDropoutTrialId(assignedDropoutTrialId);
      let nextSubjectId = String(tempSubjectId || '').trim();
      let subjectMappingAutoCleared = false;

      if (assignedProtocol && !protocolIsFullyConfigured) {
        throw new Error(
          assignedProtocolStaticContextStatus.ready
            ? 'This protocol cannot be assigned yet because its disengagement dataset trial binding is not fully configured.'
            : assignedProtocolStaticContextStatus.message ||
                'This protocol has not finished strict disengagement static-context extraction yet.'
        );
      }

      if (!assignedProtocol && nextSubjectId) {
        nextSubjectId = '';
        subjectMappingAutoCleared = true;
      } else if (assignedProtocol && currentSubjectId && currentTrialId !== nextTrialId && nextSubjectId === currentSubjectId) {
        nextSubjectId = '';
        subjectMappingAutoCleared = true;
      }

      if (nextSubjectId) {
        await validateDropoutSubjectMapping({
          subjectId: nextSubjectId,
          trialId: assignedDropoutTrialId,
          currentPatientId: selPatient.id,
        });
      }
      await updateDoc(doc(db, 'users', selPatient.id), {
        email: tempEmail,
        primary_crc_id: tempPrimaryCrcId || null,
        primary_crc_name: assignedCrc?.nickname || assignedCrc?.email || null,
        primary_crc_phone: tempPrimaryCrcPhone || null,
        study_emergency_phone: tempStudyEmergencyPhone || null,
        protocolId: assignedProtocol?.id || null,
        protocolName: assignedProtocol?.name || null,
        dropout_trial_id: assignedDropoutTrialId || null,
        dropout_trial_label: assignedProtocol?.dropout_trial_label || assignedDropoutTrialId || null,
        dropout_trial_status: assignedDropoutTrialStatus,
        dropout_trial_pool_size: Number(assignedProtocol?.dropout_trial_pool_size) || null,
        dropout_trial_model_version: assignedProtocol?.dropout_trial_model_version || null,
        dropout_trial_last_verified_at: assignedProtocol?.dropout_trial_last_verified_at || null,
        dropout_trial_last_synced_at: assignedProtocol?.dropout_trial_last_synced_at || null,
        protocolUrl: assignedProtocol?.storagePath || null,
        protocolStatus: assignedProtocol ? 'active' : null,
        protocolAssignedAt: assignedProtocol ? new Date().toISOString() : null,
        monitoredVitals: inheritedMonitoredVitals,
        subject_id: nextSubjectId || null,
      });
      setTempSubjectId(nextSubjectId);
      setSuccessMsg(
        nextSubjectId
          ? 'Saved patient ownership, trial assignment, emergency contact, and subject ID mapping.'
          : subjectMappingAutoCleared
            ? 'Saved patient ownership, trial assignment, and emergency contacts. The old Subject ID mapping was cleared because it no longer matches the current disengagement trial pool.'
            : 'Saved patient ownership, trial assignment, and emergency contacts. This patient will stay out of CRC-only disengagement prediction until a canonical Subject ID is mapped again.'
      );
      window.setTimeout(() => setSuccessMsg(''), 3000);
    } catch (error) {
      if (String(error.code || '').startsWith('subject_mapping_')) {
        setSubjectIdError(error.message || 'Unable to validate the mapped Subject ID.');
      }
      window.alert(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePatient = async () => {
    if (!selPatient?.id) {
      return;
    }

    try {
      const purgeResult = await purgePatientRecord(selPatient.id);
      const patientLabel = purgeResult?.patientName || selPatient.nickname || selPatient.email || selPatient.id;
      setToastMsg(`Purged patient record for ${patientLabel}.`);
      window.setTimeout(() => setToastMsg(null), 3200);
      if (Array.isArray(purgeResult?.warnings) && purgeResult.warnings.length) {
        window.alert(
          `Patient data was purged, but there were follow-up warnings:\n\n${purgeResult.warnings.join('\n')}`
        );
      }
      selectP(null);
      openWorkspaceSection('patients', { patientId: null });
    } catch (error) {
      window.alert(error.message || 'Unable to delete this patient record right now.');
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

  const derivedAssignedPatientCount = patients.filter(
    (patient) => (patient.primary_crc_id || patient.primaryCrcId || '') === user.uid
  ).length;
  const totalPatientCount = Number.isFinite(Number(patientRosterSummary?.totalPatients))
    ? Math.max(Number(patientRosterSummary.totalPatients), patients.length)
    : patients.length;
  const assignedPatientCount = Number.isFinite(Number(patientRosterSummary?.assignedPatients))
    ? Math.max(Number(patientRosterSummary.assignedPatients), derivedAssignedPatientCount)
    : derivedAssignedPatientCount;
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
  const pendingEproCount = useMemo(
    () => eproEntries.filter((entry) => String(entry?.status || '').toLowerCase() !== 'submitted').length,
    [eproEntries]
  );
  const actionableDisengagementCount = Number.isFinite(Number(disengagementSummary?.actionable_count))
    ? Math.max(Number(disengagementSummary.actionable_count), 0)
    : 0;
  const scoredDisengagementCount = Number.isFinite(Number(disengagementSummary?.scored_count))
    ? Math.max(Number(disengagementSummary.scored_count), 0)
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
  const selectedPatientAlertCount = selectedAlertSummary?.activeAlerts ?? pAlerts.length;
  const inheritedVitalsPreview = useMemo(
    () => describeInheritedVitals(editingProtocolTemplate?.vital_templates),
    [editingProtocolTemplate]
  );
  const selectedProtocolName = editingProtocolTemplate?.name || selPatient?.protocolName || 'Not assigned';
  const coordinationVitalsPreview = useMemo(() => pVitals.slice(0, 5), [pVitals]);
  const coordinationAppointmentsPreview = useMemo(() => pAppts.slice(0, 5), [pAppts]);
  const currentCrcDisplayName = crcName || user.email || 'CRC';

  const patientRosterRows = useMemo(() => {
    const incidentCounts = new Map();
    const pendingEproCounts = new Map();

    incidents.forEach((incident) => {
      const linkedIds = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids : [];
      if (incident.status === 'resolved') return;
      linkedIds.forEach((patientId) => {
        incidentCounts.set(patientId, (incidentCounts.get(patientId) || 0) + 1);
      });
    });

    eproEntries.forEach((entry) => {
      if (!entry?.uid) return;
      if (String(entry.status || '').toLowerCase() === 'submitted') return;
      pendingEproCounts.set(entry.uid, (pendingEproCounts.get(entry.uid) || 0) + 1);
    });

    return patients.map((patient) => {
      const patientId = patient.id;
      const openIncidentCount = incidentCounts.get(patientId) || 0;
      const pendingPatientEproCount = pendingEproCounts.get(patientId) || 0;
      const hasSubjectMap = Boolean(String(patient.subject_id || patient.subjectId || '').trim());
      const hasProtocol = Boolean(String(patient.protocolName || patient.protocolId || '').trim());
      const hasAssignedCrc = Boolean(String(patient.primary_crc_id || patient.primaryCrcId || '').trim());

      let workflowStatus = 'Stable';
      let workflowTone = 'success';
      let nextTask = 'No immediate action';

      if (openIncidentCount > 0) {
        workflowStatus = 'Safety review';
        workflowTone = 'danger';
        nextTask = openIncidentCount === 1 ? 'Review open incident' : `Review ${openIncidentCount} open incidents`;
      } else if (pendingPatientEproCount > 0) {
        workflowStatus = 'ePRO pending';
        workflowTone = 'warning';
        nextTask = pendingPatientEproCount === 1 ? 'Review patient ePRO' : `Review ${pendingPatientEproCount} ePRO items`;
      } else if (!hasSubjectMap) {
        workflowStatus = 'Subject mapping';
        workflowTone = 'brand';
        nextTask = 'Map subject ID';
      } else if (!hasProtocol) {
        workflowStatus = 'Protocol setup';
        workflowTone = 'warning';
        nextTask = 'Assign protocol';
      } else if (!hasAssignedCrc) {
        workflowStatus = 'CRC assignment';
        workflowTone = 'brand';
        nextTask = 'Assign primary CRC';
      }

      return {
        ...patient,
        workflowStatus,
        workflowTone,
        nextTask,
      };
    });
  }, [eproEntries, incidents, patients]);
  const selectedPatientRosterRow = useMemo(
    () => patientRosterRows.find((patient) => patient.id === selPatient?.id) || null,
    [patientRosterRows, selPatient?.id]
  );

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
        nextParams.set('tab', 'coordination');
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
      nextParams.set('tab', 'coordination');
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
      const tab = nextParams.get('tab');
      if (panel === 'coordination' && tab !== 'coordination') {
        nextParams.set('tab', 'coordination');
        changed = true;
      }
      if (panel) {
        nextParams.delete('panel');
        changed = true;
      }
      if (!PATIENT_WORKSPACE_TABS.includes(tab || 'overview')) {
        nextParams.set('tab', 'overview');
        changed = true;
      }
    } else if (normalizedSection === 'safety') {
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

  const openIncidents = useMemo(
    () => incidents.filter((incident) => isUnresolvedIncident(incident)),
    [incidents]
  );
  const urgentIncidentRows = useMemo(
    () =>
      openIncidents
        .filter((incident) => isHeaderUrgentIncident(incident))
        .sort((left, right) => {
          const leftTime = new Date(left.updated_at || left.created_at || left.timestamp || 0).getTime();
          const rightTime = new Date(right.updated_at || right.created_at || right.timestamp || 0).getTime();
          return rightTime - leftTime;
        }),
    [openIncidents]
  );
  const urgentIncidentCards = useMemo(
    () =>
      urgentIncidentRows.map((incident) => {
        const linkedPatientId = Array.isArray(incident.linked_patient_ids) ? incident.linked_patient_ids[0] : null;
        const linkedPatient =
          patients.find((patient) => patient.id === linkedPatientId) ||
          (Array.isArray(incident.linked_patients) ? incident.linked_patients[0] : null);

        return {
          ...incident,
          patientName:
            linkedPatient?.nickname ||
            linkedPatient?.patient_name ||
            incident.patient_name ||
            'Unknown patient',
          summary:
            incident.reason ||
            incident.title ||
            incident.protocol_rule_summary ||
            'Serious safety incident requires CRC review.',
          occurredAt: incident.updated_at || incident.created_at || incident.timestamp || '',
        };
      }),
    [patients, urgentIncidentRows]
  );
  const openIncidentCount = useMemo(
    () => Math.max(Number(globalIncidentSummary?.openIncidents ?? 0), openIncidents.length),
    [globalIncidentSummary, openIncidents.length]
  );
  const selectedPatientIncidentCount = useMemo(() => {
    if (!selPatient) return 0;
    return selectedIncidentSummary?.totalIncidents ?? incidents.filter((incident) => (incident.linked_patient_ids || []).includes(selPatient.id)).length;
  }, [incidents, selPatient, selectedIncidentSummary]);
  const urgentIncidentCount = useMemo(
    () => Math.max(Number(globalUrgentIncidentSummary?.urgentCount ?? 0), urgentIncidentRows.length),
    [globalUrgentIncidentSummary, urgentIncidentRows.length]
  );

  const currentHeaderSection = isPatientWorkspaceOpen
    ? {
        ...HOME_SECTIONS.patients,
        title: 'Patient Workspace',
        description: 'Review patient context, follow-up, ePRO, safety, and study coordination from one focused CRC workspace.',
      }
    : HOME_SECTIONS[activeHomeSection];

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

  useEffect(() => {
    if (activeHomeSection !== 'patients') return;

    if (!activePatientId) {
      if (selectedPatientId || selPatient) {
        selectP(null);
      }
      return;
    }

    const matchedPatient = patients.find((patient) => patient.id === activePatientId);
    if (matchedPatient && matchedPatient.id !== selectedPatientId) {
      selectP(matchedPatient);
    }
  }, [activeHomeSection, activePatientId, patients, selectedPatientId, selPatient, selectP]);

  const openWorkspaceSection = (section, { tab, patientId, preservePatient = false } = {}) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', section);
    nextParams.delete('focus');
    if (section === 'safety') {
      nextParams.delete('patient');
      nextParams.set('tab', tab || 'open');
    } else if (section === 'patients') {
      const resolvedPatientId =
        patientId === null
          ? ''
          : patientId || (preservePatient ? selectedPatientId || selPatient?.id || '' : '');

      if (resolvedPatientId) {
        nextParams.set('patient', resolvedPatientId);
        nextParams.set('tab', PATIENT_WORKSPACE_TABS.includes(tab || 'overview') ? (tab || 'overview') : 'overview');
      } else {
        nextParams.delete('patient');
        nextParams.delete('tab');
      }
    } else {
      nextParams.delete('patient');
      nextParams.delete('tab');
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
      value: urgentIncidentCount,
      note:
        urgentIncidentCount > 0
          ? `${urgentIncidentCount} serious safety case${urgentIncidentCount > 1 ? 's are' : ' is'} waiting for immediate CRC follow-up.`
          : 'Guidance workspace is ready for patient-level symptom support.',
      actionLabel: 'Open Guidance',
      onClick: () => openWorkspaceSection('side-effect-guidance'),
      tone: urgentIncidentCount > 0 ? 'danger' : 'default',
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
  }, [activeHomeSection, activePatientTab]);

  const openDropoutPatientWorkspace = (patient, tab = 'overview') => {
    if (patient) {
      selectP(patient);
    }
    openWorkspaceSection('patients', {
      tab,
      patientId: patient?.id || selectedPatientId || selPatient?.id || '',
      preservePatient: true,
    });
  };

  const handleHeaderSearchSelect = (patient) => {
    selectP(patient);
    openWorkspaceSection('patients', { patientId: patient.id, tab: 'overview' });
  };

  const handleOpenPatientWorkspace = (patient, tab = 'overview') => {
    if (!patient) return;
    selectP(patient);
    openWorkspaceSection('patients', { patientId: patient.id, tab });
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
        { id: 'today', label: 'Today', icon: 'dashboard', path: HOME_SECTIONS.today.path },
        {
          id: 'patients',
          label: 'Patients',
          icon: 'patients',
          onClick: () => {
            selectP(null);
            openWorkspaceSection('patients');
          },
        },
        { id: 'safety', label: 'Safety', icon: 'safety', path: HOME_SECTIONS.safety.path },
      { id: 'side-effect-guidance', label: 'Adverse Event Guidance', icon: 'guidance', emphasis: 'guidance', path: HOME_SECTIONS['side-effect-guidance'].path },
        { id: 'patient-disengagement', label: 'Patient Disengagement Prediction', icon: 'dropout', emphasis: 'dropout', path: HOME_SECTIONS['patient-disengagement'].path },
        { id: 'epro', label: 'Electronic Patient Reported Outcome, ePRO', icon: 'epro', path: HOME_SECTIONS.epro.path },
        { id: 'protocols', label: 'Clinical Trial Protocols', icon: 'protocol', path: HOME_SECTIONS.protocols.path },
        { id: 'resources', label: 'Resources', icon: 'resources', path: HOME_SECTIONS.resources.path },
      ],
    },
  ];

  const headerAlertButtonLabel = urgentIncidentCount > 0 ? `Urgent (${urgentIncidentCount})` : 'Urgent';

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
        onAlertsClick={() => openWorkspaceSection('safety', { tab: 'open' })}
        alertButtonLabel={headerAlertButtonLabel}
        alertButtonUrgent={urgentIncidentCount > 0}
        onHomeClick={() => selectP(null)}
        headerTitle={currentHeaderSection.title}
        headerDescription={currentHeaderSection.description}
        searchValue={rosterSearchQuery}
        onSearchChange={setRosterSearchQuery}
        searchResults={headerSearchResults}
        onSearchSelect={handleHeaderSearchSelect}
      >
        <div className="dashboard-surface">
          {activeHomeSection === 'today' ? (
            <section id="today" className="dashboard-section">
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
                            onClick={() => openWorkspaceSection('patients', { patientId: selPatient.id, tab: 'coordination' })}
                          >
                            Open Study Coordination
                          </button>
                          <button className="btn btn-primary" onClick={() => openWorkspaceSection('side-effect-guidance')}>
                                      Open Adverse Event Guidance
                          </button>
                          <button className="btn btn-secondary" onClick={() => openWorkspaceSection('protocols')}>
                            Open Protocols
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className={`card workspace-card ${urgentIncidentCards.length ? 'utility-card--danger' : 'utility-card--calm'}`}>
                  <div className="section-header">
                    <div>
                      <h3>Urgent safety</h3>
                      <div className="section-note">
                        Keep serious safety incidents visible from the Today workspace while triaging next steps.
                      </div>
                    </div>
                  </div>
                  {urgentIncidentCards.length ? (
                    <div className="utility-list">
                      {urgentIncidentCards.map((incident) => (
                        <div key={incident.id} className="utility-alert">
                          <div>
                            <div className="utility-alert__title">{incident.patientName}</div>
                            <div className="utility-alert__body">{incident.summary}</div>
                            <div className="utility-alert__meta">{new Date(incident.occurredAt).toLocaleString()}</div>
                          </div>
                          <button onClick={() => handleOpenIncident(incident)} className="btn btn-primary btn-small">
                            Open
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-panel">No serious safety incidents are active right now.</div>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {activeHomeSection === 'patients' ? (
            <section id="patients" className="dashboard-section">
              <div className={`dashboard-mainGrid dashboard-mainGrid--patients ${selPatient ? 'dashboard-mainGrid--patientsWorkspace' : 'dashboard-mainGrid--patientsRoster'}`}>
                {!selPatient ? (
                  <div className="patient-rosterPage patient-rosterPage--full">
                    <PatientList
                      patients={patientRosterRows}
                      selectedPatientId={selectedPatientId}
                      onSelect={(patient) => handleOpenPatientWorkspace(patient, 'overview')}
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
                  </div>
                ) : (
                  <div className="patient-workspace patient-workspace--full">
                    <div className="card workspace-card patient-workspace__shell">
                      <div className="section-header">
                        <div>
                          <h3>Patient workspace</h3>
                        </div>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => {
                            selectP(null);
                            openWorkspaceSection('patients', { patientId: null });
                          }}
                        >
                          Back to roster
                        </button>
                      </div>

                      <>
                        <div className="patient-workspace__hero">
                          <div className="patient-workspace__heroIdentity">
                            <div className="patient-workspace__avatar">
                              {(selPatient.nickname || selPatient.email || 'P')
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((part) => part[0]?.toUpperCase())
                                .join('')}
                            </div>
                            <div>
                              <div className="patient-workspace__heroName">{selPatient.nickname || 'Unnamed patient'}</div>
                              <div className="patient-workspace__heroDetails">
                                <div className="patient-workspace__heroDetail">
                                  <span>Subject ID :</span>
                                  <strong>{selPatient.subject_id || selPatient.subjectId || 'Not set'}</strong>
                                </div>
                                <div className="patient-workspace__heroDetail">
                                  <span>Email :</span>
                                  <strong>{selPatient.email || 'Not set'}</strong>
                                </div>
                                <div className="patient-workspace__heroDetail">
                                  <span>CRC :</span>
                                  <strong>{selPatient.primary_crc_name || crcName || 'Unassigned CRC'}</strong>
                                </div>
                                <div className="patient-workspace__heroDetail">
                                  <span>Protocol :</span>
                                  <strong>{selectedProtocolName}</strong>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="patient-workspace__heroSignals">
                            <div className={`metric-pill metric-pill--${selectedPatientRosterRow?.workflowTone || 'default'}`}>
                              {selectedPatientRosterRow?.workflowStatus || 'Stable'}
                            </div>
                            <div className="patient-workspace__heroNextTask">
                              <span>Next task</span>
                              <strong>{selectedPatientRosterRow?.nextTask || 'No immediate action'}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="workspace-tabRow patient-workspace__tabRow" role="tablist" aria-label="Patient workspace views">
                          {PATIENT_WORKSPACE_TABS.map((tabId) => (
                            <button
                              key={tabId}
                              type="button"
                              className={`workspace-tabButton ${activePatientTab === tabId ? 'workspace-tabButton--active' : ''}`}
                              onClick={() => openWorkspaceSection('patients', { patientId: selPatient.id, tab: tabId })}
                            >
                              {tabId === 'coordination'
                                ? 'Study Coordination'
                                : tabId === 'epro'
                                  ? 'ePRO'
                                  : tabId.charAt(0).toUpperCase() + tabId.slice(1)}
                            </button>
                          ))}
                        </div>

                        <div className="patient-workspace__viewport">
                          {activePatientTab === 'overview' ? (
                            <div className="patient-overview-grid">
                              <div className="patient-workspace__card">
                                <div className="section-header section-header--tight">
                                  <div>
                                    <h4>Next Tasks</h4>
                                    <div className="section-note">Current CRC follow-up generated from active safety, ePRO, mapping, and assignment state.</div>
                                  </div>
                                </div>
                                <div className="patient-overview__stack">
                                  <div className="patient-overview__stackRow">
                                    <span>Workflow status</span>
                                    <strong>{selectedPatientRosterRow?.workflowStatus || 'Stable'}</strong>
                                  </div>
                                  <div className="patient-overview__stackRow">
                                    <span>Next task</span>
                                    <strong>{selectedPatientRosterRow?.nextTask || 'No immediate action'}</strong>
                                  </div>
                                  <div className="patient-overview__stackRow">
                                    <span>Pending ePRO</span>
                                    <strong>{selectedPatientEproEntries.filter((entry) => String(entry?.status || '').toLowerCase() !== 'submitted').length}</strong>
                                  </div>
                                </div>
                              </div>

                              <div className="patient-workspace__card">
                                <div className="section-header section-header--tight">
                                  <div>
                                    <h4>Recent Vitals</h4>
                                    <div className="section-note">Latest measurements kept visible without leaving the patient workspace.</div>
                                  </div>
                                </div>
                                {coordinationVitalsPreview.length ? (
                                  <div className="patient-overview__vitalsList">
                                    {coordinationVitalsPreview.slice(0, 4).map((record) => (
                                      <div key={record.id} className="patient-overview__vitalsMiniRow">
                                        <span>{new Date(record.timestamp).toLocaleString()}</span>
                                        <strong>
                                          BP {record.bpSys ? `${record.bpSys}/${record.bpDia}` : '-'} • SpO2 {record.spo2 ? `${record.spo2}%` : '-'} • Temp {record.temperature ? `${record.temperature} C` : '-'}
                                        </strong>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="empty-panel">No vitals recorded for this patient yet.</div>
                                )}
                              </div>

                              <div className="patient-workspace__card">
                                <div className="section-header section-header--tight">
                                  <div>
                                    <h4>Upcoming Appointments</h4>
                                    <div className="section-note">Keep the next confirmed or pending visits visible while planning follow-up.</div>
                                  </div>
                                </div>
                                {coordinationAppointmentsPreview.length ? (
                                  <div className="patient-overview__stack">
                                    {coordinationAppointmentsPreview.slice(0, 3).map((appointment) => (
                                      <div key={appointment.id} className="patient-overview__stackRow">
                                        <span>{new Date(appointment.datetime).toLocaleString()}</span>
                                        <strong>{getStatusText(appointment.status)}</strong>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="empty-panel">No appointments recorded yet.</div>
                                )}
                              </div>

                              <div className="patient-workspace__card">
                                <div className="section-header section-header--tight">
                                  <div>
                                    <h4>Protocol Highlights</h4>
                                    <div className="section-note">Assigned trial, mapped subject, and inherited monitoring context.</div>
                                  </div>
                                </div>
                                <div className="patient-overview__stack">
                                  <div className="patient-overview__stackRow">
                                    <span>Assigned trial</span>
                                    <strong>{selectedProtocolName}</strong>
                                  </div>
                                  <div className="patient-overview__stackRow">
                                    <span>Mapped subject</span>
                                    <strong>{selPatient.subject_id || selPatient.subjectId || 'Not set'}</strong>
                                  </div>
                                </div>
                                <div className="patient-config__pillWrap">
                                  {inheritedVitalsPreview.length ? (
                                    inheritedVitalsPreview.map((label) => (
                                      <span key={label} className="metric-pill">
                                        {label}
                                      </span>
                                    ))
                                  ) : (
                                    <div className="section-note">No inherited monitored vitals are defined for the selected trial yet.</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {activePatientTab === 'vitals' ? (
                            <div className="patient-tabPanel">
                              <div className="patient-tabPanel__header">
                                <div>
                                  <h4>Recent Vitals</h4>
                                  <div className="section-note">Compact vital-sign history for the selected patient.</div>
                                </div>
                              </div>
                              {coordinationVitalsPreview.length ? (
                                <div className="patient-overview__vitalsTable">
                                  {coordinationVitalsPreview.map((record) => (
                                    <div key={record.id} className="patient-overview__vitalsRow">
                                      <div>{new Date(record.timestamp).toLocaleString()}</div>
                                      <div>BP {record.bpSys ? `${record.bpSys}/${record.bpDia}` : '-'}</div>
                                      <div>SpO2 {record.spo2 ? `${record.spo2}%` : '-'}</div>
                                      <div>Temp {record.temperature ? `${record.temperature} C` : '-'}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="empty-panel">No vitals recorded for this patient yet.</div>
                              )}
                            </div>
                          ) : null}

                          {activePatientTab === 'safety' ? (
                            <div className="patient-tabPanel">
                              <div className="patient-tabPanel__header">
                                <div>
                                  <h4>Safety</h4>
                                  <div className="section-note">Selected-patient safety activity without leaving the workspace.</div>
                                </div>
                                <button className="btn btn-secondary btn-small" onClick={() => openWorkspaceSection('safety', { tab: 'open' })}>
                                  Open full Safety
                                </button>
                              </div>
                              <div className="patient-overview__stack">
                                <div className="patient-overview__stackRow">
                                  <span>Active alerts</span>
                                  <strong>{selectedPatientAlertCount}</strong>
                                </div>
                                <div className="patient-overview__stackRow">
                                  <span>Linked incidents</span>
                                  <strong>{selectedPatientIncidentCount}</strong>
                                </div>
                              </div>
                              {selectedPatientIncidents.length ? (
                                <div className="patient-safety__list">
                                  {selectedPatientIncidents.slice(0, 6).map((incident) => (
                                    <button
                                      key={incident.id}
                                      type="button"
                                      className="incident-row"
                                      onClick={() => handleOpenIncident(incident)}
                                    >
                                      <div className="incident-row__copy">
                                        <div className="incident-row__top">
                                          <strong>{incident.reason || incident.incident_type || 'Incident'}</strong>
                                          <span className="incident-row__status">{incident.status || 'open'}</span>
                                        </div>
                                        <div className="incident-row__meta">
                                          Severity: {incident.severity || 'Not set'} • {incident.protocol_snapshot?.protocol_name || selectedProtocolName}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="empty-panel">No linked safety incidents are visible for this patient.</div>
                              )}
                            </div>
                          ) : null}

                          {activePatientTab === 'epro' ? (
                            <div className="patient-tabPanel">
                              <div className="patient-tabPanel__header">
                                <div>
                                  <h4>ePRO</h4>
                                  <div className="section-note">Mirrored questionnaire activity for the selected patient.</div>
                                </div>
                                <button className="btn btn-secondary btn-small" onClick={() => openWorkspaceSection('epro')}>
                                  Open full ePRO
                                </button>
                              </div>
                              {selectedPatientEproEntries.length ? (
                                <div className="patient-epro__list">
                                  {selectedPatientEproEntries.slice(0, 8).map((entry) => (
                                    <div key={entry.id} className="patient-epro__item">
                                      <div>
                                        <strong>{entry.form_name || entry.formType || entry.title || 'Questionnaire entry'}</strong>
                                        <div className="section-note">
                                          {entry.updated_at
                                            ? `Updated ${new Date(entry.updated_at).toLocaleString()}`
                                            : 'No update timestamp'}
                                        </div>
                                      </div>
                                      <span className={`metric-pill metric-pill--${String(entry.status || '').toLowerCase() === 'submitted' ? 'success' : 'warning'}`}>
                                        {String(entry.status || 'pending').toUpperCase()}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="empty-panel">No mirrored ePRO records are visible for this patient yet.</div>
                              )}
                            </div>
                          ) : null}

                          {activePatientTab === 'notes' ? (
                            <PatientNotesPanel
                              patientId={selPatient.id}
                              currentUser={{ uid: user.uid, name: currentCrcDisplayName }}
                            />
                          ) : null}

                          {activePatientTab === 'coordination' ? (
                            <div className="patient-coordination-layout">
                              <div className="patient-coordination-layout__main">
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
                                   currentDropoutTrialId={currentDropoutTrialId}
                                   currentDropoutTrialStatus={currentDropoutTrialSupportStatus.status}
                                   currentDropoutTrialStatusLabel={currentDropoutTrialSupportStatus.status_label}
                                   currentDropoutTrialStatusMessage={currentDropoutTrialSupportStatus.message}
                                   currentProtocolStaticContextStatus={currentProtocolStaticContextStatus.status}
                                   currentProtocolStaticContextStatusLabel={currentProtocolStaticContextStatus.label}
                                   currentProtocolStaticContextTone={currentProtocolStaticContextStatus.tone}
                                   currentProtocolStaticContextMessage={currentProtocolStaticContextStatus.message}
                                   currentDropoutTrialPoolSize={
                                     Number(currentDropoutTrialSupportStatus.registry?.expected_pool_size) ||
                                     Number(currentDropoutTrialSupportStatus.metadata?.expected_pool_size) ||
                                     0
                                   }
                                  currentDropoutTrialModelVersion={
                                    currentDropoutTrialSupportStatus.registry?.model_version_label ||
                                    currentDropoutTrialSupportStatus.metadata?.model_version_label ||
                                    ''
                                  }
                                  currentDropoutTrialLastVerifiedAt={
                                    currentDropoutTrialSupportStatus.registry?.last_verified_at || ''
                                  }
                                  mappingStatus={subjectMappingStatus}
                                  mappingStatusNote={subjectMappingStatusNote}
                                  isMappingStatusPending={isSubjectMappingStatusPending}
                                  subjectId={tempSubjectId}
                                  setSubjectId={setTempSubjectId}
                                  subjectIdError={subjectIdError}
                                  crcUsers={crcUsers}
                                  inheritedVitals={inheritedVitalsPreview}
                                  dropoutOptions={dropoutTestingSubjects}
                                  onSave={handleSaveInfo}
                                  isSaving={isSaving}
                                  successMsg={successMsg}
                                  primaryCrcPhoneError={primaryCrcPhoneError}
                                  studyEmergencyPhoneError={studyEmergencyPhoneError}
                                  disableSave={hasPhoneValidationErrors}
                                  onDeletePatient={handleDeletePatient}
                                />
                              </div>

                              <div className="patient-coordination-layout__aside">
                                <div className="card workspace-card patient-workspace__card">
                                  <div className="section-header">
                                    <div>
                                      <h4>Assigned trial summary</h4>
                                      <div className="section-note">
                                        Keep the selected patient&apos;s trial context visible while editing subject mapping, protocol assignment, and CRC ownership.
                                      </div>
                                    </div>
                                    <button className="btn btn-secondary btn-small" onClick={() => openWorkspaceSection('protocols')}>
                                      Open Protocols
                                    </button>
                                  </div>

                                  <div className="patient-overview__grid">
                                    <div className="patient-overview__item">
                                      <span>Assigned trial</span>
                                      <strong>{selectedProtocolName}</strong>
                                    </div>
                                    <div className="patient-overview__item">
                                      <span>Mapped subject</span>
                                      <strong>{selPatient.subject_id || selPatient.subjectId || 'Not set'}</strong>
                                    </div>
                                  </div>

                                  <div className="patient-config__pillWrap">
                                    {inheritedVitalsPreview.length ? (
                                      inheritedVitalsPreview.map((label) => (
                                        <span key={label} className="metric-pill">
                                          {label}
                                        </span>
                                      ))
                                    ) : (
                                      <div className="section-note">Assign a trial template to preview inherited monitored vitals here.</div>
                                    )}
                                  </div>
                                </div>

                                <div className="card workspace-card patient-workspace__card">
                                  <div className="section-header section-header--tight">
                                    <div>
                                      <h4>Recent vitals</h4>
                                      <div className="section-note">Latest measurements remain visible while editing trial configuration.</div>
                                    </div>
                                  </div>
                                  {coordinationVitalsPreview.length ? (
                                    <div className="patient-overview__vitalsTable">
                                      {coordinationVitalsPreview.map((record) => (
                                        <div key={record.id} className="patient-overview__vitalsRow">
                                          <div>{new Date(record.timestamp).toLocaleString()}</div>
                                          <div>BP {record.bpSys ? `${record.bpSys}/${record.bpDia}` : '-'}</div>
                                          <div>SpO2 {record.spo2 ? `${record.spo2}%` : '-'}</div>
                                          <div>Temp {record.temperature ? `${record.temperature} C` : '-'}</div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="empty-panel">No vitals recorded for this patient yet.</div>
                                  )}
                                </div>

                                <div className="card workspace-card patient-workspace__card">
                                  <div className="section-header">
                                    <div>
                                      <h4>Appointments</h4>
                                      <div className="section-note">
                                        Schedule, inspect AI date suggestions, and complete confirmed visits from one coordination surface.
                                      </div>
                                    </div>
                                  </div>
                                  <div className="inline-form-row">
                                    <input
                                      type="datetime-local"
                                      value={newDate}
                                      onChange={(event) => setNewDate(event.target.value)}
                                      style={{ flex: 1, minWidth: '220px' }}
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
                                  {coordinationAppointmentsPreview.length ? (
                                    coordinationAppointmentsPreview.map((appointment) => (
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
                            </div>
                          ) : null}
                        </div>
                      </>
                    </div>
                  </div>
                )}
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
              <div
                ref={guidanceWorkspaceRef}
                className="guidance-workspace"
                style={{
                  display: 'flex',
                  flexDirection: isGuidanceStacked ? 'column' : 'row',
                  gap: isGuidanceStacked ? '18px' : '0',
                  alignItems: 'stretch',
                  minHeight: '74vh',
                }}
              >
                <div
                  style={{
                    flex: isGuidanceStacked ? '1 1 auto' : `0 0 calc(${guidanceLeftPaneWidth}% - 8px)`,
                    minWidth: isGuidanceStacked ? 0 : '360px',
                    minHeight: 0,
                    display: 'flex',
                  }}
                >
                  <PatientConversationTimeline
                    patient={selPatient}
                    crcName={crcName}
                  />
                </div>
                {!isGuidanceStacked ? (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize patient mixed timeline and adverse event guidance panels"
                    title="Drag to resize panels. Double-click to reset."
                    onPointerDown={handleGuidanceResizeStart}
                    onDoubleClick={() => setGuidanceLeftPaneWidth(DEFAULT_GUIDANCE_LEFT_PANE_WIDTH)}
                    style={{
                      width: '16px',
                      flex: '0 0 16px',
                      cursor: 'col-resize',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      touchAction: 'none',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: '18px 7px',
                        borderRadius: '999px',
                        background: 'linear-gradient(180deg, rgba(15,96,155,0.12), rgba(15,96,155,0.28), rgba(15,96,155,0.12))',
                      }}
                    />
                    <div
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        width: '8px',
                        height: '96px',
                        borderRadius: '999px',
                        background: '#ffffff',
                        border: '1px solid rgba(15, 96, 155, 0.24)',
                        boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
                      }}
                    />
                  </div>
                ) : null}
                <div
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                  }}
                >
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
                    titleOverride="Adverse Event Guidance"
                    panelDescription="Use the right pane for CRC adverse event guidance and the left pane for the patient, AI, and CRC mixed timeline."
                  />
                </div>

                {false ? (
                <div className="card workspace-card guidance-contextCard">
                  <div className="section-header section-header--tight">
                    <div>
                      <h3>Patient context</h3>
                      <div className="section-note">Pinned CRC context that stays visible while you ask questions.</div>
                    </div>
                    {selPatient ? (
                      <button className="btn btn-secondary btn-small" onClick={() => openWorkspaceSection('patients', { patientId: selPatient.id, tab: 'overview' })}>
                        Open patient
                      </button>
                    ) : null}
                  </div>

                  {selPatient ? (
                    <>
                      <div className="guidance-contextCard__patient">
                        <div className="guidance-contextCard__patientName">{selPatient.nickname || 'Unnamed patient'}</div>
                        <div className="guidance-contextCard__patientMeta">
                          <span>{selPatient.subject_id || selPatient.subjectId || 'No subject ID'}</span>
                          <span>{selectedProtocolName}</span>
                        </div>
                      </div>

                      <div className="guidance-contextCard__section">
                        <strong>Protocol grounding</strong>
                        <div className="section-note">{selectedProtocolName}</div>
                        <div className="workspace-actionStrip">
                          <button className="btn btn-secondary btn-small" onClick={() => handleOpenClinicalResource('CTCAE.pdf')}>
                            Open CTCAE
                          </button>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => handleOpenClinicalResource(selectedProtocolFilePath, 'protocol')}
                            disabled={!selectedProtocolFilePath}
                          >
                            Open protocol
                          </button>
                        </div>
                      </div>

                      <div className="guidance-contextCard__section">
                        <strong>Recent safety</strong>
                        <div className="patient-overview__stack">
                          <div className="patient-overview__stackRow">
                            <span>Active alerts</span>
                            <strong>{selectedPatientAlertCount}</strong>
                          </div>
                          <div className="patient-overview__stackRow">
                            <span>Linked incidents</span>
                            <strong>{selectedPatientIncidentCount}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="guidance-contextCard__section">
                        <strong>Recent vitals</strong>
                        {coordinationVitalsPreview.length ? (
                          <div className="guidance-contextCard__miniList">
                            {coordinationVitalsPreview.slice(0, 4).map((record) => (
                              <div key={record.id} className="guidance-contextCard__miniRow">
                                <span>{new Date(record.timestamp).toLocaleString()}</span>
                                <strong>
                                  BP {record.bpSys ? `${record.bpSys}/${record.bpDia}` : '-'} • SpO2 {record.spo2 ? `${record.spo2}%` : '-'}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="section-note">No recent vitals are visible for this patient.</div>
                        )}
                      </div>

                      <div className="guidance-contextCard__section">
                        <strong>ePRO</strong>
                        <div className="patient-overview__stack">
                          <div className="patient-overview__stackRow">
                            <span>Loaded entries</span>
                            <strong>{selectedPatientEproEntries.length}</strong>
                          </div>
                          <div className="patient-overview__stackRow">
                            <span>Pending</span>
                            <strong>{selectedPatientEproEntries.filter((entry) => String(entry?.status || '').toLowerCase() !== 'submitted').length}</strong>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty-panel">
                      Select a patient from the Patients workspace first. Then this right-hand panel will pin protocol, CTCAE, safety, vitals, and ePRO context beside the guidance conversation.
                    </div>
                  )}
                </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeHomeSection === 'patient-disengagement' ? (
            <section id="patient-disengagement" className="dashboard-section">
              <DropoutRiskPanel
                patients={patients}
                currentUser={{ uid: user.uid, name: currentCrcDisplayName }}
                onOpenPatients={(patient) => openDropoutPatientWorkspace(patient)}
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
                      {selectedProtocolFilePath
                        ? 'Open the currently assigned protocol PDF for the selected patient.'
                        : selPatient?.protocolId || selPatient?.protocolName
                          ? 'This patient has an assigned protocol record, but no openable protocol PDF path is available yet.'
                        : 'Select a patient with an assigned protocol to open it here.'}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleOpenClinicalResource(selectedProtocolFilePath, 'protocol')}
                  disabled={!selectedProtocolFilePath}
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
