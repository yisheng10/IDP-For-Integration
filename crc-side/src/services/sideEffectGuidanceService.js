import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY, SIDE_EFFECT_GUIDANCE_MODEL, SIDE_EFFECT_GUIDANCE_PROVIDER } from '../config';
import { callFunctionHttp } from './firebaseFunctionHttp';

const DEFAULT_GEMINI_GUIDANCE_MODEL = 'gemini-2.5-flash';

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveGeminiModel() {
  const configuredModel = String(SIDE_EFFECT_GUIDANCE_MODEL || '').trim();
  if (configuredModel && !configuredModel.includes('/')) {
    return configuredModel;
  }
  return DEFAULT_GEMINI_GUIDANCE_MODEL;
}

function buildGeminiPrompt(payload = {}) {
  const chunks = [];
  const systemPrompt = String(payload.systemPrompt || '').trim();
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-12) : [];
  const userMessage = String(payload.userMessage || '').trim();

  if (systemPrompt) {
    chunks.push(`System instructions:\n${systemPrompt}`);
  }

  if (messages.length) {
    chunks.push(
      `Recent messages:\n${messages
        .map((message) => {
          const role = message?.role === 'assistant' || message?.role === 'model' ? 'Assistant' : 'User';
          return `${role}: ${String(message?.content || message?.text || '').trim()}`;
        })
        .filter(Boolean)
        .join('\n')}`
    );
  }

  if (userMessage) {
    chunks.push(userMessage);
  }

  return chunks.join('\n\n').trim();
}

function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') return null;
  return {
    promptTokenCount: Number(usageMetadata.promptTokenCount) || 0,
    candidatesTokenCount: Number(usageMetadata.candidatesTokenCount) || 0,
    totalTokenCount: Number(usageMetadata.totalTokenCount) || 0,
  };
}

function mapErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').trim();
  const lowerMessage = message.toLowerCase();

  if (message.startsWith('AI Error.')) {
    return message;
  }

  if (lowerMessage.includes('api key') || lowerMessage.includes('permission denied')) {
    return 'AI Error. The configured provider is not set up correctly on the server.';
  }

  if (lowerMessage.includes('quota') || code.includes('resource-exhausted')) {
    return 'AI Error. The current AI provider hit a quota or rate limit. Retry in a moment.';
  }

  if (lowerMessage.includes('timed out') || code.includes('deadline-exceeded')) {
    return 'AI Error. The AI request timed out. Retry after a short wait.';
  }

  if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('networkerror') || lowerMessage.includes('network request failed')) {
    return 'AI Error. The guidance service connection failed. Retry after the service is ready.';
  }

  if (code.includes('unauthenticated')) {
    return 'AI Error. Your session expired. Sign in again and retry.';
  }

  if (code.includes('failed-precondition')) {
    return `AI Error. ${message || 'The configured AI profile is not available in this environment.'}`;
  }

  if (code.includes('unavailable')) {
    return 'AI Error. Guidance service is temporarily unavailable. Retry shortly.';
  }

  if (message) {
    return `AI Error. ${message}`;
  }

  return 'AI Error. Side Effect Guidance is unavailable right now.';
}

export async function requestSideEffectGuidance(payload) {
  const provider = normalizeProvider(SIDE_EFFECT_GUIDANCE_PROVIDER);

  if (provider === 'gemini' || provider === 'google' || provider === 'google-gemini') {
    if (!GEMINI_API_KEY) {
      const error = new Error('AI Error. Gemini API key is not configured.');
      error.code = 'failed-precondition';
      throw error;
    }

    try {
      const modelName = resolveGeminiModel();
      const prompt = buildGeminiPrompt(payload);

      if (!prompt) {
        const error = new Error('userMessage is required.');
        error.code = 'invalid-argument';
        throw error;
      }

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: Number.isFinite(Number(payload?.temperature)) ? Number(payload.temperature) : 0.35,
          topP: Number.isFinite(Number(payload?.topP)) ? Number(payload.topP) : 0.9,
          responseMimeType: payload?.responseFormat === 'json' ? 'application/json' : 'text/plain',
        },
      });

      const result = await model.generateContent(prompt);
      const text = String(result?.response?.text?.() || '').trim();
      if (!text) {
        throw new Error('Gemini returned an empty response.');
      }

      return {
        text,
        provider: 'gemini',
        model: modelName,
        usage: normalizeGeminiUsage(result?.response?.usageMetadata),
      };
    } catch (error) {
      const wrapped = new Error(mapErrorMessage(error));
      wrapped.original = error;
      throw wrapped;
    }
  }

  try {
    return await callFunctionHttp('sideEffectGuidanceChatHttp', payload, { timeoutMs: 150000 });
  } catch (error) {
    const wrapped = new Error(mapErrorMessage(error));
    wrapped.original = error;
    throw wrapped;
  }
}
