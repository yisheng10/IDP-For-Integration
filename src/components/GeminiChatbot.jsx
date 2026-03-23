import React, { useEffect, useRef, useState } from 'react';
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
  writeBatch,
} from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import { db } from '../firebase';
import { GEMINI_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL } from '../config';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { extractTextFromPdf } from '../utils';
import { requestSideEffectGuidance } from '../services/sideEffectGuidanceService';
import { getSignedUrl } from '../services/storageService';
import { supabase } from '../supabaseClient';

const CRC_AI_NAME = 'Side Effect Guidance';
const PATIENT_AI_NAME = 'AI Assistant';
const OLLAMA_TIMEOUT_MS = 25000;

class OllamaRequestError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'OllamaRequestError';
    this.kind = kind;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = OLLAMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function readJsonSafely(response) {
  const rawText = await response.text();
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch {
    return { rawText };
  }
}

async function UNUSED_ensureOllamaReady() {
  let response;
  try {
    response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' }, 4000);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new OllamaRequestError('timeout', `Ollama health check timed out at ${OLLAMA_BASE_URL}.`);
    }

    throw new OllamaRequestError(
      'unreachable',
      `Ollama is not reachable at ${OLLAMA_BASE_URL}. Start Ollama and retry.`
    );
  }

  if (!response.ok) {
    throw new OllamaRequestError(
      'bad_status',
      `Ollama health check returned HTTP ${response.status}.`
    );
  }

  const payload = await readJsonSafely(response);
  const availableModels = Array.isArray(payload.models)
    ? payload.models.map((entry) => entry?.name || entry?.model).filter(Boolean)
    : [];

  const hasConfiguredModel = availableModels.some((name) => {
    const normalized = String(name);
    return (
      normalized === OLLAMA_MODEL ||
      normalized.startsWith(`${OLLAMA_MODEL}:`) ||
      OLLAMA_MODEL.startsWith(`${normalized}:`)
    );
  });

  if (!hasConfiguredModel) {
    throw new OllamaRequestError(
      'missing_model',
      `Ollama is running, but model "${OLLAMA_MODEL}" is not installed. Run "ollama pull ${OLLAMA_MODEL}" and retry.`
    );
  }
}

function buildOllamaUserMessage(error) {
  if (error?.message) {
    return error.message;
  }

  return '⚠️ AI Error. Side Effect Guidance is unavailable right now.';
}

