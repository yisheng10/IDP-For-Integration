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
import {
  markAlertRead,
  sendAlert,
  sendChatMessage,
  startDirectMessage,
  subscribeToChat,
} from '../services/alertService';

const LiveChatWidget = ({ 
  user, 
  role = 'patient', 
  userName, 
  triggerReason, 
  existingAlert, 
  activeEmergencies = [], // NEW PROP: List of active alerts
  onClose, 
  isOpenInitially = false, 
  recipientId, 
  recipientName 
}) => {
  const [isOpen, setIsOpen] = useState(isOpenInitially);
  const [activeAlertRef, setActiveAlertRef] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list', 'chat', 'create'
  
  const [initMsg, setInitMsg] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isResolved, setIsResolved] = useState(false);
  
  const flatListRef = useRef(null);
  const hasAutoCreatedRef = useRef(false);

  useEffect(() => {
    if (isOpenInitially) setIsOpen(true);
  }, [isOpenInitially]);

  // Handle New Trigger (Auto open creation)
  useEffect(() => {
    const handleAutoAlert = async () => {
      if (triggerReason && role === 'patient' && !hasAutoCreatedRef.current) {
        hasAutoCreatedRef.current = true;
        try {
          const autoMessage = `Automated Alert: ${triggerReason}`;
          const docRef = await sendAlert(user.uid, triggerReason, autoMessage, userName);
          setActiveAlertRef(docRef);
          setViewMode('chat');
          setIsOpen(true);
        } catch (error) {
          console.error('Auto alert failed:', error);
          setActiveAlertRef(null);
          setViewMode('create');
          setIsOpen(true);
        }
      } else if (!triggerReason) {
        hasAutoCreatedRef.current = false;
      }
    };

    handleAutoAlert();
  }, [triggerReason, role, user.uid, userName]);

  // Handle Opening specific existing alert
  useEffect(() => {
    if (existingAlert) {
      setActiveAlertRef(existingAlert.ref);
      setViewMode('chat');
      setIsOpen(true);
    }
  }, [existingAlert]);

  // Determine Default View when opened manually
  useEffect(() => {
    if (isOpen && !triggerReason && !activeAlertRef) {
      if (activeEmergencies.length > 0) {
        setViewMode('list');
      } else if (role === 'crc' && recipientId) {
        setViewMode('create'); // Start DM
      }
    }
  }, [isOpen, activeEmergencies, triggerReason, activeAlertRef, recipientId, role]);

  // Chat Subscription
  useEffect(() => {
    if (!activeAlertRef) return;
    const unsubChat = subscribeToChat(activeAlertRef, (msgs) => setMessages(msgs));
    const unsubAlert = onSnapshot(activeAlertRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setIsResolved(data.status === 'read');
        if (role === 'patient' && data.status === 'unread' && data.lastSender === 'crc') {
          markAlertRead(activeAlertRef).catch((error) => console.error('Failed to mark alert read:', error));
        }
      }
    });
    return () => { unsubChat(); unsubAlert(); };
  }, [activeAlertRef, role]);

  useEffect(() => {
    if (messages.length > 0 && isOpen && viewMode === 'chat') {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, isOpen, viewMode]);

  const handleCreateAlert = async () => {
    if (!initMsg.trim()) return;
    try {
      const docRef = await sendAlert(user.uid, triggerReason || "Emergency", initMsg, userName);
      setActiveAlertRef(docRef); 
      setViewMode('chat');
    } catch (e) { Alert.alert("Error", e.message); }
  };

  const handleStartMessage = async () => {
    if (!initMsg.trim() || !recipientId) return;
    try {
      const docRef = await startDirectMessage(recipientId, initMsg, userName);
      setActiveAlertRef(docRef);
      setInitMsg("");
      setViewMode('chat');
    } catch (e) { Alert.alert("Error", e.message); }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || !activeAlertRef) return;
    await sendChatMessage(activeAlertRef, role, chatInput, userName);
    setChatInput("");
  };

  // --- RENDER ITEMS ---
  const renderMessage = ({ item }) => {
    const isMe = item.sender === role;
    const displayName = item.senderName || (item.sender === 'crc' ? 'CRC' : 'Patient');
    return (
      <View style={[styles.msgRow, { justifyContent: isMe ? 'flex-end' : 'flex-start' }]}>
        <View style={[styles.msgBubble, isMe ? styles.msgMe : styles.msgThem]}>
          <Text style={styles.msgName}>{displayName}</Text>
          <Text style={{ color: isMe ? 'white' : 'black' }}>{item.text}</Text>
        </View>
      </View>
    );
  };

  const renderEmergencyItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.alertItem} 
      onPress={() => { setActiveAlertRef(item.ref); setViewMode('chat'); }}
    >
      <View>
        <Text style={styles.alertReason}>🚨 {item.reason}</Text>
        <Text style={styles.alertDate}>{new Date(item.timestamp).toLocaleString()}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  // --- FLOATING BUBBLE (Closed State) ---
  if (!isOpen) {
    // Show Red "Active" button if there are ANY active emergencies
    if (role === 'patient' && activeEmergencies.length > 0) {
      return (
        <TouchableOpacity style={[styles.fab, {backgroundColor: '#d32f2f'}]} onPress={() => setIsOpen(true)}>
          <Text style={styles.fabText}>📞 Active ({activeEmergencies.length})</Text>
        </TouchableOpacity>
      );
    }
    // CRC Mode
    if (role === 'crc') {
      if (activeAlertRef) {
         return <TouchableOpacity style={styles.fab} onPress={() => setIsOpen(true)}><Text style={styles.fabText}>💬 Chat</Text></TouchableOpacity>;
      } else if (recipientId) {
         return <TouchableOpacity style={styles.fab} onPress={() => setIsOpen(true)}><Text style={styles.fabText}>✉️ Msg</Text></TouchableOpacity>;
      }
    }
    return null;
  }

  // --- MODAL WINDOW ---
  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalContainer}>
        <View style={styles.chatWindow}>
          
          {/* HEADER */}
          <View style={[styles.header, {backgroundColor: isResolved ? '#666' : (role==='crc'?'#007bff':'#d32f2f')}]}>
            <View>
              {viewMode === 'list' && <Text style={styles.headerTitle}>Active Emergencies</Text>}
              {viewMode === 'chat' && <Text style={styles.headerTitle}>Chat</Text>}
              {viewMode === 'create' && <Text style={styles.headerTitle}>New Alert</Text>}
            </View>
            
            <View style={{flexDirection:'row', gap:15}}>
              {/* Back Button (Only in Chat mode if we have a list to go back to) */}
              {viewMode === 'chat' && activeEmergencies.length > 0 && (
                <TouchableOpacity onPress={() => { setActiveAlertRef(null); setViewMode('list'); }}>
                  <Text style={styles.closeBtn}>‹</Text>
                </TouchableOpacity>
              )}
              
              <TouchableOpacity onPress={() => { setIsOpen(false); if(onClose) onClose(); }}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* BODY */}
          <View style={styles.body}>
            
            {/* VIEW 1: LIST OF EMERGENCIES */}
            {viewMode === 'list' && (
              <FlatList
                data={activeEmergencies}
                keyExtractor={item => item.id}
                renderItem={renderEmergencyItem}
                contentContainerStyle={{padding: 10}}
                ListEmptyComponent={<Text style={{padding:20, textAlign:'center'}}>No active emergencies.</Text>}
              />
            )}

            {/* VIEW 2: CREATE NEW ALERT */}
            {viewMode === 'create' && (
              <View style={styles.centerContent}>
                <Text style={styles.promptText}>{role==='patient' ? (triggerReason || "Emergency Detected") : `Message ${recipientName}`}</Text>
                {role === 'patient' && (
                  <View style={styles.emergencyNotice}>
                    <Text style={styles.emergencyNoticeTitle}>Urgent symptoms need direct contact</Text>
                    <Text style={styles.emergencyNoticeBody}>
                      If you have severe symptoms, call your study emergency number or local emergency services immediately. This chat supports documentation and CRC follow-up, but it is not a replacement for urgent phone escalation.
                    </Text>
                  </View>
                )}
                <TextInput 
                  style={styles.textArea} 
                  multiline 
                  placeholder="Type details..." 
                  value={initMsg} 
                  onChangeText={setInitMsg} 
                />
                <TouchableOpacity 
                  style={[styles.btnFull, {backgroundColor: role==='patient'?'#d32f2f':'#007bff'}]} 
                  onPress={role==='patient' ? handleCreateAlert : handleStartMessage}
                >
                  <Text style={{color:'white', fontWeight:'bold'}}>SEND</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* VIEW 3: CHAT */}
            {viewMode === 'chat' && (
              <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={(item, index) => index.toString()}
                renderItem={renderMessage}
                contentContainerStyle={{ padding: 10 }}
              />
            )}
          </View>

          {/* INPUT (Only for Chat View) */}
          {viewMode === 'chat' && (!isResolved || role === 'crc') && (
            <View style={styles.inputArea}>
              <TextInput 
                style={styles.input} 
                value={chatInput} 
                onChangeText={setChatInput}
                placeholder="Type message..." 
              />
              <TouchableOpacity onPress={handleSendChat} style={styles.sendBtn}><Text style={{color:'white'}}>➤</Text></TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fab: { position: 'absolute', bottom: 30, right: 20, backgroundColor: '#007bff', padding: 15, borderRadius: 30, elevation: 5, zIndex: 9999 },
  fabText: { color: 'white', fontWeight: 'bold' },
  modalContainer: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  chatWindow: { height: '80%', backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  header: { padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  closeBtn: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  body: { flex: 1, backgroundColor: '#f5f7fa' },
  centerContent: { padding: 20, alignItems: 'center' },
  promptText: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  emergencyNotice: {
    width: '100%',
    backgroundColor: '#fff3e8',
    borderWidth: 1,
    borderColor: '#f5c38b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
  },
  emergencyNoticeTitle: { color: '#8a4c00', fontWeight: 'bold', marginBottom: 6 },
  emergencyNoticeBody: { color: '#8a4c00', lineHeight: 18, fontSize: 13 },
  textArea: { width: '100%', height: 100, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 15, backgroundColor:'white', textAlignVertical:'top' },
  btnFull: { width: '100%', padding: 15, borderRadius: 8, alignItems: 'center' },
  
  alertItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 10, elevation: 2 },
  alertReason: { fontWeight: 'bold', color: '#d32f2f', fontSize: 16 },
  alertDate: { color: '#666', fontSize: 12 },
  arrow: { fontSize: 20, color: '#ccc' },

  msgRow: { marginBottom: 10, flexDirection: 'row' },
  msgBubble: { maxWidth: '80%', padding: 10, borderRadius: 12 },
  msgMe: { backgroundColor: '#007bff', borderBottomRightRadius: 0 },
  msgThem: { backgroundColor: '#e0e0e0', borderBottomLeftRadius: 0 },
  msgName: { fontSize: 10, marginBottom: 2, opacity: 0.7, color: '#333' },
  inputArea: { flexDirection: 'row', padding: 10, borderTopWidth: 1, borderColor: '#eee' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 15, height: 40, backgroundColor: 'white' },
  sendBtn: { width: 40, height: 40, backgroundColor: '#333', borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 5 }
});

export default LiveChatWidget;
