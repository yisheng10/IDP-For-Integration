import {
  buildGuidancePromptNoRetrieval,
  buildGuidancePromptWithRetrieval,
  retrieveGuidanceContext,
} from './guidanceRetrievalService';
import { callFunctionHttp } from './firebaseFunctionHttp';

const DEFAULT_MATCH_COUNT = 4;
const CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const CACHE_MAX_TURN_DISTANCE = 3;
const MIN_ROUTER_CONFIDENCE = 0.65;

const HARD_SKIP_PATTERNS = [
  /\b(hi|hello|hey|thanks|thank you|bye|goodbye|ok|okay)\b/i,
  /\b(translate|rewrite|rephrase|summari[sz]e|bullet|table)\b/i,
];

const MEDICAL_PATTERNS = [
  /\b(symptom|symptoms|vital|vitals|adverse event|ae|fever|diarrhea|nausea|vomit|vomiting|pain|chest pain|cough|rash|bleeding|dyspnea|infection|emergency|self care)\b/i,
  /\b(ctcae|grade|grading|severity|risk|protocol|trial)\b/i,
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function buildSourceMask({ ctcaeChunks = [], protocolChunks = [] }) {
  const hasCtcae = Array.isArray(ctcaeChunks) && ctcaeChunks.length > 0;
  const hasProtocol = Array.isArray(protocolChunks) && protocolChunks.length > 0;
  if (hasCtcae && hasProtocol) return 'ctcae+protocol';
  if (hasProtocol) return 'protocol';
  if (hasCtcae) return 'ctcae';
  return 'none';
}

function extractConversationAnchors(historyMessages = []) {
  const filtered = (historyMessages || []).filter(
    (entry) => entry?.role === 'user' || entry?.role === 'model'
  );
  const previousUserMessage = [...filtered].reverse().find((entry) => entry.role === 'user')?.text || '';
  const previousModelMessage = [...filtered].reverse().find((entry) => entry.role === 'model')?.text || '';
  return { previousUserMessage, previousModelMessage };
}

function detectRequestedSources(userText, hasProtocolScope) {
  const text = normalizeText(userText).toLowerCase();
  const needsCtcae = /\b(ctcae|grade|grading|severity|risk)\b/.test(text) || MEDICAL_PATTERNS.some((pattern) => pattern.test(text));
  const needsProtocol = hasProtocolScope && /\b(protocol|trial|schedule|visit|dose|window)\b/.test(text);
  return {
    needsCtcae,
    needsProtocol,
  };
}

function classifyHardSkip(userText) {
  const normalized = normalizeText(userText);
  if (!normalized) return 'empty';
  if (normalized.length <= 6) {
    return 'short';
  }
  if (HARD_SKIP_PATTERNS.some((pattern) => pattern.test(normalized)) && !MEDICAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'small_talk';
  }
  return null;
}

function classifyHardRetrieve(userText, { hasProtocolScope }) {
  const requestedSources = detectRequestedSources(userText, hasProtocolScope);
  if (!requestedSources.needsCtcae && !requestedSources.needsProtocol) {
    return null;
  }

  return {
    reason: 'explicit_grounding',
    needsCtcae: requestedSources.needsCtcae,
    needsProtocol: requestedSources.needsProtocol,
  };
}

function canReuseRetrievalCache({
  retrievalCache,
  patientId,
  protocolId,
  protocolName,
  currentTurnIndex,
  lastRetrievalTurnIndex,
  requiredSources,
}) {
  if (!retrievalCache) return false;
  if (Date.now() - Number(retrievalCache.createdAt || 0) > CACHE_MAX_AGE_MS) return false;
  if (currentTurnIndex - Number(lastRetrievalTurnIndex || 0) > CACHE_MAX_TURN_DISTANCE) return false;
  if (String(retrievalCache.patientId || '') !== String(patientId || '')) return false;
  if (String(retrievalCache.protocolId || '') !== String(protocolId || '')) return false;
  if (String(retrievalCache.protocolName || '') !== String(protocolName || '')) return false;
  if (requiredSources?.needsCtcae && !retrievalCache.ctcaeChunks?.length) return false;
  if (requiredSources?.needsProtocol && !retrievalCache.protocolChunks?.length) return false;
  return true;
}

function selectCachedChunks(retrievalCache, requiredSources) {
  return {
    ctcaeChunks: requiredSources?.needsCtcae ? retrievalCache?.ctcaeChunks || [] : [],
    protocolChunks: requiredSources?.needsProtocol ? retrievalCache?.protocolChunks || [] : [],
  };
}

async function classifyWithRouterModel({
  userText,
  historyMessages = [],
  hasPatientContext = false,
  hasProtocolScope = false,
  previousTurnUsedRetrieval = false,
  cachedSourcesAvailable = false,
}) {
  const { previousUserMessage, previousModelMessage } = extractConversationAnchors(historyMessages);

  try {
    const response = await callFunctionHttp('classifyGuidanceRouteHttp', {
      userText: normalizeText(userText).slice(0, 1200),
      previousUserMessage: normalizeText(previousUserMessage).slice(0, 600),
      previousModelMessage: normalizeText(previousModelMessage).slice(0, 800),
      hasPatientContext: Boolean(hasPatientContext),
      hasProtocolScope: Boolean(hasProtocolScope),
      previousTurnUsedRetrieval: Boolean(previousTurnUsedRetrieval),
      cachedSourcesAvailable: Boolean(cachedSourcesAvailable),
    });

    const decision = String(response?.decision || '').trim().toLowerCase();
    const confidence = Number(response?.confidence) || 0;
    if (!['skip', 'retrieve', 'reuse_cache'].includes(decision) || confidence < MIN_ROUTER_CONFIDENCE) {
      return {
        decision: 'retrieve',
        confidence: 0,
        needs_ctcae: true,
        needs_protocol: hasProtocolScope,
        reason_code: 'fallback_retrieve',
      };
    }

    return {
      decision,
      confidence,
      needs_ctcae: Boolean(response?.needs_ctcae),
      needs_protocol: Boolean(hasProtocolScope && response?.needs_protocol),
      reason_code: String(response?.reason_code || 'model_router'),
    };
  } catch (error) {
    console.error('Guidance route classification failed:', error);
    return {
      decision: 'retrieve',
      confidence: 0,
      needs_ctcae: true,
      needs_protocol: hasProtocolScope,
      reason_code: 'fallback_retrieve',
    };
  }
}

async function fetchGuidanceChunks({
  userText,
  protocolId,
  protocolName,
  needsCtcae,
  needsProtocol,
}) {
  const { ctcaeChunks, protocolChunks } = await retrieveGuidanceContext({
    queryText: userText,
    protocolId,
    protocolName,
    ctcaeMatchCount: needsCtcae ? DEFAULT_MATCH_COUNT : 0,
    protocolMatchCount: needsProtocol ? DEFAULT_MATCH_COUNT : 0,
  });

  return {
    ctcaeChunks,
    protocolChunks,
  };
}

async function fetchGuidanceChunksWithFallback(options) {
  try {
    const chunks = await fetchGuidanceChunks(options);
    return {
      ...chunks,
      retrievalFailed: false,
      retrievalError: null,
    };
  } catch (error) {
    console.error('Guidance retrieval fallback activated:', error);
    return {
      ctcaeChunks: [],
      protocolChunks: [],
      retrievalFailed: true,
      retrievalError: error,
    };
  }
}

function buildNoRetrievalResult({
  workspaceContext,
  patientContext,
  userText,
  routeReason,
  retrievalCache,
  audienceRole = 'crc',
}) {
  return {
    prompt: buildGuidancePromptNoRetrieval({
      workspaceContext,
      patientContext,
      userText,
      audienceRole,
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
  };
}

export async function routeGuidanceRequest({
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
  onStageChange = null,
  audienceRole = 'crc',
}) {
  const normalizedUserText = normalizeText(userText);
  const hasProtocolScope = Boolean(normalizeText(protocolId) || normalizeText(protocolName));

  const hardSkipReason = classifyHardSkip(normalizedUserText);
  if (hardSkipReason) {
    return buildNoRetrievalResult({
      workspaceContext,
      patientContext,
      userText: normalizedUserText,
      routeReason: hardSkipReason,
      retrievalCache,
      audienceRole,
    });
  }

  const hardRetrieveDecision = classifyHardRetrieve(normalizedUserText, { hasProtocolScope });
  if (hardRetrieveDecision) {
    if (typeof onStageChange === 'function') {
      onStageChange(
        hardRetrieveDecision.needsProtocol && hasProtocolScope ? 'retrieval-scoped' : 'retrieval-global'
      );
    }

    const { ctcaeChunks, protocolChunks, retrievalFailed } = await fetchGuidanceChunksWithFallback({
      userText: normalizedUserText,
      protocolId,
      protocolName,
      needsCtcae: hardRetrieveDecision.needsCtcae,
      needsProtocol: hardRetrieveDecision.needsProtocol,
    });

    if (retrievalFailed) {
      return buildNoRetrievalResult({
        workspaceContext,
        patientContext,
        userText: normalizedUserText,
        routeReason: 'retrieval_unavailable',
        retrievalCache,
        audienceRole,
      });
    }

    const sourceMask = buildSourceMask({ ctcaeChunks, protocolChunks });
    return {
      prompt: buildGuidancePromptWithRetrieval({
        workspaceContext,
        patientContext,
        ctcaeChunks,
        protocolChunks,
        userText: normalizedUserText,
        audienceRole,
      }),
      routeDecision: 'retrieve',
      routeReason: hardRetrieveDecision.reason,
      usedCache: false,
      ctcaeChunks,
      protocolChunks,
      ctcaeCount: ctcaeChunks.length,
      protocolCount: protocolChunks.length,
      sourceMask,
      nextRetrievalCache: {
        createdAt: Date.now(),
        patientId,
        protocolId,
        protocolName,
        ctcaeChunks,
        protocolChunks,
        sourceMask,
        queryText: normalizedUserText,
      },
    };
  }

  const requestedSources = detectRequestedSources(normalizedUserText, hasProtocolScope);
  if (
    canReuseRetrievalCache({
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
        audienceRole,
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
    };
  }

  const classifierDecision = await classifyWithRouterModel({
    userText: normalizedUserText,
    historyMessages,
    hasPatientContext,
    hasProtocolScope,
    previousTurnUsedRetrieval:
      Boolean(lastRetrievalTurnIndex) && currentTurnIndex - lastRetrievalTurnIndex === 1,
    cachedSourcesAvailable:
      Boolean(retrievalCache?.ctcaeChunks?.length) || Boolean(retrievalCache?.protocolChunks?.length),
  });

  if (classifierDecision.decision === 'skip') {
    return buildNoRetrievalResult({
      workspaceContext,
      patientContext,
      userText: normalizedUserText,
      routeReason: classifierDecision.reason_code,
      retrievalCache,
      audienceRole,
    });
  }

  if (
    classifierDecision.decision === 'reuse_cache' &&
    canReuseRetrievalCache({
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
        audienceRole,
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
    };
  }

  if (typeof onStageChange === 'function') {
    onStageChange(
      classifierDecision.needs_protocol && hasProtocolScope ? 'retrieval-scoped' : 'retrieval-global'
    );
  }

  const { ctcaeChunks, protocolChunks, retrievalFailed } = await fetchGuidanceChunksWithFallback({
    userText: normalizedUserText,
    protocolId,
    protocolName,
    needsCtcae: classifierDecision.needs_ctcae,
    needsProtocol: classifierDecision.needs_protocol,
  });

  if (retrievalFailed) {
    return buildNoRetrievalResult({
      workspaceContext,
      patientContext,
      userText: normalizedUserText,
      routeReason: 'retrieval_unavailable',
      retrievalCache,
      audienceRole,
    });
  }

  const sourceMask = buildSourceMask({ ctcaeChunks, protocolChunks });
  return {
    prompt: buildGuidancePromptWithRetrieval({
      workspaceContext,
      patientContext,
      ctcaeChunks,
      protocolChunks,
      userText: normalizedUserText,
      audienceRole,
    }),
    routeDecision: 'retrieve',
    routeReason: classifierDecision.reason_code,
    usedCache: false,
    ctcaeChunks,
    protocolChunks,
    ctcaeCount: ctcaeChunks.length,
    protocolCount: protocolChunks.length,
    sourceMask,
    nextRetrievalCache: {
      createdAt: Date.now(),
      patientId,
      protocolId,
      protocolName,
      ctcaeChunks,
      protocolChunks,
      sourceMask,
      queryText: normalizedUserText,
    },
  };
}
