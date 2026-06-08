import {
  buildGuidancePromptNoRetrieval,
  buildGuidancePromptWithRetrieval,
} from './guidancePromptCore.js';

export const DEFAULT_ROUTE_MATCH_COUNT = 5;
export const DEFAULT_PROTOCOL_ROUTE_MATCH_COUNT = 8;
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const CACHE_MAX_TURN_DISTANCE = 3;
export const MIN_ROUTER_CONFIDENCE = 0.65;

const GREETING_PATTERNS = [
  'hi',
  'hello',
  'hey',
  '你好',
  '您好',
  '嗨',
  '早上好',
  '下午好',
  '晚上好',
];

const THANKS_PATTERNS = [
  'thanks',
  'thank you',
  'thx',
  '谢谢',
  '謝謝',
  '多谢',
  '辛苦了',
];

const CLOSING_PATTERNS = [
  'bye',
  'goodbye',
  '再见',
  '拜拜',
  '先这样',
  '没事了',
  'ok',
  'okay',
  '好的',
  '收到',
  '明白了',
];

const SELF_HELP_PATTERNS = [
  '你是谁',
  '你能做什么',
  '你可以做什么',
  '怎么用你',
  '如何使用你',
  'help',
  'what can you do',
  'who are you',
  'who are u',
  'who r u',
  'what are you',
  'how can you help',
  'introduce yourself',
];

const CONTEXT_IDENTITY_PATTERNS = [
  'who am i',
  'who is this patient',
  'which patient is this',
  'what patient is this',
  'what patient am i viewing',
  'what patient am i looking at',
  '我是谁',
  '当前患者是谁',
  '现在这个患者是谁',
  '这个患者是谁',
  '当前病人是谁',
  '现在这个病人是谁',
  '我现在看的是谁',
  '我现在看的患者是谁',
];

const UI_WORKFLOW_PATTERNS = [
  '按钮',
  '页面',
  '界面',
  '弹窗',
  '刷新',
  '上传',
  '下载',
  '登录',
  '登出',
  '退出',
  '切换',
  'sidebar',
  'panel',
  'chat',
  'history',
  '保存',
  '删除',
  'protocol manager',
  'patient list',
  'workspace',
];

const REWRITE_PATTERNS = [
  '简短一点',
  '更短',
  '简洁一点',
  '翻译',
  'translate',
  '改写',
  'rewrite',
  '重写',
  'bullet',
  '要点',
  '列表',
  '表格',
  '英文',
  '中文',
  '换种说法',
  'summarize in',
];

const WORKSPACE_SUMMARY_PATTERNS = [
  '总结',
  '概括',
  '汇总',
  '列出',
  '哪些',
  '最近',
  'today',
  'recent',
  'summary',
  'summarize',
  'trend',
  'trends',
];

const WORKSPACE_DATA_PATTERNS = [
  'alert',
  'alerts',
  'incident',
  'incidents',
  'epro',
  'appointment',
  'appointments',
  'patient roster',
  'patient list',
  'follow-up',
  'follow up',
  '任务',
  '提醒',
  '警报',
  '事件',
  '预约',
  '患者',
];

const CTCAE_PATTERNS = ['ctcae'];

const PROTOCOL_PATTERNS = ['protocol', 'protocols', 'protocal', '方案', '试验方案', '研究方案'];

const CITATION_PATTERNS = [
  'page',
  'pages',
  'citation',
  'cite',
  'according to',
  '引用',
  '页码',
  '出处',
  '依据',
];

const GRADE_PATTERNS = [
  'grade',
  'grading',
  'severity',
  'risk',
  '分级',
  '级',
  '严重',
  '严重度',
  '风险',
];

