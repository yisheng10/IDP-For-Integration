import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

const finalizeUploadedProtocolTemplateCallable = httpsCallable(functions, 'finalizeUploadedProtocolTemplate');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

export function getProtocolStaticContextStatus(protocol = null) {
  const safeProtocol = protocol && typeof protocol === 'object' ? protocol : {};
  const status = normalizeStatus(safeProtocol.extraction_status);
  const extractionError = normalizeText(safeProtocol.extraction_error);

  if (status === 'ready') {
    return {
      status: 'ready',
      ready: true,
      tone: 'success',
      label: 'Static context ready',
      message: 'Strict server-side disengagement static context extraction completed successfully for this protocol.',
      extractedAt: normalizeText(safeProtocol.extracted_at),
      extractorVersion: normalizeText(safeProtocol.extractor_version),
      error: '',
    };
  }

  if (status === 'extracting' || status === 'pending') {
    return {
      status: 'extracting',
      ready: false,
      tone: 'brand',
      label: 'Static context extracting',
      message:
        'Strict server-side disengagement static context extraction is still running. This protocol cannot enter patient disengagement prediction yet.',
      extractedAt: normalizeText(safeProtocol.extracted_at),
      extractorVersion: normalizeText(safeProtocol.extractor_version),
      error: extractionError,
    };
  }

  if (status === 'fallback_only') {
    return {
      status: 'error',
      ready: false,
      tone: 'danger',
      label: 'Static context extraction failed',
      message:
        extractionError ||
        'Legacy fallback-only disengagement static context is no longer accepted. Re-extract this protocol on the server before using patient disengagement prediction.',
      extractedAt: normalizeText(safeProtocol.extracted_at),
      extractorVersion: normalizeText(safeProtocol.extractor_version),
      error: extractionError,
    };
  }

  if (status === 'error') {
    return {
      status: 'error',
      ready: false,
      tone: 'danger',
      label: 'Static context extraction failed',
      message:
        extractionError ||
        'Strict server-side disengagement static context extraction failed for this protocol.',
      extractedAt: normalizeText(safeProtocol.extracted_at),
      extractorVersion: normalizeText(safeProtocol.extractor_version),
      error: extractionError,
    };
  }

  return {
    status: 'not_started',
    ready: false,
    tone: 'warning',
    label: 'Static context not ready',
    message:
      'This protocol has not completed strict server-side disengagement static context extraction yet.',
    extractedAt: normalizeText(safeProtocol.extracted_at),
    extractorVersion: normalizeText(safeProtocol.extractor_version),
    error: extractionError,
  };
}

export async function finalizeUploadedProtocolTemplate({
  protocolId = null,
  protocolName,
  stagedStoragePath,
  stagedStorageBucket = 'protocol',
  manualTrialPhaseOverride = '',
} = {}) {
  const normalizedProtocolName = normalizeText(protocolName);
  const normalizedStagedStoragePath = normalizeText(stagedStoragePath);
  const normalizedStagedStorageBucket = normalizeText(stagedStorageBucket) || 'protocol';
  const normalizedManualTrialPhaseOverride = normalizeText(manualTrialPhaseOverride);

  if (!normalizedProtocolName) {
    throw new Error('Protocol name is required before strict static-context extraction can begin.');
  }

  if (!normalizedStagedStoragePath) {
    throw new Error('Temporary protocol upload path is required before strict static-context extraction can begin.');
  }

  const response = await finalizeUploadedProtocolTemplateCallable({
    protocolId: normalizeText(protocolId) || null,
    protocolName: normalizedProtocolName,
    stagedStoragePath: normalizedStagedStoragePath,
    stagedStorageBucket: normalizedStagedStorageBucket,
    manualTrialPhaseOverride: normalizedManualTrialPhaseOverride || null,
  });

  return response.data || {};
}
