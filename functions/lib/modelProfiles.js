function normalizeText(value = '') {
  return String(value || '').trim();
}

function readNumberEnv(name, fallback = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const DEFAULT_GUIDANCE_MODEL = normalizeText(process.env.SIDE_EFFECT_GUIDANCE_MODEL) || 'gemini-2.5-flash';
const DEFAULT_APPOINTMENT_MODEL =
  normalizeText(process.env.APPOINTMENT_GUIDANCE_MODEL) || 'gemini-2.5-flash';
const DEFAULT_ROUTER_MODEL =
  normalizeText(process.env.GUIDANCE_ROUTER_MODEL) || DEFAULT_GUIDANCE_MODEL;

const ACTIVE_PROFILE_ENV_BY_TASK = {
  guidance_route: 'GUIDANCE_ROUTER_PROFILE',
  guidance_answer: 'SIDE_EFFECT_GUIDANCE_PROFILE',
  guidance_case_generation: 'GUIDANCE_CASE_GENERATOR_PROFILE',
  appointment_answer: 'APPOINTMENT_GUIDANCE_PROFILE',
};

function buildProfile(definition) {
  return Object.freeze({
    timeoutMs: 60000,
    maxAttempts: 3,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    ...definition,
  });
}

function legacyProfile(task, modelOverride = '') {
  const safeTask = normalizeText(task);
  if (safeTask === 'guidance_route') {
    return buildProfile({
      id: 'legacy-guidance-route',
      task: safeTask,
      provider: 'gemini',
      providerLabel: 'gemini',
      model: normalizeText(modelOverride) || DEFAULT_ROUTER_MODEL,
      temperature: 0.1,
      topP: 0.1,
      responseFormat: 'json',
      timeoutMs: readNumberEnv('GUIDANCE_ROUTER_TIMEOUT_MS', 60000),
    });
  }

  if (safeTask === 'appointment_answer') {
    return buildProfile({
      id: 'legacy-appointment-answer',
      task: safeTask,
      provider: 'gemini',
      providerLabel: 'gemini',
      model: normalizeText(modelOverride) || DEFAULT_APPOINTMENT_MODEL,
      temperature: 0,
      topP: 0.95,
      responseFormat: 'json',
      timeoutMs: readNumberEnv('APPOINTMENT_GUIDANCE_TIMEOUT_MS', 180000),
    });
  }

  return buildProfile({
    id: 'legacy-guidance-answer',
    task: 'guidance_answer',
    provider: 'gemini',
    providerLabel: 'gemini',
    model: normalizeText(modelOverride) || DEFAULT_GUIDANCE_MODEL,
    temperature: 0.35,
    topP: 0.9,
    responseFormat: 'text',
    timeoutMs: readNumberEnv('SIDE_EFFECT_GUIDANCE_TIMEOUT_MS', 180000),
  });
}

const BUILTIN_MODEL_PROFILES = [
  legacyProfile('guidance_route'),
  legacyProfile('guidance_answer'),
  legacyProfile('appointment_answer'),
  buildProfile({
    id: 'ollama-router',
    task: 'guidance_route',
    provider: 'ollama',
    providerLabel: 'ollama',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    baseUrlFallback: 'http://127.0.0.1:11434',
    modelEnv: 'OLLAMA_GUIDANCE_ROUTER_MODEL',
    model: 'qwen3:8B-fine-tuned',
    temperature: 0.1,
    topP: 0.1,
    responseFormat: 'json',
    timeoutMs: readNumberEnv('OLLAMA_GUIDANCE_ROUTER_TIMEOUT_MS', 180000),
  }),
  buildProfile({
    id: 'ollama-guidance',
    task: 'guidance_answer',
    provider: 'ollama',
    providerLabel: 'ollama',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    baseUrlFallback: 'http://127.0.0.1:11434',
    modelEnv: 'OLLAMA_SIDE_EFFECT_GUIDANCE_MODEL',
    model: 'qwen3:8B-fine-tuned',
    temperature: 0.2,
    topP: 0.9,
    responseFormat: 'text',
    timeoutMs: readNumberEnv('OLLAMA_SIDE_EFFECT_GUIDANCE_TIMEOUT_MS', 300000),
  }),
  buildProfile({
    id: 'siliconflow-router',
    task: 'guidance_route',
    provider: 'openai-compatible',
    providerLabel: 'siliconflow',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    baseUrlEnv: 'SILICONFLOW_BASE_URL',
    baseUrlFallback: 'https://api.siliconflow.cn/v1',
    modelEnv: 'SILICONFLOW_GUIDANCE_ROUTER_MODEL',
    temperature: 0.1,
    topP: 0.1,
    responseFormat: 'json',
    maxAttempts: readNumberEnv('SILICONFLOW_GUIDANCE_ROUTER_MAX_ATTEMPTS', 1),
    timeoutMs: readNumberEnv('SILICONFLOW_GUIDANCE_ROUTER_TIMEOUT_MS', 120000),
    inputCostPerMillion: readNumberEnv('SILICONFLOW_GUIDANCE_ROUTER_INPUT_COST_PER_MILLION', 0),
    outputCostPerMillion: readNumberEnv('SILICONFLOW_GUIDANCE_ROUTER_OUTPUT_COST_PER_MILLION', 0),
  }),
  buildProfile({
    id: 'siliconflow-guidance',
    task: 'guidance_answer',
    provider: 'openai-compatible',
    providerLabel: 'siliconflow',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    baseUrlEnv: 'SILICONFLOW_BASE_URL',
    baseUrlFallback: 'https://api.siliconflow.cn/v1',
    modelEnv: 'SILICONFLOW_SIDE_EFFECT_GUIDANCE_MODEL',
    temperature: 0.35,
    topP: 0.9,
    responseFormat: 'text',
    maxAttempts: readNumberEnv('SILICONFLOW_SIDE_EFFECT_GUIDANCE_MAX_ATTEMPTS', 1),
    timeoutMs: readNumberEnv('SILICONFLOW_SIDE_EFFECT_GUIDANCE_TIMEOUT_MS', 120000),
    inputCostPerMillion: readNumberEnv('SILICONFLOW_SIDE_EFFECT_GUIDANCE_INPUT_COST_PER_MILLION', 0),
    outputCostPerMillion: readNumberEnv('SILICONFLOW_SIDE_EFFECT_GUIDANCE_OUTPUT_COST_PER_MILLION', 0),
  }),
  buildProfile({
    id: 'siliconflow-case-generator',
    task: 'guidance_case_generation',
    provider: 'openai-compatible',
    providerLabel: 'siliconflow',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    baseUrlEnv: 'SILICONFLOW_BASE_URL',
    baseUrlFallback: 'https://api.siliconflow.cn/v1',
    modelEnv: 'SILICONFLOW_CASE_GENERATOR_MODEL',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
    temperature: 0.35,
    topP: 0.8,
    responseFormat: 'json',
    maxAttempts: readNumberEnv('SILICONFLOW_CASE_GENERATOR_MAX_ATTEMPTS', 1),
    timeoutMs: readNumberEnv('SILICONFLOW_CASE_GENERATOR_TIMEOUT_MS', 180000),
    inputCostPerMillion: readNumberEnv('SILICONFLOW_CASE_GENERATOR_INPUT_COST_PER_MILLION', 0),
    outputCostPerMillion: readNumberEnv('SILICONFLOW_CASE_GENERATOR_OUTPUT_COST_PER_MILLION', 0),
  }),
];

function materializeProfile(profile) {
  const modelFromEnv = profile.modelEnv ? normalizeText(process.env[profile.modelEnv]) : '';
  const model = modelFromEnv || normalizeText(profile.model);

  if (!model) {
    throw new Error(
      `Model profile "${profile.id}" is missing a model. Set ${profile.modelEnv || 'a model value'} first.`
    );
  }

  const baseUrl = profile.baseUrlEnv
    ? normalizeText(process.env[profile.baseUrlEnv]) || normalizeText(profile.baseUrlFallback)
    : normalizeText(profile.baseUrl);
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedBaseUrl =
    profile.provider === 'ollama' && trimmedBaseUrl.endsWith('/v1')
      ? trimmedBaseUrl.slice(0, -3)
      : trimmedBaseUrl;

  return {
    ...profile,
    model,
    baseUrl: normalizedBaseUrl,
  };
}

export function getDefaultProfileIdForTask(task) {
  const safeTask = normalizeText(task);
  const configured = normalizeText(process.env[ACTIVE_PROFILE_ENV_BY_TASK[safeTask]]);
  if (configured) {
    return configured;
  }

  if (safeTask === 'guidance_route') return 'legacy-guidance-route';
  if (safeTask === 'guidance_case_generation') return 'siliconflow-case-generator';
  if (safeTask === 'appointment_answer') return 'legacy-appointment-answer';
  return 'legacy-guidance-answer';
}

export function listModelProfiles() {
  return BUILTIN_MODEL_PROFILES.map((profile) => materializeProfile(profile));
}

export function resolveTaskProfile(task, profileId = null, modelOverride = '') {
  const safeTask = normalizeText(task);
  if (!safeTask) {
    throw new Error('task is required when resolving a model profile.');
  }

  if (normalizeText(modelOverride)) {
    return legacyProfile(safeTask, modelOverride);
  }

  const effectiveProfileId = normalizeText(profileId) || getDefaultProfileIdForTask(safeTask);

  if (effectiveProfileId.startsWith('legacy-')) {
    return legacyProfile(safeTask);
  }

  const profile = BUILTIN_MODEL_PROFILES.find(
    (entry) => entry.id === effectiveProfileId && entry.task === safeTask
  );

  if (!profile) {
    throw new Error(`Unknown model profile "${effectiveProfileId}" for task "${safeTask}".`);
  }

  return materializeProfile(profile);
}