export default function GeminiChatbot({
  role,
  userNickname,
  userId,
  patientData,
  activeProtocolName,
  onEmergencyTrigger,
  allPatients = [],
  protocolUrl,
  presentation = 'floating',
  titleOverride,
  panelDescription,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [activeContextPatient, setActiveContextPatient] = useState(null);
  const [runtimeMeta, setRuntimeMeta] = useState({
    provider: role === 'crc' ? 'gemini' : 'local',
    model: role === 'crc' ? 'gemini-2.5-flash' : OLLAMA_MODEL,
  });

  const chatSessionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const systemPromptRef = useRef('');

  const isDocked = presentation === 'docked';
  const chatVisible = isDocked || isOpen;
  const currentAiName = titleOverride || (role === 'crc' ? CRC_AI_NAME : PATIENT_AI_NAME);
  const historyCollectionRef = userId ? collection(db, 'users', userId, 'ai_chat_history') : null;

  useEffect(() => {
    if (!historyCollectionRef) return undefined;

    const historyQuery = query(historyCollectionRef, orderBy('timestamp', 'asc'));
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const nextMessages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setMessages(nextMessages);
      setIsHistoryLoaded(true);
    });

    return () => unsubscribe();
  }, [historyCollectionRef]);

  useEffect(() => {
    if (role === 'crc' && patientData) {
      setActiveContextPatient(patientData);
    } else if (role === 'crc') {
      setActiveContextPatient(null);
    }
  }, [patientData, role]);

  useEffect(() => {
    const readyToStart = chatVisible && userId && isHistoryLoaded;
    if (readyToStart && !chatSessionRef.current) {
      startHybridChat();
    }
  }, [chatVisible, isHistoryLoaded, protocolUrl, userId]);

  useEffect(() => {
    if (!chatVisible) return;
    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    return () => window.clearTimeout(timer);
  }, [chatVisible, isLoading, messages]);

  const saveMessage = async (messageRole, text) => {
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
  };

  const searchCTCAE = async (queryText) => {
    try {
      if (!queryText || queryText.length < 3) return '';

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const embeddingResult = await embeddingModel.embedContent(queryText);
      const embedding = embeddingResult.embedding.values;

      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: 5,
      });

      if (error || !data?.length) {
        return '';
      }

      return data
        .map((entry) => {
          let pageNumber = 'Unknown';
          try {
            const metadata = typeof entry.metadata === 'string' ? JSON.parse(entry.metadata) : entry.metadata;
            if (metadata?.page) pageNumber = metadata.page;
          } catch {
            pageNumber = 'Unknown';
          }
          return `[Page ${pageNumber}]: ${entry.content}`;
        })
        .join('\n\n---\n\n');
    } catch {
      return '';
    }
  };

  const fetchGlobalPatientSummary = async () => {
    if (!allPatients.length) {
      return 'No patients found in the live database.';
    }

    const targetPatients = allPatients.slice(0, 50);
    const patientSummaries = await Promise.all(
      targetPatients.map(async (patient) => {
        let summary = `- Name: **${patient.nickname}** (ID: ${patient.hospitalPatientId || 'N/A'})`;

        try {
          const vitalsQuery = query(
            collection(db, 'users', patient.id, 'vitals'),
            orderBy('timestamp', 'desc'),
            limit(1)
          );
          const vitalsSnapshot = await getDocs(vitalsQuery);

          if (!vitalsSnapshot.empty) {
            const vitals = vitalsSnapshot.docs[0].data();
            const day = new Date(vitals.timestamp).toLocaleDateString();
            summary += `\n  Latest vitals (${day}): Temp ${vitals.temperature || '-'} C, BP ${vitals.bpSys || '-'}/${vitals.bpDia || '-'}, SpO2 ${vitals.spo2 || '-'}%`;
          } else {
            summary += '\n  Latest vitals: none';
          }
        } catch {
          summary += '\n  Latest vitals: unavailable';
        }

        try {
          const appointmentQuery = query(
            collection(db, 'users', patient.id, 'appointments'),
            orderBy('datetime', 'asc'),
            limit(2)
          );
          const appointmentSnapshot = await getDocs(appointmentQuery);

          if (!appointmentSnapshot.empty) {
            const nextAppointments = appointmentSnapshot.docs
              .map((entry) => {
                const appointment = entry.data();
                return `${new Date(appointment.datetime).toLocaleDateString()} (${appointment.status})`;
              })
              .join(', ');
            summary += `\n  Upcoming appointments: ${nextAppointments}`;
          }
        } catch {
          summary += '\n  Upcoming appointments: unavailable';
        }

        return summary;
      })
    );

    return `=== LIVE PATIENT DATABASE ===\n${patientSummaries.join('\n')}`;
  };

  const fetchGlobalSchedule = async () => {
    if (!allPatients.length) {
      return 'No patients found.';
    }

    const today = new Date();
    const scheduleRows = [];
    const targetPatients = allPatients.slice(0, 20);

    await Promise.all(
      targetPatients.map(async (patient) => {
        try {
          const appointmentQuery = query(
            collection(db, 'users', patient.id, 'appointments'),
            orderBy('datetime', 'asc')
          );
          const appointmentSnapshot = await getDocs(appointmentQuery);

          appointmentSnapshot.docs.forEach((entry) => {
            const appointment = entry.data();
            if (new Date(appointment.datetime) >= today) {
              scheduleRows.push({
                patient: patient.nickname,
                datetime: appointment.datetime,
                status: appointment.status,
              });
            }
          });
        } catch {
          // Ignore individual patient fetch errors and continue with the rest.
        }
      })
    );

    scheduleRows.sort((left, right) => new Date(left.datetime) - new Date(right.datetime));

    if (!scheduleRows.length) {
      return 'No upcoming appointments found globally.';
    }

    return `=== MASTER APPOINTMENT SCHEDULE ===\n${scheduleRows
      .slice(0, 15)
      .map(
        (row) =>
          `- ${new Date(row.datetime).toLocaleString()}: ${row.patient} (${row.status})`
      )
      .join('\n')}`;
  };

  const fetchFullPatientContext = async (targetId, patientObject = null) => {
    let vitalsSummary = 'No vitals recorded.';
    let appointmentSummary = 'No upcoming appointments.';
    let protocolText = null;
    let protocolStatus = 'No protocol assigned.';

    const formatVitalLog = (entry) => {
      const date = new Date(entry.timestamp).toLocaleDateString();
      const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `[${date} ${time}] Temp:${entry.temperature || '-'} BP:${entry.bpSys || '-'}/${entry.bpDia || '-'} SpO2:${entry.spo2 || '-'}%`;
    };

    try {
      const vitalsQuery = query(
        collection(db, 'users', targetId, 'vitals'),
        orderBy('timestamp', 'desc'),
        limit(10)
      );
      const vitalsSnapshot = await getDocs(vitalsQuery);
      if (!vitalsSnapshot.empty) {
        vitalsSummary = vitalsSnapshot.docs.map((entry) => formatVitalLog(entry.data())).join('\n');
      }

      const appointmentQuery = query(
        collection(db, 'users', targetId, 'appointments'),
        orderBy('datetime', 'asc'),
        limit(5)
      );
      const appointmentSnapshot = await getDocs(appointmentQuery);
      if (!appointmentSnapshot.empty) {
        appointmentSummary = appointmentSnapshot.docs
          .map((entry) => {
            const appointment = entry.data();
            return `- ${new Date(appointment.datetime).toLocaleString()} (${appointment.status})`;
          })
          .join('\n');
      }

      let resolvedProtocolUrl = patientObject?.protocolUrl;
      if (!resolvedProtocolUrl && protocolUrl) resolvedProtocolUrl = protocolUrl;

      if (!resolvedProtocolUrl) {
        const userDocument = await getDoc(doc(db, 'users', targetId));
        if (userDocument.exists()) {
          resolvedProtocolUrl = userDocument.data().protocolUrl;
        }
      }

      if (resolvedProtocolUrl) {
        let downloadUrl = resolvedProtocolUrl;
        if (!resolvedProtocolUrl.startsWith('http')) {
          const signedUrl = await getSignedUrl(resolvedProtocolUrl, 'protocol');
          if (signedUrl) {
            downloadUrl = signedUrl;
          } else {
            protocolStatus = 'Protocol file could not be authorized.';
          }
        }

        if (downloadUrl && protocolStatus !== 'Protocol file could not be authorized.') {
          const extractedText = await extractTextFromPdf(downloadUrl);
          if (extractedText) {
            protocolText = extractedText;
            protocolStatus = activeProtocolName || patientObject?.protocolName || 'Protocol text extracted';
          } else {
            protocolStatus = 'Protocol text extraction failed.';
          }
        }
      }
    } catch (error) {
      protocolStatus = `Protocol context error: ${error.message}`;
    }

    return {
      vitalsSummary,
      appointmentSummary,
      protocolText,
      protocolStatus,
    };
  };

  const startHybridChat = async () => {
    try {
      let systemInstruction = `You are ${currentAiName}. Role: ${role === 'crc' ? 'CRC Assistant' : 'Patient Companion'}.`;

      if (role === 'crc' && !patientData) {
        systemInstruction +=
          '\n\n[SYSTEM: GLOBAL DASHBOARD MODE]\nYou have access to the full patient database. Answer questions about any patient or the overall schedule.';
        const globalSummary = await fetchGlobalPatientSummary();
        systemInstruction += `\n\n${globalSummary}`;
      }

      const targetId = role === 'crc' ? patientData?.id : userId;

      if (targetId && (role === 'patient' || patientData)) {
        const { vitalsSummary, appointmentSummary, protocolText, protocolStatus } = await fetchFullPatientContext(
          targetId,
          patientData
        );
        const focusedPatientName = role === 'crc' ? patientData?.nickname : userNickname;

        systemInstruction += `\n\n=== CURRENT FOCUS: ${focusedPatientName || 'Patient'} ===\nVITALS:\n${vitalsSummary}\n\nAPPOINTMENTS:\n${appointmentSummary}\n\nPROTOCOL STATUS: ${protocolStatus}`;

        if (protocolText) {
          systemInstruction += `\n\n[PROTOCOL DOCUMENT CONTENT]\n${protocolText}`;
        }
      }

      systemInstruction += `\n\n=== SAFETY & RULES ===\n${SAFETY_INSTRUCTIONS}`;
      systemPromptRef.current = systemInstruction;
      chatSessionRef.current = true;

      if (messages.length === 0) {
        const intro =
          role === 'crc'
            ? `**${currentAiName} ready.**\nRunning through the secure Gemini guidance service. I can help with vitals, appointments, protocols, and CTCAE guidance.`
            : `Hello **${userNickname || 'there'}**. I am ${currentAiName}.`;
        await saveMessage('model', intro);
      }
    } catch (error) {
      console.error('AI initialization failed:', error);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await startHybridChat();
      await saveMessage('system', '**AI memory refreshed.** Latest patient and protocol data loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear chat history?')) return;

    setIsLoading(true);
    try {
      const snapshot = await getDocs(historyCollectionRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach((entry) => batch.delete(entry.ref));
      await batch.commit();
      setMessages([]);
      chatSessionRef.current = null;
      await startHybridChat();
    } catch {
      alert('Failed to clear chat history.');
    } finally {
      setIsLoading(false);
    }
  };

  const detectPatientInInput = (text) => {
    if (role !== 'crc' || !allPatients.length) return null;

    const lowerText = text.toLowerCase();
    const sortedPatients = [...allPatients].sort(
      (left, right) => (right.nickname?.length || 0) - (left.nickname?.length || 0)
    );

    return (
      sortedPatients.find((patient) => {
        const name = (patient.nickname || '').toLowerCase();
        return name && name.length > 2 && lowerText.includes(name);
      }) || null
    );
  };

  const handleSend = async (event) => {
    if (event) event.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!chatSessionRef.current) {
      await startHybridChat();
    }

    if (!chatSessionRef.current) return;

    const userText = input;
    setInput('');
    setIsLoading(true);
    await saveMessage('user', userText);

    try {
      const mentionedPatient = detectPatientInInput(userText);
      const fallbackPatient =
        role === 'crc' ? activeContextPatient : { id: userId, nickname: userNickname };
      const targetPatient = mentionedPatient || fallbackPatient;
      let systemInjection = '';

      const isAskingSchedule = /appointments|schedule|calendar/i.test(userText);
      if (role === 'crc' && isAskingSchedule && !targetPatient) {
        const scheduleSummary = await fetchGlobalSchedule();
        systemInjection += `\n[SYSTEM: GLOBAL SCHEDULE]\n${scheduleSummary}\n`;
      } else if (role === 'crc' && /patients|vitals|summary|list|everyone|all/i.test(userText)) {
        const globalSummary = await fetchGlobalPatientSummary();
        systemInjection += `\n[SYSTEM: REAL-TIME PATIENT DATABASE]\n${globalSummary}\n`;
      }

      const isProtocolQuestion = /protocol|summary|trial|pdf|document/i.test(userText);
      if (targetPatient || isProtocolQuestion) {
        const finalTarget =
          targetPatient || activeContextPatient || (role === 'patient' ? { id: userId } : null);

        if (finalTarget) {
          const { vitalsSummary, appointmentSummary, protocolText, protocolStatus } = await fetchFullPatientContext(
            finalTarget.id,
            finalTarget
          );
          const patientName = finalTarget.nickname || 'The patient';

          systemInjection += `\n[DATA INJECTION FOR: ${patientName}]\nVITALS:\n${vitalsSummary}\n\nAPPOINTMENTS:\n${appointmentSummary}\n\nPROTOCOL STATUS: ${protocolStatus}`;

          if (protocolText) {
            systemInjection += `\n\n[PROTOCOL DOCUMENT CONTENT]\n${protocolText}`;
          }
        }
      }

      const ragContext = role === 'crc' ? '' : await searchCTCAE(userText);
      if (ragContext) {
        systemInjection += `\n\n[CTCAE KNOWLEDGE BASE]\n${ragContext}\n(Cite pages like [Page 4] when relevant)\n`;
      }

      if (role !== 'crc') {
        throw new Error('⚠️ AI Error. Web-based Side Effect Guidance is restricted to the CRC workspace.');
      }

      const conversation = messages
        .filter((message) => message.role === 'user' || message.role === 'model')
        .map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        }));

      const { text, provider, model } = await requestSideEffectGuidance({
        provider: role === 'crc' ? 'gemini' : 'local',
        systemPrompt: systemPromptRef.current,
        messages: conversation,
        userMessage: systemInjection ? `${systemInjection}\nUser Query: ${userText}` : userText,
      });

      setRuntimeMeta({
        provider: provider || 'gemini',
        model: model || 'gemini-2.5-flash',
      });

      const emergencyMatch = text.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      if (emergencyMatch && onEmergencyTrigger) {
        onEmergencyTrigger(emergencyMatch[1].trim());
      }

      await saveMessage('model', text);
    } catch (error) {
      console.error('AI chat request failed:', error);
      await saveMessage('model', buildOllamaUserMessage(error));
      chatSessionRef.current = null;
    } finally {
      setIsLoading(false);
    }
  };

  if (!chatVisible) {
    return (
      <button onClick={() => setIsOpen(true)} style={styles.fab}>
        <span style={styles.fabText}>{currentAiName}</span>
      </button>
    );
  }

  const headerBlock = (
    <div className={isDocked ? 'guidance-panel__header' : ''} style={isDocked ? undefined : styles.header}>
      <div
        className={isDocked ? 'guidance-panel__headerCopy' : ''}
        style={isDocked ? undefined : { display: 'flex', flexDirection: 'column', gap: '4px' }}
      >
        <span className={isDocked ? 'guidance-panel__title' : ''} style={isDocked ? undefined : styles.title}>
          {currentAiName}
        </span>
        {panelDescription ? <span className="guidance-panel__description">{panelDescription}</span> : null}
        {role === 'crc' ? (
          <span className={isDocked ? 'guidance-panel__context' : ''} style={isDocked ? undefined : styles.secondaryLine}>
            Active context: <strong>{activeContextPatient?.nickname || 'Global CRC mode'}</strong>
          </span>
        ) : null}
        <span className={isDocked ? 'guidance-panel__runtime' : ''} style={isDocked ? undefined : styles.runtimeInfo}>
          Runtime: <strong>{String(runtimeMeta.provider || 'gemini').toUpperCase()}</strong> using{' '}
          <strong>{runtimeMeta.model || 'gemini-2.5-flash'}</strong>
        </span>
      </div>

      <div className={isDocked ? 'guidance-panel__actions' : ''} style={isDocked ? undefined : { display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button onClick={handleRefresh} style={styles.iconButton} title="Refresh AI data">
          Refresh
        </button>
        <button onClick={handleClearHistory} style={styles.iconButton} title="Clear chat history">
          Clear
        </button>
        {!isDocked ? (
          <button onClick={() => setIsOpen(false)} style={styles.iconButton}>
            Close
          </button>
        ) : null}
      </div>
    </div>
  );

  const messagesBlock = (
    <div className={isDocked ? 'guidance-panel__chatArea' : ''} style={isDocked ? undefined : styles.chatArea}>
      {messages.map((message, index) => (
        <div
          key={message.id || index}
          className={isDocked ? `guidance-panel__messageRow guidance-panel__messageRow--${message.role}` : ''}
          style={
            isDocked
              ? undefined
              : {
                  ...styles.messageRow,
                  justifyContent:
                    message.role === 'user'
                      ? 'flex-end'
                      : message.role === 'system'
                        ? 'center'
                        : 'flex-start',
                }
          }
        >
          {message.role === 'system' ? (
            <small className={isDocked ? 'guidance-panel__systemMessage' : ''} style={isDocked ? undefined : styles.systemMessage}>
              <ReactMarkdown>{message.text}</ReactMarkdown>
            </small>
          ) : (
            <div
              className={
                isDocked
                  ? `guidance-panel__bubble ${message.role === 'user' ? 'guidance-panel__bubble--user' : 'guidance-panel__bubble--model'}`
                  : ''
              }
              style={
                isDocked
                  ? undefined
                  : {
                      ...styles.bubble,
                      backgroundColor: message.role === 'user' ? '#0f609b' : '#f8fbff',
                      color: message.role === 'user' ? 'white' : '#243b53',
                      border: message.role === 'user' ? 'none' : '1px solid #dbe5f0',
                    }
              }
            >
              {message.role === 'model' ? <ReactMarkdown>{message.text}</ReactMarkdown> : message.text}
            </div>
          )}
        </div>
      ))}
      {isLoading ? (
        <div className={isDocked ? 'guidance-panel__loading' : ''} style={isDocked ? undefined : styles.loadingState}>
          Thinking...
        </div>
      ) : null}
      <div ref={messagesEndRef} />
    </div>
  );

  const inputBlock = (
    <form
      onSubmit={handleSend}
      className={isDocked ? 'guidance-panel__inputArea' : ''}
      style={isDocked ? undefined : styles.inputArea}
    >
      <input
        type="text"
        className={isDocked ? 'guidance-panel__input' : ''}
        style={isDocked ? undefined : styles.input}
        value={input}
        onChange={(entry) => setInput(entry.target.value)}
        placeholder={
          role === 'crc'
            ? 'Describe a side effect, protocol rule, vitals concern, or follow-up action...'
            : 'Type a message...'
        }
      />
      <button
        type="submit"
        className={isDocked ? 'guidance-panel__sendButton' : ''}
        style={isDocked ? undefined : styles.sendButton}
        disabled={isLoading}
      >
        Send
      </button>
    </form>
  );

  if (isDocked) {
    return (
      <section className="card workspace-card intelligence-card intelligence-card--guidance">
        {headerBlock}
        {messagesBlock}
        {inputBlock}
      </section>
    );
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.window}>
        {headerBlock}
        {messagesBlock}
        {inputBlock}
      </div>
    </div>
  );
}

