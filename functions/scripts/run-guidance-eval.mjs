import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { stringifyCsv } from '../lib/csvUtils.js';
import { resolveRuntimeProfile } from '../lib/modelRuntime.js';
import {
  runClassifyGuidanceRoute,
  runRetrieveGuidanceContext,
  runSideEffectGuidanceChat,
} from '../index.js';
import {
  executeGuidanceRouting,
  extractConversationAnchors,
} from '../../src/services/guidanceRouteCore.js';
import { buildStableSystemPrompt } from '../../src/services/guidanceSystemPrompt.js';
import { SAFETY_INSTRUCTIONS } from '../../src/safetyInstructions.js';

const CRC_AI_NAME = 'Side Effect Guidance';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getArg(flag, fallback = '') {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((entry) => entry === flag);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function getNumericArg(flag, fallback = 0) {
  const value = Number(getArg(flag, ''));
  return Number.isFinite(value) ? value : fallback;
}

function readJson(filePath) {
  return readFile(filePath, 'utf8').then((text) => JSON.parse(text));
}

function safeGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: resolve(process.cwd(), '..', '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function average(values = []) {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function percentile(values = [], percentileValue = 95) {
  const safeValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!safeValues.length) return 0;
  const index = Math.min(
    safeValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * safeValues.length) - 1)
  );
  return safeValues[index];
}

function extractReturnedCitations(text = '') {
  const matches = [
    ...(text.match(/\[[^\]]*Page\s+\d+[^\]]*\]/gi) || []),
    ...(text.match(/(?:According to\s+)?(?:CTCAE|Protocol)\s*\[Page\s*\d+\]/gi) || []),
  ];
  return [...new Set(matches.map((entry) => entry.trim()))];
}

function normalizeGoldChunks(chunks = []) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => ({
      id: normalizeText(chunk?.id),
      document_id: normalizeText(chunk?.document_id),
      protocol_id: normalizeText(chunk?.protocol_id),
      protocol_name: normalizeText(chunk?.protocol_name),
      title: normalizeText(chunk?.title),
      page: chunk?.page ?? null,
      chunk_index: Number(chunk?.chunk_index),
    }))
    .filter((chunk) => chunk.id || Number.isFinite(chunk.chunk_index));
}

function getChunkIndexes(chunks = []) {
  return [
    ...new Set(
      (Array.isArray(chunks) ? chunks : [])
        .map((chunk) => Number(chunk?.chunk_index))
        .filter((chunkIndex) => Number.isFinite(chunkIndex))
    ),
  ].sort((a, b) => a - b);
}

function recallScore(goldIndexes = [], retrievedIndexes = []) {
  if (!goldIndexes.length) return null;
  const retrieved = new Set(retrievedIndexes);
  return goldIndexes.filter((chunkIndex) => retrieved.has(chunkIndex)).length / goldIndexes.length;
}

function containsAllIndexes(goldIndexes = [], retrievedIndexes = []) {
  if (!goldIndexes.length) return null;
  const retrieved = new Set(retrievedIndexes);
  return goldIndexes.every((chunkIndex) => retrieved.has(chunkIndex));
}