const MEDICAL_PATTERNS = [
  'symptom',
  'symptoms',
  'vital',
  'vitals',
  'adverse event',
  'ae',
  'fever',
  'diarrhea',
  'nausea',
  'vomit',
  'vomiting',
  'pain',
  'chest pain',
  'cough',
  'rash',
  'bleeding',
  'dyspnea',
  'infection',
  'escalation',
  'emergency',
  'self care',
  '症状',
  '体征',
  'vitals',
  '不良事件',
  '发热',
  '发烧',
  '腹泻',
  '恶心',
  '呕吐',
  '胸痛',
  '疼',
  '疼痛',
  '咳嗽',
  '呼吸',
  '气促',
  '皮疹',
  '出血',
  '感染',
  '处置',
  '建议',
  '急诊',
  '紧急',
  '生命体征',
  '血压',
  '体温',
  '心率',
  '氧饱和',
];

const PROTOCOL_TOPIC_PATTERNS = [
  'imaging',
  'endpoint',
  'endpoints',
  'eligibility',
  'inclusion',
  'exclusion',
  'schedule',
  'visit',
  'visits',
  'biomarker',
  'biomarkers',
  'response',
  'recist',
  'randomization',
  'screening',
  'follow-up',
  'follow up',
  '影像',
  '终点',
  '入选',
  '排除',
  '访视',
  '筛选',
  '随访',
];

const CURRENT_CONTEXT_PATTERNS = [
  'current',
  'active',
  'workspace',
  'patient',
  'alert',
  'alerts',
  'incident',
  'incidents',
  'symptom',
  'symptoms',
  'side effect',
  'side effects',
  '当前',
  '现在',
  '患者',
  '病人',
  '警报',
  '提醒',
  '事件',
  '症状',
  '副作用',
];

const RETRIEVAL_SYMPTOM_TERMS = [
  {
    patterns: ['diarrhea', 'diarrhoea', 'colitis', '腹泻'],
    terms: ['diarrhea', 'diarrhoea', 'colitis'],
  },
  {
    patterns: ['nausea', 'vomit', 'vomiting', '恶心', '呕吐'],
    terms: ['nausea', 'vomiting'],
  },
  {
    patterns: ['dizziness', 'dizzy', '头晕'],
    terms: ['dizziness'],
  },
  {
    patterns: ['fever', 'pyrexia', '发热', '发烧'],
    terms: ['fever', 'pyrexia'],
  },
  {
    patterns: ['rash', '皮疹'],
    terms: ['rash'],
  },
  {
    patterns: ['dyspnea', 'shortness of breath', 'breath', '呼吸', '气促'],
    terms: ['dyspnea', 'shortness of breath'],
  },
  {
    patterns: ['cough', '咳嗽'],
    terms: ['cough'],
  },
  {
    patterns: ['bleeding', 'hemorrhage', '出血'],
    terms: ['bleeding', 'hemorrhage'],
  },
  {
    patterns: ['pain', '疼', '疼痛'],
    terms: ['pain'],
  },
];

const PROTOCOL_AE_MANAGEMENT_QUERY_TERMS = [
  'T-DXd',
  'dose modification',
  'dose interruption',
  'dose reduction',
  'discontinuation',
  'toxicity management',
  'adverse event management',
  'TEAE',
  'Table 6.3',
  'CTCAE',
];

const CTCAE_QUERY_TERMS = [
  'CTCAE',
  'adverse event',
  'grade',
  'severity',
  'criteria',
];

