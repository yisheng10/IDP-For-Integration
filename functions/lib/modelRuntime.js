import { GoogleGenerativeAI } from '@google/generative-ai';
import { resolveTaskProfile } from './modelProfiles.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name) {
  const value = normalizeText(process.env[name]);
  if (!value) {
    throw new Error(`${name} is not configured on the server.`);
  }
  return value;
}

function requireHeaderSafeEnv(name) {
  const value = requireEnv(name);
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 255) {
      throw new Error(
        `${name} contains non-ASCII characters. Check for placeholder text or an invalid API key value.`
      );
    }
  }
  return value;
}

function buildGeminiContents(messages = [], userMessage = '') {
  const contents = (Array.isArray(messages) ? messages : [])
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

function buildOpenAiMessages({ systemPrompt = '', messages = [], userMessage = '' }) {
  const normalizedMessages = [];
  const safeSystemPrompt = normalizeText(systemPrompt);

  if (safeSystemPrompt) {
    normalizedMessages.push({
      role: 'system',
      content: safeSystemPrompt,
    });
  }

  for (const message of Array.isArray(messages) ? messages.slice(-12) : []) {
    const content = normalizeText(message?.content || message?.text);
    if (!content) continue;
    normalizedMessages.push({
      role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user',
      content,
    });
  }

  normalizedMessages.push({
    role: 'user',
    content: normalizeText(userMessage),
  });

  return normalizedMessages;
}

function normalizeGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== 'object') return null;
  return {
    promptTokenCount: Number(usageMetadata.promptTokenCount) || 0,
    candidatesTokenCount: Number(usageMetadata.candidatesTokenCount) || 0,
    totalTokenCount: Number(usageMetadata.totalTokenCount) || 0,
  };
}

function normalizeOpenAiUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokenCount: Number(usage.prompt_tokens) || 0,
    candidatesTokenCount: Number(usage.completion_tokens) || 0,
    totalTokenCount: Number(usage.total_tokens) || 0,
  };
}

function normalizeOllamaUsage(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const promptTokenCount = Number(payload.prompt_eval_count) || 0;
  const candidatesTokenCount = Number(payload.eval_count) || 0;
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
  };
}

function estimateCost(profile, usage) {
  if (!usage) return 0;

  const inputCost = Number(profile.inputCostPerMillion) || 0;
  const outputCost = Number(profile.outputCostPerMillion) || 0;
  const promptTokens = Number(usage.promptTokenCount) || 0;
  const outputTokens = Number(usage.candidatesTokenCount) || 0;

  if (!inputCost && !outputCost) {
    return 0;
  }

  return Number(
    ((promptTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost).toFixed(8)
  );
}

function extractOpenAiText(content) {
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

function extractOpenAiStreamText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return normalizeText(content);

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return String(part.text || '');
      return '';
    })
    .join('\n');
}