function normalizeV2Case(caseItem) {
  if (!caseItem?.visible || !caseItem?.expected || !caseItem?.gold) {
    return {
      ...caseItem,
      eval_format: 'v1',
      source_vector_expected: {
        ctcae: Boolean(caseItem?.expected_needs_ctcae),
        protocol: Boolean(caseItem?.expected_needs_protocol),
      },
      gold_ctcae_chunks: [],
      gold_protocol_chunks: [],
    };
  }

  const sourceTypes = Array.isArray(caseItem.expected.source_types)
    ? caseItem.expected.source_types.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean)
    : [];
  const goldCtcaeChunks = normalizeGoldChunks(caseItem.gold.ctcae);
  const goldProtocolChunks = normalizeGoldChunks(caseItem.gold.protocol);
  const needsCtcae = sourceTypes.includes('ctcae') || goldCtcaeChunks.length > 0;
  const needsProtocol = sourceTypes.includes('protocol') || goldProtocolChunks.length > 0;
  const caseId = normalizeText(caseItem.case_id);
  const protocolScope = caseItem.protocol_scope || goldProtocolChunks[0] || {};

  return {
    ...caseItem,
    eval_format: 'v2',
    case_id: caseId,
    scenario_id: normalizeText(caseItem.scenario_id) || caseId,
    turn_index: toNumber(caseItem.turn_index, 1),
    question_type: normalizeText(caseItem.task_type) || normalizeText(caseItem.question_type) || 'generated_rag_case',
    risk_level: normalizeText(caseItem.risk_level) || normalizeText(caseItem.difficulty) || 'medium',
    user_query: normalizeText(caseItem.visible.user_query),
    workspace_context: normalizeText(caseItem.visible.workspace_context),
    patient_context: normalizeText(caseItem.visible.patient_context),
    history_messages: Array.isArray(caseItem.visible.history_messages)
      ? caseItem.visible.history_messages
      : Array.isArray(caseItem.history_messages)
        ? caseItem.history_messages
        : [],
    has_patient_context: true,
    has_protocol_scope: needsProtocol,
    expected_route_decision: normalizeText(caseItem.expected.route) || 'retrieve',
    expected_needs_ctcae: needsCtcae,
    expected_needs_protocol: needsProtocol,
    requires_grounded_citation: Boolean(caseItem.expected.requires_citation),
    patient_id: normalizeText(caseItem.patient_id) || `eval-${caseId}`,
    patient_name: normalizeText(caseItem.patient_name) || 'Generated Eval Patient',
    protocol_id: normalizeText(protocolScope.protocol_id) || null,
    protocol_name:
      normalizeText(protocolScope.protocol_name) ||
      normalizeText(protocolScope.title) ||
      normalizeText(protocolScope.document_id) ||
      null,
    clinical_focus: normalizeText(caseItem.clinical_focus) || normalizeText(caseItem.task_type) || '',
    notes: normalizeText(caseItem.notes),
    source_vector_expected: {
      ctcae: needsCtcae,
      protocol: needsProtocol,
    },
    gold_ctcae_chunks: goldCtcaeChunks,
    gold_protocol_chunks: goldProtocolChunks,
  };
}

function buildWorkspaceContext(caseItem) {
  if (normalizeText(caseItem.workspace_context)) {
    return normalizeText(caseItem.workspace_context);
  }

  return [
    '=== SELECTED PATIENT ===',
    JSON.stringify(
      {
        id: caseItem.has_patient_context ? caseItem.patient_id || `eval-${caseItem.scenario_id}` : null,
        nickname: caseItem.has_patient_context ? caseItem.patient_name || 'Eval Patient' : null,
        protocolId: caseItem.has_protocol_scope ? caseItem.protocol_id || `protocol-${caseItem.scenario_id}` : null,
        protocolName: caseItem.has_protocol_scope ? caseItem.protocol_name || 'Eval Protocol' : null,
      },
      null,
      2
    ),
    '=== CRC PATIENT ROSTER ===',
    JSON.stringify(
      [
        {
          id: caseItem.patient_id || `eval-${caseItem.scenario_id}`,
          nickname: caseItem.patient_name || 'Eval Patient',
          status: 'active',
        },
        {
          id: 'eval-other-001',
          nickname: 'Other Eval Patient',
          status: 'active',
        },
      ],
      null,
      2
    ),
    '=== URGENT ALERTS ===',
    JSON.stringify(
      caseItem.risk_level === 'high'
        ? [{ patient: caseItem.patient_name || 'Eval Patient', reason: caseItem.clinical_focus || 'High-risk symptom' }]
        : [],
      null,
      2
    ),
    '=== ALERT HISTORY ===',
    JSON.stringify([], null, 2),
    '=== ALL EPRO SUBMISSIONS ===',
    JSON.stringify([], null, 2),
    '=== INCIDENT RECORDS ===',
    JSON.stringify([], null, 2),
  ].join('\n\n');
}

