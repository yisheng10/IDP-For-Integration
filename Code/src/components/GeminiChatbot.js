import { GoogleGenerativeAI } from "@google/generative-ai";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import Markdown from 'react-native-markdown-display';

import { GEMINI_API_KEY } from '../config';
import { db } from '../firebase';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { getSignedUrl } from '../services/storageService';
import { supabase } from '../supabaseClient';
import { urlToBase64 } from '../utils';

const CRC_AI_NAME = "AI Copilot";      
const PATIENT_AI_NAME = "AI Assistant";        

const GeminiChatbot = ({ 
  role, 
  userNickname, 
  userId, 
  patientData, 
  crcData, 
  protocolUrl, 
  activeProtocolName,
  onEmergencyTrigger // <--- KEY PROP: Triggers the emergency thread in PatientHome
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const chatSessionRef = useRef(null);
  const flatListRef = useRef(null);

  const currentAiName = role === 'crc' ? CRC_AI_NAME : PATIENT_AI_NAME;

  // Reset chat if protocol or patient changes
  useEffect(() => { 
    setMessages([]); 
    chatSessionRef.current = null;
  }, [protocolUrl, userId, patientData]);

  // Start chat immediately when opened
  useEffect(() => {
    if (isOpen && !chatSessionRef.current) {
      startHybridChat();
    }
  }, [isOpen]);

  // --- 1. FETCH FULL PATIENT DATA (ONE PROMPT STRATEGY) ---
  const fetchFullPatientContext = async (targetId) => {
    let vitalsStr = "No vitals recorded.";
    let apptsStr = "No upcoming appointments.";

    // A. Use Props if available (Fastest)
    if (patientData) {
      if (patientData.vitals && patientData.vitals.length > 0) {
        vitalsStr = patientData.vitals.slice(0, 10).map(v => 
          `- [${new Date(v.timestamp).toLocaleDateString()}]: BP ${v.bpSys}/${v.bpDia}, SpO2 ${v.spo2}%, Temp ${v.temperature || '-'}`
        ).join("\n");
      }
      if (patientData.appointments && patientData.appointments.length > 0) {
        apptsStr = patientData.appointments.map(a => 
          `- ${new Date(a.datetime).toLocaleString()} (${a.status})`
        ).join("\n");
      }
      return { vitalsStr, apptsStr };
    }

    // B. Fetch from Firebase (Fallback if props missing)
    if (!targetId) return { vitalsStr, apptsStr };

    try {
      // Fetch Vitals (Subcollection)
      const qVitals = query(
        collection(db, "users", targetId, "vitals"), 
        orderBy("timestamp", "desc"), 
        limit(10)
      );
      const snapVitals = await getDocs(qVitals);
      
      if (!snapVitals.empty) {
        vitalsStr = snapVitals.docs.map(d => {
           const v = d.data();
           const date = new Date(v.timestamp).toLocaleDateString();
           return `- [${date}]: BP ${v.bpSys}/${v.bpDia}, SpO2 ${v.spo2}%, Temp ${v.temperature || '-'}`;
        }).join("\n");
      }

      // Fetch Appointments (User Doc)
      const userDocRef = doc(db, "users", targetId);
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        if (data.appointments && data.appointments.length > 0) {
          apptsStr = data.appointments.map(a => 
            `- ${new Date(a.datetime).toLocaleString()} (${a.status})`
          ).join("\n");
        }
      }

    } catch (e) {
      console.error("Error reading Firebase data:", e);
    }

    return { vitalsStr, apptsStr };
  };

  const startHybridChat = async () => {
    try {
      const targetId = role === 'crc' ? patientData?.id : userId;
      
      // 1. READ DATA (Fetch everything once)
      const { vitalsStr, apptsStr } = await fetchFullPatientContext(targetId);

      const intro = role === 'crc' 
        ? `👨‍⚕️ **${currentAiName} Active**\nViewing: ${activeProtocolName || "General Context"}`
        : `👋 Hi **${userNickname || 'there'}**! I am ${currentAiName}.`;
      
      setMessages([{ role: 'model', text: intro }]);

      // 2. BUILD SYSTEM PROMPT (Inject Data + Safety Rules)
      const baseInstruction = `
        You are a medical AI assistant named ${currentAiName}.
        Role: ${role === 'crc' ? 'Clinical Research Coordinator Assistant' : 'Patient Companion'}.
        
        === FULL PATIENT DATA (READ CAREFULLY) ===
        
        📉 VITALS HISTORY (Recent 10):
        ${vitalsStr}

        📅 APPOINTMENTS:
        ${apptsStr}

        📄 ACTIVE PROTOCOL: 
        ${activeProtocolName || "None assigned"}
        ===========================================

        CRITICAL SAFETY INSTRUCTIONS & EMERGENCY PROTOCOL:
        ${SAFETY_INSTRUCTIONS}

        *** EMERGENCY DETECTION RULE ***
        If the user mentions symptoms indicative of a high-risk emergency (e.g., chest pain, difficulty breathing, suicide ideation, severe bleeding, or vitals showing hypertensive crisis/hypoxia):
        1. You MUST start your response with the tag: ***EMERGENCY: [Short Reason]***
        2. Example: "***EMERGENCY: Chest Pain*** Please call 911 immediately..."
        3. Do not use this tag for minor issues like a mild headache.
        
        INSTRUCTION:
        Answer the user's questions using the patient data above. Do not ask for the data again.
      `;

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash", 
        systemInstruction: baseInstruction 
      });
      
      const chat = model.startChat({ history: [] });
      chatSessionRef.current = chat;

      // 3. INJECT PDF PROTOCOL (If available)
      if (protocolUrl) {
         let fetchUrl = protocolUrl;
         if (!protocolUrl.startsWith('http')) {
            const signed = await getSignedUrl(protocolUrl, 'protocol'); 
            if (signed) fetchUrl = signed;
         }
         
         if (fetchUrl) {
            const protoBase64 = await urlToBase64(fetchUrl);
            if (protoBase64) {
                await chat.sendMessage([
                  { inlineData: { data: protoBase64, mimeType: "application/pdf" } },
                  { text: "System: This is the detailed PDF Protocol. Use it to answer protocol-specific questions." }
                ]);
            }
         }
      }

    } catch (e) {
      console.error("Init Error", e);
      setMessages(p => [...p, { role: 'model', text: "⚠️ Connection Error." }]);
    }
  };

  const retrieveCtcaeContext = async (queryText) => {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const embeddingResult = await embeddingModel.embedContent(queryText);
      const vector = embeddingResult.embedding.values;

      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: vector,
        match_threshold: 0.4, 
        match_count: 2 
      });

      if (error || !data) return "";
      
      return data.map(c => {
         const pageInfo = c.metadata?.page ? ` (Page ${c.metadata.page})` : "";
         return `[Source${pageInfo}]: ${c.content}`;
      }).join("\n\n");

    } catch (e) {
      console.error("RAG Error", e);
      return "";
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userText = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      // 1. Fetch RAG Context (Guidelines)
      const ctcaeContext = await retrieveCtcaeContext(userText);
      
      let prompt = `User Question: ${userText}\n`;
      if (ctcaeContext) {
        prompt += `\n--- EXTERNAL GUIDELINES (CTCAE) ---\n${ctcaeContext}\n-----------------------------------\n`;
      }

      // 2. Send to Gemini
      const result = await chatSessionRef.current.sendMessage(prompt);
      const text = result.response.text();

      // 3. DETECT EMERGENCY TAG
      const emergencyMatch = text.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      if (emergencyMatch) {
         const reason = emergencyMatch[1].trim();
         console.log("🚨 Emergency Detected via Chat:", reason);
         
         // Trigger the parent callback (Opens LiveChatWidget in PatientHome)
         if (onEmergencyTrigger) {
           onEmergencyTrigger(reason);
         }
      }

      setMessages(prev => [...prev, { role: 'model', text: text }]);

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "⚠️ AI Error." }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <TouchableOpacity style={styles.fab} onPress={() => setIsOpen(true)}>
        <Text style={styles.fabText}>💬 {currentAiName}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
        <View style={styles.window}>
          <View style={styles.header}>
            <Text style={styles.title}>🤖 {currentAiName}</Text>
            <TouchableOpacity onPress={() => setIsOpen(false)}><Text style={styles.close}>✕</Text></TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => index.toString()}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={[styles.msgRow, item.role === 'user' ? styles.userRow : styles.modelRow]}>
                <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.modelBubble]}>
                   {item.role === 'model' 
                     ? <Markdown style={markdownStyles}>{item.text}</Markdown> 
                     : <Text style={{color:'white'}}>{item.text}</Text>
                   }
                </View>
              </View>
            )}
            contentContainerStyle={{ padding: 10 }}
          />

          {isLoading && <ActivityIndicator style={{margin: 10}} />}

          <View style={styles.inputArea}>
            <TextInput 
              style={styles.input} 
              value={input} 
              onChangeText={setInput} 
              placeholder={`Ask ${currentAiName}...`} 
            />
            <TouchableOpacity onPress={handleSend} style={styles.sendBtn}>
              <Text style={{color:'white'}}>➤</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fab: { position: 'absolute', bottom: 30, left: 20, backgroundColor: '#0056b3', padding: 12, borderRadius: 30, elevation: 5 },
  fabText: { color: 'white', fontWeight: 'bold' },
  container: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  window: { height: '85%', backgroundColor: 'white', borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderColor: '#eee', backgroundColor: '#f8f9fa', borderTopLeftRadius: 15, borderTopRightRadius: 15 },
  title: { fontWeight: 'bold', fontSize: 16 },
  close: { fontSize: 20, color: '#666' },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  userRow: { justifyContent: 'flex-end' },
  modelRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', padding: 10, borderRadius: 10 },
  userBubble: { backgroundColor: '#007bff' },
  modelBubble: { backgroundColor: '#f1f1f1' },
  inputArea: { flexDirection: 'row', padding: 10, borderTopWidth: 1, borderColor: '#eee' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 15, height: 40 },
  sendBtn: { width: 40, height: 40, backgroundColor: '#0056b3', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 5 }
});

const markdownStyles = {
  body: { fontSize: 14, color: '#333' },
  strong: { fontWeight: 'bold' }
};

export default GeminiChatbot;