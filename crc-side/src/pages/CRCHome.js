import {
  collection, doc, getDoc, limit, onSnapshot, orderBy, query, updateDoc, where
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, BackHandler, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import PatientList from '../components/PatientList';
import ProtocolManager from '../components/ProtocolManager';
import TopNavbar from '../components/TopNavbar';
import { db } from '../firebase';
import { resolveAlert, subscribeToAlertHistory, subscribeToUnresolvedAlerts } from '../services/alertService';
import {
  createAppointment, purgeOldAppointments, subscribeToAppointments, suggestAppointmentDate, updateAppointmentStatus
} from '../services/appointmentService';
import { getStatusText } from '../utils';

// ALL AVAILABLE VITALS
const VITAL_OPTIONS = [
  { key: 'temperature', label: 'Body Temp' },
  { key: 'bp', label: 'Blood Pressure' },
  { key: 'heartRate', label: 'Heart Rate' },
  { key: 'respRate', label: 'Resp. Rate' },
  { key: 'spo2', label: 'SpO2' },
  { key: 'weight', label: 'Weight' },
  { key: 'height', label: 'Height' }, // Needed for BMI
  { key: 'glucoseFasting', label: 'Glucose (Fasting)' },
  { key: 'glucosePost', label: 'Glucose (Post)' },
  { key: 'pef', label: 'PEF (Asthma)' },
  { key: 'fev1', label: 'FEV1' },
  { key: 'inr', label: 'INR (Clotting)' },
  { key: 'ketones', label: 'Ketones' },
  { key: 'waist', label: 'Waist Circ.' }
];

const CRCHome = ({ user, onLogout }) => {
  const [crcName, setCrcName] = useState(''); 
  const [patients, setPatients] = useState([]);
  const [selPatient, setSelPatient] = useState(null);
  const [pAppts, setPAppts] = useState([]);
  const [pVitals, setPVitals] = useState([]); 
  const [newDate, setNewDate] = useState('');
  
  const [suggestedDate, setSuggestedDate] = useState('');
  const [suggestedReason, setSuggestedReason] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [chatAlert, setChatAlert] = useState(null);
  
  const [tempPatientID, setTempPatientID] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  
  // Initialize with all false
  const [tempVitalsConfig, setTempVitalsConfig] = useState({});

  const prevAlertCountRef = useRef(0);

  useEffect(() => { getDoc(doc(db, "users", user.uid)).then(d => d.exists() && setCrcName(d.data().nickname || "CRC")); }, [user]);

  useEffect(() => {
    const q = query(collection(db, "users"), where("role", "==", "patient"), limit(20));
    const unsub = onSnapshot(q, (snapshot) => {
       setPatients(snapshot.docs.map(d => ({id:d.id, ...d.data()})));
       setSelPatient((current) => {
         if (!current) return current;
         const updated = snapshot.docs.find(d => d.id === current.id);
         return updated ? {id: updated.id, ...updated.data()} : current;
       });
    });
    return () => unsub();
  }, []);

  useEffect(() => { 
    const u = subscribeToUnresolvedAlerts(d => { 
      setUrgentAlerts(d); 
      if(d.length > prevAlertCountRef.current){ Alert.alert("New Alert", `⚠️ ${d[0].reason}`); } 
      prevAlertCountRef.current=d.length; 
    }); 
    return ()=>u(); 
  }, []);

  useEffect(() => {
    const backAction = () => { if (selPatient) { setSelPatient(null); return true; } return false; };
    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  }, [selPatient]);

  useEffect(() => {
    if (!selPatient?.id) {
      setPAppts([]);
      setPVitals([]);
      return undefined;
    }

    const unsubAppts = subscribeToAppointments(selPatient.id, (data) => setPAppts(data));
    const unsubAlerts = subscribeToAlertHistory(selPatient.id, () => {});
    const qVitals = query(
      collection(db, "users", selPatient.id, "vitals"),
      orderBy("timestamp", "desc"),
      limit(20)
    );
    const unsubVitals = onSnapshot(qVitals, (s) => setPVitals(s.docs.map(d => ({id:d.id, ...d.data()}))));

    return () => {
      unsubAppts();
      unsubAlerts();
      unsubVitals();
    };
  }, [selPatient?.id]);

  const selectP = (p) => {
    if(!p) return;
    setSelPatient(p); 
    setSuggestedDate(''); setSuggestedReason('');
    setTempPatientID(p.hospitalPatientId || ''); 
    setTempEmail(p.email || '');
    
    // Load existing config or default to basic 3
    const savedConfig = p.monitoredVitals || ['temperature', 'spo2', 'bp'];
    const configObj = {};
    VITAL_OPTIONS.forEach(opt => {
      configObj[opt.key] = savedConfig.includes(opt.key);
    });
    setTempVitalsConfig(configObj);

    purgeOldAppointments(p.id); 
  };

  const handleNavAlertClick = (alert) => { 
    const target = patients.find(p => p.id === alert.uid); 
    if (target) { selectP(target); setChatAlert(alert); } 
    else { Alert.alert("Error", "Patient data loading..."); setChatAlert(alert); } 
  };

  const handleSuggestDate = async () => { 
    if (!selPatient?.protocolUrl) return setSuggestedReason("No protocol assigned."); 
    setIsSuggesting(true); setSuggestedReason(`Reading ${selPatient.protocolName}...`); setSuggestedDate(''); 
    try { 
      const result = await suggestAppointmentDate(selPatient.protocolUrl, pAppts); 
      setSuggestedDate(result.date); setSuggestedReason(result.reason); 
      if (result.date) setNewDate(result.date); 
    } catch (error) { setSuggestedReason("Error: " + error.message); } 
    finally { setIsSuggesting(false); } 
  };

  const handleMarkComplete = async (apptId) => { 
    Alert.alert("Confirm", "Mark as attended?", [{ text: "Cancel" }, { text: "Confirm", onPress: async () => { try { await updateAppointmentStatus(selPatient.id, apptId, 'completed'); } catch (e) { Alert.alert("Error", e.message); } }}]);
  };

  const handleQuickResolve = async (alertId) => {
    Alert.alert("Confirm Resolve", "Mark resolved?", [{ text: "Cancel" }, { text: "Resolve", onPress: async () => { try { await resolveAlert(doc(db, "alerts", alertId)); } catch (e) { Alert.alert("Error", e.message); } }}]);
  };

  const handleVitalToggle = (key) => setTempVitalsConfig(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSaveInfo = async () => {
    if(!selPatient) return;
    try {
      const vitalsArray = Object.keys(tempVitalsConfig).filter(key => tempVitalsConfig[key]);
      await updateDoc(doc(db, "users", selPatient.id), { hospitalPatientId: tempPatientID, email: tempEmail, monitoredVitals: vitalsArray });
      Alert.alert("Saved", "Patient Info Updated");
    } catch(e) { Alert.alert("Error", e.message); }
  };

  const schedule = async () => { 
    try { await createAppointment(selPatient.id, newDate); setNewDate(''); Alert.alert("Success", "Scheduled"); } catch (e) { Alert.alert("Error", e.message); } 
  };

  const enrichedAlerts = urgentAlerts.map(a => ({ ...a, patientName: patients.find(p => p.id === a.uid)?.nickname || a.senderName || "Unknown" }));

  const renderAlertsBanner = () => (
    urgentAlerts.length > 0 && (
      <View style={styles.alertContainer}>
        <Text style={styles.alertHeader}>🚨 Active Emergencies ({urgentAlerts.length})</Text>
        <ScrollView style={styles.alertScroll} nestedScrollEnabled={true}>
          {enrichedAlerts.map(a => (
            <View key={a.id} style={styles.alertRow}>
              <View style={{flex: 1, marginRight: 10}}>
                  <Text style={{flexWrap: 'wrap'}}>
                      <Text style={{fontWeight: 'bold'}}>{a.patientName}</Text>: <Text style={{color:'red'}}>{a.reason}</Text>
                  </Text>
              </View>
              <View style={{flexDirection: 'row', gap: 5}}>
                  <TouchableOpacity onPress={()=>setChatAlert(a)} style={styles.btnSmall}><Text style={{color:'white'}}>Chat</Text></TouchableOpacity>
                  <TouchableOpacity onPress={()=>handleQuickResolve(a.id)} style={[styles.btnSmall, {backgroundColor: 'green'}]}><Text style={{color:'white'}}>✓</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    )
  );

  return (
    <View style={{flex: 1, backgroundColor: '#f0f2f5'}}>
      <TopNavbar user={user} defaultRole="CRC" onLogout={onLogout} alerts={enrichedAlerts} onAlertClick={handleNavAlertClick} />
      
      <LiveChatWidget 
        user={user} role="crc" userName={crcName} existingAlert={chatAlert} 
        activeEmergencies={enrichedAlerts} 
        onClose={() => setChatAlert(null)} 
        recipientId={selPatient?.id} recipientName={selPatient?.nickname} 
      />

      <ScrollView contentContainerStyle={{padding: 15, paddingBottom: 100}}>
        {renderAlertsBanner()}

        {!selPatient ? (
          <View>
            <PatientList patients={patients} selectedPatientId={null} onSelect={selectP} />
            <ProtocolManager selectedPatient={null} />
          </View>
        ) : (
          <View>
            <TouchableOpacity onPress={() => setSelPatient(null)} style={{marginBottom:10}}>
              <Text style={{color:'#007bff', fontSize:16}}>← Back to List</Text>
            </TouchableOpacity>

            <View style={styles.card}>
              <Text style={styles.title}>{selPatient.nickname}</Text>
              
              <View style={styles.section}>
                <Text style={styles.subTitle}>Edit Info</Text>
                <TextInput style={styles.input} value={tempPatientID} onChangeText={setTempPatientID} placeholder="Hospital ID" />
                <TextInput style={styles.input} value={tempEmail} onChangeText={setTempEmail} placeholder="Email" keyboardType="email-address" />
                
                <Text style={{fontWeight:'bold', marginTop:10}}>Monitored Vitals:</Text>
                
                {/* NEW: DYNAMIC VITALS GRID */}
                <View style={styles.vitalsGrid}>
                  {VITAL_OPTIONS.map(opt => (
                    <TouchableOpacity key={opt.key} onPress={() => handleVitalToggle(opt.key)} style={styles.checkboxRow}>
                      <Text style={{fontSize:18}}>{tempVitalsConfig[opt.key] ? '☑' : '☐'}</Text>
                      <Text style={{marginLeft:5, fontSize: 12}}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity onPress={handleSaveInfo} style={[styles.btnPrimary, {marginTop:10}]}><Text style={{color:'white'}}>Save Changes</Text></TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.subTitle}>🩺 Vitals History</Text>
                {pVitals.slice(0, 5).map(r => (
                  <View key={r.id} style={styles.tableRow}>
                    <Text style={[styles.col, {flex:2}]}>{new Date(r.timestamp).toLocaleDateString()}</Text>
                    {/* Just showing basic ones in summary, use detail view for full */}
                    <Text style={styles.col}>{r.bpSys ? `${r.bpSys}/${r.bpDia}` : '-'}</Text>
                    <Text style={styles.col}>{r.spo2 ? `${r.spo2}%` : '-'}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.section}>
                <Text style={styles.subTitle}>Protocol</Text>
                <ProtocolManager selectedPatient={selPatient} />
              </View>

              <View style={styles.section}>
                <Text style={styles.subTitle}>📅 Scheduler</Text>
                <View style={{flexDirection:'row', gap:10}}>
                  <TextInput style={[styles.input, {flex:1}]} value={newDate} onChangeText={setNewDate} placeholder="YYYY-MM-DD HH:mm" />
                  <TouchableOpacity onPress={schedule} style={styles.btnPrimary}><Text style={{color:'white'}}>Add</Text></TouchableOpacity>
                </View>
                {/* AI Suggestion */}
                <View style={styles.aiBox}>
                  <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                    <Text style={{fontWeight:'bold', color:'#0056b3'}}>🤖 Gemini Suggestion</Text>
                    <TouchableOpacity onPress={handleSuggestDate} disabled={isSuggesting}><Text style={{color:'#0056b3'}}>{isSuggesting ? 'Thinking...' : '✨ Suggest'}</Text></TouchableOpacity>
                  </View>
                  {suggestedDate ? (<Text style={{marginTop:5}}>📅 {new Date(suggestedDate).toLocaleString()}{'\n'}<Text style={{fontStyle:'italic', fontSize:12}}>{suggestedReason}</Text></Text>) : <Text style={{fontSize:12, color:'#666', fontStyle:'italic'}}>{suggestedReason}</Text>}
                </View>
                {pAppts.map(a => (
                    <View key={a.id} style={styles.apptRow}>
                      <Text style={{fontSize:12}}>{new Date(a.datetime).toLocaleString()} - <Text style={{fontWeight:'bold'}}>{getStatusText(a.status)}</Text></Text>
                      {a.status === 'confirmed' && <TouchableOpacity onPress={() => handleMarkComplete(a.id)}><Text style={{color:'green'}}>✓</Text></TouchableOpacity>}
                    </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <GeminiChatbot role="crc" patientData={selPatient ? { ...selPatient, vitals: pVitals, appointments: pAppts } : null} protocolUrl={selPatient?.protocolUrl} activeProtocolName={selPatient?.protocolName} />
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 15 },
  subTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#444' },
  section: { marginBottom: 20, borderBottomWidth: 1, borderColor: '#eee', paddingBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 10 },
  btnPrimary: { backgroundColor: '#007bff', padding: 10, borderRadius: 5, alignItems: 'center' },
  btnSmall: { backgroundColor: '#007bff', padding: 5, borderRadius: 4 },
  alertContainer: { backgroundColor: '#ffebee', borderRadius: 8, marginBottom: 15, borderLeftWidth: 5, borderLeftColor: '#d32f2f', maxHeight: 250, overflow: 'hidden' },
  alertHeader: { color: '#d32f2f', fontWeight: 'bold', padding: 10, backgroundColor: '#ffcdd2', borderTopRightRadius: 8 },
  alertScroll: { padding: 10 },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottomWidth: 1, borderColor: '#ffcdd2', paddingBottom: 5 },
  aiBox: { backgroundColor: '#e7f1ff', padding: 10, borderRadius: 5, marginVertical: 10, borderStyle: 'dashed', borderWidth: 1, borderColor: '#0056b3' },
  apptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  col: { flex: 1, fontSize: 12, textAlign: 'center' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', width: '45%', marginBottom: 5 }
});

export default CRCHome;
