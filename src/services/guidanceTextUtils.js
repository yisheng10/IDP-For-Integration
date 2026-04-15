export const GUIDANCE_CHUNK_TARGET = 1000;
export const GUIDANCE_CHUNK_MAX = 1200;
export const GUIDANCE_CHUNK_OVERLAP = 150;

export function sanitizeGuidanceText(value = '') {
  return String(value || '')
    .replaceAll('\u0000', ' ')
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

export function splitTextIntoChunks(text = '') {
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

export function buildGuidanceChunkRows({
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
