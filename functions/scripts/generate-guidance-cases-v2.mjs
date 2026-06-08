import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { resolveRuntimeProfile, runTask } from '../lib/modelRuntime.js';

const DEFAULT_PROTOCOL_TITLE = 'Protocol-Type 1 Diabetes Mellitus.pdf';
const DEFAULT_OUT = './evals/generated-guidance-cases-v2.json';
const DEFAULT_COUNT = 50;
const DEFAULT_SEED = 20260604;
const DEFAULT_PER_CASE_TIMEOUT_MS = 180000;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_CHUNKS_PER_CASE = 1;
const PAGE_SIZE = 1000;
const MAX_CONTENT_CHARS = 1400;

const SKIP_BLUEPRINTS = [
  {
    taskType: 'greeting_or_smalltalk',
    difficulty: 'low',
    sourceTypes: [],
    expectedRoute: 'skip',
    requiresCitation: false,
  },
  {
    taskType: 'product_or_workflow_help',
    difficulty: 'low',
    sourceTypes: [],
    expectedRoute: 'skip',
    requiresCitation: false,
  },
];

const DIRECT_LOOKUP_BLUEPRINTS = [
  {
    taskType: 'direct_ctcae_lookup',
    difficulty: 'low',
    sourceTypes: ['ctcae'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
  {
    taskType: 'direct_protocol_lookup',
    difficulty: 'medium',
    sourceTypes: ['protocol'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
  {
    taskType: 'direct_ctcae_protocol_lookup',
    difficulty: 'medium',
    sourceTypes: ['ctcae', 'protocol'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
  {
    taskType: 'direct_citation_request',
    difficulty: 'medium',
    sourceTypes: ['ctcae', 'protocol'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
];

const PATIENT_CONTEXT_BLUEPRINTS = [
  {
    taskType: 'current_patient_status',
    difficulty: 'medium',
    sourceTypes: [],
    expectedRoute: 'skip',
    requiresCitation: false,
  },
  {
    taskType: 'current_patient_ctcae_assessment',
    difficulty: 'medium',
    sourceTypes: ['ctcae'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
  {
    taskType: 'current_patient_emergency_protocol',
    difficulty: 'high',
    sourceTypes: ['ctcae', 'protocol'],
    expectedRoute: 'retrieve',
    requiresCitation: true,
  },
];

function buildBlueprintSequence(count) {
  const base = [];

  for (let index = 0; index < 10; index += 1) {
    base.push({
      ...SKIP_BLUEPRINTS[index % SKIP_BLUEPRINTS.length],
      category: 'skip',
    });
  }

  for (let index = 0; index < 20; index += 1) {
    base.push({
      ...DIRECT_LOOKUP_BLUEPRINTS[index % DIRECT_LOOKUP_BLUEPRINTS.length],
      category: 'direct_lookup',
    });
  }

  for (let index = 0; index < 15; index += 1) {
    base.push({
      ...PATIENT_CONTEXT_BLUEPRINTS[index % PATIENT_CONTEXT_BLUEPRINTS.length],
      category: 'patient_context',
    });
  }

  const retrievalParentIndexes = base
    .map((blueprint, index) => ({ blueprint, index }))
    .filter((entry) => entry.blueprint.expectedRoute === 'retrieve');

  for (let index = 0; index < 5; index += 1) {
    const parent = retrievalParentIndexes[Math.floor((index * retrievalParentIndexes.length) / 5)];
    base.push({
      taskType: 'cache_follow_up',
      difficulty: parent.blueprint.difficulty,
      sourceTypes: parent.blueprint.sourceTypes,
      expectedRoute: 'reuse_cache',
      requiresCitation: parent.blueprint.requiresCitation,
      category: 'cache_follow_up',
      parentBlueprintIndex: parent.index,
    });
  }

  if (count <= base.length) {
    return base.slice(0, count);
  }

  const expanded = [...base];
  let index = 0;
  while (expanded.length < count) {
    expanded.push({
      ...base[index % base.length],
      parentBlueprintIndex: null,
    });
    index += 1;
  }
  return expanded;
}

const GENERATOR_SYSTEM_PROMPT = `
You generate synthetic CRC guidance evaluation cases.

The user is always a Clinical Research Coordinator.
Generate realistic CRC workspace cases that cover the daily guidance pipeline:
1. Greeting or product/workflow help: no CTCAE or protocol retrieval is needed.
2. Direct CTCAE/protocol lookup: the CRC directly asks for CTCAE, protocol, or both.
3. Current patient or emergency context: simulate current workspace/patient information in visible context.
4. Cache follow-up: a short follow-up should rely on the immediately prior grounded answer and retrieval cache.
When excerpts are provided, the generated case must require those excerpts to answer correctly.
Do not mention chunk ids, chunk indexes, embeddings, vector search, source vectors, or gold labels in the user-facing query or context.
Do not invent protocol facts outside the provided protocol excerpts.
Do not invent CTCAE grading criteria outside the provided CTCAE excerpts.
For current patient or emergency cases, create realistic synthetic workspace/patient facts in the visible context; do not claim these facts came from Supabase.
Return JSON only.
`.trim();

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getArg(flag, fallback = '') {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((entry) => entry === flag);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function getNumericArg(flag, fallback = 0) {
  const rawValue = getArg(flag, '');
  if (rawValue === '') return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function hasArg(flag) {
  return process.argv.slice(2).includes(flag);
}

function requireEnv(name) {
  const value = normalizeText(process.env[name]);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithoutReplacement(items, count, random) {
  const pool = [...items];
  const selected = [];
  const safeCount = Math.min(Math.max(0, count), pool.length);

  for (let index = 0; index < safeCount; index += 1) {
    const selectedIndex = Math.floor(random() * pool.length);
    selected.push(pool[selectedIndex]);
    pool.splice(selectedIndex, 1);
  }

  return selected;
}

function parseJsonResponse(text) {
  const trimmed = normalizeText(text);
  if (!trimmed) {
    throw new Error('Generator returned an empty response.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function truncateText(text, maxLength = MAX_CONTENT_CHARS) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function normalizeChunk(row) {
  const metadata = typeof row.metadata === 'string' ? safeJsonParse(row.metadata) : row.metadata || {};
  return {
    id: row.id,
    source_type: row.source_type,
    document_id: row.document_id,
    protocol_id: row.protocol_id || metadata.protocol_id || null,
    protocol_name: row.protocol_name || metadata.protocol_name || null,
    title: row.title || metadata.title || null,
    storage_bucket: row.storage_bucket || null,
    storage_path: row.storage_path || null,
    page: row.page ?? metadata.page ?? null,
    chunk_index: Number(row.chunk_index),
    content: normalizeText(row.content),
    metadata,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function chunkGoldEntry(chunk) {
  return {
    id: chunk.id,
    document_id: chunk.document_id,
    protocol_id: chunk.protocol_id,
    protocol_name: chunk.protocol_name,
    title: chunk.title,
    page: chunk.page,
    chunk_index: chunk.chunk_index,
  };
}

function buildChunkPromptBlock(label, chunks) {
  if (!chunks.length) return `${label}: none`;

  return chunks
    .map(
      (chunk, index) =>
        `${label} ${index + 1}\n` +
        `Title: ${chunk.title || chunk.protocol_name || chunk.document_id || 'Unknown'}\n` +
        `Page: ${chunk.page ?? 'Unknown'}\n` +
        `Excerpt:\n${truncateText(chunk.content)}`
    )
    .join('\n\n---\n\n');
}

function buildPriorCaseBlock(parentCase) {
  if (!parentCase) return 'No prior case.';

  return [
    `Prior case id: ${parentCase.case_id}`,
    `Prior task type: ${parentCase.task_type}`,
    `Prior clinical focus: ${parentCase.clinical_focus}`,
    `Prior user query: ${parentCase.visible?.user_query || ''}`,
    `Prior workspace context: ${truncateText(parentCase.visible?.workspace_context || '', 900)}`,
    `Prior patient context: ${truncateText(parentCase.visible?.patient_context || '', 900)}`,
  ].join('\n');
}

function buildGeneratorUserPrompt({ blueprint, ctcaeChunks, protocolChunks, caseNumber, parentCase = null }) {
  const sourceDescription = blueprint.sourceTypes.length ? blueprint.sourceTypes.join(', ') : 'none';
  const caseBehavior =
    blueprint.expectedRoute === 'skip'
      ? 'No document retrieval should be required. Generate a greeting, product/workflow help, or current-context-only question that can be answered from visible context.'
      : blueprint.expectedRoute === 'reuse_cache'
        ? 'Generate a brief follow-up that relies on the immediately prior grounded answer and should reuse the same cached evidence.'
        : 'Generate a request that requires the supplied CTCAE and/or protocol excerpts.';

  return `
Create one CRC guidance evaluation case.

Case number: ${caseNumber}
Category: ${blueprint.category}
Task type: ${blueprint.taskType}
Difficulty: ${blueprint.difficulty}
Expected route: ${blueprint.expectedRoute}
Expected source types: ${sourceDescription}
Requires citation: ${blueprint.requiresCitation ? 'yes' : 'no'}
Case behavior: ${caseBehavior}

Prior case for cache follow-up:
${buildPriorCaseBlock(parentCase)}

CTCAE excerpts:
${buildChunkPromptBlock('CTCAE excerpt', ctcaeChunks)}

Protocol excerpts:
${buildChunkPromptBlock('Protocol excerpt', protocolChunks)}

Return exactly this JSON object:
{
  "task_type": "${blueprint.taskType}",
  "difficulty": "${blueprint.difficulty}",
  "risk_level": "low|medium|high",
  "clinical_focus": "short phrase",
  "visible": {
    "user_query": "one realistic CRC user message",
    "workspace_context": "CRC workspace context that supports the case",
    "patient_context": "patient-specific context that supports the case"
  },
  "notes": "short internal note about what the case tests"
}

Rules:
- If expected route is skip, the visible user_query must not ask for CTCAE, protocol, grading, page citations, or source-backed clinical rules.
- If expected route is skip, avoid words that look like document retrieval triggers: protocol, study rule, CTCAE, grade, adverse event, SAE, dosing, eligibility, inclusion, exclusion, ePRO, lab interpretation, vital-sign interpretation, emergency, citation, page, source.
- Greeting cases should be pure assistant greetings, onboarding, or general workspace orientation.
- Product/workflow help cases should ask about neutral UI actions such as changing table columns, finding the search box, changing view density, pinning a task panel, or opening the help menu.
- If expected route is retrieve, the visible user_query must be answerable only by using the supplied excerpt(s).
- If expected route is reuse_cache, make the user_query short and clearly dependent on the immediately previous answer.
- If protocol excerpts are supplied, include the active protocol name naturally in context or query.
- If CTCAE excerpts are supplied, make the user ask for grading, severity, risk, or adverse-event interpretation.
- For current patient or emergency cases, simulate realistic workspace context including selected patient, vitals, alerts, ePRO submissions, incidents, and active protocol when relevant.
- Include enough patient/workspace details for a CRC assistant to understand the scenario.
- Do not expose chunk ids, chunk indexes, source vectors, embedding details, or gold labels.
  `.trim();
}

function buildBatchCaseSpec({ blueprint, ctcaeChunks, protocolChunks, caseNumber, parentCase = null }) {
  const sourceDescription = blueprint.sourceTypes.length ? blueprint.sourceTypes.join(', ') : 'none';
  const caseBehavior =
    blueprint.expectedRoute === 'skip'
      ? 'No document retrieval should be required. Generate a greeting, product/workflow help, or current-context-only question that can be answered from visible context.'
      : blueprint.expectedRoute === 'reuse_cache'
        ? 'Generate a brief follow-up that relies on the immediately prior grounded answer and should reuse the same cached evidence.'
        : 'Generate a request that requires the supplied CTCAE and/or protocol excerpts.';

  return `
Case number: ${caseNumber}
Category: ${blueprint.category}
Task type: ${blueprint.taskType}
Difficulty: ${blueprint.difficulty}
Expected route: ${blueprint.expectedRoute}
Expected source types: ${sourceDescription}
Requires citation: ${blueprint.requiresCitation ? 'yes' : 'no'}
Case behavior: ${caseBehavior}

Prior case for cache follow-up:
${buildPriorCaseBlock(parentCase)}

CTCAE excerpts:
${buildChunkPromptBlock('CTCAE excerpt', ctcaeChunks)}

Protocol excerpts:
${buildChunkPromptBlock('Protocol excerpt', protocolChunks)}
  `.trim();
}

function buildBatchGeneratorUserPrompt({ items }) {
  const specs = items.map((item) => buildBatchCaseSpec(item)).join('\n\n====================\n\n');

  return `
Create ${items.length} CRC guidance evaluation cases.

Each case must match its numbered case specification exactly. Return one JSON object with a "cases" array in the same order as the specifications.

Case specifications:
${specs}

Return exactly this JSON object:
{
  "cases": [
    {
      "case_number": 1,
      "task_type": "matching task type from the specification",
      "difficulty": "matching difficulty from the specification",
      "risk_level": "low|medium|high",
      "clinical_focus": "short phrase",
      "visible": {
        "user_query": "one realistic CRC user message",
        "workspace_context": "CRC workspace context that supports the case",
        "patient_context": "patient-specific context that supports the case"
      },
      "notes": "short internal note about what the case tests"
    }
  ]
}

Rules:
- The "cases" array length must be exactly ${items.length}.
- Preserve the case order and set each case_number to the supplied case number.
- If expected route is skip, the visible user_query must not ask for CTCAE, protocol, grading, page citations, or source-backed clinical rules.
- If expected route is retrieve, the visible user_query must be answerable only by using the supplied excerpt(s).
- If expected route is reuse_cache, make the user_query short and clearly dependent on the immediately previous answer.
- If protocol excerpts are supplied, include the active protocol name naturally in context or query.
- If CTCAE excerpts are supplied, make the user ask for grading, severity, risk, or adverse-event interpretation.
- For current patient or emergency cases, simulate realistic workspace context including selected patient, vitals, alerts, ePRO submissions, incidents, and active protocol when relevant.
- Include enough patient/workspace details for a CRC assistant to understand the scenario.
- Do not expose chunk ids, chunk indexes, source vectors, embedding details, source types, or gold labels.
  `.trim();
}

function assertNoVisibleLeak(casePayload) {
  const visibleText = [
    casePayload?.visible?.user_query,
    casePayload?.visible?.workspace_context,
    casePayload?.visible?.patient_context,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const bannedPatterns = [
    'chunk_index',
    'chunk index',
    'chunk id',
    'gold',
    'embedding',
    'vector',
    'source_type',
    'source type',
  ];

  const leaked = bannedPatterns.find((pattern) => visibleText.includes(pattern));
  if (leaked) {
    throw new Error(`Generated case leaks hidden metadata: ${leaked}`);
  }
}

function coerceGeneratedPayload(payload, blueprint) {
  const coerced = payload && typeof payload === 'object' ? { ...payload } : {};
  const visible = coerced.visible && typeof coerced.visible === 'object' ? { ...coerced.visible } : {};
  const taskType = normalizeText(coerced.task_type) || blueprint.taskType;

  if (!normalizeText(visible.workspace_context)) {
    visible.workspace_context =
      blueprint.category === 'patient_context'
        ? 'Synthetic CRC workspace context for a selected trial participant; no real Supabase patient record is used.'
        : 'CRC guidance workspace is open. No selected patient details are needed for this request.';
  }

  if (!normalizeText(visible.patient_context)) {
    visible.patient_context =
      blueprint.category === 'patient_context'
        ? 'Synthetic selected-patient details should be inferred from the visible workspace scenario; no real patient record is used.'
        : 'No patient is selected for this request; this is a general CRC guidance or workflow question.';
  }

  coerced.task_type = taskType;
  coerced.difficulty = normalizeText(coerced.difficulty) || blueprint.difficulty;
  coerced.visible = visible;
  return coerced;
}

function validateGeneratedPayload(payload) {
  const userQuery = normalizeText(payload?.visible?.user_query);
  const workspaceContext = normalizeText(payload?.visible?.workspace_context);
  const patientContext = normalizeText(payload?.visible?.patient_context);

  if (!userQuery) {
    throw new Error('Generated case is missing visible.user_query.');
  }
  if (!workspaceContext) {
    throw new Error('Generated case is missing visible.workspace_context.');
  }
  if (!patientContext) {
    throw new Error('Generated case is missing visible.patient_context.');
  }

  assertNoVisibleLeak(payload);
}

function buildCaseRecord({
  index,
  blueprint,
  payload,
  ctcaeChunks,
  protocolChunks,
  generatorProfile,
  generatorResult,
  latencyMs,
  parentCase = null,
}) {
  const caseId = `rag-v2-${String(index + 1).padStart(3, '0')}`;
  const sourceTypes = parentCase ? parentCase.expected.source_types : blueprint.sourceTypes;
  const protocolScopeChunk = protocolChunks[0] || null;
  const isCacheFollowUp = blueprint.expectedRoute === 'reuse_cache' && parentCase;
  const parentProtocolScope = parentCase?.protocol_scope || null;
  const effectiveCtcaeGold = parentCase ? parentCase.gold.ctcae : ctcaeChunks.map(chunkGoldEntry);
  const effectiveProtocolGold = parentCase ? parentCase.gold.protocol : protocolChunks.map(chunkGoldEntry);
  const scenarioId = isCacheFollowUp
    ? parentCase.scenario_id
    : `rag-v2-scenario-${String(index + 1).padStart(3, '0')}`;

  return {
    case_id: caseId,
    scenario_id: scenarioId,
    turn_index: isCacheFollowUp ? 2 : 1,
    task_type: normalizeText(payload.task_type) || blueprint.taskType,
    difficulty: normalizeText(payload.difficulty) || blueprint.difficulty,
    risk_level: normalizeText(payload.risk_level) || blueprint.difficulty,
    clinical_focus: normalizeText(payload.clinical_focus) || blueprint.taskType,
    visible: {
      user_query: normalizeText(payload.visible.user_query),
      workspace_context: normalizeText(payload.visible.workspace_context),
      patient_context: normalizeText(payload.visible.patient_context),
      history_messages: isCacheFollowUp
        ? [
            {
              role: 'user',
              text: parentCase.visible.user_query,
            },
            {
              role: 'model',
              text:
                `Prior grounded response placeholder for ${parentCase.clinical_focus || parentCase.task_type}. ` +
                `Use the same retrieved evidence if the CRC asks a short follow-up.`,
            },
          ]
        : [],
    },
    expected: {
      route: blueprint.expectedRoute,
      source_types: sourceTypes,
      requires_citation: blueprint.requiresCitation,
    },
    gold: {
      ctcae: effectiveCtcaeGold,
      protocol: effectiveProtocolGold,
    },
    protocol_scope: parentProtocolScope || (protocolScopeChunk
      ? {
          protocol_id: protocolScopeChunk.protocol_id,
          protocol_name: protocolScopeChunk.protocol_name || protocolScopeChunk.title,
          document_id: protocolScopeChunk.document_id,
          title: protocolScopeChunk.title,
        }
      : null),
    generation: {
      source_chunk_ids: parentCase
        ? parentCase.generation.source_chunk_ids
        : [...ctcaeChunks, ...protocolChunks].map((chunk) => chunk.id),
      latency_ms: latencyMs,
      generator_profile: generatorProfile.id,
      generator_provider: generatorProfile.providerLabel || generatorProfile.provider,
      generator_model: generatorProfile.model,
      usage: generatorResult.usage || null,
      estimated_cost: Number(generatorResult.estimatedCost) || 0,
      parent_case_id: parentCase?.case_id || null,
    },
    notes: normalizeText(payload.notes),
  };
}

async function fetchAllRows(supabase, sourceType) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('guidance_documents')
      .select(
        'id,source_type,document_id,protocol_id,protocol_name,title,storage_bucket,storage_path,page,chunk_index,content,metadata'
      )
      .eq('source_type', sourceType)
      .order('document_id', { ascending: true })
      .order('chunk_index', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load ${sourceType} guidance chunks: ${error.message}`);
    }

    rows.push(...(data || []).map(normalizeChunk));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows.filter((row) => row.content && Number.isFinite(row.chunk_index));
}

function matchesProtocolTitle(chunk, protocolTitle) {
  const needle = normalizeText(protocolTitle).toLowerCase();
  if (!needle) return true;

  return [
    chunk.title,
    chunk.document_id,
    chunk.protocol_id,
    chunk.protocol_name,
    chunk.storage_path,
    chunk.metadata?.source_label,
    chunk.metadata?.title,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function resolveSupabaseClient() {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey =
    normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY) || normalizeText(process.env.SUPABASE_ANON_KEY);

  if (!supabaseKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function generateCase({
  caseIndex,
  blueprint,
  ctcaeChunks,
  protocolChunks,
  generatorProfile,
  generatorProfileId,
  perCaseTimeoutMs,
  stream,
  parentCase = null,
}) {
  const start = performance.now();
  const generatorResult = await runTask({
    task: 'guidance_case_generation',
    profileId: generatorProfileId,
    payload: {
      systemPrompt: GENERATOR_SYSTEM_PROMPT,
      userMessage: buildGeneratorUserPrompt({
        blueprint,
        ctcaeChunks,
        protocolChunks,
        caseNumber: caseIndex + 1,
        parentCase,
      }),
      timeoutMs: perCaseTimeoutMs,
      stream,
      streamLog: stream,
    },
  });
  const latencyMs = Number((performance.now() - start).toFixed(2));

  if (latencyMs > perCaseTimeoutMs) {
    throw new Error(`Case ${caseIndex + 1} exceeded per-case timeout (${latencyMs}ms > ${perCaseTimeoutMs}ms).`);
  }

  const payload = parseJsonResponse(generatorResult.text);
  const coercedPayload = coerceGeneratedPayload(payload, blueprint);
  validateGeneratedPayload(coercedPayload);

  return buildCaseRecord({
    index: caseIndex,
    blueprint,
    payload: coercedPayload,
    ctcaeChunks,
    protocolChunks,
    generatorProfile,
    generatorResult,
    latencyMs,
    parentCase,
  });
}

async function generateCaseBatch({
  items,
  generatorProfile,
  generatorProfileId,
  perCaseTimeoutMs,
  batchTimeoutMs,
  stream,
  droppedCases,
}) {
  const start = performance.now();
  const generatorResult = await runTask({
    task: 'guidance_case_generation',
    profileId: generatorProfileId,
    payload: {
      systemPrompt: GENERATOR_SYSTEM_PROMPT,
      userMessage: buildBatchGeneratorUserPrompt({ items }),
      timeoutMs: batchTimeoutMs,
      stream,
      streamLog: stream,
    },
  });
  const batchLatencyMs = Number((performance.now() - start).toFixed(2));

  if (batchLatencyMs > batchTimeoutMs) {
    throw new Error(`Batch exceeded timeout (${batchLatencyMs}ms > ${batchTimeoutMs}ms).`);
  }

  const parsed = parseJsonResponse(generatorResult.text);
  const payloads = Array.isArray(parsed?.cases) ? parsed.cases : Array.isArray(parsed) ? parsed : [];

  if (payloads.length !== items.length) {
    console.warn(`[generate] batch returned ${payloads.length} cases for ${items.length} requested specs; missing cases will be dropped.`);
  }

  const perCaseLatencyMs = Number((batchLatencyMs / items.length).toFixed(2));
  const caseRecords = [];
  const itemCount = Math.min(payloads.length, items.length);

  for (let offset = 0; offset < itemCount; offset += 1) {
    const payload = payloads[offset];
    const item = items[offset];

    try {
      const coercedPayload = coerceGeneratedPayload(payload, item.blueprint);
      const expectedCaseNumber = item.caseIndex + 1;
      const returnedCaseNumber = Number(coercedPayload?.case_number);

      if (Number.isFinite(returnedCaseNumber) && returnedCaseNumber !== expectedCaseNumber) {
        console.warn(
          `[generate] case ${expectedCaseNumber} returned case_number ${returnedCaseNumber}; using batch order.`
        );
      }

      validateGeneratedPayload(coercedPayload);

      caseRecords.push(buildCaseRecord({
        index: item.caseIndex,
        blueprint: item.blueprint,
        payload: coercedPayload,
        ctcaeChunks: item.ctcaeChunks,
        protocolChunks: item.protocolChunks,
        generatorProfile,
        generatorResult,
        latencyMs: perCaseLatencyMs,
        parentCase: item.parentCase,
      }));
    } catch (error) {
      const dropped = {
        case_number: item.caseIndex + 1,
        task_type: item.blueprint.taskType,
        reason: normalizeText(error?.message || error),
      };
      droppedCases.push(dropped);
      console.warn(`[generate] dropping case ${dropped.case_number}: ${dropped.reason}`);
    }
  }

  for (let offset = itemCount; offset < items.length; offset += 1) {
    const item = items[offset];
    const dropped = {
      case_number: item.caseIndex + 1,
      task_type: item.blueprint.taskType,
      reason: 'Generator did not return a payload for this case.',
    };
    droppedCases.push(dropped);
    console.warn(`[generate] dropping case ${dropped.case_number}: ${dropped.reason}`);
  }

  return caseRecords;
}

async function writeJsonAtomically(outPath, payload) {
  if (await pathExists(outPath)) {
    throw new Error(`Output file already exists: ${outPath}`);
  }

  await mkdir(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tempPath, outPath);
}

async function main() {
  const count = Math.max(1, getNumericArg('--count', DEFAULT_COUNT));
  const outPath = resolve(process.cwd(), getArg('--out', DEFAULT_OUT));
  const protocolTitle = getArg('--protocol-title', DEFAULT_PROTOCOL_TITLE);
  const generatorProfileId = getArg('--generator-profile', 'siliconflow-case-generator');
  const seed = getNumericArg('--seed', DEFAULT_SEED);
  const perCaseTimeoutMs = Math.max(1, getNumericArg('--per-case-timeout-ms', DEFAULT_PER_CASE_TIMEOUT_MS));
  const batchSize = Math.max(1, getNumericArg('--batch-size', DEFAULT_BATCH_SIZE));
  const configuredBatchTimeoutMs = getNumericArg('--batch-timeout-ms', 0);
  const stream = !hasArg('--disable-stream');
  const ctcaeChunksPerCase = Math.max(0, getNumericArg('--ctcae-chunks-per-case', DEFAULT_CHUNKS_PER_CASE));
  const protocolChunksPerCase = Math.max(0, getNumericArg('--protocol-chunks-per-case', DEFAULT_CHUNKS_PER_CASE));

  if (await pathExists(outPath)) {
    throw new Error(`Output file already exists: ${outPath}`);
  }

  const generatorProfile = resolveRuntimeProfile({
    task: 'guidance_case_generation',
    profileId: generatorProfileId,
  });
  const supabase = resolveSupabaseClient();
  const random = createSeededRandom(seed);

  console.log('[generate] loading guidance chunk pools...');
  const [ctcaePool, allProtocolRows] = await Promise.all([
    fetchAllRows(supabase, 'ctcae'),
    fetchAllRows(supabase, 'protocol'),
  ]);
  const protocolPool = allProtocolRows.filter((chunk) => matchesProtocolTitle(chunk, protocolTitle));

  if (!ctcaePool.length) {
    throw new Error('No CTCAE guidance chunks were found.');
  }
  if (!protocolPool.length) {
    throw new Error(`No protocol guidance chunks matched "${protocolTitle}".`);
  }

  const protocolScope = protocolPool[0];
  const cases = [];
  const droppedCases = [];
  const blueprints = buildBlueprintSequence(count);

  for (let startIndex = 0; startIndex < blueprints.length; startIndex += batchSize) {
    const batchItems = [];
    const endIndex = Math.min(startIndex + batchSize, blueprints.length);

    for (let index = startIndex; index < endIndex; index += 1) {
      const blueprint = blueprints[index];
      const parentCase =
        Number.isFinite(blueprint.parentBlueprintIndex) && cases[blueprint.parentBlueprintIndex]
          ? cases[blueprint.parentBlueprintIndex]
          : null;
      const effectiveSourceTypes = parentCase ? parentCase.expected.source_types : blueprint.sourceTypes;
      const ctcaeChunks = !parentCase && effectiveSourceTypes.includes('ctcae')
        ? sampleWithoutReplacement(ctcaePool, ctcaeChunksPerCase, random)
        : [];
      const protocolChunks = !parentCase && effectiveSourceTypes.includes('protocol')
        ? sampleWithoutReplacement(protocolPool, protocolChunksPerCase, random)
        : [];

      if (!parentCase && effectiveSourceTypes.includes('ctcae') && !ctcaeChunks.length) {
        throw new Error(`Case ${index + 1} requires CTCAE chunks, but none were selected.`);
      }
      if (!parentCase && effectiveSourceTypes.includes('protocol') && !protocolChunks.length) {
        throw new Error(`Case ${index + 1} requires protocol chunks, but none were selected.`);
      }
      if (blueprint.expectedRoute === 'reuse_cache' && !parentCase) {
        const dropped = {
          case_number: index + 1,
          task_type: blueprint.taskType,
          reason: 'Cache follow-up parent case was not generated.',
        };
        droppedCases.push(dropped);
        console.warn(`[generate] dropping case ${dropped.case_number}: ${dropped.reason}`);
        continue;
      }

      batchItems.push({
        caseIndex: index,
        caseNumber: index + 1,
        blueprint,
        ctcaeChunks,
        protocolChunks,
        parentCase,
        effectiveSourceTypes,
      });
    }

    const batchTimeoutMs =
      configuredBatchTimeoutMs > 0 ? configuredBatchTimeoutMs : perCaseTimeoutMs * batchItems.length;
    const batchLabel = `${startIndex + 1}-${endIndex}/${count}`;
    const taskSummary = batchItems
      .map((item) => `${item.caseNumber}:${item.blueprint.taskType}(${item.effectiveSourceTypes.join('+') || 'none'})`)
      .join(', ');

    console.log(
      `[generate] batch ${batchLabel} size=${batchItems.length} timeout=${batchTimeoutMs}ms :: ${taskSummary}`
    );

    const batchCases = await generateCaseBatch({
      items: batchItems,
      generatorProfile,
      generatorProfileId,
      perCaseTimeoutMs,
      batchTimeoutMs,
      stream,
      droppedCases,
    });
    cases.push(...batchCases);
  }

  const dataset = {
    caseset_id: 'crc-guidance-rag-v2-type1diabetes',
    description:
      'Generated CRC guidance RAG v2 cases with hidden CTCAE/protocol chunk-index gold vectors.',
    version: 2,
    source_protocol: {
      requested_title: protocolTitle,
      matched_document_id: protocolScope.document_id,
      matched_protocol_id: protocolScope.protocol_id,
      matched_protocol_name: protocolScope.protocol_name,
      matched_title: protocolScope.title,
      matched_storage_path: protocolScope.storage_path,
      protocol_chunk_pool_size: protocolPool.length,
      ctcae_chunk_pool_size: ctcaePool.length,
    },
    generation: {
      created_at: new Date().toISOString(),
      seed,
      requested_count: count,
      generated_count: cases.length,
      dropped_count: droppedCases.length,
      dropped_cases: droppedCases,
      generator_profile: generatorProfile.id,
      generator_provider: generatorProfile.providerLabel || generatorProfile.provider,
      generator_model: generatorProfile.model,
      per_case_timeout_ms: perCaseTimeoutMs,
      batch_size: batchSize,
      batch_timeout_ms: configuredBatchTimeoutMs || null,
      stream,
      ctcae_chunks_per_case: ctcaeChunksPerCase,
      protocol_chunks_per_case: protocolChunksPerCase,
    },
    cases,
  };

  await writeJsonAtomically(outPath, dataset);
  console.log(
    JSON.stringify(
      {
        out: outPath,
        cases: cases.length,
        generatorProfile: generatorProfile.id,
        generatorModel: generatorProfile.model,
        protocolPoolSize: protocolPool.length,
        ctcaePoolSize: ctcaePool.length,
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