const styles = {
  fab: {
    position: 'fixed',
    bottom: '30px',
    left: '24px',
    backgroundColor: '#0f609b',
    padding: '14px 20px',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.3)',
    boxShadow: '0 16px 32px rgba(15, 96, 155, 0.35)',
    cursor: 'pointer',
    zIndex: 9999,
  },
  fabText: {
    color: 'white',
    fontWeight: '700',
    fontSize: '15px',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 10000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  window: {
    width: '100%',
    maxWidth: '680px',
    height: '88%',
    backgroundColor: 'white',
    borderTopLeftRadius: '24px',
    borderTopRightRadius: '24px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 -24px 80px rgba(15, 23, 42, 0.24)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '18px 20px',
    borderBottom: '1px solid #e5edf6',
    backgroundColor: '#f8fbff',
  },
  title: {
    fontWeight: '700',
    fontSize: '18px',
    color: '#14324a',
  },
  secondaryLine: {
    fontSize: '12px',
    color: '#52606d',
  },
  runtimeInfo: {
    fontSize: '12px',
    color: '#64748b',
  },
  iconButton: {
    border: '1px solid #d7e3f0',
    background: 'white',
    color: '#0f609b',
    borderRadius: '10px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: '600',
  },
  chatArea: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    backgroundColor: '#f6f9fc',
  },
  messageRow: {
    display: 'flex',
    marginBottom: '12px',
    width: '100%',
  },
  systemMessage: {
    color: '#64748b',
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '88%',
    padding: '12px 14px',
    borderRadius: '16px',
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  loadingState: {
    padding: '10px 2px',
    fontStyle: 'italic',
    color: '#64748b',
  },
  inputArea: {
    display: 'flex',
    padding: '16px 20px 20px',
    borderTop: '1px solid #e5edf6',
    backgroundColor: 'white',
    gap: '12px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    borderRadius: '14px',
    border: '1px solid #c7d4e2',
    outline: 'none',
    fontSize: '14px',
  },
  sendButton: {
    minWidth: '84px',
    backgroundColor: '#0f609b',
    borderRadius: '14px',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    fontWeight: '700',
    padding: '0 18px',
  },
};
