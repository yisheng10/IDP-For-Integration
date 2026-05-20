import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { sendAlert, sendChatMessage, startDirectMessage, subscribeToChat, resolveAlert } from '../services/alertService';
import { useCall } from '../context/CallContext';
import { resolveIncident } from '../services/incidentService';

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.48-1.2a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path
        d="M15 10.5 21 7v10l-6-3.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
      <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const LiveChatWidget = ({ 
  user, 
  role = 'patient', 
  userName, 
  triggerReason, 
  existingAlert, 
  activeEmergencies = [], 
  allAlerts = [], 
  onClose, 
  isOpenInitially = false, 
  controlledOpen,
  hideTrigger = false,
  onOpenChange,
  recipientId, 
  recipientName,
  listScope = 'all',
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(isOpenInitially);
  const [activeAlertRef, setActiveAlertRef] = useState(null);
  const [activeAlertData, setActiveAlertData] = useState(null); // Stores alert context
  const [viewMode, setViewMode] = useState('list'); 
  
  const [initMsg, setInitMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolved, setIsResolved] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // --- NEW: FILTER STATES ---
  const [searchText, setSearchText] = useState(""); // For Name, ID, Title
  const [filterDate, setFilterDate] = useState(""); // For Date filtering
  
  const { startCall } = useCall(); 
  const messagesEndRef = useRef(null);
  const hasAutoCreatedRef = useRef(false);
  const isControlled = typeof controlledOpen === 'boolean';
  const isOpen = isControlled ? controlledOpen : internalIsOpen;

  const setOpenState = useCallback((nextOpen) => {
    if (!isControlled) {
      setInternalIsOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  useEffect(() => {
    if (isOpenInitially && !isControlled) setInternalIsOpen(true);
  }, [isControlled, isOpenInitially]);

  // 1. Handle "Trigger Reason"
  useEffect(() => {
    const handleAutoAlert = async () => {
      if (triggerReason && role === 'patient' && !hasAutoCreatedRef.current) {
        hasAutoCreatedRef.current = true; 
        setIsSending(true);
        try {
          const autoMsg = `Automated Alert: ${triggerReason}`;
          const docRef = await sendAlert(user.uid, triggerReason, autoMsg, userName);
          setActiveAlertRef(docRef);
          setActiveAlertData(null); 
          setViewMode('chat');
          setOpenState(true);
        } catch (e) { console.error("Auto-alert failed:", e); } 
        finally { setIsSending(false); }
      }
    };
    if (triggerReason) handleAutoAlert();
    else hasAutoCreatedRef.current = false;
  }, [setOpenState, triggerReason, role, user.uid, userName]);

  // 2. Handle "Existing Alert" (Clicking from Dashboard)
  useEffect(() => {
    if (existingAlert) {
      setActiveAlertRef(existingAlert.ref);
      setActiveAlertData(existingAlert); 
      setViewMode('chat');
      setOpenState(true);
    }
  }, [existingAlert, setOpenState]);

  // 3. Determine Default View
  useEffect(() => {
    if (existingAlert) return; 
    if (isOpen && !triggerReason && !activeAlertRef) {
      if (listScope === 'urgent') setViewMode('list');
      else if (activeEmergencies.length > 0) setViewMode('list');
      else if (role === 'crc' && recipientId) setViewMode('create'); 
      else if (role === 'crc' && !recipientId) setViewMode('list'); 
      else setViewMode('list');
    }
  }, [isOpen, activeEmergencies, triggerReason, activeAlertRef, role, recipientId, existingAlert, listScope]); 

  useEffect(() => {
    if (!activeAlertRef) return;
    const unsubChat = subscribeToChat(activeAlertRef, (msgs) => setMessages(msgs));
    const unsubAlert = onSnapshot(activeAlertRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        const status = String(data.status || '').trim().toLowerCase();
        setIsResolved(status === 'read' || status === 'resolved' || Boolean(data.threadClosed));
        setActiveAlertData((previous) => ({
          ...(previous || {}),
          id: doc.id,
          ref: doc.ref,
          uid: doc.ref.parent.parent?.id || previous?.uid || '',
          ...data,
        }));
      }
    });
    return () => { unsubChat(); unsubAlert(); };
  }, [activeAlertRef]);

  useEffect(() => {
    if (messages.length > 0 && isOpen && viewMode === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, viewMode]);

  const handleCreateAlert = async () => {
    if (!initMsg.trim() || isSending) return;
    setIsSending(true);
    try {
      const docRef = await sendAlert(user.uid, triggerReason || "Emergency", initMsg, userName);
      setActiveAlertRef(docRef); 
      setViewMode('chat');
    } catch (e) { alert("Error: " + e.message); }
    finally { setIsSending(false); }
  };

  const handleStartMessage = async () => {
    if (!initMsg.trim() || !recipientId || isSending) return;
    setIsSending(true);
    try {
      const docRef = await startDirectMessage(recipientId, initMsg, userName);
      setActiveAlertRef(docRef);
      setInitMsg("");
      setViewMode('chat');
    } catch (e) { alert("Error: " + e.message); }
    finally { setIsSending(false); }
  };

  const handleResolve = async () => {
    if (!activeAlertRef) return;
    if (!window.confirm("Mark as resolved?")) return;
    try {
      const incidentId = String(activeAlertData?.source_incident_id || '').trim();
      if (incidentId) {
        await resolveIncident(incidentId, {
          uid: user?.uid || null,
          name: userName || user?.email || 'CRC',
          email: user?.email || null,
        });
      } else {
        await resolveAlert(activeAlertRef);
      }
    } catch (e) { alert(e.message); }
  };

  const handleSendChat = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !activeAlertRef || isSending) return;
    setIsSending(true);
    try {
      await sendChatMessage(activeAlertRef, role, chatInput, userName);
      setChatInput("");
    } catch (error) { console.error(error); } 
    finally { setIsSending(false); }
  };

  // --- NEW: FILTER LOGIC ---
  const filterAlerts = (list) => {
    if (!list) return [];
    return list.filter(item => {
      // 1. Text Search (Name, ID, Reason/Title)
      const searchLower = searchText.toLowerCase();
      const patientName = (item.patientName || "").toLowerCase();
      // Assume patient ID might be part of the object, if not, we rely on name/reason
      // You might need to enrich alerts with ID in CRCHome if strict ID search is needed
      const reason = (item.reason || "").toLowerCase();
      const textMatch = !searchText || patientName.includes(searchLower) || reason.includes(searchLower);

      // 2. Date Filter
      let dateMatch = true;
      if (filterDate) {
        const itemDate = new Date(item.timestamp).toISOString().split('T')[0];
        dateMatch = itemDate === filterDate;
      }

      return textMatch && dateMatch;
    });
  };

  const filteredActive = filterAlerts(activeEmergencies);
  const filteredHistory = listScope === 'urgent' ? [] : filterAlerts(allAlerts);

  // --- RENDER HELPERS ---
  const renderMessage = (item, index) => {
    const isMe = item.sender === role;
    const displayName = item.senderName || (item.sender === 'crc' ? 'CRC' : 'Patient');
    return (
      <div key={index} style={{...styles.msgRow, justifyContent: isMe ? 'flex-end' : 'flex-start'}}>
        <div style={{...styles.msgBubble, ...(isMe ? styles.msgMe : styles.msgThem)}}>
          <div style={styles.msgName}>{displayName}</div>
          <div style={{ color: isMe ? 'white' : 'black' }}>{item.text}</div>
        </div>
      </div>
    );
  };

  const renderAlertItem = (item) => {
    const isActive = item.status === 'unread';
    return (
      <button 
        key={item.id}
        style={{
          ...styles.alertItem,
          borderLeft: isActive ? '5px solid #d32f2f' : '5px solid #ccc',
          backgroundColor: isActive ? '#fff5f5' : 'white'
        }} 
        onClick={() => { 
          setActiveAlertRef(item.ref); 
          setActiveAlertData(item); 
          setViewMode('chat'); 
        }}
      >
        <div>
          <div style={{...styles.alertReason, color: isActive ? '#d32f2f' : '#666'}}>
            {isActive ? '🚨' : '✔'} {item.reason}
          </div>
          <div style={styles.alertDate}>
            {new Date(item.timestamp).toLocaleString()} 
            {isActive && <span style={{fontWeight:'bold', marginLeft:'5px'}}>(Active)</span>}
            {role === 'crc' && item.patientName && <span style={{display:'block', fontSize:'11px', color:'#007bff'}}>User: {item.patientName}</span>}
          </div>
        </div>
        <div style={styles.arrow}>›</div>
      </button>
    );
  };

  const renderSafetyCaseSummary = () => {
    const summary = activeAlertData?.safety_case_summary;
    if (role !== 'crc' || viewMode !== 'chat' || !summary) return null;

    const detailRows = [
      ['Patient', summary.patientName || activeAlertData?.patientName || callTargetName],
      ['Severity', summary.severity],
      ['Case type', summary.incidentType],
      ['Protocol', summary.protocolName],
      ['Coverage', summary.protocolCoverage],
      ['Reports', summary.reportCount ? String(summary.reportCount) : '0'],
      ['Latest report', summary.latestReportAt || 'Not recorded'],
    ].filter(([, value]) => String(value || '').trim());

    return (
      <section style={styles.caseSummaryCard} aria-label="Safety case summary">
        <div style={styles.caseSummaryTopRow}>
          <span style={styles.caseSummaryBadge}>Safety AE case</span>
          <strong style={styles.caseSummaryPatient}>{summary.patientName || activeAlertData?.patientName || callTargetName}</strong>
        </div>
        <h3 style={styles.caseSummaryTitle}>{summary.title || activeAlertData?.reason || 'Safety follow-up'}</h3>
        <div style={styles.caseSummaryGrid}>
          {detailRows.map(([label, value]) => (
            <div key={label} style={styles.caseSummaryMetric}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div style={styles.caseSummarySection}>
          <span style={styles.caseSummarySectionLabel}>Patient report</span>
          <p style={styles.caseSummaryText}>{summary.details || 'No detailed symptom narrative was captured.'}</p>
        </div>
        <div style={styles.caseSummarySection}>
          <span style={styles.caseSummarySectionLabel}>AI triage summary</span>
          <p style={styles.caseSummaryText}>{summary.triageSummary || 'Review the linked report, patient context, and protocol before documenting follow-up.'}</p>
        </div>
        <div style={styles.caseSummaryAction}>
          <span style={styles.caseSummarySectionLabel}>Recommended CRC action</span>
          <strong>{summary.recommendedAction || 'Document follow-up and continue patient communication in this thread.'}</strong>
        </div>
      </section>
    );
  };

  const getAlertPatientId = (alert) => {
    if (!alert) return '';
    return String(
      alert.uid ||
      alert.patientUid ||
      alert.patient_uid ||
      alert.patientId ||
      alert.patient_id ||
      alert.userId ||
      ''
    ).trim();
  };

  const activeAlertPatientId = getAlertPatientId(activeAlertData);
  const callTargetId = viewMode === 'chat'
    ? activeAlertPatientId || recipientId
    : viewMode === 'create'
      ? recipientId
      : '';
  const callTargetName = viewMode === 'chat'
    ? activeAlertData?.patientName || activeAlertData?.senderName || recipientName || 'Patient'
    : recipientName || 'Patient';

  const handleStartCall = async (isVideo) => {
    if (!callTargetId) {
      window.alert('Open a patient chat before starting a call.');
      return;
    }

    try {
      await startCall(callTargetId, callTargetName, isVideo);
    } catch (error) {
      window.alert(error?.message || 'Unable to start the call.');
    }
  };

  if (!isOpen) {
    if (hideTrigger) return null;
    if (role === 'patient') {
      const hasEmergencies = activeEmergencies.length > 0;
      return (
        <button style={{...styles.fab, backgroundColor: hasEmergencies ? '#d32f2f' : '#28a745'}} onClick={() => setOpenState(true)}>
          <span style={styles.fabText}>{hasEmergencies ? `🚨 Active (${activeEmergencies.length})` : '💬 Chat'}</span>
        </button>
      );
    }
    if (role === 'crc') {
      let label = '📂 Inbox';
      let color = '#007bff';
      if (activeAlertRef) label = '💬 Chat';
      else if (activeEmergencies.length > 0) { label = `🚨 Alerts (${activeEmergencies.length})`; color = '#d32f2f'; }
      else if (recipientId) label = '✉️ Msg';
      return (
        <button style={{...styles.fab, backgroundColor: color}} onClick={() => setOpenState(true)}>
          <span style={styles.fabText}>{label}</span>
        </button>
      );
    }
    return null;
  }

  return (
    <div style={styles.modalContainer}>
      <div style={styles.chatWindow}>
        
        <div style={{...styles.header, backgroundColor: isResolved ? '#666' : (role==='crc'?'#007bff':'#d32f2f')}}>
          <div>
            {viewMode === 'list' && (
              <span style={styles.headerTitle}>
                {listScope === 'urgent'
                  ? 'Urgent cases'
                  : activeEmergencies.length > 0
                    ? 'Active Emergencies'
                    : 'Chat History'}
              </span>
            )}
            {viewMode === 'chat' && (
              <span style={styles.headerTitle}>
                {activeAlertData?.source_incident_id ? 'Safety AE Thread' : 'Chat'}
                {callTargetName ? <span style={styles.headerPatientName}>{callTargetName}</span> : null}
              </span>
            )}
            {viewMode === 'create' && <span style={styles.headerTitle}>New Message</span>}
          </div>
          
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            
            {role === 'crc' && callTargetId && (
              <>
                 <button onClick={() => handleStartCall(true)} style={styles.iconBtn} title={`Video call ${callTargetName}`} aria-label={`Video call ${callTargetName}`}>
                  <VideoIcon />
                 </button>
                 <button onClick={() => handleStartCall(false)} style={styles.iconBtn} title={`Voice call ${callTargetName}`} aria-label={`Voice call ${callTargetName}`}>
                  <PhoneIcon />
                 </button>
              </>
            )}

            {viewMode === 'chat' && role === 'crc' && !isResolved && (
              <button onClick={handleResolve} style={styles.resolveButton}>Resolved</button>
            )}

            {viewMode === 'chat' && <button onClick={() => { setActiveAlertRef(null); setActiveAlertData(null); setViewMode('list'); }} style={styles.iconBtn}>‹ Back</button>}
            
            <button onClick={() => { setOpenState(false); if(onClose) onClose(); }} style={styles.iconBtn} aria-label="Close chat">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div style={styles.body}>
          {viewMode === 'list' && (
            <div style={{padding: '10px'}}>
              
              {/* --- NEW: FILTER INPUTS --- */}
              <div style={styles.filterContainer}>
                <input 
                  type="text" 
                  placeholder="🔍 Filter by Name, ID or Title..." 
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  style={styles.filterInput}
                />
                <input 
                  type="date" 
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  style={{...styles.filterInput, width: '130px'}}
                />
                {(searchText || filterDate) && (
                  <button onClick={() => { setSearchText(""); setFilterDate(""); }} style={styles.clearBtn}>Clear</button>
                )}
              </div>

              {role === 'crc' && activeEmergencies.length > 0 && (
                <>
                  <div style={{fontSize:'12px', fontWeight:'bold', color:'#d32f2f', marginBottom:'5px', paddingLeft:'5px'}}>ACTIVE EMERGENCIES</div>
                  {filteredActive.length === 0 ? <div style={{padding:'10px', color:'#999', fontSize:'12px'}}>No matches found.</div> : filteredActive.map(renderAlertItem)}
                  {listScope !== 'urgent' ? <hr style={{border:'0', borderTop:'1px solid #ddd', margin:'15px 0'}} /> : null}
                </>
              )}

              {listScope === 'urgent' ? (
                filteredActive.length === 0 ? (
                  <div style={{padding:'20px', textAlign:'center', color:'#666'}}>No urgent cases right now.</div>
                ) : null
              ) : (
                <>
                  <div style={{fontSize:'12px', fontWeight:'bold', color:'#666', marginBottom:'5px', paddingLeft:'5px'}}>HISTORY</div>
                  {filteredHistory.length === 0 ? <div style={{padding:'20px', textAlign:'center', color:'#666'}}>No chat history found.</div> : filteredHistory.map(renderAlertItem)}
                </>
              )}
            </div>
          )}

          {viewMode === 'create' && (
            <div style={styles.centerContent}>
              <div style={styles.promptText}>
                {role==='patient' ? (triggerReason || "Emergency Detected") : `Message ${recipientName || 'User'}`}
              </div>
              {role === 'patient' && (
                <div style={styles.emergencyNotice}>
                  <div style={styles.emergencyNoticeTitle}>Urgent symptoms need direct contact</div>
                  <div style={styles.emergencyNoticeBody}>
                    Severe symptoms should trigger the study emergency phone pathway or local emergency services immediately. This chat helps document the event and alert CRC staff, but it is not a substitute for urgent phone escalation.
                  </div>
                </div>
              )}
              {role === 'crc' && !recipientId ? (
                 <p style={{color:'red'}}>Please select a patient from the list first.</p>
              ) : (
                <>
                  <textarea style={styles.textArea} placeholder="Type details..." value={initMsg} onChange={e => setInitMsg(e.target.value)} />
                  <button 
                    style={{...styles.btnFull, backgroundColor: isSending ? '#999' : (role==='patient'?'#d32f2f':'#007bff'), cursor: isSending ? 'default' : 'pointer'}} 
                    onClick={role==='patient' ? handleCreateAlert : handleStartMessage}
                    disabled={isSending}
                  >
                    {isSending ? 'SENDING...' : 'SEND'}
                  </button>
                </>
              )}
            </div>
          )}

          {viewMode === 'chat' && (
            <div style={{padding: '10px', display: 'flex', flexDirection: 'column'}}>
              {renderSafetyCaseSummary()}
              {messages.map((item, index) => renderMessage(item, index))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {viewMode === 'chat' && (
          (role === 'crc' || !isResolved) ? (
            <form onSubmit={handleSendChat} style={styles.inputArea}>
              <input style={styles.input} value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type message..." disabled={isSending} />
              <button type="submit" style={styles.sendBtn} disabled={isSending}>➤</button>
            </form>
          ) : <div style={{padding: '15px', background: '#f5f5f5', borderTop: '1px solid #ddd', textAlign: 'center', color: '#999'}}>🔒 <i>Case Resolved - Read Only</i></div>
        )}
      </div>
    </div>
  );
};

const styles = {
  // ... (Previous styles) ...
  fab: { position: 'fixed', bottom: '30px', right: '20px', backgroundColor: '#007bff', padding: '15px 20px', borderRadius: '30px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', cursor: 'pointer', zIndex: 9999, display: 'flex', alignItems: 'center' },
  fabText: { color: 'white', fontWeight: 'bold', fontSize: '16px' },
  modalContainer: { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '0 22px 22px', pointerEvents: 'none' },
  chatWindow: { width: 'min(640px, calc(100vw - 32px))', height: 'min(760px, calc(100dvh - 42px))', backgroundColor: 'white', borderRadius: '18px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(15, 23, 42, 0.28)', border: '1px solid rgba(15, 96, 155, 0.18)', pointerEvents: 'auto' },
  header: { padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' },
  headerTitle: { fontWeight: 'bold', fontSize: '18px', display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  headerPatientName: { fontSize: '13px', fontWeight: 700, backgroundColor: 'rgba(255,255,255,0.18)', color: 'white', borderRadius: '999px', padding: '4px 9px' },
  iconBtn: { minWidth: '36px', minHeight: '36px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '10px', color: 'white', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  resolveButton: { minHeight: '36px', border: 'none', backgroundColor: 'white', color: '#147a3f', borderRadius: '10px', padding: '0 12px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' },
  body: { flex: 1, backgroundColor: '#f5f7fa', overflowY: 'auto' },
  centerContent: { padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  promptText: { fontSize: '18px', fontWeight: 'bold', marginBottom: '15px', color: '#333' },
  emergencyNotice: { width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '10px', backgroundColor: '#fff4e8', border: '1px solid #f1c48a', color: '#8a4c00' },
  emergencyNoticeTitle: { fontWeight: 'bold', marginBottom: '6px' },
  emergencyNoticeBody: { fontSize: '13px', lineHeight: 1.5 },
  textArea: { width: '100%', height: '100px', padding: '10px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #ccc', resize: 'none' },
  btnFull: { width: '100%', padding: '15px', borderRadius: '8px', border: 'none', color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' },
  alertItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderRadius: '10px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', width: '100%', border: 'none', cursor: 'pointer', textAlign: 'left' },
  alertReason: { fontWeight: 'bold', fontSize: '16px', marginBottom: '5px' },
  alertDate: { color: '#666', fontSize: '12px' },
  arrow: { fontSize: '20px', color: '#ccc' },
  msgRow: { marginBottom: '10px', display: 'flex' },
  msgBubble: { maxWidth: '80%', padding: '10px 15px', borderRadius: '12px', wordWrap: 'break-word' },
  msgMe: { backgroundColor: '#007bff', borderBottomRightRadius: 0, color: 'white' },
  msgThem: { backgroundColor: '#e0e0e0', borderBottomLeftRadius: 0, color: 'black' },
  msgName: { fontSize: '10px', marginBottom: '4px', opacity: 0.8 },
  caseSummaryCard: { marginBottom: '14px', padding: '14px', borderRadius: '16px', border: '1px solid #cfe2f3', backgroundColor: '#ffffff', boxShadow: '0 10px 24px rgba(15, 96, 155, 0.08)' },
  caseSummaryTopRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' },
  caseSummaryBadge: { display: 'inline-flex', alignItems: 'center', minHeight: '24px', padding: '0 9px', borderRadius: '999px', backgroundColor: '#e8f4ff', color: '#0f609b', fontSize: '11px', fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase' },
  caseSummaryPatient: { color: '#14324a', fontSize: '14px' },
  caseSummaryTitle: { margin: '0 0 12px', color: '#12324a', fontSize: '18px', lineHeight: 1.35 },
  caseSummaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '12px' },
  caseSummaryMetric: { padding: '9px 10px', borderRadius: '12px', backgroundColor: '#f6f9fc', border: '1px solid #e1edf7', display: 'grid', gap: '3px' },
  caseSummarySection: { paddingTop: '10px', borderTop: '1px solid #e6eef7', marginTop: '10px' },
  caseSummarySectionLabel: { display: 'block', color: '#5f7488', fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '5px' },
  caseSummaryText: { margin: 0, color: '#14324a', fontSize: '14px', lineHeight: 1.55 },
  caseSummaryAction: { marginTop: '12px', padding: '11px 12px', borderRadius: '12px', backgroundColor: '#eef8f2', color: '#17603b', border: '1px solid #cfeada', display: 'grid', gap: '4px', lineHeight: 1.45 },
  inputArea: { display: 'flex', padding: '10px', borderTop: '1px solid #eee', backgroundColor: 'white' },
  input: { flex: 1, border: '1px solid #ddd', borderRadius: '20px', padding: '10px 15px', outline: 'none' },
  sendBtn: { width: '40px', height: '40px', backgroundColor: '#333', borderRadius: '50%', border: 'none', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: '5px', cursor: 'pointer' },
  
  // NEW STYLES FOR FILTERS
  filterContainer: { display: 'flex', gap: '8px', marginBottom: '15px', padding: '0 5px' },
  filterInput: { flex: 1, padding: '8px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '14px' },
  clearBtn: { padding: '8px 12px', background: '#e0e0e0', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }
};

export default LiveChatWidget;
