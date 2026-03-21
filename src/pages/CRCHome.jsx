import React, { useState, useEffect, useRef, useMemo } from 'react'; 
import { 
  doc, getDoc, onSnapshot, query, collection, 
  where, orderBy, updateDoc, deleteDoc, collectionGroup 
} from 'firebase/firestore';
import { db } from '../firebase';
import { useSearchParams } from 'react-router-dom';

// Components
import TopNavbar from '../components/TopNavbar';
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
  suggestAppointmentDate, 
  subscribeToAppointments,
  purgeOldAppointments,
  updateAppointmentStatus 
} from '../services/appointmentService';
import { subscribeToUnresolvedAlerts, subscribeToAlertHistory } from '../services/alertService';
import {
  getBrowserPushState,
  registerBrowserPushSubscription,
  showForegroundIncidentNotification,
} from '../services/browserPushService';
import { subscribeToIncidentRecords } from '../services/incidentService';

// --- CONFIGURATION ---
const AI_SUGGESTION_TITLE = "AI Scheduler"; 

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
  { key: 'waist', label: 'Waist Circ.' }
];

const CRCHome = ({ user, onLogout }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [crcName, setCrcName] = useState(''); 
  const [patients, setPatients] = useState([]);
  const [crcUsers, setCrcUsers] = useState([]);
  
  // Selection State
  const [selectedPatientId, setSelectedPatientId] = useState(null); 
  const [selPatient, setSelPatient] = useState(null);
  
  const [pVitals, setPVitals] = useState([]);
  const [pAppts, setPAppts] = useState([]);
  const [pAlerts, setPAlerts] = useState([]); 
  const [globalAlerts, setGlobalAlerts] = useState([]); 
  const [eproEntries, setEproEntries] = useState([]);
  const [incidents, setIncidents] = useState([]);
  
  const [newDate, setNewDate] = useState('');
  
  // AI & Alert State
  const [suggestedDate, setSuggestedDate] = useState('');
  const [suggestedReason, setSuggestedReason] = useState('');
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [chatAlert, setChatAlert] = useState(null);
  const [activeIncident, setActiveIncident] = useState(null);
  const [pushState, setPushState] = useState(() => getBrowserPushState());
  const [toastMsg, setToastMsg] = useState(null);
  const prevAlertCountRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const foregroundNotificationRef = useRef(new Set());

  // Admin Info State
  const [tempPatientID, setTempPatientID] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [tempPrimaryCrcId, setTempPrimaryCrcId] = useState('');
  const [tempVitalsConfig, setTempVitalsConfig] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // 1. Initial Load
  useEffect(() => { 
    getDoc(doc(db, "users", user.uid)).then(d => d.exists() && setCrcName(d.data().nickname || "CRC")); 
  }, [user]);

  // FIX: Removed dependency on selectedPatientId to prevent flashing/re-fetching
  useEffect(() => {
    const q = query(collection(db, "users"), where("role", "==", "patient"));
    const unsub = onSnapshot(q, (snapshot) => {
       const list = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
       setPatients(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const crcQuery = query(collection(db, "users"), where("role", "==", "crc"));
    const unsub = onSnapshot(crcQuery, (snapshot) => {
      const list = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setCrcUsers(list);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    setPushState(getBrowserPushState());

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      registerBrowserPushSubscription(user.uid)
        .then(() => setPushState(getBrowserPushState()))
        .catch((error) => console.error('Browser push sync failed:', error));
    }
  }, [user.uid]);

  // Update selection object when list or ID changes
  useEffect(() => {
    if (selectedPatientId && patients.length > 0) {
      const updated = patients.find(p => p.id === selectedPatientId);
      if (updated) setSelPatient(updated);
    }
  }, [selectedPatientId, patients]);

  // 2. Global Alert Monitoring
  useEffect(() => { 
    // A. Active/Urgent Alerts (For the Red Box)
    const unsubActive = subscribeToUnresolvedAlerts(d => { 
      const incomingAlerts = d; 
      setUrgentAlerts(incomingAlerts); 
      
      if (!isFirstLoadRef.current && incomingAlerts.length > prevAlertCountRef.current) { 
        const n = incomingAlerts[0]; 
        if (n && n.lastSender !== 'crc') { 
            setToastMsg(`⚠️ New Alert: ${n.patientName || 'Patient'} - ${n.reason}`); 
            setTimeout(() => setToastMsg(null), 5000); 
        }
      } 
      prevAlertCountRef.current = incomingAlerts.length; 
      isFirstLoadRef.current = false;
    }); 

    // B. DIRECT FIREBASE QUERY FOR GLOBAL HISTORY
    // FIX: Removed 'orderBy' from query to avoid Index errors. Sorting in JS instead.
    const qGlobal = query(collectionGroup(db, 'alerts'));

    const unsubGlobal = onSnapshot(qGlobal, (snapshot) => {
      const allData = snapshot.docs.map(d => {
        const parentDoc = d.ref.parent.parent;
        const uid = parentDoc ? parentDoc.id : 'unknown';
        return { 
          id: d.id, 
          ref: d.ref, 
          uid: uid, 
          ...d.data() 
        };
      });

      // Sort client-side to ensure it works without composite indexes
      allData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      setGlobalAlerts(allData);
    }, (error) => {
      console.error("Global History Error:", error);
    });

    return () => { unsubActive(); unsubGlobal(); }; 
  }, []);

  useEffect(() => {
    const qEpro = query(collectionGroup(db, 'epro_submissions'));

    const unsubEpro = onSnapshot(qEpro, (snapshot) => {
      const allData = snapshot.docs.map((d) => {
        const parentDoc = d.ref.parent.parent;
        const uid = parentDoc ? parentDoc.id : 'unknown';

        return {
          id: d.id,
          uid,
          ...d.data(),
        };
      });

      allData.sort((a, b) => {
        const aTime = new Date(a.submitted_at || a.updated_at || a.assigned_at || 0).getTime();
        const bTime = new Date(b.submitted_at || b.updated_at || b.assigned_at || 0).getTime();
        return bTime - aTime;
      });

      setEproEntries(allData);
    }, (error) => {
      console.error('ePRO Mirror Error:', error);
    });

    return () => unsubEpro();
  }, []);

  useEffect(() => {
    let isFirstIncidentLoad = true;
    const requestedIncidentId = searchParams.get('incident');

    const unsubIncidents = subscribeToIncidentRecords(
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

            if (shouldNotify) {
              showForegroundIncidentNotification(incident);
            }
          });
        }

        if (requestedIncidentId) {
          const matchedIncident = visibleRecords.find((incident) => incident.id === requestedIncidentId);
          if (matchedIncident) {
            setActiveIncident(matchedIncident);
          }
        }
      },
      (error) => console.error('Incident subscription failed:', error)
    );

    return () => unsubIncidents();
  }, [searchParams, user.uid]);

  // 3. Safe Patient Data Subscription
  useEffect(() => {
    if (!selectedPatientId) {
      setSelPatient(null);
      setPVitals([]);
      setPAppts([]);
      setPAlerts([]);
      return;
    }

    const qVitals = query(collection(db, "users", selectedPatientId, "vitals"), orderBy("timestamp", "desc"));
    const unsubVitals = onSnapshot(qVitals, s => setPVitals(s.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubAppts = subscribeToAppointments(selectedPatientId, (data) => setPAppts(data));
    const unsubAlerts = subscribeToAlertHistory(selectedPatientId, (data) => setPAlerts(data));

    return () => {
      unsubVitals();
      unsubAppts();
      unsubAlerts();
    };
  }, [selectedPatientId]);

  // --- HANDLERS ---
  const selectP = (p) => {
    if(!p) {
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
    
    setSelectedPatientId(p.id);
    setSelPatient(p); 
    setTempPatientID(p.hospitalPatientId || ''); 
    setTempEmail(p.email || '');
    setTempPrimaryCrcId(p.primary_crc_id || p.primaryCrcId || user.uid);
    setSuggestedDate(''); 
    setSuggestedReason('');
    setSuccessMsg(''); 

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
    else { alert("Patient loading..."); setChatAlert(alert); } 
  };

  const handleHomeClick = () => {
    selectP(null); 
  };

  const handleEnablePush = async () => {
    try {
      await registerBrowserPushSubscription(user.uid);
      setPushState(getBrowserPushState());
      alert('Browser alerts enabled for this CRC session.');
    } catch (error) {
      alert('Unable to enable browser alerts: ' + error.message);
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
    const targetPatient = patients.find((patient) => patient.id === uid);
    if (targetPatient) {
      selectP(targetPatient);
    }

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
    if(!window.confirm("Confirm attended?")) return; 
    try { await updateAppointmentStatus(selPatient.id, apptId, 'completed'); } 
    catch (e) { alert("Error: " + e.message); } 
  };

  const handleSaveInfo = async () => {
    if(!selPatient) return;
    setIsSaving(true); 
    setSuccessMsg(''); 
    try {
      const vitalsArray = Object.keys(tempVitalsConfig).filter(key => tempVitalsConfig[key]);
      const assignedCrc = crcUsers.find((entry) => entry.id === tempPrimaryCrcId);
      await updateDoc(doc(db, "users", selPatient.id), {
        hospitalPatientId: tempPatientID, 
        email: tempEmail,
        monitoredVitals: vitalsArray,
        primary_crc_id: tempPrimaryCrcId || null,
        primary_crc_name: assignedCrc?.nickname || assignedCrc?.email || null,
      });
      setSuccessMsg("Saved Patient Info & Vitals Config!");
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch(e) { 
      alert(e.message); 
    } finally {
      setIsSaving(false); 
    }
  };

  const handleDeletePatient = async () => {
    if (!selPatient) return;
    const confirmation = window.prompt(
      `⚠️ WARNING: This will permanently delete patient "${selPatient.nickname}".\n\nTo confirm, type "CONFIRM" in the box below:`
    );
    if (confirmation !== "CONFIRM") return;
    
    try {
      await deleteDoc(doc(db, "users", selPatient.id));
      alert(`Patient "${selPatient.nickname}" has been deleted.`);
      selectP(null); 
    } catch (e) {
      alert("Error deleting patient: " + e.message);
    }
  };

  const schedule = async () => { 
    try { await createAppointment(selPatient.id, newDate); setNewDate(''); alert("Scheduled"); } 
    catch (e) { alert(e.message); } 
  };

  const enrichedAlerts = urgentAlerts.map(a => ({ ...a, patientName: patients.find(p => p.id === a.uid)?.nickname || a.senderName || "Unknown" }));
  
  // Map global alerts to include patient names
  const enrichedGlobalAlerts = globalAlerts.map(a => ({ 
    ...a, 
    patientName: patients.find(p => p.id === a.uid)?.nickname || a.senderName || "Unknown" 
  }));

  const getStatusStyle = (status) => { 
    switch(status) { 
      case 'confirmed': return { color: '#28a745', fontWeight: 'bold' }; 
      case 'reschedule_requested': return { color: '#ffc107', fontWeight: 'bold' }; 
      case 'pending': return { color: '#dc3545', fontWeight: 'bold' }; 
      case 'completed': return { color: '#6c757d', fontWeight: 'bold', textDecoration: 'line-through' }; 
      default: return { color: '#333' }; 
    } 
  };

  const stablePatientData = useMemo(() => {
    return selPatient ? { ...selPatient, vitals: pVitals, appointments: pAppts } : null;
  }, [selPatient, pVitals, pAppts]);

  useEffect(() => {
    if (!activeIncident) return;
    const refreshedIncident = incidents.find((incident) => incident.id === activeIncident.id);
    if (refreshedIncident) {
      setActiveIncident(refreshedIncident);
    }
  }, [activeIncident, incidents]);

  const selectedPatientEproEntries = useMemo(() => {
    if (!selPatient) return [];
    return eproEntries.filter((entry) => entry.uid === selPatient.id);
  }, [eproEntries, selPatient]);

  return (
    <>
      <TopNavbar 
        user={user} 
        defaultRole="CRC" 
        onLogout={onLogout} 
        alerts={enrichedAlerts} 
        onAlertClick={handleNavAlertClick} 
        onHomeClick={handleHomeClick} 
      />
      
      {toastMsg && (
        <div style={{position: 'fixed', top: '70px', right: '20px', background: '#d32f2f', color: 'white', padding: '15px', borderRadius: '8px', zIndex: 11000, boxShadow: '0 4px 6px rgba(0,0,0,0.2)'}}>
          {toastMsg}
        </div>
      )}

      <LiveChatWidget 
        user={user} role="crc" userName={crcName} 
        existingAlert={chatAlert} 
        activeEmergencies={enrichedAlerts}
        // KEY: Pass the full global list (resolved+active) if no patient selected
        allAlerts={selPatient ? pAlerts : enrichedGlobalAlerts} 
        onClose={() => setChatAlert(null)} 
        recipientId={selPatient?.id} 
        recipientName={selPatient?.nickname} 
      />

      {activeIncident && (
        <IncidentDetailModal
          incident={activeIncident}
          user={user}
          crcName={crcName}
          onClose={handleCloseIncident}
          onOpenChat={handleOpenIncidentChat}
        />
      )}

      <div className="main-container">
        
        {urgentAlerts.length > 0 && (
          <div className="card" style={{border: '2px solid red', background: '#fff5f5', overflow: 'hidden'}}>
            <h3 className="mt-0 text-red">🚨 Active Emergencies</h3>
            
            <div style={{maxHeight: '200px', overflowY: 'auto'}}>
              {enrichedAlerts.map(a => (
                <div key={a.id} style={{padding:'10px', borderBottom:'1px solid #ffcccc', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <div>
                    <div>
                      <strong>{a.patientName}</strong> <span className="text-red">[{a.reason}]</span>
                    </div>
                    <div style={{fontSize: '11px', color: '#555', marginTop: '2px'}}>
                       🕒 {new Date(a.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <button onClick={()=>setChatAlert(a)} className="btn btn-primary btn-small">Chat</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="crc-grid">
          <div style={{display:'flex', flexDirection:'column', gap:'20px'}}>
             <PatientList patients={patients} selectedPatientId={selectedPatientId} onSelect={selectP} />
             <ProtocolManager selectedPatient={selPatient} />
             <EproStatusPanel entries={eproEntries} selectedPatient={selPatient} patients={patients} />
             <SafetyInboxPanel
               incidents={incidents}
               selectedPatient={selPatient}
               pushState={pushState}
               onEnablePush={handleEnablePush}
               onOpenIncident={handleOpenIncident}
             />
          </div>

          <div className="card">
            {selPatient ? (
              <>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <h2 className="mt-0">{selPatient.nickname}</h2>
                </div>
                
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

                <div style={{background:'#fff', border:'1px solid #eee', padding:'15px', borderRadius:'8px', marginBottom:'20px'}}>
                   <h4 className="mt-0">🩺 Recent Vitals</h4>
                   {pVitals.slice(0, 5).map(r => (
                      <div key={r.id} style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid #eee', padding:'8px 0', fontSize:'13px'}}>
                         <div>{new Date(r.timestamp).toLocaleDateString()}</div>
                         <div>{r.bpSys ? `${r.bpSys}/${r.bpDia}` : '-'}</div>
                         <div>{r.spo2 ? `${r.spo2}%` : '-'}</div>
                         <div>{r.temperature ? `${r.temperature}°C` : '-'}</div>
                      </div>
                   ))}
                   {pVitals.length === 0 && <div style={{fontStyle:'italic', color:'#888'}}>No vitals recorded.</div>}
                </div>

                <div style={{background:'#f9f9f9', padding:'15px', borderRadius:'8px', marginBottom:'20px'}}>
                  <h3 className="mt-0">📅 Scheduler</h3>
                  <div style={{display:'flex', gap:'10px', alignItems:'flex-end'}}>
                    <input type="datetime-local" value={newDate} onChange={e=>setNewDate(e.target.value)} />
                    <button onClick={schedule} className="btn btn-primary">Schedule</button>
                  </div>
                  
                  <div style={{marginTop:'15px', padding:'15px', border:'1px dashed #007bff', borderRadius:'5px', background:'#e7f1ff'}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: '10px'}}>
                      
                      <span style={{fontWeight:'bold', color:'#0056b3'}}>🤖 {AI_SUGGESTION_TITLE}</span>
                      
                      <button onClick={handleSuggestDate} disabled={isSuggesting} className="btn btn-secondary btn-small">
                        {isSuggesting ? 'Thinking...' : '✨ Suggest Date'}
                      </button>
                    </div>
                    {suggestedDate && (
                      <div style={{background: 'white', padding: '10px', borderRadius: '5px', border: '1px solid #cce5ff'}}>
                        <div style={{color: '#0056b3', fontWeight: 'bold', fontSize: '16px'}}>
                          📅 Suggested: {new Date(suggestedDate).toLocaleString()}
                        </div>
                        <div style={{fontSize: '13px', color: '#555', marginTop: '5px', fontStyle: 'italic'}}>"{suggestedReason}"</div>
                      </div>
                    )}
                    {!suggestedDate && suggestedReason && (
                      <div style={{fontSize: '13px', color: '#666', fontStyle:'italic'}}>{suggestedReason}</div>
                    )}
                  </div>
                  
                  {pAppts.map(a => (
                     <div key={a.id} style={{marginTop:'10px', padding:'10px', background:'white', border:'1px solid #eee', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <div>
                          {new Date(a.datetime).toLocaleString()} 
                          <span style={{marginLeft: '10px', ...getStatusStyle(a.status)}}> - {getStatusText(a.status)}</span>
                        </div>
                        {a.status === 'confirmed' && (
                          <button onClick={() => handleMarkComplete(a.id)} className="btn btn-success btn-small">✓ Mark Complete</button>
                        )}
                     </div>
                  ))}
                </div>
                <DropoutRiskPanel selectedPatient={selPatient} eproEntries={selectedPatientEproEntries} />
              </>
            ) : <p style={{padding:'40px', textAlign:'center'}}>Select a patient.</p>}
          </div>
        </div>
      </div>

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
};

export default CRCHome;
