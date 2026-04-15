import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  where,
  writeBatch,
} from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import { db } from '../firebase';
import {
  SIDE_EFFECT_GUIDANCE_MODEL,
  SIDE_EFFECT_GUIDANCE_PROVIDER,
} from '../config';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { routeGuidanceRequest } from '../services/guidanceRouterService';
import { requestSideEffectGuidance } from '../services/sideEffectGuidanceService';

const CRC_AI_NAME = 'Side Effect Guidance';
const CHAT_HISTORY_LIMIT = 100;
const CONTEXT_WINDOW_LIMIT = 50;

function buildThinkingLabel(step, options = {}) {
  const ctcaeCount = Number(options.ctcaeCount) || 0;
  const protocolCount = Number(options.protocolCount) || 0;
  const routeDecision = String(options.routeDecision || '');

  switch (step) {
    case 'context':
      return 'Reading patient context';
    case 'route':
      return 'Deciding whether retrieval is needed';
    case 'retrieval-scoped':
      return 'Searching CTCAE and the active protocol';
    case 'retrieval-global':
      return 'Searching the guidance library';
    case 'retrieval-cache':
      return 'Reusing recent grounded excerpts';
    case 'draft':
      if (routeDecision === 'skip') {
        return 'Drafting without retrieval';
      }
      return `Drafting grounded answer (CTCAE ${ctcaeCount}, protocol ${protocolCount})`;
    default:
      return 'Thinking';
  }
}

function buildProviderUserMessage(error) {
  if (error?.message) {
    return error.message;
  }

  return 'AI Error. Side Effect Guidance is unavailable right now.';
}

