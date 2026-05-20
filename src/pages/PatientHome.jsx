import React, { useState, useEffect, useMemo } from 'react';
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';

import { analyzeVitals } from '../components/EmergencyHandler';
import GeminiChatbot from '../components/GeminiChatbot';
import LiveChatWidget from '../components/LiveChatWidget';
import TopNavbar from '../components/TopNavbar';

import { subscribeToAlertHistory } from '../services/alertService';
import { subscribeToAppointments, updateAppointmentStatus } from '../services/appointmentService';
import { getStatusText } from '../utils';

const PATIENT_INCIDENT_CONTEXT_LIMIT = 50;

function getPatientContextTimeMs(value) {
  if (!value) return 0;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return Number.isNaN(converted?.getTime?.()) ? 0 : converted.getTime();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortByRecentIncidentTime(rows = []) {
  return [...rows].sort((left, right) => {
    const leftTime = getPatientContextTimeMs(left.updated_at || left.created_at);
    const rightTime = getPatientContextTimeMs(right.updated_at || right.created_at);
    return rightTime - leftTime;
  });
}

function sanitizePatientAlertForPrompt(alert = {}) {
  return {
    id: alert.id || null,
    type: alert.type || null,
    reason: alert.reason || null,
    message: alert.message || null,
    status: alert.status || null,
    timestamp: alert.timestamp || null,
    threadClosed: Boolean(alert.threadClosed),
    resolvedAt: alert.resolvedAt || alert.resolved_at || null,
    lastSender: alert.lastSender || alert.senderRole || null,
    source_incident_id: alert.source_incident_id || null,
  };
}

function sanitizePatientIncidentForPrompt(incident = {}) {
  return {
    id: incident.id || null,
    event_key: incident.event_key || null,
    event_title: incident.event_title || null,
    incident_type: incident.incident_type || null,
    severity: incident.severity || null,
    status: incident.status || null,
    created_at: incident.created_at || null,
    updated_at: incident.updated_at || null,
    resolved_at: incident.resolved_at || incident.resolvedAt || null,
    linked_alert_paths: Array.isArray(incident.linked_alert_paths) ? incident.linked_alert_paths : [],
  };
}

const PatientHome = ({ user, onLogout }) => {
  const [temp, setTemp] = useState('');
  const [bpSys, setBpSys] = useState('');
  const [bpDia, setBpDia] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [respRate, setRespRate] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
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

  const [widgetOpen, setWidgetOpen] = useState(false);
  const [triggerReason, setTriggerReason] = useState(null);
  const [activeEmergencies, setActiveEmergencies] = useState([]);
  const [allAlerts, setAllAlerts] = useState([]); 
  const [patientIncidents, setPatientIncidents] = useState([]);
  const [notifications, setNotifications] = useState([]); 
  const [selectedChatAlert, setSelectedChatAlert] = useState(null);

  // Removed manual history.replaceState logic, handled by App.jsx

  useEffect(() => {
    const unsubUser = onSnapshot(doc(db, "users", user.uid), (d) => {
      if(d.exists()) {
        const data = d.data();
        setNickname(data.nickname);
        setProtocolUrl(data.protocolUrl);
        setProtocolName(data.protocolName);
        if (data.monitoredVitals) setRequiredVitals(data.monitoredVitals);
      }
    });

    const q = query(collection(db, "users", user.uid, "vitals"), orderBy("timestamp", "desc"), limit(20));
    const unsubHistory = onSnapshot(q, s => setHistory(s.docs.map(d => ({id:d.id,...d.data()}))));
    
    const unsubAppt = subscribeToAppointments(user.uid, (data) => setAppointments(data));
    
    const unsubAlerts = subscribeToAlertHistory(user.uid, (data) => {
      setAllAlerts(data);
      const actives = data.filter(a => a.type !== 'MESSAGE' && a.status === 'unread');
      setActiveEmergencies(actives);
      const notifs = data.filter(a => a.status === 'unread' && (a.lastSender === 'crc' || (a.senderRole === 'crc' && !a.lastSender)));
      setNotifications(notifs);
    });
    
    return () => { unsubUser(); unsubHistory(); unsubAppt(); unsubAlerts(); };
  }, [user.uid]);

  useEffect(() => {
    const incidentQuery = query(
      collection(db, 'incident_records'),
      where('linked_patient_ids', 'array-contains', user.uid),
      limit(PATIENT_INCIDENT_CONTEXT_LIMIT)
    );

    const unsubscribe = onSnapshot(
      incidentQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        setPatientIncidents(sortByRecentIncidentTime(rows));
      },
      (error) => {
        console.error('Patient incident context subscription failed:', error);
        setPatientIncidents([]);
      }
    );

    return () => unsubscribe();
  }, [user.uid]);

  const bmi = useMemo(() => {
    if (!weight || !height) return '';
    const hMeters = parseFloat(height) / 100;
    const wKg = parseFloat(weight);
    if (!(hMeters > 0 && wKg > 0)) return '';
    return (wKg / (hMeters * hMeters)).toFixed(1);
  }, [height, weight]);

  const handleAdd = async () => {
    if (requiredVitals.includes('temperature') && !temp) return alert("Missing: Enter Temperature");
    if (requiredVitals.includes('spo2') && !spo2) return alert("Missing: Enter SpO2");
    
    const dataPayload = {
      timestamp: new Date().toISOString(),
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

    try {
        await addDoc(collection(db, "users", user.uid, "vitals"), dataPayload);
        const risks = analyzeVitals(temp, spo2, bpSys, bpDia);
        if (risks.length > 0) {
          setTriggerReason(risks.join(", ")); 
          setWidgetOpen(true); 
        } else {
          alert("Success: Vitals Logged");
        }
        setTemp(''); setBpSys(''); setBpDia(''); setHeartRate(''); setRespRate('');
        setSpo2(''); setWeight(''); setHeight(''); setGlucoseFasting('');
        setGlucosePost(''); setPef(''); setFev1(''); setInr(''); setKetones(''); setWaist('');
    } catch (e) { alert("Error: " + e.message); }
  };

  const handleStatusUpdate = async (id, status) => { try { await updateAppointmentStatus(user.uid, id, status); } catch (e) { alert("Error: " + e.message); } };
  
  const handleAIAlert = (reason) => { 
    setTriggerReason(null); 
    setTimeout(() => { setTriggerReason(reason || "AI Risk Detected"); setWidgetOpen(true); }, 100); 
  };

  const handleNotificationClick = (alert) => {
    setSelectedChatAlert(alert);
    setWidgetOpen(true);
  };

  const show = (key) => requiredVitals.includes(key);
  const stablePatientData = useMemo(() => ({ id: user.uid, appointments, vitals: history }), [user.uid, appointments, history]);
  const patientAlertsForPrompt = useMemo(
    () => allAlerts.map((alert) => sanitizePatientAlertForPrompt(alert)),
    [allAlerts]
  );
  const patientIncidentsForPrompt = useMemo(
    () => patientIncidents.map((incident) => sanitizePatientIncidentForPrompt(incident)),
    [patientIncidents]
  );

  const handleHomeClick = () => {
    window.scrollTo({top:0, behavior:'smooth'});
  };

  return (
    <div style={styles.container}>
      <TopNavbar 
        user={user} 
        defaultRole="Patient" 
        onLogout={onLogout} 
        alerts={notifications} 
        onAlertClick={handleNotificationClick} 
        onHomeClick={handleHomeClick} 
      />
      
      <LiveChatWidget 
        user={user} role="patient" userName={nickname || "Patient"} 
        triggerReason={triggerReason} 
        activeEmergencies={activeEmergencies}
        allAlerts={allAlerts}
        existingAlert={selectedChatAlert} 
        isOpenInitially={widgetOpen} 
        onClose={() => { setWidgetOpen(false); setTriggerReason(null); setSelectedChatAlert(null); }} 
      />

      <div style={styles.scrollContainer}>
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>My Appointments</h2>
          {appointments.length === 0 ? <div>No upcoming appointments.</div> : (
             appointments.map(a => (
               <div key={a.id} style={styles.apptRow}>
                 <div>
                   <div style={{fontWeight:'bold', fontSize: '15px'}}>{new Date(a.datetime).toLocaleString()}</div>
                   <div style={{color: a.status==='confirmed'?'#28a745':a.status==='reschedule_requested'?'#ffc107':'#ff9800', fontWeight:'bold', fontSize:'13px', marginTop: '4px'}}>{getStatusText(a.status).toUpperCase()}</div>
                 </div>
                 <div style={{display: 'flex', gap: '8px'}}>
                   {a.status === 'pending' && <button onClick={()=>handleStatusUpdate(a.id, 'confirmed')} style={{...styles.btnSmall, backgroundColor:'#28a745'}}>Confirm</button>}
                   {(a.status === 'pending' || a.status === 'confirmed') && <button onClick={()=>handleStatusUpdate(a.id, 'reschedule_requested')} style={{...styles.btnSmall, backgroundColor:'#6c757d'}}>Reschedule</button>}
                 </div>
               </div>
             ))
          )}
        </div>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Log Vitals</h2>
          <div style={{display: 'flex', flexDirection: 'column', gap: '15px'}}>
            {show('bp') && <div style={styles.row}><input style={styles.input} placeholder="Sys BP" type="number" value={bpSys} onChange={e => setBpSys(e.target.value)} /><input style={styles.input} placeholder="Dia BP" type="number" value={bpDia} onChange={e => setBpDia(e.target.value)} /></div>}
            {show('temperature') && <input style={styles.input} placeholder="Body Temperature (°C)" type="number" value={temp} onChange={e => setTemp(e.target.value)} />}
            {show('spo2') && <input style={styles.input} placeholder="SpO2 (%)" type="number" value={spo2} onChange={e => setSpo2(e.target.value)} />}
            {show('heartRate') && <input style={styles.input} placeholder="Heart Rate (bpm)" type="number" value={heartRate} onChange={e => setHeartRate(e.target.value)} />}
            {show('respRate') && <input style={styles.input} placeholder="Respiratory Rate" type="number" value={respRate} onChange={e => setRespRate(e.target.value)} />}
            {(show('weight') || show('height')) && <div style={styles.row}>{show('weight') && <input style={styles.input} placeholder="Weight (kg)" type="number" value={weight} onChange={e => setWeight(e.target.value)} />}{show('height') && <input style={styles.input} placeholder="Height (cm)" type="number" value={height} onChange={e => setHeight(e.target.value)} />}</div>}
            {bmi !== '' && <div style={{fontWeight:'bold', textAlign:'center', color:'#007bff'}}>Calculated BMI: {bmi}</div>}
            {show('glucoseFasting') && <input style={styles.input} placeholder="Fasting Glucose (mmol/L)" type="number" value={glucoseFasting} onChange={e => setGlucoseFasting(e.target.value)} />}
            {show('glucosePost') && <input style={styles.input} placeholder="Post-Meal Glucose (mmol/L)" type="number" value={glucosePost} onChange={e => setGlucosePost(e.target.value)} />}
            {(show('pef') || show('fev1')) && <div style={styles.row}>{show('pef') && <input style={styles.input} placeholder="PEF (L/min)" type="number" value={pef} onChange={e => setPef(e.target.value)} />}{show('fev1') && <input style={styles.input} placeholder="FEV1 (L)" type="number" value={fev1} onChange={e => setFev1(e.target.value)} />}</div>}
            {show('inr') && <input style={styles.input} placeholder="INR" type="number" value={inr} onChange={e => setInr(e.target.value)} />}
            {show('ketones') && <input style={styles.input} placeholder="Ketones (mmol/L)" type="number" value={ketones} onChange={e => setKetones(e.target.value)} />}
            {show('waist') && <input style={styles.input} placeholder="Waist Circumference (cm)" type="number" value={waist} onChange={e => setWaist(e.target.value)} />}
            <button onClick={handleAdd} style={styles.btnPrimary}>Add Record</button>
          </div>
        </div>

        <div style={styles.card}>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:'10px', alignItems:'center'}}>
             <h2 style={{...styles.cardTitle, marginBottom:0}}>History</h2>
             <div style={{display:'flex', gap:'20px', fontSize:'13px', color:'#666', fontWeight:'bold'}}><span>Temp</span><span>SpO₂</span><span>BP</span></div>
          </div>
          <hr style={{borderTop: '1px solid #eee', margin: '0 0 10px 0', borderBottom:'none'}} />
          {history.length === 0 ? <div>No records.</div> : history.slice(0, 5).map(r => (
            <div key={r.id} style={styles.historyRow}>
               <div style={{fontWeight:'bold', color:'#333', fontSize:'14px'}}>{new Date(r.timestamp).toLocaleString()}</div>
               <div style={{display:'flex', gap:'25px', fontSize:'14px', color:'#333'}}>
                 <div style={{width:'30px', textAlign:'center'}}>{r.temperature ? r.temperature : '-'}</div>
                 <div style={{width:'30px', textAlign:'center'}}>{r.spo2 ? r.spo2 : '-'}</div>
                 <div style={{width:'60px', textAlign:'right'}}>{(r.bpSys && r.bpDia) ? `${r.bpSys}/${r.bpDia}` : '-'}</div>
               </div>
            </div>
          ))}
        </div>
      </div>

      <GeminiChatbot 
        role="patient" 
        userId={user.uid} 
        userNickname={nickname} 
        patientData={stablePatientData} 
        patientVitals={history}
        patientAppointments={appointments}
        patientAlerts={patientAlertsForPrompt}
        patientIncidents={patientIncidentsForPrompt}
        protocolUrl={protocolUrl} 
        activeProtocolName={protocolName} 
        onEmergencyTrigger={handleAIAlert} 
      />
    </div>
  );
};

const styles = {
  container: { flex: 1, backgroundImage: 'url(/background.png)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  scrollContainer: { padding: '20px', paddingBottom: '100px', maxWidth: '800px', margin: '0 auto', width: '100%', boxSizing: 'border-box' },
  card: { backgroundColor: 'white', padding: '25px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', border: '1px solid #e1e4e8' },
  cardTitle: { fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', marginTop: 0, color: '#333' },
  apptRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 0', borderBottom: '1px solid #eee' },
  btnSmall: { padding: '8px 12px', borderRadius: '4px', alignItems: 'center', border: 'none', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' },
  input: { border: '1px solid #ced4da', borderRadius: '4px', padding: '12px 15px', backgroundColor: 'white', marginBottom: '0', boxSizing: 'border-box', width: '100%', fontSize: '16px', color: '#495057' },
  row: { display: 'flex', flexDirection: 'row', gap: '15px' },
  btnPrimary: { backgroundColor: '#007bff', padding: '12px', borderRadius: '4px', alignItems: 'center', marginTop: '10px', border: 'none', color: 'white', fontWeight: 'bold', cursor: 'pointer', width: '100%', fontSize: '16px' },
  historyRow: { display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f0f0f0', alignItems: 'center' }
};

export default PatientHome;
