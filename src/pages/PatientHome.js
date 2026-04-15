import { addDoc, collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import TopNavbar from '../components/TopNavbar';
import { db } from '../firebase';
import { subscribeToAlertHistory } from '../services/alertService';
import { subscribeToAppointments, updateAppointmentStatus } from '../services/appointmentService';
import { subscribeToEproSubmissions } from '../services/eproService';
import { subscribeToSideEffectReports } from '../services/sideEffectService';
import { subscribeToAssignedTrialTemplate } from '../services/trialTemplateService';
import { handleLoggedVitalSafety } from '../services/vitalSafetyService';
import { getStatusText } from '../utils';

const PatientHome = ({ user, onLogout }) => {
  const router = useRouter();
  const previousUnreadCountRef = useRef(0);

  const [nickname, setNickname] = useState('');
  const [protocolId, setProtocolId] = useState(null);
  const [protocolUrl, setProtocolUrl] = useState(null);
  const [protocolName, setProtocolName] = useState(null);
  const [primaryCrcId, setPrimaryCrcId] = useState('');
  const [primaryCrcName, setPrimaryCrcName] = useState('');
  const [primaryCrcPhone, setPrimaryCrcPhone] = useState('');
  const [studyEmergencyPhone, setStudyEmergencyPhone] = useState('');

  const [assignedTemplate, setAssignedTemplate] = useState(null);
  const [vitalTemplates, setVitalTemplates] = useState([]);
  const [vitalValues, setVitalValues] = useState({});

  const [history, setHistory] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [activeEmergencies, setActiveEmergencies] = useState([]);
  const [allAlerts, setAllAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [replyBanner, setReplyBanner] = useState(null);
  const [eproRecords, setEproRecords] = useState([]);
  const [sideEffectReports, setSideEffectReports] = useState([]);

  const [assistantOpenSignal, setAssistantOpenSignal] = useState(0);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState(null);

  useEffect(() => {
    const unsubscribeUser = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setNickname(data.nickname || '');
      setProtocolId(data.protocolId || null);
      setProtocolUrl(data.protocolUrl || null);
      setProtocolName(data.protocolName || null);
      setPrimaryCrcId(data.primary_crc_id || data.primaryCrcId || '');
      setPrimaryCrcName(data.primary_crc_name || data.primaryCrcName || '');
      setPrimaryCrcPhone(data.primary_crc_phone || data.primaryCrcPhone || '');
      setStudyEmergencyPhone(data.study_emergency_phone || data.studyEmergencyPhone || '');
    });

    const historyQuery = query(
      collection(db, 'users', user.uid, 'vitals'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );
    const unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
      setHistory(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    });

    const unsubscribeAppointments = subscribeToAppointments(user.uid, (records) => setAppointments(records));
    const unsubscribeAlerts = subscribeToAlertHistory(user.uid, (records) => {
      setAllAlerts(records);
      const emergencies = records.filter((entry) => entry.type !== 'MESSAGE' && entry.status === 'unread');
      setActiveEmergencies(emergencies);

      const unreadCrcReplies = records.filter(
        (entry) => entry.status === 'unread' && entry.lastSender === 'crc'
      );
      if (unreadCrcReplies.length > previousUnreadCountRef.current) {
        const newestReply = unreadCrcReplies[0];
        setReplyBanner({
          title: 'CRC replied',
          body: newestReply.reason || 'A CRC message is waiting for you.',
          alert: newestReply,
        });
      }
      previousUnreadCountRef.current = unreadCrcReplies.length;
    });

    const unsubscribeEpro = subscribeToEproSubmissions(user.uid, (records) => setEproRecords(records));
    const unsubscribeSideEffects = subscribeToSideEffectReports(user.uid, (records) => setSideEffectReports(records));

    return () => {
      unsubscribeUser();
      unsubscribeHistory();
      unsubscribeAppointments();
      unsubscribeAlerts();
      unsubscribeEpro();
      unsubscribeSideEffects();
    };
  }, [user.uid]);

  useEffect(() => {
    const profile = {
      protocolId,
      protocolName,
      monitoredVitals: [],
    };

    const unsubscribe = subscribeToAssignedTrialTemplate(
      profile,
      (template) => {
        setAssignedTemplate(template);
        setVitalTemplates(template?.vital_templates || []);
      },
      (error) => console.error('Trial template subscription failed:', error)
    );

    return () => unsubscribe?.();
  }, [protocolId, protocolName]);

  const unreadCrcReplies = useMemo(
    () => allAlerts.filter((entry) => entry.status === 'unread' && entry.lastSender === 'crc'),
    [allAlerts]
  );

  const latestEproRecord =
    eproRecords.find((record) => record.status && record.status !== 'submitted') || eproRecords[0] || null;
  const isAwaitingCrcReview =
    latestEproRecord?.status === 'pending_crc_review' ||
    latestEproRecord?.review_status === 'pending_crc_review';

  const updateVitalValue = (key, value) => {
    setVitalValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const buildVitalPayload = () => {
    const payload = {
      timestamp: new Date().toISOString(),
    };

    vitalTemplates.forEach((template) => {
      if (template.input_type === 'blood_pressure') {
        const systolicKey = template.systolic_key || 'bpSys';
        const diastolicKey = template.diastolic_key || 'bpDia';
        if (vitalValues[systolicKey]) payload[systolicKey] = vitalValues[systolicKey];
        if (vitalValues[diastolicKey]) payload[diastolicKey] = vitalValues[diastolicKey];
      } else {
        const storageKey = template.storage_key || template.key;
        if (vitalValues[storageKey]) payload[storageKey] = vitalValues[storageKey];
      }
    });

    if (payload.weight && payload.height) {
      const weight = Number(payload.weight);
      const heightMeters = Number(payload.height) / 100;
      if (weight > 0 && heightMeters > 0) {
        payload.bmi = (weight / (heightMeters * heightMeters)).toFixed(1);
      }
    }

    return payload;
  };

  const handleAddVitals = async () => {
    const payload = buildVitalPayload();
    const enteredKeys = Object.keys(payload).filter((key) => key !== 'timestamp' && key !== 'bmi');

    if (!enteredKeys.length) {
      Alert.alert('Missing data', 'Enter at least one monitored vital before saving.');
      return;
    }

    await addDoc(collection(db, 'users', user.uid, 'vitals'), payload);

    const safetyResult = await handleLoggedVitalSafety({
      userId: user.uid,
      vitalPayload: payload,
      reporterName: nickname || 'Patient',
    });

    if (safetyResult.hasSafetyIssue) {
      Alert.alert(
        safetyResult.severity === 'serious' ? 'Urgent vitals detected' : 'Abnormal vitals documented',
        safetyResult.severity === 'serious'
          ? `CRC has been alerted automatically. Flagged issues: ${safetyResult.summary}. If you feel very unwell, call your study emergency number or local emergency services immediately.`
          : `CRC has been alerted automatically. Flagged issues: ${safetyResult.summary}.`
      );
    } else {
      Alert.alert('Success', 'Vitals logged successfully.');
    }

    setVitalValues({});
  };

  const handleStatusUpdate = async (appointmentId, status) => {
    try {
      await updateAppointmentStatus(user.uid, appointmentId, status);
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const handleAIAlert = (reason) => {
    setTriggerReason(null);
    setTimeout(() => {
      setTriggerReason(reason || 'AI Risk Detected');
      setWidgetOpen(true);
    }, 100);
  };

  const openQuestionnaire = () => {
    router.push('/questionnaire');
  };

  const openLatestReply = () => {
    const latestReply = unreadCrcReplies[0];
    if (!latestReply) return;
    setSelectedAlert(latestReply);
    setWidgetOpen(true);
    setReplyBanner(null);
  };

  const renderVitalInput = (template) => {
    if (template.input_type === 'blood_pressure') {
      const systolicKey = template.systolic_key || 'bpSys';
      const diastolicKey = template.diastolic_key || 'bpDia';
      return (
        <View key={template.key} style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={`${template.label} systolic (${template.unit || 'mmHg'})`}
            keyboardType="numeric"
            value={vitalValues[systolicKey] || ''}
            onChangeText={(value) => updateVitalValue(systolicKey, value)}
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={`${template.label} diastolic (${template.unit || 'mmHg'})`}
            keyboardType="numeric"
            value={vitalValues[diastolicKey] || ''}
            onChangeText={(value) => updateVitalValue(diastolicKey, value)}
          />
        </View>
      );
    }

    const storageKey = template.storage_key || template.key;
    return (
      <TextInput
        key={template.key}
        style={styles.input}
        placeholder={`${template.label}${template.unit ? ` (${template.unit})` : ''}`}
        keyboardType="numeric"
        value={vitalValues[storageKey] || ''}
        onChangeText={(value) => updateVitalValue(storageKey, value)}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#eef3f8' }}>
      <TopNavbar
        user={user}
        defaultRole="Patient"
        onLogout={onLogout}
        alerts={unreadCrcReplies}
        onAlertClick={(alert) => {
          setSelectedAlert(alert);
          setWidgetOpen(true);
          setReplyBanner(null);
        }}
      />

      <LiveChatWidget
        user={user}
        role="patient"
        userName={nickname || 'Patient'}
        triggerReason={triggerReason}
        existingAlert={selectedAlert}
        activeEmergencies={activeEmergencies}
        isOpenInitially={widgetOpen}
        onClose={() => {
          setWidgetOpen(false);
          setTriggerReason(null);
          setSelectedAlert(null);
        }}
      />

      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: 100 }}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>Patient home</Text>
          <Text style={styles.heroTitle}>Welcome back{nickname ? `, ${nickname.split(' ')[0]}` : ''}</Text>
          <Text style={styles.heroText}>
            Complete today&apos;s tasks with fewer taps: vitals, recent history, AI side effect guidance,
            questionnaires, and appointments are grouped below.
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Protocol</Text>
              <Text style={styles.heroStatValue}>{protocolName || 'Not assigned'}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Appointments</Text>
              <Text style={styles.heroStatValue}>{appointments.length}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Unread CRC replies</Text>
              <Text style={styles.heroStatValue}>{unreadCrcReplies.length}</Text>
            </View>
          </View>
        </View>

        {replyBanner ? (
          <TouchableOpacity style={styles.replyBanner} onPress={openLatestReply}>
            <Text style={styles.replyBannerTitle}>{replyBanner.title}</Text>
            <Text style={styles.replyBannerText}>{replyBanner.body}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log Vitals</Text>
          <Text style={styles.infoText}>
            These monitored vitals now come from your assigned clinical trial template. CRC is alerted automatically
            when abnormal thresholds are reached.
          </Text>
          <View style={styles.eproSummaryBox}>
            <Text style={styles.eproSummaryText}>Assigned trial: {assignedTemplate?.name || protocolName || 'Not assigned'}</Text>
            <Text style={styles.eproSummaryText}>
              Monitored vitals: {vitalTemplates.length ? vitalTemplates.map((template) => template.label).join(', ') : 'Not configured'}
            </Text>
          </View>
          <View style={{ gap: 10 }}>
            {vitalTemplates.length ? vitalTemplates.map(renderVitalInput) : (
              <Text style={styles.infoText}>CRC still needs to assign a clinical trial template before dynamic vital logging is available.</Text>
            )}
            <TouchableOpacity onPress={handleAddVitals} style={styles.btnPrimary}>
              <Text style={{ color: 'white', fontWeight: 'bold' }}>Add Record</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent vitals history</Text>
          <Text style={styles.infoText}>
            This home screen shows a recent vitals window for quick review. Older measurements are not all listed here at once.
          </Text>
          {history.length === 0 ? (
            <Text>No records.</Text>
          ) : (
            history.slice(0, 5).map((record) => (
              <View key={record.id} style={styles.historyRow}>
                <Text style={{ fontWeight: 'bold', marginBottom: 5 }}>{new Date(record.timestamp).toLocaleString()}</Text>
                <Text style={styles.historyText}>
                  {Object.entries(record)
                    .filter(([key]) => key !== 'id' && key !== 'timestamp')
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('  ')}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI Side Effect Guidance</Text>
          <Text style={styles.infoText}>
            Describe symptoms in the AI assistant. It extracts side effects automatically, documents them for audit,
            uses the active protocol when available, and alerts CRC directly when escalation is needed.
          </Text>
          {sideEffectReports[0] ? (
            <View style={styles.eproSummaryBox}>
              <Text style={styles.eproSummaryText}>
                Latest documented event: {sideEffectReports[0].symptom_title} ({sideEffectReports[0].severity})
              </Text>
              <Text style={styles.eproSummaryText}>
                Logged: {new Date(sideEffectReports[0].submitted_at).toLocaleString()}
              </Text>
            </View>
          ) : (
            <Text style={styles.infoText}>No AI-documented symptom events yet.</Text>
          )}
          <View style={styles.contactBox}>
            <Text style={styles.contactTitle}>Tell the AI assistant these details first</Text>
            <Text style={styles.contactText}>
              Symptom name, when it started, how bad it is, latest vitals, what you already took, and whether you can breathe,
              talk, walk, or control bleeding normally.
            </Text>
            <Text style={styles.contactText}>
              CRC contact: {primaryCrcName || 'Not assigned'} {primaryCrcPhone ? `(${primaryCrcPhone})` : '(phone not set)'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setAssistantOpenSignal((value) => value + 1)} style={styles.btnPrimary}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>Open AI Side Effect Guidance</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today&apos;s ePRO</Text>
          <Text style={styles.infoText}>
            Complete your study questionnaire here. This panel shows the latest mirrored ePRO status for today&apos;s workflow, not a full questionnaire archive.
          </Text>
          {latestEproRecord ? (
            <View style={styles.eproSummaryBox}>
              <Text style={styles.eproSummaryText}>
                Status: {isAwaitingCrcReview ? 'AWAITING CRC REVIEW' : getStatusText(latestEproRecord.status)}
              </Text>
              <Text style={styles.eproSummaryText}>
                Assigned: {latestEproRecord.assigned_at ? new Date(latestEproRecord.assigned_at).toLocaleString() : 'Not recorded'}
              </Text>
              <Text style={styles.eproSummaryText}>
                Due: {latestEproRecord.due_at ? new Date(latestEproRecord.due_at).toLocaleString() : 'Not set'}
              </Text>
              {isAwaitingCrcReview ? (
                <Text style={styles.eproSummaryText}>
                  Review cutoff: {latestEproRecord.review_cutoff_at ? new Date(latestEproRecord.review_cutoff_at).toLocaleString() : 'Not set'}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={styles.infoText}>No mirrored questionnaire status yet. Open the questionnaire to start today&apos;s form.</Text>
          )}
          <TouchableOpacity onPress={openQuestionnaire} style={styles.btnPrimary}>
            <Text style={{ color: 'white', fontWeight: 'bold' }}>Open ePRO Questionnaire</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>My Appointments</Text>
          <Text style={styles.infoText}>
            Upcoming and recent appointment items are shown here for quick action during the current patient workflow.
          </Text>
          {appointments.length === 0 ? (
            <Text>No upcoming appointments.</Text>
          ) : (
            appointments.map((appointment) => (
              <View key={appointment.id} style={styles.apptRow}>
                <View>
                  <Text style={{ fontWeight: 'bold' }}>{new Date(appointment.datetime).toLocaleString()}</Text>
                  <Text
                    style={{
                      color:
                        appointment.status === 'confirmed'
                          ? 'green'
                          : appointment.status === 'reschedule_requested'
                            ? 'red'
                            : 'orange',
                    }}
                  >
                    {getStatusText(appointment.status)}
                  </Text>
                </View>
                <View style={{ gap: 5 }}>
                  {appointment.status === 'pending' ? (
                    <TouchableOpacity
                      onPress={() => handleStatusUpdate(appointment.id, 'confirmed')}
                      style={[styles.btnSmall, { backgroundColor: 'green' }]}
                    >
                      <Text style={{ color: 'white' }}>Confirm</Text>
                    </TouchableOpacity>
                  ) : null}
                  {appointment.status === 'pending' || appointment.status === 'confirmed' ? (
                    <TouchableOpacity
                      onPress={() => handleStatusUpdate(appointment.id, 'reschedule_requested')}
                      style={[styles.btnSmall, { backgroundColor: '#6c757d' }]}
                    >
                      <Text style={{ color: 'white' }}>Reschedule</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <GeminiChatbot
        role="patient"
        userId={user.uid}
        userNickname={nickname}
        patientData={{ appointments, vitals: history }}
        protocolUrl={protocolUrl}
        activeProtocolName={protocolName}
        onEmergencyTrigger={handleAIAlert}
        openSignal={assistantOpenSignal}
        contactContext={{
          primaryCrcId,
          primaryCrcName,
          primaryCrcPhone,
          studyEmergencyPhone,
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: '#0f609b',
    borderRadius: 22,
    padding: 20,
    marginBottom: 15,
  },
  heroEyebrow: {
    color: 'rgba(255,255,255,0.78)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroText: {
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 21,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  heroStat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 12,
  },
  heroStatLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    marginBottom: 6,
  },
  heroStatValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  replyBanner: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    borderRadius: 16,
    padding: 14,
    marginBottom: 15,
  },
  replyBannerTitle: {
    color: '#9a3412',
    fontWeight: '800',
    marginBottom: 4,
  },
  replyBannerText: {
    color: '#9a3412',
    lineHeight: 18,
  },
  card: {
    backgroundColor: 'white',
    padding: 18,
    borderRadius: 18,
    marginBottom: 15,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTitle: { fontSize: 20, fontWeight: '800', marginBottom: 14, color: '#14324a' },
  infoText: { color: '#4f6478', lineHeight: 20, marginBottom: 12 },
  eproSummaryBox: {
    backgroundColor: '#f5f9ff',
    borderWidth: 1,
    borderColor: '#d2def1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 15,
  },
  eproSummaryText: { color: '#355070', marginBottom: 4 },
  contactBox: {
    backgroundColor: '#f8fbff',
    borderWidth: 1,
    borderColor: '#d9e6f4',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  contactTitle: { color: '#14324a', fontWeight: '700', marginBottom: 6 },
  contactText: { color: '#52606d', lineHeight: 18, marginBottom: 4 },
  apptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#eef3f8',
  },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#d3dde9',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#f8fbff',
    marginBottom: 0,
  },
  row: { flexDirection: 'row', gap: 10 },
  btnPrimary: { backgroundColor: '#0f609b', padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  historyRow: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eef3f8' },
  historyText: { fontSize: 12, color: '#52606d', lineHeight: 18 },
});

export default PatientHome;
