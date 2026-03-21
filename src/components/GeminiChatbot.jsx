// Attempt to fix the protocol reading error by using extract text from PDF function that's alr in the project. Returned text extraction error.
// I'm leaving this to TJH to fix lol
// This is still the Qwen3:8b version.

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  collection, doc, getDoc, getDocs, limit, orderBy, query, 
  addDoc, onSnapshot, serverTimestamp, writeBatch 
} from 'firebase/firestore'; 
import ReactMarkdown from 'react-markdown'; 
import { db } from '../firebase';
import { GEMINI_API_KEY } from '../config';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { urlToBase64, extractTextFromPdf } from '../utils';
import { getSignedUrl } from '../services/storageService'; 
import { supabase } from '../supabaseClient'; 

const CRC_AI_NAME = "AI Copilot";      
const PATIENT_AI_NAME = "AI Assistant";        

const GeminiChatbot = ({ 
  role, 
  userNickname, 
  userId, 
  patientData, 
  activeProtocolName,
  onEmergencyTrigger,
  allPatients = [],
  protocolUrl 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]); 
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false); 
  
  const [activeContextPatient, setActiveContextPatient] = useState(null);
  
  const chatSessionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const lastInjectedIdRef = useRef(null);
  const systemPromptRef = useRef("");

  const currentAiName = role === 'crc' ? CRC_AI_NAME : PATIENT_AI_NAME;
  
  const historyCollectionRef = userId 
    ? collection(db, "users", userId, "ai_chat_history") 
    : null;

  // --- 1. SUBSCRIBE TO HISTORY ---
  useEffect(() => {
    if (!historyCollectionRef) return;
    const q = query(historyCollectionRef, orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setMessages(msgs);
      setIsHistoryLoaded(true);
    });
    return () => unsub();
  }, [userId]);

  // --- 2. SYNC CONTEXT (UI) ---
  useEffect(() => {
    if (role === 'crc' && patientData) {
      setActiveContextPatient(patientData);
    } else if (role === 'crc' && !patientData) {
      setActiveContextPatient(null);
    }
  }, [patientData, role]);

  // --- 3. AUTO-START ---
  useEffect(() => {
    const isReady = isOpen && userId && isHistoryLoaded;
    if (isReady && !chatSessionRef.current) {
         startHybridChat();
    }
  }, [isOpen, userId, isHistoryLoaded, protocolUrl]); 

  // --- 4. AUTO-SCROLL ---
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, isLoading, isOpen]);

  // --- RAG SEARCH ---
  const searchCTCAE = async (queryText) => {
    try {
      if (!queryText || queryText.length < 3) return "";
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const embeddingResult = await embeddingModel.embedContent(queryText);
      const embedding = embeddingResult.embedding.values;
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.5, 
        match_count: 5        
      });
      if (error) return "";
      if (data && data.length > 0) {
        return data.map(doc => {
           let pageNum = "Unknown";
           try {
             const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
             if (meta && meta.page) pageNum = meta.page;
           } catch (e) {}
           return `[Page ${pageNum}]: ${doc.content}`;
        }).join("\n\n---\n\n");
      }
      return "";
    } catch (e) { return ""; }
  };

  // --- HELPER: FETCH GLOBAL SUMMARY (Enhanced with Appointments) ---
  const fetchGlobalPatientSummary = async () => {
    if (!allPatients || allPatients.length === 0) return "No patients found in database.";
    
    let summary = "=== LIVE PATIENT DATABASE (Vitals & Appointments) ===\n";
    // Increase limit to cover more patients in summary
    const targetPatients = allPatients.slice(0, 50); 
    
    const patientPromises = targetPatients.map(async (p) => {
      let info = `• Name: **${p.nickname}** (ID: ${p.hospitalPatientId || 'N/A'})`;
      
      // 1. Fetch Latest Vitals
      try {
        const q = query(collection(db, "users", p.id, "vitals"), orderBy("timestamp", "desc"), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const v = snap.docs[0].data();
          const date = new Date(v.timestamp).toLocaleDateString();
          info += `\n  - Vitals (${date}): Temp:${v.temperature||'-'}°C, BP:${v.bpSys||'-'}/${v.bpDia||'-'}, SpO2:${v.spo2||'-'}%`;
        } else { 
          info += `\n  - Vitals: None`; 
        }
      } catch (e) { info += ` (Vital Error)`; }

      // 2. Fetch Upcoming Appointments
      try {
        const qAppts = query(collection(db, "users", p.id, "appointments"), orderBy("datetime", "asc"), limit(2));
        const snapAppts = await getDocs(qAppts);
        if (!snapAppts.empty) {
           const apptList = snapAppts.docs.map(d => {
             const a = d.data();
             return `${new Date(a.datetime).toLocaleDateString()} (${a.status})`;
           }).join(", ");
           info += `\n  - Appts: ${apptList}`;
        }
      } catch (e) { }

      return info;
    });
    
    const results = await Promise.all(patientPromises);
    summary += results.join("\n");
    return summary;
  };

  // --- NEW: FETCH GLOBAL SCHEDULE (CONSOLIDATED) ---
  const fetchGlobalSchedule = async () => {
    if (!allPatients || allPatients.length === 0) return "No patients.";
    
    let allAppts = [];
    const today = new Date();

    // Iterate all patients to build a master schedule
    // Limiting to first 20 patients for performance, or slice as needed
    const targetPatients = allPatients.slice(0, 20);

    const promises = targetPatients.map(async (p) => {
      try {
        // Fetch future appointments only
        const q = query(
            collection(db, "users", p.id, "appointments"), 
            orderBy("datetime", "asc")
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
            const data = d.data();
            if (new Date(data.datetime) >= today) {
                allAppts.push({
                    patient: p.nickname,
                    datetime: data.datetime,
                    status: data.status
                });
            }
        });
      } catch(e) {}
    });

    await Promise.all(promises);

    // Sort by Date
    allAppts.sort((a,b) => new Date(a.datetime) - new Date(b.datetime));

    if (allAppts.length === 0) return "No upcoming appointments found globally.";

    return "=== MASTER APPOINTMENT SCHEDULE ===\n" + 
           allAppts.slice(0, 15).map(a => 
             `- ${new Date(a.datetime).toLocaleString()}: ${a.patient} (${a.status})`
           ).join("\n");
  };

  // --- HELPER: FETCH DETAILED CONTEXT ---
  const fetchFullPatientContext = async (targetId, patientObj = null) => {
    let vitalsStr = "No vitals recorded.";
    let apptsStr = "No upcoming appointments.";
    let protocolText = null;
    let protocolStatus = "No protocol assigned.";

    const formatVitalLog = (v) => {
      const date = new Date(v.timestamp).toLocaleDateString();
      const time = new Date(v.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      return `[${date} ${time}]: T:${v.temperature||'-'} BP:${v.bpSys||'-'}/${v.bpDia||'-'} SpO2:${v.spo2||'-'}%`;
    };

    try {
      const qVitals = query(collection(db, "users", targetId, "vitals"), orderBy("timestamp", "desc"), limit(10));
      const snapVitals = await getDocs(qVitals);
      if (!snapVitals.empty) vitalsStr = snapVitals.docs.map(d => formatVitalLog(d.data())).join("\n");

      const qAppts = query(collection(db, "users", targetId, "appointments"), orderBy("datetime", "asc"), limit(5));
      const snapAppts = await getDocs(qAppts);
      if(!snapAppts.empty) {
         apptsStr = snapAppts.docs.map(d => `- ${new Date(d.data().datetime).toLocaleString()} (${d.data().status})`).join("\n");
      }

      let pUrl = patientObj?.protocolUrl;
      if (!pUrl && protocolUrl) pUrl = protocolUrl; 
      if (!pUrl) {
         const userDoc = await getDoc(doc(db, "users", targetId));
         if(userDoc.exists()) pUrl = userDoc.data().protocolUrl;
      }

      if (pUrl) {
        let downloadUrl = pUrl;
        if (!pUrl.startsWith('http')) {
           const signedUrl = await getSignedUrl(pUrl, 'protocol');
           if (signedUrl) downloadUrl = signedUrl;
           else protocolStatus = "Error: Could not authorize PDF access.";
        }
        if (downloadUrl && !protocolStatus.startsWith("Error")) {
           // --- SWAPPED TO EXTRACT TEXT ---
           const text = await extractTextFromPdf(downloadUrl);
           if (text) {
             protocolText = text;
             protocolStatus = "PDF Text Extracted Successfully.";
           } else protocolStatus = "Error: Text extraction failed.";
        }
      }
    } catch (e) { protocolStatus = "System Error: " + e.message; }

    return { vitalsStr, apptsStr, protocolText, protocolStatus };
  };

  // --- START CHAT ---
  const startHybridChat = async () => {
    try {
      let textInstruction = `You are ${currentAiName}. Role: ${role === 'crc' ? 'CRC Assistant' : 'Patient Companion'}.`;
      
      if (role === 'crc' && !patientData) {
        textInstruction += `\n\n[SYSTEM: GLOBAL DASHBOARD MODE]\nYou have access to the full patient database. Answer questions about any patient or the overall schedule.`;
        const globalSummary = await fetchGlobalPatientSummary();
        textInstruction += `\n\n${globalSummary}`;
      }
      
      const targetId = role === 'crc' ? patientData?.id : userId;
      
      if (targetId && (role === 'patient' || patientData)) {
        // 1. Pull the new protocolText variable
        const { vitalsStr, apptsStr, protocolText, protocolStatus } = await fetchFullPatientContext(targetId, patientData);
        const pName = role === 'crc' ? (patientData?.nickname) : userNickname;
        
        // 2. Inject standard vitals and status
        textInstruction += `\n\n=== CURRENT FOCUS: ${pName} ===\n📉 VITALS:\n${vitalsStr}\n📅 APPTS:\n${apptsStr}\n📄 PROTOCOL STATUS: ${protocolStatus}`;
        
        // 3. Shove the actual PDF words into the baseline memory
        if (protocolText) {
            textInstruction += `\n\n[PROTOCOL DOCUMENT CONTENT]:\n${protocolText}`;
        }
      }

      textInstruction += `\n\n=== SAFETY & RULES ===\n${SAFETY_INSTRUCTIONS}`;
      
      // Save instructions to our ref instead of starting a Gemini session
      systemPromptRef.current = textInstruction;
      chatSessionRef.current = true; // Flag to indicate readiness

      if (messages.length === 0) {
         const intro = role === 'crc' 
           ? `👨‍⚕️ **${currentAiName} Ready.**\nRunning locally. I can read vitals, appointments, and CTCAE guidelines.`
           : `👋 Hi **${userNickname || 'there'}**! I am ${currentAiName}.`;
         await saveMessage('model', intro);
      }
    } catch (e) { console.error("Init Error", e); }
  };

  const saveMessage = async (role, text) => {
    if (!historyCollectionRef || !text) return;
    try { await addDoc(historyCollectionRef, { role, text, timestamp: serverTimestamp() }); } catch (e) {}
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await startHybridChat();
      await saveMessage('system', '🔄 **AI Memory Refreshed.** Latest data loaded.');
    } catch (e) { console.error(e); } 
    finally { setIsLoading(false); }
  };

  const handleClearHistory = async () => {
    if (!window.confirm("Clear chat history?")) return;
    setIsLoading(true);
    try {
      const snapshot = await getDocs(historyCollectionRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      setMessages([]);
      chatSessionRef.current = null;
      await startHybridChat();
    } catch (e) { alert("Failed."); } 
    finally { setIsLoading(false); }
  };

  // --- MESSAGE HANDLER ---
  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    if (!chatSessionRef.current) await startHybridChat();
    if (!chatSessionRef.current) return;

    const userText = input;
    setInput('');
    setIsLoading(true);
    await saveMessage('user', userText);

    try {
      const mentionedPatient = detectPatientInInput(userText);
      let targetPatient = mentionedPatient || (role === 'crc' ? activeContextPatient : { id: userId, nickname: userNickname });
      let systemInjection = "";

      // 1 & 2. Data Injections (Keep your exact existing logic here)
      const isAskingSchedule = /appointments|schedule|calendar/i.test(userText);
      if (role === 'crc' && isAskingSchedule && !targetPatient) {
          const scheduleData = await fetchGlobalSchedule();
          systemInjection += `\n\n[SYSTEM: INJECTING GLOBAL SCHEDULE]\n${scheduleData}\n`;
      } else if (role === 'crc' && /patients|vitals|summary|list|everyone|all/i.test(userText)) {
          const globalData = await fetchGlobalPatientSummary();
          systemInjection += `\n\n[SYSTEM: REAL-TIME PATIENT DATABASE ACCESS GRANTED]\n${globalData}\n`;
      }

      const isProtocolQuestion = /protocol|summary|trial|pdf|document/i.test(userText);
      if (targetPatient || isProtocolQuestion) {
         const finalTarget = targetPatient || activeContextPatient || (role === 'patient' ? { id: userId } : null); 
         if (finalTarget) {
             // 1. Grab the extracted text
             const { vitalsStr, apptsStr, protocolText, protocolStatus } = await fetchFullPatientContext(finalTarget.id, finalTarget);
             const pName = finalTarget.nickname || "The Patient";
             
             systemInjection += `\n[DATA INJECTION FOR: ${pName}]\n📉 VITALS:\n${vitalsStr}\n📅 APPTS:\n${apptsStr}\n📄 PROTOCOL STATUS: ${protocolStatus}`;
             
             // 2. Inject the actual PDF words directly into the prompt
             if (protocolText) {
                 systemInjection += `\n\n[PROTOCOL DOCUMENT CONTENT]:\n${protocolText}`;
             }
         }
      }

      // 3. RAG Search (This still uses Google's embedding model invisibly!)
      const ragContext = await searchCTCAE(userText);
      if (ragContext) {
        systemInjection += `\n\n[CTCAE KNOWLEDGE BASE]:\n${ragContext}\n(Cite pages e.g. [Page 4])\n`;
      }

      // --- FORMAT FOR OLLAMA ---
      const ollamaHistory = messages.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.text
      }));

      // Add the core system instructions at the top
      ollamaHistory.unshift({ role: 'system', content: systemPromptRef.current });

      // Add the new user message
      ollamaHistory.push({
        role: 'user',
        content: systemInjection ? (systemInjection + "\nUser Query: " + userText) : userText
      });

      // --- THE LOCAL API CALL ---
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3:8b', // SWAP THIS TO "qwen3:30b-a3b" WHEN ON THE 5090
          messages: ollamaHistory,
          stream: false
        })
      });

      if (!response.ok) throw new Error("Local AI Server not responding.");
      
      const data = await response.json();
      const text = data.message.content;

      // Emergency Check & Save
      const emergencyMatch = text.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      if (emergencyMatch && onEmergencyTrigger) onEmergencyTrigger(emergencyMatch[1].trim());
      await saveMessage('model', text);

    } catch (error) {
      console.error(error);
      await saveMessage('model', "⚠️ AI Error. Make sure Ollama is running.");
      chatSessionRef.current = null;
    } finally {
      setIsLoading(false);
    }
  };

  const detectPatientInInput = (text) => {
    if (role !== 'crc' || !allPatients.length) return null;
    const lowerText = text.toLowerCase();
    const sortedPatients = [...allPatients].sort((a,b) => (b.nickname?.length || 0) - (a.nickname?.length || 0));
    return sortedPatients.find(p => {
      const name = (p.nickname || "").toLowerCase();
      return name && name.length > 2 && lowerText.includes(name);
    });
  };

  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} style={styles.fab}>
        <span style={styles.fabText}>💬 {currentAiName}</span>
      </button>
    );
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.window}>
        <div style={styles.header}>
          <div style={{display:'flex', flexDirection:'column'}}>
             <span style={styles.title}>🤖 {currentAiName}</span>
             {role === 'crc' && (
               <span style={{fontSize:'10px', color:'#555'}}>
                 Active: <strong>{activeContextPatient?.nickname || "Global Mode"}</strong>
               </span>
             )}
          </div>
          <div style={{display:'flex', alignItems:'center', gap:'15px'}}>
            <button onClick={handleRefresh} style={{...styles.closeBtn, fontSize:'18px'}} title="Refresh AI Data">🔄</button>
            <button onClick={handleClearHistory} style={{...styles.closeBtn, fontSize:'16px'}} title="Clear Chat History">🗑️</button>
            <button onClick={() => setIsOpen(false)} style={styles.closeBtn}>✕</button>
          </div>
        </div>
        <div style={styles.chatArea}>
          {messages.map((item, index) => (
            <div key={item.id || index} style={{
              ...styles.msgRow, 
              justifyContent: item.role === 'user' ? 'flex-end' : (item.role === 'system' ? 'center' : 'flex-start')
            }}>
              {item.role === 'system' ? (
                 <small style={{color:'#888'}}><ReactMarkdown>{item.text}</ReactMarkdown></small>
              ) : (
                <div style={{
                  ...styles.bubble, 
                  backgroundColor: item.role === 'user' ? '#007bff' : '#f1f1f1',
                  color: item.role === 'user' ? 'white' : '#333'
                }}>
                   {item.role === 'model' ? <ReactMarkdown>{item.text}</ReactMarkdown> : item.text}
                </div>
              )}
            </div>
          ))}
          {isLoading && <div style={{padding: '10px', fontStyle: 'italic', color: '#666'}}>Thinking...</div>}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSend} style={styles.inputArea}>
          <input type="text" style={styles.input} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." />
          <button type="submit" style={styles.sendBtn} disabled={isLoading}>➤</button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  fab: { position: 'fixed', bottom: '30px', left: '20px', backgroundColor: '#0056b3', padding: '12px 20px', borderRadius: '30px', border: 'none', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', cursor: 'pointer', zIndex: 9999 },
  fabText: { color: 'white', fontWeight: 'bold', fontSize: '16px' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' },
  window: { width: '100%', maxWidth: '600px', height: '85%', backgroundColor: 'white', borderTopLeftRadius: '15px', borderTopRightRadius: '15px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderBottom: '1px solid #eee', backgroundColor: '#f8f9fa' },
  title: { fontWeight: 'bold', fontSize: '16px' },
  closeBtn: { background: 'none', border: 'none', fontSize: '20px', color: '#666', cursor: 'pointer' },
  chatArea: { flex: 1, padding: '15px', overflowY: 'auto', backgroundColor: 'white' },
  msgRow: { display: 'flex', marginBottom: '10px', width: '100%' },
  bubble: { maxWidth: '85%', padding: '10px 15px', borderRadius: '10px', wordWrap: 'break-word' },
  inputArea: { display: 'flex', padding: '10px', borderTop: '1px solid #eee', backgroundColor: 'white', gap: '10px' },
  input: { flex: 1, padding: '10px 15px', borderRadius: '20px', border: '1px solid #ddd', outline: 'none' },
  sendBtn: { width: '40px', height: '40px', backgroundColor: '#0056b3', borderRadius: '50%', border: 'none', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer' }
};

export default GeminiChatbot;