function buildPatientContext(caseItem) {
  if (!caseItem.has_patient_context) {
    return 'No single patient is currently selected. Use the CRC workspace context for workspace-level questions.';
  }

  if (normalizeText(caseItem.patient_context)) {
    return normalizeText(caseItem.patient_context);
  }

  return [
    '=== PATIENT PROFILE ===',
    JSON.stringify(
      {
        id: caseItem.patient_id || `eval-${caseItem.scenario_id}`,
        nickname: caseItem.patient_name || 'Eval Patient',
        age: caseItem.patient_age || 58,
        sex: caseItem.patient_sex || 'female',
        studyStatus: 'active',
      },
      null,
      2
    ),
    '=== ACTIVE PATIENT SNAPSHOT ===',
    JSON.stringify(
      {
        symptomFocus: caseItem.clinical_focus || 'General oncology safety assessment',
        riskLevel: caseItem.risk_level,
        note: caseItem.notes,
      },
      null,
      2
    ),
    '=== VITALS ===',
    JSON.stringify(
      [
        {
          takenAt: '2026-04-10T08:00:00Z',
          bloodPressure: '128/78',
          heartRate: 84,
          spo2: caseItem.risk_level === 'high' ? 90 : 97,
          temperatureC: caseItem.risk_level === 'high' ? 39.2 : 37.1,
        },
      ],
      null,
      2
    ),
    '=== APPOINTMENTS ===',
    JSON.stringify([], null, 2),
    '=== ALERT HISTORY ===',
    JSON.stringify([], null, 2),
    '=== EPRO SUBMISSIONS ===',
    JSON.stringify(
      [
        {
          submittedAt: '2026-04-10T08:15:00Z',
          focus: caseItem.clinical_focus || 'General oncology safety assessment',
        },
      ],
      null,
      2
    ),
    '=== INCIDENT RECORDS ===',
    JSON.stringify([], null, 2),
    '=== ACTIVE PROTOCOL ===',
    JSON.stringify(
      {
        protocolId: caseItem.has_protocol_scope ? caseItem.protocol_id || `protocol-${caseItem.scenario_id}` : null,
        protocolName: caseItem.has_protocol_scope ? caseItem.protocol_name || 'Eval Protocol' : null,
      },
      null,
      2
    ),
  ].join('\n\n');
}

function normalizeHistoryMessages(historyMessages = []) {
  return (Array.isArray(historyMessages) ? historyMessages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'model')
    .map((message) => ({
      role: message.role,
      text: normalizeText(message.text),
    }))
    .filter((message) => message.text);
}

function buildConversationMessages(historyMessages = []) {
  return historyMessages.map((message) => ({
    role: message.role === 'model' ? 'assistant' : 'user',
    content: message.text,
  }));
}

function summarizeTokenUsage(routerUsage, answerUsage) {
  const routerTotal = toNumber(routerUsage?.totalTokenCount);
  const answerTotal = toNumber(answerUsage?.totalTokenCount);
  return {
    router: routerUsage || null,
    answer: answerUsage || null,
    totalTokenCount: routerTotal + answerTotal,
  };
}

function buildHumanReviewRows(caseResults = [], manifest = {}) {
  return caseResults.map((result) => ({
    combo_id: manifest.combo_id,
    case_id: result.case_id,
    scenario_id: result.scenario_id,
    turn_index: result.turn_index,
    question_type: result.question_type,
    risk_level: result.risk_level,
    route_decision: result.route_decision,
    route_reason: result.route_reason,
    final_answer: result.final_answer,
    grounding_score: '',
    safety_score: '',
    actionability_score: '',
    clarity_score: '',
    overall_pass_fail: '',
    reviewer_notes: '',
  }));
}

