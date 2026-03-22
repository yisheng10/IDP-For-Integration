import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { GEMINI_API_KEY } from '../config';
import { db } from '../firebase';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { submitSideEffectReport } from '../services/sideEffectService';
import { getSignedUrl } from '../services/storageService';
import { supabase } from '../supabaseClient';
import { urlToBase64 } from '../utils';

const CRC_AI_NAME = 'AI Copilot';
const PATIENT_AI_NAME = 'AI Assistant';
const DEFAULT_EMERGENCY_PHONE = '999';

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeSeverity(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['mild', 'moderate', 'serious'].includes(normalized) ? normalized : 'moderate';
}

function safeJsonParse(text) {
  try {
    return JSON.parse(stripCodeFences(text));
  } catch {
    return null;
  }
}

function buildConversationTranscript(messages) {
  return messages
    .slice(-8)
    .map((entry) => `${entry.role === 'model' ? 'Assistant' : entry.role === 'system' ? 'System' : 'User'}: ${entry.text}`)
    .join('\n');
}

function sanitizePhoneNumber(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function formatVitalLog(entry) {
  const date = new Date(entry.timestamp).toLocaleDateString();
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rows = [`[${date} ${time}]`];
  if (entry.temperature) rows.push(`Temp ${entry.temperature} C`);
  if (entry.bpSys) rows.push(`BP ${entry.bpSys}/${entry.bpDia || '-'}`);
  if (entry.heartRate) rows.push(`HR ${entry.heartRate}`);
  if (entry.respRate) rows.push(`RR ${entry.respRate}`);
  if (entry.spo2) rows.push(`SpO2 ${entry.spo2}%`);
  if (entry.glucoseFasting) rows.push(`Glucose(F) ${entry.glucoseFasting}`);
  if (entry.glucosePost) rows.push(`Glucose(P) ${entry.glucosePost}`);
  return rows.join(' | ');
}

const GeminiChatbot = ({
  role,
  userNickname,
  userId,
  patientData,
  protocolUrl,
  activeProtocolName,
  onEmergencyTrigger,
  openSignal,
  contactContext = {},
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);

  const flatListRef = useRef(null);
  const introWrittenRef = useRef(false);
  const protocolCacheRef = useRef({ key: null, part: null });

  const currentAiName = role === 'crc' ? CRC_AI_NAME : PATIENT_AI_NAME;
  const historyCollectionRef = userId ? collection(db, 'users', userId, 'ai_chat_history') : null;

  const callTargets = useMemo(
    () => ({
      crcLabel: contactContext.primaryCrcName || 'CRC',
      crcPhone: sanitizePhoneNumber(contactContext.primaryCrcPhone),
      emergencyPhone: sanitizePhoneNumber(contactContext.studyEmergencyPhone) || DEFAULT_EMERGENCY_PHONE,
    }),
    [contactContext]
  );

  useEffect(() => {
    introWrittenRef.current = false;
    protocolCacheRef.current = { key: null, part: null };
  }, [protocolUrl, userId, role]);

  useEffect(() => {
    if (!historyCollectionRef) {
      setHistoryReady(true);
      return undefined;
    }

    const historyQuery = query(historyCollectionRef, orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const nextMessages = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      }));
      setMessages(nextMessages);
      setHistoryReady(true);
      if (nextMessages.length > 0) {
        introWrittenRef.current = true;
      }
    });

    return () => unsubscribe();
  }, [historyCollectionRef]);

  useEffect(() => {
    if (openSignal) {
      setIsOpen(true);
    }
  }, [openSignal]);

  const saveMessage = useCallback(async (messageRole, text) => {
    if (!historyCollectionRef || !text) return;
    try {
      await addDoc(historyCollectionRef, {
        role: messageRole,
        text,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Failed to save AI history:', error);
    }
  }, [historyCollectionRef]);

  useEffect(() => {
    if (!isOpen || !historyReady || messages.length !== 0 || introWrittenRef.current) return;

    const intro =
      role === 'crc'
        ? `**${currentAiName} ready.** I can review vitals, appointments, protocol content, and CTCAE guidance.`
        : `Hello **${userNickname || 'there'}**. I am ${currentAiName}. Describe symptoms here and I will document them automatically, use the active protocol when possible, and alert CRC directly when escalation is needed.`;

    introWrittenRef.current = true;
    saveMessage('model', intro);
  }, [currentAiName, historyReady, isOpen, messages.length, role, saveMessage, userNickname]);

  useEffect(() => {
    if (messages.length > 0 && isOpen) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messages, isOpen, isLoading]);

  const fetchFullPatientContext = async (targetId) => {
    let vitalsStr = 'No vitals recorded.';
    let appointmentsStr = 'No upcoming appointments.';
    let protocolStatus = activeProtocolName || 'No protocol assigned.';

    if (!targetId) {
      return { vitalsStr, appointmentsStr, protocolStatus };
    }

    try {
      if (patientData?.vitals?.length) {
        vitalsStr = patientData.vitals.slice(0, 10).map(formatVitalLog).join('\n');
      } else {
        const vitalsQuery = query(collection(db, 'users', targetId, 'vitals'), orderBy('timestamp', 'desc'), limit(10));
        const vitalsSnapshot = await getDocs(vitalsQuery);
        if (!vitalsSnapshot.empty) {
          vitalsStr = vitalsSnapshot.docs.map((entry) => formatVitalLog(entry.data())).join('\n');
        }
      }

      if (patientData?.appointments?.length) {
        appointmentsStr = patientData.appointments
          .slice(0, 5)
          .map((appointment) => `- ${new Date(appointment.datetime).toLocaleString()} (${appointment.status})`)
          .join('\n');
      } else {
        const appointmentQuery = query(
          collection(db, 'users', targetId, 'appointments'),
          orderBy('datetime', 'asc'),
          limit(5)
        );
        const appointmentSnapshot = await getDocs(appointmentQuery);
        if (!appointmentSnapshot.empty) {
          appointmentsStr = appointmentSnapshot.docs
            .map((entry) => {
              const appointment = entry.data();
              return `- ${new Date(appointment.datetime).toLocaleString()} (${appointment.status})`;
            })
            .join('\n');
        }
      }

      const userSnapshot = await getDoc(doc(db, 'users', targetId));
      if (userSnapshot.exists()) {
        const profile = userSnapshot.data();
        protocolStatus = profile.protocolName || protocolStatus;
      }
    } catch (error) {
      console.error('Patient context read failed:', error);
    }

    return { vitalsStr, appointmentsStr, protocolStatus };
  };

  const getProtocolInlinePart = async () => {
    if (!protocolUrl) return null;
    if (protocolCacheRef.current.key === protocolUrl) {
      return protocolCacheRef.current.part;
    }

    try {
      const resolvedUrl = protocolUrl.startsWith('http')
        ? protocolUrl
        : await getSignedUrl(protocolUrl, 'protocol');
      if (!resolvedUrl) {
        protocolCacheRef.current = { key: protocolUrl, part: null };
        return null;
      }

      const base64 = await urlToBase64(resolvedUrl);
      const part = base64
        ? {
            inlineData: {
              data: base64,
              mimeType: 'application/pdf',
            },
          }
        : null;

      protocolCacheRef.current = { key: protocolUrl, part };
      return part;
    } catch (error) {
      console.error('Protocol fetch failed:', error);
      protocolCacheRef.current = { key: protocolUrl, part: null };
      return null;
    }
  };

  const retrieveCtcaeContext = async (queryText) => {
    try {
      if (!queryText || queryText.trim().length < 3) return '';

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const embeddingResult = await embeddingModel.embedContent(queryText);
      const vector = embeddingResult.embedding.values;

      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: vector,
        match_threshold: 0.4,
        match_count: 3,
      });

      if (error || !data?.length) return '';

      return data
        .map((entry) => {
          const pageInfo = entry.metadata?.page ? `Page ${entry.metadata.page}` : 'Unknown page';
          return `[${pageInfo}] ${entry.content}`;
        })
        .join('\n\n');
    } catch (error) {
      console.error('CTCAE retrieval failed:', error);
      return '';
    }
  };

  const generateAssistantText = async ({ userText, transcript, vitalsStr, appointmentsStr, protocolStatus, ctcaeContext }) => {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const protocolPart = await getProtocolInlinePart();

    const instructions = `
You are ${currentAiName}.
Role: ${role === 'crc' ? 'Clinical Research Coordinator assistant' : 'Patient symptom guidance assistant'}.

Current patient context:
- Active protocol: ${activeProtocolName || 'Not assigned'}
- Protocol status: ${protocolStatus}

Recent vitals:
${vitalsStr}

Upcoming appointments:
${appointmentsStr}

Safety rules:
${SAFETY_INSTRUCTIONS}

Patient assistant rules:
- Do not tell the patient to fill a separate side effect form.
- If the patient reports a symptom or side effect, guide them directly in chat.
- Ask only for missing clinical details when needed.
- For severe symptoms, tell the patient to call the study emergency number or local emergency services immediately.
- If the symptom appears covered by the active protocol, explain the likely protocol-aligned self-management or next step cautiously.
- If the symptom does not appear covered by the active protocol, say CRC will be alerted directly.

Conversation transcript:
${transcript || 'No previous conversation.'}

Latest user message:
${userText}

Relevant CTCAE excerpts:
${ctcaeContext || 'None'}
`.trim();

    const parts = [];
    if (protocolPart) parts.push(protocolPart);
    parts.push({ text: instructions });

    const result = await model.generateContent(parts);
    return result.response.text().trim();
  };

  const extractSideEffectEvent = async ({ userText, transcript, vitalsStr, protocolStatus, ctcaeContext }) => {
    if (role !== 'patient') return null;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const protocolPart = await getProtocolInlinePart();

    const extractorPrompt = `
Return JSON only.

You are extracting structured patient side effect information from the latest chat message.
Use the latest message plus recent conversation and active protocol evidence if provided.
If the message is logistics, a greeting, or not a health symptom update, set "contains_side_effect_report" to false.

Rules:
- If the symptom appears clearly covered by the active protocol, set "protocol_covered" to true.
- If the symptom appears not covered by the active protocol, set "protocol_covered" to false and "should_alert_crc" to true.
- If protocol coverage cannot be determined safely, set "protocol_covered" to null and "should_alert_crc" to true.
- If the symptom is severe, dangerous, or needs urgent escalation, set severity to "serious", "immediate_help_requested" to true, and "should_alert_crc" to true.
- Use the recent vitals as additional severity evidence.

Current protocol name: ${activeProtocolName || 'Not assigned'}
Protocol status: ${protocolStatus}

Recent vitals:
${vitalsStr}

Recent conversation:
${transcript || 'No previous conversation.'}

Latest user message:
${userText}

Relevant CTCAE excerpts:
${ctcaeContext || 'None'}

Schema:
{
  "contains_side_effect_report": boolean,
  "symptom_title": string,
  "details": string,
  "severity": "mild" | "moderate" | "serious",
  "onset_at_hint": string | null,
  "immediate_help_requested": boolean,
  "protocol_covered": true | false | null,
  "protocol_guidance": string,
  "should_alert_crc": boolean,
  "triage_summary": string
}
`.trim();

    const parts = [];
    if (protocolPart) parts.push(protocolPart);
    parts.push({ text: extractorPrompt });

    const result = await model.generateContent(parts);
    return safeJsonParse(result.response.text());
  };

  const callPhoneNumber = async (phoneNumber, label) => {
    const sanitized = sanitizePhoneNumber(phoneNumber);
    if (!sanitized) {
      Alert.alert('Phone not configured', `${label} phone number has not been configured yet.`);
      return;
    }

    const url = `tel:${sanitized}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert('Call unavailable', `This device cannot open the phone dialer for ${label}.`);
      return;
    }

    await Linking.openURL(url);
  };

  const handleStructuredSideEffect = async (userText, extracted) => {
    if (!extracted?.contains_side_effect_report || !userId) return null;

    const symptomTitle = String(extracted.symptom_title || '').trim() || 'Patient-reported symptom';
    const protocolCovered =
      typeof extracted.protocol_covered === 'boolean' ? extracted.protocol_covered : null;
    const severity = normalizeSeverity(extracted.severity);
    const result = await submitSideEffectReport({
      userId,
      symptomTitle,
      details: String(extracted.details || userText || ''),
      severity,
      onsetAt: extracted.onset_at_hint || new Date().toISOString(),
      immediateHelpRequested: Boolean(extracted.immediate_help_requested),
      reporterName: userNickname,
      sourceSystem: 'patient_ai_assistant',
      protocolCovered,
      protocolGuidance: extracted.protocol_guidance || '',
      shouldAlertCrc: Boolean(extracted.should_alert_crc),
      triageSummary: extracted.triage_summary || '',
      rawUserText: userText,
      extractedData: extracted,
      auditTrail: {
        collection_path: `users/${userId}/ai_chat_history`,
        captured_at: new Date().toISOString(),
      },
    });

    const auditMessage =
      result.crcAlerted || severity === 'serious'
        ? `**Audit note:** I documented this symptom and alerted CRC automatically. Use direct phone escalation immediately if symptoms are severe or worsening.`
        : `**Audit note:** I documented this symptom in the audit trail and matched it to the active protocol guidance.`;

    await saveMessage('system', auditMessage);
    return { ...result, severity, protocolCovered };
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setIsLoading(true);
    await saveMessage('user', userText);

    try {
      const targetId = role === 'patient' ? userId : patientData?.id;
      const { vitalsStr, appointmentsStr, protocolStatus } = await fetchFullPatientContext(targetId);
      const transcript = buildConversationTranscript(messages);
      const ctcaeContext = await retrieveCtcaeContext(userText);

      const [assistantText, extracted] = await Promise.all([
        generateAssistantText({ userText, transcript, vitalsStr, appointmentsStr, protocolStatus, ctcaeContext }),
        extractSideEffectEvent({ userText, transcript, vitalsStr, protocolStatus, ctcaeContext }),
      ]);

      if (assistantText) {
        await saveMessage('model', assistantText);
      }

      const triageResult = await handleStructuredSideEffect(userText, extracted);
      const emergencyMatch = assistantText?.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      const shouldFallbackToLiveChat =
        role === 'patient' &&
        emergencyMatch &&
        !triageResult?.crcAlerted;

      if (shouldFallbackToLiveChat && onEmergencyTrigger) {
        onEmergencyTrigger(emergencyMatch[1].trim());
      }
    } catch (error) {
      console.error('AI Error:', error);
      await saveMessage('model', '⚠️ AI Error. I could not process that message just now. Please retry, or use direct phone contact if the symptom is urgent.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';

    return (
      <View style={[styles.msgRow, isUser ? styles.userRow : isSystem ? styles.systemRow : styles.modelRow]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : isSystem ? styles.systemBubble : styles.modelBubble,
          ]}
        >
          {isUser ? (
            <Text style={styles.userText}>{item.text}</Text>
          ) : (
            <Markdown style={markdownStyles}>{item.text}</Markdown>
          )}
        </View>
      </View>
    );
  };

  if (!isOpen) {
    return (
      <TouchableOpacity style={styles.fab} onPress={() => setIsOpen(true)}>
        <Text style={styles.fabText}>{currentAiName}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.window}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{currentAiName}</Text>
              <Text style={styles.subtitle}>
                {role === 'patient'
                  ? 'Symptoms entered here are documented automatically for audit and CRC escalation when needed.'
                  : 'AI guidance for CRC workflow support.'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setIsOpen(false)}>
              <Text style={styles.close}>Close</Text>
            </TouchableOpacity>
          </View>

          {role === 'patient' ? (
            <View style={styles.guidanceCard}>
              <Text style={styles.guidanceTitle}>Describe these details for the most accurate guidance</Text>
              <Text style={styles.guidanceText}>
                Symptom name, when it started, how bad it is, latest vitals, what you already took, and whether you can breathe,
                talk, walk, or control bleeding normally.
              </Text>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.callButton} onPress={() => callPhoneNumber(callTargets.crcPhone, callTargets.crcLabel)}>
                  <Text style={styles.callButtonText}>Call {callTargets.crcLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.callButton, styles.callButtonDanger]}
                  onPress={() => callPhoneNumber(callTargets.emergencyPhone, 'Emergency services')}
                >
                  <Text style={styles.callButtonText}>Emergency Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => item.id || `${item.role}-${index}`}
            renderItem={renderMessage}
            contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
            ListEmptyComponent={
              historyReady ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>No audit chat history yet.</Text>
                </View>
              ) : null
            }
          />

          {isLoading ? <ActivityIndicator style={{ marginBottom: 10 }} color="#0056b3" /> : null}

          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              multiline
              placeholder={
                role === 'patient'
                  ? 'Describe your symptom or ask for guidance...'
                  : `Ask ${currentAiName}...`
              }
            />
            <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={isLoading}>
              <Text style={styles.sendBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    backgroundColor: '#0f609b',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 999,
    elevation: 5,
  },
  fabText: { color: 'white', fontWeight: '700' },
  container: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12,31,48,0.32)' },
  window: {
    height: '90%',
    backgroundColor: 'white',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  header: {
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderColor: '#e6edf4',
    backgroundColor: '#f8fbff',
  },
  title: { fontWeight: '800', fontSize: 18, color: '#14324a', marginBottom: 4 },
  subtitle: { color: '#52606d', lineHeight: 18, fontSize: 13 },
  close: { color: '#0f609b', fontWeight: '700' },
  guidanceCard: {
    margin: 12,
    marginBottom: 4,
    backgroundColor: '#f4f9ff',
    borderWidth: 1,
    borderColor: '#d7e4f2',
    borderRadius: 14,
    padding: 12,
  },
  guidanceTitle: { fontWeight: '700', color: '#14324a', marginBottom: 6 },
  guidanceText: { color: '#52606d', lineHeight: 18, marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  callButton: {
    flex: 1,
    backgroundColor: '#0f609b',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  callButtonDanger: {
    backgroundColor: '#b42318',
  },
  callButtonText: { color: 'white', fontWeight: '700', fontSize: 13 },
  msgRow: { marginBottom: 10, flexDirection: 'row' },
  userRow: { justifyContent: 'flex-end' },
  modelRow: { justifyContent: 'flex-start' },
  systemRow: { justifyContent: 'center' },
  bubble: { maxWidth: '88%', padding: 12, borderRadius: 14 },
  userBubble: { backgroundColor: '#0f609b' },
  modelBubble: { backgroundColor: '#f5f8fc', borderWidth: 1, borderColor: '#dfe7f1' },
  systemBubble: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa' },
  userText: { color: 'white', lineHeight: 20 },
  emptyState: { padding: 24, alignItems: 'center' },
  emptyStateText: { color: '#7b8794' },
  inputArea: {
    borderTopWidth: 1,
    borderColor: '#e6edf4',
    padding: 12,
    backgroundColor: 'white',
    gap: 10,
  },
  input: {
    minHeight: 52,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#cfd8e3',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#f8fbff',
    textAlignVertical: 'top',
  },
  sendBtn: {
    backgroundColor: '#0f609b',
    borderRadius: 14,
    alignItems: 'center',
    paddingVertical: 14,
  },
  sendBtnText: { color: 'white', fontWeight: '700' },
});

const markdownStyles = {
  body: { fontSize: 14, color: '#243b53', lineHeight: 20 },
  strong: { fontWeight: '700' },
  paragraph: { marginTop: 0, marginBottom: 0 },
};

export default GeminiChatbot;
