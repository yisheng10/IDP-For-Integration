import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

const DEFAULT_GUIDANCE_MODEL = 'Qwen/Qwen3.5-27B';
const DEFAULT_EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B';
const DEFAULT_SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const DEFAULT_GUIDANCE_TIMEOUT_MS = 120000;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 20000;
const DEFAULT_EMBEDDING_DIMENSIONS = 4096;
const DEFAULT_CTCAE_DOCUMENT_ID = 'ctcae-v5.0';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function requireEnv(name) {
  const value = normalizeText(process.env[name]);
  if (!value) {
    throw new HttpsError('failed-precondition', `${name} is not configured on the server.`);
  }
  return value;
}

function requireHeaderSafeEnv(name) {
  const value = requireEnv(name);
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 255) {
      throw new HttpsError(
        'failed-precondition',
        `${name} contains non-ASCII characters. Check the configured API key.`
      );
    }
  }
  return value;
}

function buildAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function getSiliconFlowBaseUrl() {
  return (
    normalizeText(process.env.SILICONFLOW_BASE_URL) || DEFAULT_SILICONFLOW_BASE_URL
  ).replace(/\/+$/, '');
}

function getGuidanceModel() {
  return normalizeText(process.env.SILICONFLOW_SIDE_EFFECT_GUIDANCE_MODEL) || DEFAULT_GUIDANCE_MODEL;
}

function getEmbeddingModel() {
  return normalizeText(process.env.SILICONFLOW_EMBEDDING_MODEL) || DEFAULT_EMBEDDING_MODEL;
}

function parseHttpJsonBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new HttpsError('invalid-argument', 'Request body must be valid JSON.');
    }
  }
  if (typeof req.body === 'object') return req.body;
  throw new HttpsError('invalid-argument', 'Request body must be valid JSON.');
}

function decodeJwtPayloadUnsafe(idToken = '') {
  const payloadPart = String(idToken || '').split('.')[1] || '';
  if (!payloadPart) return null;

  try {
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function isFunctionsEmulatorRuntime() {
  return String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
}

function httpsErrorToStatusCode(code = 'internal') {
  switch (String(code || '').toLowerCase()) {
    case 'invalid-argument':
      return 400;
    case 'unauthenticated':
      return 401;
    case 'permission-denied':
      return 403;
    case 'not-found':
      return 404;
    case 'resource-exhausted':
      return 429;
    case 'failed-precondition':
      return 412;
    case 'unavailable':
      return 503;
    case 'deadline-exceeded':
      return 504;
    default:
      return 500;
  }
}

function toCallableModelError(error, action = 'AI request') {
  if (error instanceof HttpsError) return error;

  const message = normalizeText(error?.message || error || '');
  const lowerMessage = message.toLowerCase();
  const status = Number(error?.status || error?.httpStatus) || 0;

  if (
    lowerMessage.includes('api key') ||
    lowerMessage.includes('permission denied') ||
    lowerMessage.includes('model not found') ||
    lowerMessage.includes('unsupported model')
  ) {
    return new HttpsError('failed-precondition', `${action} failed: ${message}`);
  }

  if (status === 429 || lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
    return new HttpsError('resource-exhausted', `${action} failed: ${message}`);
  }

  if (status === 408 || lowerMessage.includes('timed out') || lowerMessage.includes('timeout')) {
    return new HttpsError('deadline-exceeded', `${action} timed out: ${message}`);
  }

  if (status >= 500 || lowerMessage.includes('service unavailable')) {
    return new HttpsError('unavailable', `${action} failed: ${message}`);
  }

  return new HttpsError('internal', `${action} failed: ${message || 'Unknown provider error.'}`);
}

function sendHttpJsonError(res, error, action = 'Request') {
  const normalizedError = error instanceof HttpsError ? error : toCallableModelError(error, action);
  res.status(httpsErrorToStatusCode(normalizedError.code)).json({
    error: {
      status: normalizedError.code,
      message: normalizedError.message,
    },
  });
}

async function assertAuthenticatedHttpRequest(req) {
  const authorizationHeader = normalizeText(req.get('authorization'));
  if (!authorizationHeader.toLowerCase().startsWith('bearer ')) {
    throw new HttpsError('unauthenticated', 'Sign in before using guidance services.');
  }

  const idToken = authorizationHeader.slice(7).trim();
  if (!idToken) {
    throw new HttpsError('unauthenticated', 'Sign in before using guidance services.');
  }

  try {
    if (isFunctionsEmulatorRuntime()) {
      const decodedToken = decodeJwtPayloadUnsafe(idToken);
      const uid = normalizeText(decodedToken?.user_id || decodedToken?.sub || decodedToken?.uid);
      if (uid) {
        return { uid, token: decodedToken };
      }
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return { uid: decodedToken.uid, token: decodedToken };
  } catch {
    throw new HttpsError('unauthenticated', 'Sign in before using guidance services.');
  }
}

async function handleAuthedJsonRequest(req, res, handler, action = 'Request') {
  if (req.method !== 'POST') {
    res.status(405).json({
      error: {
        status: 'method-not-allowed',
        message: 'Only POST requests are supported.',
      },
    });
    return;
  }

  try {
    await assertAuthenticatedHttpRequest(req);
    const payload = parseHttpJsonBody(req);
    const result = await handler(payload);
    res.status(200).json({ result });
  } catch (error) {
    console.error(`${action} failed:`, error);
    sendHttpJsonError(res, error, action);
  }
}

function buildChatMessages({ systemPrompt = '', messages = [], userMessage = '' }) {
  const chatMessages = [];
  const safeSystemPrompt = normalizeText(systemPrompt);
  if (safeSystemPrompt) {
    chatMessages.push({ role: 'system', content: safeSystemPrompt });
  }

  for (const message of Array.isArray(messages) ? messages.slice(-12) : []) {
    const content = normalizeText(message?.content || message?.text);
    if (!content) continue;
    chatMessages.push({
      role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user',
      content,
    });
  }

  const safeUserMessage = normalizeText(userMessage);
  if (safeUserMessage) {
    chatMessages.push({ role: 'user', content: safeUserMessage });
  }

  return chatMessages;
}

function extractChatText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return normalizeText(content);
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return String(part.text || '');
      return '';
    })
    .join('\n')
    .trim();
}

function normalizeOpenAiUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: Number(usage.prompt_tokens) || 0,
    candidatesTokenCount: Number(usage.completion_tokens) || 0,
    totalTokenCount: Number(usage.total_tokens) || 0,
  };
}

async function requestSiliconFlowChat(payload = {}) {
  const timeoutMs = readNumberEnv('SILICONFLOW_SIDE_EFFECT_GUIDANCE_TIMEOUT_MS', DEFAULT_GUIDANCE_TIMEOUT_MS);
  const timeout = buildAbortSignal(timeoutMs);
  const model = getGuidanceModel();
  const messages = buildChatMessages(payload);

  if (!messages.length) {
    throw new HttpsError('invalid-argument', 'userMessage is required.');
  }

  const body = {
    model,
    messages,
    temperature: Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.35,
    top_p: Number.isFinite(Number(payload.topP)) ? Number(payload.topP) : 0.9,
  };

  if (payload.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(`${getSiliconFlowBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireHeaderSafeEnv('SILICONFLOW_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });

    const responseText = await response.text();
    let parsed = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const errorMessage =
        parsed?.error?.message ||
        parsed?.message ||
        responseText ||
        `${response.status} ${response.statusText}`;
      const error = new Error(`SiliconFlow request failed: ${errorMessage}`);
      error.status = response.status;
      throw error;
    }

    const text = extractChatText(parsed?.choices?.[0]?.message?.content);
    if (!text) {
      throw new Error('SiliconFlow returned an empty response.');
    }

    return {
      text,
      provider: 'siliconflow',
      model,
      usage: normalizeOpenAiUsage(parsed?.usage),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `SiliconFlow request timed out after ${timeoutMs}ms for model "${model}".`
      );
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

async function requestSiliconFlowEmbedding(inputText) {
  const input = normalizeText(inputText);
  if (!input) return [];

  const timeoutMs = readNumberEnv('SILICONFLOW_EMBEDDING_TIMEOUT_MS', DEFAULT_EMBEDDING_TIMEOUT_MS);
  const dimensions = readNumberEnv('SILICONFLOW_EMBEDDING_DIMENSIONS', DEFAULT_EMBEDDING_DIMENSIONS);
  const model = getEmbeddingModel();
  const timeout = buildAbortSignal(timeoutMs);

  try {
    const response = await fetch(`${getSiliconFlowBaseUrl()}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireHeaderSafeEnv('SILICONFLOW_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [input],
        encoding_format: 'float',
        dimensions,
      }),
      signal: timeout.signal,
    });

    const responseText = await response.text();
    let parsed = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const errorMessage =
        parsed?.error?.message ||
        parsed?.message ||
        responseText ||
        `${response.status} ${response.statusText}`;
      const error = new Error(`SiliconFlow embeddings request failed: ${errorMessage}`);
      error.status = response.status;
      throw error;
    }

    const embedding = parsed?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('SiliconFlow embeddings request returned an invalid response payload.');
    }
    return embedding;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `SiliconFlow embeddings request timed out after ${timeoutMs}ms for model "${model}".`
      );
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