async function readOpenAiCompatibleStream(response, profile, payload = {}) {
  if (!response.body) {
    throw new Error(`${profile.providerLabel || profile.provider} returned an empty stream body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const shouldLogProgress = Boolean(payload.streamLog);
  let buffer = '';
  let text = '';
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let parsed = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (parsed?.usage) {
        usage = normalizeOpenAiUsage(parsed.usage);
      }

      const chunkText = extractOpenAiStreamText(
        parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content
      );
      if (chunkText) {
        text += chunkText;
        if (shouldLogProgress) {
          process.stdout.write('.');
        }
      }
    }
  }

  if (shouldLogProgress) {
    process.stdout.write('\n');
  }

  return {
    text: normalizeText(text),
    usage,
  };
}

function buildAbortSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function extractRetryDelayMs(error, fallbackMs = 15000) {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
    return error.retryAfterMs;
  }

  for (const detail of Array.isArray(error?.errorDetails) ? error.errorDetails : []) {
    if (String(detail?.['@type'] || '').includes('RetryInfo')) {
      const retryDelay = normalizeText(detail?.retryDelay);
      const secondsMatch = retryDelay.match(/([\d.]+)s/i);
      if (secondsMatch) {
        return Math.ceil(Number(secondsMatch[1]) * 1000);
      }
    }
  }

  const message = normalizeText(error?.message || error);
  const retryInfoMatch = message.match(/retryDelay":"(\d+)s"/i);
  if (retryInfoMatch) {
    return Number(retryInfoMatch[1]) * 1000;
  }

  const retryInMatch = message.match(/retry(?: after| in)?\s+([\d.]+)s/i);
  if (retryInMatch) {
    return Math.ceil(Number(retryInMatch[1]) * 1000);
  }

  return fallbackMs;
}

function isRetryableProviderError(error) {
  const status = Number(error?.status || error?.httpStatus) || 0;
  const message = normalizeText(error?.message || error).toLowerCase();

  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return true;
  }

  return (
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('resource exhausted') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('overloaded') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('retry')
  );
}

async function runWithRetry(profile, task, actionLabel) {
  const maxAttempts = Math.max(1, Number(profile.maxAttempts) || 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableProviderError(error)) {
        throw error;
      }

      const delayMs = extractRetryDelayMs(error, 5000);
      const errorStatus = Number(error?.status || error?.httpStatus) || 0;
      const errorMessage = normalizeText(error?.message || error || 'Unknown provider error.');
      console.warn(
        `${profile.providerLabel || profile.provider} ${actionLabel} failed on attempt ${attempt}/${maxAttempts}` +
          `${errorStatus ? ` [status ${errorStatus}]` : ''}: ${errorMessage}. ` +
          `Retrying in ${Math.ceil(delayMs / 1000)}s...`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`${profile.providerLabel || profile.provider} ${actionLabel} retries exhausted.`);
}

async function runGeminiTask(profile, payload = {}) {
  return runWithRetry(profile, async () => {
    const client = new GoogleGenerativeAI(requireHeaderSafeEnv(profile.apiKeyEnv || 'GEMINI_API_KEY'));
    const generationConfig = {};

    if (Number.isFinite(profile.temperature)) generationConfig.temperature = profile.temperature;
    if (Number.isFinite(profile.topP)) generationConfig.topP = profile.topP;
    if (profile.responseFormat === 'json') generationConfig.responseMimeType = 'application/json';

    const model = client.getGenerativeModel({
      model: profile.model,
      systemInstruction: normalizeText(payload.systemPrompt)
        ? {
            role: 'system',
            parts: [{ text: normalizeText(payload.systemPrompt) }],
          }
        : undefined,
      generationConfig,
    });

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    let result = null;

    if (attachments.length) {
      if (Array.isArray(payload.messages) && payload.messages.length) {
        throw new Error('Attachments are only supported for single-turn Gemini tasks.');
      }

      result = await model.generateContent([
        ...attachments,
        normalizeText(payload.userMessage),
      ]);
    } else {
      result = await model.generateContent({
        contents: buildGeminiContents(payload.messages, payload.userMessage),
      });
    }

    const text = normalizeText(result?.response?.text?.());
    if (!text) {
      throw new Error(`${profile.providerLabel || 'AI'} returned an empty response.`);
    }

    const usage = normalizeGeminiUsage(result?.response?.usageMetadata);
    return {
      text,
      provider: profile.providerLabel || profile.provider,
      model: profile.model,
      profileId: profile.id,
      usage,
      estimatedCost: estimateCost(profile, usage),
    };
  }, 'request');
}

async function runOpenAiCompatibleTask(profile, payload = {}) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length) {
    throw new Error(`${profile.providerLabel || profile.provider} does not support PDF attachments for this task.`);
  }

  return runWithRetry(profile, async () => {
    const effectiveTimeoutMs = Number(payload.timeoutMs) || Number(profile.timeoutMs) || 60000;
    const timeout = buildAbortSignal(effectiveTimeoutMs);
    const body = {
      model: profile.model,
      messages: buildOpenAiMessages(payload),
    };
    const useStream = Boolean(payload.stream);

    if (Number.isFinite(profile.temperature)) body.temperature = profile.temperature;
    if (Number.isFinite(profile.topP)) body.top_p = profile.topP;
    if (profile.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }
    if (useStream) {
      body.stream = true;
    }

    try {
      const response = await fetch(`${profile.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${requireHeaderSafeEnv(profile.apiKeyEnv || 'OPENAI_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: timeout.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        let parsed = null;
        try {
          parsed = responseText ? JSON.parse(responseText) : null;
        } catch {
          parsed = null;
        }
        const errorMessage =
          parsed?.error?.message ||
          parsed?.message ||
          responseText ||
          `${response.status} ${response.statusText}`;
        const error = new Error(`${profile.providerLabel || profile.provider} request failed: ${errorMessage}`);
        error.status = response.status;
        const retryAfterHeader = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
          error.retryAfterMs = retryAfterHeader * 1000;
        }
        throw error;
      }

      const result = useStream
        ? await readOpenAiCompatibleStream(response, profile, payload)
        : await response.text().then((responseText) => {
            let parsed = null;
            try {
              parsed = responseText ? JSON.parse(responseText) : null;
            } catch {
              parsed = null;
            }
            return {
              text: extractOpenAiText(parsed?.choices?.[0]?.message?.content),
              usage: normalizeOpenAiUsage(parsed?.usage),
            };
          });
      const text = normalizeText(result.text);
      if (!text) {
        throw new Error(`${profile.providerLabel || profile.provider} returned an empty response.`);
      }

      const usage = result.usage;
      return {
        text,
        provider: profile.providerLabel || profile.provider,
        model: profile.model,
        profileId: profile.id,
        usage,
        estimatedCost: estimateCost(profile, usage),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(
          `${profile.providerLabel || profile.provider} request timed out after ${effectiveTimeoutMs}ms for model "${profile.model}".`
        );
        timeoutError.status = 408;
        timeoutError.retryAfterMs = 5000;
        throw timeoutError;
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }, 'request');
}

async function runOllamaTask(profile, payload = {}) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length) {
    throw new Error(`${profile.providerLabel || profile.provider} does not support PDF attachments for this task.`);
  }

  return runWithRetry(profile, async () => {
    const timeout = buildAbortSignal(Number(profile.timeoutMs) || 60000);
    const body = {
      model: profile.model,
      messages: buildOpenAiMessages(payload),
      stream: false,
    };

    const options = {};
    if (Number.isFinite(profile.temperature)) options.temperature = profile.temperature;
    if (Number.isFinite(profile.topP)) options.top_p = profile.topP;
    if (Object.keys(options).length) {
      body.options = options;
    }

    if (profile.responseFormat === 'json') {
      body.format = 'json';
    }

    try {
      const response = await fetch(`${profile.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
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
          parsed?.error ||
          parsed?.message ||
          responseText ||
          `${response.status} ${response.statusText}`;
        const error = new Error(`${profile.providerLabel || profile.provider} request failed: ${errorMessage}`);
        error.status = response.status;
        throw error;
      }

      const text = normalizeText(parsed?.message?.content);
      if (!text) {
        throw new Error(`${profile.providerLabel || profile.provider} returned an empty response.`);
      }

      const usage = normalizeOllamaUsage(parsed);
      return {
        text,
        provider: profile.providerLabel || profile.provider,
        model: profile.model,
        profileId: profile.id,
        usage,
        estimatedCost: estimateCost(profile, usage),
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutMs = Number(profile.timeoutMs) || 60000;
        const timeoutError = new Error(
          `${profile.providerLabel || profile.provider} request timed out after ${timeoutMs}ms for model "${profile.model}".`
        );
        timeoutError.status = 408;
        timeoutError.retryAfterMs = 5000;
        throw timeoutError;
      }

      const fetchCauseMessage = normalizeText(error?.cause?.message || error?.cause?.code);
      if (normalizeText(error?.message) === 'fetch failed' && fetchCauseMessage) {
        throw new Error(`${profile.providerLabel || profile.provider} request failed: ${fetchCauseMessage}`);
      }

      throw error;
    } finally {
      timeout.clear();
    }
  }, 'request');
}

export function resolveRuntimeProfile({ task, profileId = null, modelOverride = '' }) {
  return resolveTaskProfile(task, profileId, modelOverride);
}

export async function runTask({ task, profileId = null, payload = {} }) {
  const profile = resolveRuntimeProfile({
    task,
    profileId: profileId || payload.profileId || null,
    modelOverride: payload.model || '',
  });

  if (profile.provider === 'gemini') {
    return runGeminiTask(profile, payload);
  }

  if (profile.provider === 'openai-compatible') {
    return runOpenAiCompatibleTask(profile, payload);
  }

  if (profile.provider === 'ollama') {
    return runOllamaTask(profile, payload);
  }

  throw new Error(`Unsupported provider "${profile.provider}".`);
}
