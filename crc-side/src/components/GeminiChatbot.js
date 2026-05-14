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
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useCall } from '../context/CallContext';
import { db } from '../firebase';
import { SAFETY_INSTRUCTIONS } from '../safetyInstructions';
import { retrieveGuidanceContext } from '../services/guidanceRetrievalService';
import { requestSideEffectGuidance } from '../services/sideEffectGuidanceService';
import { submitSideEffectReport } from '../services/sideEffectService';

const CRC_AI_NAME = 'Side Effect Guidance';
const PATIENT_AI_NAME = 'AI Side Effect Guidance';
const DEFAULT_EMERGENCY_PHONE = '999';
const CHAT_HISTORY_LIMIT = 100;
const DEFAULT_RETRIEVAL_MATCH_COUNT = 3;
const EMERGENCY_KEYWORDS = [
  { label: 'Breathing difficulty', patterns: [/can'?t breathe/i, /cannot breathe/i, /difficulty breathing/i, /short(ness)? of breath/i, /喘/i] },
  { label: 'Chest pain', patterns: [/chest pain/i, /tight chest/i, /胸痛/i] },
  { label: 'Severe allergic reaction', patterns: [/swollen tongue/i, /swollen lips/i, /face swelling/i, /anaphyl/i, /allergic reaction/i] },
  { label: 'Uncontrolled bleeding', patterns: [/bleeding.*won'?t stop/i, /cannot stop bleeding/i, /heavy bleeding/i] },
  { label: 'Collapse or seizure', patterns: [/faint(ed|ing)?/i, /passed out/i, /unconscious/i, /seizure/i, /convulsion/i] },
];
const MODERATE_KEYWORDS = [
  { label: 'Flu-like symptoms', patterns: [/\bflu\b/i, /\bfever\b/i, /\bchills?\b/i, /feel warm/i, /hot flush/i] },
  { label: 'Dizziness', patterns: [/\bdizz(y|iness)\b/i, /lightheaded/i, /vertigo/i] },
  { label: 'Nausea or vomiting', patterns: [/\bnausea\b/i, /\bvomit/i, /\bthrowing up\b/i] },
  { label: 'Diarrhoea', patterns: [/\bdiarrh/i, /\bloose stool/i] },
  { label: 'Rash or skin reaction', patterns: [/\brash\b/i, /\bhives\b/i, /\bitch(y|ing)\b/i] },
  { label: 'Headache', patterns: [/\bheadache\b/i, /\bmigraine\b/i] },
];
const MILD_KEYWORDS = [
  { label: 'Tiredness', patterns: [/\btired\b/i, /\bfatigue\b/i, /\bweak\b/i] },
  { label: 'Body ache', patterns: [/\bache\b/i, /\bsore\b/i, /\bpain\b/i] },
  { label: 'Cough or sore throat', patterns: [/\bcough\b/i, /\bsore throat\b/i, /\bthroat pain\b/i] },
];

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

function isAssignedProtocolName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return !['not assigned', 'no protocol assigned', 'no protocol assigned.', 'none', 'null', 'undefined'].includes(normalized);
}

function isClearlyNonClinicalMessage(userText) {
  const normalized = String(userText || '').trim().toLowerCase();
  if (!normalized) return true;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)$/i.test(normalized)) return true;
  if (
    /^(open|close|show|hide|where is|how do i use)\b/i.test(normalized) &&
    /\b(app|screen|page|button|menu|login|logout|password|profile|chat|window)\b/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function buildDefaultRetrievalRoute({ userText, hasActiveProtocol }) {
  if (isClearlyNonClinicalMessage(userText)) {
    return {
      retrieveCtcae: false,
      retrieveProtocol: false,
      ctcaeQuery: '',
      protocolQuery: '',
      reason: 'Message appears non-clinical and does not require document retrieval.',
    };
  }

  return {
    retrieveCtcae: true,
    retrieveProtocol: hasActiveProtocol,
    ctcaeQuery: userText,
    protocolQuery: hasActiveProtocol ? userText : '',
    reason: hasActiveProtocol
      ? 'Router was unavailable or unclear; defaulting to broader CTCAE and protocol retrieval.'
      : 'Router was unavailable or unclear; no active protocol assigned, so retrieving CTCAE only.',
  };
}

function findFirstKeywordMatch(text, groups) {
  for (const entry of groups) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.label;
    }
  }
  return '';
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function inferLatestVitalsSummary(patientData) {
  const latest = Array.isArray(patientData?.vitals) && patientData.vitals.length > 0 ? patientData.vitals[0] : null;
  if (!latest) {
    return {
      summary: 'No recent vitals available in the app.',
      hasCriticalVitals: false,
    };
  }

  const rows = [];
  if (latest.temperature) rows.push(`Temp ${latest.temperature} C`);
  if (latest.bpSys) rows.push(`BP ${latest.bpSys}/${latest.bpDia || '-'}`);
  if (latest.heartRate) rows.push(`HR ${latest.heartRate}`);
  if (latest.spo2) rows.push(`SpO2 ${latest.spo2}%`);
  if (latest.glucoseFasting) rows.push(`Glucose(F) ${latest.glucoseFasting}`);
  if (latest.glucosePost) rows.push(`Glucose(P) ${latest.glucosePost}`);

  const temp = toPositiveNumber(latest.temperature);
  const spo2 = toPositiveNumber(latest.spo2);
  const bpSys = toPositiveNumber(latest.bpSys);
  const hasCriticalVitals =
    (temp && temp >= 39) ||
    (spo2 && spo2 > 0 && spo2 < 92) ||
    bpSys >= 180;

  return {
    summary: rows.length > 0 ? rows.join(' | ') : 'No recent vitals available in the app.',
    hasCriticalVitals,
  };
}

function looksLikeSymptomReport(userText) {
  const text = String(userText || '').trim().toLowerCase();
  if (!text) return false;
  if (text.length >= 12) return true;
  return (
    EMERGENCY_KEYWORDS.some((entry) => entry.patterns.some((pattern) => pattern.test(text))) ||
    MODERATE_KEYWORDS.some((entry) => entry.patterns.some((pattern) => pattern.test(text))) ||
    MILD_KEYWORDS.some((entry) => entry.patterns.some((pattern) => pattern.test(text)))
  );
}

function buildFallbackSideEffectAssessment({ userText, patientData, activeProtocolName }) {
  const text = String(userText || '').trim();
  const normalized = text.toLowerCase();
  const vitals = inferLatestVitalsSummary(patientData);
  const emergencyLabel = findFirstKeywordMatch(normalized, EMERGENCY_KEYWORDS);
  const moderateLabel = findFirstKeywordMatch(normalized, MODERATE_KEYWORDS);
  const mildLabel = findFirstKeywordMatch(normalized, MILD_KEYWORDS);

  let severity = 'mild';
  let symptomTitle = moderateLabel || mildLabel || 'Patient-reported symptom';
  let immediateHelpRequested = false;
  let shouldAlertCrc = false;
  let triageSummary = 'Fallback triage used because the AI guidance service was temporarily unavailable.';
  let guidanceTitle = 'Temporary guidance fallback';
  let safetyAction = 'Please monitor the symptom closely, record your vitals if you can, and contact CRC if it gets worse or keeps coming back.';

  if (emergencyLabel || vitals.hasCriticalVitals) {
    severity = 'serious';
    symptomTitle = emergencyLabel || 'Possible urgent symptom';
    immediateHelpRequested = true;
    shouldAlertCrc = true;
    guidanceTitle = 'Urgent safety fallback';
    triageSummary =
      'Possible urgent symptom detected while the AI service was unavailable. Immediate phone escalation was recommended.';
    safetyAction =
      'Call the study emergency number or local emergency services immediately. Do not wait for chat if you feel unsafe, cannot breathe, have severe chest pain, uncontrolled bleeding, collapse, or rapidly worsening symptoms.';
  } else if (moderateLabel) {
    severity = 'moderate';
    symptomTitle = moderateLabel;
    shouldAlertCrc = true;
    guidanceTitle = 'Same-day CRC follow-up fallback';
    triageSummary =
      'Moderate symptom pattern detected while the AI service was unavailable. Same-day CRC follow-up was recommended.';
    safetyAction =
      'Please record your latest vitals if possible, rest, avoid taking any extra study medication unless already instructed, and contact CRC today for review. Use the emergency call option sooner if symptoms worsen.';
  }

  const assistantText = [
    `**${guidanceTitle}.** The AI service is temporarily busy, so I am using a safety fallback.`,
    '',
    `**What I understood:** ${text || 'A possible symptom was reported.'}`,
    '',
    `**Current triage level:** ${severity.toUpperCase()}`,
    '',
    `**Immediate next step:** ${safetyAction}`,
    '',
    `**Recent vitals:** ${vitals.summary}`,
    '',
    `**Protocol note:** I cannot safely confirm protocol-specific wording right now${activeProtocolName ? ` for ${activeProtocolName}` : ''}. CRC can review the active protocol directly if needed.`,
    '',
    '**Safety note:** This message is still documented for audit. If you feel suddenly worse, use direct phone escalation instead of waiting in chat.',
  ].join('\n');

  return {
    assistantText,
    extracted: {
      contains_side_effect_report: looksLikeSymptomReport(text),
      symptom_title: symptomTitle,
      details: text,
      severity,
      onset_at_hint: new Date().toISOString(),
      immediate_help_requested: immediateHelpRequested,
      protocol_covered: null,
      protocol_guidance: '',
      should_alert_crc: shouldAlertCrc,
      triage_summary: triageSummary,
    },
  };
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
  const [showEmergencySheet, setShowEmergencySheet] = useState(false);

  const scrollViewRef = useRef(null);
  const introWrittenRef = useRef(false);

  const { startCall } = useCall();
  const currentAiName = role === 'crc' ? CRC_AI_NAME : PATIENT_AI_NAME;
  const historyCollectionRef = userId ? collection(db, 'users', userId, 'ai_chat_history') : null;
  const activeProtocolId = patientData?.protocolId || patientData?.protocol_id || null;
  const resolvedProtocolName = activeProtocolName || patientData?.protocolName || patientData?.protocol_name || '';

  const callTargets = useMemo(
    () => ({
      crcUserId: contactContext.primaryCrcId || '',
      crcLabel: contactContext.primaryCrcName || 'CRC',
      crcPhone: sanitizePhoneNumber(contactContext.primaryCrcPhone),
      emergencyPhone: sanitizePhoneNumber(contactContext.studyEmergencyPhone) || DEFAULT_EMERGENCY_PHONE,
    }),
    [contactContext]
  );

  useEffect(() => {
    introWrittenRef.current = false;
  }, [userId, role]);

  useEffect(() => {
    if (!historyCollectionRef) {
      setHistoryReady(true);
      return undefined;
    }

    const historyQuery = query(
      historyCollectionRef,
      orderBy('timestamp', 'desc'),
      limit(CHAT_HISTORY_LIMIT)
    );
    const unsubscribe = onSnapshot(historyQuery, (snapshot) => {
      const nextMessages = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...entry.data(),
      })).reverse();
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

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [isOpen, isLoading, messages]);

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

  const fetchFullPatientContext = async (targetId) => {
    let vitalsStr = 'No vitals recorded.';
    let appointmentsStr = 'No upcoming appointments.';
    let protocolStatus = resolvedProtocolName || 'No protocol assigned.';

    if (!targetId) {
      return { vitalsStr, appointmentsStr, protocolStatus };
    }

    try {
      if (patientData?.vitals?.length) {
        vitalsStr = patientData.vitals.slice(0, 10).map(formatVitalLog).join('\n');
      } else {
        const vitalsQuery = query(collection(db, 'users', targetId, 'vitals'), orderBy('timestamp', 'desc'), limit(5));
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
          limit(3)
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

      if (!resolvedProtocolName) {
        const userSnapshot = await getDoc(doc(db, 'users', targetId));
        if (userSnapshot.exists()) {
          const profile = userSnapshot.data();
          protocolStatus = profile.protocolName || protocolStatus;
        }
      }
    } catch (error) {
      console.error('Patient context read failed:', error);
    }

    return { vitalsStr, appointmentsStr, protocolStatus };
  };

  const routeGuidanceRetrieval = async ({ userText, transcript, vitalsStr, protocolStatus }) => {
    const hasActiveProtocol = isAssignedProtocolName(resolvedProtocolName || protocolStatus);
    const defaultRoute = buildDefaultRetrievalRoute({ userText, hasActiveProtocol });

    const routerPrompt = `
Return JSON only.

You are deciding which clinical documents must be retrieved before answering the latest user message.

Document purposes:
- CTCAE: Use for adverse event terminology, symptom/lab toxicity grading, severity/risk classification, CTCAE grade evidence, and standardized toxicity definitions.
- Protocol: Use for study-specific rules, assigned protocol requirements, visit schedule, eligibility, dose modification, treatment hold/restart rules, prohibited medications, protocol-specific self-management, reporting requirements, emergency/contact instructions, and whether a symptom/action is covered by the active protocol.
- Both: Use when the user reports a symptom, side effect, abnormal lab/vital, treatment reaction, medication issue, or safety concern that may need CTCAE severity grading AND protocol-specific management/escalation.
- Neither: Use only for greetings, simple app navigation, non-clinical logistics, or questions answerable from current conversation/context without document evidence.

Decision rules:
1. If the user asks "how severe", "what grade", "risk", "CTCAE", or reports a symptom/lab/vital needing severity assessment, retrieve CTCAE.
2. If the user asks "what should I do under my study/protocol", "is this allowed", "do I continue/hold medication", "when is my visit", "who should be alerted", or asks protocol-specific workflow, retrieve protocol.
3. If a patient reports a possible side effect or abnormal lab/vital and an active protocol exists, retrieve both CTCAE and protocol unless the message is clearly non-clinical.
4. If no active protocol is assigned, do not retrieve protocol; set protocol reason to "No active protocol assigned".
5. If the latest message gives incomplete clinical information, still retrieve the relevant document type, but tell the answer model not to over-confirm grade/risk without missing details.
6. If you cannot clearly decide whether CTCAE or protocol is needed, retrieve both CTCAE and protocol.
7. Prefer broader retrieval when uncertainty affects patient safety.

Current active protocol:
${hasActiveProtocol ? resolvedProtocolName || protocolStatus : 'Not assigned'}

Recent vitals:
${vitalsStr}

Recent conversation:
${transcript || 'No previous conversation.'}

Latest user message:
${userText}

Schema:
{
  "retrieve_ctcae": boolean,
  "retrieve_protocol": boolean,
  "ctcae_query": string,
  "protocol_query": string,
  "reason": string
}
`.trim();

    try {
      const result = await requestSideEffectGuidance({
        userMessage: routerPrompt,
        responseFormat: 'json',
        temperature: 0.1,
        topP: 0.1,
      });
      const parsed = safeJsonParse(result?.text || '');
      const hasRequiredFields =
        parsed &&
        isBoolean(parsed.retrieve_ctcae) &&
        isBoolean(parsed.retrieve_protocol) &&
        typeof parsed.ctcae_query === 'string' &&
        typeof parsed.protocol_query === 'string';
      const reason = String(parsed?.reason || '').trim();
      const saysUnclear = /unclear|cannot clearly|can't clearly|uncertain|not sure/i.test(reason);

      if (!hasRequiredFields || saysUnclear) {
        return defaultRoute;
      }

      let retrieveCtcae = parsed.retrieve_ctcae;
      let retrieveProtocol = parsed.retrieve_protocol && hasActiveProtocol;

      if (!retrieveCtcae && !retrieveProtocol && !isClearlyNonClinicalMessage(userText)) {
        return defaultRoute;
      }

      return {
        retrieveCtcae,
        retrieveProtocol,
        ctcaeQuery: retrieveCtcae ? String(parsed.ctcae_query || userText).trim() || userText : '',
        protocolQuery: retrieveProtocol ? String(parsed.protocol_query || userText).trim() || userText : '',
        reason: retrieveProtocol === parsed.retrieve_protocol
          ? reason
          : `${reason || 'Retrieval routed by model.'} No active protocol assigned, so protocol retrieval was skipped.`,
      };
    } catch (error) {
      console.error('Guidance retrieval router failed:', error);
      return defaultRoute;
    }
  };

  const formatGuidanceChunks = (chunks, sourceLabel) => {
    if (!chunks?.length) return '';

    return chunks
      .map((entry) => {
        const page = entry.page || entry.metadata?.page || 'Unknown';
        const title = entry.title || entry.metadata?.title || entry.protocol_name || entry.metadata?.protocol_name || '';
        const labelParts = [`${sourceLabel} Page ${page}`];
        if (title) labelParts.push(title);
        return `[${labelParts.join(' - ')}]\n${entry.content}`;
      })
      .join('\n\n');
  };

  const retrieveGuidanceEvidence = async (route) => {
    const emptyEvidence = { ctcaeContext: '', protocolContext: '' };
    if (!route?.retrieveCtcae && !route?.retrieveProtocol) return emptyEvidence;

    try {
      const [ctcaeResponse, protocolResponse] = await Promise.all([
        route.retrieveCtcae
          ? retrieveGuidanceContext({
              queryText: route.ctcaeQuery || route.protocolQuery || '',
              ctcaeMatchCount: DEFAULT_RETRIEVAL_MATCH_COUNT,
              protocolMatchCount: 0,
            }).catch((error) => {
              console.error('CTCAE retrieval failed:', error);
              return { ctcaeChunks: [] };
            })
          : Promise.resolve({ ctcaeChunks: [] }),
        route.retrieveProtocol
          ? retrieveGuidanceContext({
              queryText: route.protocolQuery || route.ctcaeQuery || '',
              protocolId: activeProtocolId,
              protocolName: resolvedProtocolName,
              ctcaeMatchCount: 0,
              protocolMatchCount: DEFAULT_RETRIEVAL_MATCH_COUNT,
            }).catch((error) => {
              console.error('Protocol retrieval failed:', error);
              return { protocolChunks: [] };
            })
          : Promise.resolve({ protocolChunks: [] }),
      ]);

      return {
        ctcaeContext: formatGuidanceChunks(ctcaeResponse?.ctcaeChunks || [], 'CTCAE'),
        protocolContext: formatGuidanceChunks(protocolResponse?.protocolChunks || [], 'Protocol'),
      };
    } catch (error) {
      console.error('Guidance retrieval failed:', error);
      return emptyEvidence;
    }
  };

  const generateAssistantText = async ({
    userText,
    transcript,
    vitalsStr,
    appointmentsStr,
    protocolStatus,
    ctcaeContext,
    protocolContext,
    retrievalRoute,
  }) => {
    const instructions = `
You are ${currentAiName}.
Role: ${role === 'crc' ? 'Clinical Research Coordinator assistant' : 'Patient symptom guidance assistant'}.

Current patient context:
- Active protocol: ${resolvedProtocolName || 'Not assigned'}
- Protocol status: ${protocolStatus}
- Retrieval decision: ${retrievalRoute?.reason || 'No retrieval decision recorded.'}

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
- If the patient gives an imprecise lab value or range, do not present a precise CTCAE grade or LOW risk as confirmed. Ask for the exact value, units, symptoms, and whether the value is improving.
- Cite CTCAE/protocol page numbers only when the page number is present in the retrieved excerpts below. If no reliable page is present, say the page could not be confirmed instead of inventing one.
- For severe symptoms, tell the patient to call the study emergency number or local emergency services immediately.
- If the symptom appears covered by the active protocol, explain the likely protocol-aligned self-management or next step cautiously.
- If the symptom does not appear covered by the active protocol, or no protocol excerpts were retrieved, say CRC will be alerted directly when protocol-specific coverage cannot be confirmed.

Conversation transcript:
${transcript || 'No previous conversation.'}

Latest user message:
${userText}

Relevant CTCAE excerpts:
${ctcaeContext || 'None'}

Relevant protocol excerpts:
${protocolContext || 'None'}
`.trim();

    const result = await requestSideEffectGuidance({
      userMessage: instructions,
    });

    return result?.text || '';
  };

  const extractSideEffectEvent = async ({
    userText,
    transcript,
    vitalsStr,
    protocolStatus,
    ctcaeContext,
    protocolContext,
    retrievalRoute,
  }) => {
    if (role !== 'patient') return null;

    const extractorPrompt = `
Return JSON only.

You are extracting structured patient side effect information from the latest chat message.
Use the latest message plus recent conversation and active protocol evidence if provided.
If the message is logistics, a greeting, or not a health symptom update, set "contains_side_effect_report" to false.

Rules:
- If the symptom appears clearly covered by the active protocol, set "protocol_covered" to true.
- If the symptom appears not covered by the active protocol, set "protocol_covered" to false and "should_alert_crc" to true.
- If protocol coverage cannot be determined safely, set "protocol_covered" to null and "should_alert_crc" to true.
- Determine protocol_covered only from the Relevant protocol excerpts. If there are no relevant protocol excerpts, set protocol_covered to null.
- If the symptom is severe, dangerous, or needs urgent escalation, set severity to "serious", "immediate_help_requested" to true, and "should_alert_crc" to true.
- If the latest message gives only an imprecise lab threshold or range without exact value, symptoms, or current status, do not mark severity as "mild" solely from that incomplete threshold. Use clinical judgment from the available context and set "should_alert_crc" to true when protocol coverage or severity cannot be determined safely.
- Use the recent vitals as additional severity evidence.

Current protocol name: ${resolvedProtocolName || 'Not assigned'}
Protocol status: ${protocolStatus}
Retrieval decision: ${retrievalRoute?.reason || 'No retrieval decision recorded.'}

Recent vitals:
${vitalsStr}

Recent conversation:
${transcript || 'No previous conversation.'}

Latest user message:
${userText}

Relevant CTCAE excerpts:
${ctcaeContext || 'None'}

Relevant protocol excerpts:
${protocolContext || 'None'}

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

    const result = await requestSideEffectGuidance({
      userMessage: extractorPrompt,
      responseFormat: 'json',
      temperature: 0.1,
      topP: 0.1,
    });

    return safeJsonParse(result?.text || '');
  };

  const openPhoneLink = async (phoneNumber, label) => {
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

  const copyEmergencyNumber = async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(callTargets.emergencyPhone);
      Alert.alert('Copied', 'Emergency number copied to clipboard.');
      return;
    }

    Alert.alert('Clipboard unavailable', 'Copy the number manually from the screen.');
  };

  const handleEmergencyCall = async () => {
    if (Platform.OS === 'web') {
      setShowEmergencySheet(true);
      return;
    }
    await openPhoneLink(callTargets.emergencyPhone, 'Emergency services');
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
        ? '**Audit note:** I documented this symptom and alerted CRC automatically. Use direct phone escalation immediately if symptoms are severe or worsening.'
        : '**Audit note:** I documented this symptom in the audit trail and matched it to the active protocol guidance.';

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
      const retrievalRoute = await routeGuidanceRetrieval({ userText, transcript, vitalsStr, protocolStatus });
      const { ctcaeContext, protocolContext } = await retrieveGuidanceEvidence(retrievalRoute);

      const [assistantText, extracted] = await Promise.all([
        generateAssistantText({
          userText,
          transcript,
          vitalsStr,
          appointmentsStr,
          protocolStatus,
          ctcaeContext,
          protocolContext,
          retrievalRoute,
        }),
        extractSideEffectEvent({
          userText,
          transcript,
          vitalsStr,
          protocolStatus,
          ctcaeContext,
          protocolContext,
          retrievalRoute,
        }),
      ]);

      if (assistantText) {
        await saveMessage('model', assistantText);
      }

      const triageResult = await handleStructuredSideEffect(userText, extracted);
      const emergencyMatch = assistantText?.match(/\*\*\*EMERGENCY: (.*?)\*\*\*/);
      const shouldFallbackToLiveChat = role === 'patient' && emergencyMatch && !triageResult?.crcAlerted;

      if (shouldFallbackToLiveChat && onEmergencyTrigger) {
        onEmergencyTrigger(emergencyMatch[1].trim());
      }
    } catch (error) {
      console.error('AI Error:', error);
      if (role === 'patient') {
        const fallback = buildFallbackSideEffectAssessment({
          userText,
          patientData,
          activeProtocolName: resolvedProtocolName,
        });

        await saveMessage('model', fallback.assistantText);
        const triageResult = await handleStructuredSideEffect(userText, fallback.extracted);
        if (fallback.extracted.immediate_help_requested && onEmergencyTrigger && !triageResult?.crcAlerted) {
          onEmergencyTrigger(fallback.extracted.triage_summary);
        }
      } else {
        await saveMessage(
          'model',
          `AI Error. ${error.message || 'I could not process that message just now. Please retry.'}`
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCrcCall = async (isVideo) => {
    if (!callTargets.crcUserId) {
      Alert.alert('CRC not configured', 'Primary CRC must be assigned before in-app calling can start.');
      return;
    }

    try {
      await startCall(callTargets.crcUserId, callTargets.crcLabel, isVideo);
    } catch (error) {
      console.error('Call start failed:', error);
      Alert.alert('Call failed', error.message || 'Unable to start the in-app call.');
    }
  };

  const renderMessage = (item, index) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';

    return (
      <View
        key={item.id || `${item.role}-${index}`}
        style={[styles.msgRow, isUser ? styles.userRow : isSystem ? styles.systemRow : styles.modelRow]}
      >
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
                <TouchableOpacity style={styles.callButton} onPress={() => handleCrcCall(false)}>
                  <Text style={styles.callButtonText}>Call CRC</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.callButton} onPress={() => handleCrcCall(true)}>
                  <Text style={styles.callButtonText}>Video Call CRC</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.callButton, styles.callButtonDanger]}
                  onPress={handleEmergencyCall}
                >
                  <Text style={styles.callButtonText}>Emergency Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.chatBody}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.messagesScroll}
              contentContainerStyle={styles.messagesContent}
              keyboardShouldPersistTaps="handled"
            >
              {historyReady && messages.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>No audit chat history yet.</Text>
                </View>
              ) : null}
              {messages.map(renderMessage)}
            </ScrollView>
          </View>

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

        <Modal visible={showEmergencySheet} transparent animationType="fade">
          <View style={styles.sheetBackdrop}>
            <View style={styles.sheetCard}>
              <Text style={styles.sheetTitle}>Emergency Call</Text>
              <Text style={styles.sheetText}>
                Use this trial or site emergency number for urgent phone escalation.
              </Text>
              <Text style={styles.sheetNumber}>{callTargets.emergencyPhone}</Text>
              <View style={styles.sheetActions}>
                <TouchableOpacity style={styles.sheetButtonSecondary} onPress={copyEmergencyNumber}>
                  <Text style={styles.sheetButtonSecondaryText}>Copy number</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetButtonPrimary}
                  onPress={() => openPhoneLink(callTargets.emergencyPhone, 'Emergency services')}
                >
                  <Text style={styles.sheetButtonPrimaryText}>Open dialer</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setShowEmergencySheet(false)}>
                <Text style={styles.sheetClose}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
    display: 'flex',
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
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  callButton: {
    flexGrow: 1,
    minWidth: 120,
    backgroundColor: '#0f609b',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  callButtonDanger: {
    backgroundColor: '#b42318',
  },
  callButtonText: { color: 'white', fontWeight: '700', fontSize: 13 },
  chatBody: {
    flex: 1,
    minHeight: 0,
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    padding: 12,
    paddingBottom: 20,
    flexGrow: 1,
  },
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(12,31,48,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheetCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#14324a',
    marginBottom: 8,
  },
  sheetText: {
    color: '#52606d',
    lineHeight: 20,
    marginBottom: 12,
  },
  sheetNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: '#b42318',
    marginBottom: 16,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  sheetButtonPrimary: {
    flex: 1,
    backgroundColor: '#0f609b',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  sheetButtonPrimaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  sheetButtonSecondary: {
    flex: 1,
    backgroundColor: '#eef3f8',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  sheetButtonSecondaryText: {
    color: '#14324a',
    fontWeight: '700',
  },
  sheetClose: {
    color: '#0f609b',
    fontWeight: '700',
    textAlign: 'center',
  },
});

const markdownStyles = {
  body: { fontSize: 14, color: '#243b53', lineHeight: 20 },
  strong: { fontWeight: '700' },
  paragraph: { marginTop: 0, marginBottom: 0 },
};

export default GeminiChatbot;