const FOLLOW_UP_PATTERNS = [
  'why',
  'why?',
  'because',
  'explain',
  'more detail',
  'elaborate',
  'continue',
  '继续',
  '展开',
  '详细说',
  '为什么',
  '原因',
  '只说',
  '重点讲',
  'focus on',
  'summarize in 3',
  '总结成3',
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function toLower(value = '') {
  return normalizeText(value).toLowerCase();
}

function includesAny(text, patterns = []) {
  return patterns.some((pattern) => text.includes(pattern));
}

function normalizeScopeValue(value = '') {
  return normalizeText(value).toLowerCase();
}

function hasMeasurementSignal(text = '') {
  return /(\d+(?:\.\d+)?)\s*(?:°c|℃|mmhg|bpm|%|kg|cm|f)\b/i.test(text) || /spo2/i.test(text);
}

function collectRetrievalSymptomTerms(text = '') {
  const lowerText = toLower(text);
  const terms = [];

  RETRIEVAL_SYMPTOM_TERMS.forEach((entry) => {
    if (includesAny(lowerText, entry.patterns)) {
      terms.push(...entry.terms);
    }
  });

  return [...new Set(terms)];
}

function compactRetrievalQuery(parts = [], maxLength = 1400) {
  const query = parts
    .flat()
    .filter(Boolean)
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join('\n');

  if (query.length <= maxLength) {
    return query;
  }

  return query.slice(0, maxLength).trim();
}

function isGenericProtocolQuery(text = '') {
  const lowerText = toLower(text);
  if (!includesAny(lowerText, PROTOCOL_PATTERNS)) {
    return false;
  }

  const hasSpecificTopic =
    includesAny(lowerText, PROTOCOL_TOPIC_PATTERNS) ||
    includesAny(lowerText, MEDICAL_PATTERNS) ||
    includesAny(lowerText, GRADE_PATTERNS) ||
    includesAny(lowerText, CITATION_PATTERNS) ||
    hasMeasurementSignal(text);

  return !hasSpecificTopic;
}

export function buildGuidanceRetrievalQuery({
  userText,
  workspaceContext = '',
  patientContext = '',
  needsCtcae = false,
  needsProtocol = false,
} = {}) {
  const normalizedUserText = normalizeText(userText);
  const lowerUserText = toLower(normalizedUserText);
  const userSymptomTerms = collectRetrievalSymptomTerms(normalizedUserText);
  const shouldUseContextSymptoms =
    needsProtocol &&
    (isGenericProtocolQuery(normalizedUserText) ||
      includesAny(lowerUserText, CURRENT_CONTEXT_PATTERNS) ||
      userSymptomTerms.length > 0);
  const contextSymptomTerms = shouldUseContextSymptoms
    ? collectRetrievalSymptomTerms(`${patientContext}\n${workspaceContext}`)
    : [];
  const symptomTerms = [...new Set([...userSymptomTerms, ...contextSymptomTerms])];
  const parts = [normalizedUserText];

  if (needsCtcae) {
    parts.push(CTCAE_QUERY_TERMS.join(' '));
  }

  if (needsProtocol && symptomTerms.length) {
    parts.push(PROTOCOL_AE_MANAGEMENT_QUERY_TERMS.join(' '));
    parts.push(`current symptom alert terms: ${symptomTerms.join(' ')}`);
  }

  return compactRetrievalQuery(parts);
}

function isShortMessage(text = '', maxLength = 60) {
  return normalizeText(text).length > 0 && normalizeText(text).length <= maxLength;
}

export function extractConversationAnchors(historyMessages = []) {
  const filtered = Array.isArray(historyMessages)
    ? historyMessages.filter((message) => message?.role === 'user' || message?.role === 'model')
    : [];

  const reversed = [...filtered].reverse();
  const previousUserMessage = reversed.find((message) => message.role === 'user')?.text || '';
  const previousModelMessage = reversed.find((message) => message.role === 'model')?.text || '';

  return {
    previousUserMessage: normalizeText(previousUserMessage),
    previousModelMessage: normalizeText(previousModelMessage),
  };
}

export function detectRequestedSources(text = '', hasProtocolScope = false) {
  const lowerText = toLower(text);
  const mentionsCtcae = includesAny(lowerText, CTCAE_PATTERNS);
  const mentionsProtocol = includesAny(lowerText, PROTOCOL_PATTERNS);
  const mentionsCitation = includesAny(lowerText, CITATION_PATTERNS);
  const mentionsGrading = includesAny(lowerText, GRADE_PATTERNS);
  const mentionsMedical = includesAny(lowerText, MEDICAL_PATTERNS) || hasMeasurementSignal(text);

  let needsCtcae = mentionsCtcae;
  let needsProtocol = mentionsProtocol;

  if (mentionsMedical || mentionsGrading) {
    needsCtcae = true;
  }

  if (mentionsProtocol && (mentionsMedical || mentionsGrading || mentionsCitation)) {
    needsCtcae = true;
  }

  if ((mentionsMedical || mentionsGrading) && hasProtocolScope) {
    needsProtocol = true;
  }

  if (mentionsCitation && !needsCtcae && !needsProtocol) {
    needsCtcae = true;
    needsProtocol = hasProtocolScope;
  }

  if (!needsCtcae && !needsProtocol) {
    needsCtcae = true;
    needsProtocol = hasProtocolScope;
  }

  return {
    needsCtcae,
    needsProtocol,
  };
}

export function classifyHardSkip(userText, { previousModelMessage = '' } = {}) {
  const normalized = normalizeText(userText);
  const lowerText = toLower(userText);
  const hasMedicalSignals =
    includesAny(lowerText, MEDICAL_PATTERNS) ||
    includesAny(lowerText, GRADE_PATTERNS) ||
    includesAny(lowerText, CITATION_PATTERNS) ||
    hasMeasurementSignal(normalized);

  if (
    isShortMessage(normalized, 40) &&
    !hasMedicalSignals &&
    (includesAny(lowerText, GREETING_PATTERNS) ||
      includesAny(lowerText, THANKS_PATTERNS) ||
      includesAny(lowerText, CLOSING_PATTERNS))
  ) {
    return 'greeting';
  }

  if (includesAny(lowerText, SELF_HELP_PATTERNS) && !hasMedicalSignals) {
    return 'assistant_help';
  }

  if (includesAny(lowerText, CONTEXT_IDENTITY_PATTERNS) && !hasMedicalSignals) {
    return 'workspace_summary';
  }

  if (previousModelMessage && isShortMessage(normalized, 80) && includesAny(lowerText, REWRITE_PATTERNS)) {
    return 'rewrite';
  }

  if (
    includesAny(lowerText, UI_WORKFLOW_PATTERNS) &&
    !hasMedicalSignals &&
    !includesAny(lowerText, WORKSPACE_SUMMARY_PATTERNS)
  ) {
    return 'ui_help';
  }

  if (
    includesAny(lowerText, WORKSPACE_SUMMARY_PATTERNS) &&
    includesAny(lowerText, WORKSPACE_DATA_PATTERNS) &&
    !hasMedicalSignals
  ) {
    return 'workspace_summary';
  }

  return null;
}

export function classifyHardRetrieve(userText, { hasProtocolScope = false } = {}) {
  const normalized = normalizeText(userText);
  const lowerText = toLower(userText);
  const mentionsGrounding =
    includesAny(lowerText, CTCAE_PATTERNS) ||
    includesAny(lowerText, PROTOCOL_PATTERNS) ||
    includesAny(lowerText, CITATION_PATTERNS);
  const mentionsMedical =
    includesAny(lowerText, MEDICAL_PATTERNS) ||
    includesAny(lowerText, GRADE_PATTERNS) ||
    hasMeasurementSignal(normalized);

  if (mentionsGrounding) {
    return {
      reason: 'protocol_rule',
      ...detectRequestedSources(normalized, hasProtocolScope),
    };
  }

  if (mentionsMedical) {
    return {
      reason: 'medical_assessment',
      ...detectRequestedSources(normalized, hasProtocolScope),
    };
  }

  return null;
}

function isReusableFollowUp(userText = '') {
  const normalized = normalizeText(userText);
  const lowerText = normalized.toLowerCase();

  return (
    isShortMessage(normalized, 80) &&
    (includesAny(lowerText, FOLLOW_UP_PATTERNS) || includesAny(lowerText, REWRITE_PATTERNS))
  );
}

export function canReuseRetrievalCache({
  userText,
  retrievalCache,
  patientId,
  protocolId,
  protocolName,
  currentTurnIndex = 0,
  lastRetrievalTurnIndex = 0,
  requiredSources = null,
}) {
  if (!retrievalCache) return false;

  const cacheCreatedAt = Number(retrievalCache.createdAt) || 0;
  const hasCtcaeSources = Array.isArray(retrievalCache.ctcaeChunks) && retrievalCache.ctcaeChunks.length > 0;
  const hasProtocolSources =
    Array.isArray(retrievalCache.protocolChunks) && retrievalCache.protocolChunks.length > 0;
  const hasCachedSources = hasCtcaeSources || hasProtocolSources;

  if (!cacheCreatedAt || !hasCachedSources) return false;
  if (Date.now() - cacheCreatedAt > CACHE_MAX_AGE_MS) return false;
  if (!currentTurnIndex || !lastRetrievalTurnIndex) return false;
  if (currentTurnIndex - lastRetrievalTurnIndex > CACHE_MAX_TURN_DISTANCE) return false;
  if (!isReusableFollowUp(userText)) return false;
  if (hasMeasurementSignal(userText)) return false;
  if (requiredSources?.needsCtcae && !hasCtcaeSources) return false;
  if (requiredSources?.needsProtocol && !hasProtocolSources) return false;

  const samePatient = normalizeScopeValue(retrievalCache.patientId) === normalizeScopeValue(patientId);
  const sameProtocolId = normalizeScopeValue(retrievalCache.protocolId) === normalizeScopeValue(protocolId);
  const sameProtocolName =
    normalizeScopeValue(retrievalCache.protocolName) === normalizeScopeValue(protocolName);

  return samePatient && sameProtocolId && sameProtocolName;
}

function selectCachedChunks(retrievalCache, { needsCtcae, needsProtocol }) {
  return {
    ctcaeChunks: needsCtcae ? retrievalCache?.ctcaeChunks || [] : [],
    protocolChunks: needsProtocol ? retrievalCache?.protocolChunks || [] : [],
  };
}

export function buildSourceMask({ ctcaeChunks = [], protocolChunks = [] }) {
  if (ctcaeChunks.length && protocolChunks.length) return 'ctcae+protocol';
  if (ctcaeChunks.length) return 'ctcae';
  if (protocolChunks.length) return 'protocol';
  return 'none';
}

export function trimForRouting(text = '', maxLength = 1200) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

export function buildDefaultClassifierFallback(hasProtocolScope = false) {
  return {
    decision: 'retrieve',
    needs_ctcae: true,
    needs_protocol: Boolean(hasProtocolScope),
    reason_code: 'ambiguous',
    confidence: 0,
  };
}

export function normalizeClassifierDecision(data, hasProtocolScope = false) {
  const fallback = buildDefaultClassifierFallback(hasProtocolScope);
  const decision = String(data?.decision || '').trim();
  const reasonCode = String(data?.reason_code || '').trim() || fallback.reason_code;
  const confidence = Number(data?.confidence);
  const normalized = {
    decision,
    needs_ctcae: Boolean(data?.needs_ctcae),
    needs_protocol: Boolean(data?.needs_protocol),
    reason_code: reasonCode,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };

  const validDecision = ['skip', 'retrieve', 'reuse_cache'].includes(normalized.decision);
  const isConsistentSkip = normalized.decision !== 'skip' || (!normalized.needs_ctcae && !normalized.needs_protocol);

  if (!validDecision || !isConsistentSkip || normalized.confidence < MIN_ROUTER_CONFIDENCE) {
    return fallback;
  }

  return normalized;
}

function buildNoRetrievalResult({
  workspaceContext,
  patientContext,
  userText,
  routeReason,
  retrievalCache,
  routingStage = 'hard_skip',
  classifierInvoked = false,
}) {
  return {
    prompt: buildGuidancePromptNoRetrieval({
      workspaceContext,
      patientContext,
      userText,
      routeReason,
    }),
    routeDecision: 'skip',
    routeReason,
    usedCache: false,
    ctcaeChunks: [],
    protocolChunks: [],
    ctcaeCount: 0,
    protocolCount: 0,
    sourceMask: 'none',
    nextRetrievalCache: retrievalCache || null,
    routingStage,
    classifierInvoked,
  };
}

export async function executeGuidanceRouting({
  userText,
  workspaceContext,
  patientContext,
  patientId = null,
  protocolId = null,
  protocolName = null,
  hasPatientContext = false,
  historyMessages = [],
  retrievalCache = null,
  currentTurnIndex = 0,
  lastRetrievalTurnIndex = 0,
  disableHardRouting = false,
  onStageChange = null,
  classifyRoute,
  fetchGuidanceChunks,
}) {
  const normalizedUserText = normalizeText(userText);
  const hasProtocolScope = Boolean(normalizeText(protocolId) || normalizeText(protocolName));
  const { previousModelMessage } = extractConversationAnchors(historyMessages);

  if (!disableHardRouting) {
    const hardSkipReason = classifyHardSkip(normalizedUserText, { previousModelMessage });
    if (hardSkipReason) {
      return buildNoRetrievalResult({
        workspaceContext,
        patientContext,
        userText: normalizedUserText,
        routeReason: hardSkipReason,
        retrievalCache,
        routingStage: 'hard_skip',
        classifierInvoked: false,
      });
    }
  }

  if (!disableHardRouting) {
    const hardRetrieveDecision = classifyHardRetrieve(normalizedUserText, { hasProtocolScope });
    if (hardRetrieveDecision) {
      if (typeof onStageChange === 'function') {
        onStageChange(
          hardRetrieveDecision.needsProtocol && hasProtocolScope ? 'retrieval-scoped' : 'retrieval-global'
        );
      }

      const { ctcaeChunks, protocolChunks } = await fetchGuidanceChunks({
        userText: normalizedUserText,
        workspaceContext,
        patientContext,
        protocolId,
        protocolName,
        needsCtcae: hardRetrieveDecision.needsCtcae,
        needsProtocol: hardRetrieveDecision.needsProtocol,
      });

      return {
        prompt: buildGuidancePromptWithRetrieval({
          workspaceContext,
          patientContext,
          ctcaeChunks,
          protocolChunks,
          userText: normalizedUserText,
        }),
        routeDecision: 'retrieve',
        routeReason: hardRetrieveDecision.reason,
        usedCache: false,
        ctcaeChunks,
        protocolChunks,
        ctcaeCount: ctcaeChunks.length,
        protocolCount: protocolChunks.length,
        sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
        nextRetrievalCache: {
          createdAt: Date.now(),
          patientId,
          protocolId,
          protocolName,
          ctcaeChunks,
          protocolChunks,
          sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
          queryText: normalizedUserText,
        },
        routingStage: 'hard_retrieve',
        classifierInvoked: false,
      };
    }
  }

  const requestedSources = detectRequestedSources(normalizedUserText, hasProtocolScope);
  if (!disableHardRouting) {
    if (
      canReuseRetrievalCache({
        userText: normalizedUserText,
        retrievalCache,
        patientId,
        protocolId,
        protocolName,
        currentTurnIndex,
        lastRetrievalTurnIndex,
        requiredSources: requestedSources,
      })
    ) {
      if (typeof onStageChange === 'function') {
        onStageChange('retrieval-cache');
      }

      const { ctcaeChunks, protocolChunks } = selectCachedChunks(retrievalCache, requestedSources);

      return {
        prompt: buildGuidancePromptWithRetrieval({
          workspaceContext,
          patientContext,
          ctcaeChunks,
          protocolChunks,
          userText: normalizedUserText,
        }),
        routeDecision: 'reuse_cache',
        routeReason: 'follow_up',
        usedCache: true,
        ctcaeChunks,
        protocolChunks,
        ctcaeCount: ctcaeChunks.length,
        protocolCount: protocolChunks.length,
        sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
        nextRetrievalCache: retrievalCache,
        routingStage: 'cache_reuse',
        classifierInvoked: false,
      };
    }
  }

  let classifierDecision = buildDefaultClassifierFallback(hasProtocolScope);
  let classifierInvoked = false;
  if (typeof classifyRoute === 'function') {
    try {
      classifierInvoked = true;
      classifierDecision = await classifyRoute({
        userText: normalizedUserText,
        historyMessages,
        hasPatientContext,
        hasProtocolScope,
        previousTurnUsedRetrieval:
          Boolean(lastRetrievalTurnIndex) && currentTurnIndex - lastRetrievalTurnIndex === 1,
        cachedSourcesAvailable:
          Boolean(retrievalCache?.ctcaeChunks?.length) || Boolean(retrievalCache?.protocolChunks?.length),
      });
    } catch {
      classifierDecision = buildDefaultClassifierFallback(hasProtocolScope);
    }
  }

  if (classifierDecision.decision === 'skip') {
    return buildNoRetrievalResult({
      workspaceContext,
      patientContext,
      userText: normalizedUserText,
      routeReason: classifierDecision.reason_code,
      retrievalCache,
      routingStage: 'classifier_skip',
      classifierInvoked,
    });
  }

  if (
    classifierDecision.decision === 'reuse_cache' &&
    canReuseRetrievalCache({
      userText: normalizedUserText,
      retrievalCache,
      patientId,
      protocolId,
      protocolName,
      currentTurnIndex,
      lastRetrievalTurnIndex,
      requiredSources: {
        needsCtcae: classifierDecision.needs_ctcae,
        needsProtocol: classifierDecision.needs_protocol,
      },
    })
  ) {
    if (typeof onStageChange === 'function') {
      onStageChange('retrieval-cache');
    }

    const { ctcaeChunks, protocolChunks } = selectCachedChunks(retrievalCache, {
      needsCtcae: classifierDecision.needs_ctcae,
      needsProtocol: classifierDecision.needs_protocol,
    });

    return {
      prompt: buildGuidancePromptWithRetrieval({
        workspaceContext,
        patientContext,
        ctcaeChunks,
        protocolChunks,
        userText: normalizedUserText,
      }),
      routeDecision: 'reuse_cache',
      routeReason: classifierDecision.reason_code,
      usedCache: true,
      ctcaeChunks,
      protocolChunks,
      ctcaeCount: ctcaeChunks.length,
      protocolCount: protocolChunks.length,
      sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
      nextRetrievalCache: retrievalCache,
      routingStage: 'classifier_reuse_cache',
      classifierInvoked,
    };
  }

  if (typeof onStageChange === 'function') {
    onStageChange(
      classifierDecision.needs_protocol && hasProtocolScope ? 'retrieval-scoped' : 'retrieval-global'
    );
  }

  const { ctcaeChunks, protocolChunks } = await fetchGuidanceChunks({
    userText: normalizedUserText,
    workspaceContext,
    patientContext,
    protocolId,
    protocolName,
    needsCtcae: classifierDecision.needs_ctcae,
    needsProtocol: classifierDecision.needs_protocol,
  });

  return {
    prompt: buildGuidancePromptWithRetrieval({
      workspaceContext,
      patientContext,
      ctcaeChunks,
      protocolChunks,
      userText: normalizedUserText,
    }),
    routeDecision: 'retrieve',
    routeReason: classifierDecision.reason_code,
    usedCache: false,
    ctcaeChunks,
    protocolChunks,
    ctcaeCount: ctcaeChunks.length,
    protocolCount: protocolChunks.length,
    sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
    nextRetrievalCache: {
      createdAt: Date.now(),
      patientId,
      protocolId,
      protocolName,
      ctcaeChunks,
      protocolChunks,
      sourceMask: buildSourceMask({ ctcaeChunks, protocolChunks }),
      queryText: normalizedUserText,
    },
    routingStage: 'classifier_retrieve',
    classifierInvoked,
  };
}