function getSupabaseClient() {
  const url = requireEnv('SUPABASE_URL');
  const key = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  if (!key) {
    throw new HttpsError('failed-precondition', 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server.');
  }
  return createClient(url, key);
}

function normalizeGuidanceRows(rows = [], sourceTypeFallback = null) {
  return rows.map((entry) => {
    const metadata = entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {};
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

async function queryGuidanceChunks(queryEmbedding, {
  sourceTypes,
  protocolId,
  protocolName,
  documentId,
  matchCount,
}) {
  if (!queryEmbedding?.length || !matchCount) return [];

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('match_guidance_documents', {
    query_embedding: queryEmbedding,
    _match_count: Math.max(1, Number(matchCount) || 1),
    _source_types: sourceTypes,
    _protocol_id: protocolId || null,
    _protocol_name: protocolName || null,
    _document_id: documentId || null,
  });

  if (error) {
    throw new HttpsError('internal', `Guidance retrieval failed: ${error.message}`);
  }

  return normalizeGuidanceRows(data || [], Array.isArray(sourceTypes) ? sourceTypes[0] : null);
}

async function runSideEffectGuidanceChat(payload = {}) {
  try {
    return await requestSiliconFlowChat(payload);
  } catch (error) {
    throw toCallableModelError(error, 'Guidance generation');
  }
}

async function runRetrieveGuidanceContext(payload = {}) {
  const queryText = normalizeText(payload.queryText);
  if (!queryText) {
    return { ctcaeChunks: [], protocolChunks: [] };
  }

  const ctcaeMatchCount = Math.max(0, Number(payload.ctcaeMatchCount ?? 4) || 0);
  const protocolMatchCount = Math.max(0, Number(payload.protocolMatchCount ?? 0) || 0);
  const protocolId = normalizeText(payload.protocolId) || null;
  const protocolName = normalizeText(payload.protocolName) || null;
  const queryEmbedding = await requestSiliconFlowEmbedding(queryText);

  const [ctcaeChunks, protocolChunks] = await Promise.all([
    ctcaeMatchCount > 0
      ? queryGuidanceChunks(queryEmbedding, {
          sourceTypes: ['ctcae'],
          protocolId: null,
          protocolName: null,
          documentId: DEFAULT_CTCAE_DOCUMENT_ID,
          matchCount: ctcaeMatchCount,
        })
      : Promise.resolve([]),
    protocolMatchCount > 0
      ? queryGuidanceChunks(queryEmbedding, {
          sourceTypes: ['protocol'],
          protocolId,
          protocolName,
          matchCount: protocolMatchCount,
        })
      : Promise.resolve([]),
  ]);

  return { ctcaeChunks, protocolChunks };
}

export const sideEffectGuidanceChatHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 180, memory: '512MiB' },
  async (req, res) => handleAuthedJsonRequest(req, res, runSideEffectGuidanceChat, 'Guidance generation')
);

export const retrieveGuidanceContextHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => handleAuthedJsonRequest(req, res, runRetrieveGuidanceContext, 'Guidance retrieval')
);
