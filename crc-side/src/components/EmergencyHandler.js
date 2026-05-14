import { onSnapshot } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList, KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { sendAlert, sendChatMessage, subscribeToChat } from '../services/alertService';

// --- PURE LOGIC ---
export const analyzeVitals = (temp, spo2, sys, dia) => {
  let issues = [];
  if (spo2 && spo2 < 92) issues.push(`Critical SpO2: ${spo2}%`);
  if (temp && temp > 38.5) issues.push(`High Fever: ${temp}°C`);
  if (sys && (sys > 160 || sys < 90)) issues.push(`Abnormal Sys BP: ${sys}`);
  if (dia && (dia > 100 || dia < 60)) issues.push(`Abnormal Dia BP: ${dia}`);
  return issues; 
};

// --- COMPONENT ---
const EmergencyHandler = ({ user, role = 'patient', userName, triggerReason, existingAlert, onClose }) => {
  const [activeAlertRef, setActiveAlertRef] = useState(existingAlert?.ref || null);
  const [initMsg, setInitMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolved, setIsResolved] = useState(false);
  const flatListRef = useRef(null);

  useEffect(() => {
    if (!activeAlertRef) return;
    const unsubChat = subscribeToChat(activeAlertRef, (msgs) => setMessages(msgs));
    const unsubAlert = onSnapshot(activeAlertRef, (doc) => {
      if (doc.exists()) setIsResolved(doc.data().status === 'read');
    });
    return () => { unsubChat(); unsubAlert(); };
  }, [activeAlertRef]);

  // Auto-scroll logic
  useEffect(() => {
    if (messages.length > 0) flatListRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const handleCreateAlert = async () => {
    if (!initMsg.trim()) return;
    try {
      const docRef = await sendAlert(user.uid, triggerReason, initMsg, userName);
      setActiveAlertRef(docRef); 
    } catch (e) { Alert.alert("Error", e.message); }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !activeAlertRef) return;
    await sendChatMessage(activeAlertRef, role, chatInput, userName);
    setChatInput("");
  };

  return (
    <Modal visible={true} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, {backgroundColor: isResolved ? '#666' : '#d32f2f'}]}>
          <Text style={styles.title}>{isResolved ? '✓ Resolved' : '🚨 EMERGENCY'}</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.closeBtn}>✕</Text></TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.body}>
          {!activeAlertRef ? (
            <View style={{padding: 20}}>
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Detected: {triggerReason}</Text>
              </View>
              <Text style={{marginBottom:10}}>Please describe your symptoms:</Text>
              <TextInput
                style={styles.textArea}
                multiline
                value={initMsg}
                onChangeText={setInitMsg}
                placeholder="Type here..."
              />
              <TouchableOpacity onPress={handleCreateAlert} style={styles.alertBtn}>
                <Text style={styles.alertBtnText}>SEND URGENT ALERT</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex:1}}>
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item, i) => i.toString()}
                renderItem={({ item }) => {
                   const isMe = item.sender === role;
                   return (
                     <View style={[styles.msgRow, {justifyContent: isMe?'flex-end':'flex-start'}]}>
                       <View style={[styles.bubble, isMe?styles.me:styles.them]}>
                         <Text style={{color: isMe?'white':'black'}}>{item.text}</Text>
                       </View>
                     </View>
                   );
                }}
                contentContainerStyle={{padding:10}}
              />
              
              {!isResolved && (
                <View style={styles.inputArea}>
                  <TextInput style={styles.input} value={chatInput} onChangeText={setChatInput} placeholder="Message..." />
                  <TouchableOpacity onPress={handleSendChat} style={styles.sendBtn}><Text style={{color:'white'}}>➤</Text></TouchableOpacity>
                </View>
              )}
            </KeyboardAvoidingView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  header: { padding: 20, paddingTop: 50, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: 'white', fontWeight: 'bold', fontSize: 18 },
  closeBtn: { color: 'white', fontSize: 24 },
  body: { flex: 1 },
  warningBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, borderColor: '#ef5350', borderWidth: 1, marginBottom: 20 },
  warningText: { color: '#c62828', fontWeight: 'bold' },
  textArea: { backgroundColor: 'white', height: 100, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#ddd', textAlignVertical: 'top', marginBottom: 20 },
  alertBtn: { backgroundColor: '#d32f2f', padding: 15, borderRadius: 8, alignItems: 'center' },
  alertBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  bubble: { padding: 10, borderRadius: 10, maxWidth: '80%' },
  me: { backgroundColor: '#d32f2f' },
  them: { backgroundColor: '#e0e0e0' },
  inputArea: { flexDirection: 'row', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderColor: '#ccc' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 15, height: 40 },
  sendBtn: { width: 40, height: 40, backgroundColor: '#333', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 5 }
});

export default EmergencyHandler;