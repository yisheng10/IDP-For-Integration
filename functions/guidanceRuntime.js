import { Buffer } from 'node:buffer';
import admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({
  region: 'us-central1',
  maxInstances: 10,
});

const db = admin.firestore();
const pdfjs = pdfjsLib.default || pdfjsLib;

const GUIDANCE_MODEL = process.env.SIDE_EFFECT_GUIDANCE_MODEL || 'gemini-2.5-flash';
const APPOINTMENT_MODEL = process.env.APPOINTMENT_GUIDANCE_MODEL || 'gemini-2.5-flash';
const ROUTER_MODEL = process.env.GUIDANCE_ROUTER_MODEL || GUIDANCE_MODEL;
const ROUTER_CONFIDENCE_FLOOR = 0.65;
const SILICONFLOW_BASE_URL = String(process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').trim();
const SILICONFLOW_EMBEDDING_MODEL =
  String(process.env.SILICONFLOW_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B').trim();
const SILICONFLOW_EMBEDDING_DIMENSIONS = Number(process.env.SILICONFLOW_EMBEDDING_DIMENSIONS) || 4096;
const DEFAULT_MATCH_COUNT = 4;
const UPSERT_BATCH_SIZE = 20;
const EMBEDDING_BATCH_SIZE = 20;
const GUIDANCE_CHUNK_TARGET = 1000;
const GUIDANCE_CHUNK_MAX = 1200;
const GUIDANCE_CHUNK_OVERLAP = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new HttpsError('failed-precondition', `${name} is not configured on the server.`);
  }
  return value;
}

function getGeminiClient() {
  return new GoogleGenerativeAI(requireEnv('GEMINI_API_KEY'));
}

function getGenerationModel(model, options = {}) {
  return getGeminiClient().getGenerativeModel({
    model,
    ...options,
  });
}

function getSupabaseClient() {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key);
}

function getSiliconFlowApiKey() {
  return requireEnv('SILICONFLOW_API_KEY');
}

function extractRetryDelayMs(error, fallbackMs = 45000) {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }

  const message = String(error?.message || error || '');
  const retryInfoMatch = message.match(/retryDelay":"(\d+)s"/i);
  if (retryInfoMatch) {
    return Number(retryInfoMatch[1]) * 1000;
  }

  const retryInMatch = message.match(/retry in\s+([\d.]+)s/i);
  if (retryInMatch) {
    return Math.ceil(Number(retryInMatch[1]) * 1000);
  }

  return fallbackMs;
}

async function runWithQuotaRetry(task, maxAttempts = 8) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await task();
    } catch (error) {
      attempt += 1;
      const message = String(error?.message || error || '').toLowerCase();
      const status = Number(error?.status) || 0;
      const retryable =
        status === 429 ||
        status >= 500 ||
        message.includes('429') ||
        message.includes('quota') ||
        message.includes('rate limit') ||
        message.includes('temporarily unavailable');

      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }

      await sleep(extractRetryDelayMs(error));
    }
  }

  throw new Error(`Retries exhausted after ${maxAttempts} attempts.`);
}

