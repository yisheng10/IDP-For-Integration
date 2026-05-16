import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
import type { ServiceClient } from './eproShared.ts';

const GEMINI_KEY_REGISTRY_TABLE = 'gemini_key_registry';
const GEMINI_KEY_CACHE_TTL_MS = 60_000;
const GEMINI_KEY_LOW_CAPACITY_THRESHOLD = 3;
const KUALA_LUMPUR_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

type GeminiRegistryEntry = {
  id: number;
  label: string;
  ownerName: string;
  ownerContact: string | null;
  apiKey: string;
  status: 'active' | 'reached_limit' | 'disabled';
  disabledReason: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  failureCount: number;
  lastUsedAt: string | null;
  lastFailedAt: string | null;
  unavailableUntil: string | null;
};

type GeminiFailureClassification = {
  outcome: 'disable' | 'reached_limit' | 'soft_failure' | 'fatal';
  disabledReason: 'leaked' | 'invalid' | 'permission_denied' | null;
  errorCode: string;
  shouldTryNextKey: boolean;
};

let geminiKeyRegistryCache: {
  loadedAt: number;
  entries: GeminiRegistryEntry[];
} = {
  loadedAt: 0,
  entries: [],
};

export class GeminiKeyRegistryRuntimeError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GeminiKeyRegistryRuntimeError';
    this.code = code;
  }
}

function toIsoStringOrNull(value: unknown) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeRegistryEntry(row: Record<string, unknown>): GeminiRegistryEntry {
  return {
    id: Number(row.id) || 0,
    label: String(row.label || '').trim() || `key-${String(row.id || '').trim() || 'unknown'}`,
    ownerName: String(row.owner_name || '').trim() || 'Unknown owner',
    ownerContact: String(row.owner_contact || '').trim() || null,
    apiKey: String(row.api_key || '').trim(),
    status: (String(row.status || 'active').trim().toLowerCase() || 'active') as GeminiRegistryEntry['status'],
    disabledReason: String(row.disabled_reason || '').trim().toLowerCase() || null,
    lastErrorCode: String(row.last_error_code || '').trim() || null,
    lastErrorMessage: String(row.last_error_message || '').trim() || null,
    failureCount: Number(row.failure_count) || 0,
    lastUsedAt: toIsoStringOrNull(row.last_used_at),
    lastFailedAt: toIsoStringOrNull(row.last_failed_at),
    unavailableUntil: toIsoStringOrNull(row.unavailable_until),
  };
}

function compareEntriesByRecency(left: GeminiRegistryEntry, right: GeminiRegistryEntry) {
  const leftTimestamp = left.lastUsedAt ? Date.parse(left.lastUsedAt) : Number.NEGATIVE_INFINITY;
  const rightTimestamp = right.lastUsedAt ? Date.parse(right.lastUsedAt) : Number.NEGATIVE_INFINITY;

  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  return left.id - right.id;
}

function computeNextKualaLumpurResetIso(now = new Date()) {
  const klNow = new Date(now.getTime() + KUALA_LUMPUR_UTC_OFFSET_MS);
  const nextResetUtcMs =
    Date.UTC(
      klNow.getUTCFullYear(),
      klNow.getUTCMonth(),
      klNow.getUTCDate() + 1,
      0,
      5,
      0,
      0
    ) - KUALA_LUMPUR_UTC_OFFSET_MS;

  return new Date(nextResetUtcMs).toISOString();
}

function isRetryEligibleReachedLimit(entry: GeminiRegistryEntry, now = new Date()) {
  if (entry.status !== 'reached_limit') {
    return false;
  }

  if (!entry.unavailableUntil) {
    return true;
  }

  const unavailableTimestamp = Date.parse(entry.unavailableUntil);
  if (!Number.isFinite(unavailableTimestamp)) {
    return true;
  }

  return unavailableTimestamp <= now.getTime();
}

function isRotationCandidate(entry: GeminiRegistryEntry, now = new Date()) {
  if (!entry.apiKey) {
    return false;
  }

  if (entry.status === 'active') {
    return true;
  }

  return isRetryEligibleReachedLimit(entry, now);
}