function buildMetricsSummary(caseResults = []) {
  const totalCases = caseResults.length || 1;
  const successfulCases = caseResults.filter((result) => result.status === 'success');
  const expectedSkipCases = caseResults.filter((result) => result.expected_route_decision === 'skip');
  const highRiskCases = caseResults.filter((result) => result.risk_level === 'high');
  const classifierRoutedCases = caseResults.filter((result) => result.classifier_invoked);
  const v2Cases = caseResults.filter((result) => result.eval_format === 'v2');
  const v2Total = v2Cases.length || 1;
  const ctcaeGoldCases = v2Cases.filter((result) => result.gold_ctcae_chunk_indexes?.length);
  const protocolGoldCases = v2Cases.filter((result) => result.gold_protocol_chunk_indexes?.length);
  const combinedGoldCases = v2Cases.filter((result) => result.gold_chunk_count > 0);

  return {
    total_cases: caseResults.length,
    success_rate: successfulCases.length / totalCases,
    error_rate: caseResults.filter((result) => result.status === 'error').length / totalCases,
    route_accuracy:
      caseResults.filter((result) => result.route_decision === result.expected_route_decision).length / totalCases,
    skip_accuracy: expectedSkipCases.length
      ? expectedSkipCases.filter((result) => result.route_decision === 'skip').length / expectedSkipCases.length
      : 0,
    ctcae_selection_accuracy:
      caseResults.filter((result) => result.needs_ctcae === result.expected_needs_ctcae).length / totalCases,
    protocol_selection_accuracy:
      caseResults.filter((result) => result.needs_protocol === result.expected_needs_protocol).length / totalCases,
    avg_latency_ms: average(caseResults.map((result) => result.total_latency_ms)),
    p95_latency_ms: percentile(caseResults.map((result) => result.total_latency_ms), 95),
    avg_tokens: average(caseResults.map((result) => toNumber(result.token_usage?.totalTokenCount))),
    avg_cost: average(caseResults.map((result) => toNumber(result.estimated_cost))),
    citation_rate:
      caseResults.filter((result) => Array.isArray(result.returned_citations) && result.returned_citations.length > 0)
        .length / totalCases,
    classifier_invocation_rate: classifierRoutedCases.length / totalCases,
    classifier_invoked_case_count: classifierRoutedCases.length,
    high_risk_case_count: highRiskCases.length,
    high_risk_case_success_rate: highRiskCases.length
      ? highRiskCases.filter((result) => result.status === 'success').length / highRiskCases.length
      : 0,
    v2_case_count: v2Cases.length,
    source_vector_accuracy: v2Cases.length
      ? v2Cases.filter((result) => result.source_vector_match).length / v2Total
      : 0,
    ctcae_chunk_recall: ctcaeGoldCases.length
      ? average(ctcaeGoldCases.map((result) => result.ctcae_chunk_recall).filter((value) => value !== null))
      : 0,
    protocol_chunk_recall: protocolGoldCases.length
      ? average(protocolGoldCases.map((result) => result.protocol_chunk_recall).filter((value) => value !== null))
      : 0,
    combined_gold_chunk_recall: combinedGoldCases.length
      ? average(combinedGoldCases.map((result) => result.combined_gold_chunk_recall).filter((value) => value !== null))
      : 0,
    top_k_gold_hit_rate: combinedGoldCases.length
      ? combinedGoldCases.filter((result) => result.gold_chunk_vector_match).length / combinedGoldCases.length
      : 0,
  };
}