async function requestSiliconFlowEmbeddings(input) {
  const response = await fetch(`${SILICONFLOW_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSiliconFlowApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SILICONFLOW_EMBEDDING_MODEL,
      input,
      encoding_format: 'float',
      dimensions: SILICONFLOW_EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }

    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const errorMessage =
      payload?.error?.message ||
      payload?.message ||
      responseText ||
      `${response.status} ${response.statusText}`;

    const error = new Error(`SiliconFlow embeddings request failed: ${errorMessage}`);
    error.status = response.status;
    if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
      error.retryAfterMs = retryAfterHeader * 1000;
    }
    throw error;
  }

  const payload = await response.json();
  if (!Array.isArray(payload?.data)) {
    throw new Error('SiliconFlow embeddings response was invalid.');
  }

  if (payload.data.length !== input.length) {
    throw new Error(
      `SiliconFlow embeddings returned ${payload.data.length} vectors for ${input.length} inputs.`
    );
  }

  return payload.data.map((entry) => entry?.embedding || []);
}

function toCallableModelError(error, action = 'Gemini request') {
  if (error instanceof HttpsError) {
    return error;
  }

  const message = String(error?.message || error || '').trim();
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('api key') ||
    lowerMessage.includes('permission denied') ||
    lowerMessage.includes('model not found') ||
    lowerMessage.includes('unsupported model')
  ) {
    return new HttpsError('failed-precondition', `${action} failed: ${message}`);
  }

  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('resource exhausted') ||
    lowerMessage.includes('429')
  ) {
    return new HttpsError('resource-exhausted', `${action} failed: ${message}`);
  }

  if (
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('deadline exceeded')
  ) {
    return new HttpsError('deadline-exceeded', `${action} timed out: ${message}`);
  }

  if (
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('temporarily unavailable') ||
    lowerMessage.includes('overloaded') ||
    lowerMessage.includes('503')
  ) {
    return new HttpsError('unavailable', `${action} failed: ${message}`);
  }

  return new HttpsError('internal', `${action} failed: ${message || 'Unknown Gemini error.'}`);
}

function toCallableError(error, action = 'Request') {
  if (error instanceof HttpsError) {
    return error;
  }

  const message = String(error?.message || error || '').trim();
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('not found') || lowerMessage.includes('failed to download')) {
    return new HttpsError('not-found', `${action} failed: ${message}`);
  }

  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('resource exhausted') ||
    lowerMessage.includes('429')
  ) {
    return new HttpsError('resource-exhausted', `${action} failed: ${message}`);
  }

  if (
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('deadline exceeded')
  ) {
    return new HttpsError('deadline-exceeded', `${action} timed out: ${message}`);
  }

  if (
    lowerMessage.includes('failed-precondition') ||
    lowerMessage.includes('did not produce any indexable text') ||
    lowerMessage.includes('not configured')
  ) {
    return new HttpsError('failed-precondition', `${action} failed: ${message}`);
  }

  return new HttpsError('internal', `${action} failed: ${message || 'Unknown server error.'}`);
}

async function ensureCrcAccessByUid(uid, token = {}) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'CRC authentication is required.');
  }

  const email = String(token.email || '').toLowerCase();
  if (email.endsWith('@hospital.com')) {
    return {
      uid,
      role: 'crc',
      email,
      displayName: token.name || token.email || 'CRC user',
    };
  }

  try {
    const userSnapshot = await db.collection('users').doc(uid).get();
    if (!userSnapshot.exists()) {
      throw new HttpsError('permission-denied', 'CRC profile not found.');
    }

    const userData = userSnapshot.data() || {};
    if (userData.role !== 'crc') {
      throw new HttpsError('permission-denied', 'Only CRC users can access guidance services.');
    }

    return {
      uid,
      ...userData,
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    console.error('CRC profile lookup failed:', error);
    throw new HttpsError('unavailable', 'CRC profile lookup is temporarily unavailable.');
  }
}

async function assertAuthenticatedUser(request) {
  return ensureCrcAccessByUid(request.auth?.uid, request.auth?.token || {});
}

async function assertAuthenticatedHttpRequest(req) {
  const authorizationHeader = String(req.get('authorization') || '').trim();
  if (!authorizationHeader.toLowerCase().startsWith('bearer ')) {
    throw new HttpsError('unauthenticated', 'Sign in before using CRC guidance services.');
  }

  const idToken = authorizationHeader.slice(7).trim();
  if (!idToken) {
    throw new HttpsError('unauthenticated', 'Sign in before using CRC guidance services.');
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return ensureCrcAccessByUid(decodedToken.uid, decodedToken);
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('unauthenticated', 'Sign in before using CRC guidance services.');
  }
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

  if (typeof req.body === 'object') {
    return req.body;
  }

  throw new HttpsError('invalid-argument', 'Request body must be valid JSON.');
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
    case 'already-exists':
      return 409;
    case 'resource-exhausted':
      return 429;
    case 'cancelled':
      return 499;
    case 'failed-precondition':
      return 412;
    case 'out-of-range':
      return 400;
    case 'unimplemented':
      return 501;
    case 'unavailable':
      return 503;
    case 'deadline-exceeded':
      return 504;
    default:
      return 500;
  }
}

function sendHttpJsonError(res, error, action = 'Request') {
  const normalizedError = error instanceof HttpsError ? error : toCallableError(error, action);
  res.status(httpsErrorToStatusCode(normalizedError.code)).json({
    error: {
      status: normalizedError.code,
      message: normalizedError.message,
    },
  });
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
    sendHttpJsonError(res, error, action);
  }
}

async function writeProtocolGuidanceStatus(protocolDocId, patch = {}) {
  const safeProtocolDocId = String(protocolDocId || '').trim();
  if (!safeProtocolDocId) return;

  try {
    await db.doc(`protocols/${safeProtocolDocId}`).set(
      {
        ...patch,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    console.error('Failed to sync protocol guidance status:', error);
  }
}

function sanitizeGuidanceText(value = '') {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findChunkEnd(text, startIndex) {
  const remaining = text.length - startIndex;
  if (remaining <= GUIDANCE_CHUNK_MAX) {
    return text.length;
  }

  const minPreferred = startIndex + Math.floor(GUIDANCE_CHUNK_TARGET * 0.65);
  const hardStop = Math.min(startIndex + GUIDANCE_CHUNK_MAX, text.length);
  const searchWindow = text.slice(startIndex, hardStop);
  const breakTokens = ['. ', '? ', '! ', '; ', ': ', ', ', ' '];

  let bestRelativeIndex = -1;
  for (const token of breakTokens) {
    const matchIndex = searchWindow.lastIndexOf(token);
    if (matchIndex > bestRelativeIndex) {
      bestRelativeIndex = matchIndex;
    }
  }

  if (bestRelativeIndex >= 0 && startIndex + bestRelativeIndex >= minPreferred) {
    return startIndex + bestRelativeIndex + 1;
  }

  return Math.min(startIndex + GUIDANCE_CHUNK_TARGET, text.length);
}

function splitTextIntoChunks(text = '') {
  const cleanText = sanitizeGuidanceText(text);
  if (!cleanText) return [];

  const chunks = [];
  let startIndex = 0;

  while (startIndex < cleanText.length) {
    const endIndex = findChunkEnd(cleanText, startIndex);
    const chunk = cleanText.slice(startIndex, endIndex).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (endIndex >= cleanText.length) {
      break;
    }

    startIndex = Math.max(endIndex - GUIDANCE_CHUNK_OVERLAP, startIndex + 1);
  }

  return chunks;
}

function buildGuidanceChunkRows({
  pages = [],
  sourceType,
  documentId,
  protocolId = null,
  protocolName = null,
  title = null,
  storageBucket = null,
  storagePath = null,
  metadata = {},
}) {
  const rows = [];
  let globalChunkIndex = 0;

  pages.forEach((pageEntry, pagePosition) => {
    const pageNumber = Number(pageEntry?.page || pagePosition + 1);
    const pageText = sanitizeGuidanceText(pageEntry?.text || '');
    if (!pageText) return;

    const pageChunks = splitTextIntoChunks(pageText);
    pageChunks.forEach((content, pageChunkIndex) => {
      rows.push({
        id: `${documentId}:${globalChunkIndex}`,
        source_type: sourceType,
        document_id: documentId,
        protocol_id: protocolId,
        protocol_name: protocolName,
        title,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        page: pageNumber,
        chunk_index: globalChunkIndex,
        content,
        metadata: {
          ...metadata,
          page: pageNumber,
          page_chunk_index: pageChunkIndex,
          source_type: sourceType,
          document_id: documentId,
          protocol_id: protocolId,
          protocol_name: protocolName,
          title,
          storage_bucket: storageBucket,
          storage_path: storagePath,
        },
        updated_at: new Date().toISOString(),
      });
      globalChunkIndex += 1;
    });
  });

  return rows;
}

function buildGeminiContents(messages = [], userMessage = '') {
  const contents = messages
    .filter((message) => message?.content)
    .slice(-12)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content) }],
    }));

  contents.push({
    role: 'user',
    parts: [{ text: String(userMessage || '') }],
  });

  return contents;
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

function normalizeProtocolLookup(protocolId, protocolName) {
  const normalizedProtocolId = String(protocolId || '').trim() || null;
  const normalizedProtocolName = String(protocolName || '').trim() || null;

  return {
    protocolId: normalizedProtocolId,
    protocolName: normalizedProtocolId ? null : normalizedProtocolName,
    fallbackProtocolName: normalizedProtocolId ? normalizedProtocolName : null,
  };
}

function parseJsonResponse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new Error('Gemini returned an empty JSON response.');
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function buildRouterFallbackDecision(hasProtocolScope = false) {
  return {
    decision: 'retrieve',
    needs_ctcae: true,
    needs_protocol: Boolean(hasProtocolScope),
    reason_code: 'ambiguous',
    confidence: 0,
  };
}

function normalizeRouterDecision(payload, { hasProtocolScope = false } = {}) {
  const fallback = buildRouterFallbackDecision(hasProtocolScope);
  const decision = String(payload?.decision || '').trim();
  const reasonCode = String(payload?.reason_code || '').trim();
  const confidence = Number(payload?.confidence);
  const normalized = {
    decision,
    needs_ctcae: Boolean(payload?.needs_ctcae),
    needs_protocol: Boolean(payload?.needs_protocol),
    reason_code: reasonCode || fallback.reason_code,
    confidence: Number.isFinite(confidence) ? confidence : 0,
  };

  const validDecision = ['skip', 'retrieve', 'reuse_cache'].includes(normalized.decision);
  const skipIsConsistent =
    normalized.decision !== 'skip' || (!normalized.needs_ctcae && !normalized.needs_protocol);
  const retrieveHasSources =
    normalized.decision === 'skip' || normalized.needs_ctcae || normalized.needs_protocol;

  if (
    !validDecision ||
    !skipIsConsistent ||
    !retrieveHasSources ||
    normalized.confidence < ROUTER_CONFIDENCE_FLOOR
  ) {
    return fallback;
  }

  return normalized;
}

function buildGuidanceRoutePrompt({
  userText,
  previousUserMessage,
  previousModelMessage,
  hasPatientContext,
  hasProtocolScope,
  previousTurnUsedRetrieval,
  cachedSourcesAvailable,
}) {
  return `
You are a routing classifier for a CRC guidance assistant.
Decide whether the current user turn should skip retrieval, perform fresh retrieval, or reuse a recent retrieval cache.

Return JSON only in this exact schema:
{
  "decision": "skip|retrieve|reuse_cache",
  "needs_ctcae": true,
  "needs_protocol": false,
  "reason_code": "greeting|ui_help|workspace_summary|medical_assessment|protocol_rule|follow_up|ambiguous",
  "confidence": 0.0
}

Decision rules:
1. Use "skip" for greetings, thanks, product/help questions, UI/workflow help, rewrite-only requests, identity/context questions, or summaries that only depend on already injected workspace or patient context.
2. Use "retrieve" for any request that needs CTCAE or protocol facts, citations, page numbers, grading, severity, risk, symptom assessment, vitals interpretation, adverse-event handling, eligibility, hold/restart, escalation, emergency guidance, or source-backed clinical/protocol reasoning.
3. Use "reuse_cache" only when this is a short follow-up that clearly continues the immediately recent grounded answer and cached sources are enough.
4. If uncertain, choose "retrieve".
5. If decision is "skip", both source booleans must be false.
6. If decision is "retrieve" or "reuse_cache", at least one source boolean must be true.

Signals:
- hasPatientContext: ${Boolean(hasPatientContext)}
- hasProtocolScope: ${Boolean(hasProtocolScope)}
- previousTurnUsedRetrieval: ${Boolean(previousTurnUsedRetrieval)}
- cachedSourcesAvailable: ${Boolean(cachedSourcesAvailable)}

Current user message:
${String(userText || '').trim()}

Previous user message:
${String(previousUserMessage || '').trim() || 'None'}

Previous model message:
${String(previousModelMessage || '').trim() || 'None'}
  `.trim();
}

async function extractPdfPagesFromBytes(fileBytes) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBytes),
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str || '').join(' ');
    pages.push({ page: pageNumber, text: pageText });
  }

  return pages;
}

async function buildQueryEmbedding(queryText) {
  const normalizedQuery = String(queryText || '').trim();
  if (!normalizedQuery) return null;

  const embeddings = await runWithQuotaRetry(() => requestSiliconFlowEmbeddings([normalizedQuery]));
  return embeddings[0] || null;
}

async function downloadSupabaseFileBytes(storageBucket, storagePath) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage.from(storageBucket).download(storagePath);

  if (error) {
    throw new HttpsError('not-found', `Failed to download ${storageBucket}/${storagePath}: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function fetchUrlAsBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpsError('not-found', `Failed to download protocol PDF: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function embedRows(rows) {
  const embeddedRows = [];

  for (let index = 0; index < rows.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMBEDDING_BATCH_SIZE);
    const embeddings = await runWithQuotaRetry(() =>
      requestSiliconFlowEmbeddings(batch.map((row) => row.content))
    );

    batch.forEach((row, batchIndex) => {
      embeddedRows.push({
        ...row,
        embedding: embeddings[batchIndex] || [],
      });
    });
  }

  return embeddedRows;
}

async function upsertGuidanceRows(rows) {
  const supabase = getSupabaseClient();

  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from('guidance_documents').upsert(batch, {
      onConflict: 'id',
    });

    if (error) {
      throw new HttpsError('internal', `Guidance chunk upsert failed: ${error.message}`);
    }
  }
}

async function deleteGuidanceRows({ sourceType, documentId, protocolId }) {
  if (!sourceType && !documentId && !protocolId) {
    throw new HttpsError('invalid-argument', 'At least one guidance chunk filter is required.');
  }

  const supabase = getSupabaseClient();
  let deleteQuery = supabase.from('guidance_documents').delete();

  if (sourceType) {
    deleteQuery = deleteQuery.eq('source_type', sourceType);
  }
  if (documentId) {
    deleteQuery = deleteQuery.eq('document_id', documentId);
  }
  if (protocolId) {
    deleteQuery = deleteQuery.eq('protocol_id', protocolId);
  }

  const { error } = await deleteQuery;
  if (error) {
    throw new HttpsError('internal', `Failed to delete guidance chunks: ${error.message}`);
  }
}

async function ingestGuidanceDocumentInternal({
  sourceType,
  documentId,
  protocolId = null,
  protocolName = null,
  title = null,
  storageBucket,
  storagePath,
  metadata = {},
  shouldMarkIndexing = true,
}) {
  const protocolDocId = sourceType === 'protocol' ? String(protocolId || documentId || '').trim() : '';

  if (protocolDocId && shouldMarkIndexing) {
    await writeProtocolGuidanceStatus(protocolDocId, {
      guidance_index_status: 'indexing',
      guidance_index_error: null,
      guidance_indexed_at: null,
    });
  }

  try {
    const fileBytes = await downloadSupabaseFileBytes(storageBucket, storagePath);
    const pages = await extractPdfPagesFromBytes(fileBytes);
    const baseRows = buildGuidanceChunkRows({
      pages,
      sourceType,
      documentId,
      protocolId,
      protocolName,
      title,
      storageBucket,
      storagePath,
      metadata,
    });

    if (!baseRows.length) {
      throw new HttpsError('failed-precondition', 'The uploaded PDF did not produce any indexable text.');
    }

    await deleteGuidanceRows({ sourceType, documentId, protocolId });
    const embeddedRows = await embedRows(baseRows);
    await upsertGuidanceRows(embeddedRows);

    if (protocolDocId) {
      await writeProtocolGuidanceStatus(protocolDocId, {
        guidance_index_status: 'ready',
        guidance_index_error: null,
        guidance_indexed_at: new Date().toISOString(),
        guidance_chunk_count: embeddedRows.length,
        guidance_page_count: pages.length,
      });
    }

    return {
      pageCount: pages.length,
      chunkCount: embeddedRows.length,
    };
  } catch (error) {
    console.error('ingestGuidanceDocument failed:', {
      sourceType,
      documentId,
      protocolId,
      protocolName,
      storageBucket,
      storagePath,
      error,
    });

    if (protocolDocId) {
      await writeProtocolGuidanceStatus(protocolDocId, {
        guidance_index_status: 'error',
        guidance_index_error: String(error?.message || error || 'Unknown guidance indexing error.'),
      });
    }

    throw error;
  }
}

async function queryGuidanceChunks(queryEmbedding, { sourceTypes, protocolId, protocolName, matchCount }) {
  if (!queryEmbedding?.length || !matchCount) {
    return [];
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('match_guidance_documents', {
    query_embedding: queryEmbedding,
    _match_count: matchCount,
    _source_types: sourceTypes,
    _protocol_id: protocolId || null,
    _protocol_name: protocolName || null,
  });

  if (error) {
    throw new HttpsError('internal', `Guidance retrieval failed: ${error.message}`);
  }

  return normalizeGuidanceRows(data || []);
}

async function loadProtocolPdfBase64(protocolUrl) {
  const fileBytes = /^https?:\/\//i.test(protocolUrl)
    ? await fetchUrlAsBytes(protocolUrl)
    : await downloadSupabaseFileBytes('protocol', protocolUrl);
  return fileBytes.toString('base64');
}

async function runSideEffectGuidanceChat(payload = {}) {
  const systemPrompt = String(payload.systemPrompt || '');
  const userMessage = String(payload.userMessage || '').trim();
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const modelName = String(payload.model || GUIDANCE_MODEL || '').trim() || GUIDANCE_MODEL;

  if (!userMessage) {
    throw new HttpsError('invalid-argument', 'userMessage is required.');
  }

  try {
    const model = getGenerationModel(modelName, {
      systemInstruction: systemPrompt
        ? {
            role: 'system',
            parts: [{ text: systemPrompt }],
          }
        : undefined,
      generationConfig: {
        temperature: 0.35,
        topP: 0.9,
      },
    });

    const result = await model.generateContent({
      contents: buildGeminiContents(messages, userMessage),
    });

    const text = String(result?.response?.text?.() || '').trim();
    if (!text) {
      throw new HttpsError('internal', 'Gemini returned an empty guidance response.');
    }

    return {
      text,
      provider: 'firebase-callable',
      model: modelName,
    };
  } catch (error) {
    console.error('sideEffectGuidanceChat failed:', error);
    throw toCallableModelError(error, 'Guidance generation');
  }
}

async function runRetrieveGuidanceContext(payload = {}) {
  const queryText = String(payload.queryText || '').trim();
  const {
    protocolId,
    protocolName,
    fallbackProtocolName,
  } = normalizeProtocolLookup(payload.protocolId || null, payload.protocolName || null);
  const ctcaeMatchCount = Math.max(0, Number(payload.ctcaeMatchCount) || DEFAULT_MATCH_COUNT);
  const protocolMatchCount = Math.max(0, Number(payload.protocolMatchCount) || DEFAULT_MATCH_COUNT);

  if (!queryText) {
    return {
      ctcaeChunks: [],
      protocolChunks: [],
    };
  }

  const queryEmbedding = await buildQueryEmbedding(queryText);

  const [ctcaeChunks, initialProtocolChunks] = await Promise.all([
    ctcaeMatchCount > 0
      ? queryGuidanceChunks(queryEmbedding, {
          sourceTypes: ['ctcae'],
          protocolId: null,
          protocolName: null,
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

  const protocolChunks =
    !initialProtocolChunks.length && fallbackProtocolName && protocolMatchCount > 0
      ? await queryGuidanceChunks(queryEmbedding, {
          sourceTypes: ['protocol'],
          protocolId: null,
          protocolName: fallbackProtocolName,
          matchCount: protocolMatchCount,
        })
      : initialProtocolChunks;

  return {
    ctcaeChunks,
    protocolChunks,
  };
}

async function runClassifyGuidanceRoute(payload = {}) {
  const userText = String(payload.userText || '').trim();
  const previousUserMessage = String(payload.previousUserMessage || '').trim();
  const previousModelMessage = String(payload.previousModelMessage || '').trim();
  const hasPatientContext = Boolean(payload.hasPatientContext);
  const hasProtocolScope = Boolean(payload.hasProtocolScope);
  const previousTurnUsedRetrieval = Boolean(payload.previousTurnUsedRetrieval);
  const cachedSourcesAvailable = Boolean(payload.cachedSourcesAvailable);

  if (!userText) {
    return {
      decision: 'skip',
      needs_ctcae: false,
      needs_protocol: false,
      reason_code: 'greeting',
      confidence: 1,
    };
  }

  try {
    const model = getGenerationModel(ROUTER_MODEL, {
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        topP: 0.1,
      },
    });

    const result = await model.generateContent(
      buildGuidanceRoutePrompt({
        userText,
        previousUserMessage,
        previousModelMessage,
        hasPatientContext,
        hasProtocolScope,
        previousTurnUsedRetrieval,
        cachedSourcesAvailable,
      })
    );

    return normalizeRouterDecision(parseJsonResponse(result.response.text()), {
      hasProtocolScope,
    });
  } catch (error) {
    console.error('classifyGuidanceRoute failed:', error);
    return buildRouterFallbackDecision(hasProtocolScope);
  }
}

async function runDeleteGuidanceDocumentChunks(payload = {}) {
  await deleteGuidanceRows({
    sourceType: payload.sourceType || null,
    documentId: payload.documentId || null,
    protocolId: payload.protocolId || null,
  });

  return { success: true };
}

async function runSuggestAppointmentDate(payload = {}) {
  const protocolUrl = String(payload.protocolUrl || '').trim();
  const appointmentHistory = Array.isArray(payload.appointmentHistory) ? payload.appointmentHistory : [];

  if (!protocolUrl) {
    throw new HttpsError('invalid-argument', 'No active protocol found.');
  }

  const base64Data = await loadProtocolPdfBase64(protocolUrl);
  const prompt = `
You are a Clinical Scheduler.
TODAY: ${new Date().toISOString()}
HISTORY: ${JSON.stringify(appointmentHistory)}
PROTOCOL: Attached PDF.

TASK: Determine the NEXT appointment date based on the protocol rules.

REQUIREMENTS:
1. Check the protocol schedule.
2. If this is the first visit, suggest a date soon.
3. Cite the specific PAGE NUMBER where you found the rule.
4. Explain the scheduling logic clearly.

OUTPUT JSON FORMAT:
{
  "date": "YYYY-MM-DDTHH:MM",
  "reason": "Because Protocol Page 12 states visits are bi-weekly..."
}
  `.trim();

  try {
    const model = getGenerationModel(APPOINTMENT_MODEL, {
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
      prompt,
    ]);

    const parsed = parseJsonResponse(result?.response?.text?.());
    return {
      date: String(parsed?.date || ''),
      reason: String(parsed?.reason || ''),
    };
  } catch (error) {
    console.error('suggestAppointmentDate failed:', error);
    throw toCallableModelError(error, 'Appointment guidance generation');
  }
}

export const sideEffectGuidanceChat = onCall(
  { invoker: 'public', timeoutSeconds: 180, memory: '512MiB' },
  async (request) => {
    await assertAuthenticatedUser(request);
    return runSideEffectGuidanceChat(request.data || {});
  }
);

export const sideEffectGuidanceChatHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 180, memory: '512MiB' },
  async (req, res) => handleAuthedJsonRequest(req, res, runSideEffectGuidanceChat, 'Guidance generation')
);

export const retrieveGuidanceContext = onCall(
  { invoker: 'public', timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    await assertAuthenticatedUser(request);
    return runRetrieveGuidanceContext(request.data || {});
  }
);

export const retrieveGuidanceContextHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => handleAuthedJsonRequest(req, res, runRetrieveGuidanceContext, 'Guidance retrieval')
);

export const classifyGuidanceRoute = onCall(
  { invoker: 'public', timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    await assertAuthenticatedUser(request);
    return runClassifyGuidanceRoute(request.data || {});
  }
);

export const classifyGuidanceRouteHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => handleAuthedJsonRequest(req, res, runClassifyGuidanceRoute, 'Guidance routing')
);

export const ingestGuidanceDocument = onCall(
  { invoker: 'public', timeoutSeconds: 540, memory: '1GiB' },
  async (request) => {
    await assertAuthenticatedUser(request);

    const payload = request.data || {};
    const sourceType = String(payload.sourceType || '').trim();
    const documentId = String(payload.documentId || '').trim();
    const protocolId = payload.protocolId || null;
    const protocolName = payload.protocolName || null;
    const title = payload.title || null;
    const storageBucket = String(payload.storageBucket || '').trim();
    const storagePath = String(payload.storagePath || '').trim();
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

    if (!sourceType || !documentId) {
      throw new HttpsError('invalid-argument', 'sourceType and documentId are required.');
    }

    if (!['ctcae', 'protocol'].includes(sourceType)) {
      throw new HttpsError('invalid-argument', 'sourceType must be ctcae or protocol.');
    }

    if (!storageBucket || !storagePath) {
      throw new HttpsError('invalid-argument', 'storageBucket and storagePath are required.');
    }

    try {
      return await ingestGuidanceDocumentInternal({
        sourceType,
        documentId,
        protocolId,
        protocolName,
        title,
        storageBucket,
        storagePath,
        metadata,
      });
    } catch (error) {
      throw toCallableError(error, 'Guidance indexing');
    }
  }
);

export const processPendingProtocolGuidanceIndex = onSchedule(
  {
    schedule: 'every 2 minutes',
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
  },
  async () => {
    const protocolsCollection = db.collection('protocols');
    const [pendingSnapshot, legacyErrorSnapshot] = await Promise.all([
      protocolsCollection.where('guidance_index_status', '==', 'indexing').limit(3).get(),
      protocolsCollection.where('guidance_index_status', '==', 'error').limit(10).get(),
    ]);

    const protocolDocs = [
      ...pendingSnapshot.docs,
      ...legacyErrorSnapshot.docs.filter((protocolDoc) => {
        const errorMessage = String(protocolDoc.data()?.guidance_index_error || '')
          .trim()
          .toLowerCase();
        return errorMessage === 'internal';
      }),
    ]
      .filter((protocolDoc, index, allDocs) => allDocs.findIndex((candidate) => candidate.id === protocolDoc.id) === index)
      .slice(0, 3);

    if (!protocolDocs.length) {
      return;
    }

    for (const protocolDoc of protocolDocs) {
      const data = protocolDoc.data() || {};
      const protocolId = String(protocolDoc.id || '').trim();
      const storagePath = String(data.storagePath || '').trim();
      const protocolName = String(data.name || '').trim();
      const guidanceStatus = String(data.guidance_index_status || '').trim().toLowerCase();

      if (!protocolId) {
        continue;
      }

      if (!storagePath) {
        await writeProtocolGuidanceStatus(protocolId, {
          guidance_index_status: 'error',
          guidance_index_error: 'Protocol storagePath is missing.',
        });
        continue;
      }

      if (guidanceStatus !== 'indexing') {
        await writeProtocolGuidanceStatus(protocolId, {
          guidance_index_status: 'indexing',
          guidance_index_error: null,
          guidance_indexed_at: null,
        });
      }

      try {
        await ingestGuidanceDocumentInternal({
          sourceType: 'protocol',
          documentId: protocolId,
          protocolId,
          protocolName,
          title: protocolName || null,
          storageBucket: 'protocol',
          storagePath,
          metadata: {
            source_label: protocolName || storagePath,
          },
          shouldMarkIndexing: false,
        });
      } catch (error) {
        console.error('processPendingProtocolGuidanceIndex failed:', {
          protocolId,
          storagePath,
          error,
        });
      }
    }
  }
);

export const deleteGuidanceDocumentChunks = onCall(
  { invoker: 'public', timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    await assertAuthenticatedUser(request);
    return runDeleteGuidanceDocumentChunks(request.data || {});
  }
);

export const deleteGuidanceDocumentChunksHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 120, memory: '256MiB' },
  async (req, res) =>
    handleAuthedJsonRequest(req, res, runDeleteGuidanceDocumentChunks, 'Guidance deletion')
);

export const suggestAppointmentDate = onCall(
  { invoker: 'public', timeoutSeconds: 180, memory: '512MiB' },
  async (request) => {
    await assertAuthenticatedUser(request);
    return runSuggestAppointmentDate(request.data || {});
  }
);

export const suggestAppointmentDateHttp = onRequest(
  { invoker: 'public', cors: true, timeoutSeconds: 180, memory: '512MiB' },
  async (req, res) =>
    handleAuthedJsonRequest(req, res, runSuggestAppointmentDate, 'Appointment guidance generation')
);
