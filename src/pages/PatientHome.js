import { addDoc, collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import TopNavbar from '../components/TopNavbar';
import { db } from '../firebase';
import { subscribeToAlertHistory } from '../services/alertService';
import { subscribeToAppointments, updateAppointmentStatus } from '../services/appointmentService';
import { subscribeToEproSubmissions } from '../services/eproService';
import { subscribeToSideEffectReports } from '../services/sideEffectService';
import { handleLoggedVitalSafety } from '../services/vitalSafetyService';
import { getStatusText } from '../utils';

const PatientHome = ({ user, onLogout }) => {
  const router = useRouter();
  // --- STATES FOR ALL VITALS ---
  const [temp, setTemp] = useState('');
  const [bpSys, setBpSys] = useState('');
  const [bpDia, setBpDia] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [respRate, setRespRate] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [bmi, setBmi] = useState(''); // Calculated
  const [glucoseFasting, setGlucoseFasting] = useState('');
  const [glucosePost, setGlucosePost] = useState('');
  const [pef, setPef] = useState('');
  const [fev1, setFev1] = useState('');
  const [inr, setInr] = useState('');
  const [ketones, setKetones] = useState('');
  const [waist, setWaist] = useState('');

  const [history, setHistory] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [nickname, setNickname] = useState('');
  const [protocolUrl, setProtocolUrl] = useState(null);
  const [protocolName, setProtocolName] = useState(null);
  const [requiredVitals, setRequiredVitals] = useState(['temperature', 'spo2', 'bp']);
  const [primaryCrcName, setPrimaryCrcName] = useState('');
  const [primaryCrcPhone, setPrimaryCrcPhone] = useState('');
  const [studyEmergencyPhone, setStudyEmergencyPhone] = useState('');
  const [assistantOpenSignal, setAssistantOpenSignal] = useState(0);

  const [widgetOpen, setWidgetOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState(null);
  const [activeEmergencies, setActiveEmergencies] = useState([]);
  const [eproRecords, setEproRecords] = useState([]);
  const [sideEffectReports, setSideEffectReports] = useState([]);

  useEffect(() => {
    const unsubUser = onSnapshot(doc(db, "users", user.uid), (d) => {
      if(d.exists()) {
        const data = d.data();
        setNickname(data.nickname);
        setProtocolUrl(data.protocolUrl);
        setProtocolName(data.protocolName);
        if (data.monitoredVitals) setRequiredVitals(data.monitoredVitals);
        setPrimaryCrcName(data.primary_crc_name || data.primaryCrcName || '');
        setPrimaryCrcPhone(data.primary_crc_phone || data.primaryCrcPhone || '');
        setStudyEmergencyPhone(data.study_emergency_phone || data.studyEmergencyPhone || '');
      }
    });

    const q = query(collection(db, "users", user.uid, "vitals"), orderBy("timestamp", "desc"));
    const unsubHistory = onSnapshot(q, s => setHistory(s.docs.map(d => ({id:d.id,...d.data()}))));
    
    const unsubAppt = subscribeToAppointments(user.uid, (data) => setAppointments(data));

    const unsubAlerts = subscribeToAlertHistory(user.uid, (data) => {
      const actives = data.filter(a => a.type !== 'MESSAGE' && a.status === 'unread');
      setActiveEmergencies(actives);
      if (triggerReason) setWidgetOpen(true);
    });

    const unsubEpro = subscribeToEproSubmissions(user.uid, (records) => setEproRecords(records));
    const unsubSideEffects = subscribeToSideEffectReports(user.uid, (records) => setSideEffectReports(records));
    
    return () => { unsubUser(); unsubHistory(); unsubAppt(); unsubAlerts(); unsubEpro(); unsubSideEffects(); };
  }, [user, triggerReason]);

  // --- AUTO CALCULATE BMI ---
  useEffect(() => {
    if (weight && height) {
      const hMeters = parseFloat(height) / 100;
      const wKg = parseFloat(weight);
      if (hMeters > 0 && wKg > 0) {
        setBmi((wKg / (hMeters * hMeters)).toFixed(1));
      } else {
        setBmi('');
      }
    }
  }, [weight, height]);

  const handleAdd = async () => {
    // Basic Validation for core vitals if required
    if (requiredVitals.includes('temperature') && !temp) return Alert.alert("Missing", "Enter Temperature");
    if (requiredVitals.includes('spo2') && !spo2) return Alert.alert("Missing", "Enter SpO2");
    
    const dataPayload = {
      timestamp: new Date().toISOString(),
      // Add if values exist
      ...(temp && { temperature: temp }),
      ...(bpSys && { bpSys }),
      ...(bpDia && { bpDia }),
      ...(heartRate && { heartRate }),
      ...(respRate && { respRate }),
      ...(spo2 && { spo2 }),
      ...(weight && { weight }),
      ...(height && { height }),
      ...(bmi && { bmi }),
      ...(glucoseFasting && { glucoseFasting }),
      ...(glucosePost && { glucosePost }),
      ...(pef && { pef }),
      ...(fev1 && { fev1 }),
      ...(inr && { inr }),
      ...(ketones && { ketones }),
      ...(waist && { waist }),
    };

    await addDoc(collection(db, "users", user.uid, "vitals"), dataPayload);

    const safetyResult = await handleLoggedVitalSafety({
      userId: user.uid,
      vitalPayload: dataPayload,
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
      Alert.alert("Success", "Vitals logged successfully.");
    }

    // Clear all
    setTemp(''); setBpSys(''); setBpDia(''); setHeartRate(''); setRespRate('');
    setSpo2(''); setWeight(''); setHeight(''); setBmi(''); setGlucoseFasting('');
    setGlucosePost(''); setPef(''); setFev1(''); setInr(''); setKetones(''); setWaist('');
  };

  const handleStatusUpdate = async (id, status) => { 
    try { await updateAppointmentStatus(user.uid, id, status); } 
    catch (e) { Alert.alert("Error", e.message); } 
  };
  
  const handleAIAlert = (reason) => { 
    setTriggerReason(null); 
    setTimeout(() => { setTriggerReason(reason || "AI Risk Detected"); setWidgetOpen(true); }, 100); 
  };

  const latestEproRecord =
    eproRecords.find((record) => record.status && record.status !== 'submitted') || eproRecords[0] || null;

  const openQuestionnaire = () => {
    router.push('/questionnaire');
  };

  // Helper to check if vital is required/enabled
  const show = (key) => requiredVitals.includes(key);

  return (
    <View style={{flex:1, backgroundColor:'#eef3f8'}}>
      <TopNavbar user={user} defaultRole="Patient" onLogout={onLogout} />
      
      <LiveChatWidget 
        user={user} role="patient" userName={nickname || "Patient"} 
        triggerReason={triggerReason} activeEmergencies={activeEmergencies}
        isOpenInitially={widgetOpen} 
        onClose={() => { setWidgetOpen(false); setTriggerReason(null); }} 
      />

      <ScrollView contentContainerStyle={{padding: 15, paddingBottom: 100}}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>Patient home</Text>
          <Text style={styles.heroTitle}>Welcome back{nickname ? `, ${nickname.split(' ')[0]}` : ''}</Text>
          <Text style={styles.heroText}>
            Complete today&apos;s tasks with fewer taps: questionnaire, appointments, vitals, and symptom guidance are all grouped below.
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
              <Text style={styles.heroStatLabel}>Alerts</Text>
              <Text style={styles.heroStatValue}>{activeEmergencies.length}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today’s ePRO</Text>
          <Text style={styles.infoText}>
            Complete your study questionnaire here. CRC sees only the operational status, not your patient-side
            chat context.
          </Text>
          {latestEproRecord ? (
            <View style={styles.eproSummaryBox}>
              <Text style={styles.eproSummaryText}>Status: {getStatusText(latestEproRecord.status)}</Text>
              <Text style={styles.eproSummaryText}>
                Assigned: {latestEproRecord.assigned_at ? new Date(latestEproRecord.assigned_at).toLocaleString() : 'Not recorded'}
              </Text>
              <Text style={styles.eproSummaryText}>
                Due: {latestEproRecord.due_at ? new Date(latestEproRecord.due_at).toLocaleString() : 'Not set'}
              </Text>
            </View>
          ) : (
            <Text style={styles.infoText}>No mirrored questionnaire status yet. Open the questionnaire to start today’s form.</Text>
          )}
          <TouchableOpacity onPress={openQuestionnaire} style={styles.btnPrimary}>
            <Text style={{color:'white', fontWeight:'bold'}}>Open ePRO Questionnaire</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI Symptom Guidance</Text>
          <Text style={styles.infoText}>
            Describe symptoms in the AI Assistant. It now extracts side effects automatically, documents them for audit,
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
            <Text style={{color:'white', fontWeight:'bold'}}>Open AI Assistant</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>My Appointments</Text>
          {appointments.length === 0 ? <Text>No upcoming appointments.</Text> : (
             appointments.map(a => (
               <View key={a.id} style={styles.apptRow}>
                 <View>
                   <Text style={{fontWeight:'bold'}}>{new Date(a.datetime).toLocaleString()}</Text>
                   <Text style={{color: a.status==='confirmed'?'green':a.status==='reschedule_requested'?'red':'orange'}}>
                     {getStatusText(a.status)}
                   </Text>
                 </View>
                 <View style={{gap: 5}}>
                   {a.status === 'pending' && <TouchableOpacity onPress={()=>handleStatusUpdate(a.id, 'confirmed')} style={[styles.btnSmall, {backgroundColor:'green'}]}><Text style={{color:'white'}}>Confirm</Text></TouchableOpacity>}
                   {(a.status === 'pending' || a.status === 'confirmed') && <TouchableOpacity onPress={()=>handleStatusUpdate(a.id, 'reschedule_requested')} style={[styles.btnSmall, {backgroundColor:'#6c757d'}]}><Text style={{color:'white'}}>Reschedule</Text></TouchableOpacity>}
                 </View>
               </View>
             ))
          )}
        </View>

        {/* VITALS INPUT CARD */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log Vitals</Text>
          <View style={{gap: 10}}>
            
            {show('temperature') && <TextInput style={styles.input} placeholder="Body Temperature (°C)" keyboardType="numeric" value={temp} onChangeText={setTemp} />}
            
            {show('bp') && (
              <View style={styles.row}>
                <TextInput style={[styles.input, {flex:1}]} placeholder="Systolic BP" keyboardType="numeric" value={bpSys} onChangeText={setBpSys} />
                <TextInput style={[styles.input, {flex:1}]} placeholder="Diastolic BP" keyboardType="numeric" value={bpDia} onChangeText={setBpDia} />
              </View>
            )}

            {show('heartRate') && <TextInput style={styles.input} placeholder="Heart Rate (bpm)" keyboardType="numeric" value={heartRate} onChangeText={setHeartRate} />}
            {show('respRate') && <TextInput style={styles.input} placeholder="Respiratory Rate" keyboardType="numeric" value={respRate} onChangeText={setRespRate} />}
            {show('spo2') && <TextInput style={styles.input} placeholder="SpO2 (%)" keyboardType="numeric" value={spo2} onChangeText={setSpo2} />}

            {(show('weight') || show('height')) && (
              <View style={styles.row}>
                {show('weight') && <TextInput style={[styles.input, {flex:1}]} placeholder="Weight (kg)" keyboardType="numeric" value={weight} onChangeText={setWeight} />}
                {show('height') && <TextInput style={[styles.input, {flex:1}]} placeholder="Height (cm)" keyboardType="numeric" value={height} onChangeText={setHeight} />}
              </View>
            )}
            
            {/* Display Calculated BMI */}
            {bmi !== '' && <Text style={{fontWeight:'bold', textAlign:'center', color:'#007bff'}}>Calculated BMI: {bmi}</Text>}

            {show('glucoseFasting') && <TextInput style={styles.input} placeholder="Fasting Glucose (mmol/L)" keyboardType="numeric" value={glucoseFasting} onChangeText={setGlucoseFasting} />}
            {show('glucosePost') && <TextInput style={styles.input} placeholder="Post-Meal Glucose (mmol/L)" keyboardType="numeric" value={glucosePost} onChangeText={setGlucosePost} />}
            
            {show('pef') && <TextInput style={styles.input} placeholder="PEF (L/min)" keyboardType="numeric" value={pef} onChangeText={setPef} />}
            {show('fev1') && <TextInput style={styles.input} placeholder="FEV1 (L)" keyboardType="numeric" value={fev1} onChangeText={setFev1} />}
            
            {show('inr') && <TextInput style={styles.input} placeholder="INR" keyboardType="numeric" value={inr} onChangeText={setInr} />}
            {show('ketones') && <TextInput style={styles.input} placeholder="Ketones (mmol/L)" keyboardType="numeric" value={ketones} onChangeText={setKetones} />}
            {show('waist') && <TextInput style={styles.input} placeholder="Waist Circumference (cm)" keyboardType="numeric" value={waist} onChangeText={setWaist} />}

            <TouchableOpacity onPress={handleAdd} style={styles.btnPrimary}><Text style={{color:'white', fontWeight:'bold'}}>Add Record</Text></TouchableOpacity>
          </View>
        </View>

        {/* HISTORY (Simplified View) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>History (Latest)</Text>
          {history.length === 0 ? <Text>No records.</Text> : history.slice(0, 5).map(r => (
            <View key={r.id} style={styles.historyRow}>
               <Text style={{fontWeight:'bold', marginBottom:5}}>{new Date(r.timestamp).toLocaleString()}</Text>
               <Text style={styles.historyText}>
                 {r.temperature && `Temp: ${r.temperature}°C  `} 
                 {r.bpSys && `BP: ${r.bpSys}/${r.bpDia}  `}
                 {r.spo2 && `SpO2: ${r.spo2}%  `}
                 {r.weight && `Wt: ${r.weight}kg  `}
                 {r.glucoseFasting && `Gluc(F): ${r.glucoseFasting}  `}
               </Text>
            </View>
          ))}
        </View>

      </ScrollView>

      <GeminiChatbot
        role="patient"
        userId={user.uid}
        userNickname={nickname}
        patientData={{appointments, vitals: history}}
        protocolUrl={protocolUrl}
        activeProtocolName={protocolName}
        onEmergencyTrigger={handleAIAlert}
        openSignal={assistantOpenSignal}
        contactContext={{
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
  eproSummaryBox: { backgroundColor: '#f5f9ff', borderWidth: 1, borderColor: '#d2def1', borderRadius: 12, padding: 12, marginBottom: 15 },
  eproSummaryText: { color: '#355070', marginBottom: 4 },
  contactBox: { backgroundColor: '#f8fbff', borderWidth: 1, borderColor: '#d9e6f4', borderRadius: 12, padding: 12, marginBottom: 10 },
  contactTitle: { color: '#14324a', fontWeight: '700', marginBottom: 6 },
  contactText: { color: '#52606d', lineHeight: 18, marginBottom: 4 },
  apptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eef3f8' },
  btnSmall: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#d3dde9', borderRadius: 12, padding: 12, backgroundColor: '#f8fbff', marginBottom: 0 },
  row: { flexDirection: 'row', gap: 10 },
  btnPrimary: { backgroundColor: '#0f609b', padding: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  historyRow: { paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eef3f8' },
  historyText: { fontSize: 12, color: '#52606d', lineHeight: 18 }
});

export default PatientHome;