function serializeForPrompt(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function sortByRecentTimestamp(entries = [], keys = []) {
  return [...entries].sort((left, right) => {
    const leftTime =
      keys.map((key) => new Date(left?.[key] || 0).getTime()).find((value) => value > 0) || 0;
    const rightTime =
      keys.map((key) => new Date(right?.[key] || 0).getTime()).find((value) => value > 0) || 0;
    return rightTime - leftTime;
  });
}

function buildStableSystemPrompt(aiName) {
  return [
    `You are ${aiName}.`,
    'Role: CRC Copilot for the CRC workspace.',
    'The current user is always a Clinical Research Coordinator (CRC).',
    'You only operate inside the CRC website.',
    'Use the directly injected workspace context and patient context as the live source of truth.',
    'Do not treat the CRC as the patient.',
    'Do not expose dropout model internals to the patient side.',
    'Use retrieved CTCAE and protocol excerpts as the only cited source material for clinical or protocol claims.',
    'If protocol excerpts are missing, say protocol grounding was not retrieved.',
    '',
    '=== SAFETY & RULES ===',
    SAFETY_INSTRUCTIONS,
  ].join('\n');
}

function buildPatientContextText({
  profile,
  patientSnapshot,
  vitals,
  appointments,
  alerts,
  eproEntries,
  incidents,
  protocol,
}) {
  return [
    '=== PATIENT PROFILE ===',
    serializeForPrompt(profile),
    '=== ACTIVE PATIENT SNAPSHOT ===',
    serializeForPrompt(patientSnapshot),
    '=== VITALS ===',
    serializeForPrompt(vitals),
    '=== APPOINTMENTS ===',
    serializeForPrompt(appointments),
    '=== ALERT HISTORY ===',
    serializeForPrompt(alerts),
    '=== EPRO SUBMISSIONS ===',
    serializeForPrompt(eproEntries),
    '=== INCIDENT RECORDS ===',
    serializeForPrompt(incidents),
    '=== ACTIVE PROTOCOL ===',
    serializeForPrompt(protocol),
  ].join('\n\n');
}

function buildWorkspaceContextText({
  patients,
  urgentAlerts,
  alerts,
  eproEntries,
  incidents,
  selectedPatient,
}) {
  return [
    '=== SELECTED PATIENT ===',
    serializeForPrompt(selectedPatient),
    '=== CRC PATIENT ROSTER WINDOW ===',
    serializeForPrompt(patients),
    '=== URGENT ALERTS ===',
    serializeForPrompt(urgentAlerts),
    '=== ALERT HISTORY WINDOW ===',
    serializeForPrompt(alerts),
    '=== EPRO WINDOW ===',
    serializeForPrompt(eproEntries),
    '=== INCIDENT WINDOW ===',
    serializeForPrompt(incidents),
  ].join('\n\n');
}

export default function GeminiChatbot({
  role = 'crc',
  userId,
  patientData,
  patientVitals = [],
  patientAppointments = [],
  patientAlerts = [],
  patientEproEntries = [],
  patientIncidents = [],
  activeProtocolId = null,
  activeProtocolName = null,
  onEmergencyTrigger,
  allPatients = [],
  workspaceAlerts = [],
  workspaceUrgentAlerts = [],
  workspaceEproEntries = [],
  workspaceIncidents = [],
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
  const [thinkingLabel, setThinkingLabel] = useState('');
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [runtimeMeta, setRuntimeMeta] = useState({
    provider: SIDE_EFFECT_GUIDANCE_PROVIDER,
    model: SIDE_EFFECT_GUIDANCE_MODEL,
  });

  const chatAreaRef = useRef(null);
  const chatSessionRef = useRef(null);
  const pendingOutputAutoScrollRef = useRef(false);
  const systemPromptRef = useRef('');
  const lastRetrievalRef = useRef(null);
  const lastRetrievalTurnIndexRef = useRef(0);
  const turnSequenceRef = useRef(0);

  const isDocked = presentation === 'docked';
  const chatVisible = isDocked || isOpen;
  const currentAiName = titleOverride || CRC_AI_NAME;
  const historyCollectionRef = userId ? collection(db, 'users', userId, 'ai_chat_history') : null;
  const workspaceContextText = useMemo(
    () =>
      buildWorkspaceContextText({
        patients: allPatients,
        urgentAlerts: workspaceUrgentAlerts,
        alerts: workspaceAlerts,
        eproEntries: workspaceEproEntries,
        incidents: workspaceIncidents,
        selectedPatient: patientData,
      }),
    [allPatients, patientData, workspaceAlerts, workspaceEproEntries, workspaceIncidents, workspaceUrgentAlerts]
  );

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

  const initializeGuidance = useCallback(async () => {
    try {
      if (role !== 'crc') {
        throw new Error('Side Effect Guidance in the CRC website is restricted to CRC users.');
      }

      systemPromptRef.current = buildStableSystemPrompt(currentAiName);
      chatSessionRef.current = true;

      if (messages.length === 0) {
        await saveMessage(
          'model',
          `**${currentAiName} ready.**\nRunning through ${SIDE_EFFECT_GUIDANCE_PROVIDER} with ${SIDE_EFFECT_GUIDANCE_MODEL}. I can use routed retrieval with CTCAE and protocol grounding when needed.`
        );
      }
    } catch (error) {
      console.error('AI initialization failed:', error);
    }
  }, [currentAiName, messages.length, role, saveMessage]);

  useEffect(() => {
    if (!historyCollectionRef) return undefined;

    const historyQuery = query(
      historyCollectionRef,
      orderBy('timestamp', 'desc'),
      limit(CHAT_HISTORY_LIMIT)
    );
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const nextMessages = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).reverse();
      setMessages(nextMessages);
      setIsHistoryLoaded(true);
    });

    return () => unsubscribe();
  }, [historyCollectionRef]);

  useEffect(() => {
    if (patientData) {
      setActiveContextPatient(patientData);
    } else {
      setActiveContextPatient(null);
    }
  }, [patientData]);

  useEffect(() => {
    lastRetrievalRef.current = null;
    lastRetrievalTurnIndexRef.current = 0;
    turnSequenceRef.current = 0;
  }, [userId]);

  useEffect(() => {
    if (chatVisible && userId && isHistoryLoaded && !chatSessionRef.current) {
      initializeGuidance();
    }
  }, [activeProtocolId, activeProtocolName, chatVisible, initializeGuidance, isHistoryLoaded, protocolUrl, userId]);

  useEffect(() => {
    if (!chatVisible || !pendingOutputAutoScrollRef.current || !chatAreaRef.current) {
      return;
    }

    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || latestMessage.role !== 'model') {
      return;
    }

    const chatArea = chatAreaRef.current;
    const timer = window.setTimeout(() => {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: 'smooth',
      });
      pendingOutputAutoScrollRef.current = false;
      setShowJumpToBottom(false);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [chatVisible, messages]);

  useEffect(() => {
    if (!chatVisible || !chatAreaRef.current) {
      return;
    }

    const chatArea = chatAreaRef.current;
    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 120);
  }, [chatVisible, isLoading, messages]);

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      chatSessionRef.current = null;
      systemPromptRef.current = '';
      lastRetrievalRef.current = null;
      lastRetrievalTurnIndexRef.current = 0;
      turnSequenceRef.current = 0;
      await initializeGuidance();
      await saveMessage('system', '**AI memory refreshed.** Latest CRC guidance context is active.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear chat history?') || !historyCollectionRef) return;

    setIsLoading(true);
    try {
      const snapshot = await getDocs(
        query(historyCollectionRef, orderBy('timestamp', 'desc'), limit(CHAT_HISTORY_LIMIT))
      );
      const batch = writeBatch(db);
      snapshot.docs.forEach((entry) => batch.delete(entry.ref));
      await batch.commit();
      setMessages([]);
      chatSessionRef.current = null;
      systemPromptRef.current = '';
      lastRetrievalRef.current = null;
      lastRetrievalTurnIndexRef.current = 0;
      turnSequenceRef.current = 0;
      await initializeGuidance();
    } catch (error) {
      console.error('Failed to clear chat history:', error);
      window.alert('Failed to clear chat history.');
    } finally {
      setIsLoading(false);
    }
  };

  const detectPatientInInput = (text) => {
    if (!allPatients.length) return null;

    const lowerText = String(text || '').toLowerCase();
    const sortedPatients = [...allPatients].sort(
      (left, right) => (right.nickname?.length || 0) - (left.nickname?.length || 0)
    );

    return (
      sortedPatients.find((patient) => {
        const name = String(patient.nickname || '').toLowerCase();
        return name && name.length > 2 && lowerText.includes(name);
      }) || null
    );
  };

  const loadPatientPromptContext = async (targetPatient) => {
    if (!targetPatient?.id) {
      return {
        patientId: null,
        patientName: 'No active patient',
        protocolId: null,
        protocolName: null,
        promptText: 'No single patient is selected. Use the CRC workspace context for workspace-level questions.',
      };
    }

    const isSelectedPatient = patientData?.id === targetPatient.id;

    if (isSelectedPatient) {
      const protocol = {
        protocolId: activeProtocolId || patientData?.protocolId || null,
        protocolName: activeProtocolName || patientData?.protocolName || null,
        protocolUrl: protocolUrl || patientData?.protocolUrl || null,
        protocolStatus: patientData?.protocolStatus || null,
      };

      return {
        patientId: patientData?.id || targetPatient.id,
        patientName: patientData?.nickname || targetPatient.nickname || targetPatient.id,
        protocolId: protocol.protocolId,
        protocolName: protocol.protocolName,
        promptText: buildPatientContextText({
          profile: patientData,
          patientSnapshot: patientData,
          vitals: patientVitals,
          appointments: patientAppointments,
          alerts: patientAlerts,
          eproEntries: patientEproEntries,
          incidents: patientIncidents,
          protocol,
        }),
      };
    }

    const profileSnapshot = await getDoc(doc(db, 'users', targetPatient.id));
    const profile = profileSnapshot.exists()
      ? { id: targetPatient.id, ...profileSnapshot.data() }
      : { id: targetPatient.id, ...targetPatient };

    const [vitalsSnapshot, appointmentsSnapshot, alertsSnapshot, eproSnapshot, incidentSnapshot] =
      await Promise.all([
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'vitals'),
            orderBy('timestamp', 'desc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'appointments'),
            orderBy('datetime', 'asc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(
          query(
            collection(db, 'users', targetPatient.id, 'alerts'),
            orderBy('timestamp', 'desc'),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
        getDocs(query(collection(db, 'users', targetPatient.id, 'epro_submissions'), limit(CONTEXT_WINDOW_LIMIT))),
        getDocs(
          query(
            collection(db, 'incident_records'),
            where('linked_patient_ids', 'array-contains', targetPatient.id),
            limit(CONTEXT_WINDOW_LIMIT)
          )
        ),
      ]);

    const vitals = vitalsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const appointments = appointmentsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const alerts = alertsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const eproEntries = sortByRecentTimestamp(
      eproSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      ['submitted_at', 'updated_at', 'assigned_at']
    );
    const incidents = sortByRecentTimestamp(
      incidentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })),
      ['updated_at', 'created_at']
    );

    const protocol = {
      protocolId: profile.protocolId || null,
      protocolName: profile.protocolName || null,
      protocolUrl: profile.protocolUrl || null,
      protocolStatus: profile.protocolStatus || null,
    };

    return {
      patientId: profile.id || targetPatient.id,
      patientName: profile.nickname || targetPatient.nickname || targetPatient.id,
      protocolId: protocol.protocolId,
      protocolName: protocol.protocolName,
      promptText: buildPatientContextText({
        profile,
        patientSnapshot: targetPatient,
        vitals,
        appointments,
        alerts,
        eproEntries,
        incidents,
        protocol,
      }),
    };
  };

  const handleSend = async (event) => {
    if (event) event.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!chatSessionRef.current) {
      await initializeGuidance();
    }
    if (!chatSessionRef.current) return;

    const userText = input.trim();
    turnSequenceRef.current += 1;
    setInput('');
    setIsLoading(true);
    setThinkingLabel(buildThinkingLabel('context'));
    pendingOutputAutoScrollRef.current = true;
    await saveMessage('user', userText);

    try {
      const mentionedPatient = detectPatientInInput(userText);
      const targetPatient = mentionedPatient || activeContextPatient || patientData || null;
      if (mentionedPatient) {
        setActiveContextPatient(mentionedPatient);
      }

      const patientContext = await loadPatientPromptContext(targetPatient);
      setThinkingLabel(buildThinkingLabel('route'));

      const routedGuidance = await routeGuidanceRequest({
        userText,
        workspaceContext: workspaceContextText,
        patientContext: patientContext.promptText,
        patientId: patientContext.patientId,
        protocolId: patientContext.protocolId,
        protocolName: patientContext.protocolName,
        hasPatientContext: Boolean(patientContext.patientId),
        historyMessages: messages,
        retrievalCache: lastRetrievalRef.current,
        currentTurnIndex: turnSequenceRef.current,
        lastRetrievalTurnIndex: lastRetrievalTurnIndexRef.current,
        onStageChange: (stage) => {
          setThinkingLabel(buildThinkingLabel(stage));
        },
      });

      setThinkingLabel(
        buildThinkingLabel('draft', {
          ctcaeCount: routedGuidance.ctcaeCount,
          protocolCount: routedGuidance.protocolCount,
          routeDecision: routedGuidance.routeDecision,
        })
      );

      const conversation = messages
        .filter((message) => message.role === 'user' || message.role === 'model')
        .map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        }));

      const { text, provider, model } = await requestSideEffectGuidance({
        provider: SIDE_EFFECT_GUIDANCE_PROVIDER,
        systemPrompt: systemPromptRef.current,
        messages: conversation,
        userMessage: routedGuidance.prompt,
      });

      setRuntimeMeta({
        provider: provider || SIDE_EFFECT_GUIDANCE_PROVIDER,
        model: model || SIDE_EFFECT_GUIDANCE_MODEL,
      });

      const emergencyMatch = text.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      if (emergencyMatch && onEmergencyTrigger) {
        onEmergencyTrigger(emergencyMatch[1].trim());
      }

      await saveMessage('model', text);

      if (routedGuidance.routeDecision === 'retrieve' && routedGuidance.nextRetrievalCache) {
        lastRetrievalRef.current = routedGuidance.nextRetrievalCache;
        lastRetrievalTurnIndexRef.current = turnSequenceRef.current;
      } else if (routedGuidance.routeDecision === 'reuse_cache' && lastRetrievalRef.current) {
        lastRetrievalTurnIndexRef.current = turnSequenceRef.current;
      }
    } catch (error) {
      console.error('AI chat request failed:', error);
      await saveMessage('model', buildProviderUserMessage(error));
      chatSessionRef.current = null;
    } finally {
      setIsLoading(false);
      setThinkingLabel('');
    }
  };

  const updateJumpToBottomState = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    const distanceFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    setShowJumpToBottom(distanceFromBottom > 120);
  };

  const handleChatAreaManualInteraction = () => {
    pendingOutputAutoScrollRef.current = false;
    updateJumpToBottomState();
  };

  const handleJumpToBottom = () => {
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;

    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: 'smooth',
    });
    pendingOutputAutoScrollRef.current = false;
    setShowJumpToBottom(false);
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
        <span className={isDocked ? 'guidance-panel__context' : ''} style={isDocked ? undefined : styles.secondaryLine}>
          Active context: <strong>{activeContextPatient?.nickname || 'No patient selected'}</strong>
        </span>
        <span className={isDocked ? 'guidance-panel__runtime' : ''} style={isDocked ? undefined : styles.runtimeInfo}>
          Runtime: <strong>{String(runtimeMeta.provider || SIDE_EFFECT_GUIDANCE_PROVIDER).toUpperCase()}</strong> using{' '}
          <strong>{runtimeMeta.model || SIDE_EFFECT_GUIDANCE_MODEL}</strong>
        </span>
      </div>

      <div
        className={isDocked ? 'guidance-panel__actions' : ''}
        style={isDocked ? undefined : { display: 'flex', alignItems: 'center', gap: '10px' }}
      >
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
    <div className={isDocked ? 'guidance-panel__chatShell' : ''} style={isDocked ? undefined : styles.chatShell}>
      <div
        ref={chatAreaRef}
        className={isDocked ? 'guidance-panel__chatArea' : ''}
        style={isDocked ? undefined : styles.chatArea}
        onScroll={updateJumpToBottomState}
        onWheel={handleChatAreaManualInteraction}
        onTouchStart={handleChatAreaManualInteraction}
        onPointerDown={handleChatAreaManualInteraction}
      >
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
              <small
                className={isDocked ? 'guidance-panel__systemMessage' : ''}
                style={isDocked ? undefined : styles.systemMessage}
              >
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
            <span className={isDocked ? 'guidance-panel__thinkingBadge' : ''} style={isDocked ? undefined : styles.thinkingBadge}>
              Think
            </span>
            <span>{thinkingLabel || 'Thinking'}</span>
          </div>
        ) : null}
      </div>
      {showJumpToBottom ? (
        <button
          type="button"
          className={isDocked ? 'guidance-panel__jumpButton' : ''}
          style={isDocked ? undefined : styles.jumpButton}
          onClick={handleJumpToBottom}
          title="Scroll to latest"
          aria-label="Scroll to latest message"
        >
          <span
            className={isDocked ? 'guidance-panel__jumpButtonIcon' : ''}
            style={isDocked ? undefined : styles.jumpIcon}
            aria-hidden="true"
          >
            ↓
          </span>
        </button>
      ) : null}
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
        onChange={(event) => setInput(event.target.value)}
        placeholder="Describe a side effect, protocol rule, vitals concern, or follow-up action..."
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
  chatShell: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
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
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '6px',
    padding: '10px 12px',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    border: '1px solid #dbe5f0',
    color: '#52606d',
    width: 'fit-content',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
  },
  thinkingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '48px',
    height: '28px',
    padding: '0 10px',
    borderRadius: '999px',
    backgroundColor: '#e8f1fb',
    color: '#0f609b',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.02em',
  },
  jumpButton: {
    position: 'absolute',
    right: '18px',
    bottom: '18px',
    width: '54px',
    height: '54px',
    borderRadius: '999px',
    border: '1px solid rgba(15, 23, 42, 0.1)',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    color: '#ffffff',
    boxShadow: '0 14px 28px rgba(15, 23, 42, 0.24)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(10px)',
    zIndex: 2,
  },
  jumpIcon: {
    fontSize: '30px',
    lineHeight: 1,
    transform: 'translateY(-1px)',
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