function classifyGeminiFailure(error: unknown): GeminiFailureClassification {
  const message = String((error as Error)?.message || error || '').trim();
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('api key invalid') ||
    lowerMessage.includes('api_key_invalid') ||
    lowerMessage.includes('api key expired') ||
    lowerMessage.includes('invalid api key')
  ) {
    return {
      outcome: 'disable',
      disabledReason: 'invalid',
      errorCode: 'api_key_invalid',
      shouldTryNextKey: true,
    };
  }

  if (lowerMessage.includes('leaked')) {
    return {
      outcome: 'disable',
      disabledReason: 'leaked',
      errorCode: 'api_key_leaked',
      shouldTryNextKey: true,
    };
  }

  if (
    lowerMessage.includes('permission denied') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('api key not valid') ||
    lowerMessage.includes('api has not been used')
  ) {
    return {
      outcome: 'disable',
      disabledReason: 'permission_denied',
      errorCode: 'permission_denied',
      shouldTryNextKey: true,
    };
  }

  if (
    lowerMessage.includes('429') ||
    lowerMessage.includes('quota') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('resource exhausted')
  ) {
    return {
      outcome: 'reached_limit',
      disabledReason: null,
      errorCode: 'quota_exceeded',
      shouldTryNextKey: true,
    };
  }

  if (
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('temporarily unavailable') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('deadline exceeded') ||
    lowerMessage.includes('503')
  ) {
    return {
      outcome: 'soft_failure',
      disabledReason: null,
      errorCode: 'transient_unavailable',
      shouldTryNextKey: true,
    };
  }

  return {
    outcome: 'fatal',
    disabledReason: null,
    errorCode: 'fatal_error',
    shouldTryNextKey: false,
  };
}

async function fetchGeminiKeyRegistryEntries(client: ServiceClient) {
  const { data, error } = await client
    .from(GEMINI_KEY_REGISTRY_TABLE)
    .select(
      'id,label,owner_name,owner_contact,api_key,status,disabled_reason,last_error_code,last_error_message,failure_count,last_used_at,last_failed_at,unavailable_until'
    )
    .order('id', { ascending: true });

  if (error) {
    throw new GeminiKeyRegistryRuntimeError(
      'gemini_key_registry_unavailable',
      `Gemini key registry could not be loaded from Supabase: ${error.message}`
    );
  }

  return Array.isArray(data)
    ? (data as Array<Record<string, unknown>>).map(normalizeRegistryEntry)
    : [];
}

async function loadGeminiKeyRegistry(
  client: ServiceClient,
  { forceRefresh = false, runtimeLabel = 'supabase-epro' } = {}
) {
  const now = Date.now();
  if (!forceRefresh && now - geminiKeyRegistryCache.loadedAt < GEMINI_KEY_CACHE_TTL_MS) {
    return geminiKeyRegistryCache.entries;
  }

  const entries = await fetchGeminiKeyRegistryEntries(client);
  geminiKeyRegistryCache = {
    loadedAt: now,
    entries,
  };

  const activeCount = entries.filter((entry) => entry.status === 'active').length;
  if (activeCount < GEMINI_KEY_LOW_CAPACITY_THRESHOLD) {
    console.warn(`[${runtimeLabel}] Gemini key pool is running low.`, {
      activeCount,
      totalEntries: entries.length,
      activeLabels: entries
        .filter((entry) => entry.status === 'active')
        .map((entry) => `${entry.label} (${entry.ownerName})`),
    });
  }

  return entries;
}

function invalidateGeminiKeyRegistryCache() {
  geminiKeyRegistryCache = {
    loadedAt: 0,
    entries: [],
  };
}

async function updateGeminiKeyRegistryEntry(client: ServiceClient, entryId: number, patch: Record<string, unknown>) {
  const payload = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from(GEMINI_KEY_REGISTRY_TABLE).update(payload).eq('id', entryId);
  if (error) {
    console.warn('Failed to update Gemini key registry entry:', {
      entryId,
      patch,
      error: error.message,
    });
  }

  invalidateGeminiKeyRegistryCache();
}

