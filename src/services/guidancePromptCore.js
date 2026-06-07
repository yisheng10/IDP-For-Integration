function normalizeText(value = '') {
  return String(value || '').trim();
}

export function normalizeProtocolLookup(protocolId, protocolName) {
  const normalizedProtocolId = normalizeText(protocolId) || null;
  const normalizedProtocolName = normalizeText(protocolName) || null;

  return {
    protocolId: normalizedProtocolId,
    protocolName: normalizedProtocolId ? null : normalizedProtocolName,
  };
}

export function normalizeMetadata(metadata) {
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

export function normalizeGuidanceRows(rows = [], sourceTypeFallback = null) {
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

function buildBaseContextSections({ workspaceContext, patientContext }) {
  const sections = [];

  if (workspaceContext) {
    sections.push(`=== CRC WORKSPACE CONTEXT ===\n${workspaceContext}`);
  }

  if (patientContext) {
    sections.push(`=== COMPLETE PATIENT CONTEXT ===\n${patientContext}`);
  }

  return sections;
}

function normalizeRouteReason(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function buildGuidancePromptNoRetrieval({
  workspaceContext,
  patientContext,
  userText,
  routeReason = '',
}) {
  const sections = buildBaseContextSections({ workspaceContext, patientContext });
  const normalizedRouteReason = normalizeRouteReason(routeReason);
  const shouldSuppressRiskTag = [
    'greeting',
    'assistant_help',
    'workspace_summary',
    'ui_help',
    'rewrite',
  ].includes(normalizedRouteReason);

  sections.push(
    [
      '=== ANSWER MODE ===',
      'No CTCAE or Protocol excerpts were retrieved for this turn.',
      'Answer only from the directly injected CRC workspace context, patient context, and the existing conversation.',
      'Do not claim CTCAE or Protocol rules, grades, page numbers, or citations in this reply.',
      'Do not make new medical or protocol judgments that require document grounding.',
      shouldSuppressRiskTag
        ? 'Do not append any [RISK: HIGH], [RISK: MEDIUM], or [RISK: LOW] tag in this reply.'
        : 'Do not invent a risk classification unless the user explicitly asked for one and it can be answered strictly from injected workspace state without CTCAE or Protocol grounding.',
      normalizedRouteReason === 'assistant_help'
        ? 'For self-introduction or capability questions, answer briefly about who you are and what you can help with. Do not volunteer workspace counts, alerts, incidents, or patient status unless the user explicitly asked for that summary.'
        : null,
      normalizedRouteReason === 'greeting'
        ? 'For greetings or closings, keep the reply brief. Do not volunteer workspace status, alert counts, or patient summaries.'
        : null,
      normalizedRouteReason === 'ui_help'
        ? 'Answer only the product or workflow question being asked. Do not expand into clinical guidance or workspace summaries.'
        : null,
      normalizedRouteReason === 'rewrite'
        ? 'Only transform the prior answer. Do not add new content, workspace summaries, or risk labels.'
        : null,
      normalizedRouteReason === 'workspace_summary'
        ? 'Summarize only the workspace information the user asked for. Do not add risk labels, CTCAE grades, or unsolicited patient triage.'
        : null,
      'If the user is only asking to rewrite, translate, shorten, or reformat an earlier answer already present in the conversation, you may transform that existing answer without adding new grounded claims.',
      'If the user is asking for CTCAE or Protocol grounding, explicitly say that no retrieved excerpts were used for this reply.',
    ]
      .filter(Boolean)
      .join('\n')
  );

  sections.push(`=== USER QUERY ===\n${normalizeText(userText)}`);

  return sections.join('\n\n');
}

export function buildGuidancePromptWithRetrieval({
  workspaceContext,
  patientContext,
  ctcaeChunks = [],
  protocolChunks = [],
  userText,
}) {
  const sections = buildBaseContextSections({ workspaceContext, patientContext });

  sections.push(
    [
      '=== ANSWER MODE ===',
      'Use the retrieved CTCAE and Protocol excerpts as hidden grounding evidence for this reply.',
      'Do not paste raw retrieved chunks, excerpt blocks, separator markers, or long verbatim quotes into the answer.',
      'Default to paraphrasing the grounded content in your own words and attach only compact page citations such as CTCAE [Page X] or Protocol [Page X].',
      'If the user asks for a citation, provide the relevant conclusion with page citations, not the full chunk text.',
      'Only quote exact source wording when the user explicitly asks for the exact excerpt, and even then keep the quote to the shortest necessary phrase or sentence.',
    ].join('\n')
  );

  sections.push(
    `=== CTCAE RETRIEVED EXCERPTS ===\n${
      ctcaeChunks.length
        ? ctcaeChunks
            .map((entry) => `${renderChunkLabel(entry, 'CTCAE')}\n${entry.content}`)
            .join('\n\n---\n\n')
        : 'No CTCAE excerpts matched this query.'
    }`
  );

  sections.push(
    `=== PROTOCOL RETRIEVED EXCERPTS ===\n${
      protocolChunks.length
        ? protocolChunks
            .map((entry) => `${renderChunkLabel(entry, 'Protocol')}\n${entry.content}`)
            .join('\n\n---\n\n')
        : 'No protocol excerpts matched this query.'
    }`
  );

  sections.push(`=== USER QUERY ===\n${normalizeText(userText)}`);

  return sections.join('\n\n');
}

export const buildGuidancePrompt = buildGuidancePromptWithRetrieval;
