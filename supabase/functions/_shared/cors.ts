export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8081',
  'https://triallight.web.app',
  'https://triallight-patient.web.app',
];

export function resolveCorsHeaders(origin: string | null) {
  const configuredOrigins =
    Deno.env.get('ALLOWED_ORIGINS')
      ?.split(',')
      .map((entry) => entry.trim().replace(/\/$/, ''))
      .filter(Boolean) || DEFAULT_ALLOWED_ORIGINS;

  const normalizedOrigin = origin?.replace(/\/$/, '') || '';
  const allowOrigin =
    !origin || configuredOrigins.includes('*') || configuredOrigins.includes(normalizedOrigin)
      ? origin || '*'
      : '';

  return {
    'Access-Control-Allow-Origin': allowOrigin || 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}, origin: string | null = null) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...resolveCorsHeaders(origin),
      ...(init.headers || {}),
    },
  });
}

