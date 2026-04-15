import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { callFunctionHttp } from './firebaseFunctionHttp';

const ingestGuidanceDocumentCallable = httpsCallable(functions, 'ingestGuidanceDocument');

export async function deleteGuidanceDocumentChunks({ sourceType, documentId, protocolId }) {
  return callFunctionHttp('deleteGuidanceDocumentChunksHttp', {
    sourceType,
    documentId,
    protocolId,
  });
}

export async function ingestGuidanceDocument({
  sourceType,
  documentId,
  protocolId = null,
  protocolName = null,
  title = null,
  storageBucket = null,
  storagePath = null,
  downloadUrl = null,
  metadata = {},
}) {
  if (!sourceType || !documentId) {
    throw new Error('sourceType and documentId are required for guidance indexing.');
  }

  if (!storageBucket || !storagePath) {
    throw new Error('storageBucket and storagePath are required for server-side guidance indexing.');
  }

  const response = await ingestGuidanceDocumentCallable({
    sourceType,
    documentId,
    protocolId,
    protocolName,
    title,
    storageBucket,
    storagePath,
    downloadUrl,
    metadata,
  });

  return response.data;
}

export const ingestGuidanceFile = ingestGuidanceDocument;
