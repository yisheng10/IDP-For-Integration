import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { sendAlert, sendChatMessage, startDirectMessage, subscribeToChat, resolveAlert } from '../services/alertService';
import { useCall } from '../context/CallContext';
import { documentIncidentAe, resolveIncidentAe } from '../services/incidentService';

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

const SUMMARY_SECTION_MARKERS = [
  ['Details:', 'Patient report'],
  ['Severity:', 'Severity and protocol'],
  ['Protocol guidance:', 'Protocol guidance'],
  ['AI triage summary:', 'AI triage summary'],
  ['Recommended CRC action:', 'Recommended CRC action'],
  ['Measurements:', 'Measurements'],
  ['Flagged issues:', 'Flagged issues'],
];

const parseStructuredSummaryText = (text) => {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return null;

  const matchingMarkers = SUMMARY_SECTION_MARKERS
    .map(([marker, label]) => ({ marker, label, index: source.indexOf(marker) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  const isSummaryLike = matchingMarkers.length >= 2 ||
    /^Structured .* event documented for /i.test(source) ||
    /^Auto-? ?detected abnormal vitals/i.test(source);

  if (!isSummaryLike) return null;

  const sections = [];
  const firstMarker = matchingMarkers[0];
  const lead = firstMarker ? source.slice(0, firstMarker.index).trim() : source;

  if (lead) {
    sections.push({ label: 'Overview', body: lead });
  }

  matchingMarkers.forEach((item, markerIndex) => {
    const start = item.index + item.marker.length;
    const end = matchingMarkers[markerIndex + 1]?.index ?? source.length;
    const body = source.slice(start, end).trim();
    if (body) {
      sections.push({ label: item.label, body });
    }
  });

  const expandedSections = sections.flatMap((section) => {
    if (section.label === 'Severity and protocol') {
      const protocolCoverageMatch = section.body.match(/^(.*?\.)\s+(Protocol coverage .*)$/i);
      if (protocolCoverageMatch) {
        return [
          { label: 'Severity', body: protocolCoverageMatch[1].trim() },
          { label: 'Protocol coverage', body: protocolCoverageMatch[2].trim() },
        ];
      }
    }

    if (section.label === 'AI triage summary') {
      const ctcaeMatch = section.body.match(/^(.*?)(Relevant CTCAE terms.*)$/i);
      if (ctcaeMatch) {
        return [
          { label: 'AI triage summary', body: ctcaeMatch[1].trim() },
          { label: 'Relevant CTCAE terms', body: ctcaeMatch[2].trim() },
        ].filter((item) => item.body);
      }
    }

    return [section];
  });

  return expandedSections.length > 0 ? expandedSections : null;
};

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
  const [windowFrame, setWindowFrame] = useState(() => {
    const width = 560;
    const height = 620;
    if (typeof window === 'undefined') {
      return { left: 24, top: 24, width, height };
    }

    const safeWidth = Math.min(width, Math.max(340, window.innerWidth - 32));
    const safeHeight = Math.min(height, Math.max(420, window.innerHeight - 32));
    return {
      left: Math.max(16, window.innerWidth - safeWidth - 22),
      top: Math.max(16, window.innerHeight - safeHeight - 22),
      width: safeWidth,
      height: safeHeight,
    };
  });

  // --- NEW: FILTER STATES ---
  const [searchText, setSearchText] = useState(""); // For Name, ID, Title
  const [filterDate, setFilterDate] = useState(""); // For Date filtering
  
  const { startCall } = useCall(); 
  const messagesEndRef = useRef(null);
  const hasAutoCreatedRef = useRef(false);
  const isControlled = typeof controlledOpen === 'boolean';
  const isOpen = isControlled ? controlledOpen : internalIsOpen;

  const clampWindowFrame = useCallback((nextFrame) => {
    if (typeof window === 'undefined') return nextFrame;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const minWidth = Math.min(340, Math.max(280, viewportWidth - 24));
    const minHeight = Math.min(390, Math.max(320, viewportHeight - 24));
    const maxWidth = Math.max(minWidth, viewportWidth - 16);
    const maxHeight = Math.max(minHeight, viewportHeight - 16);
    const width = Math.min(maxWidth, Math.max(minWidth, nextFrame.width));
    const height = Math.min(maxHeight, Math.max(minHeight, nextFrame.height));
    const left = Math.min(Math.max(8, nextFrame.left), Math.max(8, viewportWidth - width - 8));
    const top = Math.min(Math.max(8, nextFrame.top), Math.max(8, viewportHeight - height - 8));

    return { left, top, width, height };
  }, []);

  const handleWindowDragStart = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button, input, textarea, select, a')) return;

    event.preventDefault();
    const startFrame = windowFrame;
    const startX = event.clientX;
    const startY = event.clientY;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setWindowFrame(clampWindowFrame({
        ...startFrame,
        left: startFrame.left + deltaX,
        top: startFrame.top + deltaY,
      }));
    };

    const stopDragging = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
  }, [clampWindowFrame, windowFrame]);

  const handleWindowResizeStart = useCallback((event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    const startFrame = windowFrame;
    const startX = event.clientX;
    const startY = event.clientY;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setWindowFrame(clampWindowFrame({
        ...startFrame,
        width: startFrame.width + deltaX,
        height: startFrame.height + deltaY,
      }));
    };

    const stopResizing = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);
  }, [clampWindowFrame, windowFrame]);

  const setOpenState = useCallback((nextOpen) => {
    if (!isControlled) {
      setInternalIsOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }, [isControlled, onOpenChange]);

  useEffect(() => {
    if (isOpenInitially && !isControlled) setInternalIsOpen(true);
  }, [isControlled, isOpenInitially]);

  useEffect(() => {
    const handleViewportResize = () => {
      setWindowFrame((current) => clampWindowFrame(current));
    };

    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [clampWindowFrame]);

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

  const handleDocumentAe = async () => {
    if (!activeAlertRef) return;
    if (!window.confirm('Mark this AE case as documented by CRC? This does not mean the patient has clinically recovered.')) return;
    try {
      const incidentId = String(activeAlertData?.source_incident_id || '').trim();
      if (incidentId) {
        await documentIncidentAe(incidentId, {
          uid: user?.uid || null,
          name: userName || user?.email || 'CRC',
          email: user?.email || null,
        });
      }
    } catch (e) { alert(e.message); }
  };

  const handleResolve = async () => {
    if (!activeAlertRef) return;
    if (!window.confirm('Mark this AE as clinically resolved? Use this only when the patient adverse event has actually resolved.')) return;
    try {
      const incidentId = String(activeAlertData?.source_incident_id || '').trim();
      if (incidentId) {
        await resolveIncidentAe(incidentId, {
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
    const structuredSummary = parseStructuredSummaryText(item.text);
    return (
      <div key={index} style={{...styles.msgRow, justifyContent: isMe ? 'flex-end' : 'flex-start'}}>
        <div style={{
          ...styles.msgBubble,
          ...(isMe ? styles.msgMe : styles.msgThem),
          ...(structuredSummary ? styles.structuredMsgBubble : null),
        }}>
          <div style={styles.msgName}>{displayName}</div>
          {structuredSummary ? (
            <div style={styles.structuredMsg}>
              {structuredSummary.map((section) => (
                <section key={section.label} style={styles.structuredMsgSection}>
                  <div style={styles.structuredMsgLabel}>{section.label}</div>
                  <div style={styles.structuredMsgBody}>{section.body}</div>
                </section>
              ))}
            </div>
          ) : (
            <div style={{ ...styles.msgText, color: isMe ? 'white' : 'black' }}>{item.text}</div>
          )}
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

    const metaItems = [
      summary.severity ? `Severity: ${summary.severity}` : '',
      summary.incidentType ? `Type: ${summary.incidentType}` : '',
      summary.protocolName ? `Protocol: ${summary.protocolName}` : '',
      summary.reportCount ? `Reports: ${summary.reportCount}` : '',
      summary.latestReportAt ? `Latest: ${summary.latestReportAt}` : '',
    ].filter((value) => String(value || '').trim());

    return (
      <section style={styles.caseSummaryCard} aria-label="Safety case summary">
        <div style={styles.caseSummaryTopRow}>
          <span style={styles.caseSummaryBadge}>Safety AE case</span>
        </div>
        <h3 style={styles.caseSummaryTitle}>{summary.title || activeAlertData?.reason || 'Safety follow-up'}</h3>
        <div style={styles.caseSummaryMeta}>
          {metaItems.map((value) => (
            <span key={value} style={styles.caseSummaryMetaItem}>{value}</span>
          ))}
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
  const activeAlertAeDocumented =
    activeAlertData?.ae_documentation_status === 'documented' ||
    Boolean(activeAlertData?.ae_documented_at);
  const activeAlertAeResolved =
    activeAlertData?.ae_clinical_status === 'resolved' ||
    Boolean(activeAlertData?.ae_resolved_at);

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
      <div
        style={{
          ...styles.chatWindow,
          left: `${windowFrame.left}px`,
          top: `${windowFrame.top}px`,
          width: `${windowFrame.width}px`,
          height: `${windowFrame.height}px`,
        }}
      >
        
        <div
          style={{...styles.header, backgroundColor: isResolved ? '#666' : (role==='crc'?'#007bff':'#d32f2f')}}
          onMouseDown={handleWindowDragStart}
          title="Drag to move"
        >
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

            {viewMode === 'chat' && role === 'crc' && activeAlertData?.source_incident_id && !activeAlertAeDocumented && (
              <button onClick={handleDocumentAe} style={styles.resolveButton}>AE Documented</button>
            )}

            {viewMode === 'chat' && role === 'crc' && !activeAlertAeResolved && (
              <button onClick={handleResolve} style={styles.resolveButton}>AE Resolved</button>
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
        <div
          style={styles.resizeHandle}
          onMouseDown={handleWindowResizeStart}
          aria-hidden="true"
        />
      </div>
    </div>
  );
};

const styles = {
  // ... (Previous styles) ...
  fab: { position: 'fixed', bottom: '30px', right: '20px', backgroundColor: '#007bff', padding: '15px 20px', borderRadius: '30px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', cursor: 'pointer', zIndex: 9999, display: 'flex', alignItems: 'center' },
  fabText: { color: 'white', fontWeight: 'bold', fontSize: '16px' },
  modalContainer: { position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'none' },
  chatWindow: { position: 'fixed', backgroundColor: 'white', borderRadius: '14px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 48px rgba(15, 23, 42, 0.26)', border: '1px solid rgba(15, 96, 155, 0.18)', pointerEvents: 'auto' },
  header: { padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white', cursor: 'move', userSelect: 'none', gap: '10px' },
  headerTitle: { fontWeight: 'bold', fontSize: '16px', display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  headerPatientName: { fontSize: '13px', fontWeight: 700, backgroundColor: 'rgba(255,255,255,0.18)', color: 'white', borderRadius: '999px', padding: '4px 9px' },
  iconBtn: { minWidth: '32px', minHeight: '32px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '9px', color: 'white', fontSize: '15px', cursor: 'pointer', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  resolveButton: { minHeight: '32px', border: 'none', backgroundColor: 'white', color: '#147a3f', borderRadius: '9px', padding: '0 11px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' },
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
  msgRow: { marginBottom: '8px', display: 'flex' },
  msgBubble: { maxWidth: '82%', padding: '8px 11px', borderRadius: '10px', wordWrap: 'break-word', lineHeight: 1.45 },
  msgMe: { backgroundColor: '#007bff', borderBottomRightRadius: 0, color: 'white' },
  msgThem: { backgroundColor: '#e0e0e0', borderBottomLeftRadius: 0, color: 'black' },
  msgName: { fontSize: '10px', marginBottom: '4px', opacity: 0.8 },
  msgText: { fontSize: '13px', lineHeight: 1.45 },
  structuredMsgBubble: { maxWidth: '92%', backgroundColor: '#f3f5f7', color: '#10263a', padding: '8px 10px' },
  structuredMsg: { display: 'grid', gap: '6px', color: '#10263a' },
  structuredMsgSection: { paddingTop: '6px', borderTop: '1px solid rgba(16, 38, 58, 0.12)' },
  structuredMsgLabel: { color: '#52687a', fontSize: '10px', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase', marginBottom: '2px' },
  structuredMsgBody: { color: '#10263a', fontSize: '12px', lineHeight: 1.42 },
  caseSummaryCard: { marginBottom: '8px', padding: '8px 10px', borderRadius: '12px', border: '1px solid #cfe2f3', backgroundColor: '#ffffff', boxShadow: '0 6px 14px rgba(15, 96, 155, 0.05)' },
  caseSummaryTopRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '5px' },
  caseSummaryBadge: { display: 'inline-flex', alignItems: 'center', minHeight: '22px', padding: '0 8px', borderRadius: '999px', backgroundColor: '#e8f4ff', color: '#0f609b', fontSize: '10px', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase' },
  caseSummaryTitle: { margin: '0 0 6px', color: '#12324a', fontSize: '14px', lineHeight: 1.25 },
  caseSummaryMeta: { display: 'flex', flexWrap: 'wrap', gap: '5px 7px' },
  caseSummaryMetaItem: { display: 'inline-flex', alignItems: 'center', maxWidth: '100%', padding: '3px 7px', borderRadius: '999px', backgroundColor: '#f4f8fc', border: '1px solid #dbe9f4', color: '#294966', fontSize: '12px', fontWeight: 650, lineHeight: 1.25 },
  inputArea: { display: 'flex', padding: '8px', borderTop: '1px solid #eee', backgroundColor: 'white' },
  input: { flex: 1, border: '1px solid #ddd', borderRadius: '18px', padding: '9px 13px', outline: 'none' },
  sendBtn: { width: '36px', height: '36px', backgroundColor: '#333', borderRadius: '50%', border: 'none', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: '5px', cursor: 'pointer' },
  resizeHandle: { position: 'absolute', right: 0, bottom: 0, width: '18px', height: '18px', cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 0 45%, rgba(15, 96, 155, 0.28) 46% 55%, transparent 56% 65%, rgba(15, 96, 155, 0.42) 66% 75%, transparent 76%)' },
  
  // NEW STYLES FOR FILTERS
  filterContainer: { display: 'flex', gap: '8px', marginBottom: '15px', padding: '0 5px' },
  filterInput: { flex: 1, padding: '8px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '14px' },
  clearBtn: { padding: '8px 12px', background: '#e0e0e0', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }
};

export default LiveChatWidget;
