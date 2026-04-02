import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { sendAlert, sendChatMessage, startDirectMessage, subscribeToChat, resolveAlert } from '../services/alertService';
import { useCall } from '../context/CallContext';

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
      if (doc.exists()) setIsResolved(doc.data().status === 'read');
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
    try { await resolveAlert(activeAlertRef); } catch (e) { alert(e.message); }
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

  const callTargetId = activeAlertData?.uid || recipientId;
  const callTargetName = activeAlertData?.patientName || activeAlertData?.senderName || recipientName || 'Patient';

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
    <div style={styles.modalContainer} onClick={() => { setOpenState(false); if(onClose) onClose(); }}>
      <div style={styles.chatWindow} onClick={(event) => event.stopPropagation()}>
        
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
            {viewMode === 'chat' && <span style={styles.headerTitle}>Chat</span>}
            {viewMode === 'create' && <span style={styles.headerTitle}>New Message</span>}
          </div>
          
          <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            
            {role === 'crc' && callTargetId && (
              <>
                 <button onClick={() => startCall(callTargetId, callTargetName, false)} style={{...styles.iconBtn, fontSize:'20px'}} title={`Voice Call`}>📞</button>
                 <button onClick={() => startCall(callTargetId, callTargetName, true)} style={{...styles.iconBtn, fontSize:'20px'}} title={`Video Call`}>🎥</button>
              </>
            )}

            {viewMode === 'chat' && role === 'crc' && !isResolved && (
              <button onClick={handleResolve} style={{...styles.iconBtn, backgroundColor:'white', color:'#28a745', borderRadius:'4px', padding:'2px 8px', fontSize:'12px', fontWeight:'bold', marginRight:'5px'}}>✓ Resolve</button>
            )}

            {viewMode === 'chat' && <button onClick={() => { setActiveAlertRef(null); setActiveAlertData(null); setViewMode('list'); }} style={styles.iconBtn}>‹ Back</button>}
            
            <button onClick={() => { setOpenState(false); if(onClose) onClose(); }} style={styles.iconBtn}>✕</button>
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
  modalContainer: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' },
  chatWindow: { width: '100%', maxWidth: '600px', height: '80%', backgroundColor: 'white', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' },
  headerTitle: { fontWeight: 'bold', fontSize: '18px' },
  iconBtn: { background: 'none', border: 'none', color: 'white', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold' },
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
  inputArea: { display: 'flex', padding: '10px', borderTop: '1px solid #eee', backgroundColor: 'white' },
  input: { flex: 1, border: '1px solid #ddd', borderRadius: '20px', padding: '10px 15px', outline: 'none' },
  sendBtn: { width: '40px', height: '40px', backgroundColor: '#333', borderRadius: '50%', border: 'none', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: '5px', cursor: 'pointer' },
  
  // NEW STYLES FOR FILTERS
  filterContainer: { display: 'flex', gap: '8px', marginBottom: '15px', padding: '0 5px' },
  filterInput: { flex: 1, padding: '8px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '14px' },
  clearBtn: { padding: '8px 12px', background: '#e0e0e0', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }
};

export default LiveChatWidget;
