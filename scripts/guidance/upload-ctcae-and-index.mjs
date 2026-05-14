import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { CTCAE_CANONICAL_STORAGE_PATH } from '../../src/services/guidanceConstants.js';
import { buildGuidanceChunkRows } from '../../src/services/guidanceTextUtils.js';

const DEFAULT_SUPABASE_URL = 'https://fygkqituefwldmglijvy.supabase.co';
const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B';
const EMBEDDING_DIMENSIONS = 4096;
const UPSERT_BATCH_SIZE = 20;
const EMBEDDING_BATCH_SIZE = 20;
const CTCAE_DOCUMENT_ID = 'ctcae-default';
const CTCAE_BUCKET = 'pdfs';
let loadedEnv = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function runWithQuotaRetry(task, description, maxAttempts = 8) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await task();
    } catch (error) {
      attempt += 1;
      const message = String(error?.message || error || '');
      const status = Number(error?.status) || 0;
      const lowerMessage = message.toLowerCase();
      const isRetryableError =
        status === 429 ||
        status >= 500 ||
        lowerMessage.includes('429') ||
        lowerMessage.includes('quota') ||
        lowerMessage.includes('rate limit') ||
        lowerMessage.includes('temporarily unavailable');

      if (!isRetryableError || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = extractRetryDelayMs(error);
      console.log(
        `${description} hit an embedding rate limit. Waiting ${Math.ceil(delayMs / 1000)}s before retry ${attempt + 1}/${maxAttempts}...`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`${description} failed after ${maxAttempts} attempts.`);
}

function usage() {
  const thisFile = path.basename(fileURLToPath(import.meta.url));
  console.log(`Usage:
  node scripts/guidance/${thisFile} <local-pdf-path> [storage-path]
  node scripts/guidance/${thisFile} --from-storage [storage-path]

Notes:
  - CTCAE is stored as a single global document in ${CTCAE_BUCKET}/${CTCAE_CANONICAL_STORAGE_PATH}
  - --from-storage defaults to ${CTCAE_CANONICAL_STORAGE_PATH}`);
}

async function readEnvFile(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .reduce((accumulator, line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) return accumulator;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        accumulator[key] = value;
        return accumulator;
      }, {});
  } catch {
    return {};
  }
}

function getLocalEnv() {
  if (loadedEnv) return loadedEnv;
  loadedEnv = {};
  return loadedEnv;
}

function getSupabaseClient() {
  const env = getLocalEnv();
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseKey) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY before running this script.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

function getSiliconFlowApiKey() {
  const env = getLocalEnv();
  const apiKey =
    process.env.SILICONFLOW_API_KEY ||
    env.SILICONFLOW_API_KEY ||
    process.env.VITE_SILICONFLOW_API_KEY ||
    env.VITE_SILICONFLOW_API_KEY ||
    '';
  if (!apiKey) {
    throw new Error('Set SILICONFLOW_API_KEY before running this script.');
  }

  return apiKey;
}

async function requestSiliconFlowEmbeddings(input) {
  const response = await fetch(`${SILICONFLOW_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSiliconFlowApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSIONS,
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
    throw new Error('SiliconFlow embeddings request returned an invalid response payload.');
  }
  if (payload.data.length !== input.length) {
    throw new Error(
      `SiliconFlow embeddings request returned ${payload.data.length} vectors for ${input.length} inputs.`
    );
  }

  return payload.data.map((entry) => entry?.embedding || []);
}

async function extractPdfPages(fileBuffer) {
  const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjsLib = pdfjsModule.default || pdfjsModule;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fileBuffer),
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    pages.push({ page: pageNumber, text: pageText });
  }

  return pages;
}

async function downloadStorageFileBuffer(supabase, bucket, storagePath) {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error) {
    throw new Error(`CTCAE download failed: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function embedRows(rows) {
  const embeddedRows = [];

  for (let index = 0; index < rows.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(index, index + EMBEDDING_BATCH_SIZE);
    const result = await runWithQuotaRetry(
      () => requestSiliconFlowEmbeddings(batch.map((row) => row.content)),
      `Embedding batch ${Math.floor(index / EMBEDDING_BATCH_SIZE) + 1}`
    );

    batch.forEach((row, batchIndex) => {
      embeddedRows.push({
        ...row,
        embedding: result[batchIndex] || [],
      });
    });

    console.log(`Embedded ${Math.min(index + batch.length, rows.length)}/${rows.length} chunks...`);
  }

  return embeddedRows;
}

async function upsertRows(supabase, rows) {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from('guidance_documents').upsert(batch, {
      onConflict: 'id',
    });

    if (error) {
      throw new Error(`Guidance chunk upsert failed: ${error.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (!firstArg || firstArg === '--help' || firstArg === '-h') {
    usage();
    process.exit(firstArg ? 0 : 1);
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const rootEnv = await readEnvFile(path.join(projectRoot, '.env.local'));
  const functionsEnv = await readEnvFile(path.join(projectRoot, 'functions', '.env.local'));
  loadedEnv = {
    ...rootEnv,
    ...functionsEnv,
  };

  const supabase = getSupabaseClient();
  const fromStorage = firstArg === '--from-storage';
  const storagePath = args[1] || CTCAE_CANONICAL_STORAGE_PATH;
  let fileBuffer;

  if (fromStorage) {
    console.log(`Downloading existing CTCAE from ${CTCAE_BUCKET}/${storagePath}...`);
    fileBuffer = await downloadStorageFileBuffer(supabase, CTCAE_BUCKET, storagePath);
  } else {
    const absolutePath = path.resolve(firstArg);
    fileBuffer = await fs.readFile(absolutePath);

    const uploadResult = await supabase.storage
      .from(CTCAE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: 'application/pdf', upsert: true });
    if (uploadResult.error) {
      throw new Error(`CTCAE upload failed: ${uploadResult.error.message}`);
    }
  }

  const pages = await extractPdfPages(fileBuffer);
  const baseRows = buildGuidanceChunkRows({
    pages,
    sourceType: 'ctcae',
    documentId: CTCAE_DOCUMENT_ID,
    protocolId: null,
    protocolName: null,
    title: path.basename(storagePath),
    storageBucket: CTCAE_BUCKET,
    storagePath,
    metadata: {
      source_label: 'CTCAE',
    },
  });

  const deleteResult = await supabase
    .from('guidance_documents')
    .delete()
    .eq('source_type', 'ctcae')
    .eq('document_id', CTCAE_DOCUMENT_ID);
  if (deleteResult.error) {
    throw new Error(`Existing CTCAE chunk cleanup failed: ${deleteResult.error.message}`);
  }

  const embeddedRows = await embedRows(baseRows);
  await upsertRows(supabase, embeddedRows);

  console.log(
    `CTCAE indexed from ${CTCAE_BUCKET}/${storagePath} (${pages.length} pages, ${embeddedRows.length} chunks).`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
