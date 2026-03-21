import React, { useState, useEffect, useRef } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { sendAlert, sendChatMessage, subscribeToChat } from '../services/alertService';

// --- LOGIC ---
export const analyzeVitals = (temp, spo2, sys, dia) => {
  let issues = [];
  if (spo2 && spo2 < 92) issues.push(`Critical SpO2: ${spo2}%`);
  if (temp && temp > 38.5) issues.push(`High Fever: ${temp}°C`);
  if (sys && (sys > 160 || sys < 90)) issues.push(`Abnormal Sys BP: ${sys}`);
  if (dia && (dia > 100 || dia < 60)) issues.push(`Abnormal Dia BP: ${dia}`);
  return issues; 
};

// --- CHAT COMPONENT ---
const EmergencyHandler = ({ user, role = 'patient', userName, triggerReason, existingAlert, onClose }) => {
  const [activeAlertRef, setActiveAlertRef] = useState(existingAlert?.ref || null);
  const [initMsg, setInitMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolved, setIsResolved] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (!activeAlertRef) return;
    const unsubChat = subscribeToChat(activeAlertRef, (msgs) => setMessages(msgs));
    const unsubAlert = onSnapshot(activeAlertRef, (doc) => {
      if (doc.exists()) setIsResolved(doc.data().status === 'read');
    });
    return () => { unsubChat(); unsubAlert(); };
  }, [activeAlertRef]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleCreateAlert = async () => {
    if (!initMsg.trim()) return;
    try {
      const docRef = await sendAlert(user.uid, triggerReason, initMsg, userName);
      setActiveAlertRef(docRef); 
    } catch (e) { alert("Error sending alert: " + e.message); }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !activeAlertRef) return;
    await sendChatMessage(activeAlertRef, role, chatInput, userName);
    setChatInput("");
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.6)', 
      zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px'
    }}>
      <div style={{
        background: 'white', display: 'flex', flexDirection: 'column',
        width: '450px', maxWidth: '100%', 
        // CSS FIX: Use maxHeight viewport units and height 100% to ensure header sticks
        height: '100%', maxHeight: '90vh', 
        borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', overflow: 'hidden'
      }}>
        
        {/* HEADER (Fixed at top due to flex column layout) */}
        <div style={{background: isResolved ? '#666' : (role==='crc'?'#007bff':'#d32f2f'), color: 'white', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0}}>
          <div>
            <h2 style={{margin: 0, fontSize: '18px'}}>
              {isResolved ? '✓ Case Resolved' : (role==='crc' ? 'CRC Support' : '🚨 EMERGENCY')}
            </h2>
            <small>{existingAlert?.reason || triggerReason || "Live Chat"}</small>
          </div>
          <button onClick={onClose} style={{background: 'transparent', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer', lineHeight: 1}}>✕</button>
        </div>

        {/* BODY (Scrolls internally) */}
        <div style={{flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column'}}>
          {!activeAlertRef ? (
            // MODE A: CREATE ALERT
            <div style={{padding: '20px', flex: 1, display: 'flex', flexDirection: 'column'}}>
              <h3 style={{color: '#d32f2f', marginTop: 0}}>Describe Situation</h3>
              <div style={{background: '#ffebee', padding: '10px', borderRadius: '5px', marginBottom: '20px', border: '1px solid #ffcdd2', color: '#b71c1c'}}>
                <strong>Detected:</strong> {triggerReason}
              </div>
              <textarea 
                style={{flex: 1, padding: '10px', marginBottom: '20px', borderRadius: '5px', border: '1px solid #ccc', resize: 'none', minHeight: '100px'}}
                placeholder="Please describe your symptoms..."
                value={initMsg}
                onChange={e => setInitMsg(e.target.value)}
              />
              <button onClick={handleCreateAlert} style={{padding: '15px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer'}}>
                SEND URGENT ALERT
              </button>
            </div>
          ) : (
            // MODE B: LIVE CHAT
            <div style={{display: 'flex', flexDirection: 'column', flex: 1, height: '100%'}}>
              
              <div style={{flex: 1, padding: '15px', overflowY: 'auto', background: '#f9f9f9'}}>
                {messages.length === 0 && <p style={{textAlign:'center', color:'#999', marginTop:'20px'}}>Chat started.</p>}
                
                {messages.map((m, i) => {
                  const isMe = m.sender === role;
                  const displayName = m.senderName || m.sender.toUpperCase();

                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: '10px' }}>
                      <div style={{
                        maxWidth: '80%', padding: '10px 14px', borderRadius: '15px',
                        background: isMe ? (role==='crc'?'#007bff':'#d32f2f') : '#e0e0e0',
                        color: isMe ? 'white' : 'black',
                        borderBottomRightRadius: isMe ? '0' : '15px', borderBottomLeftRadius: isMe ? '15px' : '0'
                      }}>
                        <div style={{fontSize: '11px', opacity: 0.8, marginBottom: '2px', fontWeight: 'bold'}}>{displayName}</div>
                        {m.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
                {isResolved && <div style={{textAlign:'center', margin:'20px 0', color:'green', fontWeight:'bold', padding:'10px', background:'#e8f5e9', borderRadius:'5px'}}>✓ This conversation has been resolved.</div>}
              </div>

              {/* INPUT AREA (Fixed at bottom) */}
              {(!isResolved || role === 'crc') ? (
                <div style={{padding: '15px', background: 'white', borderTop: '1px solid #eee', display: 'flex', gap: '10px', flexShrink: 0}}>
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyPress={e => e.key === 'Enter' && handleSendChat()}
                    placeholder={`Message as ${userName}...`}
                    style={{flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid #ccc', outline: 'none'}}
                  />
                  <button onClick={handleSendChat} style={{background: '#333', color: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer'}}>➤</button>
                </div>
              ) : (
                <div style={{padding: '15px', background: '#f5f5f5', borderTop: '1px solid #ddd', textAlign: 'center', color: '#999', flexShrink: 0}}>
                  🔒 <i>Input disabled (Case Resolved)</i>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmergencyHandler;