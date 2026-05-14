import { addDoc, collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { analyzeVitals } from '../components/EmergencyHandler';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import TopNavbar from '../components/TopNavbar';
import { db } from '../firebase';
import { subscribeToAlertHistory } from '../services/alertService';
import { subscribeToAppointments, updateAppointmentStatus } from '../services/appointmentService';
import { getStatusText } from '../utils';

const PatientHome = ({ user, onLogout }) => {
  const [temp, setTemp] = useState('');
  const [spo2, setSpo2] = useState('');
  const [bpSys, setBpSys] = useState('');
  const [bpDia, setBpDia] = useState('');
  
  const [history, setHistory] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [nickname, setNickname] = useState('');
  const [protocolUrl, setProtocolUrl] = useState(null);
  const [protocolName, setProtocolName] = useState(null);
  const [requiredVitals, setRequiredVitals] = useState(['temperature', 'spo2', 'bp']);

  const [widgetOpen, setWidgetOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState(null);
  const [activeEmergencies, setActiveEmergencies] = useState([]); // TRACK ALL ACTIVES

  useEffect(() => {
    // 1. User Profile Sync
    const unsubUser = onSnapshot(doc(db, "users", user.uid), (d) => {
      if(d.exists()) {
        const data = d.data();
        setNickname(data.nickname);
        setProtocolUrl(data.protocolUrl);
        setProtocolName(data.protocolName);
        if (data.monitoredVitals) setRequiredVitals(data.monitoredVitals);
      }
    });

    // 2. Vitals History Sync
    const q = query(collection(db, "users", user.uid, "vitals"), orderBy("timestamp", "desc"));
    const unsubHistory = onSnapshot(q, s => setHistory(s.docs.map(d => ({id:d.id,...d.data()}))));
    
    // 3. Appointments Sync
    const unsubAppt = subscribeToAppointments(user.uid, (data) => setAppointments(data));
    
    // 4. Alerts Sync (UPDATED FOR MULTIPLE ACTIVES)
    const unsubAlerts = subscribeToAlertHistory(user.uid, (data) => {
      // Find ALL unread emergencies
      const actives = data.filter(a => a.type === 'emergency' && a.status === 'unread');
      setActiveEmergencies(actives);

      // Auto-open if a NEW high risk is detected via vitals (triggerReason is set)
      if (triggerReason) {
        setWidgetOpen(true);
      }
    });
    
    return () => { unsubUser(); unsubHistory(); unsubAppt(); unsubAlerts(); };
  }, [user, triggerReason]);

  const handleAdd = async () => {
    if (requiredVitals.includes('temperature') && !temp) return Alert.alert("Missing", "Enter Temperature");
    if (requiredVitals.includes('spo2') && !spo2) return Alert.alert("Missing", "Enter SpO2");
    if (requiredVitals.includes('bp') && (!bpSys || !bpDia)) return Alert.alert("Missing", "Enter BP values");

    await addDoc(collection(db, "users", user.uid, "vitals"), { 
      temperature: temp, spo2, bpSys, bpDia, 
      timestamp: new Date().toISOString() 
    });
    
    const risks = analyzeVitals(temp, spo2, bpSys, bpDia);
    if (risks.length > 0) {
      setTriggerReason(risks.join(", ")); 
      setWidgetOpen(true); 
    }
    setTemp(''); setSpo2(''); setBpSys(''); setBpDia('');
  };

  const handleStatusUpdate = async (id, status) => { 
    try { await updateAppointmentStatus(user.uid, id, status); } 
    catch (e) { Alert.alert("Error", e.message); } 
  };
  
  const handleAIAlert = (reason) => { 
    setTriggerReason(null); 
    setTimeout(() => { setTriggerReason(reason || "AI Risk Detected"); setWidgetOpen(true); }, 100); 
  };

  return (
    <View style={{flex:1, backgroundColor:'#f0f2f5'}}>
      <TopNavbar user={user} defaultRole="Patient" onLogout={onLogout} />
      
      <LiveChatWidget 
        user={user} 
        role="patient" 
        userName={nickname || "Patient"} 
        triggerReason={triggerReason} 
        activeEmergencies={activeEmergencies} // PASS THE LIST
        isOpenInitially={widgetOpen} 
        onClose={() => { setWidgetOpen(false); setTriggerReason(null); }} 
      />

      <ScrollView contentContainerStyle={{padding: 15, paddingBottom: 100}}>
        
        {/* Appointments Card */}
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

        {/* Vitals Input Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log Vitals</Text>
          <View style={{gap: 10}}>
            {requiredVitals.includes('temperature') && (
              <TextInput style={styles.input} placeholder="Temp (°C)" keyboardType="numeric" value={temp} onChangeText={setTemp} />
            )}
            {requiredVitals.includes('spo2') && (
              <TextInput style={styles.input} placeholder="SpO₂ (%)" keyboardType="numeric" value={spo2} onChangeText={setSpo2} />
            )}
            {requiredVitals.includes('bp') && (
              <View style={{flexDirection:'row', gap:10}}>
                <TextInput style={[styles.input, {flex:1}]} placeholder="Sys BP" keyboardType="numeric" value={bpSys} onChangeText={setBpSys} />
                <TextInput style={[styles.input, {flex:1}]} placeholder="Dia BP" keyboardType="numeric" value={bpDia} onChangeText={setBpDia} />
              </View>
            )}
            <TouchableOpacity onPress={handleAdd} style={styles.btnPrimary}><Text style={{color:'white', fontWeight:'bold'}}>Add Record</Text></TouchableOpacity>
          </View>
        </View>

        {/* History Table */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>History</Text>
          {/* Header */}
          <View style={[styles.tableRow, {backgroundColor:'#f8f9fa'}]}>
             <Text style={[styles.col, {flex:2, fontWeight:'bold'}]}>Date</Text>
             <Text style={[styles.col, {fontWeight:'bold'}]}>Temp</Text>
             <Text style={[styles.col, {fontWeight:'bold'}]}>SpO₂</Text>
             <Text style={[styles.col, {fontWeight:'bold'}]}>BP</Text>
          </View>
          {/* Rows */}
          {history.map(r => (
            <View key={r.id} style={styles.tableRow}>
              <Text style={[styles.col, {flex:2}]}>{new Date(r.timestamp).toLocaleDateString()} {new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
              <Text style={styles.col}>{r.temperature || '-'}</Text>
              <Text style={styles.col}>{r.spo2 || '-'}</Text>
              <Text style={styles.col}>{(r.bpSys && r.bpDia) ? `${r.bpSys}/${r.bpDia}` : '-'}</Text>
            </View>
          ))}
        </View>

      </ScrollView>

      <GeminiChatbot role="patient" userNickname={nickname} patientData={{appointments, vitals: history}} protocolUrl={protocolUrl} activeProtocolName={protocolName} onEmergencyTrigger={handleAIAlert} />
    </View>
  );
};

const styles = StyleSheet.create({
  card: { backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  apptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, backgroundColor: 'white' },
  btnPrimary: { backgroundColor: '#007bff', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  col: { flex: 1, fontSize: 12, textAlign: 'center' }
});

export default PatientHome;