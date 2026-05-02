import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'traillight-4750b';
const jwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export async function requireFirebaseUser(request: Request) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    throw new Error('Missing Firebase bearer token.');
  }

  const token = header.slice('Bearer '.length).trim();
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });

  return {
    uid: String(payload.user_id || payload.sub || ''),
    email: payload.email ? String(payload.email) : null,
    token,
  };
}
