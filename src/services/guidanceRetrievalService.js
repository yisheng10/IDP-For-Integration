import { callFunctionHttp } from './firebaseFunctionHttp';

const DEFAULT_MATCH_COUNT = 4;

function normalizeProtocolLookup(protocolId, protocolName) {
  const normalizedProtocolId = String(protocolId || '').trim() || null;
  const normalizedProtocolName = String(protocolName || '').trim() || null;

  return {
    protocolId: normalizedProtocolId,
    protocolName: normalizedProtocolId ? null : normalizedProtocolName,
  };
}

function mapRetrievalError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').trim();

  if (message.includes('quota') || code.includes('resource-exhausted')) {
    return 'Guidance retrieval failed. Embedding quota or rate limit was reached.';
  }

  if (message.includes('timed out') || code.includes('deadline-exceeded')) {
    return 'Guidance retrieval failed. The retrieval request timed out.';
  }

  if (code.includes('unauthenticated')) {
    return 'Guidance retrieval failed. Sign in again and retry.';
  }

  if (code.includes('permission-denied')) {
    return 'Guidance retrieval failed. This CRC workspace request was denied.';
  }

  if (code.includes('failed-precondition')) {
    return `Guidance retrieval failed. ${message || 'The retrieval service is not configured correctly.'}`;
  }

  if (code.includes('unavailable')) {
    return 'Guidance retrieval failed. The retrieval service is temporarily unavailable.';
  }

  if (message) {
    return `Guidance retrieval failed. ${message}`;
  }

  return 'Guidance retrieval failed.';
}

function normalizeMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return metadata;
}

function normalizeGuidanceRows(rows = [], sourceTypeFallback = null) {
  return rows.map((entry) => {
    const metadata = normalizeMetadata(entry.metadata);
    return {
      ...entry,
      source_type: entry.source_type || sourceTypeFallback || metadata.source_type || null,
      protocol_id: entry.protocol_id || metadata.protocol_id || null,
      protocol_name: entry.protocol_name || metadata.protocol_name || null,
      title: entry.title || metadata.title || null,
      page: entry.page || metadata.page || 'Unknown',
      metadata,
    };
  });
}

function renderChunkLabel(entry, fallbackLabel) {
  const sourceLabel =
    entry.source_type === 'protocol'
      ? entry.protocol_name || entry.title || 'Protocol'
      : fallbackLabel;
  return `[${sourceLabel} Page ${entry.page}]`;
}

export async function retrieveGuidanceContext({
  queryText,
  protocolId = null,
  protocolName = null,
  ctcaeMatchCount = DEFAULT_MATCH_COUNT,
  protocolMatchCount = DEFAULT_MATCH_COUNT,
} = {}) {
  const normalizedQuery = String(queryText || '').trim();
  if (!normalizedQuery) {
    return { ctcaeChunks: [], protocolChunks: [] };
  }

  const normalizedProtocolLookup = normalizeProtocolLookup(protocolId, protocolName);

  try {
    const response = await callFunctionHttp('retrieveGuidanceContextHttp', {
      queryText: normalizedQuery,
      protocolId: normalizedProtocolLookup.protocolId,
      protocolName: normalizedProtocolLookup.protocolName,
      ctcaeMatchCount,
      protocolMatchCount,
    });

    return {
      ctcaeChunks: normalizeGuidanceRows(response?.ctcaeChunks || [], 'ctcae'),
      protocolChunks: normalizeGuidanceRows(response?.protocolChunks || [], 'protocol'),
    };
  } catch (error) {
    console.error('Guidance retrieval failed:', error);
    throw new Error(mapRetrievalError(error));
  }
}

export function buildGuidancePromptNoRetrieval({
  workspaceContext,
  patientContext,
  userText,
  audienceRole = 'crc',
}) {
  const isPatientAudience = audienceRole === 'patient';
  return [
    workspaceContext && !isPatientAudience ? `=== CRC WORKSPACE CONTEXT ===\n${workspaceContext}` : '',
    patientContext
      ? `${isPatientAudience ? '=== PATIENT-FACING CONTEXT ===' : '=== COMPLETE PATIENT CONTEXT ==='}\n${patientContext}`
      : '',
    [
      '=== ANSWER MODE ===',
      'No CTCAE or Protocol excerpts were retrieved for this turn.',
      isPatientAudience
        ? 'Answer only from the directly injected patient-facing context and the existing conversation.'
        : 'Answer only from the directly injected CRC workspace context, patient context, and the existing conversation.',
      'Do not claim CTCAE or Protocol rules, grades, page numbers, or citations in this reply.',
      'Do not make new medical or protocol judgments that require document grounding.',
    ].join('\n'),
    `=== USER QUERY ===\n${String(userText || '').trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildGuidancePromptWithRetrieval({
  workspaceContext,
  patientContext,
  ctcaeChunks = [],
  protocolChunks = [],
  userText,
  audienceRole = 'crc',
}) {
  const isPatientAudience = audienceRole === 'patient';
  return [
    workspaceContext && !isPatientAudience ? `=== CRC WORKSPACE CONTEXT ===\n${workspaceContext}` : '',
    patientContext
      ? `${isPatientAudience ? '=== PATIENT-FACING CONTEXT ===' : '=== COMPLETE PATIENT CONTEXT ==='}\n${patientContext}`
      : '',
    `=== CTCAE RETRIEVED EXCERPTS ===\n${
      ctcaeChunks.length
        ? ctcaeChunks.map((entry) => `${renderChunkLabel(entry, 'CTCAE')}\n${entry.content}`).join('\n\n---\n\n')
        : 'No CTCAE excerpts matched this query.'
    }`,
    `=== PROTOCOL RETRIEVED EXCERPTS ===\n${
      protocolChunks.length
        ? protocolChunks.map((entry) => `${renderChunkLabel(entry, 'Protocol')}\n${entry.content}`).join('\n\n---\n\n')
        : 'No protocol excerpts matched this query.'
    }`,
    `=== USER QUERY ===\n${String(userText || '').trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
