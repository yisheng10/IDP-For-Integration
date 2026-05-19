import {
  collection,
  collectionGroup,
  getCountFromServer,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

const UNRESOLVED_INCIDENT_STATUSES = ['open', 'acknowledged'];

async function safeCount(targetQuery) {
  const snapshot = await getCountFromServer(targetQuery);
  return Number(snapshot.data().count || 0);
}

function safeCountOrZero(targetQuery) {
  return safeCount(targetQuery).catch(() => 0);
}

export async function fetchPatientRosterSummary(crcUid) {
  const totalPatients = await safeCount(
    query(collection(db, 'users'), where('role', '==', 'patient'))
  );

  let assignedPatients = 0;
  if (crcUid) {
    assignedPatients = await safeCount(
      query(
        collection(db, 'users'),
        where('role', '==', 'patient'),
        where('primary_crc_id', '==', crcUid)
      )
    ).catch(() => 0);
  }

  return {
    totalPatients,
    assignedPatients,
  };
}

export async function fetchAlertHistorySummary({ selectedPatientId = null } = {}) {
  const alertsSource = selectedPatientId
    ? collection(db, 'users', selectedPatientId, 'alerts')
    : collectionGroup(db, 'alerts');

  const [totalAlerts, activeAlerts, activeUrgentAlerts] = await Promise.all([
    safeCountOrZero(query(alertsSource)),
    safeCountOrZero(query(alertsSource, where('status', '==', 'unread'))),
    safeCountOrZero(
      query(alertsSource, where('status', '==', 'unread'), where('type', '==', 'URGENT'))
    ),
  ]);

  return {
    totalAlerts,
    activeAlerts,
    activeUrgentAlerts,
    resolvedAlerts: Math.max(totalAlerts - activeAlerts, 0),
  };
}

export async function fetchIncidentSummary({ selectedPatientId = null } = {}) {
  const baseRef = collection(db, 'incident_records');
  const patientFilter = selectedPatientId
    ? [where('linked_patient_ids', 'array-contains', selectedPatientId)]
    : [];

  const [openIncidents, resolvedIncidents, groupedIncidents, overdueIncidents] = await Promise.all([
    safeCountOrZero(
      query(baseRef, ...patientFilter, where('status', 'in', UNRESOLVED_INCIDENT_STATUSES))
    ),
    safeCountOrZero(
      query(baseRef, ...patientFilter, where('status', '==', 'resolved'))
    ),
    safeCountOrZero(
      query(baseRef, ...patientFilter, where('compare_ready', '==', true))
    ),
    safeCountOrZero(
      query(
        baseRef,
        ...patientFilter,
        where('status', 'in', UNRESOLVED_INCIDENT_STATUSES),
        where('due_at', '<=', new Date().toISOString())
      )
    ),
  ]);

  return {
    openIncidents,
    resolvedIncidents,
    groupedIncidents,
    overdueIncidents,
    totalIncidents: openIncidents + resolvedIncidents,
  };
}

export async function fetchOpenIncidentSummary() {
  const openIncidents = await safeCountOrZero(
    query(collection(db, 'incident_records'), where('status', 'in', UNRESOLVED_INCIDENT_STATUSES))
  );
  return { openIncidents };
}

export async function fetchCrcUrgentIncidentSummary() {
  const { openIncidents } = await fetchOpenIncidentSummary();
  return { urgentCount: openIncidents };
}