async function runEvalCase(caseItem, scenarioState, runtime) {
  const effectiveHistory =
    scenarioState.messages.length > 0 ? scenarioState.messages : normalizeHistoryMessages(caseItem.history_messages);
  const workspaceContext = buildWorkspaceContext(caseItem);
  const patientContext = buildPatientContext(caseItem);
  const systemPrompt = buildStableSystemPrompt(CRC_AI_NAME, SAFETY_INSTRUCTIONS);

  let routerUsage = null;
  let routerEstimatedCost = 0;
  let routedGuidance = null;
  let answerResult = null;
  let errorMessage = '';

  const routeStart = performance.now();

  try {
    routedGuidance = await executeGuidanceRouting({
      userText: caseItem.user_query,
      workspaceContext,
      patientContext,
      patientId: caseItem.has_patient_context ? caseItem.patient_id || `eval-${caseItem.scenario_id}` : null,
      protocolId: caseItem.has_protocol_scope ? caseItem.protocol_id || `protocol-${caseItem.scenario_id}` : null,
      protocolName: caseItem.has_protocol_scope ? caseItem.protocol_name || 'Eval Protocol' : null,
      hasPatientContext: Boolean(caseItem.has_patient_context),
      historyMessages: effectiveHistory,
      retrievalCache: scenarioState.retrievalCache,
      currentTurnIndex: toNumber(caseItem.turn_index, 1),
      lastRetrievalTurnIndex: scenarioState.lastRetrievalTurnIndex,
      disableHardRouting: Boolean(runtime.disableHardRouting),
      classifyRoute: async (routePayload) => {
        const anchors = extractConversationAnchors(routePayload.historyMessages);
        const response = await runClassifyGuidanceRoute({
          userText: routePayload.userText,
          previousUserMessage: anchors.previousUserMessage,
          previousModelMessage: anchors.previousModelMessage,
          hasPatientContext: routePayload.hasPatientContext,
          hasProtocolScope: routePayload.hasProtocolScope,
          previousTurnUsedRetrieval: routePayload.previousTurnUsedRetrieval,
          cachedSourcesAvailable: routePayload.cachedSourcesAvailable,
          assistantMode: 'crc',
          profileId: runtime.routerProfileRequestId,
        });
        routerUsage = response.usage || null;
        routerEstimatedCost = toNumber(response.estimatedCost);
        return response;
      },
      fetchGuidanceChunks: async (retrievalPayload) =>
        runRetrieveGuidanceContext({
          queryText: retrievalPayload.userText,
          protocolId: retrievalPayload.protocolId,
          protocolName: retrievalPayload.protocolName,
          ctcaeMatchCount: retrievalPayload.needsCtcae ? 5 : 0,
          protocolMatchCount: retrievalPayload.needsProtocol ? 5 : 0,
        }),
    });
  } catch (error) {
    errorMessage = normalizeText(error?.message || error || 'Routing failed.');
  }

  const routerLatencyMs = performance.now() - routeStart;
  const answerStart = performance.now();

  if (!errorMessage && routedGuidance) {
    try {
      answerResult = await runSideEffectGuidanceChat({
        profileId: runtime.answerProfile.id,
        systemPrompt,
        messages: buildConversationMessages(effectiveHistory),
        userMessage: routedGuidance.prompt,
        profileId: runtime.answerProfileRequestId,
      });
    } catch (error) {
      errorMessage = normalizeText(error?.message || error || 'Answer generation failed.');
    }
  }

  const answerLatencyMs = performance.now() - answerStart;
  const finalAnswer = answerResult?.text || '';
  const returnedCitations = extractReturnedCitations(finalAnswer);
  const tokenUsage = summarizeTokenUsage(routerUsage, answerResult?.usage);
  const estimatedCost = routerEstimatedCost + toNumber(answerResult?.estimatedCost);
  const retrievedCtcaeChunks = Array.isArray(routedGuidance?.ctcaeChunks) ? routedGuidance.ctcaeChunks : [];
  const retrievedProtocolChunks = Array.isArray(routedGuidance?.protocolChunks) ? routedGuidance.protocolChunks : [];
  const retrievedCtcaeChunkIndexes = getChunkIndexes(retrievedCtcaeChunks);
  const retrievedProtocolChunkIndexes = getChunkIndexes(retrievedProtocolChunks);
  const goldCtcaeChunks = normalizeGoldChunks(caseItem.gold_ctcae_chunks);
  const goldProtocolChunks = normalizeGoldChunks(caseItem.gold_protocol_chunks);
  const goldCtcaeChunkIndexes = getChunkIndexes(goldCtcaeChunks);
  const goldProtocolChunkIndexes = getChunkIndexes(goldProtocolChunks);
  const sourceVectorExpected = caseItem.source_vector_expected || {
    ctcae: Boolean(caseItem.expected_needs_ctcae),
    protocol: Boolean(caseItem.expected_needs_protocol),
  };
  const sourceVectorActual = {
    ctcae: retrievedCtcaeChunkIndexes.length > 0,
    protocol: retrievedProtocolChunkIndexes.length > 0,
  };
  const combinedGoldIndexes = [
    ...goldCtcaeChunkIndexes.map((chunkIndex) => `ctcae:${chunkIndex}`),
    ...goldProtocolChunkIndexes.map((chunkIndex) => `protocol:${chunkIndex}`),
  ];
  const combinedRetrievedIndexes = [
    ...retrievedCtcaeChunkIndexes.map((chunkIndex) => `ctcae:${chunkIndex}`),
    ...retrievedProtocolChunkIndexes.map((chunkIndex) => `protocol:${chunkIndex}`),
  ];

  if (!errorMessage && routedGuidance && answerResult) {
    scenarioState.messages.push({ role: 'user', text: normalizeText(caseItem.user_query) });
    scenarioState.messages.push({ role: 'model', text: finalAnswer });

    if (routedGuidance.routeDecision === 'retrieve' && routedGuidance.nextRetrievalCache) {
      scenarioState.retrievalCache = routedGuidance.nextRetrievalCache;
      scenarioState.lastRetrievalTurnIndex = toNumber(caseItem.turn_index, 1);
    } else if (routedGuidance.routeDecision === 'reuse_cache' && scenarioState.retrievalCache) {
      scenarioState.lastRetrievalTurnIndex = toNumber(caseItem.turn_index, 1);
    }
  }

  return {
    eval_format: caseItem.eval_format || 'v1',
    case_id: caseItem.case_id,
    scenario_id: caseItem.scenario_id,
    turn_index: toNumber(caseItem.turn_index, 1),
    question_type: caseItem.question_type,
    risk_level: caseItem.risk_level,
    user_query: caseItem.user_query,
    clinical_focus: caseItem.clinical_focus || '',
    router_profile_id: runtime.routerProfile.id,
    router_provider: runtime.routerProfile.providerLabel || runtime.routerProfile.provider,
    router_model: runtime.routerProfile.model,
    answer_profile_id: runtime.answerProfile.id,
    answer_provider: runtime.answerProfile.providerLabel || runtime.answerProfile.provider,
    answer_model: runtime.answerProfile.model,
    expected_route_decision: caseItem.expected_route_decision,
    expected_needs_ctcae: Boolean(caseItem.expected_needs_ctcae),
    expected_needs_protocol: Boolean(caseItem.expected_needs_protocol),
    requires_grounded_citation: Boolean(caseItem.requires_grounded_citation),
    route_decision: routedGuidance?.routeDecision || '',
    route_reason: routedGuidance?.routeReason || '',
    routing_stage: routedGuidance?.routingStage || '',
    classifier_invoked: Boolean(routedGuidance?.classifierInvoked),
    needs_ctcae: retrievedCtcaeChunks.length > 0,
    needs_protocol: retrievedProtocolChunks.length > 0,
    retrieved_ctcae_count: toNumber(routedGuidance?.ctcaeCount),
    retrieved_protocol_count: toNumber(routedGuidance?.protocolCount),
    retrieved_chunk_ids: [
      ...retrievedCtcaeChunks.map((entry) => entry.id),
      ...retrievedProtocolChunks.map((entry) => entry.id),
    ],
    retrieved_ctcae_chunk_indexes: retrievedCtcaeChunkIndexes,
    retrieved_protocol_chunk_indexes: retrievedProtocolChunkIndexes,
    gold_ctcae_chunk_indexes: goldCtcaeChunkIndexes,
    gold_protocol_chunk_indexes: goldProtocolChunkIndexes,
    gold_ctcae_chunk_ids: goldCtcaeChunks.map((chunk) => chunk.id).filter(Boolean),
    gold_protocol_chunk_ids: goldProtocolChunks.map((chunk) => chunk.id).filter(Boolean),
    gold_chunk_count: combinedGoldIndexes.length,
    source_vector_expected: sourceVectorExpected,
    source_vector_actual: sourceVectorActual,
    source_vector_match:
      Boolean(sourceVectorExpected.ctcae) === sourceVectorActual.ctcae &&
      Boolean(sourceVectorExpected.protocol) === sourceVectorActual.protocol,
    ctcae_chunk_recall: recallScore(goldCtcaeChunkIndexes, retrievedCtcaeChunkIndexes),
    protocol_chunk_recall: recallScore(goldProtocolChunkIndexes, retrievedProtocolChunkIndexes),
    combined_gold_chunk_recall: recallScore(combinedGoldIndexes, combinedRetrievedIndexes),
    gold_chunk_vector_match: containsAllIndexes(combinedGoldIndexes, combinedRetrievedIndexes),
    final_answer: finalAnswer,
    returned_citations: returnedCitations,
    router_latency_ms: Number(routerLatencyMs.toFixed(2)),
    answer_latency_ms: Number(answerLatencyMs.toFixed(2)),
    total_latency_ms: Number((routerLatencyMs + answerLatencyMs).toFixed(2)),
    token_usage: tokenUsage,
    estimated_cost: Number(estimatedCost.toFixed(8)),
    error: errorMessage,
    status: errorMessage ? 'error' : 'success',
    notes: caseItem.notes || '',
  };
}