async function recordKeySuccess(client: ServiceClient, entry: GeminiRegistryEntry) {
  await updateGeminiKeyRegistryEntry(client, entry.id, {
    status: 'active',
    disabled_reason: null,
    unavailable_until: null,
    last_used_at: new Date().toISOString(),
    last_error_code: null,
    last_error_message: null,
  });
}

async function recordKeyFailure(
  client: ServiceClient,
  entry: GeminiRegistryEntry,
  classification: GeminiFailureClassification,
  error: unknown
) {
  const timestamp = new Date().toISOString();
  const nextFailureCount = (entry.failureCount || 0) + 1;
  const errorMessage = String((error as Error)?.message || error || '').slice(0, 1000);

  if (classification.outcome === 'disable') {
    await updateGeminiKeyRegistryEntry(client, entry.id, {
      status: 'disabled',
      disabled_reason: classification.disabledReason,
      failure_count: nextFailureCount,
      last_failed_at: timestamp,
      last_error_code: classification.errorCode,
      last_error_message: errorMessage,
    });
    return;
  }

  if (classification.outcome === 'reached_limit') {
    await updateGeminiKeyRegistryEntry(client, entry.id, {
      status: 'reached_limit',
      disabled_reason: null,
      unavailable_until: computeNextKualaLumpurResetIso(),
      failure_count: nextFailureCount,
      last_failed_at: timestamp,
      last_error_code: classification.errorCode,
      last_error_message: errorMessage,
    });
    return;
  }

  if (classification.outcome === 'soft_failure') {
    await updateGeminiKeyRegistryEntry(client, entry.id, {
      failure_count: nextFailureCount,
      last_failed_at: timestamp,
      last_error_code: classification.errorCode,
      last_error_message: errorMessage,
    });
  }
}

export async function runGeminiWithKeyPool({
  client,
  modelName,
  modelOptions = {},
  runtimeLabel = 'supabase-epro',
  actionLabel = 'Gemini request',
  task,
}: {
  client: ServiceClient;
  modelName: string;
  modelOptions?: Record<string, unknown>;
  runtimeLabel?: string;
  actionLabel?: string;
  task: (payload: {
    client: GoogleGenerativeAI;
    model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
    keyRecord: GeminiRegistryEntry;
  }) => Promise<unknown>;
}) {
  const entries = await loadGeminiKeyRegistry(client, { runtimeLabel });
  if (!entries.length) {
    throw new GeminiKeyRegistryRuntimeError(
      'gemini_key_registry_empty',
      'Gemini key registry is empty. Add active keys in Supabase before using this runtime.'
    );
  }

  const candidates = entries
    .filter((entry) => isRotationCandidate(entry))
    .sort(compareEntriesByRecency);

  if (!candidates.length) {
    throw new GeminiKeyRegistryRuntimeError(
      'gemini_key_pool_exhausted',
      'No Gemini API keys are currently available. All keys are disabled or cooling down in the shared registry.'
    );
  }

  let lastError: unknown = null;

  for (const entry of candidates) {
    const genAI = new GoogleGenerativeAI(entry.apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      ...modelOptions,
    });

    try {
      const result = await task({ client: genAI, model, keyRecord: entry });
      await recordKeySuccess(client, entry);
      return result;
    } catch (error) {
      lastError = error;
      const classification = classifyGeminiFailure(error);

      if (classification.outcome !== 'fatal') {
        await recordKeyFailure(client, entry, classification, error);
        console.warn(`[${runtimeLabel}] Gemini key failed; rotating to next key if available.`, {
          actionLabel,
          keyLabel: entry.label,
          ownerName: entry.ownerName,
          disabledReason: classification.disabledReason,
          errorCode: classification.errorCode,
        });
      }

      if (classification.shouldTryNextKey) {
        continue;
      }

      throw error;
    }
  }

  const finalMessage = String((lastError as Error)?.message || 'No Gemini API keys are currently available.');
  throw new GeminiKeyRegistryRuntimeError(
    'gemini_key_pool_exhausted',
    `${actionLabel} failed after exhausting the shared Gemini key pool: ${finalMessage}`
  );
}
