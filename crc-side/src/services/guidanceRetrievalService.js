import { callFunctionHttp } from './firebaseFunctionHttp';

const DEFAULT_CTCAE_MATCH_COUNT = 3;

function normalizeGuidanceRows(rows = [], sourceTypeFallback = null) {
  return rows.map((entry) => {
    const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
    return {
      ...entry,
      source_type: entry.source_type || sourceTypeFallback || metadata.source_type || null,
      page: entry.page || metadata.page || 'Unknown',
      metadata,
    };
  });
}

export async function retrieveGuidanceContext({
  queryText,
  protocolId = null,
  protocolName = null,
  ctcaeMatchCount = DEFAULT_CTCAE_MATCH_COUNT,
  protocolMatchCount = 0,
} = {}) {
  const normalizedQuery = String(queryText || '').trim();
  if (!normalizedQuery) {
    return { ctcaeChunks: [], protocolChunks: [] };
  }

  const response = await callFunctionHttp(
    'retrieveGuidanceContextHttp',
    {
      queryText: normalizedQuery,
      protocolId,
      protocolName,
      ctcaeMatchCount,
      protocolMatchCount,
    },
    { timeoutMs: 45000 }
  );

  return {
    ctcaeChunks: normalizeGuidanceRows(response?.ctcaeChunks || [], 'ctcae'),
    protocolChunks: normalizeGuidanceRows(response?.protocolChunks || [], 'protocol'),
  };
}

export async function retrieveCtcaeChunks(queryText, matchCount = DEFAULT_CTCAE_MATCH_COUNT) {
  const { ctcaeChunks } = await retrieveGuidanceContext({
    queryText,
    ctcaeMatchCount: matchCount,
    protocolMatchCount: 0,
  });
  return ctcaeChunks;
}