async function main() {
  const casesPath = resolve(process.cwd(), getArg('--cases', './evals/guidance-cases.json'));
  const outDir = resolve(process.cwd(), getArg('--out-dir', './output/evals/latest-run'));
  const routerProfileId = getArg('--router-profile', '');
  const answerProfileId = getArg('--answer-profile', '');
  const caseId = normalizeText(getArg('--case-id', ''));
  const caseLimit = Math.max(0, getNumericArg('--limit', 0));
  const disableHardRouting = hasFlag('--disable-hard-routing');
  const dataset = await readJson(casesPath);
  const allCases = (Array.isArray(dataset?.cases) ? dataset.cases : []).map(normalizeV2Case);
  let cases = allCases;

  if (caseId) {
    cases = allCases.filter((caseItem) => normalizeText(caseItem.case_id) === caseId);
  }

  if (caseLimit > 0) {
    cases = cases.slice(0, caseLimit);
  }

  if (!cases.length) {
    throw new Error('No evaluation cases were found.');
  }

  const routerProfile = resolveRuntimeProfile({
    task: 'guidance_route',
    profileId: routerProfileId || null,
  });
  const answerProfile = resolveRuntimeProfile({
    task: 'guidance_answer',
    profileId: answerProfileId || null,
  });

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const comboId = `${routerProfile.id}__${answerProfile.id}`;
  const manifest = {
    run_id: runId,
    combo_id: comboId,
    started_at: new Date().toISOString(),
    caseset_id: dataset.caseset_id || basename(casesPath),
    caseset_description: dataset.description || '',
    router_profile_id: routerProfile.id,
    router_provider: routerProfile.providerLabel || routerProfile.provider,
    router_model: routerProfile.model,
    answer_profile_id: answerProfile.id,
    answer_provider: answerProfile.providerLabel || answerProfile.provider,
    answer_model: answerProfile.model,
    embedding_model: process.env.SILICONFLOW_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B',
    retrieval_config_version: 'v1-fixed',
    prompt_version: 'stable-crc-v1',
    git_commit: safeGitCommit(),
    total_cases: cases.length,
    original_total_cases: allCases.length,
    selected_case_id: caseId || null,
    case_limit: caseLimit || null,
    disable_hard_routing: disableHardRouting,
    source_cases_file: casesPath,
  };

  const runtime = {
    routerProfile,
    answerProfile,
    routerProfileRequestId: normalizeText(routerProfileId) || null,
    answerProfileRequestId: normalizeText(answerProfileId) || null,
    disableHardRouting,
  };
  const scenarioStateMap = new Map();
  const caseResults = [];

  for (const [index, caseItem] of cases.entries()) {
    console.log(
      `[eval] ${index + 1}/${cases.length} ${normalizeText(caseItem.case_id) || `case-${index + 1}`} ` +
        `(${normalizeText(caseItem.question_type) || 'unknown'})`
    );

    const scenarioId = normalizeText(caseItem.scenario_id) || normalizeText(caseItem.case_id);
    const scenarioState =
      scenarioStateMap.get(scenarioId) ||
      {
        messages: [],
        retrievalCache: null,
        lastRetrievalTurnIndex: 0,
      };

    const result = await runEvalCase(caseItem, scenarioState, runtime);
    scenarioStateMap.set(scenarioId, scenarioState);
    caseResults.push(result);
  }

  const metricsSummary = {
    combo_id: comboId,
    ...buildMetricsSummary(caseResults),
  };
  manifest.finished_at = new Date().toISOString();

  const humanReviewRows = buildHumanReviewRows(caseResults, manifest);
  const humanReviewColumns = [
    'combo_id',
    'case_id',
    'scenario_id',
    'turn_index',
    'question_type',
    'risk_level',
    'route_decision',
    'route_reason',
    'final_answer',
    'grounding_score',
    'safety_score',
    'actionability_score',
    'clarity_score',
    'overall_pass_fail',
    'reviewer_notes',
  ];

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outDir, 'run_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outDir, 'case_results.json'), `${JSON.stringify(caseResults, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outDir, 'metrics_summary.json'), `${JSON.stringify(metricsSummary, null, 2)}\n`, 'utf8'),
    writeFile(
      resolve(outDir, 'human_review_template.csv'),
      `${stringifyCsv(humanReviewRows, humanReviewColumns)}\n`,
      'utf8'
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        outDir,
        comboId,
        totalCases: caseResults.length,
        successRate: metricsSummary.success_rate,
        routeAccuracy: metricsSummary.route_accuracy,
        disableHardRouting,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
